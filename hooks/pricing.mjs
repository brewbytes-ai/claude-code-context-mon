// Pricing and cache-efficiency model. Pure functions, no engine access.
//
// Rates are USD per token. The built-in table is the fallback; the live
// LiteLLM price book (see `buildTable`) overrides it when it has the model.
// Edit DEFAULT_RATES to pin your own rates.

const perM = n => n / 1_000_000

const mk = (input, output) => ({
  input: perM(input),
  output: perM(output),
  write: perM(input * 1.25), // 5-minute cache write
  read: perM(input * 0.1),
})

// Offline fallbacks, set to the current generation. The live price book wins
// whenever it knows the model, so older models (Opus 4/4.1 at $15/$75, Haiku
// 3.5 at $0.80/$4) are priced exactly while online. Turns priced from this
// table are flagged `isEstimated` and shown with a `~` in the badge.
export const DEFAULT_RATES = {
  sonnet: mk(3, 15), // Claude 3.5 / 3.7 / 4.x Sonnet
  opus: mk(5, 25), // Opus 4.5 and later
  haiku: mk(1, 5), // Haiku 4.5
}
export const FALLBACK_FAMILY = 'sonnet'

export const PRICE_TTL_MS = 24 * 60 * 60 * 1000
export const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000

const family = id => {
  const m = id.toLowerCase()
  if (m.includes('opus')) return 'opus'
  if (m.includes('haiku')) return 'haiku'
  if (m.includes('sonnet')) return 'sonnet'
  return FALLBACK_FAMILY
}

const bare = id =>
  id
    .toLowerCase()
    .replace(/\[.*\]$/, '') // [1m] context suffix
    .replace(/^anthropic\//, '')

const undated = id => id.replace(/-(\d{8}|latest)$/, '')

/**
 * Reduce the full LiteLLM JSON to the Claude chat models and the four fields
 * that matter, so it fits the plugin store.
 */
export function buildTable(json) {
  const table = {}
  for (const [key, v] of Object.entries(json)) {
    if (!v || typeof v !== 'object') continue
    const id = key.toLowerCase()
    if (!(id.startsWith('claude-') || id.startsWith('anthropic/claude-'))) continue
    if (typeof v.input_cost_per_token !== 'number') continue
    if (typeof v.output_cost_per_token !== 'number') continue
    const input = v.input_cost_per_token
    table[bare(id)] = {
      input,
      output: v.output_cost_per_token,
      write: v.cache_creation_input_token_cost ?? input * 1.25,
      read: v.cache_read_input_token_cost ?? input * 0.1,
    }
  }
  return table
}

/** Resolve a model id to rates: `{ rates, isEstimated }`. */
export function ratesFor(model, table) {
  const id = bare(model || '')
  if (table) {
    // Exact id, or a dated snapshot of a known model. A prefix match would
    // price a new generation with an older one's rates, so an unknown model
    // falls through to the family default and is flagged as an estimate.
    const hit = table[id] ?? table[undated(id)]
    if (hit) return { rates: hit, isEstimated: false }
  }
  return { rates: DEFAULT_RATES[family(id)], isEstimated: true }
}

/**
 * One turn's tokens, cost and cache metrics. `usage` is the API's: input_tokens
 * is the *uncached* remainder; total input = uncached + read + write.
 */
export function turnStats(usage, table) {
  const { rates, isEstimated } = ratesFor(usage.model, table)
  const uncached = usage.input_tokens || 0
  const read = usage.cache_read_input_tokens || 0
  const write = usage.cache_creation_input_tokens || 0
  const out = usage.output_tokens || 0
  const totalIn = uncached + read + write

  const cost = uncached * rates.input + write * rates.write + read * rates.read + out * rates.output
  const gross = totalIn * rates.input + out * rates.output // no caching at all
  return {
    uncached,
    read,
    write,
    out,
    cost,
    gross,
    saved: gross - cost, // negative on write-heavy turns: the cache is an investment
    hitRate: totalIn > 0 ? read / totalIn : 0,
    model: usage.model || 'unknown',
    isEstimated,
  }
}

export const emptyTotals = () => ({
  turns: 0, uncached: 0, read: 0, write: 0, out: 0, cost: 0, gross: 0, saved: 0,
})

export const addTurn = (t, s) => ({
  turns: t.turns + 1,
  uncached: t.uncached + s.uncached,
  read: t.read + s.read,
  write: t.write + s.write,
  out: t.out + s.out,
  cost: t.cost + s.cost,
  gross: t.gross + s.gross,
  saved: t.saved + s.saved,
})

export const totalInput = t => t.uncached + t.read + t.write
export const sessionHitRate = t => (totalInput(t) > 0 ? t.read / totalInput(t) : 0)

/**
 * The real prompt-cache state, read from the tail of the session transcript,
 * where each API response is recorded with its `cache_creation` breakdown
 * (`ephemeral_5m` / `ephemeral_1h` tokens): the lifetime the API granted and
 * when the main thread last touched the cache. Subagent (sidechain) rows are
 * skipped: they run their own caches. Returns `{ ttlMs, touchedAt }`, either
 * null when the tail does not show it (e.g. a session with no cache writes yet).
 */
export function cacheFromTranscript(tail) {
  const rows = tail.split('\n').slice(1) // the first row may be cut mid-line
  let ttlMs = null
  let touchedAt = null
  for (let i = rows.length - 1; i >= 0 && (ttlMs === null || touchedAt === null); i--) {
    const row = rows[i]
    if (!row.includes('"type":"assistant"')) continue
    let msg
    try {
      msg = JSON.parse(row)
    } catch {
      continue
    }
    const u = msg?.message?.usage
    if (!u || msg.isSidechain) continue
    if (touchedAt === null && (u.cache_read_input_tokens > 0 || u.cache_creation_input_tokens > 0)) {
      const t = Date.parse(msg.timestamp)
      if (Number.isFinite(t)) touchedAt = t
    }
    const cc = u.cache_creation
    if (ttlMs === null && cc) {
      if (cc.ephemeral_1h_input_tokens > 0) ttlMs = 60 * 60 * 1000
      else if (cc.ephemeral_5m_input_tokens > 0) ttlMs = 5 * 60 * 1000
    }
  }
  return { ttlMs, touchedAt }
}

/** Is a stored `{ fetchedAt, failedAt }` record due for a refresh? */
export function isStale(rec, now) {
  if (!rec?.table) return !rec?.failedAt || now - rec.failedAt > RETRY_AFTER_FAILURE_MS
  if (rec.failedAt && now - rec.failedAt < RETRY_AFTER_FAILURE_MS) return false
  return now - rec.fetchedAt > PRICE_TTL_MS
}

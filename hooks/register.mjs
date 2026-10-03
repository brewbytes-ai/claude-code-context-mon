import { atom, read, update } from 'claude-code'

import { ContextBar } from './contextBar.tsx'
import { alertText, ansiLines, badge, HEX, money, pct, plain, summary } from './fmt.mjs'
import { addTurn, buildTable, cacheFromTranscript, emptyTotals, isStale, turnStats } from './pricing.mjs'

const session = atom({ plugin: 'context-mon', key: 'session' }, {
  ...emptyTotals(),
  missStreak: 0,
  alertLevel: 0,
})
const last = atom({ plugin: 'context-mon', key: 'last' }, null)
const isHidden = atom({ plugin: 'context-mon', key: 'isHidden' }, false)
const cacheTtl = atom({ plugin: 'context-mon', key: 'cacheTtl' }, null) // ms, as the API granted it (from the transcript)
const cacheAt = atom({ plugin: 'context-mon', key: 'cacheAt' }, null) // ms of the last request that touched the cache

const context = atom({ plugin: 'context-mon', key: 'context' }, null)
const isLegendOpen = atom({ plugin: 'context-mon', key: 'isLegendOpen' }, true)

const STORE_KEY = 'prices'
const book = { record: null, isRefreshing: false, timer: null, transcript: null } // { table, fetchedAt, failedAt }
const COLOR = { accent: HEX.accent, dim: HEX.dim, green: HEX.green, red: HEX.red }

// Price book: store -> memory; network at most once a day, never on the turn's path.
async function refreshPrices($, url, force = false) {
  if (book.isRefreshing) return 'busy'
  const now = await $.clock.now()
  if (!force && !isStale(book.record, now)) return 'fresh'
  book.isRefreshing = true
  try {
    const res = await $.http.fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const table = buildTable(JSON.parse(res.text))
    if (Object.keys(table).length === 0) throw new Error('no Claude models in price book')
    book.record = { table, fetchedAt: now }
    await $.store.set(STORE_KEY, book.record)
    return 'updated'
  } catch (err) {
    book.record = { ...(book.record ?? {}), failedAt: now }
    await $.store.set(STORE_KEY, book.record)
    return `failed: ${err?.message ?? err}`
  } finally {
    book.isRefreshing = false
  }
}

const DEFAULT_TTL_MS = 5 * 60 * 1000 // until the transcript shows what the API granted

// The cache lifetime in force: the override if set, else what the API granted.
async function cacheExpiry($, forcedTtlMs) {
  const at = await read($, cacheAt)
  if (at === null) return null
  const ttlMs = forcedTtlMs || (await read($, cacheTtl)) || DEFAULT_TTL_MS
  return { remainingMs: at + ttlMs - (await $.clock.now()), ttlMs }
}

// Learn the real lifetime (and, after a reload or resume, when the cache was
// last touched) from the transcript's tail, where the API's breakdown is recorded.
async function syncCache($) {
  if (!book.transcript) return
  const run = await $.process.run(['tail', '-c', '400000', book.transcript])
  if (run.exitCode !== 0) return
  const found = cacheFromTranscript(run.stdout)
  if (found.ttlMs !== null) await update($, cacheTtl, () => found.ttlMs)
  if (found.touchedAt !== null) await update($, cacheAt, at => at ?? found.touchedAt)
}

// The window by category, as /context counts it (local estimates, no API call).
async function syncContext($) {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const b = usage.context.breakdown
  if (!b) return
  const snap = {
    total: b.totalTokens,
    max: b.rawMaxTokens,
    compactAt: b.isAutoCompactEnabled ? (b.autoCompactThreshold ?? null) : null,
    categories: b.categories.map(c => ({ name: c.name, tokens: c.tokens, kind: c.kind })),
  }
  await update($, context, () => snap)
}

export const register = (on, options = {}) => {
  const costStep = Number(options.costThreshold) > 0 ? Number(options.costThreshold) : 1
  const missLimit = Number(options.missStreak) > 0 ? Number(options.missStreak) : 3
  const missBelow = (Number.isFinite(Number(options.missBelowPct)) ? Number(options.missBelowPct) : 50) / 100
  const minInput = Number(options.minInputTokens) >= 0 ? Number(options.minInputTokens) : 2000
  const forcedTtlMs = Number(options.cacheTtlMinutes) > 0 ? Number(options.cacheTtlMinutes) * 60000 : 0
  const showBand = options.showBand !== false
  const priceUrl =
    options.priceUrl ||
    'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

  const priceSource = () =>
    book.record?.table ? `LiteLLM (${new Date(book.record.fetchedAt).toISOString().slice(0, 10)})` : 'built-in'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-mon',
      description: 'Cache efficiency and cost summary (args: reset | hide | show | legend | refresh)',
    })
    book.record = (await $.store.get(STORE_KEY)) ?? null
    void refreshPrices($, priceUrl)
    // Redraw the band twice a minute so the countdown stays live.
    book.timer?.cancel()
    void syncContext($).catch(() => {})
    book.timer = $.clock.every(30000, () => $.ui.invalidate('ui.render'))

    return next(e)
  })

  // The classic prompt hook carries the transcript's path; learn the cache state from it.
  on('classic.UserPromptSubmit', async ($, e, next) => {
    book.transcript = e.transcript_path ?? book.transcript
    await syncCache($).catch(() => {})
    return next(e)
  })

  // Every response that read or wrote the cache renews its lifetime.
  on('turn.step', async function* ($, e, next) {
    const startedAt = await $.clock.now() // the cache entry renews at request time, not when streaming ends
    const result = yield* next(e)
    const u = result?.usage
    if (u && !e.agentId && (u.cache_read_input_tokens > 0 || u.cache_creation_input_tokens > 0)) {
      await update($, cacheAt, () => startedAt)
    }
    return result
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.usage) return result

    if (isStale(book.record, await $.clock.now())) void refreshPrices($, priceUrl)

    const stat = turnStats(e.usage, book.record?.table)
    // Fold the turn into the session inside the updater, so overlapping turns
    // (a subagent finishing beside the main loop) never overwrite each other.
    // The updater may run again on a version conflict; the last run wins.
    const total = stat.uncached + stat.read + stat.write
    let before = null
    let totals = null
    let missStreak = 0
    let level = 0
    await update($, session, prev => {
      before = prev
      totals = addTurn(prev, stat)
      // Cache-miss streak counts main-loop turns only: subagents start cold by design.
      const isMiss = !e.agentId && prev.turns > 0 && total >= minInput && stat.hitRate < missBelow
      missStreak = e.agentId ? prev.missStreak : isMiss ? prev.missStreak + 1 : 0
      level = Math.floor(totals.cost / costStep)
      return { ...totals, missStreak, alertLevel: Math.max(level, prev.alertLevel) }
    })
    await update($, last, () => stat)
    await syncCache($).catch(() => {})
    await syncContext($).catch(() => {})

    if (level > before.alertLevel) {
      $.ui.toast(alertText(`session cost passed ${money(level * costStep)} (now ${money(totals.cost)}). Consider starting a fresh session`))
    } else if (missStreak >= missLimit && missStreak > before.missStreak) {
      $.ui.toast(alertText(`${missStreak} turns in a row below ${pct(missBelow)} cache hits. Context may be bloated; consider starting a fresh session`))
    }

    return result
  })

  on('command.run', { command: 'context-mon' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()

    if (arg === 'reset') {
      await update($, session, () => ({ ...emptyTotals(), missStreak: 0, alertLevel: 0 }))
      await update($, last, () => null)
      await update($, cacheAt, () => null)
      await update($, cacheTtl, () => null)
      return { text: 'context-mon: session totals reset.' }
    }
    if (arg === 'hide' || arg === 'show') {
      await update($, isHidden, () => arg === 'hide')
      return { text: `context-mon: badge ${arg === 'hide' ? 'hidden' : 'shown'}.` }
    }
    if (arg === 'legend') {
      let open = false
      await update($, isLegendOpen, prev => (open = !prev))
      return { text: `context-mon: legend ${open ? 'expanded' : 'collapsed'}.` }
    }
    if (arg === 'refresh') {
      const outcome = await refreshPrices($, priceUrl, true)
      return { text: `context-mon: price book ${outcome}.` }
    }

    const totals = await read($, session)
    const turn = await read($, last) // persists across reloads, unlike module variables
    const expiry = await cacheExpiry($, forcedTtlMs)
    const meta = { model: turn?.model, isEstimated: turn?.isEstimated, priceSource: priceSource(), expiry }
    return { text: ansiLines(summary(totals, meta)) }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const turn = await read($, last)
    const ctx = await read($, context)
    if (!showBand || e.props.hasSurvey || (turn === null && ctx === null) || (await read($, isHidden))) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const totals = await read($, session)
    const expiry = await cacheExpiry($, forcedTtlMs)
    const line = turn === null ? null : h(
      Box,
      { paddingX: 1 },
      ...badge(turn, totals, expiry).map(x =>
        h(Text, x.s === 'dim' ? { dimColor: true } : x.s === 'plain' ? {} : { color: COLOR[x.s] }, x.t),
      ),
    )
    if (ctx === null) return line

    const card = ContextBar({
      ui: { Box, Text, Button },
      ctx,
      expiry,
      columns: e.props.bodyColumns,
      isOpen: await read($, isLegendOpen),
      onToggle: () => update($, isLegendOpen, open => !open),
    })
    return h(Box, { flexDirection: 'column' }, card, line)
  })
}

// Claude Code visual language: warm amber accent, dim gray chrome, green for
// savings, default foreground for primary text. Lines are built once as
// styled segments, then rendered as ANSI (command output) or as plain text
// (status line); register.mjs maps the same segments onto <Text> for the band.

import { sessionHitRate } from './pricing.mjs'

export const HEX = { accent: '#D97706', dim: '#6B7280', green: '#16A34A', red: '#DC2626' }

const ANSI = {
  accent: '\x1b[33m',
  dim: '\x1b[90m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  plain: '',
}
const RESET = '\x1b[0m'

const seg = (t, s = 'plain') => ({ t, s })

export const money = n => {
  const sign = n < 0 ? '-' : ''
  const v = Math.abs(n)
  return `${sign}$${v < 0.1 ? v.toFixed(3) : v.toFixed(2)}`
}

export const tokens = n =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n)

export const pct = r => `${(r * 100).toFixed(1)}%`

export const ansi = segs =>
  segs.map(x => (x.s === 'plain' ? x.t : `${ANSI[x.s]}${x.t}${RESET}`)).join('')
export const ansiLines = lines => lines.map(ansi).join('\n')
export const plain = segs => segs.map(x => x.t).join('')

/**
 * Cache lifetime left, in minutes (e.g. 42m); red under a minute, 0m once it lapses.
 * `expiry` = { remainingMs }; remaining rounds up so it never shows 0m while live.
 */
export function expirySegs(expiry) {
  const left = `${Math.max(0, Math.ceil(expiry.remainingMs / 60000))}m`
  const low = expiry.remainingMs <= 60000 // includes expired: 0m/5m
  return [seg(left, low ? 'red' : 'accent')]
}

/** ╭─ [Cache: 94.2% • Saved: $0.08 • 42m] Turn: $0.012 │ Session: $0.14 */
export function badge(turn, session, expiry) {
  const saved = turn.saved >= 0 ? seg(money(turn.saved), 'green') : seg(money(turn.saved), 'red')
  return [
    seg('╭─ ', 'dim'),
    seg('[', 'dim'),
    seg('Cache: ', 'accent'),
    seg(pct(turn.hitRate), 'accent'),
    seg(' • ', 'dim'),
    seg('Saved: ', 'accent'),
    saved,
    ...(expiry ? [seg(' • ', 'dim'), ...expirySegs(expiry)] : []),
    seg(']', 'dim'),
    seg(' Turn: '),
    seg(`${turn.isEstimated ? '~' : ''}${money(turn.cost)}`), // ~ = priced from built-in estimate
    seg(' │ ', 'dim'),
    seg('Session: '),
    seg(money(session.cost)),
  ]
}

const row = (label, value, valueStyle = 'plain') => [
  seg('│ ', 'dim'),
  seg(label.padEnd(11), 'dim'),
  ...(Array.isArray(value) ? value : [seg(value, valueStyle)]),
]

/** Rich session card. `meta` = { model, isEstimated, priceSource } */
export function summary(t, meta = {}) {
  const net = t.cost
  const savedStyle = t.saved >= 0 ? 'green' : 'red'
  const lines = [
    [seg('╭─ ', 'dim'), seg('Context monitor', 'accent'), seg(` • ${t.turns} turn${t.turns === 1 ? '' : 's'}`, 'dim')],
    row('Tokens', [
      seg('Read ', 'dim'), seg(tokens(t.read)),
      seg(' • ', 'dim'), seg('Write ', 'dim'), seg(tokens(t.write)),
      seg(' • ', 'dim'), seg('Out ', 'dim'), seg(tokens(t.out)),
    ]),
    row('Uncached', `${tokens(t.uncached)} input`),
    row('Efficiency', pct(sessionHitRate(t)), 'accent'),
    ...(meta.expiry ? [row('Expires', expirySegs(meta.expiry))] : []),
    row('Gross', money(t.gross)),
    row('Savings', money(t.saved), savedStyle),
    row('Net billed', money(net), 'accent'),
    [seg('│', 'dim')],
    [seg('╰─ ', 'dim'), seg(
      `${meta.model ?? 'model unknown'}${meta.isEstimated ? ' (est. rates)' : ''} • prices: ${meta.priceSource ?? 'built-in'}`,
      'dim',
    )],
  ]
  return lines
}

/** One-line alert text, plain. */
export const alertText = msg => `context-mon • ${msg}`

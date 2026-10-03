// The context card above the prompt: a full-width stacked bar of the window by
// category, the compaction marker, the cache TTL, and a collapsible legend.
// Pure drawing: no `$`; register.mjs hands in the elements, data and handlers.

import type { ContextSnapshot } from '../types'

import { HEX, tokens } from './fmt.mjs'

// One colour per category, by position among the used rows (as /context orders them).
const PALETTE = ['#6B8FD6', '#6CC3C9', '#9D7BF5', '#8CC97A', '#E5C463', '#E9A0C0', '#D9714E', '#7FB3E0', '#C9A27A']
const FREE = '#374151'
const BUFFER = '#4B5563'

const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : tokens(n).replace('.0k', 'k'))
const share = (n: number, of: number) => `${Math.round((n / Math.max(of, 1)) * 100)}%`
const ttlText = (ttlMs: number) => (ttlMs >= 3600000 ? `${Math.round(ttlMs / 3600000)}h` : `${Math.round(ttlMs / 60000)}m`)

type Expiry = { remainingMs: number; ttlMs: number } | null

type Props = {
  ui: { Box: any; Text: any; Button: any }
  ctx: ContextSnapshot
  expiry: Expiry
  columns: number
  isOpen: boolean
  onToggle: () => void
}

export function ContextBar({ ui, ctx, expiry, columns, isOpen, onToggle }: Props) {
  const { Box, Text, Button } = ui
  const used = ctx.categories.filter(c => c.kind === 'used')
  const free = ctx.categories.find(c => c.kind === 'free')
  const buffer = ctx.categories.find(c => c.kind === 'buffer')
  const colored = used.map((c, i) => ({ ...c, hex: PALETTE[i % PALETTE.length] }))

  // Bar cells: border (2) + paddingX (2) off the band's width.
  const width = Math.max(10, columns - 4)
  const perCell = ctx.max / width
  const cells: { hex: string; ch: string }[] = []
  for (const c of colored) {
    const n = c.tokens > 0 ? Math.max(1, Math.round(c.tokens / perCell)) : 0
    for (let i = 0; i < n && cells.length < width; i++) cells.push({ hex: c.hex, ch: '█' })
  }
  const bufferCells = buffer ? Math.round(buffer.tokens / perCell) : 0
  while (cells.length < width - bufferCells) cells.push({ hex: FREE, ch: '█' })
  while (cells.length < width) cells.push({ hex: BUFFER, ch: '█' })
  if (ctx.compactAt) {
    const at = Math.min(width - 1, Math.round(ctx.compactAt / perCell))
    cells[at] = { hex: HEX.accent, ch: '▌' }
  }
  // Merge runs so the bar is a handful of Text nodes, not one per cell.
  const runs: { hex: string; text: string }[] = []
  for (const c of cells) {
    const prev = runs[runs.length - 1]
    if (prev && prev.hex === c.hex && c.ch === '█' && prev.text.endsWith('█')) prev.text += c.ch
    else runs.push({ hex: c.hex, text: c.ch })
  }

  const percent = Math.round((ctx.total / Math.max(ctx.max, 1)) * 100)
  const percentColor = percent >= 80 ? HEX.red : percent >= 60 ? HEX.accent : HEX.green
  const isExpired = expiry !== null && expiry.remainingMs <= 0
  const left = expiry ? Math.max(0, Math.ceil(expiry.remainingMs / 60000)) : 0

  const legend = [
    ...colored.map(c => ({ key: c.name, hex: c.hex, name: c.name.toLowerCase(), value: short(c.tokens), pct: share(c.tokens, ctx.max) })),
    ...(free ? [{ key: 'free', hex: FREE, name: 'free', value: short(free.tokens), pct: '' }] : []),
  ]

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={HEX.dim} paddingX={1} width={columns}>
      <Box justifyContent="space-between">
        <Box>
          <Text color={HEX.accent}>◆ </Text>
          <Text bold>context</Text>
        </Box>
        <Box>
          <Text bold>{short(ctx.total)}</Text>
          <Text dimColor> of {short(ctx.max)}</Text>
          {ctx.compactAt ? <Text dimColor> · compacts at {short(ctx.compactAt)}</Text> : null}
          <Text dimColor> · cache </Text>
          {expiry === null ? (
            <Text dimColor>–</Text>
          ) : isExpired ? (
            <Text color={HEX.red}>expired</Text>
          ) : (
            <Text color={left <= 1 ? HEX.red : HEX.accent}>{left}m</Text>
          )}
          {expiry ? <Text dimColor> (ttl {ttlText(expiry.ttlMs)})</Text> : null}
          <Text> </Text>
          <Text bold color="#111827" backgroundColor={percentColor}> {percent}% </Text>
        </Box>
      </Box>
      <Box>
        {runs.map((r, i) => (
          <Text key={`b${i}`} color={r.hex}>{r.text}</Text>
        ))}
      </Box>
      <Button
        key="legend"
        plain
        dimColor
        hotkey="l"
        label={isOpen ? '▾ hide legend' : `▸ show legend (${legend.length})`}
        onPress={onToggle}
      />
      {isOpen ? (
        <Box flexWrap="wrap" columnGap={3}>
          {legend.map(l => (
            <Box key={l.key}>
              <Text color={l.hex}>■ </Text>
              <Text dimColor>{l.name} </Text>
              <Text bold>{l.value}</Text>
              {l.pct ? <Text dimColor> {l.pct}</Text> : null}
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

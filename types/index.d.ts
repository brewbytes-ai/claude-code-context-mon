export type Totals = {
  turns: number
  uncached: number
  read: number
  write: number
  out: number
  cost: number
  gross: number
  saved: number
}

export type Session = Totals & {
  missStreak: number
  alertLevel: number
}

export type TurnStat = {
  uncached: number
  read: number
  write: number
  out: number
  cost: number
  gross: number
  saved: number
  hitRate: number
  model: string
  isEstimated: boolean
}

export type ContextSnapshot = {
  total: number
  max: number
  compactAt: number | null
  categories: { name: string; tokens: number; kind: 'used' | 'free' | 'buffer' | 'deferred' }[]
}

declare module 'claude-code' {
  interface PluginState {
    'context-mon': {
      session: Session
      last: TurnStat | null
      isHidden: boolean
      cacheAt: number | null
      cacheTtl: number | null
      context: ContextSnapshot | null
      isLegendOpen: boolean
    }
  }
}

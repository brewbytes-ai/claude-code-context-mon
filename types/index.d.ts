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

declare module 'claude-code' {
  interface PluginState {
    'context-mon': {
      session: Session
      last: TurnStat | null
      isHidden: boolean
      cacheAt: number | null
      cacheTtl: number | null
    }
  }
}

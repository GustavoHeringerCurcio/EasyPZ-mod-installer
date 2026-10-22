export type InstallStage =
  | 'preflight'
  | 'download'
  | 'workshop'
  | 'ui-suite'
  | 'verify'
  | 'extract'
  | 'apply'
  | 'zombiebuddy'
  | 'configure'
  | 'activate'
  | 'host'
  | 'state'

export type StageStatus = 'start' | 'done' | 'skip'

export interface WorkshopItemProgress {
  index: number
  total: number
  name: string
  status: 'starting' | 'downloading' | 'done' | 'failed'
  percent: number | null
  transferredBytes?: number
  totalBytes?: number
  bytesPerSecond?: number
  etaSeconds?: number
}

export type EngineEvent =
  | { type: 'stage'; stage: InstallStage; status: StageStatus; detail?: string }
  | {
      type: 'progress'
      stage: 'download' | 'workshop' | 'ui-suite' | 'extract'
      percent: number
      transferred?: number
      total?: number
      bytesPerSecond?: number
      etaSeconds?: number
      downloaded?: number
      cached?: number
      failed?: number
    }
  | { type: 'workshop-item'; item: WorkshopItemProgress }
  | {
      type: 'mod'
      index: number
      total: number
      name: string
      action: 'moved' | 'kept' | 'backedUp' | 'removed'
    }
  | { type: 'warning'; message: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'done'; summary: InstallSummary }
  | { type: 'error'; code: string; message: string }

export interface InstallSummary {
  packId: string
  clientMods: number
  serverMods: number
  workshopItems: number
  downloadedBytes: number
  installedAt: string
  zombieBuddy: 'already-installed' | 'installed' | 'missing-source' | 'skipped'
  hostUpdated: boolean
}

export type EventSink = (event: EngineEvent) => void

export function noopSink(): void {
  // Intentionally empty: used by headless operations and tests.
}

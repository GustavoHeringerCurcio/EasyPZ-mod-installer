import type { EngineEvent, InstallSummary } from '@easypz/engine'

export type StageName =
  | 'preflight'
  | 'download'
  | 'verify'
  | 'extract'
  | 'apply'
  | 'zombiebuddy'
  | 'configure'
  | 'activate'
  | 'host'
  | 'state'

export const STAGE_ORDER: StageName[] = [
  'preflight',
  'download',
  'verify',
  'extract',
  'apply',
  'zombiebuddy',
  'configure',
  'activate',
  'host',
  'state',
]

export interface StageState {
  status: 'start' | 'done' | 'skip'
  detail?: string
}

export interface InstallProgress {
  percent: number
  transferred?: number
  total?: number
  bytesPerSecond?: number
  etaSeconds?: number
}

export interface InstallLogLine {
  level: 'info' | 'warn' | 'error'
  message: string
  at: string
}

export interface InstallUiState {
  visible: boolean
  running: boolean
  packId: string | null
  stages: Partial<Record<StageName, StageState>>
  progress: Partial<Record<'download' | 'extract', InstallProgress>>
  currentMod: { index: number; total: number; name: string; action: string } | null
  logs: InstallLogLine[]
  summary: InstallSummary | null
  error: { code: string; message: string } | null
}

export function createInstallState(packId: string): InstallUiState {
  return {
    visible: true,
    running: true,
    packId,
    stages: {},
    progress: {},
    currentMod: null,
    logs: [],
    summary: null,
    error: null,
  }
}

export function emptyInstallState(): InstallUiState {
  return {
    visible: false,
    running: false,
    packId: null,
    stages: {},
    progress: {},
    currentMod: null,
    logs: [],
    summary: null,
    error: null,
  }
}

function addLog(
  state: InstallUiState,
  level: InstallLogLine['level'],
  message: string,
): InstallLogLine[] {
  const next = [...state.logs, { level, message, at: new Date().toISOString() }]
  return next.slice(-250)
}

export function reduceInstallEvent(state: InstallUiState, event: EngineEvent): InstallUiState {
  switch (event.type) {
    case 'stage':
      return {
        ...state,
        stages: {
          ...state.stages,
          [event.stage]: { status: event.status, detail: event.detail },
        },
      }
    case 'progress':
      return {
        ...state,
        progress: {
          ...state.progress,
          [event.stage]: {
            percent: event.percent,
            transferred: event.transferred,
            total: event.total,
            bytesPerSecond: event.bytesPerSecond,
            etaSeconds: event.etaSeconds,
          },
        },
      }
    case 'mod':
      return {
        ...state,
        currentMod: {
          index: event.index,
          total: event.total,
          name: event.name,
          action: event.action,
        },
      }
    case 'warning':
      return { ...state, logs: addLog(state, 'warn', event.message) }
    case 'log':
      return {
        ...state,
        logs: addLog(state, event.level === 'warn' ? 'warn' : 'info', event.message),
      }
    case 'error':
      return {
        ...state,
        running: false,
        error: { code: event.code, message: event.message },
        logs: addLog(state, 'error', event.message),
      }
    case 'done':
      return {
        ...state,
        running: false,
        summary: event.summary,
        logs: addLog(state, 'info', 'Install complete.'),
      }
    default:
      return state
  }
}

export function failInstallState(
  state: InstallUiState,
  code: string,
  message: string,
): InstallUiState {
  return {
    ...state,
    running: false,
    error: { code, message },
    logs: addLog(state, 'error', message),
  }
}

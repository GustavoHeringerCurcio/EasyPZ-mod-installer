import type { Catalog, IndexedPack } from '@easypz/catalog'
import type {
  AppState,
  EngineEvent,
  GameInfo,
  HostApplyResult,
  InstallSummary,
  PackHealth,
} from '@easypz/engine'

export type Language = 'en' | 'pt-BR'

export interface Settings {
  language: Language
  gamePathOverride: string | null
  updateChannel: 'off' | 'latest'
}

export interface PendingAction {
  type: 'install'
  packId: string
}

export interface PackView extends IndexedPack {
  coverDataUrl: string | null
}

export interface CatalogView extends Omit<Catalog, 'packs'> {
  packs: PackView[]
}

export interface AppPathView {
  cache: string
  mods: string
  backups: string
  zomboid: string
  game: string | null
  logs: string
}

export interface Bootstrap {
  appVersion: string
  isPackaged: boolean
  catalog: CatalogView
  game: GameInfo
  state: AppState
  settings: Settings
  legacyDetected: boolean
  isElevated: boolean
  logsPath: string
  paths: AppPathView
  pendingAction: PendingAction | null
  platform: string
}

export type OperationResult<T = void> =
  | { ok: true; data: T }
  | {
      ok: false
      code: string
      message: string
      needsElevation?: boolean
    }

export interface DeactivateResult {
  removed: number
  purged: boolean
  backupRoot: string | null
}

export interface EasyPzApi {
  getBootstrap: () => Promise<Bootstrap>
  startInstall: (packId: string) => Promise<OperationResult<InstallSummary>>
  cancelInstall: () => Promise<void>
  activate: (packId: string) => Promise<OperationResult<{ modCount: number }>>
  deactivate: (packId: string, purge: boolean) => Promise<OperationResult<DeactivateResult>>
  verify: (packId: string) => Promise<OperationResult<PackHealth>>
  applyHost: (packId: string) => Promise<OperationResult<HostApplyResult>>
  setGamePath: (gamePath: string | null) => Promise<OperationResult<Bootstrap>>
  pickGamePath: () => Promise<string | null>
  setLanguage: (language: Language) => Promise<OperationResult<Bootstrap>>
  openPath: (target: string) => Promise<void>
  openLogs: () => Promise<void>
  restartAsAdmin: (pending: PendingAction | null) => Promise<OperationResult<never>>
  consumePendingAction: () => Promise<PendingAction | null>
  onInstallEvent: (callback: (event: EngineEvent) => void) => () => void
}

export const IPC = {
  getBootstrap: 'app:getBootstrap',
  startInstall: 'install:start',
  cancelInstall: 'install:cancel',
  activate: 'pack:activate',
  deactivate: 'pack:deactivate',
  verify: 'pack:verify',
  applyHost: 'host:apply',
  setGamePath: 'settings:setGamePath',
  pickGamePath: 'settings:pickGamePath',
  setLanguage: 'settings:setLanguage',
  openPath: 'app:openPath',
  openLogs: 'app:openLogs',
  restartAsAdmin: 'app:restartAsAdmin',
  consumePendingAction: 'app:consumePendingAction',
  installEvent: 'install:event',
} as const

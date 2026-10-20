import type { Catalog, IndexedPack } from '@easypz/catalog'
import type {
  AppState,
  DeletePackResult,
  EngineEvent,
  GameInfo,
  HostApplyResult,
  HostStatus,
  InstallSummary,
  PackHealth,
  PackToggleResult,
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
  store: string
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
  availablePackIds: string[]
  host: HostStatus
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

export interface EasyPzApi {
  getBootstrap: () => Promise<Bootstrap>
  startInstall: (packId: string) => Promise<OperationResult<InstallSummary>>
  cancelInstall: () => Promise<void>
  setPackEnabled: (packId: string, enabled: boolean) => Promise<OperationResult<PackToggleResult>>
  repairPack: (packId: string) => Promise<OperationResult<PackToggleResult>>
  deletePack: (packId: string) => Promise<OperationResult<DeletePackResult>>
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
  setPackEnabled: 'pack:setEnabled',
  repairPack: 'pack:repair',
  deletePack: 'pack:delete',
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

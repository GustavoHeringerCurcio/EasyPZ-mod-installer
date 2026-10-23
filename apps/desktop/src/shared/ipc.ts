import type { Catalog, IndexedPack, UiSuite } from '@easypz/catalog'
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
  PerformanceConfigResult,
  PerformancePreset,
} from '@easypz/engine'

export type { PerformancePreset } from '@easypz/engine'

export interface FpsBoostApplyResult {
  bootstrap: Bootstrap
  performance: PerformanceConfigResult
}

export type Language = 'en' | 'pt-BR'

export interface Settings {
  language: Language
  gamePathOverride: string | null
  updateChannel: 'off' | 'latest'
  heapMB: number | null
}

export interface PendingAction {
  type: 'install'
  packId: string
  uiSuiteId?: string | null
}

export interface PackView extends IndexedPack {
  coverDataUrl: string | null
}

export interface UiSuiteView extends UiSuite {
  coverDataUrl: string | null
  galleryDataUrls: string[]
}

export interface CatalogView extends Omit<Catalog, 'packs' | 'uiSuites'> {
  packs: PackView[]
  uiSuites: UiSuiteView[]
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
  catalogSource: 'remote' | 'bundled'
  catalogBaseUrl: string | null
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
  startInstall: (
    packId: string,
    uiSuiteId?: string | null,
  ) => Promise<OperationResult<InstallSummary>>
  cancelInstall: () => Promise<void>
  setPackEnabled: (packId: string, enabled: boolean) => Promise<OperationResult<PackToggleResult>>
  setModEnabled: (
    packId: string,
    modId: string,
    enabled: boolean,
  ) => Promise<OperationResult<Bootstrap>>
  repairPack: (packId: string) => Promise<OperationResult<PackToggleResult>>
  deletePack: (packId: string) => Promise<OperationResult<DeletePackResult>>
  verify: (packId: string) => Promise<OperationResult<PackHealth>>
  applyHost: (packId: string) => Promise<OperationResult<HostApplyResult>>
  applyUiSuite: (packId: string, uiSuiteId: string) => Promise<OperationResult<Bootstrap>>
  setGamePath: (gamePath: string | null) => Promise<OperationResult<Bootstrap>>
  pickGamePath: () => Promise<string | null>
  setLanguage: (language: Language) => Promise<OperationResult<Bootstrap>>
  setHeapMB: (heapMB: number) => Promise<OperationResult<Bootstrap>>
  applyFpsBoost: (
    preset: PerformancePreset,
    heapMB: number,
  ) => Promise<OperationResult<FpsBoostApplyResult>>
  openPath: (target: string) => Promise<void>
  openLogs: () => Promise<void>
  refreshCatalog: () => Promise<OperationResult<Bootstrap>>
  clearCache: () => Promise<OperationResult<Bootstrap>>
  restartAsAdmin: (pending: PendingAction | null) => Promise<OperationResult<never>>
  consumePendingAction: () => Promise<PendingAction | null>
  onInstallEvent: (callback: (event: EngineEvent) => void) => () => void
}

export const IPC = {
  getBootstrap: 'app:getBootstrap',
  startInstall: 'install:start',
  cancelInstall: 'install:cancel',
  setPackEnabled: 'pack:setEnabled',
  setModEnabled: 'pack:setModEnabled',
  repairPack: 'pack:repair',
  deletePack: 'pack:delete',
  verify: 'pack:verify',
  applyHost: 'host:apply',
  applyUiSuite: 'pack:applyUiSuite',
  setGamePath: 'settings:setGamePath',
  pickGamePath: 'settings:pickGamePath',
  setLanguage: 'settings:setLanguage',
  setHeapMB: 'settings:setHeapMB',
  applyFpsBoost: 'settings:applyFpsBoost',
  openPath: 'app:openPath',
  openLogs: 'app:openLogs',
  refreshCatalog: 'app:refreshCatalog',
  clearCache: 'app:clearCache',
  restartAsAdmin: 'app:restartAsAdmin',
  consumePendingAction: 'app:consumePendingAction',
  installEvent: 'install:event',
} as const

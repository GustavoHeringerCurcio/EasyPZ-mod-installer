import path from 'node:path'
import type { Catalog } from '@easypz/catalog'
import {
  getActiveModIdsForSuite,
  getEffectiveMods,
  getEffectiveModsForSuite,
  getPack,
  getUiSuite,
  getWorkshopIdsForSuite,
  resolveUiSuiteId,
} from '@easypz/catalog'
import type { AppPaths } from './paths.js'
import { hostIniPath, modsDir } from './paths.js'
import { getGameInfo, isGameRunning } from './detect.js'
import { sortModIdsForLoadOrder, updateDefaultTxt } from './activation.js'
import { applyHostIni, type HostApplyResult } from './host.js'
import { applyGameConfig } from './gameConfig.js'
import { isZombieBuddyInstalled } from './zombiebuddy.js'
import { verifyMods, type PackHealth } from './verify.js'
import { ensureUiSuiteMods } from './uiSuite.js'
import type { EventSink } from './events.js'
import { EasyPzError } from './errors.js'
import {
  clearPackInstall,
  loadState,
  recordInstall,
  saveState,
  setActivePack,
  type AppState,
} from './state.js'
import {
  activationEntriesForMods,
  assertPackAvailable,
  deactivationEntriesForMods,
  deletePackStorage,
  detectActivePackId,
  getPackStorageMods,
  runMoveTransaction,
} from './storage.js'

function allPackClientIds(catalog: Catalog, state: AppState): string[] {
  const ids = new Set<string>()
  for (const pack of catalog.packs) {
    const install = state.installs[pack.id]
    if (install) {
      for (const mod of install.mods) {
        if (!mod.serverOnly) ids.add(mod.id)
      }
      continue
    }
    for (const id of getActiveModIdsForSuite(catalog, pack.id, false, null)) ids.add(id)
  }
  return [...ids]
}

export interface PackToggleResult {
  activePackId: string | null
  modCount: number
  previousPackId: string | null
}

export async function setPackEnabled(options: {
  catalog: Catalog
  packId: string
  paths: AppPaths
  enabled: boolean
  signal?: AbortSignal
  onEvent?: EventSink
  skipGameCheck?: boolean
}): Promise<PackToggleResult> {
  const { catalog, packId, paths, enabled, signal, onEvent, skipGameCheck } = options

  if (!skipGameCheck && (await isGameRunning())) {
    throw new EasyPzError(
      'GAME_RUNNING',
      'Close Project Zomboid before changing the active modpack.',
    )
  }

  const state = await loadState(paths, { catalog, migrate: true })
  const previousPackId = state.activePackId
  const allIds = allPackClientIds(catalog, state)
  const targetMods = await getPackStorageMods(catalog, packId, paths, state)
  const targetIds = targetMods.filter((mod) => !mod.serverOnly).map((mod) => mod.id)
  const duplicateRoot = path.join(paths.backupDir, 'easypz-duplicates')

  if (enabled) {
    await assertPackAvailable(catalog, packId, paths, state)

    const previousMods =
      previousPackId && previousPackId !== packId
        ? await getPackStorageMods(catalog, previousPackId, paths, state)
        : []

    const entries = [
      ...deactivationEntriesForMods(previousMods, paths),
      ...activationEntriesForMods(targetMods, paths),
    ]

    await runMoveTransaction(
      entries,
      paths.journalFile,
      {
        signal,
        duplicateRoot,
        onMove: (_entry, index, total) => {
          onEvent?.({
            type: 'log',
            level: 'info',
            message: `Preparing mod ${index}/${total}...`,
          })
        },
      },
      async () => {
        await updateDefaultTxt({
          addIds: targetIds,
          removeIds: allIds,
          modsDir: modsDir(paths),
          backupDir: paths.backupDir,
        })
        await saveState(paths, setActivePack(state, packId))
      },
    )

    onEvent?.({
      type: 'log',
      level: 'info',
      message: `Activated ${getPack(catalog, packId).name}: ${targetIds.length} client mods.`,
    })

    return { activePackId: packId, modCount: targetIds.length, previousPackId }
  }

  if (previousPackId !== packId) {
    return { activePackId: previousPackId, modCount: 0, previousPackId }
  }

  await runMoveTransaction(
    deactivationEntriesForMods(targetMods, paths),
    paths.journalFile,
    { signal, duplicateRoot },
    async () => {
      await updateDefaultTxt({
        addIds: [],
        removeIds: allIds,
        modsDir: modsDir(paths),
        backupDir: paths.backupDir,
      })
      await saveState(paths, setActivePack(state, null))
    },
  )

  onEvent?.({
    type: 'log',
    level: 'info',
    message: `Disabled ${getPack(catalog, packId).name}. Its files stay in EasyPZ storage.`,
  })

  return { activePackId: null, modCount: 0, previousPackId }
}

function suiteAddIds(catalog: Catalog): Set<string> {
  return new Set((catalog.uiSuites ?? []).flatMap((suite) => suite.add.map((mod) => mod.id)))
}

function dedupeMods(
  mods: Array<{
    id: string
    name: string
    folder: string
    workshopId: string
    serverOnly: boolean
  }>,
) {
  const seen = new Set<string>()
  return mods.filter((mod) => {
    const key = `${mod.workshopId}:${mod.folder}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function applyUiSuite(options: {
  catalog: Catalog
  packId: string
  suiteId: string
  paths: AppPaths
  gamePathOverride?: string | null
  signal?: AbortSignal
  onEvent?: EventSink
}): Promise<PackToggleResult> {
  const { catalog, packId, suiteId, paths, signal, onEvent } = options
  if (await isGameRunning()) {
    throw new EasyPzError('GAME_RUNNING', 'Close Project Zomboid before changing the UI suite.')
  }

  const suite = getUiSuite(catalog, suiteId)
  if (!suite) throw new EasyPzError('IO', `Unknown UI suite: ${suiteId}`)

  const state = await loadState(paths, { catalog, migrate: true })
  const install = state.installs[packId]
  if (!install)
    throw new EasyPzError('MISSING_MODS', 'Install the pack before changing its UI suite.')

  const game = await getGameInfo(paths, { gamePathOverride: options.gamePathOverride })
  if (suite.items.length > 0 && !game.workshopRoot) {
    throw new EasyPzError('GAME_NOT_FOUND', 'The Steam Workshop folder could not be found.')
  }

  const suiteMods = game.workshopRoot
    ? await ensureUiSuiteMods({
        catalog,
        packId,
        suiteId,
        paths,
        workshopRoot: game.workshopRoot,
        signal,
        onEvent,
      })
    : { mods: [], downloadedItems: 0, cachedItems: 0, downloadedBytes: 0, failedItems: [] }

  const pack = getPack(catalog, packId)
  const allAddIds = suiteAddIds(catalog)
  const base =
    pack.source === 'workshop'
      ? (install.allMods.length > 0 ? install.allMods : install.mods).filter(
          (mod) => !allAddIds.has(mod.id),
        )
      : getEffectiveMods(catalog, packId).map((mod) => ({
          id: mod.id,
          name: mod.name,
          folder: mod.folder,
          workshopId: mod.workshopId,
          serverOnly: mod.serverOnly,
        }))
  const removed = new Set(suite.remove)
  const allMods = dedupeMods([...base, ...suiteMods.mods])
  const nextMods = allMods.filter((mod) => !removed.has(mod.id))
  if (nextMods.length === 0) {
    throw new EasyPzError('MISSING_MODS', `The ${suite.name} suite produced no installable mods.`)
  }

  const wasActive = state.activePackId === packId
  if (wasActive) {
    await setPackEnabled({
      catalog,
      packId,
      paths,
      enabled: false,
      signal,
      onEvent,
      skipGameCheck: true,
    })
  }

  const current = await loadState(paths, { catalog, migrate: true })
  const nextState = recordInstall(current, catalog, packId, {
    mods: nextMods,
    allMods,
    uiSuiteId: suite.id,
  })
  await saveState(paths, { ...nextState, activePackId: current.activePackId })

  if (wasActive) {
    const result = await setPackEnabled({
      catalog,
      packId,
      paths,
      enabled: true,
      signal,
      onEvent,
      skipGameCheck: true,
    })
    onEvent?.({
      type: 'log',
      level: 'info',
      message: `UI suite changed to ${suite.name}: ${result.modCount} client mods.`,
    })
    return result
  }

  onEvent?.({
    type: 'log',
    level: 'info',
    message: `UI suite saved for ${getPack(catalog, packId).name}: ${suite.name}.`,
  })
  return { activePackId: null, modCount: 0, previousPackId: null }
}
export async function activateInstalledPack(options: {
  catalog: Catalog
  packId: string
  paths: AppPaths
  onEvent?: EventSink
}): Promise<PackToggleResult> {
  return setPackEnabled({ ...options, enabled: true })
}

export interface DeletePackResult {
  removedFolders: number
  sharedFolders: number
  failedFolders: string[]
  disabled: boolean
}

function logDeleteTiming(onEvent: EventSink | undefined, label: string, start: number): void {
  onEvent?.({
    type: 'log',
    level: 'info',
    message: `[delete] ${label}: ${Date.now() - start}ms`,
  })
}

export async function deletePack(options: {
  catalog: Catalog
  packId: string
  paths: AppPaths
  onEvent?: EventSink
  skipGameCheck?: boolean
}): Promise<DeletePackResult> {
  const { catalog, packId, paths, onEvent, skipGameCheck } = options
  if (!skipGameCheck && (await isGameRunning())) {
    throw new EasyPzError('GAME_RUNNING', 'Close Project Zomboid before deleting mods.')
  }

  const started = Date.now()
  let phaseStart = started
  let state = await loadState(paths, { catalog, migrate: true })
  logDeleteTiming(onEvent, 'load state', phaseStart)

  const install = state.installs[packId]
  let disabled = false

  if (state.activePackId === packId) {
    phaseStart = Date.now()
    const activeMods =
      install && install.mods.length > 0
        ? install.mods
        : install && install.allMods.length > 0
          ? install.allMods
          : getPack(catalog, packId).source === 'workshop'
            ? []
            : getEffectiveMods(catalog, packId)
    const clientIds = [...new Set(activeMods.filter((mod) => !mod.serverOnly).map((mod) => mod.id))]

    await updateDefaultTxt({
      addIds: [],
      removeIds: clientIds,
      modsDir: modsDir(paths),
      backupDir: paths.backupDir,
    })
    state = setActivePack(state, null)
    await saveState(paths, state)
    disabled = true
    logDeleteTiming(onEvent, 'clear active state', phaseStart)
  }

  phaseStart = Date.now()
  const result = await deletePackStorage({
    catalog,
    packId,
    paths,
    state,
    onEvent,
  })
  logDeleteTiming(onEvent, 'delete folders', phaseStart)

  phaseStart = Date.now()
  await saveState(paths, clearPackInstall(state, packId))
  if (result.failedFolders.length > 0) {
    onEvent?.({
      type: 'warning',
      message: `${result.failedFolders.length} folder(s) could not be deleted and may remain on disk.`,
    })
  }
  logDeleteTiming(onEvent, 'save state', phaseStart)
  logDeleteTiming(onEvent, 'total', started)

  onEvent?.({
    type: 'log',
    level: 'info',
    message: `Deleted ${result.removed} mod folder(s); kept ${result.keptShared} shared folder(s)${
      result.failedFolders.length > 0 ? `; ${result.failedFolders.length} failed` : ''
    }.`,
  })

  return {
    removedFolders: result.removed,
    sharedFolders: result.keptShared,
    failedFolders: result.failedFolders,
    disabled,
  }
}

export async function repairPack(options: {
  catalog: Catalog
  packId: string
  paths: AppPaths
  gamePathOverride?: string | null
  heapMB?: number | null
  onEvent?: EventSink
}): Promise<PackToggleResult> {
  const { catalog, packId, paths, gamePathOverride, onEvent } = options
  if (await isGameRunning()) {
    throw new EasyPzError('GAME_RUNNING', 'Close Project Zomboid before repairing a pack.')
  }

  await assertPackAvailable(catalog, packId, paths)
  const toggle = await setPackEnabled({
    catalog,
    packId,
    paths,
    enabled: true,
    onEvent,
    skipGameCheck: true,
  })

  const game = await getGameInfo(paths, { gamePathOverride })
  if (game.pzPath) {
    await applyGameConfig({
      pzPath: game.pzPath,
      zomboidDir: paths.zomboidDir,
      heapMB: options.heapMB ?? game.recommendedHeapMB,
      zombieBuddyInstalled: await isZombieBuddyInstalled(game.pzPath),
    })
  }

  onEvent?.({
    type: 'log',
    level: 'info',
    message: `Repaired ${getPack(catalog, packId).name} from the local pack store.`,
  })

  return toggle
}

export async function applyHostForPack(options: {
  catalog: Catalog
  packId: string
  paths: AppPaths
  onEvent?: EventSink
}): Promise<HostApplyResult> {
  const { catalog, packId, paths, onEvent } = options
  if (await isGameRunning()) {
    throw new EasyPzError('GAME_RUNNING', 'Close Project Zomboid before updating the host.')
  }

  const state = await loadState(paths, { catalog, migrate: true })
  const pack = getPack(catalog, packId)
  const suiteId = resolveUiSuiteId(catalog, state.installs[packId]?.uiSuiteId)
  const mods = await getPackStorageMods(catalog, packId, paths, state)
  const modIds = sortModIdsForLoadOrder(mods.map((mod) => mod.id))
  const workshopIds = getWorkshopIdsForSuite(catalog, packId, suiteId)
  const result = await applyHostIni({
    iniPath: hostIniPath(paths),
    modIds,
    workshopIds,
    backupDir: paths.backupDir,
  })

  onEvent?.({
    type: 'log',
    level: result.updated ? 'info' : 'warn',
    message: result.updated
      ? `Host updated with ${result.modCount} mods.`
      : (result.reason ?? 'Host was not updated.'),
  })

  return result
}

export async function getPackHealth(options: {
  catalog: Catalog
  packId: string
  paths: AppPaths
  gamePathOverride?: string | null
}): Promise<PackHealth> {
  const game = await getGameInfo(options.paths, {
    gamePathOverride: options.gamePathOverride,
  })
  const state = await loadState(options.paths, { catalog: options.catalog, migrate: true })
  const pack = getPack(options.catalog, options.packId)

  const suiteId = resolveUiSuiteId(options.catalog, state.installs[pack.id]?.uiSuiteId)
  const installed = state.installs[pack.id]?.mods
  const mods = (
    installed ??
    getEffectiveModsForSuite(options.catalog, pack.id, suiteId).map((mod) => ({
      id: mod.id,
      name: mod.name,
      folder: mod.folder,
      workshopId: mod.workshopId,
      serverOnly: mod.serverOnly,
    }))
  ).map((mod) => ({
    ...mod,
    group: pack.source === 'workshop' ? 'Workshop' : 'Pack',
  }))

  return verifyMods({
    packId: pack.id,
    mods,
    paths: options.paths,
    pzPath: game.pzPath,
    hostIniPath: hostIniPath(options.paths),
  })
}

export async function reconcileActivePack(options: {
  catalog: Catalog
  paths: AppPaths
  onEvent?: EventSink
}): Promise<AppState> {
  const { catalog, paths, onEvent } = options
  const state = await loadState(paths, { catalog, migrate: true })
  const activePackId = await detectActivePackId(catalog, paths, state)
  const activeMods = activePackId
    ? await getPackStorageMods(catalog, activePackId, paths, state)
    : []
  const addIds = activeMods.filter((mod) => !mod.serverOnly).map((mod) => mod.id)

  await updateDefaultTxt({
    addIds,
    removeIds: allPackClientIds(catalog, state),
    modsDir: modsDir(paths),
    backupDir: paths.backupDir,
  })

  const next = setActivePack(state, activePackId)
  await saveState(paths, next)
  onEvent?.({
    type: 'log',
    level: 'info',
    message: activePackId
      ? `Recovered active pack: ${getPack(catalog, activePackId).name}.`
      : 'Recovered a disabled mod state.',
  })
  return next
}

export function getStateActivePack(state: AppState): string | null {
  return state.activePackId
}

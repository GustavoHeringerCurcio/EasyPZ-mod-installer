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
import { EasyPzError, cancelledError } from './errors.js'
import {
  clearPackInstall,
  getDisabledModIds,
  loadState,
  recordInstall,
  saveState,
  setActivePack,
  setPackDisabledModIds,
  type AppState,
} from './state.js'
import {
  activationEntriesForMods,
  assertPackAvailable,
  deactivationEntriesForMods,
  deletePackStorage,
  detectActivePackId,
  getPackStorageMods,
  modIsActive,
  runMoveTransaction,
  type StorageMod,
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
  suiteId?: string | null
  deactivationMods?: StorageMod[]
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
  const targetMods = await getPackStorageMods(catalog, packId, paths, state, options.suiteId)
  const disabled = getDisabledModIds(state, packId)
  const targetIds = targetMods
    .filter((mod) => !mod.serverOnly && !disabled.has(mod.id))
    .map((mod) => mod.id)
  const deactivationRemoveIds = (options.deactivationMods ?? []).map((mod) => mod.id)
  const duplicateRoot = path.join(paths.backupDir, 'easypz-duplicates')

  if (enabled) {
    await assertPackAvailable(catalog, packId, paths, state)

    const previousMods =
      previousPackId && previousPackId !== packId
        ? await getPackStorageMods(catalog, previousPackId, paths, state)
        : []

    const entries = [
      ...deactivationEntriesForMods(options.deactivationMods ?? previousMods, paths),
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
          removeIds: [...allIds, ...deactivationRemoveIds],
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
    deactivationEntriesForMods(options.deactivationMods ?? targetMods, paths),
    paths.journalFile,
    { signal, duplicateRoot },
    async () => {
      await updateDefaultTxt({
        addIds: [],
        removeIds: [...allIds, ...deactivationRemoveIds],
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

export interface ModToggleResult {
  packId: string
  modId: string
  enabled: boolean
  activePackId: string | null
  enabledClientCount: number
}

/**
 * Enables or disables a single mod inside an installed pack.
 *
 * The mod folder is never moved. For an active pack the mod ID is added to or
 * removed from `default.txt`, which is what Project Zomboid uses to decide
 * whether a mod loads. Inactive packs store the preference only.
 */
export async function setModEnabled(options: {
  catalog: Catalog
  packId: string
  modId: string
  enabled: boolean
  paths: AppPaths
  signal?: AbortSignal
  onEvent?: EventSink
  skipGameCheck?: boolean
}): Promise<ModToggleResult> {
  const { catalog, packId, modId, enabled, paths, signal, onEvent, skipGameCheck } = options

  if (!skipGameCheck && (await isGameRunning())) {
    throw new EasyPzError('GAME_RUNNING', 'Close Project Zomboid before changing mods.')
  }

  const state = await loadState(paths, { catalog, migrate: true })
  const install = state.installs[packId]
  if (!install) {
    throw new EasyPzError('MISSING_MODS', 'Install the pack before changing its mods.')
  }

  const mod = install.mods.find((candidate) => candidate.id === modId)
  if (!mod) {
    throw new EasyPzError('MISSING_MODS', `${modId} is not part of this pack.`)
  }

  const isActive = state.activePackId === packId
  if (enabled && isActive && !mod.serverOnly && !(await modIsActive(paths, mod.folder))) {
    throw new EasyPzError(
      'MISSING_MODS',
      `${mod.name} files are missing. Repair the pack before enabling it.`,
    )
  }

  const disabled = getDisabledModIds(state, packId)
  if (enabled) disabled.delete(modId)
  else disabled.add(modId)

  if (isActive && !mod.serverOnly) {
    if (signal?.aborted) throw cancelledError()
    await updateDefaultTxt({
      addIds: enabled ? [modId] : [],
      removeIds: enabled ? [] : [modId],
      modsDir: modsDir(paths),
      backupDir: paths.backupDir,
    })
  }

  await saveState(paths, setPackDisabledModIds(state, packId, [...disabled]))

  const enabledClientCount = install.mods.filter(
    (candidate) => !candidate.serverOnly && !disabled.has(candidate.id),
  ).length

  onEvent?.({
    type: 'log',
    level: 'info',
    message: `${enabled ? 'Enabled' : 'Disabled'} ${mod.name} in ${getPack(catalog, packId).name}${
      isActive ? '' : ' (applies when the pack is enabled)'
    }.`,
  })

  return {
    packId,
    modId,
    enabled,
    activePackId: state.activePackId,
    enabledClientCount,
  }
}

function suiteAddIds(catalog: Catalog): Set<string> {
  return new Set((catalog.uiSuites ?? []).flatMap((suite) => suite.add.map((mod) => mod.id)))
}

export function dedupeMods(mods: StorageMod[]): StorageMod[] {
  const seen = new Set<string>()
  return mods.filter((mod) => {
    const key = `${mod.workshopId}:${mod.folder}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Collects every mod that can belong to a pack for any UI suite. Used to clean
 * stale folders left behind by an interrupted or incorrect suite switch.
 */
export function suiteManagedMods(
  catalog: Catalog,
  packId: string,
  install: AppState['installs'][string] | undefined,
): StorageMod[] {
  const candidates: StorageMod[] = [
    ...getEffectiveMods(catalog, packId).map((mod) => ({
      id: mod.id,
      name: mod.name,
      folder: mod.folder,
      workshopId: mod.workshopId,
      serverOnly: mod.serverOnly,
    })),
    ...(install?.mods ?? []),
    ...(install?.allMods ?? []),
    ...(catalog.uiSuites ?? []).flatMap((suite) => suite.add),
  ]
  return dedupeMods(candidates)
}

async function findPhysicallyActiveMods(
  paths: AppPaths,
  mods: StorageMod[],
): Promise<StorageMod[]> {
  const active: StorageMod[] = []
  for (const mod of mods) {
    if (await modIsActive(paths, mod.folder)) active.push(mod)
  }
  return active
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

  const staleActive = await findPhysicallyActiveMods(
    paths,
    suiteManagedMods(catalog, packId, install),
  )
  // Never touch files when another pack is the active one: shared base folders
  // would otherwise look like stale files belonging to this pack.
  const wasActive =
    state.activePackId === packId || (state.activePackId === null && staleActive.length > 0)
  const previous = {
    mods: install.mods,
    allMods: install.allMods,
    uiSuiteId: install.uiSuiteId,
    disabledModIds: install.disabledModIds,
  }

  try {
    if (wasActive) {
      await setPackEnabled({
        catalog,
        packId,
        paths,
        enabled: false,
        suiteId: install.uiSuiteId,
        deactivationMods: staleActive,
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
      disabledModIds: install.disabledModIds,
    })
    await saveState(paths, { ...nextState, activePackId: current.activePackId })

    if (wasActive) {
      const result = await setPackEnabled({
        catalog,
        packId,
        paths,
        enabled: true,
        suiteId: suite.id,
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
    return { activePackId: current.activePackId, modCount: 0, previousPackId: null }
  } catch (error) {
    try {
      const current = await loadState(paths, { catalog, migrate: true })
      const restored = recordInstall(current, catalog, packId, {
        mods: previous.mods,
        allMods: previous.allMods,
        uiSuiteId: previous.uiSuiteId,
        disabledModIds: previous.disabledModIds,
      })
      await saveState(paths, { ...restored, activePackId: current.activePackId })
      if (wasActive) {
        await setPackEnabled({
          catalog,
          packId,
          paths,
          enabled: true,
          suiteId: previous.uiSuiteId,
          signal,
          onEvent,
          skipGameCheck: true,
        })
      }
    } catch {
      // Keep the original failure; the user can repair or retry.
    }
    throw error
  }
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

  const pack = getPack(catalog, packId)
  if (pack.source === 'workshop') {
    const state = await loadState(paths, { catalog, migrate: true })
    const previousPackId = state.activePackId
    const suiteId = state.installs[packId]?.uiSuiteId ?? null
    const { installPack } = await import('./install.js')
    const summary = await installPack({
      catalog,
      packId,
      paths,
      uiSuiteId: suiteId,
      gamePathOverride,
      heapMB: options.heapMB,
      onEvent,
    })
    const nextState = await loadState(paths, { catalog, migrate: true })
    return {
      activePackId: nextState.activePackId,
      modCount: summary.clientMods,
      previousPackId,
    }
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
  skipGameCheck?: boolean
}): Promise<HostApplyResult> {
  const { catalog, packId, paths, onEvent } = options
  if (!options.skipGameCheck && (await isGameRunning())) {
    throw new EasyPzError('GAME_RUNNING', 'Close Project Zomboid before updating the host.')
  }

  const state = await loadState(paths, { catalog, migrate: true })
  const install = state.installs[packId]
  const suiteId = resolveUiSuiteId(catalog, install?.uiSuiteId)
  const disabled = getDisabledModIds(state, packId)
  const mods = (await getPackStorageMods(catalog, packId, paths, state)).filter(
    (mod) => !disabled.has(mod.id),
  )
  const modIds = sortModIdsForLoadOrder(mods.map((mod) => mod.id))
  const installedMods = install?.allMods.length ? install.allMods : (install?.mods ?? [])
  const workshopAvailability = new Map<string, boolean>()
  for (const mod of installedMods) {
    const enabled = workshopAvailability.get(mod.workshopId) ?? false
    workshopAvailability.set(mod.workshopId, enabled || !disabled.has(mod.id))
  }
  const disabledWorkshopIds = new Set(
    [...workshopAvailability]
      .filter(([, hasEnabledMod]) => !hasEnabledMod)
      .map(([workshopId]) => workshopId),
  )
  const workshopIds = getWorkshopIdsForSuite(catalog, packId, suiteId).filter(
    (id) => !disabledWorkshopIds.has(id),
  )
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
  const disabledModIds = getDisabledModIds(state, pack.id)
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
    disabledModIds,
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
  const disabled = activePackId ? getDisabledModIds(state, activePackId) : new Set<string>()
  const addIds = activeMods
    .filter((mod) => !mod.serverOnly && !disabled.has(mod.id))
    .map((mod) => mod.id)

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

import path from 'node:path'
import type { Catalog } from '@easypz/catalog'
import { getActiveModIds, getPack } from '@easypz/catalog'
import type { AppPaths } from './paths.js'
import { hostIniPath, modsDir } from './paths.js'
import { getGameInfo, isGameRunning } from './detect.js'
import { sortModIdsForLoadOrder, updateDefaultTxt } from './activation.js'
import { applyHostIni, type HostApplyResult } from './host.js'
import { applyGameConfig } from './gameConfig.js'
import { isZombieBuddyInstalled } from './zombiebuddy.js'
import { verifyMods, verifyPack, type PackHealth } from './verify.js'
import type { EventSink } from './events.js'
import { EasyPzError } from './errors.js'
import { clearPackInstall, loadState, saveState, setActivePack, type AppState } from './state.js'
import {
  activationEntriesForMods,
  assertPackAvailable,
  deactivationEntriesForMods,
  deletePackStorage,
  detectActivePackId,
  getAvailablePackIds,
  getPackStorageMods,
  runMoveTransaction,
} from './storage.js'

function allPackClientIds(catalog: Catalog, state: AppState): string[] {
  const ids = new Set<string>()
  for (const pack of catalog.packs) {
    if (pack.source === 'workshop') {
      for (const mod of state.installs[pack.id]?.mods ?? []) {
        if (!mod.serverOnly) ids.add(mod.id)
      }
      continue
    }
    for (const id of getActiveModIds(catalog, pack.id, false)) ids.add(id)
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
  disabled: boolean
}

export async function deletePack(options: {
  catalog: Catalog
  packId: string
  paths: AppPaths
  signal?: AbortSignal
  onEvent?: EventSink
  skipGameCheck?: boolean
}): Promise<DeletePackResult> {
  const { catalog, packId, paths, signal, onEvent, skipGameCheck } = options
  if (!skipGameCheck && (await isGameRunning())) {
    throw new EasyPzError('GAME_RUNNING', 'Close Project Zomboid before deleting mods.')
  }

  let state = await loadState(paths, { catalog, migrate: true })
  let disabled = false

  if (state.activePackId === packId) {
    await setPackEnabled({
      catalog,
      packId,
      paths,
      enabled: false,
      signal,
      onEvent,
      skipGameCheck: true,
    })
    disabled = true
    state = await loadState(paths, { catalog, migrate: true })
  }

  const available = await getAvailablePackIds(catalog, paths, state)
  const otherAvailable = available.filter((id) => id !== packId)
  const result = await deletePackStorage({
    catalog,
    packId,
    paths,
    otherAvailablePackIds: otherAvailable,
    state,
  })

  await saveState(paths, clearPackInstall(state, packId))

  onEvent?.({
    type: 'log',
    level: 'info',
    message: `Deleted ${result.removed} mod folder(s); kept ${result.keptShared} shared folder(s).`,
  })

  return {
    removedFolders: result.removed,
    sharedFolders: result.keptShared,
    disabled,
  }
}

export async function repairPack(options: {
  catalog: Catalog
  packId: string
  paths: AppPaths
  gamePathOverride?: string | null
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
      heapMB: game.recommendedHeapMB,
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
  const mods = await getPackStorageMods(catalog, packId, paths, state)
  const modIds = sortModIdsForLoadOrder(mods.map((mod) => mod.id))
  const workshopIds =
    pack.source === 'workshop' ? (pack.workshop?.items.map((item) => item.id) ?? []) : []
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

  if (pack.source === 'workshop') {
    const mods = (state.installs[pack.id]?.mods ?? []).map((mod) => ({
      ...mod,
      group: 'Workshop',
    }))
    return verifyMods({
      packId: pack.id,
      mods,
      paths: options.paths,
      pzPath: game.pzPath,
      hostIniPath: hostIniPath(options.paths),
    })
  }

  return verifyPack({
    catalog: options.catalog,
    packId: options.packId,
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

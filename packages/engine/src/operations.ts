import fs from 'node:fs/promises'
import path from 'node:path'
import type { Catalog } from '@easypz/catalog'
import { getActiveModIds, getManagedFolders, getPack } from '@easypz/catalog'
import type { AppPaths } from './paths.js'
import { hostIniPath, modsDir } from './paths.js'
import { getGameInfo } from './detect.js'
import { isGameRunning } from './detect.js'
import { movePath } from './apply.js'
import { clearDefaultTxt, writeDefaultTxt } from './activation.js'
import { applyHostIni, type HostApplyResult } from './host.js'
import { verifyPack, type PackHealth } from './verify.js'
import type { EventSink } from './events.js'
import { EasyPzError, cancelledError, toError } from './errors.js'
import { clearPackInstall, loadState, saveState, setActivePack, type AppState } from './state.js'

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function ensureNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError()
}

export async function activateInstalledPack(options: {
  catalog: Catalog
  packId: string
  paths: AppPaths
  onEvent?: EventSink
}): Promise<{ modCount: number; backupPath: string | null }> {
  const { catalog, packId, paths, onEvent } = options
  if (await isGameRunning()) {
    throw new EasyPzError('GAME_RUNNING', 'Close Project Zomboid before activating mods.')
  }

  const health = await verifyPack({
    catalog,
    packId,
    modsDir: modsDir(paths),
    pzPath: null,
    hostIniPath: hostIniPath(paths),
  })

  const missing = health.rows.filter((row) => !row.installed && !row.serverOnly)
  if (missing.length > 0) {
    throw new EasyPzError(
      'MISSING_MODS',
      `Cannot activate ${packId}: ${missing.length} mod(s) are missing. Run Install or Repair.`,
    )
  }

  const modIds = getActiveModIds(catalog, packId, false)
  const result = await writeDefaultTxt({
    modIds,
    modsDir: modsDir(paths),
    backupDir: paths.backupDir,
  })

  const state = await loadState(paths, { catalog, migrate: true })
  await saveState(paths, setActivePack(state, packId))

  onEvent?.({
    type: 'log',
    level: 'info',
    message: `Activated ${getPack(catalog, packId).name}: ${result.modCount} client mods.`,
  })
  return result
}

export interface DeactivateResult {
  removed: number
  purged: boolean
  backupRoot: string | null
}

export async function deactivatePack(options: {
  catalog: Catalog
  packId: string
  paths: AppPaths
  purge?: boolean
  signal?: AbortSignal
  onEvent?: EventSink
}): Promise<DeactivateResult> {
  const { catalog, packId, paths, purge, signal, onEvent } = options
  if (await isGameRunning()) {
    throw new EasyPzError('GAME_RUNNING', 'Close Project Zomboid before deactivating mods.')
  }

  const state = await loadState(paths, { catalog, migrate: true })
  const folders = state.installs[packId]?.managedFolders ?? getManagedFolders(catalog, packId)
  const targetRoot = purge ? null : path.join(paths.backupDir, `easypz-removed-${timestamp()}`)
  let removed = 0

  if (targetRoot) await fs.mkdir(targetRoot, { recursive: true })

  for (const folder of folders) {
    ensureNotCancelled(signal)
    const source = path.join(modsDir(paths), folder)
    try {
      await fs.access(source)
    } catch {
      continue
    }

    try {
      if (purge) {
        await fs.rm(source, { recursive: true, force: true })
      } else {
        await movePath(source, path.join(targetRoot!, folder))
      }
      removed += 1
    } catch (error) {
      throw new EasyPzError(
        'IO',
        `Could not ${purge ? 'delete' : 'move'} ${folder}: ${toError(error).message}`,
        { cause: toError(error) },
      )
    }
  }

  await clearDefaultTxt({ modsDir: modsDir(paths), backupDir: paths.backupDir })
  await saveState(paths, clearPackInstall(state, packId))

  onEvent?.({
    type: 'log',
    level: 'info',
    message: purge
      ? `Deleted ${removed} mod folder(s).`
      : `Moved ${removed} mod folder(s) to backup: ${targetRoot}`,
  })

  return { removed, purged: Boolean(purge), backupRoot: targetRoot }
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

  const modIds = getActiveModIds(catalog, packId, true)
  const result = await applyHostIni({
    iniPath: hostIniPath(paths),
    modIds,
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

  return verifyPack({
    catalog: options.catalog,
    packId: options.packId,
    modsDir: modsDir(options.paths),
    pzPath: game.pzPath,
    hostIniPath: hostIniPath(options.paths),
  })
}

export function getStateActivePack(state: AppState): string | null {
  return state.activePackId
}

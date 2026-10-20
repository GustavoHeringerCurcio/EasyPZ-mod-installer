import fs from 'node:fs/promises'
import path from 'node:path'
import type { Catalog } from '@easypz/catalog'
import { getActiveModIds, getPack } from '@easypz/catalog'
import type { AppPaths } from './paths.js'
import { modsDir, hostIniPath, defaultTxtPath } from './paths.js'
import { getGameInfo, type GameInfo } from './detect.js'
import { downloadFile, fileExists, hashFile } from './download.js'
import { extractArchive, extractCacheComplete } from './archive.js'
import { applyMods, removeModsNotInPack } from './apply.js'
import { writeDefaultTxt } from './activation.js'
import { applyHostIni } from './host.js'
import { applyGameConfig } from './gameConfig.js'
import { ensureZombieBuddy, isZombieBuddyInstalled, type ZombieBuddyStatus } from './zombiebuddy.js'
import type { EngineEvent, EventSink, InstallSummary } from './events.js'
import { EasyPzError, cancelledError, isEasyPzError, toError } from './errors.js'
import { loadState, recordInstall, saveState } from './state.js'

export interface InstallOptions {
  catalog: Catalog
  packId: string
  paths: AppPaths
  gamePathOverride?: string | null
  forceRedownload?: boolean
  forceMods?: boolean
  skipZombieBuddy?: boolean
  skipActivate?: boolean
  skipHost?: boolean
  signal?: AbortSignal
  onEvent?: EventSink
}

function emit(sink: EventSink | undefined, event: EngineEvent): void {
  sink?.(event)
}

function stageEvent(
  sink: EventSink | undefined,
  stageName: Extract<EngineEvent, { type: 'stage' }>['stage'],
  status: 'start' | 'done' | 'skip',
  detail?: string,
): void {
  emit(sink, { type: 'stage', stage: stageName, status, detail })
}

function ensureNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError()
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function resolveArchive(options: {
  paths: AppPaths
  fileName: string
  sha256: string
  force: boolean
}): Promise<{ archivePath: string; source: 'cache' | 'legacy' | 'download' } | null> {
  const { paths, fileName, sha256, force } = options
  const target = path.join(paths.archiveDir, fileName)

  if (!force && (await fileExists(target))) {
    if ((await hashFile(target)) === sha256) {
      return { archivePath: target, source: 'cache' }
    }
    await fs.rm(target, { force: true })
  }

  if (force) await fs.rm(target, { force: true })

  const legacy = path.join(paths.legacyArchiveDir, fileName)
  if (!force && (await fileExists(legacy))) {
    try {
      if ((await hashFile(legacy)) === sha256) {
        return { archivePath: legacy, source: 'legacy' }
      }
    } catch {
      // Ignore unreadable legacy cache.
    }
  }

  return null
}

async function preflight(options: InstallOptions): Promise<{
  game: GameInfo
  pack: ReturnType<typeof getPack>
}> {
  stageEvent(options.onEvent, 'preflight', 'start')

  const game = await getGameInfo(options.paths, {
    gamePathOverride: options.gamePathOverride,
  })

  if (!game.found || !game.pzPath) {
    throw new EasyPzError(
      'GAME_NOT_FOUND',
      game.detectionError ??
        'Project Zomboid was not found. Install it through Steam or choose the game folder in Settings.',
    )
  }

  if (game.gameRunning) {
    throw new EasyPzError('GAME_RUNNING', 'Close Project Zomboid before installing.')
  }

  const pack = getPack(options.catalog, options.packId)

  if (game.freeDiskGB !== null && game.freeDiskGB < pack.archive.requiredDiskGB) {
    throw new EasyPzError(
      'DISK_SPACE',
      `Not enough free space. ${pack.archive.requiredDiskGB} GB required, ${game.freeDiskGB.toFixed(1)} GB available.`,
    )
  }

  await fs.mkdir(options.paths.archiveDir, { recursive: true })
  await fs.mkdir(options.paths.extractRoot, { recursive: true })
  await fs.mkdir(modsDir(options.paths), { recursive: true })
  await fs.mkdir(options.paths.backupDir, { recursive: true })

  stageEvent(options.onEvent, 'preflight', 'done')
  return { game, pack }
}

export async function installPack(options: InstallOptions): Promise<InstallSummary> {
  const { catalog, packId, paths, signal, onEvent } = options
  let summary: InstallSummary | null = null

  try {
    const { game, pack } = await preflight(options)
    const pzPath = game.pzPath
    if (!pzPath) {
      throw new EasyPzError('GAME_NOT_FOUND', 'Project Zomboid was not found.')
    }
    ensureNotCancelled(signal)

    const extractRootForPack = path.join(paths.extractRoot, pack.archive.sha256)
    const cachedExtract = await extractCacheComplete(catalog, packId, extractRootForPack)
    const reusableArchive = await resolveArchive({
      paths,
      fileName: pack.archive.fileName,
      sha256: pack.archive.sha256,
      force: Boolean(options.forceRedownload),
    })

    let archivePath =
      reusableArchive?.archivePath ?? path.join(paths.archiveDir, pack.archive.fileName)
    let downloadedBytes = 0

    stageEvent(onEvent, 'download', 'start')
    if (reusableArchive) {
      const label = reusableArchive.source === 'legacy' ? 'legacy cache' : 'local cache'
      emit(onEvent, {
        type: 'log',
        level: 'info',
        message: `Using ${label} for ${pack.archive.fileName}.`,
      })
      stageEvent(onEvent, 'download', 'skip', `Already cached in the ${label}`)
    } else {
      emit(onEvent, {
        type: 'log',
        level: 'info',
        message: `Downloading ${pack.archive.fileName} (${(pack.archive.sizeBytes / 1024 ** 3).toFixed(1)} GB).`,
      })
      const result = await downloadFile({
        url: pack.archive.url,
        destination: archivePath,
        expectedSha256: pack.archive.sha256,
        expectedSize: pack.archive.sizeBytes,
        signal,
        onProgress: (progress) => {
          emit(onEvent, {
            type: 'progress',
            stage: 'download',
            percent:
              progress.total && progress.total > 0
                ? Math.min(100, (progress.transferred / progress.total) * 100)
                : 0,
            transferred: progress.transferred,
            total: progress.total ?? undefined,
            bytesPerSecond: progress.bytesPerSecond,
            etaSeconds: progress.etaSeconds ?? undefined,
          })
        },
      })
      downloadedBytes = result.downloadedBytes
      stageEvent(onEvent, 'download', 'done')
    }

    ensureNotCancelled(signal)

    stageEvent(onEvent, 'verify', 'start')
    const actual = await hashFile(archivePath)
    if (actual !== pack.archive.sha256) {
      throw new EasyPzError(
        'ARCHIVE_HASH_MISMATCH',
        `Archive hash mismatch. Expected ${pack.archive.sha256}, got ${actual}.`,
      )
    }
    stageEvent(onEvent, 'verify', 'done')

    ensureNotCancelled(signal)

    const extractRoot = extractRootForPack
    stageEvent(onEvent, 'extract', 'start')
    if (cachedExtract && !options.forceRedownload) {
      stageEvent(onEvent, 'extract', 'skip', 'Already extracted')
    } else {
      await fs.rm(extractRoot, { recursive: true, force: true })
      await fs.mkdir(extractRoot, { recursive: true })
      await extractArchive({
        archivePath,
        destination: extractRoot,
        signal,
        onEntry: (entries) => {
          emit(onEvent, {
            type: 'progress',
            stage: 'extract',
            percent: 0,
            transferred: entries,
          })
        },
      })
      if (!(await extractCacheComplete(catalog, packId, extractRoot))) {
        throw new EasyPzError(
          'ARCHIVE_MISSING_MODS',
          'The archive did not contain every mod in this pack. Try downloading it again.',
        )
      }
      stageEvent(onEvent, 'extract', 'done')
    }

    ensureNotCancelled(signal)

    const state = await loadState(paths, { catalog, migrate: true })
    const previousPackId = state.activePackId
    const previousManagedFolders =
      previousPackId && previousPackId !== packId
        ? (state.installs[previousPackId]?.managedFolders ?? [])
        : []

    const backupRoot = path.join(paths.backupDir, `easypz-${timestamp()}`)
    stageEvent(onEvent, 'apply', 'start')

    if (previousManagedFolders.length > 0) {
      const removed = await removeModsNotInPack({
        catalog,
        targetPackId: packId,
        previousManagedFolders,
        modsDir: modsDir(paths),
        backupRoot,
        signal,
        onEvent,
      })
      if (removed.length > 0) {
        emit(onEvent, {
          type: 'log',
          level: 'info',
          message: `Moved ${removed.length} mod(s) from the previous pack to backup.`,
        })
      }
    }

    const applied = await applyMods({
      catalog,
      packId,
      extractRoot,
      modsDir: modsDir(paths),
      backupRoot,
      force: options.forceMods,
      signal,
      onEvent,
    })
    stageEvent(onEvent, 'apply', 'done')
    emit(onEvent, {
      type: 'log',
      level: 'info',
      message: `Mods ready: ${applied.moved} moved, ${applied.kept} kept, ${applied.backedUp} backed up.`,
    })

    ensureNotCancelled(signal)

    let zombieBuddy: ZombieBuddyStatus = 'skipped'
    stageEvent(onEvent, 'zombiebuddy', 'start')
    try {
      zombieBuddy = await ensureZombieBuddy({
        pzPath,
        extractRoot,
        paths,
        skip: Boolean(options.skipZombieBuddy),
      })
      if (zombieBuddy === 'missing-source') {
        emit(onEvent, {
          type: 'warning',
          message:
            'ZombieBuddy files were not found in the archive. Viewpoint may not load until ZombieBuddy is installed.',
        })
        stageEvent(onEvent, 'zombiebuddy', 'skip', 'Files not found in the archive')
      } else {
        stageEvent(onEvent, 'zombiebuddy', zombieBuddy === 'skipped' ? 'skip' : 'done', zombieBuddy)
      }
    } catch (error) {
      emit(onEvent, {
        type: 'warning',
        message: `ZombieBuddy setup failed: ${toError(error).message}`,
      })
      stageEvent(onEvent, 'zombiebuddy', 'skip', 'Failed')
    }

    ensureNotCancelled(signal)

    stageEvent(onEvent, 'configure', 'start')
    const zombieBuddyInstalled =
      zombieBuddy === 'already-installed' ||
      zombieBuddy === 'installed' ||
      (await isZombieBuddyInstalled(pzPath))
    await applyGameConfig({
      pzPath,
      zomboidDir: paths.zomboidDir,
      heapMB: game.recommendedHeapMB,
      zombieBuddyInstalled,
    })
    stageEvent(onEvent, 'configure', 'done', `Heap ${game.recommendedHeapMB} MB`)

    ensureNotCancelled(signal)

    stageEvent(onEvent, 'activate', 'start')
    if (options.skipActivate) {
      stageEvent(onEvent, 'activate', 'skip')
    } else {
      const clientIds = getActiveModIds(catalog, packId, false)
      await writeDefaultTxt({
        modIds: clientIds,
        modsDir: modsDir(paths),
        backupDir: paths.backupDir,
      })
      stageEvent(onEvent, 'activate', 'done', `${clientIds.length} client mods`)
    }

    ensureNotCancelled(signal)

    let hostUpdated = false
    stageEvent(onEvent, 'host', 'start')
    if (options.skipHost) {
      stageEvent(onEvent, 'host', 'skip')
    } else {
      const serverIds = getActiveModIds(catalog, packId, true)
      const hostResult = await applyHostIni({
        iniPath: hostIniPath(paths),
        modIds: serverIds,
        backupDir: paths.backupDir,
      })
      hostUpdated = hostResult.updated
      stageEvent(
        onEvent,
        'host',
        hostResult.updated ? 'done' : 'skip',
        hostResult.reason ?? `${hostResult.modCount} mods`,
      )
    }

    stageEvent(onEvent, 'state', 'start')
    const nextState = recordInstall(state, catalog, packId)
    await saveState(paths, nextState)
    stageEvent(onEvent, 'state', 'done')

    summary = {
      packId,
      clientMods: pack.stats.clientMods,
      serverMods: pack.stats.serverMods,
      workshopItems: pack.stats.workshopCount,
      downloadedBytes,
      installedAt: nextState.installs[packId]?.installedAt ?? new Date().toISOString(),
      zombieBuddy,
      hostUpdated,
    }

    emit(onEvent, { type: 'done', summary })
    return summary
  } catch (error) {
    if (isEasyPzError(error)) {
      emit(onEvent, { type: 'error', code: error.code, message: error.message })
    } else {
      emit(onEvent, { type: 'error', code: 'IO', message: toError(error).message })
    }
    throw error
  }
}

export async function getInstalledModsDir(paths: AppPaths): Promise<string> {
  return modsDir(paths)
}

export function getDefaultTxtPath(paths: AppPaths): string {
  return defaultTxtPath(paths)
}

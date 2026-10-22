import fs from 'node:fs/promises'
import path from 'node:path'
import type { Catalog } from '@easypz/catalog'
import { getDefaultUiSuite, getEffectiveMods, getPack, getUiSuite } from '@easypz/catalog'
import type { AppPaths } from './paths.js'
import { modsDir, defaultTxtPath } from './paths.js'
import { getGameInfo, type GameInfo } from './detect.js'
import { downloadFile, fileExists, hashFile } from './download.js'
import { assertTarComplete, extractArchive, extractCacheComplete } from './archive.js'
import { applyGameConfig } from './gameConfig.js'
import { ensureZombieBuddy, isZombieBuddyInstalled, type ZombieBuddyStatus } from './zombiebuddy.js'
import type { EngineEvent, EventSink, InstallSummary } from './events.js'
import { EasyPzError, cancelledError, isEasyPzError, toError } from './errors.js'
import { loadState, recordInstall, saveState } from './state.js'
import { storePackMods } from './storage.js'
import { setPackEnabled } from './operations.js'
import { downloadWorkshopPack } from './workshop.js'
import { ensureUiSuiteMods } from './uiSuite.js'

export interface InstallOptions {
  catalog: Catalog
  packId: string
  paths: AppPaths
  gamePathOverride?: string | null
  heapMB?: number | null
  forceRedownload?: boolean
  uiSuiteId?: string | null
  skipZombieBuddy?: boolean
  skipActivate?: boolean
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

async function resolveArchive(options: {
  paths: AppPaths
  fileName: string
  sha256: string
  force: boolean
  onEvent?: EventSink
}): Promise<{ archivePath: string; source: 'cache' | 'legacy' | 'download' } | null> {
  const { paths, fileName, sha256, force, onEvent } = options
  const target = path.join(paths.archiveDir, fileName)

  if (!force && (await fileExists(target))) {
    if ((await hashFile(target)) === sha256) {
      try {
        await assertTarComplete(target)
        return { archivePath: target, source: 'cache' }
      } catch {
        emit(onEvent, {
          type: 'warning',
          message: 'Cached pack archive is incomplete; downloading a fresh copy.',
        })
      }
    }
    await fs.rm(target, { force: true })
  }

  if (force) await fs.rm(target, { force: true })

  const legacy = path.join(paths.legacyArchiveDir, fileName)
  if (!force && (await fileExists(legacy))) {
    try {
      if ((await hashFile(legacy)) === sha256) {
        try {
          await assertTarComplete(legacy)
          return { archivePath: legacy, source: 'legacy' }
        } catch {
          emit(onEvent, {
            type: 'warning',
            message: 'Legacy cached pack archive is incomplete; downloading a fresh copy.',
          })
        }
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

  const requiredDiskGB = pack.archive?.requiredDiskGB ?? pack.requirements.freeDiskGB
  if (game.freeDiskGB !== null && game.freeDiskGB < requiredDiskGB) {
    throw new EasyPzError(
      'DISK_SPACE',
      `Not enough free space. ${requiredDiskGB} GB required, ${game.freeDiskGB.toFixed(1)} GB available.`,
    )
  }

  await fs.mkdir(options.paths.archiveDir, { recursive: true })
  await fs.mkdir(options.paths.extractRoot, { recursive: true })
  await fs.mkdir(modsDir(options.paths), { recursive: true })
  await fs.mkdir(options.paths.backupDir, { recursive: true })

  stageEvent(options.onEvent, 'preflight', 'done')
  return { game, pack }
}

async function installWorkshopPack(args: {
  options: InstallOptions
  game: GameInfo
  pack: ReturnType<typeof getPack>
  pzPath: string
}): Promise<InstallSummary> {
  const { options, game, pack, pzPath } = args
  const { catalog, packId, paths, signal, onEvent } = options
  const suiteId =
    getUiSuite(catalog, options.uiSuiteId)?.id ?? getDefaultUiSuite(catalog)?.id ?? null

  if (!pack.workshop) {
    throw new EasyPzError('IO', 'Workshop pack is missing collection metadata.')
  }
  if (!game.workshopRoot) {
    throw new EasyPzError('GAME_NOT_FOUND', 'The Steam Workshop folder could not be found.')
  }

  stageEvent(onEvent, 'download', 'skip', 'Steam Workshop collection')
  stageEvent(onEvent, 'verify', 'skip', 'Steam Workshop collection')
  stageEvent(onEvent, 'extract', 'skip', 'Steam Workshop collection')
  stageEvent(onEvent, 'workshop', 'start')

  let state = await loadState(paths, { catalog, migrate: true })
  let deactivatedForUpdate = false
  if (!options.skipActivate && state.activePackId === packId) {
    await setPackEnabled({
      catalog,
      packId,
      paths,
      enabled: false,
      onEvent,
      skipGameCheck: true,
    })
    deactivatedForUpdate = true
    state = await loadState(paths, { catalog, migrate: true })
  }

  let downloaded: Awaited<ReturnType<typeof downloadWorkshopPack>>
  try {
    downloaded = await downloadWorkshopPack({
      catalog,
      packId,
      paths,
      workshopRoot: game.workshopRoot,
      signal,
      onEvent,
    })
  } catch (error) {
    if (deactivatedForUpdate) {
      try {
        await setPackEnabled({
          catalog,
          packId,
          paths,
          enabled: true,
          onEvent,
          skipGameCheck: true,
        })
      } catch {
        // Keep the original download error; the user can re-enable the old pack.
      }
    }
    throw error
  }

  stageEvent(onEvent, 'workshop', 'done', `${downloaded.mods.length} mods`)

  const suiteMods = await ensureUiSuiteMods({
    catalog,
    packId,
    suiteId,
    paths,
    workshopRoot: game.workshopRoot,
    signal,
    onEvent,
  })
  stageEvent(
    onEvent,
    'ui-suite',
    suiteMods.mods.length > 0 ? 'done' : 'skip',
    suiteMods.mods.length > 0 ? `${suiteMods.mods.length} mods` : undefined,
  )

  const modMap = new Map<string, (typeof downloaded.mods)[number]>()
  for (const mod of [...downloaded.mods, ...suiteMods.mods]) {
    modMap.set(`${mod.workshopId}:${mod.folder}`, mod)
  }
  const allMods = [...modMap.values()]

  if (downloaded.failedItems.length > 0) {
    emit(onEvent, {
      type: 'warning',
      message: `${downloaded.failedItems.length} Workshop item(s) could not be downloaded and were skipped.`,
    })
  }

  ensureNotCancelled(signal)

  let zombieBuddy: ZombieBuddyStatus = 'skipped'
  stageEvent(onEvent, 'zombiebuddy', 'start')
  try {
    zombieBuddy = await ensureZombieBuddy({
      pzPath,
      extractRoot: '',
      paths,
      skip: Boolean(options.skipZombieBuddy),
    })
    stageEvent(onEvent, 'zombiebuddy', zombieBuddy === 'skipped' ? 'skip' : 'done', zombieBuddy)
  } catch (error) {
    emit(onEvent, {
      type: 'warning',
      message: `ZombieBuddy setup failed: ${toError(error).message}`,
    })
    stageEvent(onEvent, 'zombiebuddy', 'skip', 'Failed')
  }

  ensureNotCancelled(signal)

  stageEvent(onEvent, 'configure', 'start')
  await applyGameConfig({
    pzPath,
    zomboidDir: paths.zomboidDir,
    heapMB: options.heapMB ?? game.recommendedHeapMB,
    zombieBuddyInstalled: await isZombieBuddyInstalled(pzPath),
  })
  stageEvent(onEvent, 'configure', 'done', `Heap ${options.heapMB ?? game.recommendedHeapMB} MB`)

  ensureNotCancelled(signal)

  stageEvent(onEvent, 'apply', 'start')
  const installedState = recordInstall(state, catalog, packId, {
    mods: allMods,
    allMods,
    uiSuiteId: suiteId,
  })
  await saveState(paths, { ...installedState, activePackId: state.activePackId })
  stageEvent(
    onEvent,
    'apply',
    'done',
    `${installedState.installs[packId]?.mods.length ?? allMods.length} mods`,
  )

  stageEvent(onEvent, 'activate', 'start')
  if (options.skipActivate) {
    stageEvent(onEvent, 'activate', 'skip')
  } else {
    const toggle = await setPackEnabled({
      catalog,
      packId,
      paths,
      enabled: true,
      signal,
      onEvent,
      skipGameCheck: true,
    })
    stageEvent(onEvent, 'activate', 'done', `${toggle.modCount} client mods`)
  }

  stageEvent(onEvent, 'host', 'skip')
  stageEvent(onEvent, 'state', 'start')
  const finalState = await loadState(paths, { catalog, migrate: true })
  const nextState = recordInstall(finalState, catalog, packId, {
    mods: allMods,
    allMods,
    uiSuiteId: suiteId,
  })
  await saveState(paths, nextState)
  stageEvent(onEvent, 'state', 'done')

  const summary: InstallSummary = {
    packId,
    clientMods: (nextState.installs[packId]?.mods ?? []).filter((mod) => !mod.serverOnly).length,
    serverMods: (nextState.installs[packId]?.mods ?? []).filter((mod) => mod.serverOnly).length,
    workshopItems: downloaded.downloadedItems + suiteMods.downloadedItems,
    downloadedBytes: downloaded.downloadedBytes + suiteMods.downloadedBytes,
    installedAt: nextState.installs[packId]?.installedAt ?? new Date().toISOString(),
    zombieBuddy,
    hostUpdated: false,
  }

  emit(onEvent, { type: 'done', summary })
  return summary
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

    if (pack.source === 'workshop') {
      return await installWorkshopPack({
        options,
        game,
        pack,
        pzPath,
      })
    }

    const suiteId =
      getUiSuite(catalog, options.uiSuiteId)?.id ?? getDefaultUiSuite(catalog)?.id ?? null
    const archive = pack.archive
    if (!archive) {
      throw new EasyPzError('IO', 'Archive pack is missing archive metadata.')
    }

    stageEvent(onEvent, 'workshop', 'skip', 'Archive pack')

    const extractRootForPack = path.join(paths.extractRoot, archive.sha256)
    const cachedExtract = await extractCacheComplete(catalog, packId, extractRootForPack)
    const reusableArchive = await resolveArchive({
      paths,
      fileName: archive.fileName,
      sha256: archive.sha256,
      force: Boolean(options.forceRedownload),
      onEvent,
    })

    let archivePath = reusableArchive?.archivePath ?? path.join(paths.archiveDir, archive.fileName)
    let downloadedBytes = 0

    stageEvent(onEvent, 'download', 'start')
    if (reusableArchive) {
      const label = reusableArchive.source === 'legacy' ? 'legacy cache' : 'local cache'
      emit(onEvent, {
        type: 'log',
        level: 'info',
        message: `Using ${label} for ${archive.fileName}.`,
      })
      stageEvent(onEvent, 'download', 'skip', `Already cached in the ${label}`)
    } else {
      emit(onEvent, {
        type: 'log',
        level: 'info',
        message: `Downloading ${archive.fileName} (${(archive.sizeBytes / 1024 ** 3).toFixed(1)} GB).`,
      })
      const result = await downloadFile({
        url: archive.url,
        destination: archivePath,
        expectedSha256: archive.sha256,
        expectedSize: archive.sizeBytes,
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
      try {
        await assertTarComplete(archivePath)
      } catch (error) {
        await fs.rm(archivePath, { force: true })
        throw error
      }
      stageEvent(onEvent, 'download', 'done')
    }

    ensureNotCancelled(signal)

    stageEvent(onEvent, 'verify', 'start')
    const actual = await hashFile(archivePath)
    if (actual !== archive.sha256) {
      throw new EasyPzError(
        'ARCHIVE_HASH_MISMATCH',
        `Archive hash mismatch. Expected ${archive.sha256}, got ${actual}.`,
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

    stageEvent(onEvent, 'apply', 'start')
    const stored = await storePackMods({
      catalog,
      packId,
      extractRoot,
      paths,
      signal,
      onEvent,
    })
    stageEvent(onEvent, 'apply', 'done')
    emit(onEvent, {
      type: 'log',
      level: 'info',
      message: `Stored ${stored.stored} mod folder(s); ${stored.skipped} already available.`,
    })

    const suite = getUiSuite(catalog, suiteId)
    if (!game.workshopRoot && suite && suite.items.length > 0) {
      throw new EasyPzError(
        'GAME_NOT_FOUND',
        'The Steam Workshop folder is required for the selected UI suite.',
      )
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
    stageEvent(
      onEvent,
      'ui-suite',
      suiteMods.mods.length > 0 ? 'done' : 'skip',
      suiteMods.mods.length > 0 ? `${suiteMods.mods.length} mods` : undefined,
    )

    const baseMods = getEffectiveMods(catalog, packId).map((mod) => ({
      id: mod.id,
      name: mod.name,
      folder: mod.folder,
      workshopId: mod.workshopId,
      serverOnly: mod.serverOnly,
    }))
    const allMods = [...baseMods, ...suiteMods.mods]
    downloadedBytes += suiteMods.downloadedBytes

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
      heapMB: options.heapMB ?? game.recommendedHeapMB,
      zombieBuddyInstalled,
    })
    stageEvent(onEvent, 'configure', 'done', `Heap ${options.heapMB ?? game.recommendedHeapMB} MB`)

    ensureNotCancelled(signal)

    stageEvent(onEvent, 'activate', 'start')
    if (options.skipActivate) {
      stageEvent(onEvent, 'activate', 'skip')
    } else {
      const toggle = await setPackEnabled({
        catalog,
        packId,
        paths,
        enabled: true,
        signal,
        onEvent,
        skipGameCheck: true,
      })
      stageEvent(onEvent, 'activate', 'done', `${toggle.modCount} client mods`)
    }

    ensureNotCancelled(signal)

    stageEvent(onEvent, 'host', 'skip')

    stageEvent(onEvent, 'state', 'start')
    const finalState = await loadState(paths, { catalog, migrate: true })
    const nextState = recordInstall(finalState, catalog, packId, {
      mods: allMods,
      uiSuiteId: suiteId,
    })
    await saveState(paths, nextState)
    stageEvent(onEvent, 'state', 'done')

    summary = {
      packId,
      clientMods: (nextState.installs[packId]?.mods ?? []).filter((mod) => !mod.serverOnly).length,
      serverMods: (nextState.installs[packId]?.mods ?? []).filter((mod) => mod.serverOnly).length,
      workshopItems: suiteMods.downloadedItems,
      downloadedBytes,
      installedAt: nextState.installs[packId]?.installedAt ?? new Date().toISOString(),
      zombieBuddy,
      hostUpdated: false,
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

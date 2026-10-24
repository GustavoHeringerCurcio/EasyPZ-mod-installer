import fs from 'node:fs/promises'
import type { Catalog } from '@easypz/catalog'
import { getUiSuite } from '@easypz/catalog'
import type { AppPaths } from './paths.js'
import { activeModPath, storeModPath } from './paths.js'
import { hasModInfo } from './archive.js'
import { EasyPzError, cancelledError, toError } from './errors.js'
import type { EventSink } from './events.js'
import type { InstalledMod } from './state.js'
import { discoverItemMods, ensureSteamCmd, findItemRoot, runSteamCmdItem } from './workshop.js'

export interface UiSuiteInstallResult {
  mods: InstalledMod[]
  downloadedItems: number
  cachedItems: number
  downloadedBytes: number
  failedItems: Array<{ id: string; name: string; reason: string }>
}

function emit(sink: EventSink | undefined, event: Parameters<EventSink>[0]): void {
  sink?.(event)
}

export async function ensureUiSuiteMods(options: {
  catalog: Catalog
  packId: string
  suiteId: string | null | undefined
  paths: AppPaths
  workshopRoot: string
  signal?: AbortSignal
  onEvent?: EventSink
}): Promise<UiSuiteInstallResult> {
  const { catalog, suiteId, paths, workshopRoot, signal, onEvent } = options
  const suite = getUiSuite(catalog, suiteId)
  if (!suite || suite.items.length === 0) {
    return {
      mods: [],
      downloadedItems: 0,
      cachedItems: 0,
      downloadedBytes: 0,
      failedItems: [],
    }
  }

  const wanted = new Map(suite.add.map((mod) => [mod.id, mod]))
  const wantedIds = new Set(wanted.keys())
  const explicitItemIds = new Set(suite.add.map((mod) => mod.workshopId))
  const removed = new Set(suite.remove)
  const found = new Map<string, InstalledMod>()
  const failedItems: UiSuiteInstallResult['failedItems'] = []
  let downloadedItems = 0
  let cachedItems = 0
  let downloadedBytes = 0

  emit(onEvent, { type: 'stage', stage: 'ui-suite', status: 'start', detail: suite.name })

  for (const [index, item] of suite.items.entries()) {
    if (signal?.aborted) throw cancelledError()

    let root = await findItemRoot(item.id, workshopRoot, paths)
    const wasCached = Boolean(root)

    emit(onEvent, {
      type: 'workshop-item',
      item: {
        index: index + 1,
        total: suite.items.length,
        name: item.name,
        status: wasCached ? 'done' : 'starting',
        percent: wasCached ? 100 : null,
        totalBytes: item.sizeBytes,
        transferredBytes: wasCached ? item.sizeBytes : undefined,
      },
    })

    if (!root) {
      const steamCmd = await ensureSteamCmd(paths, onEvent, signal)
      const result = await runSteamCmdItem(steamCmd, item.id, signal, (progress) => {
        emit(onEvent, {
          type: 'workshop-item',
          item: {
            index: index + 1,
            total: suite.items.length,
            name: item.name,
            status: 'downloading',
            percent: progress.percent,
            transferredBytes: progress.transferredBytes,
            totalBytes: progress.totalBytes,
            bytesPerSecond: progress.bytesPerSecond,
            etaSeconds: progress.etaSeconds,
          },
        })
      })
      root = await findItemRoot(item.id, workshopRoot, paths)
      if (!root) {
        failedItems.push({
          id: item.id,
          name: item.name,
          reason: result.timedOut
            ? 'SteamCMD timed out or stalled on this item.'
            : `SteamCMD failed with code ${result.code}.`,
        })
        emit(onEvent, {
          type: 'workshop-item',
          item: {
            index: index + 1,
            total: suite.items.length,
            name: item.name,
            status: 'failed',
            percent: null,
            totalBytes: item.sizeBytes,
          },
        })
        continue
      }
      downloadedBytes += result.downloadedBytes ?? item.sizeBytes ?? 0
    }

    try {
      const discovered = await discoverItemMods(root, item.id)
      const explicit = explicitItemIds.has(item.id)
      for (const mod of discovered) {
        if (removed.has(mod.id) || found.has(mod.id)) continue
        if (explicit && !wantedIds.has(mod.id)) continue
        const destination = storeModPath(paths, mod.workshopId, mod.folder)
        if (
          !(await hasModInfo(destination)) &&
          !(await hasModInfo(activeModPath(paths, mod.folder)))
        ) {
          await fs.mkdir(paths.storeDir, { recursive: true })
          await fs.cp(mod.source, destination, { recursive: true, force: true })
        }
        found.set(mod.id, {
          id: mod.id,
          name: mod.name,
          folder: mod.folder,
          workshopId: mod.workshopId,
          serverOnly: mod.serverOnly,
        })
      }
      downloadedItems += 1
      if (wasCached) cachedItems += 1
      emit(onEvent, {
        type: 'workshop-item',
        item: {
          index: index + 1,
          total: suite.items.length,
          name: item.name,
          status: 'done',
          percent: 100,
          transferredBytes: item.sizeBytes,
          totalBytes: item.sizeBytes,
        },
      })
    } catch (error) {
      failedItems.push({ id: item.id, name: item.name, reason: toError(error).message })
      emit(onEvent, {
        type: 'workshop-item',
        item: {
          index: index + 1,
          total: suite.items.length,
          name: item.name,
          status: 'failed',
          percent: null,
          totalBytes: item.sizeBytes,
        },
      })
    }
  }

  for (const mod of suite.add) {
    if (found.has(mod.id)) continue
    if (await hasModInfo(storeModPath(paths, mod.workshopId, mod.folder))) {
      found.set(mod.id, {
        id: mod.id,
        name: mod.name,
        folder: mod.folder,
        workshopId: mod.workshopId,
        serverOnly: mod.serverOnly,
      })
    }
  }

  const missing = [...wanted.values()].filter((mod) => !found.has(mod.id))
  if (missing.length > 0) {
    throw new EasyPzError(
      'MISSING_MODS',
      `The ${suite.name} suite is incomplete: ${missing.map((mod) => mod.name).join(', ')}. Check SteamCMD and try again.`,
    )
  }

  emit(onEvent, { type: 'stage', stage: 'ui-suite', status: 'done', detail: suite.name })

  return {
    mods: [...found.values()],
    downloadedItems,
    cachedItems,
    downloadedBytes,
    failedItems,
  }
}

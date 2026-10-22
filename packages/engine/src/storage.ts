import fs from 'node:fs/promises'
import path from 'node:path'
import type { Catalog } from '@easypz/catalog'
import {
  getDefaultUiSuite,
  getEffectiveMods,
  getEffectiveModsForSuite,
  getPack,
} from '@easypz/catalog'
import { loadState, type AppState, type InstalledMod } from './state.js'
import type { AppPaths } from './paths.js'
import { activeModPath, storeModPath } from './paths.js'
import { hasModInfo, resolveModSource } from './archive.js'
import { movePath } from './apply.js'
import type { EventSink } from './events.js'
import { EasyPzError, cancelledError, toError } from './errors.js'

export interface MoveEntry {
  from: string
  to: string
}

interface MoveJournal {
  version: 1
  createdAt: string
  entries: MoveEntry[]
}

export interface MoveTransactionOptions {
  signal?: AbortSignal
  duplicateRoot?: string
  onMove?: (entry: MoveEntry, index: number, total: number) => void
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function uniquePath(base: string): Promise<string> {
  let candidate = base
  let index = 1
  while (await pathExists(candidate)) {
    candidate = `${base}-${index}`
    index += 1
  }
  return candidate
}

/**
 * Executes a set of directory moves as a transaction.
 *
 * The journal is written before any move. If the process crashes, the next
 * startup can finish the intended moves. If a move throws, completed moves are
 * reversed.
 */
export async function runMoveTransaction(
  entries: MoveEntry[],
  journalFile: string,
  options: MoveTransactionOptions = {},
  after?: () => Promise<void>,
): Promise<void> {
  const filtered = entries.filter((entry) => entry.from !== entry.to)
  if (filtered.length === 0) {
    await after?.()
    return
  }

  const journal: MoveJournal = {
    version: 1,
    createdAt: new Date().toISOString(),
    entries: filtered,
  }

  await fs.mkdir(path.dirname(journalFile), { recursive: true })
  await fs.writeFile(journalFile, `${JSON.stringify(journal, null, 2)}\n`, 'utf8')

  const duplicateRoot =
    options.duplicateRoot ?? path.join(path.dirname(journalFile), 'move-duplicates')
  const executed: MoveEntry[] = []

  try {
    for (const [index, entry] of filtered.entries()) {
      if (options.signal?.aborted) throw cancelledError()

      if (!(await pathExists(entry.from))) continue

      let destination = entry.to
      if (await pathExists(destination)) {
        await fs.mkdir(duplicateRoot, { recursive: true })
        destination = await uniquePath(
          path.join(duplicateRoot, `${path.basename(entry.to)}-${Date.now()}`),
        )
      }

      await movePath(entry.from, destination)
      executed.push({ from: entry.from, to: destination })
      options.onMove?.(entry, index + 1, filtered.length)
    }

    await after?.()
    await fs.rm(journalFile, { force: true })
  } catch (error) {
    let rollbackComplete = true
    for (const entry of [...executed].reverse()) {
      try {
        if ((await pathExists(entry.to)) && !(await pathExists(entry.from))) {
          await movePath(entry.to, entry.from)
        }
      } catch {
        rollbackComplete = false
      }
    }

    if (rollbackComplete) await fs.rm(journalFile, { force: true })
    if (error instanceof EasyPzError) throw error
    throw new EasyPzError('IO', `Could not move pack files: ${toError(error).message}`, {
      cause: toError(error),
    })
  }
}

export async function recoverStorageJournal(paths: AppPaths): Promise<number> {
  let raw: string
  try {
    raw = await fs.readFile(paths.journalFile, 'utf8')
  } catch {
    return 0
  }

  let journal: MoveJournal
  try {
    journal = JSON.parse(raw) as MoveJournal
  } catch {
    await fs.rm(paths.journalFile, { force: true })
    throw new EasyPzError('IO', 'EasyPZ move journal is invalid and could not be recovered.')
  }

  let recovered = 0
  for (const entry of journal.entries ?? []) {
    if (await pathExists(entry.to)) continue
    if (!(await pathExists(entry.from))) continue
    try {
      await movePath(entry.from, entry.to)
      recovered += 1
    } catch {
      // Leave the journal in place so the user can retry.
      throw new EasyPzError(
        'IO',
        `Could not finish a previous pack move. Close the game and try again.`,
      )
    }
  }

  await fs.rm(paths.journalFile, { force: true })
  return recovered
}

export async function modIsStored(
  paths: AppPaths,
  workshopId: string,
  folder: string,
): Promise<boolean> {
  return hasModInfo(storeModPath(paths, workshopId, folder))
}

export async function modIsActive(paths: AppPaths, folder: string): Promise<boolean> {
  return hasModInfo(activeModPath(paths, folder))
}

export async function isModAvailable(
  paths: AppPaths,
  workshopId: string,
  folder: string,
): Promise<boolean> {
  return (await modIsStored(paths, workshopId, folder)) || (await modIsActive(paths, folder))
}

export type StorageMod = Pick<InstalledMod, 'id' | 'name' | 'folder' | 'workshopId' | 'serverOnly'>

export async function getPackStorageMods(
  catalog: Catalog,
  packId: string,
  paths: AppPaths,
  state?: AppState,
): Promise<StorageMod[]> {
  const pack = getPack(catalog, packId)
  const currentState = state ?? (await loadState(paths, { catalog, migrate: true }))
  const install = currentState.installs[packId]
  if (install) return install.mods
  if (pack.source === 'workshop') return []
  return getEffectiveModsForSuite(catalog, packId, getDefaultUiSuite(catalog)?.id ?? null)
}

export async function isPackAvailable(
  catalog: Catalog,
  packId: string,
  paths: AppPaths,
  state?: AppState,
): Promise<boolean> {
  const mods = await getPackStorageMods(catalog, packId, paths, state)
  if (mods.length === 0) return false
  for (const mod of mods) {
    if (!(await isModAvailable(paths, mod.workshopId, mod.folder))) return false
  }
  return true
}

export async function getAvailablePackIds(
  catalog: Catalog,
  paths: AppPaths,
  state?: AppState,
): Promise<string[]> {
  const currentState = state ?? (await loadState(paths, { catalog, migrate: true }))
  const available: string[] = []
  for (const pack of catalog.packs) {
    if (await isPackAvailable(catalog, pack.id, paths, currentState)) available.push(pack.id)
  }
  return available
}

/**
 * Finds the most specific pack whose mods are all present in Zomboid\mods.
 * Advanced wins over Medium because it contains every Medium mod plus its own.
 */
export async function detectActivePackId(
  catalog: Catalog,
  paths: AppPaths,
  state?: AppState,
): Promise<string | null> {
  const currentState = state ?? (await loadState(paths, { catalog, migrate: true }))
  let best: { id: string; count: number } | null = null

  for (const pack of catalog.packs) {
    const mods = await getPackStorageMods(catalog, pack.id, paths, currentState)
    if (mods.length === 0) continue

    let allActive = true
    for (const mod of mods) {
      if (!(await modIsActive(paths, mod.folder))) {
        allActive = false
        break
      }
    }

    if (allActive && (!best || mods.length > best.count)) {
      best = { id: pack.id, count: mods.length }
    }
  }

  return best?.id ?? null
}

export function activationEntriesForMods(mods: StorageMod[], paths: AppPaths): MoveEntry[] {
  return mods.map((mod) => ({
    from: storeModPath(paths, mod.workshopId, mod.folder),
    to: activeModPath(paths, mod.folder),
  }))
}

export function deactivationEntriesForMods(mods: StorageMod[], paths: AppPaths): MoveEntry[] {
  return mods.map((mod) => ({
    from: activeModPath(paths, mod.folder),
    to: storeModPath(paths, mod.workshopId, mod.folder),
  }))
}

export function activationEntries(catalog: Catalog, packId: string, paths: AppPaths): MoveEntry[] {
  return activationEntriesForMods(getEffectiveMods(catalog, packId), paths)
}

export function deactivationEntries(
  catalog: Catalog,
  packId: string,
  paths: AppPaths,
): MoveEntry[] {
  return deactivationEntriesForMods(getEffectiveMods(catalog, packId), paths)
}

export async function assertPackAvailable(
  catalog: Catalog,
  packId: string,
  paths: AppPaths,
  state?: AppState,
): Promise<void> {
  const mods = await getPackStorageMods(catalog, packId, paths, state)
  if (mods.length === 0) {
    throw new EasyPzError(
      'MISSING_MODS',
      'This pack has not been downloaded yet. Install it first.',
    )
  }

  const missing: string[] = []
  for (const mod of mods) {
    if (!(await isModAvailable(paths, mod.workshopId, mod.folder))) {
      missing.push(mod.folder)
    }
  }
  if (missing.length > 0) {
    throw new EasyPzError(
      'MISSING_MODS',
      `Pack files are missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '...' : ''}. Install or repair the pack.`,
    )
  }
}

export async function storePackMods(options: {
  catalog: Catalog
  packId: string
  extractRoot: string
  paths: AppPaths
  signal?: AbortSignal
  onEvent?: EventSink
}): Promise<{ stored: number; skipped: number }> {
  const { catalog, packId, extractRoot, paths, signal, onEvent } = options
  const mods = getEffectiveMods(catalog, packId)
  const entries: MoveEntry[] = []

  for (const mod of mods) {
    if (signal?.aborted) throw cancelledError()
    if (
      (await modIsStored(paths, mod.workshopId, mod.folder)) ||
      (await modIsActive(paths, mod.folder))
    ) {
      continue
    }

    const source = await resolveModSource(extractRoot, mod.workshopId, mod.folder)
    if (!source) {
      throw new EasyPzError(
        'ARCHIVE_MISSING_MODS',
        `The archive is missing ${mod.folder}. Re-download the pack or try the legacy installer.`,
      )
    }

    entries.push({
      from: source,
      to: storeModPath(paths, mod.workshopId, mod.folder),
    })
  }

  await runMoveTransaction(entries, paths.journalFile, {
    signal,
    duplicateRoot: path.join(paths.backupDir, 'easypz-duplicates'),
    onMove: (entry, index, total) => {
      onEvent?.({
        type: 'mod',
        index,
        total,
        name: path.basename(entry.to),
        action: 'moved',
      })
    },
  })

  return { stored: entries.length, skipped: mods.length - entries.length }
}

const DELETE_CONCURRENCY = 6

function modKey(mod: Pick<InstalledMod, 'workshopId' | 'folder'>): string {
  return `${mod.workshopId}:${mod.folder}`
}

function dedupeStorageMods(mods: StorageMod[]): StorageMod[] {
  const seen = new Set<string>()
  return mods.filter((mod) => {
    const key = modKey(mod)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function resolveDeleteMods(
  catalog: Catalog,
  packId: string,
  install: AppState['installs'][string] | undefined,
): StorageMod[] {
  if (install) {
    if (install.allMods.length > 0) return dedupeStorageMods(install.allMods)
    if (install.mods.length > 0) return dedupeStorageMods(install.mods)
  }

  const pack = catalog.packs.find((candidate) => candidate.id === packId)
  if (!pack || pack.source === 'workshop') return []
  return dedupeStorageMods(getEffectiveMods(catalog, packId))
}

/**
 * Builds the set of mods the deletion must preserve. Only packs with a state
 * record count as installed, so this never inspects the filesystem.
 */
export function collectSharedMods(
  catalog: Catalog,
  state: AppState,
  excludePackId: string,
): { keys: Set<string>; folders: Set<string> } {
  const keys = new Set<string>()
  const folders = new Set<string>()

  for (const [packId, install] of Object.entries(state.installs)) {
    if (packId === excludePackId) continue

    let mods: StorageMod[] = install.allMods.length > 0 ? install.allMods : install.mods
    if (mods.length === 0) {
      const pack = catalog.packs.find((candidate) => candidate.id === packId)
      if (pack && pack.source !== 'workshop') {
        mods = getEffectiveMods(catalog, packId)
      }
    }

    for (const mod of mods) {
      keys.add(modKey(mod))
      folders.add(mod.folder)
    }
  }

  return { keys, folders }
}

function normalizePathKey(target: string): string {
  const normalized = path.normalize(target)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= items.length) return
      await worker(items[index]!, index)
    }
  })
  await Promise.all(workers)
}

export async function deletePackStorage(options: {
  catalog: Catalog
  packId: string
  paths: AppPaths
  state?: AppState
  onEvent?: EventSink
}): Promise<{ removed: number; keptShared: number; failedFolders: string[] }> {
  const { catalog, packId, paths, state, onEvent } = options
  const currentState = state ?? (await loadState(paths, { catalog, migrate: true }))
  const install = currentState.installs[packId]
  const targetMods = resolveDeleteMods(catalog, packId, install)
  const shared = collectSharedMods(catalog, currentState, packId)

  const claimed = new Set<string>()
  const targets: Array<{ folder: string; paths: string[] }> = []
  let keptShared = 0

  for (const mod of targetMods) {
    if (shared.keys.has(modKey(mod)) || shared.folders.has(mod.folder)) {
      keptShared += 1
      continue
    }

    const modPaths: string[] = []
    for (const candidate of [
      storeModPath(paths, mod.workshopId, mod.folder),
      activeModPath(paths, mod.folder),
    ]) {
      const key = normalizePathKey(candidate)
      if (claimed.has(key)) continue
      claimed.add(key)
      modPaths.push(candidate)
    }
    if (modPaths.length === 0) continue
    targets.push({ folder: mod.folder, paths: modPaths })
  }

  let removed = 0
  const failedFolders = new Set<string>()

  await runPool(targets, DELETE_CONCURRENCY, async (target, index) => {
    onEvent?.({
      type: 'delete-progress',
      packId,
      index: index + 1,
      total: targets.length,
      folder: target.folder,
    })

    let failed = false
    for (const targetPath of target.paths) {
      try {
        await fs.rm(targetPath, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 150,
        })
      } catch (error) {
        failed = true
        failedFolders.add(target.folder)
        onEvent?.({
          type: 'warning',
          message: `Could not delete ${target.folder}: ${toError(error).message}`,
        })
      }
    }

    if (!failed) removed += 1
  })

  return { removed, keptShared, failedFolders: [...failedFolders] }
}

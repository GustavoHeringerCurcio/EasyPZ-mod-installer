import fs from 'node:fs/promises'
import path from 'node:path'
import type { Catalog } from '@easypz/catalog'
import { getEffectiveMods } from '@easypz/catalog'
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

export async function isPackAvailable(
  catalog: Catalog,
  packId: string,
  paths: AppPaths,
): Promise<boolean> {
  for (const mod of getEffectiveMods(catalog, packId)) {
    if (!(await isModAvailable(paths, mod.workshopId, mod.folder))) return false
  }
  return true
}

export async function getAvailablePackIds(catalog: Catalog, paths: AppPaths): Promise<string[]> {
  const available: string[] = []
  for (const pack of catalog.packs) {
    if (await isPackAvailable(catalog, pack.id, paths)) available.push(pack.id)
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
): Promise<string | null> {
  let best: { id: string; count: number } | null = null

  for (const pack of catalog.packs) {
    const mods = getEffectiveMods(catalog, pack.id)
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

export function activationEntries(catalog: Catalog, packId: string, paths: AppPaths): MoveEntry[] {
  const entries: MoveEntry[] = []
  for (const mod of getEffectiveMods(catalog, packId)) {
    entries.push({
      from: storeModPath(paths, mod.workshopId, mod.folder),
      to: activeModPath(paths, mod.folder),
    })
  }
  return entries
}

export function deactivationEntries(
  catalog: Catalog,
  packId: string,
  paths: AppPaths,
): MoveEntry[] {
  const entries: MoveEntry[] = []
  for (const mod of getEffectiveMods(catalog, packId)) {
    entries.push({
      from: activeModPath(paths, mod.folder),
      to: storeModPath(paths, mod.workshopId, mod.folder),
    })
  }
  return entries
}

export async function assertPackAvailable(
  catalog: Catalog,
  packId: string,
  paths: AppPaths,
): Promise<void> {
  const missing: string[] = []
  for (const mod of getEffectiveMods(catalog, packId)) {
    if (!(await isModAvailable(paths, mod.workshopId, mod.folder))) {
      missing.push(mod.folder)
    }
  }
  if (missing.length > 0) {
    throw new EasyPzError(
      'MISSING_MODS',
      `Pack files are missing: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}. Install or repair the pack.`,
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

export async function deletePackStorage(options: {
  catalog: Catalog
  packId: string
  paths: AppPaths
  otherAvailablePackIds: string[]
}): Promise<{ removed: number; keptShared: number }> {
  const { catalog, packId, paths, otherAvailablePackIds } = options
  const otherKeys = new Set<string>()
  for (const otherId of otherAvailablePackIds) {
    if (otherId === packId) continue
    for (const mod of getEffectiveMods(catalog, otherId)) {
      otherKeys.add(`${mod.workshopId}:${mod.folder}`)
    }
  }

  let removed = 0
  let keptShared = 0
  for (const mod of getEffectiveMods(catalog, packId)) {
    const key = `${mod.workshopId}:${mod.folder}`
    if (otherKeys.has(key)) {
      keptShared += 1
      continue
    }

    if (await modIsActive(paths, mod.folder)) {
      keptShared += 1
      continue
    }

    const storePath = storeModPath(paths, mod.workshopId, mod.folder)
    if (!(await pathExists(storePath))) continue
    try {
      await fs.rm(storePath, { recursive: true, force: true })
      removed += 1
    } catch (error) {
      throw new EasyPzError('IO', `Could not delete ${mod.folder}: ${toError(error).message}`, {
        cause: toError(error),
      })
    }
  }

  return { removed, keptShared }
}

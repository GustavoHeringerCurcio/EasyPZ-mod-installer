import fs from 'node:fs/promises'
import path from 'node:path'
import type { Catalog } from '@easypz/catalog'
import { getEffectiveMods, getManagedFolders } from '@easypz/catalog'
import type { EventSink } from './events.js'
import { EasyPzError, cancelledError, toError } from './errors.js'
import { hasModInfo, resolveModSource } from './archive.js'

export async function movePath(source: string, destination: string): Promise<void> {
  await fs.mkdir(path.dirname(destination), { recursive: true })
  try {
    await fs.rename(source, destination)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error
    await fs.cp(source, destination, { recursive: true, force: true })
    await fs.rm(source, { recursive: true, force: true })
  }
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

async function backupFolder(source: string, backupRoot: string, folder: string): Promise<string> {
  await fs.mkdir(backupRoot, { recursive: true })
  const base = `${folder}-${stamp()}`
  let destination = path.join(backupRoot, base)
  let index = 1
  while (true) {
    try {
      await fs.access(destination)
      destination = path.join(backupRoot, `${base}-${index}`)
      index += 1
    } catch {
      break
    }
  }
  await movePath(source, destination)
  return destination
}

export interface ApplyOptions {
  catalog: Catalog
  packId: string
  extractRoot: string
  modsDir: string
  backupRoot: string
  force?: boolean
  signal?: AbortSignal
  onEvent?: EventSink
}

export interface ApplyResult {
  moved: number
  kept: number
  backedUp: number
  installedFolders: string[]
}

export async function applyMods(options: ApplyOptions): Promise<ApplyResult> {
  const { catalog, packId, extractRoot, modsDir, backupRoot, force, signal, onEvent } = options
  const mods = getEffectiveMods(catalog, packId)
  const journal: Array<{ destination: string; source: string; backup: string | null }> = []

  let moved = 0
  let kept = 0
  let backedUp = 0

  await fs.mkdir(modsDir, { recursive: true })

  try {
    for (const [index, mod] of mods.entries()) {
      if (signal?.aborted) throw cancelledError()

      const destination = path.join(modsDir, mod.folder)
      const source = await resolveModSource(extractRoot, mod.workshopId, mod.folder)
      const destinationValid = await hasModInfo(destination)

      if (!source) {
        if (destinationValid) {
          kept += 1
          onEvent?.({
            type: 'mod',
            index: index + 1,
            total: mods.length,
            name: mod.name,
            action: 'kept',
          })
          continue
        }
        throw new EasyPzError(
          'ARCHIVE_MISSING_MODS',
          `The archive is missing ${mod.folder}. Re-download the pack or try the legacy installer.`,
        )
      }

      if (destinationValid && !force) {
        kept += 1
        onEvent?.({
          type: 'mod',
          index: index + 1,
          total: mods.length,
          name: mod.name,
          action: 'kept',
        })
        continue
      }

      let backup: string | null = null
      if (await pathExists(destination)) {
        backup = await backupFolder(destination, backupRoot, mod.folder)
        backedUp += 1
        onEvent?.({
          type: 'mod',
          index: index + 1,
          total: mods.length,
          name: mod.name,
          action: 'backedUp',
        })
      }

      await movePath(source, destination)
      journal.push({ destination, source, backup })
      moved += 1
      onEvent?.({
        type: 'mod',
        index: index + 1,
        total: mods.length,
        name: mod.name,
        action: 'moved',
      })
    }
  } catch (error) {
    for (const entry of journal.reverse()) {
      try {
        if (entry.backup) {
          await fs.rm(entry.destination, { recursive: true, force: true })
          await movePath(entry.backup, entry.destination)
        } else {
          await movePath(entry.destination, entry.source)
        }
      } catch {
        // Best effort rollback; the original error is more useful.
      }
    }
    throw error
  }

  return {
    moved,
    kept,
    backedUp,
    installedFolders: getManagedFolders(catalog, packId),
  }
}

export interface RemoveOptions {
  catalog: Catalog
  targetPackId: string
  previousManagedFolders: string[]
  modsDir: string
  backupRoot: string
  signal?: AbortSignal
  onEvent?: EventSink
}

export async function removeModsNotInPack(options: RemoveOptions): Promise<string[]> {
  const { catalog, targetPackId, previousManagedFolders, modsDir, backupRoot, signal, onEvent } =
    options
  const targetFolders = new Set(getManagedFolders(catalog, targetPackId))
  const removed: string[] = []

  for (const folder of previousManagedFolders) {
    if (targetFolders.has(folder)) continue
    if (signal?.aborted) throw cancelledError()

    const source = path.join(modsDir, folder)
    if (!(await pathExists(source))) continue

    try {
      await backupFolder(source, backupRoot, folder)
      removed.push(folder)
      onEvent?.({
        type: 'mod',
        index: removed.length,
        total: previousManagedFolders.length,
        name: folder,
        action: 'removed',
      })
    } catch (error) {
      throw new EasyPzError('IO', `Could not move ${folder} to backup: ${toError(error).message}`, {
        cause: toError(error),
      })
    }
  }

  return removed
}

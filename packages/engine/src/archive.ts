import fs from 'node:fs/promises'
import path from 'node:path'
import * as tar from 'tar'
import type { Catalog } from '@easypz/catalog'
import { getEffectiveMods } from '@easypz/catalog'
import { cancelledError, EasyPzError, toError } from './errors.js'

export interface ExtractOptions {
  archivePath: string
  destination: string
  signal?: AbortSignal
  onEntry?: (entries: number) => void
}

function hasTraversal(entryPath: string): boolean {
  return entryPath.split(/[\\/]/).some((part) => part === '..')
}

/**
 * A valid tar ends with at least two 512-byte zero blocks. Checking the tail is
 * cheap and catches truncated archives before a multi-minute extraction.
 */
export async function assertTarComplete(archivePath: string): Promise<void> {
  const stat = await fs.stat(archivePath)
  if (stat.size < 1024) {
    throw new EasyPzError('ARCHIVE_CORRUPT', 'The pack archive is too small to be valid.')
  }

  const handle = await fs.open(archivePath, 'r')
  try {
    const buffer = Buffer.alloc(1024)
    await handle.read(buffer, 0, buffer.length, stat.size - buffer.length)
    if (!buffer.every((byte) => byte === 0)) {
      throw new EasyPzError(
        'ARCHIVE_CORRUPT',
        'The pack archive is incomplete. The published file is truncated or corrupt.',
      )
    }
  } finally {
    await handle.close()
  }
}

export async function extractArchive(options: ExtractOptions): Promise<void> {
  const { archivePath, destination, signal, onEntry } = options
  await fs.mkdir(destination, { recursive: true })

  let entries = 0
  try {
    await tar.x({
      file: archivePath,
      cwd: destination,
      strict: true,
      preservePaths: false,
      filter: (entryPath) => !hasTraversal(entryPath),
      onentry: () => {
        if (signal?.aborted) throw cancelledError()
        entries += 1
        onEntry?.(entries)
      },
    })
  } catch (error) {
    if (signal?.aborted) throw cancelledError()
    const message = toError(error).message
    if (message.includes('TAR_BAD_ARCHIVE') || message.includes('Truncated input')) {
      throw new EasyPzError(
        'ARCHIVE_CORRUPT',
        'The pack archive is incomplete or corrupt. The published file needs to be updated.',
        { cause: toError(error) },
      )
    }
    throw new EasyPzError('IO', `Could not extract the mod archive: ${message}`, {
      cause: toError(error),
    })
  }
}

export async function findFileRecursive(
  directory: string,
  fileName: string,
  maxDepth = 4,
): Promise<string | null> {
  if (maxDepth < 0) return null

  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return null
  }

  for (const entry of entries) {
    const full = path.join(directory, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return full
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const found = await findFileRecursive(path.join(directory, entry.name), fileName, maxDepth - 1)
    if (found) return found
  }

  return null
}

export async function hasModInfo(directory: string): Promise<boolean> {
  try {
    const stat = await fs.stat(directory)
    if (!stat.isDirectory()) return false
  } catch {
    return false
  }
  return (await findFileRecursive(directory, 'mod.info')) !== null
}

export function findModSource(extractRoot: string, workshopId: string, folder: string): string {
  return path.join(extractRoot, '108600', workshopId, 'mods', folder)
}

export function findModSourceAlternative(
  extractRoot: string,
  workshopId: string,
  folder: string,
): string[] {
  return [
    path.join(extractRoot, '108600', workshopId, 'mods', folder),
    path.join(extractRoot, workshopId, 'mods', folder),
    path.join(extractRoot, 'mods', folder),
    path.join(extractRoot, folder),
  ]
}

export async function resolveModSource(
  extractRoot: string,
  workshopId: string,
  folder: string,
): Promise<string | null> {
  for (const candidate of findModSourceAlternative(extractRoot, workshopId, folder)) {
    if (await hasModInfo(candidate)) return candidate
  }
  return null
}

export async function extractCacheComplete(
  catalog: Catalog,
  packId: string,
  extractRoot: string,
): Promise<boolean> {
  for (const mod of getEffectiveMods(catalog, packId)) {
    if (!(await resolveModSource(extractRoot, mod.workshopId, mod.folder))) return false
  }
  return true
}

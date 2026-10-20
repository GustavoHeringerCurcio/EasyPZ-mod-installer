import fs from 'node:fs/promises'
import path from 'node:path'

export const RESET_FILE_NAME = 'reset-mods-42_00.txt'

export async function ensureResetFile(modsDir: string): Promise<void> {
  await fs.mkdir(modsDir, { recursive: true })
  const reset = path.join(modsDir, RESET_FILE_NAME)
  try {
    await fs.access(reset)
  } catch {
    await fs.writeFile(
      reset,
      'If this file does not exist, default.txt will be reset to empty (no mods active).',
      'ascii',
    )
  }
}

export function buildDefaultTxt(modIds: string[]): string {
  const lines = ['VERSION = 1,', '', 'mods', '{']
  for (const id of modIds) lines.push(`    mod = ${id},`)
  lines.push('}', '', 'maps', '{', '}', '')
  return lines.join('\r\n')
}

export function parseDefaultModIds(raw: string): string[] {
  const ids: string[] = []
  for (const match of raw.matchAll(/^\s*mod\s*=\s*([^,]+),?\s*$/gm)) {
    const id = match[1]?.trim()
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

export interface ActivationResult {
  modCount: number
  totalModCount: number
  backupPath: string | null
}

async function readDefaultTxt(modsDir: string): Promise<{ text: string | null; ids: string[] }> {
  try {
    const text = await fs.readFile(path.join(modsDir, 'default.txt'), 'utf8')
    return { text, ids: parseDefaultModIds(text) }
  } catch {
    return { text: null, ids: [] }
  }
}

async function backupDefaultTxt(modsDir: string, backupDir: string): Promise<string | null> {
  const defaultTxt = path.join(modsDir, 'default.txt')
  await fs.mkdir(backupDir, { recursive: true })
  const backupPath = path.join(backupDir, 'default.txt.bak')
  try {
    await fs.copyFile(defaultTxt, backupPath)
    return backupPath
  } catch {
    return null
  }
}

export async function writeDefaultTxt(options: {
  modIds: string[]
  modsDir: string
  backupDir: string
}): Promise<ActivationResult> {
  const { modIds, modsDir, backupDir } = options
  await ensureResetFile(modsDir)
  const backupPath = await backupDefaultTxt(modsDir, backupDir)
  await fs.writeFile(path.join(modsDir, 'default.txt'), buildDefaultTxt(modIds), 'ascii')
  return {
    modCount: modIds.length,
    totalModCount: modIds.length,
    backupPath,
  }
}

/**
 * Adds and removes only the given mod IDs, preserving any unrelated mods the
 * user activated themselves.
 */
export async function updateDefaultTxt(options: {
  addIds: string[]
  removeIds: string[]
  modsDir: string
  backupDir: string
}): Promise<ActivationResult> {
  const { addIds, removeIds, modsDir, backupDir } = options
  await ensureResetFile(modsDir)

  const { ids } = await readDefaultTxt(modsDir)
  const remove = new Set(removeIds)
  const merged = ids.filter((id) => !remove.has(id))
  for (const id of addIds) {
    if (!merged.includes(id)) merged.push(id)
  }

  const backupPath = await backupDefaultTxt(modsDir, backupDir)
  await fs.writeFile(path.join(modsDir, 'default.txt'), buildDefaultTxt(merged), 'ascii')
  return {
    modCount: addIds.length,
    totalModCount: merged.length,
    backupPath,
  }
}

export async function removeDefaultModIds(options: {
  removeIds: string[]
  modsDir: string
  backupDir: string
}): Promise<ActivationResult> {
  return updateDefaultTxt({ addIds: [], ...options })
}

export async function clearDefaultTxt(options: {
  modsDir: string
  backupDir: string
}): Promise<ActivationResult> {
  return writeDefaultTxt({ modIds: [], ...options })
}

export async function countActiveMods(modsDir: string): Promise<number> {
  const { ids } = await readDefaultTxt(modsDir)
  return ids.length
}

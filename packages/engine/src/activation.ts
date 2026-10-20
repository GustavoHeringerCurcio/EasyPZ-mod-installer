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

export interface ActivationResult {
  modCount: number
  backupPath: string | null
}

export async function writeDefaultTxt(options: {
  modIds: string[]
  modsDir: string
  backupDir: string
}): Promise<ActivationResult> {
  const { modIds, modsDir, backupDir } = options
  await ensureResetFile(modsDir)
  await fs.mkdir(backupDir, { recursive: true })

  const defaultTxt = path.join(modsDir, 'default.txt')
  const backupPath = path.join(backupDir, 'default.txt.bak')

  let backup: string | null = null
  try {
    await fs.copyFile(defaultTxt, backupPath)
    backup = backupPath
  } catch {
    backup = null
  }

  await fs.writeFile(defaultTxt, buildDefaultTxt(modIds), 'ascii')
  return { modCount: modIds.length, backupPath: backup }
}

export async function clearDefaultTxt(options: {
  modsDir: string
  backupDir: string
}): Promise<ActivationResult> {
  return writeDefaultTxt({ modIds: [], ...options })
}

export async function countActiveMods(modsDir: string): Promise<number> {
  try {
    const raw = await fs.readFile(path.join(modsDir, 'default.txt'), 'utf8')
    return raw.split(/\r?\n/).filter((line) => /^\s*mod\s*=/.test(line)).length
  } catch {
    return 0
  }
}

import fs from 'node:fs/promises'
import path from 'node:path'

export function buildHostModsLine(modIds: string[]): string {
  return `Mods=${modIds.join(';')}`
}

export interface HostApplyResult {
  updated: boolean
  backupPath: string | null
  modCount: number
  reason?: string
}

export async function applyHostIni(options: {
  iniPath: string
  modIds: string[]
  backupDir: string
}): Promise<HostApplyResult> {
  const { iniPath, modIds, backupDir } = options

  let text: string
  try {
    text = await fs.readFile(iniPath, 'utf8')
  } catch {
    return {
      updated: false,
      backupPath: null,
      modCount: modIds.length,
      reason: 'servertest.ini was not found',
    }
  }

  await fs.mkdir(backupDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupPath = path.join(backupDir, `servertest-before-host-${stamp}.ini`)
  await fs.copyFile(iniPath, backupPath)

  const modsLine = buildHostModsLine(modIds)
  let next: string
  if (/^Mods=/m.test(text)) {
    next = text.replace(/^Mods=.*$/m, modsLine)
  } else {
    next = `${text.replace(/\s+$/, '')}\r\n${modsLine}\r\n`
  }

  await fs.writeFile(iniPath, next, 'utf8')
  return { updated: true, backupPath, modCount: modIds.length }
}

export async function readHostMods(iniPath: string): Promise<string[] | null> {
  try {
    const text = await fs.readFile(iniPath, 'utf8')
    const match = text.match(/^Mods=(.*)$/m)
    if (!match) return null
    return (match[1] ?? '').split(';').filter(Boolean)
  } catch {
    return null
  }
}

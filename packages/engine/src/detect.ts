import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { AppPaths } from './paths.js'

export interface GameInfo {
  found: boolean
  pzPath: string | null
  workshopRoot: string | null
  gameVersion: string | null
  totalRamMB: number
  recommendedHeapMB: number
  currentHeapMB: number | null
  freeDiskGB: number | null
  gameRunning: boolean
  elevated: boolean
  canWriteGame: boolean
  canWriteZomboid: boolean
  steamLibraries: string[]
  detectionError: string | null
}

interface CommandResult {
  code: number | string
  stdout: Buffer
  stderr: Buffer
}

function run(file: string, args: string[], timeout = 10_000): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { windowsHide: true, encoding: 'buffer', timeout },
      (error, stdout, stderr) => {
        resolve({
          code: (error as (NodeJS.ErrnoException & { code?: string | number }) | null)?.code ?? 0,
          stdout: Buffer.from(stdout ?? []),
          stderr: Buffer.from(stderr ?? []),
        })
      },
    )
  })
}

function decodeRegistry(buffer: Buffer): string {
  if (buffer.length > 1 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.toString('utf16le', 2)
  }
  if (buffer.includes(0)) return buffer.toString('utf16le')
  return buffer.toString('utf8')
}

async function registryValues(key: string): Promise<Record<string, string>> {
  if (process.platform !== 'win32') return {}
  try {
    const result = await run('reg.exe', ['query', key])
    if (result.code !== 0) return {}
    const text = decodeRegistry(result.stdout)
    const values: Record<string, string> = {}
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s+(\S+)\s+REG_SZ\s+(.+?)\s*$/)
      if (!match) continue
      const name = match[1]
      const value = match[2]
      if (name && value) values[name] = value.replace(/^"|"$/g, '')
    }
    return values
  } catch {
    return {}
  }
}

async function pathHasSteamApps(candidate: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path.join(candidate, 'steamapps'))
    return stat.isDirectory()
  } catch {
    return false
  }
}

export async function getSteamLibraries(): Promise<string[]> {
  const candidates = new Set<string>()

  for (const key of [
    'HKCU\\Software\\Valve\\Steam',
    'HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam',
    'HKLM\\SOFTWARE\\Valve\\Steam',
  ]) {
    const values = await registryValues(key)
    for (const name of ['SteamPath', 'InstallPath']) {
      const value = values[name]
      if (value) candidates.add(value.replace(/\//g, '\\'))
    }
  }

  candidates.add('C:\\Program Files (x86)\\Steam')
  candidates.add('C:\\Program Files\\Steam')

  const libraries: string[] = []
  const seen = new Set<string>()

  const add = async (candidate: string): Promise<void> => {
    const normalized = path.win32.normalize(candidate.replace(/"/g, '').trim())
    const key = normalized.toLowerCase()
    if (!normalized || seen.has(key)) return
    if (!(await pathHasSteamApps(normalized))) return
    seen.add(key)
    libraries.push(normalized)
  }

  for (const candidate of candidates) await add(candidate)

  for (const library of [...libraries]) {
    const vdf = path.join(library, 'steamapps', 'libraryfolders.vdf')
    let text: string
    try {
      text = await fs.readFile(vdf, 'utf8')
    } catch {
      continue
    }

    for (const match of text.matchAll(/"path"\s+"([^"]+)"/g)) {
      const value = match[1]?.replace(/\\\\/g, '\\')
      if (value) await add(value)
    }
  }

  return libraries
}

export async function findPzPath(libraries: string[]): Promise<string | null> {
  for (const library of libraries) {
    const pzPath = path.join(library, 'steamapps', 'common', 'ProjectZomboid')
    try {
      const stat = await fs.stat(path.join(pzPath, 'ProjectZomboid64.exe'))
      if (stat.isFile()) return pzPath
    } catch {
      // Keep looking.
    }
  }
  return null
}

export function getWorkshopRoot(pzPath: string): string {
  const steamLibrary = path.resolve(pzPath, '..', '..', '..')
  return path.join(steamLibrary, 'steamapps', 'workshop', 'content', '108600')
}

export function recommendedHeapMB(totalRamMB: number): number {
  if (totalRamMB <= 0) return 8192
  const half = Math.floor(totalRamMB / 2)
  const heap = Math.min(8192, Math.max(4096, half))
  return Math.floor(heap / 512) * 512
}

export async function canWritePath(target: string): Promise<boolean> {
  try {
    await fs.access(target, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

export async function isGameRunning(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  for (const name of ['ProjectZomboid64.exe', 'ProjectZomboid32.exe']) {
    const result = await run('tasklist.exe', ['/FI', `IMAGENAME eq ${name}`, '/NH', '/FO', 'CSV'])
    const output = result.stdout.toString('utf8')
    if (output.toLowerCase().includes(name.toLowerCase())) return true
  }
  return false
}

export async function isElevated(): Promise<boolean> {
  if (process.platform !== 'win32') return true
  const command =
    '$id=[Security.Principal.WindowsIdentity]::GetCurrent();' +
    '(New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
  const result = await run('powershell.exe', ['-NoProfile', '-Command', command])
  return result.stdout.toString('utf8').trim().toLowerCase() === 'true'
}

async function readGameVersion(paths: AppPaths): Promise<string | null> {
  try {
    const raw = await fs.readFile(path.join(paths.zomboidDir, 'version.txt'), 'utf8')
    return raw.split(/\r?\n/)[0]?.trim() || null
  } catch {
    return null
  }
}

async function readCurrentHeapMB(pzPath: string): Promise<number | null> {
  try {
    const raw = await fs.readFile(path.join(pzPath, 'ProjectZomboid64.json'), 'utf8')
    const json = JSON.parse(raw) as { vmArgs?: unknown }
    const args = Array.isArray(json.vmArgs) ? json.vmArgs : []
    for (const arg of args) {
      if (typeof arg !== 'string') continue
      const match = /^-Xmx(\d+)([mMgG])$/.exec(arg)
      if (!match) continue
      const value = Number(match[1])
      if (!Number.isFinite(value)) continue
      return match[2]?.toLowerCase() === 'g' ? value * 1024 : value
    }
  } catch {
    // No launcher JSON yet.
  }
  return null
}

async function freeDiskGB(target: string): Promise<number | null> {
  try {
    const stats = await fs.statfs(target)
    return (Number(stats.bavail) * Number(stats.bsize)) / 1024 ** 3
  } catch {
    return null
  }
}

export async function getGameInfo(
  paths: AppPaths,
  options: { gamePathOverride?: string | null } = {},
): Promise<GameInfo> {
  const totalRamMB = Math.round(os.totalmem() / 1024 ** 2)
  const base: GameInfo = {
    found: false,
    pzPath: null,
    workshopRoot: null,
    gameVersion: await readGameVersion(paths),
    totalRamMB,
    recommendedHeapMB: recommendedHeapMB(totalRamMB),
    currentHeapMB: null,
    freeDiskGB: await freeDiskGB(paths.userProfile),
    gameRunning: await isGameRunning(),
    elevated: await isElevated(),
    canWriteGame: false,
    canWriteZomboid: await canWritePath(paths.zomboidDir),
    steamLibraries: [],
    detectionError: null,
  }

  try {
    const libraries = await getSteamLibraries()
    base.steamLibraries = libraries

    let pzPath: string | null = null
    if (options.gamePathOverride) {
      const override = path.resolve(options.gamePathOverride)
      try {
        const stat = await fs.stat(path.join(override, 'ProjectZomboid64.exe'))
        if (stat.isFile()) pzPath = override
      } catch {
        base.detectionError = 'The selected game folder does not contain ProjectZomboid64.exe.'
      }
    }

    if (!pzPath) pzPath = await findPzPath(libraries)
    if (!pzPath) {
      if (!base.detectionError)
        base.detectionError = 'Project Zomboid was not found in any Steam library.'
      return base
    }

    const workshopRoot = getWorkshopRoot(pzPath)
    const steamAppsDir = path.resolve(pzPath, '..', '..')

    base.found = true
    base.pzPath = pzPath
    base.currentHeapMB = await readCurrentHeapMB(pzPath)
    base.workshopRoot = workshopRoot
    base.canWriteGame =
      (await canWritePath(pzPath)) &&
      (await canWritePath(steamAppsDir)) &&
      ((await canWritePath(workshopRoot)) || (await canWritePath(path.dirname(workshopRoot))))

    return base
  } catch (error) {
    base.detectionError = error instanceof Error ? error.message : String(error)
    return base
  }
}

import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Catalog } from '@easypz/catalog'
import { getPack } from '@easypz/catalog'
import type { AppPaths } from './paths.js'
import { storeModPath } from './paths.js'
import { hasModInfo } from './archive.js'
import type { EventSink } from './events.js'
import { EasyPzError, cancelledError, toError } from './errors.js'
import type { InstalledMod } from './state.js'

const execFileAsync = promisify(execFile)
const STEAMCMD_URL = 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip'
const APP_ID = '108600'

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

export function getSteamCmdDir(paths: AppPaths): string {
  return path.join(paths.easyPzDir, 'steamcmd')
}

export function getSteamCmdContentRoot(paths: AppPaths, workshopId: string): string {
  return path.join(getSteamCmdDir(paths), 'steamapps', 'workshop', 'content', APP_ID, workshopId)
}

export function getSteamClientContentRoot(workshopRoot: string, workshopId: string): string {
  return path.join(workshopRoot, workshopId)
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

export async function ensureSteamCmd(
  paths: AppPaths,
  onEvent?: EventSink,
  signal?: AbortSignal,
): Promise<string> {
  const dir = getSteamCmdDir(paths)
  const exe = path.join(dir, 'steamcmd.exe')
  if (await pathExists(exe)) return exe

  onEvent?.({
    type: 'log',
    level: 'info',
    message: 'Downloading SteamCMD for Workshop downloads...',
  })
  await fs.mkdir(dir, { recursive: true })
  const zip = path.join(dir, 'steamcmd.zip')

  if (signal?.aborted) throw cancelledError()
  const response = await fetch(STEAMCMD_URL, {
    headers: { 'User-Agent': 'EasyPZ-Mod-Installer/0.1.0' },
    signal,
  })
  if (!response.ok) {
    throw new EasyPzError('IO', `Could not download SteamCMD (HTTP ${response.status}).`)
  }
  await fs.writeFile(zip, Buffer.from(await response.arrayBuffer()))

  try {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath ${psQuote(zip)} -DestinationPath ${psQuote(dir)} -Force`,
      ],
      { windowsHide: true },
    )
  } catch (error) {
    throw new EasyPzError('IO', `Could not extract SteamCMD: ${toError(error).message}`, {
      cause: toError(error),
    })
  } finally {
    await fs.rm(zip, { force: true })
  }

  if (!(await pathExists(exe))) {
    throw new EasyPzError('IO', 'SteamCMD was downloaded but steamcmd.exe was not found.')
  }
  return exe
}

async function runSteamCmdBatch(
  steamCmd: string,
  ids: string[],
  signal?: AbortSignal,
): Promise<number> {
  if (ids.length === 0) return 0
  const args = ['+login', 'anonymous']
  for (const id of ids) args.push('+workshop_download_item', APP_ID, id)
  args.push('+quit')

  return new Promise((resolve, reject) => {
    const child = spawn(steamCmd, args, {
      cwd: path.dirname(steamCmd),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let settled = false
    const finish = (code: number, error?: Error): void => {
      if (settled) return
      settled = true
      if (signal) signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else resolve(code)
    }
    const onAbort = (): void => {
      child.kill()
      finish(-1, cancelledError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.on('error', (error) => finish(-1, error))
    child.on('close', (code) => finish(code ?? -1))
  })
}

interface DiscoveredMod {
  id: string
  name: string
  folder: string
  workshopId: string
  serverOnly: boolean
  source: string
}

async function parseModInfo(
  file: string,
  fallbackId: string,
): Promise<{ id: string; name: string }> {
  try {
    const raw = await fs.readFile(file, 'utf8')
    const values: Record<string, string> = {}
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([^=#]+?)\s*=\s*(.*)\s*$/)
      if (match) values[match[1]!.trim().toLowerCase()] = match[2]!.trim()
    }
    return {
      id: values.id || fallbackId,
      name: values.name || fallbackId,
    }
  } catch {
    return { id: fallbackId, name: fallbackId }
  }
}

export async function discoverItemMods(
  itemRoot: string,
  workshopId: string,
): Promise<DiscoveredMod[]> {
  const mods: DiscoveredMod[] = []
  const modsRoot = path.join(itemRoot, 'mods')

  if (await pathExists(modsRoot)) {
    const entries = await fs.readdir(modsRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const folderPath = path.join(modsRoot, entry.name)
      if (!(await hasModInfo(folderPath))) continue
      const infoFile = path.join(folderPath, 'mod.info')
      const info = await parseModInfo(infoFile, entry.name)
      mods.push({
        id: info.id,
        name: info.name,
        folder: entry.name,
        workshopId,
        serverOnly: false,
        source: folderPath,
      })
    }
  }

  if (mods.length === 0 && (await hasModInfo(itemRoot))) {
    const folder = path.basename(itemRoot)
    const info = await parseModInfo(path.join(itemRoot, 'mod.info'), folder)
    mods.push({
      id: info.id,
      name: info.name,
      folder,
      workshopId,
      serverOnly: false,
      source: itemRoot,
    })
  }

  return mods
}

function findItemRoot(workshopId: string, workshopRoot: string, paths: AppPaths): string | null {
  const candidates = [
    getSteamClientContentRoot(workshopRoot, workshopId),
    getSteamCmdContentRoot(paths, workshopId),
  ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

export interface WorkshopInstallResult {
  mods: InstalledMod[]
  downloadedItems: number
  failedItems: Array<{ id: string; name: string; reason: string }>
}

export async function downloadWorkshopPack(options: {
  catalog: Catalog
  packId: string
  paths: AppPaths
  workshopRoot: string
  signal?: AbortSignal
  onEvent?: EventSink
}): Promise<WorkshopInstallResult> {
  const { catalog, packId, paths, workshopRoot, signal, onEvent } = options
  const pack = getPack(catalog, packId)
  const collection = pack.workshop
  if (!collection) {
    throw new EasyPzError('IO', 'Workshop pack is missing collection metadata.')
  }

  const steamCmd = await ensureSteamCmd(paths, onEvent, signal)
  const items = collection.items
  const failedItems: Array<{ id: string; name: string; reason: string }> = []
  const discovered: DiscoveredMod[] = []
  let downloadedItems = 0
  let processed = 0

  const emitProgress = (name: string): void => {
    onEvent?.({
      type: 'progress',
      stage: 'workshop',
      percent: (processed / items.length) * 100,
      transferred: processed,
      total: items.length,
    })
    onEvent?.({
      type: 'log',
      level: 'info',
      message: `Workshop ${processed}/${items.length}: ${name}`,
    })
  }

  const batchSize = 5
  for (let offset = 0; offset < items.length; offset += batchSize) {
    if (signal?.aborted) throw cancelledError()
    const batch = items.slice(offset, offset + batchSize)
    const missing: typeof batch = []

    for (const item of batch) {
      const root = findItemRoot(item.id, workshopRoot, paths)
      if (!root) {
        missing.push(item)
      }
    }

    if (missing.length > 0) {
      onEvent?.({
        type: 'log',
        level: 'info',
        message: `Downloading ${missing.length} Workshop item(s) with SteamCMD...`,
      })
      await runSteamCmdBatch(
        steamCmd,
        missing.map((item) => item.id),
        signal,
      )
    }

    for (const item of batch) {
      ensureNotCancelled(signal)
      const root = findItemRoot(item.id, workshopRoot, paths)
      if (!root) {
        failedItems.push({ id: item.id, name: item.name, reason: 'SteamCMD did not download it.' })
        processed += 1
        emitProgress(item.name)
        continue
      }

      try {
        const itemMods = await discoverItemMods(root, item.id)
        if (itemMods.length === 0) {
          failedItems.push({ id: item.id, name: item.name, reason: 'No mod.info found.' })
        } else {
          for (const mod of itemMods) {
            const destination = storeModPath(paths, mod.workshopId, mod.folder)
            if (!(await hasModInfo(destination))) {
              await fs.mkdir(path.dirname(destination), { recursive: true })
              await fs.cp(mod.source, destination, { recursive: true, force: true })
            }
            discovered.push(mod)
          }
          downloadedItems += 1

          const steamCmdContent = getSteamCmdContentRoot(paths, item.id)
          if (path.resolve(root) === path.resolve(steamCmdContent)) {
            await fs.rm(root, { recursive: true, force: true }).catch(() => undefined)
          }
        }
      } catch (error) {
        failedItems.push({ id: item.id, name: item.name, reason: toError(error).message })
      }

      processed += 1
      emitProgress(item.name)
    }
  }

  const seen = new Set<string>()
  const folderSeen = new Set<string>()
  const mods: InstalledMod[] = []
  for (const mod of discovered) {
    const key = `${mod.workshopId}:${mod.folder}`
    if (seen.has(key)) continue
    if (folderSeen.has(mod.folder)) {
      onEvent?.({
        type: 'warning',
        message: `Skipped duplicate mod folder "${mod.folder}" from Workshop item ${mod.workshopId}.`,
      })
      continue
    }
    seen.add(key)
    folderSeen.add(mod.folder)
    mods.push({
      id: mod.id,
      name: mod.name,
      folder: mod.folder,
      workshopId: mod.workshopId,
      serverOnly: mod.serverOnly,
    })
  }

  if (mods.length === 0) {
    throw new EasyPzError(
      'MISSING_MODS',
      'No Workshop mods were downloaded. Check your connection and SteamCMD, then try again.',
    )
  }

  onEvent?.({
    type: 'log',
    level: failedItems.length > 0 ? 'warn' : 'info',
    message: `Workshop download finished: ${mods.length} mods, ${downloadedItems}/${items.length} items, ${failedItems.length} failed.`,
  })

  return { mods, downloadedItems, failedItems }
}

function ensureNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError()
}

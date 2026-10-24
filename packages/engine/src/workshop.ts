import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Catalog } from '@easypz/catalog'
import { getPack } from '@easypz/catalog'
import type { AppPaths } from './paths.js'
import { storeModPath } from './paths.js'
import { findFileRecursive, hasModInfo } from './archive.js'
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

export function getStoreItemRoot(paths: AppPaths, workshopId: string): string {
  return path.join(paths.storeDir, APP_ID, workshopId)
}

const WORKSHOP_META_FILE = '.easypz-workshop-meta.json'
const WORKSHOP_META_SCHEMA = 1
const WORKSHOP_DETAILS_URL =
  'https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/'
const WORKSHOP_UPDATE_TOLERANCE_MS = 60_000

export interface WorkshopRemoteMeta {
  timeUpdated: number
  fileSize: number
}

export interface WorkshopLocalMeta {
  schemaVersion: number
  id: string
  timeUpdated: number | null
  fileSize: number | null
  manifestHash: string
  fileCount: number
  totalBytes: number
  maxMtime: number
}

export interface WorkshopManifest {
  manifestHash: string
  fileCount: number
  totalBytes: number
  maxMtime: number
}

/**
 * A cached Workshop item is stale when Steam reports a different revision or
 * size than the one recorded when it was installed here.
 */
export function needsWorkshopRefresh(
  local: WorkshopLocalMeta | null,
  remote: WorkshopRemoteMeta | null,
): boolean {
  if (!local) return true
  if (!remote) return false
  if (remote.timeUpdated > 0 && local.timeUpdated !== remote.timeUpdated) return true
  if (remote.fileSize > 0 && local.fileSize !== remote.fileSize) return true
  return false
}

/**
 * Migration check for stores created before metadata was recorded: a store
 * whose newest file predates the Workshop revision is assumed stale.
 */
export function workshopStoreLooksOlder(
  manifest: Pick<WorkshopManifest, 'maxMtime'>,
  remote: WorkshopRemoteMeta | null,
): boolean {
  if (!remote || remote.timeUpdated <= 0) return false
  return (
    manifest.maxMtime > 0 &&
    remote.timeUpdated * 1000 > manifest.maxMtime + WORKSHOP_UPDATE_TOLERANCE_MS
  )
}

export async function computeItemManifest(
  root: string,
  options: { hashContents?: boolean } = {},
): Promise<WorkshopManifest> {
  const entries: string[] = []
  let fileCount = 0
  let totalBytes = 0
  let maxMtime = 0

  const walk = async (directory: string, relative: string): Promise<void> => {
    let dirents
    try {
      dirents = await fs.readdir(directory, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of dirents) {
      if (entry.name === WORKSHOP_META_FILE || entry.name === '.easypz-workshop-complete') continue
      const full = path.join(directory, entry.name)
      const rel = relative ? `${relative}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(full, rel)
        continue
      }
      if (!entry.isFile()) continue
      try {
        const stat = await fs.stat(full)
        fileCount += 1
        totalBytes += stat.size
        maxMtime = Math.max(maxMtime, stat.mtimeMs)
        if (options.hashContents) {
          const fileHash = createHash('sha256')
            .update(await fs.readFile(full))
            .digest('hex')
          entries.push(`${rel}|${stat.size}|${fileHash}`)
        } else {
          entries.push(`${rel}|${stat.size}`)
        }
      } catch {
        // Skip files that disappear while the manifest is built.
      }
    }
  }

  await walk(root, '')
  entries.sort()
  const manifestHash = createHash('sha256').update(entries.join('\n')).digest('hex')
  return { manifestHash, fileCount, totalBytes, maxMtime }
}

export async function readWorkshopItemMeta(
  paths: AppPaths,
  workshopId: string,
): Promise<WorkshopLocalMeta | null> {
  try {
    const raw = await fs.readFile(
      path.join(getStoreItemRoot(paths, workshopId), WORKSHOP_META_FILE),
      'utf8',
    )
    const parsed = JSON.parse(raw) as WorkshopLocalMeta
    if (parsed.schemaVersion !== WORKSHOP_META_SCHEMA || parsed.id !== workshopId) return null
    return parsed
  } catch {
    return null
  }
}

export async function writeWorkshopItemMeta(
  paths: AppPaths,
  workshopId: string,
  meta: WorkshopLocalMeta,
): Promise<void> {
  const root = getStoreItemRoot(paths, workshopId)
  await fs.mkdir(root, { recursive: true })
  await fs.writeFile(
    path.join(root, WORKSHOP_META_FILE),
    `${JSON.stringify(meta, null, 2)}\n`,
    'utf8',
  )
}

async function fetchWorkshopRemoteMeta(ids: string[]): Promise<Map<string, WorkshopRemoteMeta>> {
  const result = new Map<string, WorkshopRemoteMeta>()
  if (ids.length === 0) return result

  const body = new URLSearchParams()
  body.set('itemcount', String(ids.length))
  ids.forEach((id, index) => body.set(`publishedfileids[${index}]`, id))

  try {
    const response = await fetch(WORKSHOP_DETAILS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) return result
    const payload = (await response.json()) as {
      response?: {
        publishedfiledetails?: Array<{
          publishedfileid?: string
          time_updated?: number
          file_size?: number
        }>
      }
    }
    for (const detail of payload.response?.publishedfiledetails ?? []) {
      if (!detail.publishedfileid) continue
      result.set(detail.publishedfileid, {
        timeUpdated: Number(detail.time_updated ?? 0),
        fileSize: Number(detail.file_size ?? 0),
      })
    }
  } catch {
    // Offline metadata is best-effort; local manifest checks still apply.
  }
  return result
}

/**
 * SteamCMD tracks every Workshop item in a shared depot state file. If that
 * state points at files that were moved or deleted outside SteamCMD, later
 * downloads fail with "Missing game files". Removing the state file makes
 * SteamCMD rebuild it from the items it is asked to download.
 */
async function resetSteamCmdWorkshopState(paths: AppPaths): Promise<void> {
  const workshopDir = path.join(getSteamCmdDir(paths), 'steamapps', 'workshop')
  const stateFile = path.join(workshopDir, `appworkshop_${APP_ID}.acf`)
  const downloadsDir = path.join(workshopDir, 'downloads', APP_ID)
  await fs.rm(stateFile, { force: true }).catch(() => undefined)
  await fs.rm(downloadsDir, { recursive: true, force: true }).catch(() => undefined)
}

function getProgressPath(paths: AppPaths): string {
  return path.join(paths.stateDir, 'workshop-progress.json')
}

export interface SteamCmdProgress {
  percent: number
  transferredBytes: number
  totalBytes: number
}

export function parseSteamCmdProgress(line: string): SteamCmdProgress | null {
  const match = /progress:\s*([\d.]+)\s*\((\d+)\s*\/\s*(\d+)\)/i.exec(line)
  if (!match) return null
  const percent = Number(match[1])
  const transferredBytes = Number(match[2])
  const totalBytes = Number(match[3])
  if (
    !Number.isFinite(percent) ||
    !Number.isFinite(transferredBytes) ||
    !Number.isFinite(totalBytes)
  ) {
    return null
  }
  return { percent, transferredBytes, totalBytes }
}

export function parseSteamCmdDownloadedBytes(line: string): number | null {
  const match = /Success\. Downloaded item \d+ .*?\((\d+) bytes\)/i.exec(line)
  if (!match) return null
  const bytes = Number(match[1])
  return Number.isFinite(bytes) ? bytes : null
}

interface WorkshopProgress {
  packId: string
  collectionId: string
  completedItemIds: string[]
  updatedAt: string
}

async function readProgress(paths: AppPaths): Promise<WorkshopProgress | null> {
  try {
    return JSON.parse(await fs.readFile(getProgressPath(paths), 'utf8')) as WorkshopProgress
  } catch {
    return null
  }
}

async function writeProgress(
  paths: AppPaths,
  packId: string,
  collectionId: string,
  completedItemIds: string[],
): Promise<void> {
  await fs.mkdir(paths.stateDir, { recursive: true })
  const progress: WorkshopProgress = {
    packId,
    collectionId,
    completedItemIds,
    updatedAt: new Date().toISOString(),
  }
  await fs.writeFile(getProgressPath(paths), `${JSON.stringify(progress, null, 2)}\n`, 'utf8')
}

async function clearProgress(paths: AppPaths): Promise<void> {
  await fs.rm(getProgressPath(paths), { force: true })
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

const STEAMCMD_IDLE_TIMEOUT_MS = 5 * 60 * 1000
const STEAMCMD_TOTAL_TIMEOUT_MS = 30 * 60 * 1000
const WORKSHOP_BATCH_SIZE = 8
const WORKSHOP_BATCH_MAX_ITEM_BYTES = 25 * 1024 * 1024

/**
 * SteamCMD prints a lot of status noise while it works. Only meaningful
 * progress or phase lines count as activity, so a process that is alive but
 * no longer transferring data can still hit the idle timeout.
 */
function isSteamCmdActivityLine(line: string): boolean {
  return /progress:|update state|committing|preallocating|staging|downloading|verifying|success\. downloaded/i.test(
    line,
  )
}

function summarizeSteamCmdOutput(output: string): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.slice(-4).join(' | ').slice(-400)
}

export interface SteamCmdItemProgress {
  id: string
  percent: number
  transferredBytes: number
  totalBytes: number
  bytesPerSecond?: number
  etaSeconds?: number
}

export interface SteamCmdItemsResult {
  code: number
  output: string
  timedOut: boolean
  downloadedBytes: number | null
  failedIds: string[]
}

/**
 * Runs one SteamCMD process for one or more Workshop items. Batching several
 * items avoids paying SteamCMD's login/validation startup cost for every mod.
 */
export async function runSteamCmdItems(options: {
  steamCmd: string
  ids: string[]
  signal?: AbortSignal
  onItemStart?: (id: string) => void
  onProgress?: (progress: SteamCmdItemProgress) => void
}): Promise<SteamCmdItemsResult> {
  const { steamCmd, ids, signal, onItemStart, onProgress } = options
  if (ids.length === 0) {
    return { code: 0, output: '', timedOut: false, downloadedBytes: null, failedIds: [] }
  }

  const args = [
    '+login',
    'anonymous',
    ...ids.flatMap((id) => ['+workshop_download_item', APP_ID, id]),
    '+quit',
  ]
  const idSet = new Set(ids)

  return new Promise((resolve, reject) => {
    const child = spawn(steamCmd, args, {
      cwd: path.dirname(steamCmd),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let settled = false
    let output = ''
    let lineBuffer = ''
    let idleTimer: NodeJS.Timeout | null = null
    const startedAt = Date.now()
    let lastBytes = 0
    let lastTick = startedAt
    let currentId = ids[0]!
    let downloadedBytes = 0
    const completedIds = new Set<string>()
    const failedIds = new Set<string>()

    const nextPendingId = (): string | null =>
      ids.find((id) => !completedIds.has(id) && !failedIds.has(id)) ?? null

    const setCurrentId = (id: string | null): void => {
      if (!id || id === currentId) return
      currentId = id
      onItemStart?.(id)
    }

    onItemStart?.(currentId)

    const resetIdle = (): void => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => {
        child.kill()
        finish(-1, true)
      }, STEAMCMD_IDLE_TIMEOUT_MS)
    }

    const append = (chunk: Buffer): void => {
      const text = chunk.toString('utf8')
      output += text
      if (output.length > 20_000) output = output.slice(-20_000)

      lineBuffer += text
      const lines = lineBuffer.split(/\r|\n/)
      lineBuffer = lines.pop() ?? ''
      let sawActivity = false
      for (const line of lines) {
        if (isSteamCmdActivityLine(line)) sawActivity = true

        const startMatch = /Downloading item (\d+)/i.exec(line)
        if (startMatch && idSet.has(startMatch[1]!)) setCurrentId(startMatch[1]!)

        const successMatch = /Success\. Downloaded item (\d+)/i.exec(line)
        if (successMatch && idSet.has(successMatch[1]!)) {
          const id = successMatch[1]!
          completedIds.add(id)
          const bytes = parseSteamCmdDownloadedBytes(line)
          if (bytes !== null) downloadedBytes += bytes
          setCurrentId(nextPendingId())
        }

        const failureMatch =
          /(?:ERROR! Download item|Download item) (\d+)[^\r\n]*(?:failed|result : Failure)/i.exec(
            line,
          )
        if (failureMatch && idSet.has(failureMatch[1]!)) {
          const id = failureMatch[1]!
          failedIds.add(id)
          setCurrentId(nextPendingId())
        }

        const progress = parseSteamCmdProgress(line)
        if (!progress) continue
        const now = Date.now()
        const elapsed = Math.max((now - startedAt) / 1000, 0.001)
        const instant =
          now - lastTick > 0
            ? ((progress.transferredBytes - lastBytes) * 1000) / (now - lastTick)
            : 0
        const bytesPerSecond = instant > 0 ? instant : progress.transferredBytes / elapsed
        const etaSeconds =
          progress.totalBytes > 0 && bytesPerSecond > 0
            ? Math.max(0, (progress.totalBytes - progress.transferredBytes) / bytesPerSecond)
            : undefined
        onProgress?.({ id: currentId, ...progress, bytesPerSecond, etaSeconds })
        lastBytes = progress.transferredBytes
        lastTick = now
      }

      if (sawActivity) resetIdle()
    }

    const totalTimer = setTimeout(() => {
      child.kill()
      finish(-1, true)
    }, STEAMCMD_TOTAL_TIMEOUT_MS)

    const finish = (code: number, timedOut = false, error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(totalTimer)
      if (idleTimer) clearTimeout(idleTimer)
      if (signal) signal.removeEventListener('abort', onAbort)
      if (error) reject(error)
      else
        resolve({
          code,
          output,
          timedOut,
          downloadedBytes:
            downloadedBytes > 0 ? downloadedBytes : parseSteamCmdDownloadedBytes(output),
          failedIds: [...failedIds],
        })
    }
    const onAbort = (): void => {
      child.kill()
      finish(-1, false, cancelledError())
    }

    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    signal?.addEventListener('abort', onAbort, { once: true })
    resetIdle()

    child.on('error', (error) => finish(-1, false, error))
    child.on('close', (code) => finish(code ?? -1))
  })
}

export async function runSteamCmdItem(
  steamCmd: string,
  id: string,
  signal?: AbortSignal,
  onProgress?: (progress: {
    percent: number
    transferredBytes: number
    totalBytes: number
    bytesPerSecond?: number
    etaSeconds?: number
  }) => void,
): Promise<{ code: number; output: string; timedOut: boolean; downloadedBytes: number | null }> {
  const result = await runSteamCmdItems({
    steamCmd,
    ids: [id],
    signal,
    onProgress: (progress) => {
      const { id: _id, ...rest } = progress
      onProgress?.(rest)
    },
  })
  return {
    code: result.code,
    output: result.output,
    timedOut: result.timedOut,
    downloadedBytes: result.downloadedBytes,
  }
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

export function filterExcludedMods<T extends { id: string }>(
  mods: T[],
  excludeModIds: string[] | undefined,
): T[] {
  if (!excludeModIds || excludeModIds.length === 0) return mods
  const excluded = new Set(excludeModIds)
  return mods.filter((mod) => !excluded.has(mod.id))
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
      const infoFile =
        (await findFileRecursive(folderPath, 'mod.info')) ?? path.join(folderPath, 'mod.info')
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

async function hasDiscoverableMods(root: string): Promise<boolean> {
  if (await hasModInfo(root)) return true
  const modsRoot = path.join(root, 'mods')
  try {
    const entries = await fs.readdir(modsRoot, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (await hasModInfo(path.join(modsRoot, entry.name))) return true
    }
  } catch {
    // No mods folder.
  }
  return false
}

export async function findItemRoot(
  workshopId: string,
  workshopRoot: string,
  paths: AppPaths,
): Promise<string | null> {
  const candidates = [
    getStoreItemRoot(paths, workshopId),
    getSteamCmdContentRoot(paths, workshopId),
    getSteamClientContentRoot(workshopRoot, workshopId),
  ]
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    if (await hasDiscoverableMods(candidate)) return candidate
  }
  return null
}

export interface WorkshopInstallResult {
  mods: InstalledMod[]
  downloadedItems: number
  cachedItems: number
  downloadedBytes: number
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

  const items = collection.items
  const remoteMeta = await fetchWorkshopRemoteMeta(items.map((item) => item.id))
  const refreshIds = new Set<string>()

  for (const item of items) {
    const storeRoot = getStoreItemRoot(paths, item.id)
    if (!existsSync(storeRoot)) {
      refreshIds.add(item.id)
      continue
    }

    const localMeta = await readWorkshopItemMeta(paths, item.id)
    const remote = remoteMeta.get(item.id) ?? null

    if (localMeta) {
      const manifest = await computeItemManifest(storeRoot)
      const metadataChanged = needsWorkshopRefresh(localMeta, remote)
      const filesChanged =
        manifest.manifestHash !== localMeta.manifestHash ||
        manifest.fileCount !== localMeta.fileCount ||
        manifest.totalBytes !== localMeta.totalBytes
      if (metadataChanged || filesChanged) {
        refreshIds.add(item.id)
        await fs.rm(storeRoot, { recursive: true, force: true }).catch(() => undefined)
      }
      continue
    }

    const manifest = await computeItemManifest(storeRoot)
    if (manifest.fileCount === 0 || workshopStoreLooksOlder(manifest, remote)) {
      refreshIds.add(item.id)
      await fs.rm(storeRoot, { recursive: true, force: true }).catch(() => undefined)
      continue
    }

    await writeWorkshopItemMeta(paths, item.id, {
      schemaVersion: WORKSHOP_META_SCHEMA,
      id: item.id,
      timeUpdated: remote?.timeUpdated ?? null,
      fileSize: remote?.fileSize ?? null,
      ...manifest,
    })
  }

  if (refreshIds.size > 0) {
    onEvent?.({
      type: 'log',
      level: 'info',
      message: `Refreshing ${refreshIds.size} Workshop item(s) whose files are missing or out of date.`,
    })
  }

  const failedItems: Array<{ id: string; name: string; reason: string }> = []
  const discovered: DiscoveredMod[] = []
  let downloadedItems = 0
  let cachedItems = 0
  let downloadedBytes = 0
  let processed = 0

  let storedCount = 0
  for (const item of items) {
    if (await findItemRoot(item.id, workshopRoot, paths)) storedCount += 1
  }
  const previousProgress = await readProgress(paths)
  if (
    storedCount > 0 ||
    (previousProgress?.packId === packId &&
      previousProgress.collectionId === collection.collectionId &&
      previousProgress.completedItemIds.length > 0)
  ) {
    onEvent?.({
      type: 'log',
      level: 'info',
      message: `Resuming Workshop collection: ${storedCount}/${items.length} items already stored.`,
    })
  }

  const completedIds = new Set<string>(
    previousProgress?.packId === packId && previousProgress.collectionId === collection.collectionId
      ? previousProgress.completedItemIds
      : [],
  )

  onEvent?.({
    type: 'progress',
    stage: 'workshop',
    percent: 0,
    transferred: 0,
    total: items.length,
    downloaded: 0,
    cached: storedCount,
    failed: 0,
  })
  onEvent?.({
    type: 'log',
    level: 'info',
    message: 'Preparing SteamCMD for Workshop downloads...',
  })
  const steamCmd = await ensureSteamCmd(paths, onEvent, signal)

  const emitProgress = (name: string): void => {
    onEvent?.({
      type: 'stage',
      stage: 'workshop',
      status: 'start',
      detail: `${processed}/${items.length} - ${name}`,
    })
    onEvent?.({
      type: 'progress',
      stage: 'workshop',
      percent: (processed / items.length) * 100,
      transferred: processed,
      total: items.length,
      downloaded: Math.max(0, downloadedItems - cachedItems),
      cached: cachedItems,
      failed: failedItems.length,
    })
    onEvent?.({
      type: 'log',
      level: 'info',
      message: `Workshop ${processed}/${items.length}: ${name}`,
    })
  }

  const emitCurrentItem = (
    itemIndex: number,
    name: string,
    options: { updateOverall?: boolean } = {},
  ): void => {
    onEvent?.({
      type: 'stage',
      stage: 'workshop',
      status: 'start',
      detail: `${itemIndex}/${items.length} - ${name}`,
    })
    if (options.updateOverall === false) return
    onEvent?.({
      type: 'progress',
      stage: 'workshop',
      percent: (processed / items.length) * 100,
      transferred: processed,
      total: items.length,
      downloaded: Math.max(0, downloadedItems - cachedItems),
      cached: cachedItems,
      failed: failedItems.length,
    })
  }

  const prefetchedIds = new Set<string>()
  let prefetchedBytes = 0
  const batchCandidates: Array<{ item: (typeof items)[number]; index: number }> = []
  for (const [index, item] of items.entries()) {
    if ((item.sizeBytes ?? 0) > WORKSHOP_BATCH_MAX_ITEM_BYTES) continue
    if (refreshIds.has(item.id)) continue
    if (await findItemRoot(item.id, workshopRoot, paths)) continue
    batchCandidates.push({ item, index: index + 1 })
  }

  if (batchCandidates.length > 0) {
    onEvent?.({
      type: 'log',
      level: 'info',
      message: `Pre-downloading ${batchCandidates.length} small Workshop items in batches of ${WORKSHOP_BATCH_SIZE} to reduce SteamCMD startup overhead.`,
    })

    for (let offset = 0; offset < batchCandidates.length; offset += WORKSHOP_BATCH_SIZE) {
      ensureNotCancelled(signal)
      const batch = batchCandidates.slice(offset, offset + WORKSHOP_BATCH_SIZE)
      const byId = new Map(batch.map((entry) => [entry.item.id, entry]))
      const runBatch = (): Promise<SteamCmdItemsResult> =>
        runSteamCmdItems({
          steamCmd,
          ids: batch.map((entry) => entry.item.id),
          signal,
          onItemStart: (id) => {
            const entry = byId.get(id)
            if (!entry) return
            emitCurrentItem(entry.index, entry.item.name, { updateOverall: false })
            onEvent?.({
              type: 'workshop-item',
              item: {
                index: entry.index,
                total: items.length,
                name: entry.item.name,
                status: 'starting',
                percent: null,
                totalBytes: entry.item.sizeBytes,
              },
            })
          },
          onProgress: (progress) => {
            const entry = byId.get(progress.id)
            if (!entry) return
            onEvent?.({
              type: 'workshop-item',
              item: {
                index: entry.index,
                total: items.length,
                name: entry.item.name,
                status: 'downloading',
                percent: progress.percent,
                transferredBytes: progress.transferredBytes,
                totalBytes: progress.totalBytes,
                bytesPerSecond: progress.bytesPerSecond,
                etaSeconds: progress.etaSeconds,
              },
            })
          },
        })

      let result = await runBatch()
      if (result.output.includes('Missing game files')) {
        onEvent?.({
          type: 'log',
          level: 'warn',
          message:
            'SteamCMD reported missing depot files. Resetting its Workshop state and retrying this batch.',
        })
        await resetSteamCmdWorkshopState(paths)
        result = await runBatch()
      }

      if (result.timedOut) {
        onEvent?.({
          type: 'log',
          level: 'warn',
          message: `SteamCMD timed out while pre-downloading a batch; the remaining items will be retried one at a time.`,
        })
      }

      for (const entry of batch) {
        if (await findItemRoot(entry.item.id, workshopRoot, paths)) {
          prefetchedIds.add(entry.item.id)
          prefetchedBytes += entry.item.sizeBytes ?? 0
        }
      }
    }
  }

  for (const item of items) {
    ensureNotCancelled(signal)
    const itemIndex = processed + 1
    let root = refreshIds.has(item.id) ? null : await findItemRoot(item.id, workshopRoot, paths)
    const wasCached = Boolean(root) && !prefetchedIds.has(item.id)
    emitCurrentItem(itemIndex, item.name)

    onEvent?.({
      type: 'workshop-item',
      item: {
        index: itemIndex,
        total: items.length,
        name: item.name,
        status: wasCached ? 'done' : 'starting',
        percent: wasCached ? 100 : null,
        totalBytes: item.sizeBytes,
        transferredBytes: wasCached ? item.sizeBytes : undefined,
      },
    })

    if (!root) {
      onEvent?.({
        type: 'log',
        level: 'info',
        message: `Downloading Workshop item ${itemIndex}/${items.length}: ${item.name}`,
      })
      const downloadItem = () =>
        runSteamCmdItem(steamCmd, item.id, signal, (progress) => {
          onEvent?.({
            type: 'workshop-item',
            item: {
              index: itemIndex,
              total: items.length,
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
      let result = await downloadItem()
      root = await findItemRoot(item.id, workshopRoot, paths)
      if (!root && result.output.includes('Missing game files')) {
        onEvent?.({
          type: 'log',
          level: 'warn',
          message: `SteamCMD reported missing depot files for ${item.name}. Resetting its Workshop state and retrying.`,
        })
        await resetSteamCmdWorkshopState(paths)
        result = await downloadItem()
        root = await findItemRoot(item.id, workshopRoot, paths)
      }
      if (!root) {
        const reason = result.timedOut
          ? 'SteamCMD timed out or stalled on this item.'
          : `SteamCMD failed with code ${result.code}.`
        const detail = summarizeSteamCmdOutput(result.output)
        failedItems.push({ id: item.id, name: item.name, reason })
        onEvent?.({
          type: 'log',
          level: 'warn',
          message: `Workshop item ${itemIndex}/${items.length} failed: ${item.name} - ${reason}${
            detail ? ` SteamCMD said: ${detail}` : ''
          }`,
        })
        onEvent?.({
          type: 'workshop-item',
          item: {
            index: itemIndex,
            total: items.length,
            name: item.name,
            status: 'failed',
            percent: null,
            totalBytes: item.sizeBytes,
          },
        })
        processed += 1
        emitProgress(item.name)
        continue
      }
      downloadedBytes += result.downloadedBytes ?? item.sizeBytes ?? 0
    }

    try {
      const discoveredMods = await discoverItemMods(root, item.id)
      const itemMods = filterExcludedMods(discoveredMods, item.excludeModIds)
      if (discoveredMods.length === 0) {
        failedItems.push({ id: item.id, name: item.name, reason: 'No mod.info found.' })
        onEvent?.({
          type: 'workshop-item',
          item: {
            index: itemIndex,
            total: items.length,
            name: item.name,
            status: 'failed',
            percent: null,
            totalBytes: item.sizeBytes,
          },
        })
      } else {
        if (itemMods.length === 0) {
          onEvent?.({
            type: 'log',
            level: 'info',
            message: `All mods in ${item.name} are excluded by the catalog.`,
          })
        }
        for (const mod of itemMods) {
          const destination = storeModPath(paths, mod.workshopId, mod.folder)
          if (!(await hasModInfo(destination))) {
            await fs.mkdir(path.dirname(destination), { recursive: true })
            await fs.cp(mod.source, destination, { recursive: true, force: true })
          }
          discovered.push(mod)
        }
        downloadedItems += 1
        if (wasCached) cachedItems += 1
        onEvent?.({
          type: 'workshop-item',
          item: {
            index: itemIndex,
            total: items.length,
            name: item.name,
            status: 'done',
            percent: 100,
            transferredBytes: item.sizeBytes,
            totalBytes: item.sizeBytes,
          },
        })

        const storeRoot = getStoreItemRoot(paths, item.id)
        await fs.mkdir(storeRoot, { recursive: true })
        await fs.writeFile(
          path.join(storeRoot, '.easypz-workshop-complete'),
          `${new Date().toISOString()}\n`,
          'utf8',
        )
        const manifest = await computeItemManifest(storeRoot)
        const remote = remoteMeta.get(item.id) ?? null
        await writeWorkshopItemMeta(paths, item.id, {
          schemaVersion: WORKSHOP_META_SCHEMA,
          id: item.id,
          timeUpdated: remote?.timeUpdated ?? null,
          fileSize: remote?.fileSize ?? null,
          ...manifest,
        })
        completedIds.add(item.id)
        await writeProgress(paths, packId, collection.collectionId, [...completedIds])

        // Keep the SteamCMD copy. Depot 108600 is shared by every Workshop
        // item, so deleting one item's content makes later items fail with
        // "Missing game files" and forces expensive re-validation.
      }
    } catch (error) {
      failedItems.push({ id: item.id, name: item.name, reason: toError(error).message })
      onEvent?.({
        type: 'workshop-item',
        item: {
          index: itemIndex,
          total: items.length,
          name: item.name,
          status: 'failed',
          percent: null,
          totalBytes: item.sizeBytes,
        },
      })
    }

    processed += 1
    emitProgress(item.name)
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

  await clearProgress(paths)

  downloadedBytes += prefetchedBytes

  onEvent?.({
    type: 'log',
    level: failedItems.length > 0 ? 'warn' : 'info',
    message: `Workshop download finished: ${mods.length} mods, ${downloadedItems}/${items.length} items, ${failedItems.length} failed.`,
  })

  return { mods, downloadedItems, cachedItems, downloadedBytes, failedItems }
}

function ensureNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError()
}

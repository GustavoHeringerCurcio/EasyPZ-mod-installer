import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import fs from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import path from 'node:path'
import { EasyPzError, cancelledError, toError } from './errors.js'

export interface DownloadProgress {
  transferred: number
  total: number | null
  bytesPerSecond: number
  etaSeconds: number | null
}

export interface DownloadOptions {
  url: string
  destination: string
  expectedSha256: string
  expectedSize?: number
  signal?: AbortSignal
  onProgress?: (progress: DownloadProgress) => void
}

export async function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

export async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function matchesHash(file: string, expected: string): Promise<boolean> {
  try {
    return (await hashFile(file)) === expected
  } catch {
    return false
  }
}

function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError()
}

function report(
  callback: DownloadOptions['onProgress'],
  transferred: number,
  total: number | null,
  startedAt: number,
  lastTransferred: number,
  lastTick: number,
  force = false,
): { lastTransferred: number; lastTick: number } {
  const now = Date.now()
  if (!force && now - lastTick < 250) return { lastTransferred, lastTick }

  const seconds = Math.max((now - startedAt) / 1000, 0.001)
  const bytesPerSecond = transferred / seconds
  const instantSpeed =
    now - lastTick > 0 ? ((transferred - lastTransferred) * 1000) / (now - lastTick) : 0
  const speed = instantSpeed > 0 ? instantSpeed : bytesPerSecond
  const etaSeconds = total && speed > 0 ? Math.max(0, (total - transferred) / speed) : null

  callback?.({
    transferred,
    total: total ?? null,
    bytesPerSecond: speed,
    etaSeconds,
  })

  return { lastTransferred: transferred, lastTick: now }
}

export async function downloadFile(options: DownloadOptions): Promise<{ downloadedBytes: number }> {
  const { url, destination, expectedSha256, expectedSize, signal, onProgress } = options
  await fs.mkdir(path.dirname(destination), { recursive: true })

  if (await fileExists(destination)) {
    if (await matchesHash(destination, expectedSha256)) {
      const size = (await fs.stat(destination)).size
      onProgress?.({ transferred: size, total: size, bytesPerSecond: 0, etaSeconds: 0 })
      return { downloadedBytes: 0 }
    }
    await fs.rm(destination, { force: true })
  }

  const part = `${destination}.part`
  let existingBytes = 0
  try {
    existingBytes = (await fs.stat(part)).size
  } catch {
    existingBytes = 0
  }

  if (expectedSize && existingBytes > expectedSize) {
    await fs.rm(part, { force: true })
    existingBytes = 0
  }

  checkCancelled(signal)

  const headers: Record<string, string> = {
    'User-Agent': 'EasyPZ-Mod-Installer/0.1.0 (Windows)',
    Accept: 'application/octet-stream',
  }
  if (existingBytes > 0) headers.Range = `bytes=${existingBytes}-`

  let response: Response
  try {
    response = await fetch(url, { headers, redirect: 'follow', signal })
  } catch (error) {
    if (signal?.aborted) throw cancelledError()
    throw new EasyPzError('IO', `Download failed: ${toError(error).message}`, {
      cause: toError(error),
    })
  }

  let append = false
  if (response.status === 206 && existingBytes > 0) {
    append = true
  } else if (response.status === 416 && existingBytes > 0) {
    if (await matchesHash(part, expectedSha256)) {
      await fs.rename(part, destination)
      const size = (await fs.stat(destination)).size
      onProgress?.({ transferred: size, total: size, bytesPerSecond: 0, etaSeconds: 0 })
      return { downloadedBytes: 0 }
    }
    await fs.rm(part, { force: true })
    existingBytes = 0
    return downloadFile(options)
  } else if (!response.ok) {
    throw new EasyPzError('IO', `Download failed with HTTP ${response.status} from ${url}`)
  }

  if (!response.body) {
    throw new EasyPzError('IO', 'Download response had no body.')
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0)
  const total =
    contentLength > 0 ? contentLength + (append ? existingBytes : 0) : (expectedSize ?? null)

  let handle: FileHandle
  try {
    handle = await fs.open(part, append ? 'a' : 'w')
  } catch (error) {
    throw new EasyPzError('IO', `Could not open download file: ${toError(error).message}`, {
      cause: toError(error),
    })
  }

  const startedAt = Date.now()
  let transferred = append ? existingBytes : 0
  let lastTransferred = transferred
  let lastTick = startedAt

  try {
    for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
      checkCancelled(signal)
      await handle.write(chunk)
      transferred += chunk.byteLength
      const tick = report(onProgress, transferred, total, startedAt, lastTransferred, lastTick)
      lastTransferred = tick.lastTransferred
      lastTick = tick.lastTick
    }
  } catch (error) {
    if (signal?.aborted) throw cancelledError()
    throw new EasyPzError('IO', `Download interrupted: ${toError(error).message}`, {
      cause: toError(error),
    })
  } finally {
    await handle.close()
  }

  report(onProgress, transferred, total, startedAt, lastTransferred, lastTick, true)

  const actual = await hashFile(part)
  if (actual !== expectedSha256) {
    await fs.rm(part, { force: true })
    throw new EasyPzError(
      'ARCHIVE_HASH_MISMATCH',
      `Downloaded archive hash does not match. Expected ${expectedSha256}, got ${actual}.`,
    )
  }

  await fs.rename(part, destination)
  return { downloadedBytes: transferred }
}

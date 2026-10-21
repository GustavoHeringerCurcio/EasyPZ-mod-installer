import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { catalogSchema, type Catalog } from '@easypz/catalog'
import type { CatalogView } from '../shared/ipc'

const DEFAULT_REMOTE_CATALOG_URL =
  'https://raw.githubusercontent.com/GustavoHeringerCurcio/EasyPZ-assets/main/catalog/index.json'

let activeBaseUrl: string | null = null
let activeSource: 'remote' | 'bundled' = 'bundled'
let cached: { catalog: Catalog; at: number } | null = null

export function resolveCatalogDir(): string {
  if (process.env.EASYPZ_CATALOG_DIR) {
    return path.resolve(process.env.EASYPZ_CATALOG_DIR)
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'catalog')
  }
  return path.resolve(app.getAppPath(), '..', '..', 'catalog')
}

async function readBundledCatalog(): Promise<Catalog> {
  const raw = await fs.readFile(path.join(resolveCatalogDir(), 'index.json'), 'utf8')
  return catalogSchema.parse(JSON.parse(raw))
}

async function fetchRemoteCatalog(url: string): Promise<{ catalog: Catalog; baseUrl: string }> {
  const response = await fetch(url, {
    headers: { 'User-Agent': `EasyPZ-Mod-Installer/${app.getVersion()}` },
    signal: AbortSignal.timeout(8000),
  })
  if (!response.ok) {
    throw new Error(`Catalog download failed with HTTP ${response.status}`)
  }
  const catalog = catalogSchema.parse(await response.json())
  return { catalog, baseUrl: new URL('.', url).toString() }
}

export async function loadCatalog(): Promise<Catalog> {
  if (cached && Date.now() - cached.at < 60_000) return cached.catalog

  const remoteUrl = process.env.EASYPZ_CATALOG_URL ?? DEFAULT_REMOTE_CATALOG_URL
  if (remoteUrl) {
    try {
      const remote = await fetchRemoteCatalog(remoteUrl)
      activeBaseUrl = remote.baseUrl
      activeSource = 'remote'
      cached = { catalog: remote.catalog, at: Date.now() }
      return remote.catalog
    } catch (error) {
      console.warn(
        `Remote catalog unavailable; using the bundled catalog: ${(error as Error).message}`,
      )
    }
  }

  const bundled = await readBundledCatalog()
  activeBaseUrl = null
  activeSource = 'bundled'
  cached = { catalog: bundled, at: Date.now() }
  return bundled
}

export function getCatalogSource(): { baseUrl: string | null; source: 'remote' | 'bundled' } {
  return { baseUrl: activeBaseUrl, source: activeSource }
}

function mimeFor(file: string): string {
  const extension = path.extname(file).toLowerCase()
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  return 'image/png'
}

async function readBundledCover(relativePath: string): Promise<string | null> {
  try {
    const file = path.join(resolveCatalogDir(), relativePath)
    const bytes = await fs.readFile(file)
    return `data:${mimeFor(file)};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
}

async function readCover(relativePath: string): Promise<string | null> {
  if (activeBaseUrl) {
    try {
      const response = await fetch(new URL(relativePath, activeBaseUrl), {
        headers: { 'User-Agent': `EasyPZ-Mod-Installer/${app.getVersion()}` },
        signal: AbortSignal.timeout(8000),
      })
      if (response.ok) {
        const contentType = response.headers.get('content-type') ?? 'image/png'
        const bytes = Buffer.from(await response.arrayBuffer())
        return `data:${contentType.split(';')[0]};base64,${bytes.toString('base64')}`
      }
    } catch {
      // Fall back to the bundled cover.
    }
  }

  return readBundledCover(relativePath)
}

export async function toCatalogView(catalog: Catalog): Promise<CatalogView> {
  const packs = await Promise.all(
    catalog.packs.map(async (pack) => ({
      ...pack,
      coverDataUrl: await readCover(pack.cover),
    })),
  )

  return {
    schemaVersion: catalog.schemaVersion,
    mode: catalog.mode,
    generatedAt: catalog.generatedAt,
    packs,
  }
}

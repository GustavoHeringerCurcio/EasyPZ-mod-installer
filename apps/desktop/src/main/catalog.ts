import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { catalogSchema, type Catalog } from '@easypz/catalog'
import type { CatalogView } from '../shared/ipc'

export function resolveCatalogDir(): string {
  if (process.env.EASYPZ_CATALOG_DIR) {
    return path.resolve(process.env.EASYPZ_CATALOG_DIR)
  }
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'catalog')
  }
  return path.resolve(app.getAppPath(), '..', '..', 'catalog')
}

export async function loadCatalog(): Promise<Catalog> {
  const remoteUrl = process.env.EASYPZ_CATALOG_URL
  if (remoteUrl) {
    const response = await fetch(remoteUrl, {
      headers: { 'User-Agent': `EasyPZ-Mod-Installer/${app.getVersion()}` },
    })
    if (!response.ok) {
      throw new Error(`Catalog download failed with HTTP ${response.status}`)
    }
    return catalogSchema.parse(await response.json())
  }

  const raw = await fs.readFile(path.join(resolveCatalogDir(), 'index.json'), 'utf8')
  return catalogSchema.parse(JSON.parse(raw))
}

function mimeFor(file: string): string {
  const extension = path.extname(file).toLowerCase()
  if (extension === '.svg') return 'image/svg+xml'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  return 'image/png'
}

async function readCover(relativePath: string): Promise<string | null> {
  try {
    const remoteUrl = process.env.EASYPZ_CATALOG_URL
    if (remoteUrl) {
      const response = await fetch(new URL(relativePath, new URL('.', remoteUrl)), {
        headers: { 'User-Agent': `EasyPZ-Mod-Installer/${app.getVersion()}` },
      })
      if (!response.ok) return null
      const contentType = response.headers.get('content-type') ?? 'image/png'
      const bytes = Buffer.from(await response.arrayBuffer())
      return `data:${contentType.split(';')[0]};base64,${bytes.toString('base64')}`
    }

    const file = path.join(resolveCatalogDir(), relativePath)
    const bytes = await fs.readFile(file)
    return `data:${mimeFor(file)};base64,${bytes.toString('base64')}`
  } catch {
    return null
  }
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

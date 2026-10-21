import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Catalog, CatalogMode, IndexedPack, PackDefinition, PackStats } from './schema.js'
import { CATALOG_SCHEMA_VERSION, catalogSchema, packSchema } from './schema.js'
import { catalogIndexPath, packsRoot } from './paths.js'

const ALPHA_HOST = 'github.com'
const ALPHA_PATH_PREFIX = '/GustavoHeringerCurcio/pz-viewpoint-starter/releases/download/'
const PUBLIC_PATH_PREFIX = '/GustavoHeringerCurcio/EasyPZ-mod-installer/releases/download/'
const ASSETS_PATH_PREFIX = '/GustavoHeringerCurcio/EasyPZ-assets/releases/download/'

function formatZodError(error: unknown): string {
  if (error && typeof error === 'object' && 'issues' in error) {
    const issues = (error as { issues: Array<{ path: PropertyKey[]; message: string }> }).issues
    return issues
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
  }
  return error instanceof Error ? error.message : String(error)
}

function resolveStats(packs: Map<string, PackDefinition>, packId: string): PackStats {
  const root = packs.get(packId)
  if (root?.source === 'workshop') {
    const count = root.workshop?.items.length ?? 0
    return {
      clientMods: count,
      serverMods: 0,
      totalMods: count,
      workshopCount: count,
    }
  }

  const seen = new Set<string>()
  const chainSeen = new Set<string>()
  const mods: PackDefinition['groups'][number]['mods'] = []
  let current: PackDefinition | undefined = packs.get(packId)

  while (current) {
    if (chainSeen.has(current.id)) {
      throw new Error(`Circular pack inheritance detected at ${current.id}`)
    }
    chainSeen.add(current.id)

    for (const group of current.groups) {
      for (const mod of group.mods) {
        const key = `${mod.workshopId}:${mod.folder}`
        if (seen.has(key)) continue
        seen.add(key)
        mods.push(mod)
      }
    }

    current = current.extends ? packs.get(current.extends) : undefined
  }

  const serverMods = mods.filter((mod) => mod.serverOnly).length
  return {
    clientMods: mods.length - serverMods,
    serverMods,
    totalMods: mods.length,
    workshopCount: new Set(mods.map((mod) => mod.workshopId)).size,
  }
}

function validateArchiveUrl(mode: CatalogMode, pack: PackDefinition): string {
  if (!pack.archive) throw new Error(`${pack.id}: archive pack is missing archive metadata`)
  const url = pack.archive.urls[mode]
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`${pack.id}: archive URL is not valid: ${url}`)
  }

  if (parsed.protocol !== 'https:' || parsed.hostname !== ALPHA_HOST) {
    throw new Error(`${pack.id}: archive URL must be HTTPS on ${ALPHA_HOST}: ${url}`)
  }

  const allowedPrefixes =
    mode === 'alpha'
      ? [ALPHA_PATH_PREFIX, ASSETS_PATH_PREFIX]
      : [PUBLIC_PATH_PREFIX, ASSETS_PATH_PREFIX]
  if (!allowedPrefixes.some((prefix) => parsed.pathname.startsWith(prefix))) {
    throw new Error(`${pack.id}: archive URL is outside the allowed release path: ${url}`)
  }

  if (parsed.pathname.split('/').at(-1) !== pack.archive.fileName) {
    throw new Error(`${pack.id}: archive URL filename does not match ${pack.archive.fileName}`)
  }

  return url
}

async function readPackFiles(): Promise<PackDefinition[]> {
  const entries = await fs.readdir(packsRoot, { withFileTypes: true })
  const packs: PackDefinition[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const file = path.join(packsRoot, entry.name, 'pack.json')
    let raw: string
    try {
      raw = await fs.readFile(file, 'utf8')
    } catch {
      throw new Error(`Missing pack.json in catalog/packs/${entry.name}`)
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      throw new Error(`${file} is not valid JSON: ${(error as Error).message}`)
    }

    try {
      packs.push(packSchema.parse(parsed))
    } catch (error) {
      throw new Error(`${file}:\n${formatZodError(error)}`)
    }
  }

  if (packs.length === 0) throw new Error('No packs found in catalog/packs')
  return packs
}

async function validateCovers(packs: PackDefinition[]): Promise<void> {
  for (const pack of packs) {
    for (const asset of [pack.cover, ...pack.gallery]) {
      const absolute = path.join(path.dirname(catalogIndexPath), asset)
      try {
        await fs.access(absolute)
      } catch {
        throw new Error(`${pack.id}: missing catalog asset ${asset}`)
      }
    }
  }
}

export interface BuildOptions {
  mode: CatalogMode
  write: boolean
}

export async function buildCatalog(options: BuildOptions): Promise<Catalog> {
  const definitions = await readPackFiles()
  const byId = new Map(definitions.map((pack) => [pack.id, pack]))

  for (const pack of definitions) {
    if (pack.extends && !byId.has(pack.extends)) {
      throw new Error(`${pack.id}: extends unknown pack "${pack.extends}"`)
    }
    if (pack.source === 'archive') {
      if (!pack.archive) throw new Error(`${pack.id}: archive pack is missing archive metadata`)
      if (pack.groups.length === 0) throw new Error(`${pack.id}: archive pack has no mods`)
      if (pack.workshop)
        throw new Error(`${pack.id}: archive pack must not define workshop metadata`)
    } else {
      if (!pack.workshop) throw new Error(`${pack.id}: workshop pack is missing workshop metadata`)
      if (pack.archive)
        throw new Error(`${pack.id}: workshop pack must not define archive metadata`)
      if (pack.extends) throw new Error(`${pack.id}: workshop packs cannot extend another pack`)
    }
  }

  const ids = new Set<string>()
  for (const pack of definitions) {
    if (ids.has(pack.id)) throw new Error(`Duplicate pack id: ${pack.id}`)
    ids.add(pack.id)
  }

  await validateCovers(definitions)

  const packs: IndexedPack[] = definitions
    .sort((left, right) => left.order - right.order || left.name.localeCompare(right.name))
    .map((pack) => {
      if (pack.source === 'workshop') {
        return {
          ...pack,
          archive: null,
          stats: resolveStats(byId, pack.id),
        }
      }

      if (!pack.archive) throw new Error(`${pack.id}: archive pack is missing archive metadata`)
      const { urls, ...archive } = pack.archive
      return {
        ...pack,
        archive: {
          ...archive,
          url: validateArchiveUrl(options.mode, pack),
        },
        workshop: null,
        stats: resolveStats(byId, pack.id),
      }
    })

  const catalog: Catalog = {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    mode: options.mode,
    generatedAt: new Date().toISOString(),
    packs,
  }

  catalogSchema.parse(catalog)

  if (options.write) {
    await fs.mkdir(path.dirname(catalogIndexPath), { recursive: true })
    await fs.writeFile(catalogIndexPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
    console.log(
      `Wrote ${path.relative(process.cwd(), catalogIndexPath)} (${options.mode}, ${packs.length} packs)`,
    )
  }

  return catalog
}

async function main(): Promise<void> {
  const modeArg = process.argv.find((arg) => arg.startsWith('--mode='))
  const mode = (modeArg?.split('=')[1] ?? process.env.EASYPZ_CATALOG_MODE ?? 'alpha') as CatalogMode
  if (mode !== 'alpha' && mode !== 'public') {
    throw new Error(`Invalid catalog mode: ${mode}`)
  }
  await buildCatalog({ mode, write: true })
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

export { formatZodError, readPackFiles }

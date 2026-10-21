import { z } from 'zod'

export const CATALOG_SCHEMA_VERSION = 1 as const

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA256 hex digest')

export const modSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    folder: z.string().min(1),
    workshopId: z.string().regex(/^\d+$/),
    workshopUrl: z.string().url().optional(),
    serverOnly: z.boolean().default(false),
  })
  .strict()

export const modGroupSchema = z
  .object({
    name: z.string().min(1),
    mods: z.array(modSchema).min(1),
  })
  .strict()

export const archiveSchema = z
  .object({
    fileName: z.string().min(1),
    sha256: sha256Schema,
    sizeBytes: z.number().int().positive(),
    requiredDiskGB: z.number().positive(),
    releaseTag: z.string().min(1),
    urls: z
      .object({
        alpha: z.string().url(),
        public: z.string().url(),
      })
      .strict(),
  })
  .strict()

export const requirementsSchema = z
  .object({
    freeDiskGB: z.number().positive(),
    ramGB: z.number().positive(),
    recommendedRamGB: z.number().positive(),
    vramGB: z.number().positive().optional(),
  })
  .strict()

export const workshopItemSchema = z
  .object({
    id: z.string().regex(/^\d+$/),
    name: z.string().min(1),
    sizeBytes: z.number().int().nonnegative().optional(),
  })
  .strict()

export const workshopSchema = z
  .object({
    collectionId: z.string().regex(/^\d+$/),
    downloadBytes: z.number().int().positive(),
    items: z.array(workshopItemSchema).min(1),
  })
  .strict()

export const packSchema = z
  .object({
    schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1),
    tagline: z.string().min(1),
    description: z.string().min(1),
    cover: z.string().min(1),
    gallery: z.array(z.string()).default([]),
    accent: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable()
      .default(null),
    featured: z.boolean().default(false),
    placeholderArt: z.boolean().default(false),
    gameBuild: z.string().min(1),
    tags: z.array(z.string()).default([]),
    extends: z
      .string()
      .regex(/^[a-z0-9-]+$/)
      .nullable()
      .default(null),
    order: z.number().int().default(0),
    source: z.enum(['archive', 'workshop']).default('archive'),
    archive: archiveSchema.nullable().default(null),
    workshop: workshopSchema.nullable().default(null),
    requirements: requirementsSchema,
    groups: z.array(modGroupSchema).default([]),
    warnings: z.array(z.string()).default([]),
    credits: z.array(z.string()).default([]),
    updatedAt: z.string().min(1),
  })
  .strict()

export const packStatsSchema = z
  .object({
    clientMods: z.number().int().nonnegative(),
    serverMods: z.number().int().nonnegative(),
    totalMods: z.number().int().nonnegative(),
    workshopCount: z.number().int().nonnegative(),
  })
  .strict()

export const indexedArchiveSchema = archiveSchema
  .omit({ urls: true })
  .extend({ url: z.string().url() })

export const indexedPackSchema = packSchema.omit({ archive: true, workshop: true }).extend({
  archive: indexedArchiveSchema.nullable().default(null),
  workshop: workshopSchema.nullable().default(null),
  stats: packStatsSchema,
})

export const catalogSchema = z
  .object({
    schemaVersion: z.literal(CATALOG_SCHEMA_VERSION),
    mode: z.enum(['alpha', 'public']),
    generatedAt: z.string().min(1),
    packs: z.array(indexedPackSchema).min(1),
  })
  .strict()

export type CatalogMode = z.infer<typeof catalogSchema.shape.mode>
export type ModEntry = z.infer<typeof modSchema>
export type ModGroup = z.infer<typeof modGroupSchema>
export type WorkshopItem = z.infer<typeof workshopItemSchema>
export type PackDefinition = z.infer<typeof packSchema>
export type IndexedPack = z.infer<typeof indexedPackSchema>
export type Catalog = z.infer<typeof catalogSchema>
export type PackStats = z.infer<typeof packStatsSchema>

export function isWorkshopPack(pack: { source: string; workshop: unknown }): boolean {
  return pack.source === 'workshop' && pack.workshop !== null
}

export function getWorkshopItems(pack: IndexedPack): WorkshopItem[] {
  return pack.workshop?.items ?? []
}

export interface EffectiveMod extends ModEntry {
  group: string
  packId: string
}

export interface EffectiveGroup {
  name: string
  packId: string
  mods: ModEntry[]
}

function findPack(catalog: Catalog, packId: string): IndexedPack {
  const pack = catalog.packs.find((candidate) => candidate.id === packId)
  if (!pack) throw new Error(`Unknown pack: ${packId}`)
  return pack
}

export function getPack(catalog: Catalog, packId: string): IndexedPack {
  return findPack(catalog, packId)
}

export function getPackChain(catalog: Catalog, packId: string): IndexedPack[] {
  const chain: IndexedPack[] = []
  const seen = new Set<string>()
  let current: IndexedPack | undefined = findPack(catalog, packId)

  while (current) {
    if (seen.has(current.id)) {
      throw new Error(`Circular pack inheritance detected at ${current.id}`)
    }
    seen.add(current.id)
    chain.unshift(current)
    current = current.extends ? findPack(catalog, current.extends) : undefined
  }

  return chain
}

export function getEffectiveGroups(catalog: Catalog, packId: string): EffectiveGroup[] {
  return getPackChain(catalog, packId).flatMap((pack) =>
    pack.groups.map((group) => ({
      name: group.name,
      packId: pack.id,
      mods: group.mods,
    })),
  )
}

export function getEffectiveMods(catalog: Catalog, packId: string): EffectiveMod[] {
  const seen = new Set<string>()
  const mods: EffectiveMod[] = []

  for (const group of getEffectiveGroups(catalog, packId)) {
    for (const mod of group.mods) {
      const key = `${mod.workshopId}:${mod.folder}`
      if (seen.has(key)) continue
      seen.add(key)
      mods.push({ ...mod, group: group.name, packId: group.packId })
    }
  }

  return mods
}

export function getClientMods(catalog: Catalog, packId: string): EffectiveMod[] {
  return getEffectiveMods(catalog, packId).filter((mod) => !mod.serverOnly)
}

export function getWorkshopIds(catalog: Catalog, packId: string): string[] {
  return [...new Set(getEffectiveMods(catalog, packId).map((mod) => mod.workshopId))]
}

export function getManagedFolders(catalog: Catalog, packId: string): string[] {
  return [...new Set(getEffectiveMods(catalog, packId).map((mod) => mod.folder))]
}

export function computePackStats(catalog: Catalog, packId: string): PackStats {
  const mods = getEffectiveMods(catalog, packId)
  const serverMods = mods.filter((mod) => mod.serverOnly).length
  return {
    clientMods: mods.length - serverMods,
    serverMods,
    totalMods: mods.length,
    workshopCount: getWorkshopIds(catalog, packId).length,
  }
}

export function getActiveModIds(catalog: Catalog, packId: string, server: boolean): string[] {
  const ids = new Set<string>()
  for (const mod of getEffectiveMods(catalog, packId)) {
    if (mod.serverOnly && !server) continue
    ids.add(mod.id)
  }
  return [...ids]
}

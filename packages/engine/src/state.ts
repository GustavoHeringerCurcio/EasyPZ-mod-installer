import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { Catalog } from '@easypz/catalog'
import { getEffectiveMods, getManagedFolders, getPack } from '@easypz/catalog'
import type { AppPaths } from './paths.js'
import { EasyPzError, toError } from './errors.js'

export const installedModSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    folder: z.string().min(1),
    workshopId: z.string().min(1),
    serverOnly: z.boolean().default(false),
  })
  .strict()

const installRecordSchema = z
  .object({
    packId: z.string().min(1),
    source: z.enum(['archive', 'workshop']).default('archive'),
    workshopCollectionId: z.string().nullable().default(null),
    archiveSha256: z.string().min(1),
    catalogGeneratedAt: z.string().min(1),
    installedAt: z.string().min(1),
    managedFolders: z.array(z.string()),
    mods: z.array(installedModSchema).default([]),
  })
  .strict()

export const appStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    layoutVersion: z.number().int().default(2),
    activePackId: z.string().nullable(),
    installs: z.record(z.string(), installRecordSchema),
    gamePathOverride: z.string().nullable(),
    migratedFrom: z.string().nullable(),
    createdAt: z.string().min(1),
    updatedAt: z.string().min(1),
  })
  .strict()

export type InstalledMod = z.infer<typeof installedModSchema>
export type InstallRecord = z.infer<typeof installRecordSchema>
export type AppState = z.infer<typeof appStateSchema>

export function createEmptyState(): AppState {
  const now = new Date().toISOString()
  return {
    schemaVersion: 1,
    layoutVersion: 2,
    activePackId: null,
    installs: {},
    gamePathOverride: null,
    migratedFrom: null,
    createdAt: now,
    updatedAt: now,
  }
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function readLegacyProfile(paths: AppPaths): Promise<string | null> {
  try {
    const raw = (await fs.readFile(paths.legacyProfileFile, 'utf8')).trim().toLowerCase()
    if (raw === 'medium' || raw === 'advanced') return raw
  } catch {
    // No legacy profile.
  }
  return null
}

async function readLegacyMarker(paths: AppPaths): Promise<string | null> {
  try {
    const raw = (await fs.readFile(paths.legacyMarkerFile, 'utf8')).trim()
    const first = raw.split(/\s+/)[0]?.toLowerCase()
    return first && /^[a-f0-9]{64}$/.test(first) ? first : null
  } catch {
    return null
  }
}

async function migrateLegacy(paths: AppPaths, catalog?: Catalog): Promise<AppState | null> {
  const legacyProfile = await readLegacyProfile(paths)
  const legacyMarker = await readLegacyMarker(paths)

  if (!legacyProfile && !legacyMarker) return null

  const state = createEmptyState()
  state.migratedFrom = 'ViewpointPacks'
  state.activePackId = legacyProfile

  if (legacyMarker && catalog) {
    const installedPack = catalog.packs.find((pack) => pack.archive?.sha256 === legacyMarker)
    if (installedPack) {
      state.installs[installedPack.id] = {
        packId: installedPack.id,
        source: 'archive',
        workshopCollectionId: null,
        archiveSha256: installedPack.archive?.sha256 ?? legacyMarker,
        catalogGeneratedAt: catalog.generatedAt,
        installedAt: new Date().toISOString(),
        managedFolders: getManagedFolders(catalog, installedPack.id),
        mods: [],
      }
      state.activePackId = installedPack.id
    }
  }

  return state
}

export async function loadState(
  paths: AppPaths,
  options: { catalog?: Catalog; migrate?: boolean } = {},
): Promise<AppState> {
  try {
    const raw = await fs.readFile(paths.stateFile, 'utf8')
    return appStateSchema.parse(JSON.parse(raw))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      if (error instanceof SyntaxError || (error as { issues?: unknown }).issues) {
        throw new EasyPzError(
          'IO',
          `EasyPZ state file is invalid: ${paths.stateFile}. Delete it to rebuild state.`,
          { cause: toError(error) },
        )
      }
      throw error
    }
  }

  if (options.migrate !== false) {
    const migrated = await migrateLegacy(paths, options.catalog)
    if (migrated) {
      await saveState(paths, migrated)
      return migrated
    }
  }

  return createEmptyState()
}

export async function saveState(paths: AppPaths, state: AppState): Promise<void> {
  const validated: AppState = appStateSchema.parse({
    ...state,
    updatedAt: new Date().toISOString(),
  })

  await fs.mkdir(path.dirname(paths.stateFile), { recursive: true })
  const temp = `${paths.stateFile}.tmp`
  await fs.writeFile(temp, `${JSON.stringify(validated, null, 2)}\n`, 'utf8')

  try {
    await fs.rename(temp, paths.stateFile)
  } catch {
    await fs.rm(paths.stateFile, { force: true })
    await fs.rename(temp, paths.stateFile)
  }
}

export async function updateState(
  paths: AppPaths,
  updater: (state: AppState) => AppState | void,
): Promise<AppState> {
  const state = await loadState(paths)
  const next = updater(state) ?? state
  await saveState(paths, next)
  return next
}

export function recordInstall(
  state: AppState,
  catalog: Catalog,
  packId: string,
  options: { mods?: InstalledMod[] } = {},
): AppState {
  const pack = getPack(catalog, packId)
  const now = new Date().toISOString()

  const mods: InstalledMod[] =
    options.mods ??
    getEffectiveMods(catalog, packId).map((mod) => ({
      id: mod.id,
      name: mod.name,
      folder: mod.folder,
      workshopId: mod.workshopId,
      serverOnly: mod.serverOnly,
    }))

  const managedFolders = [...new Set(mods.map((mod) => mod.folder))]
  const workshop = pack.source === 'workshop' ? pack.workshop : null

  return {
    ...state,
    activePackId: packId,
    installs: {
      ...state.installs,
      [packId]: {
        packId,
        source: pack.source,
        workshopCollectionId: workshop?.collectionId ?? null,
        archiveSha256: workshop
          ? `workshop:${workshop.collectionId}`
          : (pack.archive?.sha256 ?? ''),
        catalogGeneratedAt: catalog.generatedAt,
        installedAt: now,
        managedFolders:
          managedFolders.length > 0 ? managedFolders : getManagedFolders(catalog, packId),
        mods,
      },
    },
    updatedAt: now,
  }
}

export function setActivePack(state: AppState, packId: string | null): AppState {
  return { ...state, activePackId: packId, updatedAt: new Date().toISOString() }
}

export function clearPackInstall(state: AppState, packId: string): AppState {
  const installs = { ...state.installs }
  delete installs[packId]
  return {
    ...state,
    installs,
    activePackId: state.activePackId === packId ? null : state.activePackId,
    updatedAt: new Date().toISOString(),
  }
}

export function setGamePathOverride(state: AppState, gamePath: string | null): AppState {
  return { ...state, gamePathOverride: gamePath, updatedAt: new Date().toISOString() }
}

export async function isStateFilePresent(paths: AppPaths): Promise<boolean> {
  return fileExists(paths.stateFile)
}

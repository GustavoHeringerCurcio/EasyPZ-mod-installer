import fs from 'node:fs/promises'
import type { Catalog } from '@easypz/catalog'
import { getEffectiveMods } from '@easypz/catalog'
import type { AppPaths } from './paths.js'
import { activeModPath, modsDir, storeModPath } from './paths.js'
import { countActiveMods } from './activation.js'
import { readHostMods } from './host.js'
import { isZombieBuddyInstalled } from './zombiebuddy.js'
import { modIsActive, modIsStored } from './storage.js'
import { computeItemManifest, discoverItemMods, findItemRoot } from './workshop.js'

export interface VerifyRow {
  group: string
  folder: string
  name: string
  modId: string
  workshopId: string
  serverOnly: boolean
  installed: boolean
  stored: boolean
  active: boolean
  enabled: boolean
  modInfo: boolean
  contentOk: boolean
}

export interface PackHealth {
  packId: string
  rows: VerifyRow[]
  missing: VerifyRow[]
  installedCount: number
  activeCount: number
  enabledCount: number
  totalCount: number
  defaultTxtCount: number
  hostModCount: number | null
  zombieBuddyInstalled: boolean
}

export interface VerifyModEntry {
  id: string
  name: string
  folder: string
  workshopId: string
  serverOnly: boolean
  group?: string
}

export async function verifyMods(options: {
  packId: string
  mods: VerifyModEntry[]
  paths: AppPaths
  pzPath: string | null
  hostIniPath: string
  workshopRoot?: string | null
  disabledModIds?: Iterable<string>
}): Promise<PackHealth> {
  const { packId, mods, paths, pzPath, hostIniPath, workshopRoot } = options
  const disabled = new Set(options.disabledModIds ?? [])
  const sourceMods = new Map<string, Awaited<ReturnType<typeof discoverItemMods>>>()

  const getSourceMods = async (
    workshopId: string,
  ): Promise<Awaited<ReturnType<typeof discoverItemMods>>> => {
    const cached = sourceMods.get(workshopId)
    if (cached) return cached
    const root = workshopRoot ? await findItemRoot(workshopId, workshopRoot, paths) : null
    const discovered = root ? await discoverItemMods(root, workshopId) : []
    sourceMods.set(workshopId, discovered)
    return discovered
  }

  const rows: VerifyRow[] = []
  for (const mod of mods) {
    const stored = await modIsStored(paths, mod.workshopId, mod.folder)
    const active = await modIsActive(paths, mod.folder)
    const installed = stored || active
    let contentOk = installed

    if (installed && workshopRoot) {
      const source = (await getSourceMods(mod.workshopId)).find(
        (candidate) => candidate.id === mod.id || candidate.folder === mod.folder,
      )
      if (source) {
        const installedFolder = active
          ? activeModPath(paths, mod.folder)
          : storeModPath(paths, mod.workshopId, mod.folder)
        const [left, right] = await Promise.all([
          computeItemManifest(source.source, { hashContents: true }),
          computeItemManifest(installedFolder, { hashContents: true }),
        ])
        contentOk =
          left.manifestHash === right.manifestHash &&
          left.fileCount === right.fileCount &&
          left.totalBytes === right.totalBytes
      }
    }

    rows.push({
      group: mod.group ?? 'Workshop',
      folder: mod.folder,
      name: mod.name,
      modId: mod.id,
      workshopId: mod.workshopId,
      serverOnly: mod.serverOnly,
      installed,
      stored,
      active,
      enabled: !disabled.has(mod.id),
      modInfo: installed,
      contentOk,
    })
  }

  const missing = rows.filter((row) => !row.installed || !row.contentOk)
  const hostMods = await readHostMods(hostIniPath)

  return {
    packId,
    rows,
    missing,
    installedCount: rows.filter((row) => row.installed && row.contentOk).length,
    activeCount: rows.filter((row) => row.active).length,
    enabledCount: rows.filter((row) => row.active && row.enabled).length,
    totalCount: rows.length,
    defaultTxtCount: await countActiveMods(modsDir(paths)),
    hostModCount: hostMods ? hostMods.length : null,
    zombieBuddyInstalled: pzPath ? await isZombieBuddyInstalled(pzPath) : false,
  }
}

export async function verifyPack(options: {
  catalog: Catalog
  packId: string
  paths: AppPaths
  pzPath: string | null
  hostIniPath: string
  workshopRoot?: string | null
}): Promise<PackHealth> {
  const mods = getEffectiveMods(options.catalog, options.packId).map((mod) => ({
    id: mod.id,
    name: mod.name,
    folder: mod.folder,
    workshopId: mod.workshopId,
    serverOnly: mod.serverOnly,
    group: mod.group,
  }))
  return verifyMods({ ...options, mods })
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

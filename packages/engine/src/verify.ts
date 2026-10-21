import fs from 'node:fs/promises'
import type { Catalog } from '@easypz/catalog'
import { getEffectiveMods } from '@easypz/catalog'
import type { AppPaths } from './paths.js'
import { modsDir } from './paths.js'
import { countActiveMods } from './activation.js'
import { readHostMods } from './host.js'
import { isZombieBuddyInstalled } from './zombiebuddy.js'
import { modIsActive, modIsStored } from './storage.js'

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
  modInfo: boolean
}

export interface PackHealth {
  packId: string
  rows: VerifyRow[]
  missing: VerifyRow[]
  installedCount: number
  activeCount: number
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
}): Promise<PackHealth> {
  const { packId, mods, paths, pzPath, hostIniPath } = options

  const rows: VerifyRow[] = []
  for (const mod of mods) {
    const stored = await modIsStored(paths, mod.workshopId, mod.folder)
    const active = await modIsActive(paths, mod.folder)
    const installed = stored || active
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
      modInfo: installed,
    })
  }

  const missing = rows.filter((row) => !row.installed)
  const hostMods = await readHostMods(hostIniPath)

  return {
    packId,
    rows,
    missing,
    installedCount: rows.length - missing.length,
    activeCount: rows.filter((row) => row.active).length,
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

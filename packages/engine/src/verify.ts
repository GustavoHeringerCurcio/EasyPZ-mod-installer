import fs from 'node:fs/promises'
import path from 'node:path'
import type { Catalog } from '@easypz/catalog'
import { getEffectiveMods } from '@easypz/catalog'
import { hasModInfo } from './archive.js'
import { countActiveMods } from './activation.js'
import { readHostMods } from './host.js'
import { isZombieBuddyInstalled } from './zombiebuddy.js'

export interface VerifyRow {
  group: string
  folder: string
  name: string
  modId: string
  workshopId: string
  serverOnly: boolean
  installed: boolean
  modInfo: boolean
}

export interface PackHealth {
  packId: string
  rows: VerifyRow[]
  missing: VerifyRow[]
  installedCount: number
  totalCount: number
  defaultTxtCount: number
  hostModCount: number | null
  zombieBuddyInstalled: boolean
}

export async function verifyPack(options: {
  catalog: Catalog
  packId: string
  modsDir: string
  pzPath: string | null
  hostIniPath: string
}): Promise<PackHealth> {
  const { catalog, packId, modsDir, pzPath, hostIniPath } = options

  const rows: VerifyRow[] = []
  for (const mod of getEffectiveMods(catalog, packId)) {
    const folder = path.join(modsDir, mod.folder)
    const installed = await hasModInfo(folder)
    rows.push({
      group: mod.group,
      folder: mod.folder,
      name: mod.name,
      modId: mod.id,
      workshopId: mod.workshopId,
      serverOnly: mod.serverOnly,
      installed,
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
    totalCount: rows.length,
    defaultTxtCount: await countActiveMods(modsDir),
    hostModCount: hostMods ? hostMods.length : null,
    zombieBuddyInstalled: pzPath ? await isZombieBuddyInstalled(pzPath) : false,
  }
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}

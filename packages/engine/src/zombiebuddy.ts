import fs from 'node:fs/promises'
import path from 'node:path'
import type { AppPaths } from './paths.js'
import { EasyPzError, toError } from './errors.js'

export type ZombieBuddyStatus = 'already-installed' | 'installed' | 'missing-source' | 'skipped'

export async function isZombieBuddyInstalled(pzPath: string): Promise<boolean> {
  const jar = path.join(pzPath, 'ZombieBuddy.jar')
  const dll = path.join(pzPath, 'zbNative.dll')
  const json = path.join(pzPath, 'ProjectZomboid64.json')

  try {
    await fs.access(jar)
    await fs.access(dll)
  } catch {
    return false
  }

  try {
    const raw = await fs.readFile(json, 'utf8')
    return raw.includes('agentlib:zbNative')
  } catch {
    return false
  }
}

export async function findZombieBuddySource(
  extractRoot: string,
  paths: AppPaths,
): Promise<string | null> {
  const candidates = [
    path.join(extractRoot, '108600', '3619862853', 'mods', 'ZombieBuddy'),
    path.join(extractRoot, '3619862853', 'mods', 'ZombieBuddy'),
    path.join(paths.zomboidDir, 'mods', 'ZombieBuddy'),
  ]

  for (const candidate of candidates) {
    try {
      await fs.access(path.join(candidate, 'libs', 'ZombieBuddy.jar'))
      await fs.access(path.join(candidate, 'libs', 'zbNative.dll'))
      return candidate
    } catch {
      // Keep looking.
    }
  }

  return null
}

export async function installZombieBuddyManually(options: {
  pzPath: string
  source: string
}): Promise<void> {
  const { pzPath, source } = options
  try {
    await fs.copyFile(
      path.join(source, 'libs', 'ZombieBuddy.jar'),
      path.join(pzPath, 'ZombieBuddy.jar'),
    )
    await fs.copyFile(path.join(source, 'libs', 'zbNative.dll'), path.join(pzPath, 'zbNative.dll'))
  } catch (error) {
    throw new EasyPzError('IO', `Could not install ZombieBuddy: ${toError(error).message}`, {
      cause: toError(error),
    })
  }
}

export async function ensureZombieBuddy(options: {
  pzPath: string
  extractRoot: string
  paths: AppPaths
  skip: boolean
}): Promise<ZombieBuddyStatus> {
  const { pzPath, extractRoot, paths, skip } = options
  if (skip) return 'skipped'
  if (await isZombieBuddyInstalled(pzPath)) return 'already-installed'

  const source = await findZombieBuddySource(extractRoot, paths)
  if (!source) return 'missing-source'

  await installZombieBuddyManually({ pzPath, source })
  return 'installed'
}

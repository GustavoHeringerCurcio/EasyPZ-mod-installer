import os from 'node:os'
import path from 'node:path'

export interface AppPaths {
  userProfile: string
  localAppData: string
  zomboidDir: string
  easyPzDir: string
  cacheDir: string
  archiveDir: string
  extractRoot: string
  stateFile: string
  stateDir: string
  backupDir: string
  legacyProfileFile: string
  legacyMarkerFile: string
  legacyArchiveDir: string
  legacyExtractRoot: string
  legacyInstallerDir: string
}

export interface PathEnv {
  USERPROFILE?: string
  LOCALAPPDATA?: string
  APPDATA?: string
}

export function getAppPaths(env: PathEnv = process.env): AppPaths {
  const userProfile = env.USERPROFILE ?? os.homedir()
  const localAppData = env.LOCALAPPDATA ?? path.join(userProfile, 'AppData', 'Local')
  const zomboidDir = path.join(userProfile, 'Zomboid')
  const easyPzDir = path.join(localAppData, 'EasyPZ')

  return {
    userProfile,
    localAppData,
    zomboidDir,
    easyPzDir,
    cacheDir: path.join(easyPzDir, 'cache'),
    archiveDir: path.join(easyPzDir, 'cache', 'archives'),
    extractRoot: path.join(easyPzDir, 'cache', 'extracted'),
    stateDir: path.join(zomboidDir, 'EasyPZ'),
    stateFile: path.join(zomboidDir, 'EasyPZ', 'state.json'),
    backupDir: path.join(zomboidDir, 'backups'),
    legacyProfileFile: path.join(zomboidDir, 'ViewpointPacks', 'profile.txt'),
    legacyMarkerFile: path.join(zomboidDir, 'mods', '.pz-viewpoint-installed'),
    legacyArchiveDir: path.join(localAppData, 'PZViewpoint', 'archive'),
    legacyExtractRoot: path.join(zomboidDir, 'ViewpointPacks', '_cache'),
    legacyInstallerDir: path.join(localAppData, 'PZViewpoint', 'installer'),
  }
}

export function modsDir(paths: AppPaths): string {
  return path.join(paths.zomboidDir, 'mods')
}

export function defaultTxtPath(paths: AppPaths): string {
  return path.join(paths.zomboidDir, 'mods', 'default.txt')
}

export function hostIniPath(paths: AppPaths): string {
  return path.join(paths.zomboidDir, 'Server', 'servertest.ini')
}

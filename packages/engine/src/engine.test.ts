import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Catalog } from '@easypz/catalog'
import { buildDefaultTxt, writeDefaultTxt } from './activation.js'
import { applyMods, removeModsNotInPack } from './apply.js'
import { assertTarComplete } from './archive.js'
import {
  applyGameConfig,
  applyPerformanceConfig,
  maxHeapMB,
  normalizeHeapMB,
} from './gameConfig.js'
import { applyHostIni, buildHostModsLine, buildHostWorkshopLine } from './host.js'
import { getAppPaths } from './paths.js'
import { loadState, recordInstall, saveState } from './state.js'
import { parseSteamCmdDownloadedBytes, parseSteamCmdProgress } from './workshop.js'

const temps: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `easypz-${prefix}-`))
  temps.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

function makeCatalog(): Catalog {
  return {
    schemaVersion: 1,
    mode: 'alpha',
    generatedAt: '2026-10-20T00:00:00.000Z',
    packs: [
      {
        schemaVersion: 1,
        id: 'medium',
        name: 'Medium',
        tagline: 'Test',
        description: 'Test pack',
        cover: 'packs/medium/cover.svg',
        gallery: [],
        placeholderArt: true,
        gameBuild: '42.21',
        tags: [],
        extends: null,
        order: 10,
        archive: {
          fileName: 'test.tar',
          sha256: 'a'.repeat(64),
          sizeBytes: 1,
          requiredDiskGB: 1,
          releaseTag: 'test-v1',
          url: 'https://github.com/x/y/releases/download/test-v1/test.tar',
        },
        requirements: { freeDiskGB: 1, ramGB: 8, recommendedRamGB: 16 },
        groups: [
          {
            name: 'Core',
            mods: [
              { id: 'ModA', name: 'Mod A', folder: 'ModA', workshopId: '111', serverOnly: false },
              { id: 'ModB', name: 'Mod B', folder: 'ModB', workshopId: '222', serverOnly: false },
              {
                id: 'ModServer',
                name: 'Mod Server',
                folder: 'ModServer',
                workshopId: '333',
                serverOnly: true,
              },
            ],
          },
        ],
        warnings: [],
        credits: [],
        updatedAt: '2026-10-20',
        stats: { clientMods: 2, serverMods: 1, totalMods: 3, workshopCount: 3 },
      },
    ],
  }
}

async function writeModInfo(folder: string): Promise<void> {
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, 'mod.info'), 'name=test\n', 'utf8')
}

describe('activation', () => {
  it('writes the Project Zomboid mod format', () => {
    const text = buildDefaultTxt(['ModA', 'ModB'])
    expect(text).toContain('VERSION = 1,')
    expect(text).toContain('    mod = ModA,')
    expect(text).toContain('    mod = ModB,')
    expect(text).toContain('maps')
  })

  it('puts ZombieBuddy and Viewpoint before Viewpoint add-ons', () => {
    const text = buildDefaultTxt(['ViewpointSurface', 'Viewpoint', 'ZombieBuddy', 'Other'])
    const modLines = text.split('\r\n').filter((line) => line.includes('mod = '))
    expect(modLines).toEqual([
      '    mod = ZombieBuddy,',
      '    mod = Viewpoint,',
      '    mod = ViewpointSurface,',
      '    mod = Other,',
    ])
  })

  it('backs up default.txt and creates the reset marker', async () => {
    const root = await tempDir('activation')
    const modsDir = path.join(root, 'mods')
    const backupDir = path.join(root, 'backups')
    await fs.mkdir(modsDir, { recursive: true })
    await fs.writeFile(path.join(modsDir, 'default.txt'), 'OLD', 'utf8')

    const result = await writeDefaultTxt({ modIds: ['ModA'], modsDir, backupDir })
    expect(result.modCount).toBe(1)
    expect(await fs.readFile(path.join(modsDir, 'default.txt'), 'utf8')).toContain('mod = ModA,')
    expect(await fs.readFile(path.join(backupDir, 'default.txt.bak'), 'utf8')).toBe('OLD')
    expect(await fs.readFile(path.join(modsDir, 'reset-mods-42_00.txt'), 'utf8')).toContain(
      'default.txt',
    )
  })
})

describe('host', () => {
  it('replaces the Mods line and keeps a backup', async () => {
    const root = await tempDir('host')
    const ini = path.join(root, 'servertest.ini')
    const backupDir = path.join(root, 'backups')
    await fs.writeFile(
      ini,
      'ServerName=Test\r\nMods=OldMod\r\nWorkshopItems=OldItem\r\nPublic=false\r\n',
      'utf8',
    )

    const result = await applyHostIni({
      iniPath: ini,
      modIds: ['ModA', 'ModB'],
      workshopIds: ['111', '222'],
      backupDir,
    })
    const text = await fs.readFile(ini, 'utf8')

    expect(result.updated).toBe(true)
    expect(text).toContain('Mods=ModA;ModB')
    expect(text).toContain('WorkshopItems=111;222')
    expect(text).toContain('ServerName=Test')
    expect(text).toContain('Public=false')
    expect(buildHostModsLine(['A'])).toBe('Mods=A')
    expect(buildHostWorkshopLine(['1', '2'])).toBe('WorkshopItems=1;2')
    expect(result.backupPath).not.toBeNull()
  })

  it('adds WorkshopItems when the line is absent', async () => {
    const root = await tempDir('host-workshop')
    const ini = path.join(root, 'servertest.ini')
    await fs.writeFile(ini, 'ServerName=Test\r\nMods=OldMod\r\n', 'utf8')

    await applyHostIni({
      iniPath: ini,
      modIds: ['ModA'],
      workshopIds: ['111', '222'],
      backupDir: path.join(root, 'backups'),
    })

    const text = await fs.readFile(ini, 'utf8')
    expect(text).toContain('WorkshopItems=111;222')
  })

  it('does nothing when the host INI is missing', async () => {
    const root = await tempDir('host-missing')
    const result = await applyHostIni({
      iniPath: path.join(root, 'servertest.ini'),
      modIds: ['ModA'],
      backupDir: path.join(root, 'backups'),
    })
    expect(result.updated).toBe(false)
    expect(result.reason).toContain('not found')
  })
})

describe('game configuration', () => {
  async function setupPerformanceFiles(): Promise<{
    pzPath: string
    zomboidDir: string
  }> {
    const root = await tempDir('fps')
    const pzPath = path.join(root, 'ProjectZomboid')
    const zomboidDir = path.join(root, 'Zomboid')
    await fs.mkdir(pzPath, { recursive: true })
    await fs.mkdir(path.join(zomboidDir, 'Lua'), { recursive: true })

    await fs.writeFile(
      path.join(pzPath, 'ProjectZomboid64.json'),
      JSON.stringify({ vmArgs: ['-Xmx3g'] }),
      'utf8',
    )
    await fs.writeFile(
      path.join(pzPath, 'ProjectZomboid64.bat'),
      'SET _JAVA_OPTIONS=\njava -Xmx3g -jar game.jar\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(zomboidDir, 'viewpoint-live.properties'),
      'memory.floorMiB=512\npack.trueweathers.occlusion=true\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(zomboidDir, 'options.ini'),
      'bloodDecals=10\nmaxActiveRagdolls=20\nmaxVehicleTextureSize=2\ntextureCompression=false\n',
      'utf8',
    )
    await fs.writeFile(
      path.join(zomboidDir, 'Lua', 'ModOptions.ini'),
      'combobox|ViewpointTrueWeathers|quality|3\ncombobox|ViewpointTrueWeathers|precipitation|3\n',
      'utf8',
    )
    return { pzPath, zomboidDir }
  }

  it('patches the launcher JSON, BAT, and options.ini', async () => {
    const root = await tempDir('config')
    const pzPath = path.join(root, 'ProjectZomboid')
    const zomboidDir = path.join(root, 'Zomboid')
    await fs.mkdir(pzPath, { recursive: true })
    await fs.mkdir(zomboidDir, { recursive: true })

    await fs.writeFile(
      path.join(pzPath, 'ProjectZomboid64.json'),
      JSON.stringify({ vmArgs: ['-Xmx2g', '-Dfoo=bar'] }),
      'utf8',
    )
    await fs.writeFile(
      path.join(pzPath, 'ProjectZomboid64.bat'),
      'SET _JAVA_OPTIONS=\njava -Xmx2g -jar game.jar\n',
      'utf8',
    )
    await fs.writeFile(path.join(zomboidDir, 'options.ini'), 'textureCompression=false\n', 'utf8')

    const result = await applyGameConfig({
      pzPath,
      zomboidDir,
      heapMB: 8192,
      zombieBuddyInstalled: true,
    })

    const json = JSON.parse(await fs.readFile(path.join(pzPath, 'ProjectZomboid64.json'), 'utf8'))
    const bat = await fs.readFile(path.join(pzPath, 'ProjectZomboid64.bat'), 'utf8')
    const ini = await fs.readFile(path.join(zomboidDir, 'options.ini'), 'utf8')

    expect(result.jsonPatched).toBe(true)
    expect(json.vmArgs).toContain('-Xmx8192m')
    expect(json.vmArgs).toContain('-agentlib:zbNative')
    expect(json.vmArgs).toContain('-Dfoo=bar')
    expect(bat).toContain('SET _JAVA_OPTIONS=-agentlib:zbNative')
    expect(bat).toContain('-Xmx8192m')
    expect(ini).toContain('textureCompression=true')
  })

  it('clamps game heap values to safe bounds', () => {
    expect(normalizeHeapMB(null)).toBeNull()
    expect(normalizeHeapMB(2048)).toBe(3072)
    expect(normalizeHeapMB(9000)).toBe(9216)
    expect(normalizeHeapMB(999999)).toBe(16384)
    expect(maxHeapMB(32768)).toBe(16384)
    expect(maxHeapMB(16384)).toBe(8192)
  })

  it('applies the recommended performance profile without a backup', async () => {
    const { pzPath, zomboidDir } = await setupPerformanceFiles()

    const result = await applyPerformanceConfig({
      pzPath,
      zomboidDir,
      preset: 'recommended',
      heapMB: 8192,
      zombieBuddyInstalled: true,
    })

    const properties = await fs.readFile(path.join(zomboidDir, 'viewpoint-live.properties'), 'utf8')
    const ini = await fs.readFile(path.join(zomboidDir, 'options.ini'), 'utf8')
    const modOptions = await fs.readFile(path.join(zomboidDir, 'Lua', 'ModOptions.ini'), 'utf8')
    const json = JSON.parse(await fs.readFile(path.join(pzPath, 'ProjectZomboid64.json'), 'utf8'))

    expect(properties).toContain('memory.floorMiB=768')
    expect(properties).toContain('pack.trueweathers.occlusion=false')
    expect(ini).toContain('bloodDecals=6')
    expect(ini).toContain('maxActiveRagdolls=12')
    expect(ini).toContain('maxVehicleTextureSize=1')
    expect(ini).toContain('textureCompression=true')
    expect(modOptions).toContain('combobox|ViewpointTrueWeathers|quality|2')
    expect(modOptions).toContain('combobox|ViewpointTrueWeathers|precipitation|2')
    expect(json.vmArgs).toContain('-Xmx8192m')
    expect(result.preset).toBe('recommended')
    expect(result.modOptionsPatched).toBe(true)
    expect(result.skipped).toEqual([])
  })

  it('applies the light profile without combat or vehicle changes', async () => {
    const { pzPath, zomboidDir } = await setupPerformanceFiles()

    const result = await applyPerformanceConfig({
      pzPath,
      zomboidDir,
      preset: 'light',
      heapMB: 8192,
      zombieBuddyInstalled: true,
    })

    const properties = await fs.readFile(path.join(zomboidDir, 'viewpoint-live.properties'), 'utf8')
    const ini = await fs.readFile(path.join(zomboidDir, 'options.ini'), 'utf8')
    const modOptions = await fs.readFile(path.join(zomboidDir, 'Lua', 'ModOptions.ini'), 'utf8')

    expect(properties).toContain('memory.floorMiB=768')
    expect(properties).toContain('pack.trueweathers.occlusion=false')
    expect(ini).toContain('bloodDecals=10')
    expect(ini).toContain('maxActiveRagdolls=20')
    expect(ini).toContain('maxVehicleTextureSize=2')
    expect(modOptions).toContain('combobox|ViewpointTrueWeathers|quality|2')
    expect(result.preset).toBe('light')
    expect(result.optionsPatched).toBe(true)
  })

  it('restores performance defaults without a backup', async () => {
    const { pzPath, zomboidDir } = await setupPerformanceFiles()
    await applyPerformanceConfig({
      pzPath,
      zomboidDir,
      preset: 'recommended',
      heapMB: 8192,
      zombieBuddyInstalled: true,
    })

    const result = await applyPerformanceConfig({
      pzPath,
      zomboidDir,
      preset: 'defaults',
      heapMB: 8192,
      zombieBuddyInstalled: true,
    })

    const properties = await fs.readFile(path.join(zomboidDir, 'viewpoint-live.properties'), 'utf8')
    const ini = await fs.readFile(path.join(zomboidDir, 'options.ini'), 'utf8')
    const modOptions = await fs.readFile(path.join(zomboidDir, 'Lua', 'ModOptions.ini'), 'utf8')

    expect(properties).toContain('memory.floorMiB=512')
    expect(properties).toContain('pack.trueweathers.occlusion=true')
    expect(ini).toContain('bloodDecals=10')
    expect(ini).toContain('maxActiveRagdolls=20')
    expect(ini).toContain('maxVehicleTextureSize=2')
    expect(modOptions).toContain('combobox|ViewpointTrueWeathers|quality|3')
    expect(result.preset).toBe('defaults')
  })
})

describe('workshop progress', () => {
  it('parses SteamCMD byte progress and completion lines', () => {
    expect(
      parseSteamCmdProgress(
        'Update state (0x61) downloading, progress: 42.50 (4250000 / 10000000)',
      ),
    ).toEqual({ percent: 42.5, transferredBytes: 4250000, totalBytes: 10000000 })
    expect(parseSteamCmdProgress('Downloading item 123 ...')).toBeNull()
    expect(
      parseSteamCmdDownloadedBytes(
        'Success. Downloaded item 123 to "C:\\cache\\123" (10000000 bytes)',
      ),
    ).toBe(10000000)
    expect(parseSteamCmdDownloadedBytes('Downloading item 123 ...')).toBeNull()
  })
})

describe('state migration', () => {
  it('adopts the legacy profile and marker', async () => {
    const root = await tempDir('state')
    const env = { USERPROFILE: root, LOCALAPPDATA: path.join(root, 'Local') }
    const paths = getAppPaths(env)
    const catalog = makeCatalog()

    await fs.mkdir(path.dirname(paths.legacyProfileFile), { recursive: true })
    await fs.writeFile(paths.legacyProfileFile, 'Medium', 'utf8')
    await fs.mkdir(path.dirname(paths.legacyMarkerFile), { recursive: true })
    await fs.writeFile(paths.legacyMarkerFile, catalog.packs[0]!.archive.sha256, 'utf8')

    const state = await loadState(paths, { catalog, migrate: true })
    expect(state.migratedFrom).toBe('ViewpointPacks')
    expect(state.activePackId).toBe('medium')
    expect(state.installs.medium).toBeDefined()

    const next = recordInstall(state, catalog, 'medium')
    await saveState(paths, next)
    const reloaded = await loadState(paths)
    expect(reloaded.installs.medium?.archiveSha256).toBe(catalog.packs[0]!.archive.sha256)
  })
})

describe('archive integrity', () => {
  it('accepts a tar with the standard zero end blocks', async () => {
    const root = await tempDir('tar-valid')
    const file = path.join(root, 'valid.tar')
    await fs.writeFile(file, Buffer.alloc(2048, 0))
    await expect(assertTarComplete(file)).resolves.toBeUndefined()
  })

  it('rejects a truncated archive', async () => {
    const root = await tempDir('tar-truncated')
    const file = path.join(root, 'broken.tar')
    await fs.writeFile(file, Buffer.alloc(2048, 0x41))
    await expect(assertTarComplete(file)).rejects.toMatchObject({ code: 'ARCHIVE_CORRUPT' })
  })
})

describe('apply', () => {
  it('keeps existing mods and moves missing ones from the archive', async () => {
    const root = await tempDir('apply')
    const extractRoot = path.join(root, 'extracted')
    const modsDir = path.join(root, 'mods')
    const backupRoot = path.join(root, 'backup')
    const catalog = makeCatalog()

    await writeModInfo(path.join(extractRoot, '108600', '111', 'mods', 'ModA'))
    await writeModInfo(path.join(extractRoot, '108600', '222', 'mods', 'ModB'))
    await writeModInfo(path.join(extractRoot, '108600', '333', 'mods', 'ModServer'))
    await writeModInfo(path.join(modsDir, 'ModA'))
    await fs.writeFile(path.join(modsDir, 'ModA', 'old.txt'), 'old', 'utf8')

    const result = await applyMods({
      catalog,
      packId: 'medium',
      extractRoot,
      modsDir,
      backupRoot,
    })

    expect(result.moved).toBe(2)
    expect(result.kept).toBe(1)
    expect(await fs.readFile(path.join(modsDir, 'ModB', 'mod.info'), 'utf8')).toContain('name=')
    expect(await fs.readFile(path.join(modsDir, 'ModA', 'old.txt'), 'utf8')).toBe('old')
  })

  it('removes mods that are not part of the target pack', async () => {
    const root = await tempDir('remove')
    const modsDir = path.join(root, 'mods')
    const backupRoot = path.join(root, 'backup')
    const catalog = makeCatalog()

    await writeModInfo(path.join(modsDir, 'ModA'))
    await writeModInfo(path.join(modsDir, 'RemovedMod'))

    const removed = await removeModsNotInPack({
      catalog,
      targetPackId: 'medium',
      previousManagedFolders: ['ModA', 'RemovedMod'],
      modsDir,
      backupRoot,
    })

    expect(removed).toEqual(['RemovedMod'])
    await expect(fs.access(path.join(modsDir, 'RemovedMod'))).rejects.toThrow()
    await expect(fs.access(path.join(modsDir, 'ModA'))).resolves.toBeUndefined()
  })
})

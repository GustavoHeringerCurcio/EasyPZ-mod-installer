import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Catalog, IndexedPack } from '@easypz/catalog'
import { parseDefaultModIds } from './activation.js'
import { activeModPath, defaultTxtPath, getAppPaths, modsDir, storeModPath } from './paths.js'
import { applyUiSuite, setPackEnabled } from './operations.js'
import { createEmptyState, loadState, recordInstall, saveState, setActivePack } from './state.js'
import { hasModInfo } from './archive.js'

const detectMocks = vi.hoisted(() => ({ workshopRoot: '' }))

vi.mock('./detect.js', () => ({
  isGameRunning: async () => false,
  getGameInfo: async () => ({
    found: true,
    pzPath: 'C:/fake/ProjectZomboid',
    workshopRoot: detectMocks.workshopRoot,
    gameRunning: false,
  }),
}))

const temps: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `easypz-suite-${prefix}-`))
  temps.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

async function writeModInfo(folder: string, id: string): Promise<void> {
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, 'mod.info'), `name=${id}\nid=${id}\n`, 'utf8')
}

function makePack(): IndexedPack {
  return {
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
      fileName: 'medium.tar',
      sha256: 'a'.repeat(64),
      sizeBytes: 1,
      requiredDiskGB: 1,
      releaseTag: 'test',
      url: 'https://github.com/x/y/releases/download/test/test.tar',
    },
    requirements: { freeDiskGB: 1, ramGB: 8, recommendedRamGB: 16 },
    groups: [
      {
        name: 'Core',
        mods: [
          { id: 'ModA', name: 'Mod A', folder: 'ModA', workshopId: '111', serverOnly: false },
          {
            id: 'ViewpointUI',
            name: 'Viewpoint Interface',
            folder: 'ViewpointUI',
            workshopId: '222',
            serverOnly: false,
          },
        ],
      },
    ],
    warnings: [],
    credits: [],
    updatedAt: '2026-10-20',
    stats: { clientMods: 2, serverMods: 0, totalMods: 2, workshopCount: 2 },
  }
}

function makeCatalog(): Catalog {
  const cover = 'assets/ui-suites/test.svg'
  return {
    schemaVersion: 1,
    mode: 'alpha',
    generatedAt: '2026-10-20T00:00:00.000Z',
    packs: [makePack()],
    uiSuites: [
      {
        id: 'viewpoint',
        name: 'Viewpoint UI',
        tagline: 'Default',
        description: 'Default',
        cover,
        gallery: [],
        accent: null,
        order: 10,
        recommended: true,
        add: [],
        remove: [],
        removedItems: [],
        items: [],
        requires: [],
        conflicts: [],
      },
      {
        id: 'dayz',
        name: 'DayZ UI',
        tagline: 'Test',
        description: 'Test',
        cover,
        gallery: [],
        accent: null,
        order: 20,
        recommended: false,
        add: [
          {
            id: 'ViewpointDayZInventory',
            name: 'Viewpoint DayZ',
            folder: 'ViewpointDayZInventory',
            workshopId: '333',
            serverOnly: false,
          },
        ],
        remove: ['ViewpointUI'],
        removedItems: [],
        items: [{ id: '333', name: 'Viewpoint DayZ', sizeBytes: 1 }],
        requires: [],
        conflicts: [],
      },
    ],
  }
}

describe('applyUiSuite', () => {
  let paths: ReturnType<typeof getAppPaths>
  let catalog: Catalog

  beforeEach(async () => {
    const root = await tempDir('root')
    paths = getAppPaths({ USERPROFILE: root, LOCALAPPDATA: path.join(root, 'Local') })
    catalog = makeCatalog()
    detectMocks.workshopRoot = path.join(root, 'steam-workshop')

    await writeModInfo(storeModPath(paths, '111', 'ModA'), 'ModA')
    await writeModInfo(storeModPath(paths, '222', 'ViewpointUI'), 'ViewpointUI')
    await writeModInfo(
      path.join(detectMocks.workshopRoot, '333', 'mods', 'ViewpointDayZInventory'),
      'ViewpointDayZInventory',
    )
    await fs.mkdir(modsDir(paths), { recursive: true })
    await fs.writeFile(defaultTxtPath(paths), '', 'ascii')
  })

  it('removes stale UI folders and activates the selected suite', async () => {
    const modA = {
      id: 'ModA',
      name: 'Mod A',
      folder: 'ModA',
      workshopId: '111',
      serverOnly: false,
    }
    const viewpointUi = {
      id: 'ViewpointUI',
      name: 'Viewpoint Interface',
      folder: 'ViewpointUI',
      workshopId: '222',
      serverOnly: false,
    }

    const installed = recordInstall(createEmptyState(), catalog, 'medium', {
      mods: [modA, viewpointUi],
      allMods: [modA, viewpointUi],
      uiSuiteId: 'viewpoint',
    })
    await saveState(paths, setActivePack(installed, 'medium'))

    await setPackEnabled({
      catalog,
      packId: 'medium',
      paths,
      enabled: true,
      skipGameCheck: true,
      suiteId: 'viewpoint',
    })
    expect(await hasModInfo(activeModPath(paths, 'ViewpointUI'))).toBe(true)

    // Simulate the broken install record: the chosen suite says DayZ was never
    // applied while the default Viewpoint UI files stayed active.
    const corrected = recordInstall(await loadState(paths, { catalog }), catalog, 'medium', {
      mods: [modA],
      allMods: [modA, viewpointUi],
      uiSuiteId: 'viewpoint',
    })
    await saveState(paths, { ...corrected, activePackId: 'medium' })

    await applyUiSuite({
      catalog,
      packId: 'medium',
      suiteId: 'dayz',
      paths,
    })

    expect(await hasModInfo(activeModPath(paths, 'ViewpointUI'))).toBe(false)
    expect(await hasModInfo(storeModPath(paths, '222', 'ViewpointUI'))).toBe(true)
    expect(await hasModInfo(activeModPath(paths, 'ViewpointDayZInventory'))).toBe(true)
    expect(await hasModInfo(activeModPath(paths, 'ModA'))).toBe(true)

    const ids = parseDefaultModIds(await fs.readFile(defaultTxtPath(paths), 'utf8'))
    expect(ids).toContain('ViewpointDayZInventory')
    expect(ids).not.toContain('ViewpointUI')
  })
})

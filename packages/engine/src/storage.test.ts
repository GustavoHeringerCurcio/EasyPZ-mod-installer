import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Catalog, IndexedPack } from '@easypz/catalog'
import { buildDefaultTxt, parseDefaultModIds } from './activation.js'
import { hasModInfo } from './archive.js'
import { readHostMods } from './host.js'
import {
  getAppPaths,
  activeModPath,
  defaultTxtPath,
  hostIniPath,
  modsDir,
  storeModPath,
} from './paths.js'
import {
  applyHostForPack,
  deletePack,
  reconcileActivePack,
  setModEnabled,
  setPackEnabled,
  suiteManagedMods,
} from './operations.js'
import { createEmptyState, loadState, recordInstall, saveState, setActivePack } from './state.js'
import { getAvailablePackIds, recoverStorageJournal } from './storage.js'

const temps: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `easypz-storage-${prefix}-`))
  temps.push(dir)
  return dir
}

afterEach(async () => {
  for (const dir of temps.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

async function writeModInfo(folder: string): Promise<void> {
  await fs.mkdir(folder, { recursive: true })
  await fs.writeFile(path.join(folder, 'mod.info'), 'name=test\n', 'utf8')
}

function makePack(
  id: string,
  groups: IndexedPack['groups'],
  extendsId: string | null,
  clientMods: number,
): IndexedPack {
  return {
    schemaVersion: 1,
    id,
    name: id === 'medium' ? 'Medium' : 'Advanced',
    tagline: 'Test',
    description: 'Test pack',
    cover: `packs/${id}/cover.svg`,
    gallery: [],
    placeholderArt: true,
    gameBuild: '42.21',
    tags: [],
    extends: extendsId,
    order: id === 'medium' ? 10 : 20,
    archive: {
      fileName: `${id}.tar`,
      sha256: id === 'medium' ? 'a'.repeat(64) : 'b'.repeat(64),
      sizeBytes: 1,
      requiredDiskGB: 1,
      releaseTag: 'test',
      url: 'https://github.com/x/y/releases/download/test/test.tar',
    },
    requirements: { freeDiskGB: 1, ramGB: 8, recommendedRamGB: 16 },
    groups,
    warnings: [],
    credits: [],
    updatedAt: '2026-10-20',
    stats: { clientMods, serverMods: 0, totalMods: clientMods, workshopCount: clientMods },
  }
}

function makeCatalog(): Catalog {
  return {
    schemaVersion: 1,
    mode: 'alpha',
    generatedAt: '2026-10-20T00:00:00.000Z',
    packs: [
      makePack(
        'medium',
        [
          {
            name: 'Core',
            mods: [
              { id: 'ModA', name: 'Mod A', folder: 'ModA', workshopId: '111', serverOnly: false },
              {
                id: 'ModShared',
                name: 'Shared',
                folder: 'ModShared',
                workshopId: '999',
                serverOnly: false,
              },
            ],
          },
        ],
        null,
        2,
      ),
      makePack(
        'advanced',
        [
          {
            name: 'Advanced',
            mods: [
              { id: 'ModC', name: 'Mod C', folder: 'ModC', workshopId: '222', serverOnly: false },
            ],
          },
        ],
        'medium',
        3,
      ),
      {
        ...makePack(
          'server-pack',
          [
            {
              name: 'Server',
              mods: [
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
          null,
          0,
        ),
        stats: { clientMods: 0, serverMods: 1, totalMods: 1, workshopCount: 1 },
      },
      {
        ...makePack('viewpoint-collection', [], null, 2),
        name: 'Project Viewpoint Collection',
        source: 'workshop',
        archive: null,
        workshop: {
          collectionId: '555',
          downloadBytes: 2,
          items: [
            { id: '501', name: 'Workshop One', sizeBytes: 1 },
            { id: '502', name: 'Workshop Two', sizeBytes: 1 },
          ],
        },
        stats: { clientMods: 2, serverMods: 0, totalMods: 2, workshopCount: 2 },
      },
    ],
    uiSuites: [
      {
        id: 'viewpoint',
        name: 'Viewpoint UI',
        tagline: 'Default',
        description: 'Default UI',
        cover: 'assets/ui-suites/viewpoint.svg',
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
        tagline: 'Test suite',
        description: 'Test suite',
        cover: 'assets/ui-suites/dayz.svg',
        gallery: [],
        accent: null,
        order: 20,
        recommended: false,
        add: [
          {
            id: 'ModDayZ',
            name: 'Mod DayZ',
            folder: 'ModDayZ',
            workshopId: '444',
            serverOnly: false,
          },
        ],
        remove: ['ModShared'],
        removedItems: [],
        items: [],
        requires: [],
        conflicts: [],
      },
    ],
  }
}

async function setup() {
  const root = await tempDir('root')
  const paths = getAppPaths({ USERPROFILE: root, LOCALAPPDATA: path.join(root, 'Local') })
  const catalog = makeCatalog()

  await writeModInfo(storeModPath(paths, '111', 'ModA'))
  await writeModInfo(storeModPath(paths, '999', 'ModShared'))
  await fs.mkdir(modsDir(paths), { recursive: true })
  await fs.writeFile(defaultTxtPath(paths), buildDefaultTxt(['UserMod']), 'ascii')

  return { paths, catalog }
}

describe('pack storage', () => {
  it('moves the active pack into the mods folder and keeps user IDs', async () => {
    const { paths, catalog } = await setup()

    const result = await setPackEnabled({
      catalog,
      packId: 'medium',
      paths,
      enabled: true,
      skipGameCheck: true,
    })

    expect(result.activePackId).toBe('medium')
    expect(await hasModInfo(activeModPath(paths, 'ModA'))).toBe(true)
    expect(await hasModInfo(activeModPath(paths, 'ModShared'))).toBe(true)
    expect(await hasModInfo(storeModPath(paths, '111', 'ModA'))).toBe(false)

    const ids = parseDefaultModIds(await fs.readFile(defaultTxtPath(paths), 'utf8'))
    expect(ids).toContain('UserMod')
    expect(ids).toContain('ModA')
    expect(ids).toContain('ModShared')
    expect(ids).not.toContain('ModC')

    const state = await loadState(paths, { catalog })
    expect(state.activePackId).toBe('medium')
    expect(state.layoutVersion).toBe(2)
  })

  it('activates the requested suite when no install record exists', async () => {
    const { paths, catalog } = await setup()
    await writeModInfo(storeModPath(paths, '444', 'ModDayZ'))

    const result = await setPackEnabled({
      catalog,
      packId: 'medium',
      paths,
      enabled: true,
      suiteId: 'dayz',
      skipGameCheck: true,
    })

    expect(result.activePackId).toBe('medium')
    expect(await hasModInfo(activeModPath(paths, 'ModA'))).toBe(true)
    expect(await hasModInfo(activeModPath(paths, 'ModDayZ'))).toBe(true)
    expect(await hasModInfo(activeModPath(paths, 'ModShared'))).toBe(false)

    const ids = parseDefaultModIds(await fs.readFile(defaultTxtPath(paths), 'utf8'))
    expect(ids).toContain('ModDayZ')
    expect(ids).not.toContain('ModShared')
  })

  it('collects every mod that can belong to a pack across suites', async () => {
    const { catalog } = await setup()
    const state = recordInstall(createEmptyState(), catalog, 'medium', { uiSuiteId: 'dayz' })
    const mods = suiteManagedMods(catalog, 'medium', state.installs.medium)

    expect(mods.map((mod) => mod.id)).toEqual(
      expect.arrayContaining(['ModA', 'ModShared', 'ModDayZ']),
    )
    expect(mods.filter((mod) => mod.id === 'ModA')).toHaveLength(1)
  })

  it('switches packs, disables to storage, and keeps only one active pack', async () => {
    const { paths, catalog } = await setup()
    await writeModInfo(storeModPath(paths, '222', 'ModC'))

    expect(await getAvailablePackIds(catalog, paths)).toEqual(['medium', 'advanced'])

    await setPackEnabled({
      catalog,
      packId: 'medium',
      paths,
      enabled: true,
      skipGameCheck: true,
    })
    const switched = await setPackEnabled({
      catalog,
      packId: 'advanced',
      paths,
      enabled: true,
      skipGameCheck: true,
    })

    expect(switched.previousPackId).toBe('medium')
    expect(await hasModInfo(activeModPath(paths, 'ModC'))).toBe(true)
    expect(await hasModInfo(activeModPath(paths, 'ModA'))).toBe(true)
    expect(await hasModInfo(activeModPath(paths, 'ModShared'))).toBe(true)

    const stateDuring = await loadState(paths, { catalog })
    expect(stateDuring.activePackId).toBe('advanced')

    await setPackEnabled({
      catalog,
      packId: 'advanced',
      paths,
      enabled: false,
      skipGameCheck: true,
    })

    expect(await hasModInfo(activeModPath(paths, 'ModC'))).toBe(false)
    expect(await hasModInfo(storeModPath(paths, '222', 'ModC'))).toBe(true)
    const ids = parseDefaultModIds(await fs.readFile(defaultTxtPath(paths), 'utf8'))
    expect(ids).toEqual(['UserMod'])

    const state = await loadState(paths, { catalog })
    expect(state.activePackId).toBeNull()
  })

  it('deletes only folders not shared with another installed pack', async () => {
    const { paths, catalog } = await setup()
    await writeModInfo(storeModPath(paths, '222', 'ModC'))

    const withMedium = recordInstall(createEmptyState(), catalog, 'medium')
    const withAdvanced = recordInstall(withMedium, catalog, 'advanced')
    await saveState(paths, setActivePack(withAdvanced, 'advanced'))

    await setPackEnabled({
      catalog,
      packId: 'advanced',
      paths,
      enabled: true,
      skipGameCheck: true,
    })

    const result = await deletePack({
      catalog,
      packId: 'advanced',
      paths,
      skipGameCheck: true,
    })

    expect(result.disabled).toBe(true)
    expect(result.removedFolders).toBe(1)
    expect(result.sharedFolders).toBe(2)
    expect(result.failedFolders).toEqual([])
    expect(await hasModInfo(activeModPath(paths, 'ModC'))).toBe(false)
    expect(await hasModInfo(storeModPath(paths, '222', 'ModC'))).toBe(false)
    expect(await hasModInfo(activeModPath(paths, 'ModA'))).toBe(true)
    expect(await hasModInfo(activeModPath(paths, 'ModShared'))).toBe(true)

    const state = await loadState(paths, { catalog })
    expect(state.activePackId).toBeNull()
    expect(state.installs.advanced).toBeUndefined()
    expect(state.installs.medium).toBeDefined()

    const ids = parseDefaultModIds(await fs.readFile(defaultTxtPath(paths), 'utf8'))
    expect(ids).toEqual(['UserMod'])
  })

  it('does not protect folders of packs without a state record', async () => {
    const { paths, catalog } = await setup()
    await writeModInfo(storeModPath(paths, '222', 'ModC'))
    await saveState(paths, recordInstall(createEmptyState(), catalog, 'advanced'))

    const result = await deletePack({
      catalog,
      packId: 'advanced',
      paths,
      skipGameCheck: true,
    })

    expect(result.removedFolders).toBe(3)
    expect(result.sharedFolders).toBe(0)
    expect(await hasModInfo(storeModPath(paths, '111', 'ModA'))).toBe(false)
    expect(await hasModInfo(storeModPath(paths, '999', 'ModShared'))).toBe(false)
    expect(await hasModInfo(storeModPath(paths, '222', 'ModC'))).toBe(false)
  })

  it('emits delete progress for each folder it removes', async () => {
    const { paths, catalog } = await setup()
    await writeModInfo(storeModPath(paths, '222', 'ModC'))
    await saveState(paths, recordInstall(createEmptyState(), catalog, 'advanced'))

    const events: Array<{ index: number; total: number; folder: string }> = []
    await deletePack({
      catalog,
      packId: 'advanced',
      paths,
      skipGameCheck: true,
      onEvent: (event) => {
        if (event.type === 'delete-progress') {
          events.push({ index: event.index, total: event.total, folder: event.folder })
        }
      },
    })

    expect(events).toHaveLength(3)
    expect(events.map((event) => event.index)).toEqual([1, 2, 3])
    expect(events.every((event) => event.total === 3)).toBe(true)
  })

  it('activates a downloaded Workshop collection from its install record', async () => {
    const { paths, catalog } = await setup()
    await writeModInfo(storeModPath(paths, '501', 'ModW1'))
    await writeModInfo(storeModPath(paths, '502', 'ModW2'))

    const state = createEmptyState()
    state.installs['viewpoint-collection'] = {
      packId: 'viewpoint-collection',
      source: 'workshop',
      workshopCollectionId: '555',
      archiveSha256: 'workshop:555',
      catalogGeneratedAt: catalog.generatedAt,
      packUpdatedAt: null,
      installedAt: new Date().toISOString(),
      managedFolders: ['ModW1', 'ModW2'],
      mods: [
        { id: 'ModW1', name: 'Mod W1', folder: 'ModW1', workshopId: '501', serverOnly: false },
        { id: 'ModW2', name: 'Mod W2', folder: 'ModW2', workshopId: '502', serverOnly: false },
      ],
    }
    await saveState(paths, state)

    expect(await getAvailablePackIds(catalog, paths)).toContain('viewpoint-collection')

    await setPackEnabled({
      catalog,
      packId: 'viewpoint-collection',
      paths,
      enabled: true,
      skipGameCheck: true,
    })

    expect(await hasModInfo(activeModPath(paths, 'ModW1'))).toBe(true)
    expect(await hasModInfo(activeModPath(paths, 'ModW2'))).toBe(true)
    const ids = parseDefaultModIds(await fs.readFile(defaultTxtPath(paths), 'utf8'))
    expect(ids).toEqual(expect.arrayContaining(['UserMod', 'ModW1', 'ModW2']))

    await setPackEnabled({
      catalog,
      packId: 'viewpoint-collection',
      paths,
      enabled: false,
      skipGameCheck: true,
    })
    expect(await hasModInfo(activeModPath(paths, 'ModW1'))).toBe(false)
    expect(await hasModInfo(storeModPath(paths, '501', 'ModW1'))).toBe(true)
  })

  it('recovers a previously interrupted move', async () => {
    const { paths } = await setup()
    const from = storeModPath(paths, '111', 'ModA')
    const to = activeModPath(paths, 'ModA')

    await fs.mkdir(path.dirname(paths.journalFile), { recursive: true })
    await fs.writeFile(
      paths.journalFile,
      JSON.stringify({
        version: 1,
        createdAt: new Date().toISOString(),
        entries: [{ from, to }],
      }),
      'utf8',
    )

    const recovered = await recoverStorageJournal(paths)
    expect(recovered).toBe(1)
    expect(await hasModInfo(to)).toBe(true)
    expect(await hasModInfo(from)).toBe(false)
  })

  it('toggles a client mod through default.txt without moving its folder', async () => {
    const { paths, catalog } = await setup()
    await saveState(paths, recordInstall(createEmptyState(), catalog, 'medium'))
    await setPackEnabled({
      catalog,
      packId: 'medium',
      paths,
      enabled: true,
      skipGameCheck: true,
    })

    const disabled = await setModEnabled({
      catalog,
      packId: 'medium',
      modId: 'ModA',
      enabled: false,
      paths,
      skipGameCheck: true,
    })

    expect(disabled.enabled).toBe(false)
    expect(disabled.enabledClientCount).toBe(1)
    expect(await hasModInfo(activeModPath(paths, 'ModA'))).toBe(true)

    let ids = parseDefaultModIds(await fs.readFile(defaultTxtPath(paths), 'utf8'))
    expect(ids).toContain('UserMod')
    expect(ids).toContain('ModShared')
    expect(ids).not.toContain('ModA')
    expect((await loadState(paths, { catalog })).installs.medium?.disabledModIds).toEqual(['ModA'])

    await setModEnabled({
      catalog,
      packId: 'medium',
      modId: 'ModA',
      enabled: true,
      paths,
      skipGameCheck: true,
    })

    ids = parseDefaultModIds(await fs.readFile(defaultTxtPath(paths), 'utf8'))
    expect(ids).toContain('ModA')
    expect((await loadState(paths, { catalog })).installs.medium?.disabledModIds).toEqual([])
  })

  it('stores a disabled mod for an inactive pack and applies it on enable', async () => {
    const { paths, catalog } = await setup()
    await saveState(paths, recordInstall(createEmptyState(), catalog, 'medium'))

    await setModEnabled({
      catalog,
      packId: 'medium',
      modId: 'ModA',
      enabled: false,
      paths,
      skipGameCheck: true,
    })

    let ids = parseDefaultModIds(await fs.readFile(defaultTxtPath(paths), 'utf8'))
    expect(ids).toEqual(['UserMod'])

    await setPackEnabled({
      catalog,
      packId: 'medium',
      paths,
      enabled: true,
      skipGameCheck: true,
    })

    ids = parseDefaultModIds(await fs.readFile(defaultTxtPath(paths), 'utf8'))
    expect(ids).toContain('ModShared')
    expect(ids).not.toContain('ModA')
  })

  it('keeps disabled mods independent for each pack across switches', async () => {
    const { paths, catalog } = await setup()
    await writeModInfo(storeModPath(paths, '222', 'ModC'))

    let state = recordInstall(createEmptyState(), catalog, 'medium')
    state = recordInstall(state, catalog, 'advanced')
    await saveState(paths, state)

    await setModEnabled({
      catalog,
      packId: 'medium',
      modId: 'ModA',
      enabled: false,
      paths,
      skipGameCheck: true,
    })

    await setPackEnabled({
      catalog,
      packId: 'advanced',
      paths,
      enabled: true,
      skipGameCheck: true,
    })
    let ids = parseDefaultModIds(await fs.readFile(defaultTxtPath(paths), 'utf8'))
    expect(ids).toContain('ModA')

    await setModEnabled({
      catalog,
      packId: 'advanced',
      modId: 'ModA',
      enabled: false,
      paths,
      skipGameCheck: true,
    })

    await setPackEnabled({
      catalog,
      packId: 'medium',
      paths,
      enabled: true,
      skipGameCheck: true,
    })
    ids = parseDefaultModIds(await fs.readFile(defaultTxtPath(paths), 'utf8'))
    expect(ids).not.toContain('ModA')
  })

  it('keeps server-only mods out of default.txt and filters the host list', async () => {
    const { paths, catalog } = await setup()
    await writeModInfo(storeModPath(paths, '333', 'ModServer'))
    await saveState(paths, recordInstall(createEmptyState(), catalog, 'server-pack'))
    await setPackEnabled({
      catalog,
      packId: 'server-pack',
      paths,
      enabled: true,
      skipGameCheck: true,
    })

    let ids = parseDefaultModIds(await fs.readFile(defaultTxtPath(paths), 'utf8'))
    expect(ids).toEqual(['UserMod'])

    await fs.mkdir(path.dirname(hostIniPath(paths)), { recursive: true })
    await fs.writeFile(hostIniPath(paths), 'ServerName=Test\r\n', 'utf8')

    await setModEnabled({
      catalog,
      packId: 'server-pack',
      modId: 'ModServer',
      enabled: false,
      paths,
      skipGameCheck: true,
    })

    await applyHostForPack({
      catalog,
      packId: 'server-pack',
      paths,
      skipGameCheck: true,
    })

    expect(await readHostMods(hostIniPath(paths))).toEqual([])
    expect((await loadState(paths, { catalog })).installs['server-pack']?.disabledModIds).toEqual([
      'ModServer',
    ])
    ids = parseDefaultModIds(await fs.readFile(defaultTxtPath(paths), 'utf8'))
    expect(ids).toEqual(['UserMod'])
  })

  it('does not re-enable disabled mods during active-pack recovery', async () => {
    const { paths, catalog } = await setup()
    await saveState(
      paths,
      recordInstall(createEmptyState(), catalog, 'medium', {
        disabledModIds: ['ModA'],
      }),
    )
    await setPackEnabled({
      catalog,
      packId: 'medium',
      paths,
      enabled: true,
      skipGameCheck: true,
    })

    await fs.writeFile(
      defaultTxtPath(paths),
      buildDefaultTxt(['UserMod', 'ModA', 'ModShared']),
      'ascii',
    )

    const state = await reconcileActivePack({ catalog, paths })
    expect(state.activePackId).toBe('medium')

    const ids = parseDefaultModIds(await fs.readFile(defaultTxtPath(paths), 'utf8'))
    expect(ids).toContain('ModShared')
    expect(ids).not.toContain('ModA')
  })

  it('preserves disabled mods across a UI suite reinstall', async () => {
    const { paths, catalog } = await setup()
    const state = recordInstall(createEmptyState(), catalog, 'medium', {
      disabledModIds: ['ModA'],
    })
    await saveState(paths, state)

    const updated = recordInstall(state, catalog, 'medium', {
      mods: [
        { id: 'ModA', name: 'Mod A', folder: 'ModA', workshopId: '111', serverOnly: false },
        {
          id: 'ModShared',
          name: 'Shared',
          folder: 'ModShared',
          workshopId: '999',
          serverOnly: false,
        },
      ],
    })

    expect(updated.installs.medium?.disabledModIds).toEqual(['ModA'])
  })
})

import { describe, expect, it } from 'vitest'
import { buildCatalog } from './build.js'
import {
  catalogSchema,
  getActiveModIds,
  getEffectiveMods,
  getEffectiveModsForSuite,
  getManagedFolders,
  getPack,
  getWorkshopIds,
  getWorkshopIdsForSuite,
  packSchema,
} from './schema.js'

describe('catalog', () => {
  it('builds all packs in alpha mode', async () => {
    const catalog = await buildCatalog({ mode: 'alpha', write: false })
    catalogSchema.parse(catalog)

    expect(catalog.packs.map((pack) => pack.id)).toEqual([
      'essentials',
      'medium',
      'advanced',
      'ultra',
      'viewpoint-collection',
      'viewpoint-addons',
    ])
    expect(getPack(catalog, 'essentials').stats.clientMods).toBe(6)
    expect(getPack(catalog, 'medium').stats.clientMods).toBe(38)
    expect(getPack(catalog, 'advanced').stats.clientMods).toBe(45)
    expect(getPack(catalog, 'ultra').stats.clientMods).toBe(140)
    expect(getPack(catalog, 'viewpoint-collection').stats.clientMods).toBe(90)
    expect(getPack(catalog, 'viewpoint-addons').stats.clientMods).toBe(198)
    expect(getPack(catalog, 'essentials').extends).toBeNull()
    expect(getPack(catalog, 'advanced').extends).toBe('medium')
    expect(getPack(catalog, 'essentials').archive?.url).toContain('EasyPZ-assets')

    const workshop = getPack(catalog, 'viewpoint-collection')
    expect(workshop.source).toBe('workshop')
    expect(workshop.archive).toBeNull()
    expect(workshop.workshop?.collectionId).toBe('3820219222')
    expect(workshop.workshop?.items).toHaveLength(90)

    const ultra = getPack(catalog, 'ultra')
    expect(ultra.source).toBe('workshop')
    expect(ultra.archive).toBeNull()
    expect(ultra.workshop?.collectionId).toBe('0')
    expect(ultra.workshop?.items).toHaveLength(140)
    expect(ultra.workshop?.items.map((item) => item.id)).not.toContain('3822754688')
    expect(ultra.workshop?.items.map((item) => item.id)).not.toContain('3810071828')
    expect(new Set(ultra.workshop?.items.map((item) => item.group)).size).toBe(9)
    expect(ultra.workshop?.items.at(0)?.group).toBe('Core')
    expect(ultra.workshop?.items.at(-1)?.group).toBe('Missions, events, transport, UI')
    expect(ultra.workshop?.items.at(-1)?.id).toBe('3713362869')
  })

  it('resolves UI suites and strips conflicting mods', async () => {
    const catalog = await buildCatalog({ mode: 'alpha', write: false })

    const dayz = getEffectiveModsForSuite(catalog, 'medium', 'dayz')
    expect(dayz.some((mod) => mod.id === 'ViewpointDayZInventory')).toBe(true)
    expect(dayz.some((mod) => mod.id === 'ViewpointUI')).toBe(false)
    expect(dayz.some((mod) => mod.id === 'ViewpointVehicleTuningCompat')).toBe(false)

    const tarkov = getEffectiveModsForSuite(catalog, 'advanced', 'tarkov')
    expect(tarkov.some((mod) => mod.id === 'ProjectTarkovHUD')).toBe(true)
    expect(tarkov.some((mod) => mod.id === 'ProjectTarkovLootInventory')).toBe(true)
    expect(tarkov.some((mod) => mod.id === 'INVENTORY_TETRIS')).toBe(true)
    expect(tarkov.some((mod) => mod.id === 'ViewpointUI')).toBe(false)

    const native = getEffectiveModsForSuite(catalog, 'medium', 'native')
    expect(native.some((mod) => mod.id === 'Viewpoint')).toBe(true)
    expect(native.some((mod) => mod.id === 'ViewpointUI')).toBe(false)
    expect(native.some((mod) => mod.id === 'ViewpointDayZInventory')).toBe(false)
    expect(native.some((mod) => mod.id === 'ProjectTarkovHUD')).toBe(false)

    const ultraDayZItems = getWorkshopIdsForSuite(catalog, 'ultra', 'dayz')
    expect(ultraDayZItems).toContain('3816819422')
    expect(ultraDayZItems).not.toContain('3812616893')
    expect(ultraDayZItems).not.toContain('3815739336')
  })
  it('points alpha archives at the legacy mirror and public archives at this repo', async () => {
    const alpha = await buildCatalog({ mode: 'alpha', write: false })
    const published = await buildCatalog({ mode: 'public', write: false })

    const alphaMedium = getPack(alpha, 'medium')
    const publicMedium = getPack(published, 'medium')

    expect(alphaMedium.archive?.url).toContain('pz-viewpoint-starter')
    expect(publicMedium.archive?.url).toContain('EasyPZ-mod-installer')
    expect(alphaMedium.archive?.sha256).toBe(publicMedium.archive?.sha256)
  })

  it('resolves inherited mods without duplicates', async () => {
    const catalog = await buildCatalog({ mode: 'alpha', write: false })
    const medium = getEffectiveMods(catalog, 'medium')
    const advanced = getEffectiveMods(catalog, 'advanced')

    expect(new Set(medium.map((mod) => mod.folder)).size).toBe(medium.length)
    expect(new Set(advanced.map((mod) => mod.folder)).size).toBe(advanced.length)
    expect(advanced.length).toBeGreaterThan(medium.length)
    expect(advanced.some((mod) => mod.id === 'TrueSwimming')).toBe(true)
  })

  it('excludes server-only entries from client activation', async () => {
    const catalog = await buildCatalog({ mode: 'alpha', write: false })
    const client = getActiveModIds(catalog, 'medium', false)
    const server = getActiveModIds(catalog, 'medium', true)

    expect(client).not.toContain('ViewpointAdvancedMovementServer')
    expect(server).toContain('ViewpointAdvancedMovementServer')
    expect(server.length).toBe(client.length + 1)
  })

  it('reports unique workshops and managed folders', async () => {
    const catalog = await buildCatalog({ mode: 'alpha', write: false })
    const workshops = getWorkshopIds(catalog, 'medium')
    const folders = getManagedFolders(catalog, 'medium')

    expect(new Set(workshops).size).toBe(workshops.length)
    expect(folders).toContain('ZombieBuddy')
    expect(folders).toContain('ViewpointRoofs')
    expect(folders.length).toBe(getEffectiveMods(catalog, 'medium').length)
  })
})

describe('pack schema', () => {
  const valid = {
    schemaVersion: 1,
    id: 'test',
    name: 'Test',
    tagline: 'Test pack',
    description: 'Test pack description',
    cover: 'packs/test/cover.svg',
    gameBuild: '42.21',
    archive: {
      fileName: 'test.tar',
      sha256: 'a'.repeat(64),
      sizeBytes: 1,
      requiredDiskGB: 1,
      releaseTag: 'test-v1',
      urls: {
        alpha:
          'https://github.com/GustavoHeringerCurcio/pz-viewpoint-starter/releases/download/test-v1/test.tar',
        public:
          'https://github.com/GustavoHeringerCurcio/EasyPZ-mod-installer/releases/download/test-v1/test.tar',
      },
    },
    requirements: { freeDiskGB: 1, ramGB: 8, recommendedRamGB: 16 },
    groups: [
      {
        name: 'Core',
        mods: [
          {
            id: 'TestMod',
            name: 'Test Mod',
            folder: 'TestMod',
            workshopId: '123',
          },
        ],
      },
    ],
    updatedAt: '2026-10-20',
  }

  it('accepts a minimal valid pack', () => {
    expect(packSchema.parse(valid).id).toBe('test')
  })

  it('rejects malformed hashes', () => {
    const invalid = { ...valid, archive: { ...valid.archive, sha256: 'nope' } }
    expect(() => packSchema.parse(invalid)).toThrow()
  })
})

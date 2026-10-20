#!/usr/bin/env node
/**
 * One-time authoring helper: converts the legacy pack-manifest.json into
 * EasyPZ catalog pack definitions. Not used at runtime or in CI.
 *
 * Usage:
 *   node packages/catalog/scripts/import-legacy.mjs <path-to-pack-manifest.json>
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const packsRoot = path.join(repoRoot, 'catalog', 'packs')
const legacyManifest = process.argv[2]

if (!legacyManifest) {
  console.error('Usage: node packages/catalog/scripts/import-legacy.mjs <pack-manifest.json>')
  process.exit(1)
}

const groupNames = {
  Pack1_Core: 'Core',
  Pack2_Tactical: 'Tactical',
  Pack3_Atmosphere: 'Atmosphere',
  Pack4_Survival: 'Survival',
  Pack5_QoL: 'Quality of Life',
  Pack6_Extras: 'Extras',
  Pack7_Immersion: 'Immersion',
  Pack8_AdvancedFixes: 'Advanced Fixes',
  Pack10_AdvancedRealism: 'Advanced Realism',
}

const modNames = {
  ViewpointAdvancedMovementServer: 'Advanced Movement (Server)',
  PZVoxelStudioViewpoint: 'Viewpoint Voxel Studio',
  ViewpointUI: 'Viewpoint Interface',
  ViewpointAdvancedMovement: 'Advanced Movement',
  ViewpointEquipmentOverlays: 'Equipment Overlays',
  ViewpointAdvancedThrowables: 'Advanced Throwables',
  ViewpointTrueBallistics: 'True Ballistics',
  ProjectViewpointADS: 'Project Viewpoint ADS',
  ViewpointTrueWeathers: 'True Weathers',
  pz3dMinimap: '3D Minimap',
  RainCleansBlood: 'Rain Cleans Blood',
  ImmersiveBlackouts: 'Immersive Blackouts',
  thumpwithfriends: 'Thump With Friends',
  SkullysZombieCollision: "Skully's Zombie Collision",
  CyesPushDoors: 'Push Doors',
  'Vanilla Foods Expanded': 'Vanilla Foods Expanded',
  'Take A Bath And Shower New': 'Take a Bath and Shower',
  'Take A Bath And Shower DepthMap Fix': 'Bath & Shower Depth Map Fix',
  RepairAnyClothes: 'Repair Any Clothes',
  ZVirusVaccine42BETA: 'Virus Vaccine (B42)',
  LGExtendedPlumbing: 'Extended Plumbing',
  isoContainers: 'Containers!',
  alicesWeaponSling: "Alice's Weapon Sling",
  DrawOnMap: 'Draw On The Map',
  'Skill Recovery Journal': 'Skill Recovery Journal',
  chuckleberryModdingAlertSystem: 'Mod Update Alert',
  SpawnSelector: 'Spawn Selector',
  '[B42] Faster Reading': 'Faster Reading (B42)',
  ImmersiveDriving: 'Immersive Driving',
  PZCrossbows: 'Simple Crossbows',
  ViewpointImmersiveEffects: 'Immersive Effects',
  ViewpointBodycam: 'Bodycam',
  ViewpointVisibleLoot: 'Visible Loot',
  ViewpointRoofs: 'Roofs (WIP)',
  ProjectViewpointQOL: 'Viewpoint QOL',
  ViewpointRightClick: 'Right Click Fix',
  ViewpointTrueWeathersGameplay: 'True Weathers Gameplay',
  ViewpointImmersiveMap: 'Immersive Map',
  ViewpointForaging: 'Foraging',
  FishingView: 'Fishing View',
  TrueSwimming: 'True Swimming',
}

function titleCase(value) {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function effectiveMods(groups, manifest) {
  const seen = new Set()
  const mods = []
  for (const group of groups) {
    for (const mod of manifest[group] ?? []) {
      const key = `${mod.Workshop}:${mod.Folder}`
      if (seen.has(key)) continue
      seen.add(key)
      mods.push(mod)
    }
  }
  return mods
}

function mapGroups(groups, manifest) {
  return groups.map((group) => ({
    name: groupNames[group] ?? titleCase(group),
    mods: (manifest[group] ?? []).map((mod) => ({
      id: mod.ModID,
      name: modNames[mod.Folder] ?? titleCase(mod.Folder),
      folder: mod.Folder,
      workshopId: String(mod.Workshop),
      workshopUrl: `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.Workshop}`,
      serverOnly: Boolean(mod.ServerOnly),
    })),
  }))
}

function archive(fileName, sha256, sizeBytes, requiredDiskGB, releaseTag) {
  const alphaBase =
    'https://github.com/GustavoHeringerCurcio/pz-viewpoint-starter/releases/download'
  const publicBase =
    'https://github.com/GustavoHeringerCurcio/EasyPZ-mod-installer/releases/download'
  return {
    fileName,
    sha256,
    sizeBytes,
    requiredDiskGB,
    releaseTag,
    urls: {
      alpha: `${alphaBase}/${releaseTag}/${fileName}`,
      public: `${publicBase}/${releaseTag}/${fileName}`,
    },
  }
}

const mediumGroups = [
  'Pack1_Core',
  'Pack2_Tactical',
  'Pack3_Atmosphere',
  'Pack4_Survival',
  'Pack5_QoL',
  'Pack6_Extras',
  'Pack7_Immersion',
]
const advancedGroups = ['Pack8_AdvancedFixes', 'Pack10_AdvancedRealism']

const raw = JSON.parse(await fs.readFile(legacyManifest, 'utf8'))
const commonCredits = [
  'All mods belong to their respective authors.',
  'The release archive is a convenience mirror for this pack; it is not claimed as original work.',
  'Not affiliated with The Indie Stone.',
]

const medium = {
  schemaVersion: 1,
  id: 'medium',
  name: 'Medium',
  tagline: 'The balanced Viewpoint experience',
  description:
    'The complete first and third-person Viewpoint setup: tactical gunplay, atmosphere, survival, quality-of-life, and immersion mods. Designed as the safest choice for an existing save.',
  cover: 'packs/medium/cover.svg',
  gallery: [],
  placeholderArt: true,
  gameBuild: '42.21',
  tags: ['balanced', 'viewpoint', 'save-safe', 'multiplayer'],
  extends: null,
  order: 10,
  archive: archive(
    'PZ-Viewpoint-Mods.tar',
    'f3999811acf25c531772e8d2faf8d20bb4bd0b760b4812dc59eb22d2818a3b5e',
    1181116006,
    4,
    'mods-v1',
  ),
  requirements: {
    freeDiskGB: 4,
    ramGB: 8,
    recommendedRamGB: 16,
    vramGB: 8,
  },
  groups: mapGroups(mediumGroups, raw),
  warnings: [
    'Close Project Zomboid before installing.',
    'Back up your save manually. EasyPZ does not back up saves.',
    'Do not combine with Knox Inventory, Tactical Grid Inventory, Equipment UI, CleanUI, Modern Status, or Clean HotBar.',
  ],
  credits: commonCredits,
  updatedAt: '2026-10-20',
}

const advanced = {
  schemaVersion: 1,
  id: 'advanced',
  name: 'Advanced',
  tagline: 'Medium, plus mechanics, UI, and swimming',
  description:
    'Everything in Medium with additional fixes, realism, and survival mechanics. Advanced is additive: it does not remove or replace the Medium base.',
  cover: 'packs/advanced/cover.svg',
  gallery: [],
  placeholderArt: true,
  gameBuild: '42.21',
  tags: ['mechanics', 'realism', 'swimming', 'additive'],
  extends: 'medium',
  order: 20,
  archive: archive(
    'PZ-Viewpoint-Mods-Advanced.tar',
    'abb58fcb08995847c0d8c8212def05dea69ad441529a31a7ea33e84abac2090c',
    1073741824,
    5,
    'mods-v3',
  ),
  requirements: {
    freeDiskGB: 5,
    ramGB: 8,
    recommendedRamGB: 16,
    vramGB: 8,
  },
  groups: mapGroups(advancedGroups, raw),
  warnings: [
    'Close Project Zomboid before installing.',
    'Back up your save manually before switching from an RV save.',
    'Every player on a co-op server must use the same pack and archive version.',
  ],
  credits: commonCredits,
  updatedAt: '2026-10-20',
}

for (const [id, pack] of [
  ['medium', medium],
  ['advanced', advanced],
]) {
  const dir = path.join(packsRoot, id)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'pack.json'), `${JSON.stringify(pack, null, 2)}\n`, 'utf8')
  console.log(`Wrote catalog/packs/${id}/pack.json`)
}

const mediumStats = effectiveMods(mediumGroups, raw)
const advancedStats = effectiveMods([...mediumGroups, ...advancedGroups], raw)
console.log(
  `Medium: ${mediumStats.length} entries, Advanced: ${advancedStats.length} entries (client + server)`,
)

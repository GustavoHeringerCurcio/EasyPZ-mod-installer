import fs from 'node:fs/promises'
import path from 'node:path'
import { EasyPzError, toError } from './errors.js'

export const MIN_HEAP_MB = 3072
export const MAX_HEAP_MB = 16384

export function maxHeapMB(totalRamMB: number): number {
  if (!Number.isFinite(totalRamMB) || totalRamMB <= 0) return MAX_HEAP_MB
  const half = Math.floor(totalRamMB / 2)
  const capped = Math.min(MAX_HEAP_MB, Math.max(MIN_HEAP_MB, half))
  return Math.floor(capped / 512) * 512
}

export function normalizeHeapMB(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  const rounded = Math.round(numeric / 512) * 512
  return Math.max(MIN_HEAP_MB, Math.min(MAX_HEAP_MB, rounded))
}

export interface GameConfigResult {
  jsonPatched: boolean
  batPatched: boolean
  optionsPatched: boolean
  heapMB: number
}

export async function applyGameConfig(options: {
  pzPath: string
  zomboidDir: string
  heapMB: number
  zombieBuddyInstalled: boolean
}): Promise<GameConfigResult> {
  const { pzPath, zomboidDir, zombieBuddyInstalled } = options
  const heap = normalizeHeapMB(options.heapMB) ?? options.heapMB
  const xmx = `-Xmx${heap}m`
  const result: GameConfigResult = {
    jsonPatched: false,
    batPatched: false,
    optionsPatched: false,
    heapMB: heap,
  }

  const jsonPath = path.join(pzPath, 'ProjectZomboid64.json')
  try {
    const raw = await fs.readFile(jsonPath, 'utf8')
    const json = JSON.parse(raw) as { vmArgs?: unknown }
    const vmArgs = Array.isArray(json.vmArgs)
      ? json.vmArgs.filter((value): value is string => typeof value === 'string')
      : []

    let next = vmArgs.some((arg) => /^-Xmx/.test(arg))
      ? vmArgs.map((arg) => (/^-Xmx/.test(arg) ? xmx : arg))
      : [...vmArgs, xmx]

    if (zombieBuddyInstalled) {
      if (!next.some((arg) => arg.includes('agentlib:zbNative'))) {
        next = ['-agentlib:zbNative', ...next]
      }
    } else {
      next = next.filter((arg) => !arg.includes('agentlib:zbNative'))
    }

    json.vmArgs = next
    await fs.writeFile(jsonPath, JSON.stringify(json, null, 4), 'utf8')
    result.jsonPatched = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new EasyPzError(
        'IO',
        `Could not update ProjectZomboid64.json: ${toError(error).message}`,
        { cause: toError(error) },
      )
    }
  }

  const batPath = path.join(pzPath, 'ProjectZomboid64.bat')
  try {
    let bat = await fs.readFile(batPath, 'utf8')
    if (zombieBuddyInstalled) {
      if (!bat.includes('agentlib:zbNative')) {
        bat = bat.replace(/SET _JAVA_OPTIONS=.*/g, 'SET _JAVA_OPTIONS=-agentlib:zbNative')
      }
    } else {
      bat = bat.replace(/SET _JAVA_OPTIONS=.*/g, 'SET _JAVA_OPTIONS=')
    }
    bat = bat.replace(/-Xmx\d+[mMgG]?/g, xmx)
    await fs.writeFile(batPath, bat, 'ascii')
    result.batPatched = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new EasyPzError(
        'IO',
        `Could not update ProjectZomboid64.bat: ${toError(error).message}`,
        { cause: toError(error) },
      )
    }
  }

  const optionsPath = path.join(zomboidDir, 'options.ini')
  try {
    let ini = await fs.readFile(optionsPath, 'utf8')
    if (/textureCompression=/.test(ini)) {
      ini = ini.replace(/textureCompression=false/g, 'textureCompression=true')
    } else {
      ini = `${ini.replace(/\s+$/, '')}\r\ntextureCompression=true\r\n`
    }
    await fs.writeFile(optionsPath, ini, 'ascii')
    result.optionsPatched = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new EasyPzError('IO', `Could not update options.ini: ${toError(error).message}`, {
        cause: toError(error),
      })
    }
  }

  return result
}

export type PerformancePreset = 'recommended' | 'light' | 'defaults'

interface PerformanceKeySet {
  properties: Record<string, string>
  options: Record<string, string>
  modOptions: Record<string, string>
}

const BOOST_PROPERTIES: Record<string, string> = {
  'memory.floorMiB': '768',
  'pack.trueweathers.occlusion': 'false',
  'pack.trueweathers.reflections': 'low',
  'pack.trueweathers.shadowCascades': '2',
  'pack.trueweathers.shadowResolution': '1024',
  'pack.trueweathers.sunShafts': 'false',
  'pack.trueweathers.rainDensity': '50',
  'pack.trueweathers.wetWalls': 'false',
  'pack.trueweathers.renderScale': '90',
}

const BOOST_OPTIONS: Record<string, string> = {
  bloodDecals: '6',
  maxActiveRagdolls: '12',
  maxVehicleTextureSize: '1',
}

const BOOST_MOD_OPTIONS: Record<string, string> = {
  'combobox|ViewpointTrueWeathers|quality': '2',
  'combobox|ViewpointTrueWeathers|precipitation': '2',
}

const DEFAULT_PROPERTIES: Record<string, string> = {
  'memory.floorMiB': '512',
  'pack.trueweathers.occlusion': 'true',
  'pack.trueweathers.reflections': 'medium',
  'pack.trueweathers.shadowCascades': '3',
  'pack.trueweathers.shadowResolution': '2048',
  'pack.trueweathers.sunShafts': 'true',
  'pack.trueweathers.rainDensity': '100',
  'pack.trueweathers.wetWalls': 'true',
  'pack.trueweathers.renderScale': '100',
}

const DEFAULT_OPTIONS: Record<string, string> = {
  bloodDecals: '10',
  maxActiveRagdolls: '20',
  maxVehicleTextureSize: '2',
}

const DEFAULT_MOD_OPTIONS: Record<string, string> = {
  'combobox|ViewpointTrueWeathers|quality': '3',
  'combobox|ViewpointTrueWeathers|precipitation': '3',
}

function performanceKeys(preset: PerformancePreset): PerformanceKeySet {
  if (preset === 'defaults') {
    return {
      properties: DEFAULT_PROPERTIES,
      options: DEFAULT_OPTIONS,
      modOptions: DEFAULT_MOD_OPTIONS,
    }
  }
  if (preset === 'light') {
    return { properties: BOOST_PROPERTIES, options: {}, modOptions: BOOST_MOD_OPTIONS }
  }
  return {
    properties: BOOST_PROPERTIES,
    options: BOOST_OPTIONS,
    modOptions: BOOST_MOD_OPTIONS,
  }
}

export interface PerformanceConfigResult extends GameConfigResult {
  preset: PerformancePreset
  propertiesPatched: boolean
  modOptionsPatched: boolean
  skipped: string[]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function setIniValue(raw: string, key: string, value: string): string {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const pattern = new RegExp(`^${escapeRegExp(key)}=.*$`, 'm')
  if (pattern.test(raw)) return raw.replace(pattern, `${key}=${value}`)
  const base = raw.length > 0 ? raw.replace(/\s+$/, '') : ''
  return `${base}${base ? eol : ''}${key}=${value}${eol}`
}

function setPipeValue(raw: string, prefix: string, value: string): string {
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const pattern = new RegExp(`^${escapeRegExp(prefix)}\\|.*$`, 'm')
  if (pattern.test(raw)) return raw.replace(pattern, `${prefix}|${value}`)
  const base = raw.length > 0 ? raw.replace(/\s+$/, '') : ''
  return `${base}${base ? eol : ''}${prefix}|${value}${eol}`
}

async function readOptional(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

export async function applyPerformanceConfig(options: {
  pzPath: string
  zomboidDir: string
  preset: PerformancePreset
  heapMB: number
  zombieBuddyInstalled: boolean
}): Promise<PerformanceConfigResult> {
  const { pzPath, zomboidDir, zombieBuddyInstalled, preset } = options
  const keys = performanceKeys(preset)
  const skipped: string[] = []

  const propertiesPath = path.join(zomboidDir, 'viewpoint-live.properties')
  let properties = (await readOptional(propertiesPath)) ?? ''
  for (const [key, value] of Object.entries(keys.properties)) {
    properties = setIniValue(properties, key, value)
  }
  await fs.writeFile(propertiesPath, properties, 'utf8')

  const optionsPath = path.join(zomboidDir, 'options.ini')
  const optionsText = await readOptional(optionsPath)
  if (Object.keys(keys.options).length > 0) {
    if (optionsText === null) {
      skipped.push('options.ini')
    } else {
      let ini = optionsText
      for (const [key, value] of Object.entries(keys.options)) {
        ini = setIniValue(ini, key, value)
      }
      await fs.writeFile(optionsPath, ini, 'ascii')
    }
  }

  const modOptionsPath = path.join(zomboidDir, 'Lua', 'ModOptions.ini')
  let modOptionsPatched = false
  const modOptions = await readOptional(modOptionsPath)
  if (modOptions !== null) {
    let next = modOptions
    for (const [key, value] of Object.entries(keys.modOptions)) {
      next = setPipeValue(next, key, value)
    }
    await fs.writeFile(modOptionsPath, next, 'utf8')
    modOptionsPatched = true
  } else {
    skipped.push('Lua/ModOptions.ini')
  }

  const gameConfig = await applyGameConfig({
    pzPath,
    zomboidDir,
    heapMB: options.heapMB,
    zombieBuddyInstalled,
  })

  return {
    ...gameConfig,
    preset,
    propertiesPatched: true,
    modOptionsPatched,
    skipped,
  }
}

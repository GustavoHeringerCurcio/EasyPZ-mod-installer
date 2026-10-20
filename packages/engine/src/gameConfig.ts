import fs from 'node:fs/promises'
import path from 'node:path'
import { EasyPzError, toError } from './errors.js'

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
  const { pzPath, zomboidDir, heapMB, zombieBuddyInstalled } = options
  const xmx = `-Xmx${heapMB}m`
  const result: GameConfigResult = {
    jsonPatched: false,
    batPatched: false,
    optionsPatched: false,
    heapMB,
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

import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import type { Language, Settings } from '../shared/ipc'

const defaults: Settings = {
  language: 'en',
  gamePathOverride: null,
  updateChannel: 'off',
}

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      language: parsed.language === 'pt-BR' ? 'pt-BR' : 'en',
      gamePathOverride:
        typeof parsed.gamePathOverride === 'string' && parsed.gamePathOverride.length > 0
          ? parsed.gamePathOverride
          : null,
      updateChannel: parsed.updateChannel === 'latest' ? 'latest' : 'off',
    }
  } catch {
    return { ...defaults }
  }
}

export async function writeSettings(settings: Settings): Promise<void> {
  const file = settingsPath()
  await fs.mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp`
  await fs.writeFile(temp, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  try {
    await fs.rename(temp, file)
  } catch {
    await fs.rm(file, { force: true })
    await fs.rename(temp, file)
  }
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await readSettings()
  const next: Settings = { ...current, ...patch }
  await writeSettings(next)
  return next
}

export function isLanguage(value: unknown): value is Language {
  return value === 'en' || value === 'pt-BR'
}

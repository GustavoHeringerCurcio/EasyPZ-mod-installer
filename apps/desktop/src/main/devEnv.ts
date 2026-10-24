import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

const TRUTHY_VALUES = new Set(['1', 'true', 'yes', 'on', 'admin'])

function envCandidates(): string[] {
  return [
    ...new Set([
      path.resolve(process.cwd(), '.env'),
      path.resolve(app.getAppPath(), '.env'),
      path.resolve(app.getAppPath(), '..', '..', '.env'),
      path.resolve(__dirname, '..', '..', '..', '..', '.env'),
    ]),
  ]
}

function parseDotEnv(content: string): Map<string, string> {
  const values = new Map<string, string>()

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separator = line.indexOf('=')
    if (separator === -1) {
      values.set(line, '1')
      continue
    }

    const key = line.slice(0, separator).trim()
    if (!key) continue

    let value = line.slice(separator + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    } else {
      const comment = value.indexOf(' #')
      if (comment !== -1) value = value.slice(0, comment).trim()
    }

    values.set(key, value)
  }

  return values
}

export function loadDevEnv(): void {
  if (app.isPackaged || process.env.ADMIN !== undefined) return

  for (const candidate of envCandidates()) {
    if (!existsSync(candidate)) continue

    try {
      const admin = parseDotEnv(readFileSync(candidate, 'utf8')).get('ADMIN')
      if (admin !== undefined) {
        process.env.ADMIN = admin
        return
      }
    } catch {
      // Ignore unreadable or malformed .env files and keep the bundled behavior.
    }
  }
}

export function isDevAdmin(): boolean {
  if (app.isPackaged) return false
  const value = process.env.ADMIN?.trim().toLowerCase()
  return value !== undefined && TRUTHY_VALUES.has(value)
}

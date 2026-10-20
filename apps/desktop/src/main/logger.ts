import fs from 'node:fs/promises'
import path from 'node:path'
import log from 'electron-log/main'
import { getAppPaths } from '@easypz/engine'

const paths = getAppPaths()
export const logsDir = path.join(paths.easyPzDir, 'logs')

log.transports.file.level = 'info'
log.transports.file.maxSize = 5 * 1024 * 1024
log.transports.file.resolvePathFn = () => path.join(logsDir, 'main.log')

export async function ensureLogsDir(): Promise<void> {
  await fs.mkdir(logsDir, { recursive: true })
}

export { log }

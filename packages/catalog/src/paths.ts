import path from 'node:path'
import { fileURLToPath } from 'node:url'

const sourceDir = path.dirname(fileURLToPath(import.meta.url))
const packageDir = path.resolve(sourceDir, '..')

export const catalogRoot = path.resolve(packageDir, '..', '..', 'catalog')
export const packsRoot = path.join(catalogRoot, 'packs')
export const catalogIndexPath = path.join(catalogRoot, 'index.json')

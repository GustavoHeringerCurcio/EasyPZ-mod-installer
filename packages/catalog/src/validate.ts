import fs from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { buildCatalog, formatZodError } from './build.js'
import { catalogSchema } from './schema.js'
import { catalogIndexPath } from './paths.js'

export async function validateCommittedCatalog(): Promise<void> {
  const raw = await fs.readFile(catalogIndexPath, 'utf8')

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`catalog/index.json is not valid JSON: ${(error as Error).message}`)
  }

  let committed: ReturnType<typeof catalogSchema.parse>
  try {
    committed = catalogSchema.parse(parsed)
  } catch (error) {
    throw new Error(`catalog/index.json is invalid:\n${formatZodError(error)}`)
  }

  const catalog = await buildCatalog({ mode: committed.mode, write: false })
  const packIds = new Set(committed.packs.map((pack) => pack.id))
  for (const pack of committed.packs) {
    if (pack.extends && !packIds.has(pack.extends)) {
      throw new Error(`${pack.id}: extends missing pack ${pack.extends}`)
    }
    if (committed.mode !== 'alpha' && committed.mode !== 'public') {
      throw new Error(`Invalid catalog mode: ${committed.mode}`)
    }
  }

  for (const pack of catalog.packs) {
    const committedPack = committed.packs.find((candidate) => candidate.id === pack.id)
    if (!committedPack) {
      throw new Error(`catalog/index.json is missing pack ${pack.id}; run pnpm catalog:generate`)
    }
    if (pack.source === 'archive') {
      if (
        !committedPack.archive ||
        !pack.archive ||
        committedPack.archive.sha256 !== pack.archive.sha256
      ) {
        throw new Error(
          `${pack.id}: committed archive hash does not match pack.json; run pnpm catalog:generate`,
        )
      }
    } else if (
      !committedPack.workshop ||
      !pack.workshop ||
      committedPack.workshop.collectionId !== pack.workshop.collectionId
    ) {
      throw new Error(
        `${pack.id}: committed workshop metadata does not match pack.json; run pnpm catalog:generate`,
      )
    }
    if (
      committedPack.stats.clientMods !== pack.stats.clientMods ||
      committedPack.stats.workshopCount !== pack.stats.workshopCount
    ) {
      throw new Error(`${pack.id}: committed stats are stale; run pnpm catalog:generate`)
    }
  }

  console.log(
    `Catalog valid: ${committed.mode}, ${committed.packs.length} packs, ${committed.packs.map((pack) => `${pack.id}(${pack.stats.clientMods})`).join(', ')}`,
  )
}

async function main(): Promise<void> {
  await validateCommittedCatalog()
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}

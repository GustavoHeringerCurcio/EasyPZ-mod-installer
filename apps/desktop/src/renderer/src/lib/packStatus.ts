import type { Bootstrap } from '../../../shared/ipc'

export function packUpdateAvailable(bootstrap: Bootstrap, packId: string): boolean {
  const install = bootstrap.state.installs[packId]
  const pack = bootstrap.catalog.packs.find((candidate) => candidate.id === packId)
  if (!install || !pack) return false
  if (install.packUpdatedAt) return install.packUpdatedAt !== pack.updatedAt
  return install.catalogGeneratedAt !== bootstrap.catalog.generatedAt
}

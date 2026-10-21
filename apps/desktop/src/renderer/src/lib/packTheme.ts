import type { PackView } from '../../../shared/ipc'

export const DEFAULT_PACK_ACCENT = '#fd1a04'

const RECOMMENDED_PACK_IDS = new Set(['essentials', 'medium', 'advanced'])

export function packAccent(pack: Pick<PackView, 'accent'> | null | undefined): string {
  return pack?.accent ?? DEFAULT_PACK_ACCENT
}

export function isRecommendedPack(pack: Pick<PackView, 'id' | 'featured'>): boolean {
  return pack.featured || RECOMMENDED_PACK_IDS.has(pack.id)
}

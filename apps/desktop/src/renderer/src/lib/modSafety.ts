const CORE_MOD_IDS = new Set(['ZombieBuddy', 'Viewpoint'])

export function isCoreModId(modId: string): boolean {
  return CORE_MOD_IDS.has(modId)
}

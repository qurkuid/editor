import type { LightingSwitchNode } from './schema'

const GANG_OBJECT_PREFIX = 'lighting-switch-gang-'

export function resolveLightingSwitchCircuitIds(
  node: LightingSwitchNode,
): readonly (string | null)[] {
  const circuitIds = node.circuitIds ?? []
  if (circuitIds.length > 0) {
    return Array.from({ length: node.gangCount }, (_, index) => circuitIds[index] ?? null)
  }
  return Array.from({ length: node.gangCount }, (_, index) => (index === 0 ? node.circuitId : null))
}

export function lightingSwitchGangObjectName(index: number): string {
  return `${GANG_OBJECT_PREFIX}${index}`
}

export function resolveLightingSwitchGangIndex(objectName: string, gangCount: number): number {
  if (!objectName.startsWith(GANG_OBJECT_PREFIX)) return 0
  const index = Number(objectName.slice(GANG_OBJECT_PREFIX.length))
  return Number.isInteger(index) && index >= 0 && index < gangCount ? index : 0
}

import type { CabinetModuleNode, CabinetNode } from './schema'

type CabinetStackOwner = CabinetNode | CabinetModuleNode

/** One freeform opening in a countertop slab — see CountertopCutout in
 * `@pascal-app/core`'s cabinet schema for the field-by-field convention. */
export type CountertopCutout = NonNullable<CabinetStackOwner['countertopCutouts']>[number]
export type CountertopCutoutShape = CountertopCutout['shape']
export type CountertopCutoutKind = CountertopCutout['kind']

export const COUNTERTOP_CUTOUT_KINDS: CountertopCutoutKind[] = [
  'sink',
  'cooktop',
  'outlet',
  'custom',
]

let cutoutIdCounter = 0
function makeCutoutId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `cut_${crypto.randomUUID().slice(0, 8)}`
  }
  return `cut_${(cutoutIdCounter++).toString(36)}`
}

/** Default rect/circle cutout, sized small enough to sit safely inside a
 * standard countertop without the caller having to pick dimensions first. */
export function newCountertopCutout(shape: CountertopCutoutShape): CountertopCutout {
  if (shape === 'circle') {
    return {
      id: makeCutoutId(),
      kind: 'custom',
      shape: 'circle',
      position: { x: 0, z: 0 },
      radius: 0.05,
    }
  }
  return {
    id: makeCutoutId(),
    kind: 'custom',
    shape: 'rect',
    position: { x: 0, z: 0 },
    size: { width: 0.1, depth: 0.1 },
    cornerRadius: 0,
  }
}

/** Spread-with-override for the cutout union, matching `patchCompartment` in
 * `stack.ts` — the cast is contained here so call sites stay clean under the
 * discriminated union. */
export function patchCountertopCutout(
  cutout: CountertopCutout,
  patch: Partial<{
    kind: CountertopCutoutKind
    position: { x: number; z: number }
    size: { width: number; depth: number }
    radius: number
    cornerRadius: number
  }>,
): CountertopCutout {
  return { ...cutout, ...patch } as CountertopCutout
}

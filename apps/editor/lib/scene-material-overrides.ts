import type { SceneMaterial } from '@pascal-app/core'
import type { TakeoffLine } from './quantity-takeoff'

/**
 * Follow a painted face back to the INTM product it was painted with.
 *
 * Picking a catalogue material in the paint panel freezes it into a per-scene
 * copy, so the face's ref reads `scene:mat_…` — and the INTM identity moves
 * into the copy's `material.source`. Matching by ref alone therefore reported
 * 자재 미연결 for a wall painted with a real INTM wallpaper.
 *
 * This resolves those refs into the overrides map `buildEstimateDraft` already
 * accepts, keyed the way it expects (`category:key`). Scene materials painted
 * from other providers, or mixed by hand, resolve to nothing and stay unlinked
 * — which is true: nobody has said which product they are.
 */

const INTM_PROVIDER = 'intm'

type SceneMaterials = Readonly<Record<string, SceneMaterial>>

export function intmOverridesFromSceneMaterials(
  sceneMaterials: SceneMaterials,
  lines: readonly TakeoffLine[],
): Record<string, string> {
  const overrides: Record<string, string> = {}

  for (const line of lines) {
    const ref = line.materialRef
    if (!ref?.startsWith('scene:')) continue

    const source = sceneMaterials[ref.slice('scene:'.length)]?.material.source
    if (source?.provider !== INTM_PROVIDER || !source.externalId) continue

    overrides[`${line.category}:${line.key}`] = source.externalId
  }

  return overrides
}

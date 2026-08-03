import useScene from '@pascal-app/core/store'
import { type AiModelingPlan, AiModelingPlanSchema } from './ai-contract'
import { applyAiModelingPlan } from './ai-control'
import { getOrCreateSeamlessAsset } from './material-seamless-cache'

export async function applyAiModelingPlanWithAssets(
  input: unknown,
  resolveSeamlessAsset: (sourceUrl: string) => Promise<string> = getOrCreateSeamlessAsset,
): Promise<ReturnType<typeof applyAiModelingPlan>> {
  const plan = AiModelingPlanSchema.parse(input)
  const resolvedPatches: AiModelingPlan['patches'] = await Promise.all(
    plan.patches.map(async (patch) => {
      if (patch.op !== 'makeMaterialSeamless') return patch
      const sceneMaterial = useScene.getState().materials[patch.materialId]
      const texture = sceneMaterial?.material.texture
      if (!(sceneMaterial && texture)) {
        throw new RangeError(`AI textured scene material not found: ${patch.materialId}`)
      }
      const url = await resolveSeamlessAsset(texture.url)
      return {
        op: 'updateSceneMaterial',
        material: {
          ...sceneMaterial,
          id: patch.materialId,
          material: { ...sceneMaterial.material, texture: { ...texture, url } },
        },
      }
    }),
  )
  return applyAiModelingPlan({ ...plan, patches: resolvedPatches })
}

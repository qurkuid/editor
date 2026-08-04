export type MaterialSeamlessAvailability = 'complete' | 'missing-texture' | 'ready'

// Matches only the current pipelines (`seamless2` wrap-shift, `bookmatch`
// mirror bake) — materials processed by the retired edge-blur pass read as
// 'ready' so the user can re-run a better one.
const SEAMLESS_ASSET_URL = /^asset:\/\/(?:seamless2|bookmatch)-[0-9a-f]{64}$/

export function getMaterialSeamlessAvailability(
  textureUrl: string | undefined,
): MaterialSeamlessAvailability {
  if (!textureUrl) return 'missing-texture'
  return SEAMLESS_ASSET_URL.test(textureUrl) ? 'complete' : 'ready'
}

export type MaterialSeamlessAvailability = 'complete' | 'missing-texture' | 'ready'

const SEAMLESS_ASSET_URL = /^asset:\/\/seamless-[0-9a-f]{64}$/

export function getMaterialSeamlessAvailability(
  textureUrl: string | undefined,
): MaterialSeamlessAvailability {
  if (!textureUrl) return 'missing-texture'
  return SEAMLESS_ASSET_URL.test(textureUrl) ? 'complete' : 'ready'
}

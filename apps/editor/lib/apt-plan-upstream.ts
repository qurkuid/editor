import { getAptData } from '@/lib/apt-data'

const FETCH_TIMEOUT_MS = 12_000
const MAX_IMAGE_BYTES = 15 * 1024 * 1024

export type PlanImageResult =
  | { ok: true; bytes: ArrayBuffer; contentType: string }
  | {
      ok: false
      code: 'DATASET_UNAVAILABLE' | 'NOT_FOUND' | 'IMAGE_UNAVAILABLE' | 'IMAGE_TOO_LARGE'
      status: number
    }

/**
 * Fetches one plan image from the upstream CDN, shared by the image proxy and
 * the vectorize route. Never an open proxy: the upstream URL comes only from
 * our own plan index, and the host must still match the known CDN.
 */
export async function fetchPlanImage(id: string, planId: string): Promise<PlanImageResult> {
  let upstream: string | undefined
  try {
    const { planPicByApartment } = await getAptData()
    upstream = planPicByApartment.get(decodeURIComponent(id))?.get(decodeURIComponent(planId))
  } catch (error) {
    console.warn(
      'apt plan image dataset unavailable:',
      error instanceof Error ? error.message : error,
    )
    return { ok: false, code: 'DATASET_UNAVAILABLE', status: 503 }
  }
  if (!upstream || !isAllowedUpstream(upstream)) {
    return { ok: false, code: 'NOT_FOUND', status: 404 }
  }

  try {
    const response = await fetch(upstream, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) return { ok: false, code: 'IMAGE_UNAVAILABLE', status: 502 }

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
      return { ok: false, code: 'IMAGE_UNAVAILABLE', status: 502 }
    }
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_IMAGE_BYTES) {
      return { ok: false, code: 'IMAGE_TOO_LARGE', status: 502 }
    }
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return { ok: false, code: 'IMAGE_TOO_LARGE', status: 502 }
    }
    return { ok: true, bytes, contentType }
  } catch (error) {
    console.warn(
      `apt plan image fetch failed (${planId}):`,
      error instanceof Error ? error.message : error,
    )
    return { ok: false, code: 'IMAGE_UNAVAILABLE', status: 502 }
  }
}

function isAllowedUpstream(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    return parsed.hostname === 'kujiale.com' || parsed.hostname.endsWith('.kujiale.com')
  } catch {
    return false
  }
}

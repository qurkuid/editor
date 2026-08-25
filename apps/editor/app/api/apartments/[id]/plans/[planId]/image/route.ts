import { NextResponse } from 'next/server'
import { aptJson, aptRateLimit } from '@/lib/apt-api'
import { getAptData } from '@/lib/apt-data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const FETCH_TIMEOUT_MS = 12_000
const MAX_IMAGE_BYTES = 15 * 1024 * 1024

/**
 * Server-side pass-through for one plan image, so a guide node can reference
 * the plan with an app-relative URL (`AssetUrl` allowlist) instead of
 * hotlinking the upstream CDN from the canvas. Never an open proxy: the
 * upstream URL comes only from our own plan index, and the host must still
 * match the known CDN. Nothing is persisted.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; planId: string }> },
) {
  const limited = aptRateLimit(request, 'plan-image', 120)
  if (limited) return limited

  const { id, planId } = await params
  let upstream: string | undefined
  try {
    const { planPicByApartment } = await getAptData()
    upstream = planPicByApartment.get(decodeURIComponent(id))?.get(decodeURIComponent(planId))
  } catch (error) {
    console.warn(
      'apt plan image dataset unavailable:',
      error instanceof Error ? error.message : error,
    )
    return aptJson(request, { code: 'DATASET_UNAVAILABLE' }, 503)
  }
  if (!upstream || !isAllowedUpstream(upstream)) {
    return aptJson(request, { code: 'NOT_FOUND' }, 404)
  }

  try {
    const response = await fetch(upstream, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!response.ok) return aptJson(request, { code: 'IMAGE_UNAVAILABLE' }, 502)

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) {
      return aptJson(request, { code: 'IMAGE_UNAVAILABLE' }, 502)
    }
    const declaredLength = Number(response.headers.get('content-length') ?? 0)
    if (declaredLength > MAX_IMAGE_BYTES) {
      return aptJson(request, { code: 'IMAGE_TOO_LARGE' }, 502)
    }
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return aptJson(request, { code: 'IMAGE_TOO_LARGE' }, 502)
    }

    return new NextResponse(bytes, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.warn(
      `apt plan image fetch failed (${planId}):`,
      error instanceof Error ? error.message : error,
    )
    return aptJson(request, { code: 'IMAGE_UNAVAILABLE' }, 502)
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

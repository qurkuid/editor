import { NextResponse } from 'next/server'
import { aptJson, aptRateLimit } from '@/lib/apt-api'
import { fetchPlanImage } from '@/lib/apt-plan-upstream'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Server-side pass-through for one plan image, so a guide node can reference
 * the plan with an app-relative URL (`AssetUrl` allowlist) instead of
 * hotlinking the upstream CDN from the canvas. Nothing is persisted.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; planId: string }> },
) {
  const limited = aptRateLimit(request, 'plan-image', 120)
  if (limited) return limited

  const { id, planId } = await params
  const result = await fetchPlanImage(id, planId)
  if (!result.ok) return aptJson(request, { code: result.code }, result.status)

  return new NextResponse(result.bytes, {
    headers: {
      'Content-Type': result.contentType,
      'Cache-Control': 'public, max-age=604800',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

import { type NextRequest, NextResponse } from 'next/server'
import {
  fetchIntmCategories,
  fetchIntmMaterials,
  saveIntmMaterialCoverage,
} from '@/lib/intm-materials'
import { intmAuthEnabled } from '@/lib/intm-session'

/**
 * The browser's window onto INTM's catalogue.
 *
 * It exists so the session cookie stays server-side: the client never holds an
 * INTM credential, it just asks this route, which forwards the caller's own
 * cookie. That also means a user only ever sees the materials their INTM
 * session entitles them to — their company's plus the shared ones.
 */

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!intmAuthEnabled()) {
    // Local dev with no INTM configured: an empty catalogue, not an error, so
    // the statistics page still renders its takeoff without prices.
    return NextResponse.json({
      materials: [],
      categories: [],
      connected: false,
      reason: 'not-configured',
    })
  }

  const cookie = request.headers.get('cookie')
  const [materials, categories] = await Promise.all([
    fetchIntmMaterials(cookie),
    fetchIntmCategories(cookie),
  ])

  // "Configured" is not "working". Reporting a reachable-but-empty catalogue as
  // connected left the panel saying nothing at all about why every line was
  // unpriced — and cost two rounds of guessing at what had gone wrong.
  return NextResponse.json({
    materials,
    categories,
    connected: materials.length > 0,
    ...(materials.length === 0 ? { reason: 'empty' } : {}),
  })
}

/** Correct a material's coverage/waste spec — writes straight through to INTM. */
export async function PATCH(request: NextRequest) {
  if (!intmAuthEnabled()) {
    return NextResponse.json({ error: 'INTM is not configured' }, { status: 503 })
  }

  let body: { materialId?: unknown; patch?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Malformed request body' }, { status: 400 })
  }

  const { materialId, patch } = body
  if (typeof materialId !== 'string' || !patch || typeof patch !== 'object') {
    return NextResponse.json({ error: 'materialId and patch are required' }, { status: 400 })
  }

  const saved = await saveIntmMaterialCoverage(
    materialId,
    patch as Parameters<typeof saveIntmMaterialCoverage>[1],
    request.headers.get('cookie'),
  )

  return saved
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: 'INTM rejected the update' }, { status: 502 })
}

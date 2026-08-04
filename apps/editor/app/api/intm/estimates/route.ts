import { type NextRequest, NextResponse } from 'next/server'
import type { EstimateDraft } from '@/lib/estimate-lines'
import { submitEstimate } from '@/lib/estimate-submit'
import { intmAuthEnabled } from '@/lib/intm-session'

/**
 * Creates an INTM estimate from a floorplan draft, forwarding the caller's own
 * session so the estimate lands under their company with their authorship.
 */

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  if (!intmAuthEnabled()) {
    return NextResponse.json({ ok: false, error: 'INTM이 설정되지 않았습니다.' }, { status: 503 })
  }

  let body: {
    draft?: unknown
    projectId?: unknown
    title?: unknown
    customerId?: unknown
    description?: unknown
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: '요청 형식이 올바르지 않습니다.' },
      { status: 400 },
    )
  }

  const draft = body.draft as EstimateDraft | undefined
  if (!draft || !Array.isArray(draft.lines)) {
    return NextResponse.json({ ok: false, error: '견적 초안이 없습니다.' }, { status: 400 })
  }

  // INTM hangs an estimate off an existing project, so both are required here
  // rather than defaulted — inventing a project would scatter stray records.
  if (typeof body.projectId !== 'string' || typeof body.title !== 'string') {
    return NextResponse.json(
      { ok: false, error: '프로젝트와 견적서 제목이 필요합니다.' },
      { status: 400 },
    )
  }

  const result = await submitEstimate(
    draft,
    {
      projectId: body.projectId,
      title: body.title,
      customerId: typeof body.customerId === 'string' ? body.customerId : undefined,
      description: typeof body.description === 'string' ? body.description : undefined,
    },
    request.headers.get('cookie'),
  )

  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}

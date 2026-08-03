import { NextResponse } from 'next/server'

const RAWPAINTER_ASSET_BASE = 'https://intm.kr/api/studio/material-clone/asset'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'invalid_material_id' }, { status: 400 })
  }
  const requestedKind = new URL(request.url).searchParams.get('kind') ?? 'original'
  if (requestedKind !== 'original' && requestedKind !== 'seamless') {
    return NextResponse.json({ error: 'invalid_material_asset_kind' }, { status: 400 })
  }

  try {
    const response = await fetch(`${RAWPAINTER_ASSET_BASE}/${id}/${requestedKind}`, {
      next: { revalidate: 604800 },
    })
    if (!response.ok || !response.body) {
      return NextResponse.json({ error: 'material_asset_unavailable' }, { status: 502 })
    }
    return new Response(response.body, {
      headers: {
        'Cache-Control': 'public, max-age=604800, immutable',
        'Content-Type': response.headers.get('content-type') ?? 'image/jpeg',
      },
    })
  } catch {
    return NextResponse.json({ error: 'material_asset_unavailable' }, { status: 502 })
  }
}

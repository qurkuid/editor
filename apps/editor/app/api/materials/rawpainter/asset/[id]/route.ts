import { NextResponse } from 'next/server'

const RAWPAINTER_ASSET_BASE = 'https://intm.kr/api/studio/material-clone/asset'
// mytexture products (negative-id rows in the clone feed) keep their images on
// this bucket, which serves no CORS headers — the proxy is what makes them
// usable in canvas bakes and WebGL textures. The strict host allowlist is what
// keeps this from being an open fetch proxy.
const MYTEXTURE_ASSET_HOST = 'mytexture-assets.s3.ap-northeast-2.amazonaws.com'

async function proxyImage(url: string): Promise<Response> {
  try {
    const response = await fetch(url, { next: { revalidate: 604800 } })
    if (!response.ok || !response.body) {
      return NextResponse.json({ error: 'material_asset_unavailable' }, { status: 502 })
    }
    // S3 objects here carry broken metadata (`Content-Type: use custom value`);
    // only pass a real image type through.
    const upstreamType = response.headers.get('content-type')
    return new Response(response.body, {
      headers: {
        'Cache-Control': 'public, max-age=604800, immutable',
        'Content-Type': upstreamType?.startsWith('image/') ? upstreamType : 'image/jpeg',
      },
    })
  } catch {
    return NextResponse.json({ error: 'material_asset_unavailable' }, { status: 502 })
  }
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  if (id === 'mytexture') {
    const src = new URL(request.url).searchParams.get('src')
    let parsed: URL | null = null
    try {
      parsed = src ? new URL(src) : null
    } catch {
      parsed = null
    }
    if (parsed?.protocol !== 'https:' || parsed.hostname !== MYTEXTURE_ASSET_HOST) {
      return NextResponse.json({ error: 'invalid_material_asset_src' }, { status: 400 })
    }
    return proxyImage(parsed.href)
  }

  if (!/^\d+$/.test(id)) {
    return NextResponse.json({ error: 'invalid_material_id' }, { status: 400 })
  }
  const requestedKind = new URL(request.url).searchParams.get('kind') ?? 'original'
  if (requestedKind !== 'original' && requestedKind !== 'seamless') {
    return NextResponse.json({ error: 'invalid_material_asset_kind' }, { status: 400 })
  }
  return proxyImage(`${RAWPAINTER_ASSET_BASE}/${id}/${requestedKind}`)
}

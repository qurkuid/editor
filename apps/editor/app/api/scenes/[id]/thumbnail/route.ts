import type { NextRequest } from 'next/server'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

// Editor thumbnails are small webp captures (~50-150KB); anything bigger is
// not a thumbnail. Stored inline as a data URL so it travels with the DB
// (and its backups) — no separate asset store to lose.
const MAX_THUMBNAIL_BYTES = 1_500_000

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id } = await params
  const contentType = request.headers.get('Content-Type') ?? ''
  if (!contentType.startsWith('image/')) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: 'body must be an image' },
      { status: 400 },
    )
  }

  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_THUMBNAIL_BYTES) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: `image must be 1..${MAX_THUMBNAIL_BYTES} bytes` },
      { status: 400 },
    )
  }

  const dataUrl = `data:${contentType};base64,${Buffer.from(bytes).toString('base64')}`
  const operations = await getSceneOperations()
  const updated = await operations.setSceneThumbnail(id, dataUrl)
  if (!updated) {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }
  return sceneApiJson(request, { ok: true }, { status: 200 })
}

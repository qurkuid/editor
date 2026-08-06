import type { NextRequest } from 'next/server'
import { guardSceneApiRequest, sceneApiJson, sceneApiPreflight } from '@/lib/scene-api-security'
import { getSceneOperations } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; version: string }> }

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request)
  if (guard) return guard

  const { id, version: rawVersion } = await params
  const version = Number.parseInt(rawVersion, 10)
  if (!Number.isInteger(version) || version < 1) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: 'version must be a positive integer' },
      { status: 400 },
    )
  }

  const operations = await getSceneOperations()
  const graph = await operations.loadSceneRevision(id, version)
  if (!graph) {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }
  return sceneApiJson(request, { version, graph })
}

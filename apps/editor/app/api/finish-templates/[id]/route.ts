import type { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  bodyLimitResponse,
  handleFinishTemplateStoreError,
  principalResponse,
  resolveFinishTemplatePrincipal,
  toPublicFinishTemplateRecord,
} from '@/lib/finish-template-server'
import {
  guardSceneApiRequest,
  readSceneApiJson,
  sceneApiJson,
  sceneApiPreflight,
  withSceneApiHeaders,
} from '@/lib/scene-api-security'
import { getSceneStore } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string }> }

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    expectedVersion: z.number().int().positive().optional(),
  })
  .strict()

const MAX_FINISH_TEMPLATE_REQUEST_BYTES = 2 * 1024 * 1024

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard
  const resolution = await resolveFinishTemplatePrincipal(request)
  if (!('principal' in resolution)) return principalResponse(request, resolution)!
  const principal = resolution.principal
  const { id } = await params
  try {
    const store = await getSceneStore()
    const record = await store.getFinishTemplate(id, principal)
    if (!record) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
    return sceneApiJson(request, toPublicFinishTemplateRecord(record, principal))
  } catch (error) {
    return handleFinishTemplateStoreError(request, error)
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard
  const resolution = await resolveFinishTemplatePrincipal(request)
  if (!('principal' in resolution)) return principalResponse(request, resolution)!
  const principal = resolution.principal

  let body: unknown
  try {
    body = await readSceneApiJson(request, {
      maxCompressedBytes: MAX_FINISH_TEMPLATE_REQUEST_BYTES,
      maxExpandedBytes: MAX_FINISH_TEMPLATE_REQUEST_BYTES,
    })
  } catch (error) {
    return bodyLimitResponse(request, error)
  }
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const expectedVersion =
    parseIfMatch(request.headers.get('If-Match')) ?? parsed.data.expectedVersion
  if (expectedVersion === undefined) {
    return sceneApiJson(request, { error: 'precondition_required' }, { status: 428 })
  }

  const { id } = await params
  try {
    const store = await getSceneStore()
    const record = await store.renameFinishTemplate(id, parsed.data.name, {
      scope: principal,
      expectedVersion,
    })
    return sceneApiJson(request, toPublicFinishTemplateRecord(record, principal), {
      headers: { ETag: `"${record.version}"` },
    })
  } catch (error) {
    return handleFinishTemplateStoreError(request, error)
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard
  const resolution = await resolveFinishTemplatePrincipal(request)
  if (!('principal' in resolution)) return principalResponse(request, resolution)!
  const principal = resolution.principal
  const expectedVersion = parseIfMatch(request.headers.get('If-Match'))
  if (expectedVersion === undefined) {
    return sceneApiJson(request, { error: 'precondition_required' }, { status: 428 })
  }

  const { id } = await params
  try {
    const store = await getSceneStore()
    const removed = await store.deleteFinishTemplate(id, {
      scope: principal,
      expectedVersion,
    })
    if (!removed) return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
    return withSceneApiHeaders(request, new Response(null, { status: 204 }))
  } catch (error) {
    return handleFinishTemplateStoreError(request, error)
  }
}

function parseIfMatch(raw: string | null): number | undefined {
  if (!raw) return undefined
  const trimmed = raw.trim()
  if (trimmed === '*') return undefined
  const match = trimmed.match(/^(?:W\/)?"([^"]+)"$/)
  const inner = match ? match[1] : trimmed
  if (!inner) return undefined
  const value = Number(inner)
  return Number.isInteger(value) && value > 0 ? value : undefined
}

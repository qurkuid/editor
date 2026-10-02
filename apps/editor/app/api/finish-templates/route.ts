import type { NextRequest } from 'next/server'
import { z } from 'zod'
import {
  FinishTemplateCreateRequestSchema,
  FinishTemplateKindSchema,
} from '@/lib/finish-template-schema'
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
} from '@/lib/scene-api-security'
import { getSceneStore } from '@/lib/scene-store-server'

export const dynamic = 'force-dynamic'

const MAX_FINISH_TEMPLATE_REQUEST_BYTES = 2 * 1024 * 1024
const listQuerySchema = z
  .object({
    kind: FinishTemplateKindSchema.optional(),
    limit: z.coerce.number().int().positive().max(500).optional(),
    scope: z.enum(['mine', 'company']).optional(),
  })
  .strict()

export function OPTIONS(request: NextRequest) {
  return sceneApiPreflight(request)
}

export async function GET(request: NextRequest) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard

  const query = Object.fromEntries(request.nextUrl.searchParams.entries())
  const parsedQuery = listQuerySchema.safeParse(query)
  if (!parsedQuery.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsedQuery.error.issues },
      { status: 400 },
    )
  }

  const resolution = await resolveFinishTemplatePrincipal(request)
  if (!('principal' in resolution)) return principalResponse(request, resolution)!
  const principal = resolution.principal
  if (parsedQuery.data.scope === 'company' && !principal.companyId && !principal.local) {
    return sceneApiJson(request, { error: 'company_required' }, { status: 403 })
  }

  try {
    const store = await getSceneStore()
    const records = await store.listFinishTemplates(principal, {
      kind: parsedQuery.data.kind,
      limit: parsedQuery.data.limit,
      scope: parsedQuery.data.scope,
    })
    return sceneApiJson(request, {
      templates: records.map((record) => toPublicFinishTemplateRecord(record, principal)),
    })
  } catch (error) {
    return handleFinishTemplateStoreError(request, error)
  }
}

export async function POST(request: NextRequest) {
  const guard = guardSceneApiRequest(request, { skipAuth: true })
  if (guard) return guard

  let body: unknown
  try {
    body = await readSceneApiJson(request, {
      maxCompressedBytes: MAX_FINISH_TEMPLATE_REQUEST_BYTES,
      maxExpandedBytes: MAX_FINISH_TEMPLATE_REQUEST_BYTES,
    })
  } catch (error) {
    return bodyLimitResponse(request, error)
  }

  const parsed = FinishTemplateCreateRequestSchema.safeParse(body)
  if (!parsed.success) {
    return sceneApiJson(
      request,
      { error: 'invalid_request', details: parsed.error.issues },
      { status: 400 },
    )
  }

  const resolution = await resolveFinishTemplatePrincipal(request)
  if (!('principal' in resolution)) return principalResponse(request, resolution)!
  const principal = resolution.principal
  if (parsed.data.visibility === 'company' && !principal.companyId && !principal.local) {
    return sceneApiJson(request, { error: 'company_required' }, { status: 403 })
  }

  const visibility = principal.local ? 'local' : parsed.data.visibility
  const template = parsed.data.template
  try {
    const store = await getSceneStore()
    const existing = await store.getFinishTemplate(template.id, principal)
    const wasExisting = existing?.ownerId === principal.ownerId
    const record = await store.createFinishTemplate({
      id: template.id,
      kind: parsed.data.kind,
      name: template.name,
      visibility,
      ownerId: principal.ownerId,
      companyId: visibility === 'company' ? principal.companyId : null,
      payload: template,
    })
    return sceneApiJson(request, toPublicFinishTemplateRecord(record, principal), {
      status: wasExisting ? 200 : 201,
      headers: { Location: `/api/finish-templates/${encodeURIComponent(record.id)}` },
    })
  } catch (error) {
    return handleFinishTemplateStoreError(request, error)
  }
}

import {
  FinishTemplateConflictError,
  FinishTemplateForbiddenError,
  type FinishTemplateScope,
  SceneNotFoundError,
  SceneTooLargeError,
  SceneVersionConflictError,
  type FinishTemplateRecord as StoredFinishTemplateRecord,
} from '@pascal-app/mcp/storage'
import type { NextRequest, NextResponse } from 'next/server'
import { type FinishTemplateRecord, FinishTemplateRecordSchema } from './finish-template-schema'
import { fetchIntmUser, intmAuthEnabled } from './intm-session'
import { isLoopbackSceneRequest, sceneApiJson } from './scene-api-security'

export type FinishTemplatePrincipalResolution =
  | { principal: FinishTemplateScope }
  | { error: 'unauthorized' | 'unavailable' }

export async function resolveFinishTemplatePrincipal(
  request: NextRequest,
): Promise<FinishTemplatePrincipalResolution> {
  if (!intmAuthEnabled()) {
    if (process.env.NODE_ENV !== 'production' && isLoopbackSceneRequest(request)) {
      return { principal: { ownerId: 'local', companyId: null, local: true } }
    }
    return { error: 'unavailable' }
  }

  const cookie = request.headers.get('cookie')
  if (!cookie?.split(';').some((part) => part.trim().startsWith('session_token='))) {
    return { error: 'unauthorized' }
  }
  const user = await fetchIntmUser(cookie)
  if (!user || typeof user.id !== 'string') return { error: 'unauthorized' }
  const ownerId = user.id.trim()
  if (!ownerId) return { error: 'unauthorized' }
  if (
    user.companyId !== undefined &&
    user.companyId !== null &&
    typeof user.companyId !== 'string'
  ) {
    return { error: 'unauthorized' }
  }
  return {
    principal: {
      ownerId,
      companyId: user.companyId?.trim() || null,
      local: false,
    },
  }
}

export function principalResponse(
  request: NextRequest,
  resolution: FinishTemplatePrincipalResolution,
): NextResponse | null {
  if ('principal' in resolution) return null
  return sceneApiJson(
    request,
    { error: resolution.error },
    { status: resolution.error === 'unauthorized' ? 401 : 503 },
  )
}

export function toPublicFinishTemplateRecord(
  record: StoredFinishTemplateRecord,
  principal: FinishTemplateScope,
): FinishTemplateRecord {
  const checked = FinishTemplateRecordSchema.parse({
    id: record.id,
    kind: record.kind,
    name: record.name,
    visibility: record.visibility,
    editable: record.ownerId === principal.ownerId,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    template: record.payload,
  })
  return checked as FinishTemplateRecord
}

export function handleFinishTemplateStoreError(request: NextRequest, error: unknown): NextResponse {
  if (error instanceof FinishTemplateConflictError) {
    return sceneApiJson(request, { error: 'conflict' }, { status: 409 })
  }
  if (error instanceof FinishTemplateForbiddenError) {
    return sceneApiJson(request, { error: 'forbidden' }, { status: 403 })
  }
  if (error instanceof SceneNotFoundError) {
    return sceneApiJson(request, { error: 'not_found' }, { status: 404 })
  }
  if (error instanceof SceneTooLargeError) {
    return sceneApiJson(request, { error: 'too_large' }, { status: 413 })
  }
  if (error instanceof SceneVersionConflictError) {
    const currentVersion = (error as SceneVersionConflictError & { currentVersion?: unknown })
      .currentVersion
    return sceneApiJson(
      request,
      {
        error: 'conflict',
        ...(typeof currentVersion === 'number' ? { currentVersion } : {}),
      },
      { status: 409 },
    )
  }
  const code = (error as { code?: string })?.code
  if (code === 'invalid') return sceneApiJson(request, { error: 'invalid' }, { status: 400 })
  return sceneApiJson(request, { error: 'internal_error' }, { status: 500 })
}

export function bodyLimitResponse(request: NextRequest, error: unknown): NextResponse {
  if (
    error instanceof RangeError ||
    (error as { code?: string })?.code === 'ERR_BUFFER_TOO_LARGE'
  ) {
    return sceneApiJson(request, { error: 'too_large' }, { status: 413 })
  }
  return sceneApiJson(request, { error: 'invalid_request' }, { status: 400 })
}

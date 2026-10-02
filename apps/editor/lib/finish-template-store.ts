'use client'

import type { HomeFinishTemplate, ZoneFinishTemplateSnapshot } from '@pascal-app/editor'
import type { z } from 'zod'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  FinishTemplateListResponseSchema,
  type FinishTemplateRecord,
  FinishTemplateRecordSchema,
  type FinishTemplateVisibilitySchema,
  HomeFinishTemplateSchema,
  isHomeFinishTemplate,
  isZoneFinishTemplateSnapshot,
  parseHomeFinishTemplate,
  parseZoneFinishTemplateSnapshot,
  ZoneFinishTemplateSchema,
} from './finish-template-schema'

export {
  HomeFinishTemplateSchema,
  isHomeFinishTemplate,
  isZoneFinishTemplateSnapshot,
  parseHomeFinishTemplate,
  parseZoneFinishTemplateSnapshot,
  ZoneFinishTemplateSchema,
}

export type FinishTemplateVisibility = z.infer<typeof FinishTemplateVisibilitySchema>
export type FinishTemplateStatus = 'server' | 'pending-local-import' | 'saving' | 'failed'

export type FinishTemplateMeta = {
  kind: 'zone' | 'home'
  source: 'server' | 'local'
  status: FinishTemplateStatus
  visibility: FinishTemplateVisibility | 'local'
  editable: boolean
  serverId?: string
  imported?: boolean
  error?: string
  updatedAt?: string
}

export type FinishTemplateOperationResult =
  | { ok: true; record?: FinishTemplateRecord; imported?: number; failed?: number; stale?: boolean }
  | { ok: false; error: string; imported?: number; failed?: number }

class FinishTemplateRequestError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'FinishTemplateRequestError'
    this.status = status
  }
}

type PersistedFinishTemplateState = {
  zoneTemplates?: Record<string, unknown>
  homeTemplates?: Record<string, unknown>
  localZoneTemplates?: Record<string, unknown>
  localHomeTemplates?: Record<string, unknown>
  confirmedZoneTemplateIds?: unknown
  confirmedHomeTemplateIds?: unknown
}

type FinishTemplateState = {
  /** Visible templates. Server records overlay the local cache by confirmed id. */
  zoneTemplates: Record<string, ZoneFinishTemplateSnapshot>
  homeTemplates: Record<string, HomeFinishTemplate>
  /** The v1 local cache. It is intentionally kept after a successful import. */
  localZoneTemplates: Record<string, ZoneFinishTemplateSnapshot>
  localHomeTemplates: Record<string, HomeFinishTemplate>
  /** IDs whose local copy was previously confirmed by the server. */
  confirmedZoneTemplateIds: Record<string, true>
  confirmedHomeTemplateIds: Record<string, true>
  templateMeta: Record<string, FinishTemplateMeta>
  hydrated: boolean
  serverLoaded: boolean
  serverError: string | null
  serverErrorStatus: number | null
  addZoneTemplate: (template: ZoneFinishTemplateSnapshot) => boolean
  removeZoneTemplate: (id: string) => void
  renameZoneTemplate: (id: string, name: string) => boolean
  addHomeTemplate: (template: HomeFinishTemplate) => boolean
  removeHomeTemplate: (id: string) => void
  renameHomeTemplate: (id: string, name: string) => boolean
  saveZoneTemplate: (
    template: ZoneFinishTemplateSnapshot,
    visibility?: FinishTemplateVisibility,
  ) => Promise<FinishTemplateOperationResult>
  saveHomeTemplate: (
    template: HomeFinishTemplate,
    visibility?: FinishTemplateVisibility,
  ) => Promise<FinishTemplateOperationResult>
  loadTemplates: () => Promise<FinishTemplateOperationResult>
  refreshTemplates: () => Promise<FinishTemplateOperationResult>
  importLegacyTemplates: (
    visibility?: FinishTemplateVisibility,
  ) => Promise<FinishTemplateOperationResult>
  retryTemplate: (kind: 'zone' | 'home', id: string) => Promise<FinishTemplateOperationResult>
  markHydrated: () => void
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function validName(name: string): string | null {
  const trimmed = name.trim()
  return trimmed.length > 0 ? trimmed : null
}

function templateKey(kind: 'zone' | 'home', id: string): string {
  return `${kind}:${id}`
}

function operationError(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return '서버 템플릿 요청에 실패했습니다.'
}

function persistedPayload(value: unknown): PersistedFinishTemplateState {
  if (!value || typeof value !== 'object') return {}
  const record = value as Record<string, unknown>
  if (record.state && typeof record.state === 'object') {
    return record.state as PersistedFinishTemplateState
  }
  return record as PersistedFinishTemplateState
}

function parsePersistedZoneTemplates(values: unknown): Record<string, ZoneFinishTemplateSnapshot> {
  if (!values || typeof values !== 'object') return {}
  return Object.fromEntries(
    Object.entries(values).flatMap(([id, value]) => {
      const parsed = parseZoneFinishTemplateSnapshot(value)
      return parsed && parsed.id === id ? [[id, parsed]] : []
    }),
  )
}

function parsePersistedHomeTemplates(values: unknown): Record<string, HomeFinishTemplate> {
  if (!values || typeof values !== 'object') return {}
  return Object.fromEntries(
    Object.entries(values).flatMap(([id, value]) => {
      const parsed = parseHomeFinishTemplate(value)
      return parsed && parsed.id === id ? [[id, parsed]] : []
    }),
  )
}

function parsePersistedIds(value: unknown): Record<string, true> {
  const ids = Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string')
    : value && typeof value === 'object'
      ? Object.keys(value)
      : []
  return Object.fromEntries(ids.filter((id) => id.length > 0).map((id) => [id, true]))
}

type PersistableFinishTemplateState = Pick<
  FinishTemplateState,
  | 'localZoneTemplates'
  | 'localHomeTemplates'
  | 'confirmedZoneTemplateIds'
  | 'confirmedHomeTemplateIds'
>

export function persistedFinishTemplatePayload(
  state: PersistableFinishTemplateState,
): PersistedFinishTemplateState {
  return {
    // Keep the v1 payload shape so an explicit import never deletes or
    // rewrites the user's local source copy into the server cache.
    zoneTemplates: state.localZoneTemplates,
    homeTemplates: state.localHomeTemplates,
    confirmedZoneTemplateIds: Object.keys(state.confirmedZoneTemplateIds),
    confirmedHomeTemplateIds: Object.keys(state.confirmedHomeTemplateIds),
  }
}

export function mergePersistedFinishTemplates(
  persistedState: unknown,
  currentState: FinishTemplateState,
): FinishTemplateState {
  const persisted = persistedPayload(persistedState)
  const localZoneTemplates = parsePersistedZoneTemplates(
    persisted.localZoneTemplates ?? persisted.zoneTemplates,
  )
  const localHomeTemplates = parsePersistedHomeTemplates(
    persisted.localHomeTemplates ?? persisted.homeTemplates,
  )
  const confirmedZoneTemplateIds = parsePersistedIds(persisted.confirmedZoneTemplateIds)
  const confirmedHomeTemplateIds = parsePersistedIds(persisted.confirmedHomeTemplateIds)
  const zoneTemplates = Object.fromEntries(
    Object.entries(localZoneTemplates).filter(([id]) => !confirmedZoneTemplateIds[id]),
  )
  const homeTemplates = Object.fromEntries(
    Object.entries(localHomeTemplates).filter(([id]) => !confirmedHomeTemplateIds[id]),
  )
  return {
    ...currentState,
    localZoneTemplates,
    localHomeTemplates,
    confirmedZoneTemplateIds,
    confirmedHomeTemplateIds,
    zoneTemplates,
    homeTemplates,
  }
}

async function requestJson(input: RequestInfo | URL, init?: RequestInit): Promise<unknown> {
  const response = await fetch(input, { cache: 'no-store', ...init })
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  if (!response.ok) {
    const code = body && typeof body === 'object' && 'error' in body ? String(body.error) : ''
    throw new FinishTemplateRequestError(
      response.status,
      code ? `서버 템플릿 요청 실패: ${code}` : `서버 템플릿 요청 실패 (${response.status})`,
    )
  }
  return body
}

async function fetchTemplateList(): Promise<FinishTemplateRecord[]> {
  const body = await requestJson('/api/finish-templates?limit=500')
  return FinishTemplateListResponseSchema.parse(body).templates as FinishTemplateRecord[]
}

async function postTemplate(
  kind: 'zone' | 'home',
  visibility: FinishTemplateVisibility,
  template: ZoneFinishTemplateSnapshot | HomeFinishTemplate,
): Promise<FinishTemplateRecord> {
  const body = await requestJson('/api/finish-templates', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, visibility, template }),
  })
  const parsed = FinishTemplateRecordSchema.parse(body) as FinishTemplateRecord
  if (parsed.kind !== kind || parsed.id !== template.id) {
    throw new Error('서버가 다른 템플릿을 반환했습니다.')
  }
  return parsed
}

function recordMeta(record: FinishTemplateRecord, imported = false): FinishTemplateMeta {
  return {
    kind: record.kind,
    source: imported ? 'local' : 'server',
    status: 'server',
    visibility: record.visibility,
    editable: record.editable,
    serverId: record.id,
    imported: imported || undefined,
    updatedAt: record.updatedAt,
  }
}

const useFinishTemplates = create<FinishTemplateState>()(
  persist(
    (set, get) => {
      let loadGeneration = 0

      const setLocalMeta = (
        kind: 'zone' | 'home',
        id: string,
        meta: Partial<FinishTemplateMeta> & Pick<FinishTemplateMeta, 'status' | 'source'>,
      ) => {
        set((state) => ({
          templateMeta: {
            ...state.templateMeta,
            [templateKey(kind, id)]: {
              kind,
              visibility: 'private',
              editable: true,
              ...state.templateMeta[templateKey(kind, id)],
              ...meta,
            },
          },
        }))
      }

      const putLocalZone = (
        template: ZoneFinishTemplateSnapshot,
        meta: Pick<FinishTemplateMeta, 'status' | 'source'> &
          Partial<Pick<FinishTemplateMeta, 'visibility' | 'imported' | 'error'>>,
      ) => {
        const value = clone(template)
        set((state) => {
          const confirmedZoneTemplateIds = { ...state.confirmedZoneTemplateIds }
          delete confirmedZoneTemplateIds[value.id]
          return {
            zoneTemplates: { ...state.zoneTemplates, [value.id]: value },
            localZoneTemplates: { ...state.localZoneTemplates, [value.id]: clone(value) },
            confirmedZoneTemplateIds,
            templateMeta: {
              ...state.templateMeta,
              [templateKey('zone', value.id)]: {
                kind: 'zone',
                source: meta.source,
                status: meta.status,
                visibility: meta.visibility ?? 'private',
                editable: true,
                imported: meta.imported,
                error: meta.error,
              },
            },
          }
        })
      }

      const putLocalHome = (
        template: HomeFinishTemplate,
        meta: Pick<FinishTemplateMeta, 'status' | 'source'> &
          Partial<Pick<FinishTemplateMeta, 'visibility' | 'imported' | 'error'>>,
      ) => {
        const value = clone(template)
        set((state) => {
          const confirmedHomeTemplateIds = { ...state.confirmedHomeTemplateIds }
          delete confirmedHomeTemplateIds[value.id]
          return {
            homeTemplates: { ...state.homeTemplates, [value.id]: value },
            localHomeTemplates: { ...state.localHomeTemplates, [value.id]: clone(value) },
            confirmedHomeTemplateIds,
            templateMeta: {
              ...state.templateMeta,
              [templateKey('home', value.id)]: {
                kind: 'home',
                source: meta.source,
                status: meta.status,
                visibility: meta.visibility ?? 'private',
                editable: true,
                imported: meta.imported,
                error: meta.error,
              },
            },
          }
        })
      }

      const saveTemplate = async (
        kind: 'zone' | 'home',
        template: ZoneFinishTemplateSnapshot | HomeFinishTemplate,
        visibility: FinishTemplateVisibility,
        imported = false,
      ): Promise<FinishTemplateOperationResult> => {
        const parsed =
          kind === 'zone'
            ? parseZoneFinishTemplateSnapshot(template)
            : parseHomeFinishTemplate(template)
        if (!parsed) return { ok: false, error: '템플릿 형식이 올바르지 않습니다.' }

        if (kind === 'zone') {
          putLocalZone(parsed as ZoneFinishTemplateSnapshot, {
            source: 'local',
            status: 'pending-local-import',
            visibility,
            imported,
          })
        } else {
          putLocalHome(parsed as HomeFinishTemplate, {
            source: 'local',
            status: 'pending-local-import',
            visibility,
            imported,
          })
        }
        setLocalMeta(kind, parsed.id, {
          source: 'local',
          status: 'saving',
          visibility,
          imported,
          error: undefined,
        })

        try {
          const record = await postTemplate(kind, visibility, parsed)
          set((state) => {
            const key = templateKey(kind, record.id)
            const templateMeta = {
              ...state.templateMeta,
              [key]: recordMeta(record, imported),
            }
            if (imported) {
              templateMeta[key] = {
                ...recordMeta(record, true),
                source: 'local',
                imported: true,
              }
            }
            if (kind === 'zone') {
              const confirmedZoneTemplateIds = {
                ...state.confirmedZoneTemplateIds,
                [record.id]: true as const,
              }
              return {
                zoneTemplates: {
                  ...state.zoneTemplates,
                  [record.id]: clone(record.template as ZoneFinishTemplateSnapshot),
                },
                confirmedZoneTemplateIds,
                templateMeta,
              }
            }
            const confirmedHomeTemplateIds = {
              ...state.confirmedHomeTemplateIds,
              [record.id]: true as const,
            }
            return {
              homeTemplates: {
                ...state.homeTemplates,
                [record.id]: clone(record.template as HomeFinishTemplate),
              },
              confirmedHomeTemplateIds,
              templateMeta,
            }
          })
          return { ok: true, record }
        } catch (error) {
          const message = operationError(error)
          setLocalMeta(kind, parsed.id, {
            source: 'local',
            status: 'failed',
            visibility,
            imported,
            error: message,
          })
          return { ok: false, error: message }
        }
      }

      const loadTemplates = async (): Promise<FinishTemplateOperationResult> => {
        const generation = ++loadGeneration
        if (!get().hydrated) {
          const persistApi = (
            useFinishTemplates as typeof useFinishTemplates & {
              persist?: { rehydrate?: () => Promise<void> }
            }
          ).persist
          if (typeof window !== 'undefined' && persistApi?.rehydrate) {
            await persistApi.rehydrate()
          }
          if (!get().hydrated) set({ hydrated: true })
        }
        try {
          const records = await fetchTemplateList()
          if (generation !== loadGeneration) {
            return { ok: true, imported: 0, failed: 0, stale: true }
          }
          set((state) => {
            const zoneTemplates: Record<string, ZoneFinishTemplateSnapshot> = {}
            const homeTemplates: Record<string, HomeFinishTemplate> = {}
            const templateMeta: Record<string, FinishTemplateMeta> = {}
            const confirmedZoneTemplateIds = { ...state.confirmedZoneTemplateIds }
            const confirmedHomeTemplateIds = { ...state.confirmedHomeTemplateIds }
            for (const [id, template] of Object.entries(state.localZoneTemplates)) {
              const previous = state.templateMeta[templateKey('zone', id)]
              if (!confirmedZoneTemplateIds[id]) zoneTemplates[id] = clone(template)
              templateMeta[templateKey('zone', id)] = {
                kind: 'zone',
                source: 'local',
                status: previous?.status === 'failed' ? 'failed' : 'pending-local-import',
                visibility: previous?.visibility === 'company' ? 'company' : 'private',
                editable: true,
                imported: previous?.imported || confirmedZoneTemplateIds[id] || undefined,
                error: previous?.status === 'failed' ? previous.error : undefined,
              }
            }
            for (const [id, template] of Object.entries(state.localHomeTemplates)) {
              const previous = state.templateMeta[templateKey('home', id)]
              if (!confirmedHomeTemplateIds[id]) homeTemplates[id] = clone(template)
              templateMeta[templateKey('home', id)] = {
                kind: 'home',
                source: 'local',
                status: previous?.status === 'failed' ? 'failed' : 'pending-local-import',
                visibility: previous?.visibility === 'company' ? 'company' : 'private',
                editable: true,
                imported: previous?.imported || confirmedHomeTemplateIds[id] || undefined,
                error: previous?.status === 'failed' ? previous.error : undefined,
              }
            }
            for (const record of records) {
              const key = templateKey(record.kind, record.id)
              const previous = state.templateMeta[key]
              if (record.kind === 'zone') {
                zoneTemplates[record.id] = clone(record.template)
                confirmedZoneTemplateIds[record.id] = true
              } else {
                homeTemplates[record.id] = clone(record.template)
                confirmedHomeTemplateIds[record.id] = true
              }
              templateMeta[key] = recordMeta(record, Boolean(previous?.imported))
              if (previous?.imported) {
                templateMeta[key] = { ...templateMeta[key], source: 'local', imported: true }
              }
            }
            return {
              zoneTemplates,
              homeTemplates,
              confirmedZoneTemplateIds,
              confirmedHomeTemplateIds,
              templateMeta,
              hydrated: true,
              serverLoaded: true,
              serverError: null,
              serverErrorStatus: null,
            }
          })
          return { ok: true, imported: 0, failed: 0 }
        } catch (error) {
          if (generation !== loadGeneration) {
            return { ok: true, imported: 0, failed: 0, stale: true }
          }
          const message = operationError(error)
          const status = error instanceof FinishTemplateRequestError ? error.status : null
          if (status === 401 || status === 403) {
            set((state) => {
              const zoneTemplates: Record<string, ZoneFinishTemplateSnapshot> = {}
              const homeTemplates: Record<string, HomeFinishTemplate> = {}
              const templateMeta: Record<string, FinishTemplateMeta> = {}
              for (const [id, template] of Object.entries(state.localZoneTemplates)) {
                if (state.confirmedZoneTemplateIds[id]) continue
                zoneTemplates[id] = clone(template)
                const previous = state.templateMeta[templateKey('zone', id)]
                templateMeta[templateKey('zone', id)] = {
                  kind: 'zone',
                  source: 'local',
                  status: previous?.status === 'failed' ? 'failed' : 'pending-local-import',
                  visibility: previous?.visibility === 'company' ? 'company' : 'private',
                  editable: true,
                  imported: previous?.imported,
                  error: previous?.status === 'failed' ? previous.error : undefined,
                }
              }
              for (const [id, template] of Object.entries(state.localHomeTemplates)) {
                if (state.confirmedHomeTemplateIds[id]) continue
                homeTemplates[id] = clone(template)
                const previous = state.templateMeta[templateKey('home', id)]
                templateMeta[templateKey('home', id)] = {
                  kind: 'home',
                  source: 'local',
                  status: previous?.status === 'failed' ? 'failed' : 'pending-local-import',
                  visibility: previous?.visibility === 'company' ? 'company' : 'private',
                  editable: true,
                  imported: previous?.imported,
                  error: previous?.status === 'failed' ? previous.error : undefined,
                }
              }
              return {
                zoneTemplates,
                homeTemplates,
                templateMeta,
                hydrated: true,
                serverLoaded: false,
                serverError: message,
                serverErrorStatus: status,
              }
            })
          } else {
            set({
              hydrated: true,
              serverLoaded: false,
              serverError: message,
              serverErrorStatus: status,
            })
          }
          return { ok: false, error: message }
        }
      }

      const importLegacyTemplates = async (
        visibility: FinishTemplateVisibility = 'private',
      ): Promise<FinishTemplateOperationResult> => {
        const state = get()
        if (!state.hydrated || !state.serverLoaded) {
          return { ok: false, error: '서버 템플릿을 먼저 새로고침하세요.', imported: 0, failed: 0 }
        }
        let imported = 0
        let failed = 0
        for (const template of Object.values(state.localZoneTemplates)) {
          if (state.confirmedZoneTemplateIds[template.id]) continue
          const meta = get().templateMeta[templateKey('zone', template.id)]
          if (meta?.serverId || (meta?.status === 'server' && meta.source === 'local')) continue
          const result = await saveTemplate('zone', template, visibility, true)
          if (result.ok) imported += 1
          else failed += 1
        }
        for (const template of Object.values(state.localHomeTemplates)) {
          if (state.confirmedHomeTemplateIds[template.id]) continue
          const meta = get().templateMeta[templateKey('home', template.id)]
          if (meta?.serverId || (meta?.status === 'server' && meta.source === 'local')) continue
          const result = await saveTemplate('home', template, visibility, true)
          if (result.ok) imported += 1
          else failed += 1
        }
        return failed > 0
          ? { ok: false, error: '일부 로컬 템플릿을 가져오지 못했습니다.', imported, failed }
          : { ok: true, imported, failed }
      }

      const retryTemplate = async (
        kind: 'zone' | 'home',
        id: string,
      ): Promise<FinishTemplateOperationResult> => {
        const state = get()
        const meta = state.templateMeta[templateKey(kind, id)]
        const visibility = meta?.visibility === 'company' ? 'company' : 'private'
        if (kind === 'zone') {
          const template = state.localZoneTemplates[id]
          return template
            ? saveTemplate('zone', template, visibility, Boolean(meta?.imported))
            : { ok: false, error: '재시도할 로컬 Zone 템플릿이 없습니다.' }
        }
        const template = state.localHomeTemplates[id]
        return template
          ? saveTemplate('home', template, visibility, Boolean(meta?.imported))
          : { ok: false, error: '재시도할 로컬 집 템플릿이 없습니다.' }
      }

      return {
        zoneTemplates: {},
        homeTemplates: {},
        localZoneTemplates: {},
        localHomeTemplates: {},
        confirmedZoneTemplateIds: {},
        confirmedHomeTemplateIds: {},
        templateMeta: {},
        hydrated: false,
        serverLoaded: false,
        serverError: null,
        serverErrorStatus: null,
        addZoneTemplate: (template) => {
          const parsed = parseZoneFinishTemplateSnapshot(template)
          if (!parsed) return false
          putLocalZone(parsed, { source: 'local', status: 'pending-local-import' })
          return true
        },
        removeZoneTemplate: (id) =>
          set((state) => {
            if (!state.zoneTemplates[id] && !state.localZoneTemplates[id]) return state
            const zoneTemplates = { ...state.zoneTemplates }
            const localZoneTemplates = { ...state.localZoneTemplates }
            delete zoneTemplates[id]
            delete localZoneTemplates[id]
            const confirmedZoneTemplateIds = { ...state.confirmedZoneTemplateIds }
            delete confirmedZoneTemplateIds[id]
            const templateMeta = { ...state.templateMeta }
            delete templateMeta[templateKey('zone', id)]
            return { zoneTemplates, localZoneTemplates, confirmedZoneTemplateIds, templateMeta }
          }),
        renameZoneTemplate: (id, name) => {
          const nextName = validName(name)
          if (!nextName) return false
          const current = get().zoneTemplates[id]
          if (!current) return false
          set((state) => ({
            zoneTemplates: { ...state.zoneTemplates, [id]: { ...current, name: nextName } },
            ...(state.localZoneTemplates[id]
              ? {
                  localZoneTemplates: {
                    ...state.localZoneTemplates,
                    [id]: { ...state.localZoneTemplates[id], name: nextName },
                  },
                }
              : {}),
          }))
          return true
        },
        addHomeTemplate: (template) => {
          const parsed = parseHomeFinishTemplate(template)
          if (!parsed) return false
          putLocalHome(parsed, { source: 'local', status: 'pending-local-import' })
          return true
        },
        removeHomeTemplate: (id) =>
          set((state) => {
            if (!state.homeTemplates[id] && !state.localHomeTemplates[id]) return state
            const homeTemplates = { ...state.homeTemplates }
            const localHomeTemplates = { ...state.localHomeTemplates }
            delete homeTemplates[id]
            delete localHomeTemplates[id]
            const confirmedHomeTemplateIds = { ...state.confirmedHomeTemplateIds }
            delete confirmedHomeTemplateIds[id]
            const templateMeta = { ...state.templateMeta }
            delete templateMeta[templateKey('home', id)]
            return { homeTemplates, localHomeTemplates, confirmedHomeTemplateIds, templateMeta }
          }),
        renameHomeTemplate: (id, name) => {
          const nextName = validName(name)
          if (!nextName) return false
          const current = get().homeTemplates[id]
          if (!current) return false
          set((state) => ({
            homeTemplates: { ...state.homeTemplates, [id]: { ...current, name: nextName } },
            ...(state.localHomeTemplates[id]
              ? {
                  localHomeTemplates: {
                    ...state.localHomeTemplates,
                    [id]: { ...state.localHomeTemplates[id], name: nextName },
                  },
                }
              : {}),
          }))
          return true
        },
        saveZoneTemplate: (template, visibility = 'private') =>
          saveTemplate('zone', template, visibility),
        saveHomeTemplate: (template, visibility = 'private') =>
          saveTemplate('home', template, visibility),
        loadTemplates,
        refreshTemplates: loadTemplates,
        importLegacyTemplates,
        retryTemplate,
        markHydrated: () => set({ hydrated: true }),
      }
    },
    {
      name: 'pascal-finish-templates-v1',
      merge: mergePersistedFinishTemplates,
      partialize: persistedFinishTemplatePayload,
      onRehydrateStorage: () => (state) => {
        state?.markHydrated()
      },
    },
  ),
)

export default useFinishTemplates
export type { FinishTemplateState }
export { useFinishTemplates }

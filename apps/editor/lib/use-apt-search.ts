'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type AptComplex,
  type AptDatasetPayload,
  groupComplexes,
  normalizeSearch,
  parseAptDataset,
} from './apt-format'
import { withBasePath } from './base-path'

/**
 * Shared data layer of the apartment search — used by both the standalone
 * `/apt` page and the editor's 아파트 sidebar panel. The flow it models is
 * exactly: search → pick a complex → read its info → pick a floor plan.
 */

export type { AptComplex } from './apt-format'

export type AptPlan = { type: string; planId: string; planPic: string; name: string }

export type AptInteriorInfo = {
  sourceName?: string
  approvalDate?: string
  ageYears?: number | null
  heating?: string
  corridor?: string
  buildings?: number | null
  households?: number | null
  builder?: string
  managementPhone?: string
  scopeWarning?: string
}

export type AptSceneItem = { id: string; name: string; updatedAt: string; nodeCount: number }

export type AptPlansState =
  | { status: 'loading' }
  | { status: 'full'; plans: AptPlan[] }
  | { status: 'fallback' }
export type AptInteriorState =
  | { status: 'loading' }
  | { status: 'ok'; info: AptInteriorInfo }
  | { status: 'empty' }

// The ~6MB dataset is fetched once per browser session, shared by every
// consumer (page or panel). Failures clear the cache so a retry can work.
let complexesPromise: Promise<AptComplex[]> | null = null

function loadComplexes(): Promise<AptComplex[]> {
  if (!complexesPromise) {
    complexesPromise = fetch(withBasePath('/api/apartments/dataset'))
      .then((res) => {
        if (!res.ok) throw new Error(`dataset ${res.status}`)
        return res.json() as Promise<AptDatasetPayload>
      })
      .then((payload) => groupComplexes(parseAptDataset(payload)))
    complexesPromise.catch(() => {
      complexesPromise = null
    })
  }
  return complexesPromise
}

export function useAptSearch(options: { resultLimit?: number } = {}) {
  const resultLimit = options.resultLimit ?? 100
  const [complexes, setComplexes] = useState<AptComplex[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [selected, setSelected] = useState<AptComplex | null>(null)
  const [plansState, setPlansState] = useState<AptPlansState>({ status: 'loading' })
  const [interiorState, setInteriorState] = useState<AptInteriorState>({ status: 'loading' })
  const [teamScenes, setTeamScenes] = useState<AptSceneItem[]>([])
  const selectedIdRef = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadComplexes()
      .then((list) => {
        if (!cancelled) setComplexes(list)
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const results = useMemo(() => {
    if (!complexes) return []
    const kw = normalizeSearch(keyword)
    if (!kw) return []
    return complexes.filter((c) => c.searchText.includes(kw)).slice(0, resultLimit)
  }, [complexes, keyword, resultLimit])

  const select = useCallback((complex: AptComplex) => {
    selectedIdRef.current = complex.apartmentId
    setSelected(complex)
    setPlansState({ status: 'loading' })
    setInteriorState({ status: 'loading' })
    setTeamScenes([])

    const id = encodeURIComponent(complex.apartmentId)

    fetch(withBasePath(`/api/apartments/${id}/plans`))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { code?: string; data?: AptPlan[] }) => {
        if (selectedIdRef.current !== complex.apartmentId) return
        if (json.code === 'OK' && Array.isArray(json.data) && json.data.length) {
          setPlansState({ status: 'full', plans: json.data })
        } else {
          setPlansState({ status: 'fallback' })
        }
      })
      .catch(() => {
        if (selectedIdRef.current === complex.apartmentId) setPlansState({ status: 'fallback' })
      })

    fetch(withBasePath(`/api/apartments/${id}/interior-info`))
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { code?: string; data?: AptInteriorInfo }) => {
        if (selectedIdRef.current !== complex.apartmentId) return
        if (json.code === 'OK' && json.data) setInteriorState({ status: 'ok', info: json.data })
        else setInteriorState({ status: 'empty' })
      })
      .catch(() => {
        if (selectedIdRef.current === complex.apartmentId) setInteriorState({ status: 'empty' })
      })

    // Scenes already traced for this complex — team-shared store, so this is
    // the team's work. Anonymous visitors get a 401 and see no list.
    fetch(
      withBasePath(
        `/api/scenes?projectId=${encodeURIComponent(`apt-${complex.apartmentId}`)}&limit=50`,
      ),
    )
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((json: { scenes?: AptSceneItem[] } | AptSceneItem[]) => {
        if (selectedIdRef.current !== complex.apartmentId) return
        const scenes = Array.isArray(json) ? json : (json.scenes ?? [])
        setTeamScenes(
          [...scenes].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          ),
        )
      })
      .catch(() => {})
  }, [])

  const clearSelection = useCallback(() => {
    selectedIdRef.current = null
    setSelected(null)
  }, [])

  /** Resolve a `?apartmentId=` deep link once the dataset is in. */
  const findById = useCallback(
    (apartmentId: string) => complexes?.find((c) => c.apartmentId === apartmentId) ?? null,
    [complexes],
  )

  return {
    ready: complexes !== null,
    total: complexes?.length ?? 0,
    loadFailed,
    keyword,
    setKeyword,
    results,
    selected,
    select,
    clearSelection,
    findById,
    plansState,
    interiorState,
    teamScenes,
  }
}

export function formatSceneDate(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
}

/** The plans to show for a complex: full index if it answered, else the representative one. */
export function plansToShow(complex: AptComplex, state: AptPlansState): AptPlan[] {
  if (state.status === 'full') return state.plans
  if (state.status === 'fallback' && complex.planId && complex.planPic) {
    return [
      {
        type: complex.type,
        planId: complex.planId,
        planPic: complex.planPic,
        name: complex.planName,
      },
    ]
  }
  return []
}

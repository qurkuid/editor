'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { typeWithPyeong } from '@/lib/apt-format'
import { withBasePath } from '@/lib/base-path'

const ID_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

/**
 * Creates a scene whose graph holds one guide (reference-image) node pointing
 * at the selected apartment plan, then drops the user into the editor to
 * trace over it. The scene is tied back to the complex two ways: the
 * `apt-<apartmentId>` projectId convention, and `{apartmentId, planId}` in
 * the guide node's metadata (which also survives scene export).
 */
export function AptTrace({
  apartmentId,
  planId,
  name,
  type,
}: {
  apartmentId: string
  planId: string
  name: string
  type: string
}) {
  const startedRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const createScene = useCallback(async () => {
    setError(null)
    // The editor only understands nodes inside the site → building → level
    // hierarchy; a bare root guide is dropped on load (and the next autosave
    // then persists the loss). Guides specifically hang off a level — see
    // `createLocalGuideImage` in @pascal-app/editor.
    const siteId = `site_${randomId(16)}`
    const buildingId = `building_${randomId(16)}`
    const levelId = `level_${randomId(16)}`
    const guideId = `guide_${randomId(16)}`
    const imageUrl = withBasePath(
      `/api/apartments/${encodeURIComponent(apartmentId)}/plans/${encodeURIComponent(planId)}/image`,
    )
    const sceneName = [name, type].filter(Boolean).join(' ') || '아파트 평면도'
    const base = { object: 'node', visible: true, metadata: {} }
    const graph = {
      nodes: {
        [siteId]: { ...base, id: siteId, type: 'site', parentId: null, children: [buildingId] },
        [buildingId]: {
          ...base,
          id: buildingId,
          type: 'building',
          name: sceneName,
          parentId: siteId,
          children: [levelId],
          position: [0, 0, 0],
          rotation: [0, 0, 0],
        },
        [levelId]: {
          ...base,
          id: levelId,
          type: 'level',
          name: 'Ground Floor',
          parentId: buildingId,
          children: [guideId],
          level: 0,
          height: 2.5,
        },
        [guideId]: {
          ...base,
          id: guideId,
          type: 'guide',
          name: sceneName,
          parentId: levelId,
          metadata: { apartmentId, planId },
          url: imageUrl,
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: 1,
          opacity: 50,
          scaleReference: null,
          perspectiveCorners: null,
        },
      },
      rootNodeIds: [siteId],
    }

    try {
      const response = await fetch(withBasePath('/api/scenes'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: sceneName,
          projectId: `apt-${apartmentId}`,
          graph,
        }),
      })
      if (!response.ok) {
        setError(
          `씬 생성에 실패했습니다 (${response.status}). 로그인이 풀렸다면 다시 로그인해 주세요.`,
        )
        return
      }
      const meta = (await response.json()) as { id: string }
      // A HARD navigation, deliberately. Reaching the editor via a soft
      // router transition reproducibly raced its load/autosave cycle: an
      // autosave fired against the transient unloaded store and overwrote
      // the fresh scene with an empty graph (the 4-node bootstrap sits
      // below the server's ≥20-node wipe guard). A full page load never
      // exhibited the race.
      window.location.replace(withBasePath(`/scene/${meta.id}`))
    } catch (err) {
      setError(err instanceof Error ? err.message : '씬 생성에 실패했습니다.')
    }
  }, [apartmentId, planId, name, type])

  // The run-once guard matters: React StrictMode double-invokes effects in
  // dev, and without it every visit would create two scenes.
  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void createScene()
  }, [createScene])

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-8 text-center">
      {error ? (
        <>
          <p className="font-medium text-lg">{error}</p>
          <div className="flex gap-3">
            <button
              className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-sm"
              onClick={() => void createScene()}
              type="button"
            >
              다시 시도
            </button>
            <Link className="self-center text-sm underline" href="/apt">
              지도로 돌아가기
            </Link>
          </div>
        </>
      ) : (
        <>
          <p className="font-medium text-lg">도면 씬을 준비하는 중…</p>
          <p className="text-muted-foreground text-sm">
            {[name, typeWithPyeong(type)].filter(Boolean).join(' · ')}
          </p>
        </>
      )}
    </main>
  )
}

function randomId(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length]
  return out
}

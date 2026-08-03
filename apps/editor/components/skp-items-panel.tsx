'use client'

import type { AssetInput } from '@pascal-app/core'
import { CATALOG_ITEMS, ItemsPanel, useEditor } from '@pascal-app/editor'
import { Pencil } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

/**
 * SketchUp 컴포넌트 라이브러리를 얹은 아이템 패널.
 *
 * INTM 이 `/api/sketchup/pascal-catalog` 로 Pascal `AssetInput` 형태를 그대로 주므로
 * 그대로 `<ItemsPanel items>` 에 꽂는다. 카테고리 탭은 응답에 실제로 존재하는 카테고리로
 * 만들어 `functionTree` 에 넘긴다 — 하드코딩 5탭 대신 DB 가 탭을 정한다.
 *
 * 경로는 항상 루트 절대경로다. 운영에서는 intm.kr/floorplan 과 intm.kr/api 가 같은
 * 오리진이고, 로컬 dev 는 next.config 의 rewrite 가 INTM 으로 프록시한다 — 어느 쪽이든
 * 동일 오리진이라 INTM 세션 쿠키가 실려서 편집이 된다. `withBasePath()` 를 쓰면 안 된다.
 */

/** 내장 카탈로그(영문 카테고리)를 SketchUp 쪽 한글 카테고리에 합류시킨다. */
const BUILTIN_CATEGORY: Record<string, string> = {
  furniture: '가구',
  appliance: '가전',
  kitchen: '주방',
  bathroom: '욕실',
  outdoor: '기타',
}

const CATEGORY_ORDER = [
  '가구',
  '조명',
  '주방',
  '욕실',
  '수전·설비',
  '가전',
  '창호·도어',
  '하드웨어',
  '장식·소품',
  '마감·몰딩',
  '기타',
]

// UI 의 'floor' 는 DB 의 NULL(바닥 배치)을 뜻한다. 나머지는 asset.attachTo 와 같은 값.
const ATTACH_OPTIONS = [
  { value: 'floor', label: '바닥' },
  { value: 'wall', label: '벽' },
  { value: 'wall-side', label: '벽(측면)' },
  { value: 'ceiling', label: '천장' },
]

export function SkpItemsPanel() {
  const [remote, setRemote] = useState<AssetInput[]>([])
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState<AssetInput | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/sketchup/pascal-catalog', { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json()
      setRemote(data.items ?? [])
    } catch {
      // 카탈로그를 못 받아도 내장 아이템만으로 패널은 계속 동작한다.
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const items = useMemo<AssetInput[]>(
    () => [
      ...CATALOG_ITEMS.map((item) => ({
        ...item,
        category: BUILTIN_CATEGORY[item.category] ?? '기타',
      })),
      ...remote,
    ],
    [remote],
  )

  const functionTree = useMemo(() => {
    const present = new Set(items.map((item) => item.category))
    return CATEGORY_ORDER.filter((slug) => present.has(slug)).map((slug) => ({
      slug,
      name: slug,
      children: [],
    }))
  }, [items])

  const searchResults = useMemo(() => {
    // 이름 상당수가 macOS 파일명 유래라 한글이 NFD 로 저장돼 있었다. DB 는 NFC 로
    // 정규화했지만, 사용자가 NFD 문자열을 붙여넣는 경우가 있어 질의도 맞춰준다.
    const q = search.trim().normalize('NFC').toLowerCase()
    if (!q) return null
    return items.filter((item) => item.name.normalize('NFC').toLowerCase().includes(q))
  }, [items, search])

  // SketchUp 유래 아이템만 DB 에 있어 고칠 수 있다 (내장 카탈로그는 코드에 박혀 있다).
  const editableIds = useMemo(() => new Set(remote.map((item) => item.id)), [remote])
  const selectedItem = useEditor((state) => state.selectedItem)
  const editable = selectedItem && editableIds.has(selectedItem.id) ? selectedItem : null

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <ItemsPanel
          functionTree={functionTree}
          items={items}
          onSearchChange={setSearch}
          searchResults={searchResults}
        />
      </div>

      {/* 타일을 고르면(=배치 대기 상태가 되면) 그 아이템의 편집 줄이 뜬다.
          타일 자체는 패키지 소유라 건드리지 않는다. */}
      {editable && (
        <div className="flex shrink-0 items-center gap-2 border-border/70 border-t p-2">
          <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
            {editable.name}
          </span>
          <button
            className="flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs hover:bg-muted/70"
            onClick={() => setEditing(editable)}
            type="button"
          >
            <Pencil className="size-3" />
            편집
          </button>
        </div>
      )}

      {editing && (
        <EditDialog
          item={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </div>
  )
}

function EditDialog({
  item,
  onClose,
  onSaved,
}: {
  item: AssetInput
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(item.name)
  const [category, setCategory] = useState(item.category)
  const [attachTo, setAttachTo] = useState(item.attachTo ?? 'floor')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(patch: Record<string, unknown>) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/sketchup/components/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401) throw new Error('INTM 로그인이 필요합니다.')
      if (!(res.ok && data.success)) throw new Error(data.error || `실패 (${res.status})`)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : '수정 실패')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50 p-3"
      onClick={onClose}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      role="presentation"
    >
      <div
        className="w-full rounded-xl border border-border bg-background p-3 shadow-xl"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="mb-2 font-medium text-sm">아이템 편집</div>

        <label className="mb-1 block text-[11px] text-muted-foreground" htmlFor="skp-name">
          이름
        </label>
        <input
          className="mb-2 w-full rounded-md bg-muted px-2 py-1.5 text-xs focus:outline-none"
          id="skp-name"
          onChange={(e) => setName(e.target.value)}
          value={name}
        />

        <label className="mb-1 block text-[11px] text-muted-foreground" htmlFor="skp-category">
          카테고리
        </label>
        <select
          className="mb-2 w-full rounded-md bg-muted px-2 py-1.5 text-xs focus:outline-none"
          id="skp-category"
          onChange={(e) => setCategory(e.target.value)}
          value={category}
        >
          {CATEGORY_ORDER.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-[11px] text-muted-foreground" htmlFor="skp-attach">
          부착면
        </label>
        <select
          className="mb-3 w-full rounded-md bg-muted px-2 py-1.5 text-xs focus:outline-none"
          id="skp-attach"
          onChange={(e) => setAttachTo(e.target.value)}
          value={attachTo}
        >
          {ATTACH_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {error && <div className="mb-2 text-[11px] text-red-400">{error}</div>}

        <div className="flex gap-1.5">
          <button
            className="flex-1 rounded-md bg-primary px-2 py-1.5 font-medium text-primary-foreground text-xs disabled:opacity-50"
            disabled={busy}
            onClick={() =>
              send({
                name: name.trim(),
                category,
                attachTo: attachTo === 'floor' ? null : attachTo,
              })
            }
            type="button"
          >
            저장
          </button>
          <button
            className="rounded-md bg-destructive px-2 py-1.5 font-medium text-white text-xs disabled:opacity-50"
            disabled={busy}
            onClick={() => send({ isActive: false })}
            type="button"
          >
            숨기기
          </button>
          <button
            className="rounded-md bg-muted px-2 py-1.5 text-xs"
            onClick={onClose}
            type="button"
          >
            취소
          </button>
        </div>
      </div>
    </div>
  )
}

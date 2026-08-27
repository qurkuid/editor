'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { typeWithPyeong } from '@/lib/apt-format'
import { type AptVectorDoc, buildVectorNodes, type VectorSceneNodes } from '@/lib/apt-vector-scene'
import { withBasePath } from '@/lib/base-path'
import { type AptComplex, type AptPlan, plansToShow, useAptSearch } from '@/lib/use-apt-search'

type FeedbackType = 'wall' | 'door' | 'window' | 'zone' | 'other'
type FeedbackPin = { x: number; y: number; type: FeedbackType; note: string }

const FEEDBACK_META: Record<FeedbackType, { label: string; color: string }> = {
  wall: { label: '벽', color: '#dc2626' },
  door: { label: '문', color: '#f97316' },
  window: { label: '창', color: '#2563eb' },
  zone: { label: '존', color: '#7c3aed' },
  other: { label: '기타', color: '#334155' },
}

/**
 * Pipeline QA viewer: renders, over the original plan image, both what the
 * vectorizer detected (raw walls/gaps/rooms) and what the importer built
 * (merged walls, hosted openings, zones), plus a defect layer (dangling wall
 * ends, unhosted/deduped openings, dropped walls). Everything is computed
 * client-side from the same `/vector` document the real flow uses, so what
 * this page shows IS what auto-modeling would produce.
 */
export function AptDebug({
  initialApartmentId,
  initialPlanId,
}: {
  initialApartmentId?: string
  initialPlanId?: string
}) {
  const search = useAptSearch({ resultLimit: 30 })
  const [selected, setSelected] = useState<{
    apartmentId: string
    planId: string
    label: string
  } | null>(
    initialApartmentId && initialPlanId
      ? { apartmentId: initialApartmentId, planId: initialPlanId, label: initialPlanId }
      : null,
  )
  const [doc, setDoc] = useState<AptVectorDoc | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [layers, setLayers] = useState({
    raw: true,
    walls: true,
    openings: true,
    zones: true,
    defects: true,
  })
  const [feedbackMode, setFeedbackMode] = useState(false)
  const [pinType, setPinType] = useState<FeedbackType>('wall')
  const [pending, setPending] = useState<FeedbackPin[]>([])
  const [saved, setSaved] = useState<FeedbackPin[]>([])
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  useEffect(() => {
    setPending([])
    setSaved([])
    setSendState('idle')
    if (!selected) return
    let stale = false
    fetch(withBasePath(`/api/apt-feedback?planId=${encodeURIComponent(selected.planId)}`))
      .then(async (response) => (response.ok ? response.json() : null))
      .then((body: { code?: string; data?: { points?: FeedbackPin[] }[] } | null) => {
        if (stale || body?.code !== 'OK' || !body.data) return
        setSaved(body.data.flatMap((entry) => entry.points ?? []))
      })
      .catch(() => {})
    return () => {
      stale = true
    }
  }, [selected])

  const addPin = useCallback(
    (x: number, y: number) => {
      setPending((current) =>
        current.length >= 20 ? current : [...current, { x, y, type: pinType, note: '' }],
      )
    },
    [pinType],
  )

  const submitFeedback = useCallback(async () => {
    if (!selected || pending.length === 0) return
    setSendState('sending')
    try {
      const response = await fetch(withBasePath('/api/apt-feedback'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apartmentId: selected.apartmentId,
          planId: selected.planId,
          docVersion: doc?.docVersion,
          points: pending,
        }),
      })
      if (!response.ok) throw new Error(String(response.status))
      setSaved((current) => [...current, ...pending])
      setPending([])
      setSendState('sent')
    } catch {
      setSendState('error')
    }
  }, [selected, pending, doc])

  const [refreshTick, setRefreshTick] = useState(0)
  const refreshNextRef = useRef(false)

  useEffect(() => {
    if (!selected) return
    let stale = false
    const force = refreshNextRef.current
    refreshNextRef.current = false
    setStatus('loading')
    setDoc(null)
    fetch(
      withBasePath(
        `/api/apartments/${encodeURIComponent(selected.apartmentId)}/plans/${encodeURIComponent(selected.planId)}/vector${force ? '?refresh=1' : ''}`,
      ),
    )
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status))
        const body = (await response.json()) as { code: string; data?: AptVectorDoc }
        if (body.code !== 'OK' || !body.data) throw new Error(body.code)
        if (!stale) {
          setDoc(body.data)
          setStatus('idle')
        }
      })
      .catch(() => {
        if (!stale) setStatus('error')
      })
    return () => {
      stale = true
    }
  }, [selected, refreshTick])

  const built = useMemo(() => (doc ? buildVectorNodes(doc) : null), [doc])
  const pickPlan = useCallback((complex: AptComplex, plan: AptPlan) => {
    setSelected({
      apartmentId: complex.apartmentId,
      planId: plan.planId,
      label: `${complex.name} ${typeWithPyeong(plan.type)}`,
    })
  }, [])

  return (
    <div className="flex min-h-dvh">
      <aside className="flex w-72 shrink-0 flex-col border-border/60 border-r">
        <div className="border-border/50 border-b p-3">
          <p className="mb-2 font-semibold text-sm">자동 모델링 디버그</p>
          <input
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => search.setKeyword(event.target.value)}
            placeholder="아파트명·주소 검색"
            value={search.keyword}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {search.selected ? (
            <div className="p-2">
              <button
                className="mb-1 text-muted-foreground text-xs hover:text-foreground"
                onClick={search.clearSelection}
                type="button"
              >
                ← 검색 결과로
              </button>
              {plansToShow(search.selected, search.plansState).map((plan) => (
                <button
                  className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-accent/40"
                  key={plan.planId}
                  onClick={() => search.selected && pickPlan(search.selected, plan)}
                  type="button"
                >
                  {typeWithPyeong(plan.type)}{' '}
                  <span className="text-muted-foreground">{plan.planId}</span>
                </button>
              ))}
            </div>
          ) : (
            <ul>
              {search.results.map((complex) => (
                <li key={complex.apartmentId}>
                  <button
                    className="w-full border-border/40 border-b px-3 py-2 text-left hover:bg-accent/40"
                    onClick={() => search.select(complex)}
                    type="button"
                  >
                    <span className="block truncate text-sm">{complex.name}</span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {complex.addr}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {doc && built && <DebugSummary built={built} doc={doc} planId={selected?.planId ?? ''} />}
      </aside>

      <main className="min-w-0 flex-1 overflow-auto p-4">
        {!selected && (
          <p className="p-8 text-muted-foreground text-sm">
            좌측에서 단지 → 도면을 선택하면 벡터라이저 검출과 임포트 결과를 원본 위에 겹쳐
            보여줍니다.
          </p>
        )}
        {status === 'loading' && (
          <p className="p-8 text-muted-foreground text-sm">
            도면 분석 중… (최초 분석은 10초 정도 걸립니다)
          </p>
        )}
        {status === 'error' && (
          <p className="p-8 text-destructive text-sm">벡터 데이터를 불러오지 못했습니다.</p>
        )}
        {selected && doc && (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
              <span className="font-medium">{selected.label}</span>
              {(
                [
                  ['raw', '원시 검출'],
                  ['walls', '병합 벽'],
                  ['openings', '개구부'],
                  ['zones', '존'],
                  ['defects', '결함'],
                ] as const
              ).map(([key, label]) => (
                <label className="inline-flex items-center gap-1" key={key}>
                  <input
                    checked={layers[key]}
                    onChange={(event) =>
                      setLayers((current) => ({ ...current, [key]: event.target.checked }))
                    }
                    type="checkbox"
                  />
                  {label}
                </label>
              ))}
              <span className="mx-1 text-border">|</span>
              <button
                className="rounded-md border border-border px-2 py-1 font-medium hover:bg-accent/40 disabled:opacity-50"
                disabled={status === 'loading'}
                onClick={() => {
                  refreshNextRef.current = true
                  setRefreshTick((tick) => tick + 1)
                }}
                title="캐시를 무시하고 최신 파이프라인으로 다시 분석"
                type="button"
              >
                🔄 다시 분석
              </button>
              <button
                className={`rounded-md border px-2 py-1 font-medium ${feedbackMode ? 'border-red-500 bg-red-500/10 text-red-600' : 'border-border hover:bg-accent/40'}`}
                onClick={() => setFeedbackMode((on) => !on)}
                type="button"
              >
                {feedbackMode ? '📍 피드백 모드 켜짐 — 문제 지점을 클릭' : '📍 피드백 모드'}
              </button>
              {feedbackMode &&
                (Object.keys(FEEDBACK_META) as FeedbackType[]).map((type) => (
                  <button
                    key={type}
                    onClick={() => setPinType(type)}
                    style={{
                      borderColor: FEEDBACK_META[type].color,
                      background: pinType === type ? FEEDBACK_META[type].color : undefined,
                      color: pinType === type ? '#fff' : FEEDBACK_META[type].color,
                    }}
                    className="rounded-full border px-2 py-0.5 font-medium"
                    type="button"
                  >
                    {FEEDBACK_META[type].label}
                  </button>
                ))}
            </div>
            {feedbackMode && (pending.length > 0 || sendState !== 'idle') && (
              <div className="mb-2 flex flex-wrap items-center gap-2 rounded-md border border-border/60 p-2 text-xs">
                {pending.map((pin, index) => (
                  <span
                    className="inline-flex items-center gap-1 rounded border border-border/60 px-1.5 py-1"
                    key={`${pin.x.toFixed(0)}-${pin.y.toFixed(0)}-${index.toString()}`}
                  >
                    <span
                      className="inline-block h-4 w-4 rounded-full text-center font-bold text-[10px] text-white leading-4"
                      style={{ background: FEEDBACK_META[pin.type].color }}
                    >
                      {index + 1}
                    </span>
                    <input
                      className="w-40 bg-transparent outline-none placeholder:text-muted-foreground"
                      onChange={(event) =>
                        setPending((current) =>
                          current.map((p, i) =>
                            i === index ? { ...p, note: event.target.value } : p,
                          ),
                        )
                      }
                      placeholder="메모 (선택)"
                      value={pin.note}
                    />
                    <button
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setPending((current) => current.filter((_, i) => i !== index))}
                      type="button"
                    >
                      ✕
                    </button>
                  </span>
                ))}
                {pending.length > 0 && (
                  <button
                    className="rounded-md bg-foreground px-3 py-1.5 font-medium text-background disabled:opacity-50"
                    disabled={sendState === 'sending'}
                    onClick={() => void submitFeedback()}
                    type="button"
                  >
                    {sendState === 'sending' ? '전송 중…' : `핀 ${pending.length}개 전송`}
                  </button>
                )}
                {sendState === 'sent' && pending.length === 0 && (
                  <span className="text-green-600">
                    전송됨 — 다음 세션에서 좌표 기반으로 분석합니다
                  </span>
                )}
                {sendState === 'error' && (
                  <span className="text-destructive">전송 실패 — 다시 시도해 주세요</span>
                )}
              </div>
            )}
            <DebugCanvas
              built={built}
              doc={doc}
              feedbackMode={feedbackMode}
              layers={layers}
              onAddPin={addPin}
              pins={{ pending, saved }}
              selected={selected}
            />
          </>
        )}
      </main>
    </div>
  )
}

function DebugSummary({
  doc,
  built,
  planId,
}: {
  doc: AptVectorDoc
  built: VectorSceneNodes | null
  planId: string
}) {
  const dangling = useMemo(() => (built ? danglingEndpoints(built) : []), [built])
  return (
    <div className="space-y-1 border-border/50 border-t p-3 text-xs">
      <p>
        planId <code className="select-all rounded bg-accent/60 px-1">{planId}</code>
      </p>
      <p className="text-muted-foreground">
        파이프라인 v{doc.docVersion ?? '?'} ·{' '}
        {doc.mmPerPx ? `${doc.mmPerPx.toFixed(2)} mm/px` : '스케일 없음'} · IoU{' '}
        {doc.metrics?.wallIoU ?? '-'} · {doc.metrics?.style}
      </p>
      {built ? (
        <>
          <p>
            벽 {doc.walls.length} → {built.walls.length} · 개구부 {doc.openings.length} →{' '}
            {built.openings.length} · 존 {built.zones.length}
          </p>
          <p
            className={
              dangling.some((end) => end.kind === 'defect')
                ? 'text-destructive'
                : 'text-muted-foreground'
            }
          >
            결함 끝점 {dangling.filter((end) => end.kind === 'defect').length} · 개방 끝{' '}
            {dangling.filter((end) => end.kind === 'free').length} · 미배치{' '}
            {built.diagnostics.unhostedOpeningIds.length} · 중복제거{' '}
            {built.diagnostics.dedupedOpeningIds.length} · 드랍 벽{' '}
            {built.diagnostics.droppedWallIds.length}
          </p>
        </>
      ) : (
        <p className="text-destructive">임포터가 이 문서를 거부했습니다 (가이드-온리 폴백).</p>
      )}
    </div>
  )
}

function DebugCanvas({
  doc,
  built,
  layers,
  selected,
  feedbackMode,
  pins,
  onAddPin,
}: {
  doc: AptVectorDoc
  built: VectorSceneNodes | null
  layers: { raw: boolean; walls: boolean; openings: boolean; zones: boolean; defects: boolean }
  selected: { apartmentId: string; planId: string }
  feedbackMode: boolean
  pins: { pending: FeedbackPin[]; saved: FeedbackPin[] }
  onAddPin: (x: number, y: number) => void
}) {
  const [imageW, imageH] = doc.imageSize
  const s = doc.mmPerPx ?? 1
  const mmToPx = ([x, y]: [number, number]): [number, number] => [x / s, y / s]
  const mToPx = ([x, y]: [number, number]): [number, number] => [
    (x * 1000) / s + imageW / 2,
    (y * 1000) / s + imageH / 2,
  ]
  const imageUrl = withBasePath(
    `/api/apartments/${encodeURIComponent(selected.apartmentId)}/plans/${encodeURIComponent(selected.planId)}/image`,
  )
  const docOpeningById = new Map(doc.openings.map((opening) => [opening.id, opening]))
  const docWallById = new Map(doc.walls.map((wall) => [wall.id, wall]))
  const dangling = built && layers.defects ? danglingEndpoints(built) : []
  const rawColor = { door: '#f97316', window: '#2563eb', opening: '#c026d3' } as const

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: QA pin-drop surface
    <svg
      className={`h-auto w-full max-w-[1400px] rounded border border-border/60 bg-white ${feedbackMode ? 'cursor-crosshair' : ''}`}
      onClick={(event) => {
        if (!feedbackMode) return
        const rect = event.currentTarget.getBoundingClientRect()
        onAddPin(
          ((event.clientX - rect.left) / rect.width) * imageW,
          ((event.clientY - rect.top) / rect.height) * imageH,
        )
      }}
      role="img"
      viewBox={`0 0 ${imageW} ${imageH}`}
    >
      <title>플랜 디버그 오버레이</title>
      <image height={imageH} href={imageUrl} width={imageW} />

      {layers.raw && (
        <g>
          {doc.walls.map((wall) => {
            const [x1, y1] = mmToPx(wall.start)
            const [x2, y2] = mmToPx(wall.end)
            return (
              <line
                key={wall.id}
                stroke={wall.kind === 'exterior' ? '#e11d48' : '#16a34a'}
                strokeWidth={2}
                x1={x1}
                x2={x2}
                y1={y1}
                y2={y2}
              >
                <title>{`${wall.id} ${wall.kind} th=${wall.thickness}mm`}</title>
              </line>
            )
          })}
          {doc.openings.map((opening) => {
            const [x1, y1] = mmToPx(opening.a)
            const [x2, y2] = mmToPx(opening.b)
            return (
              <line
                key={opening.id}
                stroke={rawColor[opening.type]}
                strokeDasharray="5 3"
                strokeWidth={3}
                x1={x1}
                x2={x2}
                y1={y1}
                y2={y2}
              >
                <title>{`${opening.id} ${opening.type}`}</title>
              </line>
            )
          })}
        </g>
      )}

      {built && layers.walls && (
        <g opacity={0.45}>
          {built.walls.map((wall) => {
            const [x1, y1] = mToPx(wall.start)
            const [x2, y2] = mToPx(wall.end)
            return (
              <line
                key={wall.id}
                stroke="#0f172a"
                strokeWidth={((wall.thickness ?? 0.1) * 1000) / s}
                x1={x1}
                x2={x2}
                y1={y1}
                y2={y2}
              >
                <title>{`${wall.id} th=${((wall.thickness ?? 0.1) * 1000).toFixed(0)}mm`}</title>
              </line>
            )
          })}
        </g>
      )}

      {built && layers.openings && (
        <g>
          {built.openings.map((opening) => {
            const host = built.walls.find((wall) => wall.id === opening.wallId)
            if (!host) return null
            const [sx, sy] = mToPx(host.start)
            const [ex, ey] = mToPx(host.end)
            const len = Math.hypot(ex - sx, ey - sy)
            const dir: [number, number] = [(ex - sx) / len, (ey - sy) / len]
            const atPx = (opening.position[0] * 1000) / s
            const widthPx = (opening.width * 1000) / s
            const p1: [number, number] = [
              sx + dir[0] * (atPx - widthPx / 2),
              sy + dir[1] * (atPx - widthPx / 2),
            ]
            const p2: [number, number] = [
              sx + dir[0] * (atPx + widthPx / 2),
              sy + dir[1] * (atPx + widthPx / 2),
            ]
            const isOpeningCut = opening.type === 'window' && opening.openingKind === 'opening'
            const color = opening.type === 'door' ? '#f97316' : isOpeningCut ? '#c026d3' : '#2563eb'
            return (
              <line
                key={opening.id}
                stroke={color}
                strokeWidth={((host.thickness ?? 0.1) * 1000) / s + 4}
                opacity={0.75}
                x1={p1[0]}
                x2={p2[0]}
                y1={p1[1]}
                y2={p2[1]}
              >
                <title>{`${opening.type}${isOpeningCut ? '(개구부)' : ''} w=${(opening.width * 1000).toFixed(0)}mm`}</title>
              </line>
            )
          })}
        </g>
      )}

      {built && layers.zones && (
        <g>
          {built.zones.map((zone) => {
            const points = zone.polygon.map((point) => mToPx(point as [number, number]))
            const cx = points.reduce((sum, point) => sum + point[0], 0) / points.length
            const cy = points.reduce((sum, point) => sum + point[1], 0) / points.length
            return (
              <g key={zone.id}>
                <polygon
                  fill={zone.color}
                  fillOpacity={0.14}
                  points={points.map((point) => point.join(',')).join(' ')}
                  stroke={zone.color}
                  strokeDasharray="4 3"
                />
                <text fill="#111" fontSize={13} textAnchor="middle" x={cx} y={cy}>
                  {zone.name}
                </text>
              </g>
            )
          })}
        </g>
      )}

      {built && layers.defects && (
        <g>
          {dangling.map((end, index) => {
            const [x, y] = mToPx(end.point)
            const defect = end.kind === 'defect'
            return (
              <circle
                cx={x}
                cy={y}
                fill="none"
                key={`dangling-${index.toString()}`}
                r={defect ? 10 : 7}
                stroke={defect ? '#dc2626' : '#9ca3af'}
                strokeDasharray={defect ? undefined : '3 3'}
                strokeWidth={defect ? 2.5 : 2}
              >
                <title>
                  {defect ? '결함: 근처 벽에 못 닿은 끝점' : '개방형 벽 끝 (정상 추정)'}
                </title>
              </circle>
            )
          })}
          {built.diagnostics.unhostedOpeningIds.map((id) => {
            const opening = docOpeningById.get(id)
            if (!opening) return null
            const [x, y] = mmToPx([
              (opening.a[0] + opening.b[0]) / 2,
              (opening.a[1] + opening.b[1]) / 2,
            ])
            return (
              <text
                fill="#dc2626"
                fontSize={16}
                fontWeight={700}
                key={id}
                textAnchor="middle"
                x={x}
                y={y}
              >
                ✕<title>{`미배치 ${opening.type} (${id})`}</title>
              </text>
            )
          })}
          {built.diagnostics.droppedWallIds.map((id) => {
            const wall = docWallById.get(id)
            if (!wall) return null
            const [x, y] = mmToPx([
              (wall.start[0] + wall.end[0]) / 2,
              (wall.start[1] + wall.end[1]) / 2,
            ])
            return (
              <circle cx={x} cy={y} fill="#dc2626" key={id} opacity={0.6} r={4}>
                <title>{`드랍된 짧은 벽 (${id})`}</title>
              </circle>
            )
          })}
        </g>
      )}

      <g>
        {pins.saved.map((pin, index) => (
          <g key={`saved-${index.toString()}`} opacity={0.85}>
            <circle
              cx={pin.x}
              cy={pin.y}
              fill={FEEDBACK_META[pin.type]?.color ?? '#334155'}
              r={8}
              stroke="#fff"
              strokeWidth={2}
            />
            <title>{`신고됨 · ${FEEDBACK_META[pin.type]?.label ?? pin.type}${pin.note ? ` · ${pin.note}` : ''}`}</title>
          </g>
        ))}
        {pins.pending.map((pin, index) => (
          <g key={`pending-${index.toString()}`}>
            <circle
              cx={pin.x}
              cy={pin.y}
              fill={FEEDBACK_META[pin.type].color}
              r={11}
              stroke="#fff"
              strokeDasharray="4 3"
              strokeWidth={2.5}
            />
            <text
              fill="#fff"
              fontSize={12}
              fontWeight={700}
              textAnchor="middle"
              x={pin.x}
              y={pin.y + 4}
            >
              {index + 1}
            </text>
          </g>
        ))}
      </g>
    </svg>
  )
}

type DanglingEnd = { point: [number, number]; kind: 'defect' | 'free' }

/**
 * Wall ends touching nothing, split into DEFECTS (a weld target — crossing
 * wall line or facing collinear end — sits within 1.2 m, so the pipeline
 * SHOULD have closed this) and FREE ends (open-plan wall ends that are real
 * architecture and must not be welded shut).
 */
function danglingEndpoints(built: VectorSceneNodes): DanglingEnd[] {
  const out: DanglingEnd[] = []
  for (const wall of built.walls) {
    const len = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    const dir: [number, number] = [
      (wall.end[0] - wall.start[0]) / len,
      (wall.end[1] - wall.start[1]) / len,
    ]
    for (const endKey of ['start', 'end'] as const) {
      const point = wall[endKey] as [number, number]
      let best = Number.POSITIVE_INFINITY
      for (const other of built.walls) {
        if (other === wall) continue
        best = Math.min(
          best,
          distanceToSegment(point, other.start, other.end) - (other.thickness ?? 0.1) / 2,
        )
      }
      if (best <= 0.02) continue
      const outward: [number, number] = endKey === 'start' ? [-dir[0], -dir[1]] : dir
      out.push({
        point: [point[0], point[1]],
        kind: hasWeldTarget(built, wall, point, dir, outward) ? 'defect' : 'free',
      })
    }
  }
  return out
}

function hasWeldTarget(
  built: VectorSceneNodes,
  self: VectorSceneNodes['walls'][number],
  p: [number, number],
  dir: [number, number],
  outward: [number, number],
): boolean {
  for (const other of built.walls) {
    if (other === self) continue
    const oLen = Math.hypot(other.end[0] - other.start[0], other.end[1] - other.start[1])
    const oDir: [number, number] = [
      (other.end[0] - other.start[0]) / oLen,
      (other.end[1] - other.start[1]) / oLen,
    ]
    const det = dir[0] * oDir[1] - dir[1] * oDir[0]
    if (Math.abs(det) >= Math.sin((15 * Math.PI) / 180)) {
      // crossing line ahead within reach, near the other wall's extent
      const dx = other.start[0] - p[0]
      const dz = other.start[1] - p[1]
      const tSelf = (dx * oDir[1] - dz * oDir[0]) / det
      const forward = tSelf * (dir[0] * outward[0] + dir[1] * outward[1])
      if (forward < 0.02 || forward > 1.2) continue
      const cross: [number, number] = [p[0] + dir[0] * tSelf, p[1] + dir[1] * tSelf]
      const tOther = (cross[0] - other.start[0]) * oDir[0] + (cross[1] - other.start[1]) * oDir[1]
      if (tOther >= -0.5 && tOther <= oLen + 0.5) return true
    } else {
      // facing collinear end within reach
      for (const q of [other.start, other.end]) {
        const lateral = Math.abs((q[0] - p[0]) * dir[1] - (q[1] - p[1]) * dir[0])
        const forward = (q[0] - p[0]) * outward[0] + (q[1] - p[1]) * outward[1]
        if (lateral <= 0.2 && forward > 0.02 && forward <= 1.2) return true
      }
    }
  }
  return false
}

function distanceToSegment(
  point: readonly [number, number],
  start: readonly [number, number],
  end: readonly [number, number],
): number {
  const dx = end[0] - start[0]
  const dz = end[1] - start[1]
  const lengthSq = dx * dx + dz * dz
  const t = Math.max(
    0,
    Math.min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dz) / (lengthSq || 1)),
  )
  return Math.hypot(point[0] - (start[0] + dx * t), point[1] - (start[1] + dz * t))
}

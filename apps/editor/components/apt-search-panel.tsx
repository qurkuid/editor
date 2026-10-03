'use client'

import {
  type CeilingNode as CeilingNodeType,
  GuideNode,
  type GuideNode as GuideNodeType,
  runAsSingleSceneHistoryStep,
  type SlabNode as SlabNodeType,
} from '@pascal-app/core'
import { useEditor, useScene, useViewer } from '@pascal-app/editor'
import { ArrowLeft, Building2, Check, ExternalLink, Wand2 } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'
import { typeWithPyeong } from '@/lib/apt-format'
import {
  type AptGuideImportFrame,
  type AptPlanOrientation,
  aptImageTransform,
  findAptDerivedSurfaceIdsForLevel,
  findAptGuideForLevel,
  getAptGuideImportFrame,
  getAptGuideTransformError,
  isAptVectorNodeForLevel,
} from '@/lib/apt-import-frame'
import {
  APT_GUIDE_SCALE_RECOVERY_MESSAGE,
  type AptVectorDoc,
  buildVectorNodes,
  normalizeAptVectorDocForGuide,
  selectAptGuideForCalibration,
  selectAptGuideForImport,
} from '@/lib/apt-vector-scene'
import { withBasePath } from '@/lib/base-path'
import {
  type AptComplex,
  type AptInteriorState,
  type AptPlan,
  formatSceneDate,
  plansToShow,
  useAptSearch,
} from '@/lib/use-apt-search'

/**
 * 아파트 sidebar tab: search a complex, read its facts, pick a floor plan —
 * the pick lands the plan straight into the OPEN scene's active level as a
 * guide (reference image), so modeling continues without leaving the editor.
 */
export function AptSearchPanel() {
  const search = useAptSearch({ resultLimit: 60 })
  const levelId = useViewer((s) => s.selection.levelId)
  const setShowGuides = useViewer((s) => s.setShowGuides)
  const createNode = useScene((s) => s.createNode)
  const selectedReferenceId = useEditor((s) => s.selectedReferenceId)
  const setSelectedReferenceId = useEditor((s) => s.setSelectedReferenceId)
  const [addedPlanId, setAddedPlanId] = useState<string | null>(null)
  const [autoPlan, setAutoPlan] = useState<{
    planId: string
    status: 'loading' | 'error'
    message?: string
  } | null>(null)

  const markAdded = useCallback((planId: string) => {
    setAddedPlanId(planId)
    setTimeout(() => setAddedPlanId((current) => (current === planId ? null : current)), 2500)
  }, [])

  const buildGuide = useCallback(
    (complex: AptComplex, plan: AptPlan, scale: number, orientation: AptPlanOrientation) =>
      GuideNode.parse({
        name: [complex.name, plan.type].filter(Boolean).join(' '),
        url: withBasePath(
          `/api/apartments/${encodeURIComponent(complex.apartmentId)}/plans/${encodeURIComponent(plan.planId)}/image`,
        ),
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale,
        flipX: orientation.flipX,
        flipY: orientation.flipY,
        opacity: 50,
        scaleReference: null,
        metadata: { apartmentId: complex.apartmentId, planId: plan.planId },
      }),
    [],
  )

  const addPlanToScene = useCallback(
    (complex: AptComplex, plan: AptPlan, orientation: AptPlanOrientation) => {
      if (!levelId) return
      const guide = buildGuide(complex, plan, 1, orientation)
      createNode(guide, levelId as never)
      setShowGuides(true)
      setSelectedReferenceId(guide.id)
      markAdded(plan.planId)
    },
    [levelId, createNode, setShowGuides, setSelectedReferenceId, buildGuide, markAdded],
  )

  // Vectorizes the plan server-side and lands guide + walls + doors/windows
  // in the active level as ONE undoable step. Failure leaves the scene
  // untouched — the plain "현재 씬에 깔기" path stays available.
  const autoModelPlan = useCallback(
    async (complex: AptComplex, plan: AptPlan, orientation: AptPlanOrientation) => {
      if (!levelId) return
      setAutoPlan({ planId: plan.planId, status: 'loading' })
      try {
        const response = await fetch(
          withBasePath(
            `/api/apartments/${encodeURIComponent(complex.apartmentId)}/plans/${encodeURIComponent(plan.planId)}/vector`,
          ),
          { cache: 'no-store' },
        )
        const body = response.ok
          ? ((await response.json()) as { code: string; data?: AptVectorDoc })
          : null
        const existingNodes = useScene.getState().nodes
        const candidateGuide = findAptGuideForLevel(
          existingNodes,
          levelId,
          complex.apartmentId,
          plan.planId,
        )
        const strictGuides = Object.values(existingNodes).filter((node): node is GuideNodeType => {
          if (node.type !== 'guide' || node.parentId !== levelId) return false
          const metadata =
            node.metadata && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
              ? (node.metadata as Record<string, unknown>)
              : {}
          return metadata.apartmentId === complex.apartmentId && metadata.planId === plan.planId
        })
        const strictGuide = selectAptGuideForCalibration(strictGuides, selectedReferenceId)
        const isPixelVector = body?.code === 'OK' && body.data?.unit === 'px'
        // Pixel recovery must never attach to the legacy plan-only candidate:
        // it has no proof that its guide belongs to this apartment/level.
        const existingGuide = selectAptGuideForImport(candidateGuide, strictGuide, isPixelVector)
        const staleSurfaceIds = new Set(
          findAptDerivedSurfaceIdsForLevel(
            existingNodes,
            levelId,
            complex.apartmentId,
            plan.planId,
          ),
        )
        const retainedSlabs = Object.values(existingNodes).filter(
          (node): node is SlabNodeType =>
            node.type === 'slab' && node.parentId === levelId && !staleSurfaceIds.has(node.id),
        )
        const retainedCeilings = Object.values(existingNodes).filter(
          (node): node is CeilingNodeType =>
            node.type === 'ceiling' && node.parentId === levelId && !staleSurfaceIds.has(node.id),
        )
        if (existingGuide) {
          const transformError = getAptGuideTransformError(existingGuide)
          if (transformError) {
            setAutoPlan({ planId: plan.planId, status: 'error', message: transformError })
            return
          }
        }
        const existingGuideFrame: Partial<AptGuideImportFrame> = existingGuide
          ? getAptGuideImportFrame(existingGuide)
          : {}
        const guideForCalibration = isPixelVector ? strictGuide : existingGuide
        const normalized =
          body?.code === 'OK' && body.data
            ? normalizeAptVectorDocForGuide(
                body.data,
                guideForCalibration
                  ? {
                      guide: guideForCalibration,
                      levelId,
                      apartmentId: complex.apartmentId,
                      planId: plan.planId,
                    }
                  : null,
              )
            : null
        if (normalized && !normalized.ok) {
          if (existingGuide) {
            setShowGuides(true)
            setSelectedReferenceId(existingGuide.id)
          }
          setAutoPlan({
            planId: plan.planId,
            status: 'error',
            message: normalized.message || APT_GUIDE_SCALE_RECOVERY_MESSAGE,
          })
          return
        }
        const built = normalized?.ok
          ? buildVectorNodes(
              normalized.doc,
              {
                ...orientation,
                ...existingGuideFrame,
              },
              {
                existingSlabs: retainedSlabs,
                existingCeilings: retainedCeilings,
              },
            )
          : null
        if (!built) {
          setAutoPlan({
            planId: plan.planId,
            status: 'error',
            message: '도면 분석 결과를 만들지 못했습니다. 밑그림만 추가해 보세요.',
          })
          return
        }
        const guide = existingGuide ?? buildGuide(complex, plan, built.guideScale, orientation)
        const tag = {
          source: 'apt-vector',
          apartmentId: complex.apartmentId,
          planId: plan.planId,
          ...(normalized?.calibration
            ? {
                scaleSource: normalized.calibration.source,
                scaleCalibration: normalized.calibration,
              }
            : {}),
        }
        for (const node of [...built.walls, ...built.openings, ...built.zones]) {
          node.metadata = { ...(node.metadata as Record<string, unknown>), ...tag }
        }
        if (normalized?.calibration) {
          const calibrationTag = {
            scaleSource: normalized.calibration.source,
            scaleCalibration: normalized.calibration,
          }
          for (const node of [...built.slabs, ...built.ceilings]) {
            node.metadata = { ...(node.metadata as Record<string, unknown>), ...calibrationTag }
          }
        }
        runAsSingleSceneHistoryStep(useScene, () => {
          const { applyNodeChanges, nodes } = useScene.getState()
          // rerunning on the same plan REPLACES the previous auto-model
          // roots in the active level, so iteration doesn't stack duplicates.
          const stale = Object.values(nodes)
            .filter((node) =>
              isAptVectorNodeForLevel(node, levelId, complex.apartmentId, plan.planId),
            )
            .map((node) => node.id)
          const staleSurfaces = [...staleSurfaceIds]
          applyNodeChanges({
            delete: [...stale, ...staleSurfaces] as never[],
            update: existingGuide
              ? [
                  {
                    id: existingGuide.id,
                    data: {
                      flipX: orientation.flipX,
                      flipY: orientation.flipY,
                      ...(existingGuideFrame.scale === undefined
                        ? { scale: built.guideScale }
                        : {}),
                    },
                  },
                ]
              : [],
            create: [
              ...(existingGuide ? [] : [{ node: guide, parentId: levelId as never }]),
              ...built.walls.map((wall) => ({ node: wall, parentId: levelId as never })),
              ...built.openings.flatMap((opening) =>
                opening.wallId ? [{ node: opening, parentId: opening.wallId as never }] : [],
              ),
              ...built.zones.map((zone) => ({ node: zone, parentId: levelId as never })),
              ...built.slabs.map((slab) => ({ node: slab, parentId: levelId as never })),
              ...built.ceilings.map((ceiling) => ({ node: ceiling, parentId: levelId as never })),
            ],
          })
        })
        setShowGuides(true)
        setSelectedReferenceId(guide.id)
        setAutoPlan(null)
        markAdded(plan.planId)
      } catch {
        setAutoPlan({
          planId: plan.planId,
          status: 'error',
          message: '자동 모델링을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.',
        })
      }
    },
    [levelId, setShowGuides, setSelectedReferenceId, buildGuide, markAdded, selectedReferenceId],
  )

  if (search.loadFailed) {
    return <p className="p-4 text-muted-foreground text-sm">아파트 데이터를 불러오지 못했습니다.</p>
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-border/50 border-b p-3">
        <input
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus:border-ring"
          onChange={(event) => search.setKeyword(event.target.value)}
          placeholder="아파트명·주소 검색"
          value={search.keyword}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {search.selected ? (
          <ComplexDetail
            addedPlanId={addedPlanId}
            autoPlan={autoPlan}
            canAdd={!!levelId}
            complex={search.selected}
            interiorState={search.interiorState}
            levelId={levelId}
            onAdd={addPlanToScene}
            onAutoModel={autoModelPlan}
            onBack={search.clearSelection}
            plans={plansToShow(search.selected, search.plansState)}
            plansLoading={search.plansState.status === 'loading'}
            teamScenes={search.teamScenes}
          />
        ) : search.keyword.trim() ? (
          <ul>
            {search.results.map((complex) => (
              <li key={complex.apartmentId}>
                <button
                  className="w-full border-border/40 border-b px-3 py-2.5 text-left hover:bg-accent/40"
                  onClick={() => search.select(complex)}
                  type="button"
                >
                  <span className="block truncate font-medium text-sm">{complex.name}</span>
                  <span className="block truncate text-muted-foreground text-xs">
                    {complex.addr}
                  </span>
                </button>
              </li>
            ))}
            {search.results.length === 0 && search.ready && (
              <li className="p-4 text-muted-foreground text-sm">검색 결과가 없습니다.</li>
            )}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <Building2 className="h-8 w-8 text-muted-foreground/60" />
            <p className="text-muted-foreground text-sm">
              {search.ready
                ? `전국 ${search.total.toLocaleString()}개 단지의 평형별 도면을 검색해보세요.`
                : '아파트 데이터를 불러오는 중…'}
            </p>
            <p className="text-muted-foreground/70 text-xs">
              도면을 선택하면 현재 씬에 밑그림으로 깔립니다.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function ComplexDetail({
  complex,
  interiorState,
  plans,
  plansLoading,
  teamScenes,
  canAdd,
  levelId,
  addedPlanId,
  autoPlan,
  onAdd,
  onAutoModel,
  onBack,
}: {
  complex: AptComplex
  interiorState: AptInteriorState
  plans: AptPlan[]
  plansLoading: boolean
  teamScenes: { id: string; name: string; updatedAt: string }[]
  canAdd: boolean
  levelId: string | null
  addedPlanId: string | null
  autoPlan: { planId: string; status: 'loading' | 'error'; message?: string } | null
  onAdd: (complex: AptComplex, plan: AptPlan, orientation: AptPlanOrientation) => void
  onAutoModel: (complex: AptComplex, plan: AptPlan, orientation: AptPlanOrientation) => void
  onBack: () => void
}) {
  return (
    <div className="p-3">
      <button
        className="mb-2 flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground"
        onClick={onBack}
        type="button"
      >
        <ArrowLeft className="h-3 w-3" /> 검색 결과로
      </button>

      <h3 className="font-semibold text-sm">{complex.name}</h3>
      <p className="mt-0.5 text-muted-foreground text-xs">{complex.addr}</p>
      <a
        className="mt-1 inline-flex items-center gap-1 text-muted-foreground text-xs underline-offset-2 hover:text-foreground hover:underline"
        href={`https://fin.land.naver.com/search?q=${encodeURIComponent(complex.name)}`}
        rel="noopener noreferrer"
        target="_blank"
      >
        Npay 부동산에서 확인 <ExternalLink className="h-3 w-3" />
      </a>

      <InteriorFacts state={interiorState} />

      {teamScenes.length > 0 && (
        <div className="mt-3 rounded-lg border border-border/60 p-2.5">
          <p className="mb-1.5 font-medium text-xs">작업 중인 도면</p>
          {teamScenes.slice(0, 4).map((scene) => (
            <Link
              className="block truncate rounded px-1.5 py-1 text-muted-foreground text-xs hover:bg-accent/40 hover:text-foreground"
              href={`/scene/${scene.id}`}
              key={scene.id}
            >
              {scene.name} · {formatSceneDate(scene.updatedAt)}
            </Link>
          ))}
        </div>
      )}

      <p className="mt-4 mb-1.5 font-medium text-xs">
        평형별 도면 {plans.length > 0 && `(${plans.length})`}
      </p>
      {plansLoading && <p className="text-muted-foreground text-xs">도면 불러오는 중…</p>}
      {!plansLoading && plans.length === 0 && (
        <p className="text-muted-foreground text-xs">이 단지의 도면을 찾지 못했습니다.</p>
      )}
      <div className="flex flex-col gap-3">
        {plans.map((plan) => (
          <PanelPlanCard
            added={addedPlanId === plan.planId}
            autoPlan={autoPlan?.planId === plan.planId ? autoPlan : null}
            canAdd={canAdd}
            complex={complex}
            key={`${complex.apartmentId}:${plan.planId}:${levelId ?? 'none'}`}
            levelId={levelId}
            onAdd={onAdd}
            onAutoModel={onAutoModel}
            plan={plan}
          />
        ))}
      </div>
    </div>
  )
}

function PanelPlanCard({
  added,
  autoPlan,
  canAdd,
  complex,
  levelId,
  onAdd,
  onAutoModel,
  plan,
}: {
  added: boolean
  autoPlan: { planId: string; status: 'loading' | 'error'; message?: string } | null
  canAdd: boolean
  complex: AptComplex
  levelId: string | null
  onAdd: (complex: AptComplex, plan: AptPlan, orientation: AptPlanOrientation) => void
  onAutoModel: (complex: AptComplex, plan: AptPlan, orientation: AptPlanOrientation) => void
  plan: AptPlan
}) {
  const existingGuide = useScene((state) =>
    levelId ? findAptGuideForLevel(state.nodes, levelId, complex.apartmentId, plan.planId) : null,
  )
  const [flipX, setFlipX] = useState(() => existingGuide?.flipX ?? false)
  const [flipY, setFlipY] = useState(() => existingGuide?.flipY ?? false)
  const orientation = { flipX, flipY }
  const traceParams = new URLSearchParams({
    apartmentId: complex.apartmentId,
    planId: plan.planId,
    name: complex.name,
    type: plan.type,
  })
  if (flipX) traceParams.set('flipX', '1')
  if (flipY) traceParams.set('flipY', '1')

  return (
    <div className="rounded-lg border border-border/60 p-2">
      <p className="mb-1 font-medium text-xs">{typeWithPyeong(plan.type)}</p>
      <img
        alt={plan.name || plan.type}
        className="w-full rounded-md bg-white"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={plan.planPic}
        style={{ transform: aptImageTransform(orientation) }}
      />
      <div aria-label="도면 방향" className="mt-1.5 flex gap-1.5" role="group">
        <button
          aria-pressed={flipX}
          className={`flex-1 rounded-md border px-2 py-1 font-medium text-xs hover:bg-accent/40 ${flipX ? 'border-primary bg-accent text-foreground' : 'border-border text-muted-foreground'}`}
          onClick={() => setFlipX((active) => !active)}
          type="button"
        >
          좌우 반전
        </button>
        <button
          aria-pressed={flipY}
          className={`flex-1 rounded-md border px-2 py-1 font-medium text-xs hover:bg-accent/40 ${flipY ? 'border-primary bg-accent text-foreground' : 'border-border text-muted-foreground'}`}
          onClick={() => setFlipY((active) => !active)}
          type="button"
        >
          상하 반전
        </button>
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <button
          className="flex-1 rounded-md bg-accent px-2 py-1.5 font-medium text-xs hover:bg-accent/80 disabled:opacity-50"
          disabled={!canAdd}
          onClick={() => onAdd(complex, plan, orientation)}
          title={canAdd ? undefined : '레벨을 먼저 선택하세요'}
          type="button"
        >
          {added ? (
            <span className="inline-flex items-center gap-1">
              <Check className="h-3 w-3" /> 씬에 추가됨
            </span>
          ) : (
            '현재 씬에 깔기'
          )}
        </button>
        <button
          className="rounded-md border border-border px-2 py-1.5 text-xs hover:bg-accent/40"
          onClick={() =>
            window.location.assign(withBasePath(`/apt/trace?${traceParams.toString()}`))
          }
          type="button"
        >
          새 씬으로
        </button>
      </div>
      <button
        className="mt-1.5 w-full rounded-md border border-border px-2 py-1.5 font-medium text-xs hover:bg-accent/40 disabled:opacity-50"
        disabled={!canAdd || autoPlan?.status === 'loading'}
        onClick={() => onAutoModel(complex, plan, orientation)}
        title={canAdd ? undefined : '레벨을 먼저 선택하세요'}
        type="button"
      >
        {autoPlan?.status === 'loading' ? (
          '도면 분석 중… (최초 10초)'
        ) : autoPlan?.status === 'error' ? (
          '자동 모델링 실패 — 밑그림만 추가해 보세요'
        ) : (
          <span className="inline-flex items-center gap-1">
            <Wand2 className="h-3 w-3" /> 자동 모델링 (벽·문·창)
          </span>
        )}
      </button>
      {autoPlan?.status === 'error' && autoPlan.message && (
        <p className="mt-1.5 text-destructive text-[11px] leading-4">{autoPlan.message}</p>
      )}
    </div>
  )
}

function InteriorFacts({ state }: { state: AptInteriorState }) {
  if (state.status === 'loading') {
    return <p className="mt-2 text-muted-foreground text-xs">단지 정보를 확인하는 중…</p>
  }
  if (state.status === 'empty') return null

  const info = state.info
  const rows: [string, string][] = []
  const approval = [info.approvalDate, info.ageYears ? `${info.ageYears}년차` : '']
    .filter(Boolean)
    .join(' · ')
  const scale = [
    info.buildings ? `${info.buildings.toLocaleString()}개 동` : '',
    info.households ? `${info.households.toLocaleString()}세대` : '',
  ]
    .filter(Boolean)
    .join(' · ')
  if (approval) rows.push(['사용승인', approval])
  if (info.heating) rows.push(['난방', info.heating])
  if (info.corridor) rows.push(['현관·복도', info.corridor])
  if (scale) rows.push(['단지 규모', scale])
  if (info.builder) rows.push(['시공사', info.builder])
  if (rows.length === 0) return null

  return (
    <dl className="mt-3 grid grid-cols-2 gap-1.5 rounded-lg border border-border/60 p-2.5">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt className="text-[10px] text-muted-foreground">{label}</dt>
          <dd className="text-xs">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

'use client'

import {
  buildRoomBoundaryRepairUpdates,
  buildRoomBoundaryOpenReviewUpdate,
  diagnoseRoomBoundaries,
  planAutoZonesForLevel,
  runAsSingleSceneHistoryStep,
  zoneNeedsBoundaryReview,
  type AnyNode,
  type RoomBoundaryRepairPlan,
  type WallNode,
  type ZoneNode,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Link2, MapPin, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import { formatLinearMeasurement } from '../../../../../lib/measurements'
import useEditor from '../../../../../store/use-editor'
import { beginRoomBoundaryInteraction } from '../../../../editor-2d/room-boundary-interaction'
import { PanelSection } from '../../../controls/panel-section'

const REPAIR_REASON_LABEL: Record<string, string> = {
  ambiguous: '가장 가까운 연결이 여러 개입니다.',
  collinear: '같은 선상에서 안전한 연결을 결정할 수 없습니다.',
  curved: '곡선 벽은 자동 연결할 수 없습니다.',
  large: '간격이 너무 큽니다.',
  parallel: '평행한 벽과의 연결은 수동 확인이 필요합니다.',
  'does-not-close-room': '연결해도 닫힌 공간이 생기지 않습니다.',
  stale: '벽이 변경되어 점검 결과가 오래되었습니다.',
  'not-found': '점검 항목을 찾을 수 없습니다.',
  'no-repairable-candidate': '안전한 자동 연결 후보가 없습니다.',
  invalid: '벽 연결 검증에 실패했습니다.',
}

function repairReason(plan: Pick<RoomBoundaryRepairPlan, 'reason'>) {
  return plan.reason ? (REPAIR_REASON_LABEL[plan.reason] ?? '연결할 수 없습니다.') : '연결할 수 없습니다.'
}

function levelGeometry(nodes: Record<string, AnyNode>, levelId: string) {
  const level = nodes[levelId]
  if (level?.type !== 'level') return { walls: [] as WallNode[], zones: [] as ZoneNode[] }

  const children = level.children.map((childId) => nodes[childId])
  return {
    walls: children.filter((node): node is WallNode => node?.type === 'wall'),
    zones: children.filter((node): node is ZoneNode => node?.type === 'zone'),
  }
}

type AutoZoneCreationContext = {
  source: 'apt-vector'
  generatedFrom: 'detected-space'
  apartmentId?: string
  planId?: string
}

function metadataRecord(node: Pick<AnyNode, 'metadata'>): Record<string, unknown> {
  return node.metadata !== null && typeof node.metadata === 'object' && !Array.isArray(node.metadata)
    ? (node.metadata as Record<string, unknown>)
    : {}
}

function uniqueAptMetadataValue(
  metadata: readonly Record<string, unknown>[],
  key: 'apartmentId' | 'planId',
) {
  const values = new Set(
    metadata
      .map((entry) => entry[key])
      .filter((value): value is string => typeof value === 'string' && value.length > 0),
  )
  return values.size === 1 ? values.values().next().value : undefined
}

function zoneCreationContext(
  walls: readonly WallNode[],
  zones: readonly ZoneNode[],
): AutoZoneCreationContext | undefined {
  const aptMetadata = [...walls, ...zones]
    .map(metadataRecord)
    .filter((metadata) => metadata.source === 'apt-vector')
  if (aptMetadata.length === 0) return undefined

  const apartmentId = uniqueAptMetadataValue(aptMetadata, 'apartmentId')
  const planId = uniqueAptMetadataValue(aptMetadata, 'planId')
  return {
    source: 'apt-vector',
    generatedFrom: 'detected-space',
    ...(apartmentId ? { apartmentId } : {}),
    ...(planId ? { planId } : {}),
  }
}

function candidateForIssue(issue: { candidates: RoomBoundaryRepairPlan['candidate'][] }) {
  return issue.candidates.find((candidate) => candidate?.safe) ?? issue.candidates[0]
}

export function ZoneClosurePanel() {
  const currentLevelId = useViewer((state) => state.selection.levelId)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const setSelection = useViewer((state) => state.setSelection)
  const setPhase = useEditor((state) => state.setPhase)
  const setMode = useEditor((state) => state.setMode)
  const setViewMode = useEditor((state) => state.setViewMode)
  const setStructureLayer = useEditor((state) => state.setStructureLayer)
  const setActiveSidebarPanel = useEditor((state) => state.setActiveSidebarPanel)
  const nodes = useScene((state) => state.nodes)
  const readOnly = useScene((state) => state.readOnly)
  const [busyIssueId, setBusyIssueId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { walls, zones } = useMemo(
    () => (currentLevelId ? levelGeometry(nodes, currentLevelId) : { walls: [], zones: [] }),
    [currentLevelId, nodes],
  )
  const diagnostics = useMemo(
    () =>
      currentLevelId ? diagnoseRoomBoundaries(currentLevelId, walls, zones) : null,
    [currentLevelId, walls, zones],
  )
  const zonePlan = useMemo(
    () =>
      diagnostics
        ? planAutoZonesForLevel(diagnostics.spaces, zones, {
            createMissingZones: zoneCreationContext(walls, zones),
          })
        : { create: [], update: [] },
    [diagnostics, walls, zones],
  )
  const repairPlans = useMemo(
    () =>
      diagnostics && currentLevelId
        ? new Map(
            diagnostics.issues.map((issue) => [
              issue.id,
              buildRoomBoundaryRepairUpdates(nodes, currentLevelId, issue.id, diagnostics),
            ] as const),
          )
        : new Map(),
    [currentLevelId, diagnostics, nodes],
  )

  const locateWall = (wallId: WallNode['id']) => {
    setPhase('structure')
    setStructureLayer('zones')
    setMode('select')
    setViewMode('2d')
    setActiveSidebarPanel('site')
    setSelection({ selectedIds: [wallId], zoneId: null })
  }

  const handleRepair = (issueId: string) => {
    if (!currentLevelId) return
    setError(null)
    const scene = useScene.getState()
    if (scene.readOnly) {
      setError('읽기 전용 장면에서는 벽을 연결할 수 없습니다.')
      return
    }

    setBusyIssueId(issueId)
    try {
      // Re-plan against the current scene at click time. The marker may have
      // survived another wall edit, so its render-time candidate is advisory.
      const plan = buildRoomBoundaryRepairUpdates(scene.nodes, currentLevelId, issueId)
      if (!plan.ok || plan.updates.length === 0) {
        setError(repairReason(plan))
        return
      }

      runAsSingleSceneHistoryStep(useScene, () => {
        useScene.getState().applyNodeChanges({ update: plan.updates })
      })
      // Keep the current 2D/Zones inspection context after a repair. Selecting
      // the repaired wall is enough to make the result visible without
      // switching the sidebar to the element tree or opening split view.
      if (plan.candidate) {
        setSelection({ selectedIds: [plan.candidate.endpoint.wallId], zoneId: null })
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '벽 연결 검증에 실패했습니다.')
    } finally {
      setBusyIssueId(null)
    }
  }

  const handleCreateZones = () => {
    if (!currentLevelId) return
    setError(null)
    const scene = useScene.getState()
    if (scene.readOnly) {
      setError('읽기 전용 장면에서는 존을 구성할 수 없습니다.')
      return
    }

    const current = levelGeometry(scene.nodes, currentLevelId)
    const currentDiagnostics = diagnoseRoomBoundaries(currentLevelId, current.walls, current.zones)
    const currentPlan = planAutoZonesForLevel(currentDiagnostics.spaces, current.zones, {
      createMissingZones: zoneCreationContext(current.walls, current.zones),
    })
    if (currentPlan.create.length === 0 && currentPlan.update.length === 0) {
      setError('추가로 구성할 닫힌 공간 존이 없습니다.')
      return
    }

    runAsSingleSceneHistoryStep(useScene, () => {
      useScene.getState().applyNodeChanges({
        create: currentPlan.create.map((node) => ({ node, parentId: currentLevelId })),
        update: currentPlan.update,
      })
    })
  }

  if (!currentLevelId || !diagnostics) return null

  const closedRoomCount = diagnostics.spaces.filter((space) => !space.isExterior).length
  const closedZoneCount = zones.filter(
    (zone) => zone.spaceRole === 'room' && zone.enclosureStatus === 'enclosed',
  ).length
  const pendingBoundaryReviewIds = new Set(
    zonePlan.update.flatMap((entry) => {
      const metadata = entry.data.metadata
      return metadata !== null &&
        typeof metadata === 'object' &&
        !Array.isArray(metadata) &&
        metadata.boundaryNeedsReview === true
        ? [entry.id]
        : []
    }),
  )
  const boundaryReviewZones = zones.filter(
    (zone) => zoneNeedsBoundaryReview(zone) || pendingBoundaryReviewIds.has(zone.id),
  )

  return (
    <PanelSection title="공간 경계 점검">
      <div className="grid gap-2" data-testid="zone-closure-panel">
        <div className="grid grid-cols-2 gap-1.5 text-[11px]" data-testid="zone-closure-stats">
          <div className="rounded-md border border-border/60 bg-background/35 px-2 py-1.5">
            <div className="text-muted-foreground">닫힌 공간</div>
            <div className="font-semibold text-foreground">{closedRoomCount}</div>
          </div>
          <div className="rounded-md border border-border/60 bg-background/35 px-2 py-1.5">
            <div className="text-muted-foreground">닫힌 존</div>
            <div className="font-semibold text-foreground">{closedZoneCount}</div>
          </div>
        </div>

        {zonePlan.create.length > 0 && !readOnly ? (
          <button
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-primary/50 bg-primary/10 px-2.5 py-2 text-left text-primary text-xs transition-colors hover:bg-primary/20"
            data-testid="zone-closure-create-zones"
            onClick={handleCreateZones}
            type="button"
          >
            <Sparkles className="h-3.5 w-3.5" />
            닫힌 공간 존 구성 ({zonePlan.create.length})
          </button>
        ) : null}

        {readOnly ? (
          <div className="rounded-md border border-border/50 bg-muted/20 px-2.5 py-2 text-[11px] text-muted-foreground">
            읽기 전용 장면에서는 연결과 존 구성을 변경할 수 없습니다.
          </div>
        ) : null}

        {boundaryReviewZones.length > 0 ? (
          <div
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-700 dark:text-amber-300"
            data-testid="zone-closure-boundary-review"
            role="status"
          >
            경계 확인 필요: {boundaryReviewZones.map((zone) => zone.name || zone.id).join(', ')}
          </div>
        ) : null}

        {diagnostics.issues.length === 0 ? (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2.5 py-2 text-[11px] text-emerald-700 dark:text-emerald-300">
            열린 벽 끝점이 없습니다.
          </div>
        ) : (
          <div className="grid gap-1.5" data-testid="zone-closure-issues">
            {diagnostics.issues.map((issue) => {
              const repairPlan = repairPlans.get(issue.id)
              const candidate = repairPlan?.candidate ?? candidateForIssue(issue)
              const safe = repairPlan ? repairPlan.ok : candidate?.safe === true
              const gap = candidate?.distance
              return (
                <div
                  className="rounded-md border border-border/60 bg-background/35 px-2.5 py-2"
                  data-room-boundary-issue={issue.id}
                  key={issue.id}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className={safe ? 'h-2 w-2 rounded-full bg-red-600' : 'h-2 w-2 rounded-full bg-amber-500'}
                    />
                    <span className="min-w-0 flex-1 truncate text-foreground text-xs">
                      {issue.wallId} · {issue.endpoint}
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {gap !== undefined
                        ? formatLinearMeasurement(gap, unit, metricNotation)
                        : '간격 미정'}
                    </span>
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {issue.reviewedOpen
                      ? '개방 유지 · 확인 완료'
                      : safe
                      ? '빠른 연결 가능'
                      : repairPlan?.reason
                        ? repairReason(repairPlan)
                        : REPAIR_REASON_LABEL[candidate?.reason ?? ''] ?? '수동 확인'}
                  </div>
                  {!readOnly ? <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <button type="button" className="rounded border px-2 py-1.5 text-[10px]" data-testid={`zone-closure-connect-${issue.id}`} onClick={() => { locateWall(issue.wallId); beginRoomBoundaryInteraction(issue.wallId, issue.endpoint) }}>대상 연결</button>
                    <button type="button" className="rounded border px-2 py-1.5 text-[10px]" data-testid={`zone-closure-move-${issue.id}`} onClick={() => { locateWall(issue.wallId); beginRoomBoundaryInteraction(issue.wallId, issue.endpoint, 'boundary-move') }}>끝점 이동</button>
                    <button type="button" className="rounded border px-2 py-1.5 text-[10px]" data-testid={`zone-closure-open-${issue.id}`} onClick={() => {
                      const scene = useScene.getState()
                      const wall = scene.nodes[issue.wallId]
                      if (scene.readOnly || wall?.type !== 'wall') return
                      runAsSingleSceneHistoryStep(useScene, () => scene.applyNodeChanges({ update: [buildRoomBoundaryOpenReviewUpdate(wall, issue.endpoint, !issue.reviewedOpen)] }))
                    }}>{issue.reviewedOpen ? '다시 점검' : '개방 유지'}</button>
                  </div> : null}
                  <div className="mt-1.5 flex gap-1.5">
                    <button
                      className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border/60 px-2 py-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
                      data-testid={`zone-closure-locate-${issue.id}`}
                      onClick={() => locateWall(issue.wallId)}
                      type="button"
                    >
                      <MapPin className="h-3 w-3" />
                      2D에서 위치
                    </button>
                    {safe && !readOnly ? (
                      <button
                        className="flex flex-1 items-center justify-center gap-1 rounded-md border border-red-500/50 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-700 transition-colors hover:bg-red-500/20 dark:text-red-300"
                        data-testid={`zone-closure-repair-${issue.id}`}
                        disabled={busyIssueId === issue.id}
                        onClick={() => handleRepair(issue.id)}
                        type="button"
                      >
                        <Link2 className="h-3 w-3" />
                        {busyIssueId === issue.id ? '연결 중…' : '연결'}
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {error ? (
          <div
            aria-live="polite"
            className="rounded-md border border-red-500/40 bg-red-500/10 px-2.5 py-2 text-[11px] text-red-700 dark:text-red-300"
            data-testid="zone-closure-error"
            role="alert"
          >
            {error}
          </div>
        ) : null}
      </div>
    </PanelSection>
  )
}

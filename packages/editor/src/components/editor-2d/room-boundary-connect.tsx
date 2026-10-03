'use client'

import {
  type AnyNodeId,
  buildManualRoomBoundaryRepair,
  getWallThickness,
  type ManualRoomBoundaryBendOrder,
  type ManualRoomBoundaryInput,
  type ManualRoomBoundaryMode,
  type ManualRoomBoundaryPlan,
  roomBoundarySnapshot,
  runAsSingleSceneHistoryStep,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clientToPlan } from '../../lib/floorplan/plan-coords'
import { formatLinearMeasurement } from '../../lib/measurements'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { useFloorplanRender } from './floorplan-render-context'
import {
  beginRoomBoundaryInteraction,
  closestRoomBoundaryTargets,
  createRoomBoundaryWallIds,
  type RoomBoundaryBendOrder,
  type RoomBoundaryConnectMode,
  type RoomBoundaryTargetHit,
} from './room-boundary-interaction'

export function RoomBoundaryConnect() {
  const scope = useInteractionScope((s) => s.scope)
  const levelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((s) => s.metricNotation)
  const nodes = useScene((s) => s.nodes)
  const readOnly = useScene((s) => s.readOnly)
  const viewMode = useEditor((s) => s.viewMode)
  const mode = useEditor((s) => s.mode)
  const tool = useEditor((s) => s.tool)
  const render = useFloorplanRender()
  const [draft, setDraft] = useState<{
    input: ManualRoomBoundaryInput
    plan: ManualRoomBoundaryPlan
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)
  const [choices, setChoices] = useState<RoomBoundaryTargetHit[]>([])
  const [connectionMode, setConnectionMode] = useState<RoomBoundaryConnectMode>('direct')
  const [bendOrder, setBendOrder] = useState<RoomBoundaryBendOrder>('horizontal-vertical')
  const [selectedTarget, setSelectedTarget] = useState<{
    wallId: WallNode['id']
    endpoint?: 'start' | 'end'
    targetPoint: [number, number]
  } | null>(null)
  const lWallIds = useRef<[WallNode['id'], WallNode['id']] | null>(null)
  const owned = useRef<AnyNodeId[]>([])
  const active =
    scope.kind === 'reshaping' &&
    (scope.intent === 'boundary-connect' || scope.intent === 'boundary-move') &&
    scope.endpoint !== undefined
  const connecting = active && scope.intent === 'boundary-connect'
  const sourceId = active ? scope.nodeId : null
  const endpoint = active ? scope.endpoint : undefined
  const identity = active ? `${sourceId}:${endpoint}` : null
  const context = useRef<{
    identity: string | null
    levelId: typeof levelId
    viewMode: typeof viewMode
    tool: typeof tool
  } | null>(null)

  const clearPreview = useCallback(() => {
    for (const id of owned.current) {
      useLiveNodeOverrides.getState().clear(id)
      useScene.getState().markDirty(id)
    }
    owned.current = []
  }, [])
  const cancel = useCallback(() => {
    clearPreview()
    setDraft(null)
    setChoices([])
    setError(null)
    setSelectedTarget(null)
    lWallIds.current = null
    useInteractionScope
      .getState()
      .endIf(
        (s) =>
          s.kind === 'reshaping' &&
          (s.intent === 'boundary-connect' || s.intent === 'boundary-move'),
      )
  }, [clearPreview])

  const replan = useCallback(
    (
      target = selectedTarget,
      nextMode: RoomBoundaryConnectMode = connectionMode,
      nextBendOrder: RoomBoundaryBendOrder = bendOrder,
    ) => {
      if (!target || !levelId || !sourceId || !endpoint) return
      const scene = useScene.getState()
      if (scene.readOnly) return cancel()
      let createdWallIds: [WallNode['id'], WallNode['id']] | undefined
      if (nextMode === 'l-corner') {
        if (!lWallIds.current) lWallIds.current = createRoomBoundaryWallIds()
        createdWallIds = lWallIds.current
      }
      const input: ManualRoomBoundaryInput = {
        levelId,
        wallId: sourceId as WallNode['id'],
        endpoint,
        targetWallId: target.wallId,
        ...(target.endpoint ? { targetEndpoint: target.endpoint } : {}),
        ...(nextMode === 'l-corner' ? { targetPoint: target.targetPoint } : {}),
        mode: nextMode as ManualRoomBoundaryMode,
        bendOrder: nextBendOrder as ManualRoomBoundaryBendOrder,
        ...(createdWallIds ? { createdWallIds } : {}),
      }
      clearPreview()
      const plan = buildManualRoomBoundaryRepair(scene.nodes, input)
      if (!plan.ok) {
        setError(plan.message ?? '연결할 수 없습니다.')
        setDraft(null)
        return
      }
      for (const update of plan.updates) {
        useLiveNodeOverrides.getState().set(update.id, update.data)
        scene.markDirty(update.id)
      }
      owned.current = plan.updates.map((update) => update.id)
      setError(null)
      setDraft({ input: { ...input, expectedSnapshot: plan.snapshot }, plan })
    },
    [bendOrder, cancel, clearPreview, connectionMode, endpoint, levelId, selectedTarget, sourceId],
  )

  useEffect(() => {
    if (!active || context.current?.identity !== identity) {
      clearPreview()
      setDraft(null)
      setChoices([])
      setError(null)
      setSelectedTarget(null)
      lWallIds.current = active ? createRoomBoundaryWallIds() : null
      setConnectionMode('direct')
      setBendOrder('horizontal-vertical')
      context.current = active ? { identity, levelId, viewMode, tool } : null
    }
    if (!active) return
    if (
      (context.current &&
        (context.current.levelId !== levelId ||
          context.current.viewMode !== viewMode ||
          context.current.tool !== tool)) ||
      readOnly ||
      viewMode === '3d' ||
      mode !== 'select' ||
      !sourceId ||
      nodes[sourceId as AnyNodeId]?.parentId !== levelId
    )
      cancel()
  }, [
    readOnly,
    viewMode,
    mode,
    tool,
    levelId,
    sourceId,
    nodes,
    active,
    identity,
    cancel,
    clearPreview,
  ])

  useEffect(() => {
    if (!active) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        cancel()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, cancel])

  useEffect(() => {
    if (!draft || !levelId || !active) return
    if (roomBoundarySnapshot(nodes, levelId) !== draft.plan.snapshot) {
      clearPreview()
      setDraft(null)
      setError('벽 또는 부착물이 변경되었습니다. 대상을 다시 선택하세요.')
    }
  }, [nodes, draft, levelId, active, clearPreview])

  useEffect(
    () => () => {
      clearPreview()
      useInteractionScope
        .getState()
        .endIf(
          (s) =>
            s.kind === 'reshaping' &&
            (s.intent === 'boundary-connect' || s.intent === 'boundary-move'),
        )
    },
    [clearPreview],
  )

  if (!active || !levelId || !endpoint || !sourceId || readOnly) return null
  const walls = Object.values(nodes).filter(
    (node): node is WallNode =>
      node.type === 'wall' && node.parentId === levelId && node.id !== sourceId,
  )
  const selectTarget = (
    targetWallId: WallNode['id'],
    targetEndpoint?: 'start' | 'end',
    projectedTargetPoint?: [number, number],
  ) => {
    setChoices([])
    const scene = useScene.getState()
    if (scene.readOnly) return cancel()
    const target = scene.nodes[targetWallId]
    if (target?.type !== 'wall') return
    const nextTarget = {
      wallId: targetWallId,
      ...(targetEndpoint ? { endpoint: targetEndpoint } : {}),
      targetPoint: targetEndpoint
        ? ([...target[targetEndpoint]] as [number, number])
        : (projectedTargetPoint ?? ([...target.start] as [number, number])),
    }
    setSelectedTarget(nextTarget)
    replan(nextTarget)
  }
  const apply = () => {
    if (!draft) return
    const scene = useScene.getState()
    if (scene.readOnly) return cancel()
    const plan = buildManualRoomBoundaryRepair(scene.nodes, draft.input)
    clearPreview()
    if (
      !plan.ok ||
      JSON.stringify(plan.updates) !== JSON.stringify(draft.plan.updates) ||
      JSON.stringify(plan.creates) !== JSON.stringify(draft.plan.creates)
    ) {
      setDraft(null)
      setError(plan.message ?? '미리보기가 변경되었습니다. 대상을 다시 선택하세요.')
      return
    }
    runAsSingleSceneHistoryStep(useScene, () =>
      useScene.getState().applyNodeChanges({
        create: plan.creates.map((node) => ({ node, parentId: levelId })),
        update: plan.updates,
      }),
    )
    cancel()
  }
  const replanSelected = () => replan()
  const chooseMode = (nextMode: RoomBoundaryConnectMode) => {
    setConnectionMode(nextMode)
    replan(selectedTarget, nextMode, bendOrder)
  }
  const chooseBendOrder = (nextOrder: RoomBoundaryBendOrder) => {
    setBendOrder(nextOrder)
    replan(selectedTarget, connectionMode, nextOrder)
  }
  const scale = render?.unitsPerPixel ?? 0.01
  const wallLabel = (id: string, fallback: string) => nodes[id as AnyNodeId]?.name || fallback
  const sourceLabel = wallLabel(sourceId, '출발 벽')
  const targetLabel = selectedTarget ? wallLabel(selectedTarget.wallId, '대상 벽') : ''
  const wallCoordinates = (id: WallNode['id']) => {
    const wall = nodes[id]
    if (wall?.type !== 'wall') return ''
    const point = (value: readonly [number, number]) =>
      value.map((axis) => formatLinearMeasurement(axis, unit, metricNotation)).join(', ')
    return `시작 (${point(wall.start)}) → 끝 (${point(wall.end)})`
  }
  return (
    <>
      {connecting ? (
        <g
          data-testid="room-boundary-targets"
          onClick={(event) => {
            event.stopPropagation()
            const point = clientToPlan(event.clientX, event.clientY)
            if (!point) return
            const hits = closestRoomBoundaryTargets(walls, point, scale)
            if (hits.length === 1)
              selectTarget(hits[0]!.wallId, hits[0]!.endpoint, hits[0]!.targetPoint)
            else if (hits.length > 1) {
              clearPreview()
              setDraft(null)
              setError(null)
              setChoices(hits)
            }
          }}
          onPointerMove={(event) => {
            const point = clientToPlan(event.clientX, event.clientY)
            const hits = point ? closestRoomBoundaryTargets(walls, point, scale) : []
            setHovered(hits.length === 1 ? hits[0]!.wallId : null)
          }}
          onPointerLeave={() => setHovered(null)}
        >
          {walls.map((wall) => (
            <g key={wall.id}>
              <line
                data-testid={`room-boundary-target-${wall.id}`}
                x1={wall.start[0]}
                y1={wall.start[1]}
                x2={wall.end[0]}
                y2={wall.end[1]}
                stroke={hovered === wall.id ? '#06b6d4' : 'transparent'}
                strokeWidth={18 * scale}
                strokeOpacity={0.5}
                style={{ cursor: 'crosshair' }}
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
              />
              {(['start', 'end'] as const).map((end) => (
                <circle
                  key={end}
                  data-testid={`room-boundary-target-${wall.id}-${end}`}
                  cx={wall[end][0]}
                  cy={wall[end][1]}
                  r={7 * scale}
                  fill={hovered === wall.id ? '#06b6d4' : 'transparent'}
                  fillOpacity={0.5}
                  style={{ cursor: 'crosshair' }}
                  onPointerDown={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                />
              ))}
            </g>
          ))}
          {draft?.plan.movements.map((move) => (
            <line
              key={`${move.wallId}:${move.endpoint}`}
              data-testid="room-boundary-extension-preview"
              x1={move.from[0]}
              y1={move.from[1]}
              x2={move.to[0]}
              y2={move.to[1]}
              stroke="#06b6d4"
              strokeWidth={4 * scale}
              strokeDasharray={`${4 * scale} ${3 * scale}`}
              pointerEvents="none"
            />
          ))}
          {draft?.plan.creates.map((wall) => (
            <line
              key={wall.id}
              data-testid="room-boundary-l-preview"
              data-wall-id={wall.id}
              x1={wall.start[0]}
              y1={wall.start[1]}
              x2={wall.end[0]}
              y2={wall.end[1]}
              stroke="#f59e0b"
              strokeWidth={Math.max(getWallThickness(wall), 4 * scale)}
              strokeDasharray={`${6 * scale} ${4 * scale}`}
              strokeLinecap="round"
              pointerEvents="none"
            />
          ))}
        </g>
      ) : null}
      {typeof document !== 'undefined'
        ? createPortal(
            <div
              data-testid="room-boundary-connect-panel"
              role="dialog"
              aria-label={connecting ? '수동 벽 연결' : '끝점 이동'}
              className="fixed bottom-24 left-1/2 z-[100] w-80 max-w-[90vw] -translate-x-1/2 rounded-xl border border-border bg-background p-3 text-xs text-foreground shadow-xl"
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="font-semibold">{connecting ? '수동 벽 연결' : '끝점 이동'}</div>
              <div className="mt-1 text-muted-foreground">
                {sourceLabel} · 끝점({endpoint === 'start' ? '시작' : '끝'})
              </div>
              <div className="mt-2">
                {connecting
                  ? selectedTarget
                    ? `대상: ${targetLabel}`
                    : '대상 벽 또는 끝점을 선택하세요'
                  : '노란 끝점을 드래그하세요. Esc로 취소합니다.'}
              </div>
              {connecting ? (
                <div className="mt-3 space-y-2" data-testid="room-boundary-connect-controls">
                  <div className="font-medium">연결 방식</div>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      data-testid="room-boundary-connect-mode-direct"
                      aria-pressed={connectionMode === 'direct'}
                      className="rounded border px-2 py-1 aria-pressed:bg-muted"
                      onClick={() => chooseMode('direct')}
                    >
                      직선 연결
                    </button>
                    <button
                      type="button"
                      data-testid="room-boundary-connect-mode-l"
                      aria-pressed={connectionMode === 'l-corner'}
                      className="rounded border px-2 py-1 aria-pressed:bg-muted"
                      onClick={() => chooseMode('l-corner')}
                    >
                      ㄱ자 연결
                    </button>
                  </div>
                  {connectionMode === 'l-corner' ? (
                    <div className="space-y-1" data-testid="room-boundary-connect-bends">
                      <div className="font-medium">꺾임 순서</div>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          data-testid="room-boundary-connect-bend-horizontal-vertical"
                          aria-pressed={bendOrder === 'horizontal-vertical'}
                          className="rounded border px-2 py-1 aria-pressed:bg-muted"
                          onClick={() => chooseBendOrder('horizontal-vertical')}
                        >
                          가로 → 세로
                        </button>
                        <button
                          type="button"
                          data-testid="room-boundary-connect-bend-vertical-horizontal"
                          aria-pressed={bendOrder === 'vertical-horizontal'}
                          className="rounded border px-2 py-1 aria-pressed:bg-muted"
                          onClick={() => chooseBendOrder('vertical-horizontal')}
                        >
                          세로 → 가로
                        </button>
                      </div>
                    </div>
                  ) : null}
                  <button
                    type="button"
                    data-testid="room-boundary-connect-replan"
                    className="rounded border px-2 py-1 disabled:opacity-40"
                    disabled={!selectedTarget}
                    onClick={replanSelected}
                  >
                    대상 다시 계산
                  </button>
                </div>
              ) : null}
              {choices.length > 1 ? (
                <div
                  className="mt-2 flex flex-col gap-1"
                  data-testid="room-boundary-target-choices"
                >
                  <div>같은 위치의 대상이 여러 개입니다. 연결할 벽을 선택하세요.</div>
                  {choices.map((choice, index) => (
                    <button
                      key={choice.wallId}
                      type="button"
                      data-target-wall-id={choice.wallId}
                      className="rounded border px-2 py-1 text-left"
                      onClick={() =>
                        selectTarget(choice.wallId, choice.endpoint, choice.targetPoint)
                      }
                    >
                      {wallLabel(choice.wallId, `대상 벽 ${index + 1}`)}
                      <span className="block text-muted-foreground">
                        {wallCoordinates(choice.wallId)}
                      </span>
                      {choice.endpoint
                        ? ` · 끝점(${choice.endpoint === 'start' ? '시작' : '끝'})`
                        : ''}
                    </button>
                  ))}
                </div>
              ) : null}
              {draft?.plan.movements.map((move) => (
                <div key={`${move.wallId}:${move.endpoint}`}>
                  {wallLabel(move.wallId, move.wallId === sourceId ? '출발 벽' : '대상 벽')} ·{' '}
                  {formatLinearMeasurement(move.distance, unit, metricNotation)} 연장/조정
                </div>
              ))}
              {draft?.plan.measurements.map((measurement) => (
                <div key={measurement.wallId} data-testid="room-boundary-l-measurement">
                  {measurement.leg}번째 변 ·{' '}
                  {formatLinearMeasurement(measurement.distance, unit, metricNotation)}
                </div>
              ))}
              {error ? (
                <div
                  role="alert"
                  data-testid="room-boundary-connect-error"
                  className="mt-2 text-red-600"
                >
                  {error}
                </div>
              ) : null}
              <div className="mt-3 flex gap-2">
                {connecting ? (
                  <button
                    type="button"
                    data-testid="room-boundary-connect-apply"
                    className="rounded border px-3 py-2 disabled:opacity-40"
                    disabled={!draft}
                    onClick={apply}
                  >
                    연결 적용
                  </button>
                ) : null}
                <button type="button" className="rounded border px-3 py-2" onClick={cancel}>
                  취소
                </button>
                {connecting ? (
                  <button
                    type="button"
                    className="rounded border px-3 py-2"
                    onClick={() => {
                      cancel()
                      beginRoomBoundaryInteraction(
                        sourceId as WallNode['id'],
                        endpoint,
                        'boundary-move',
                      )
                    }}
                  >
                    끝점 이동
                  </button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

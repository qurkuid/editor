'use client'

import {
  diagnoseRoomBoundaries,
  type LevelNode,
  type RoomBoundaryCandidate,
  type RoomBoundaryDiagnostics,
  type RoomBoundaryEndpoint,
  type RoomBoundaryIssue,
  useScene,
  type WallNode,
  type ZoneNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import {
  type KeyboardEvent,
  type MouseEvent,
  memo,
  type PointerEvent,
  useMemo,
  useRef,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import { formatLinearMeasurement } from '../../lib/measurements'
import useEditor from '../../store/use-editor'
import useInteractionScope from '../../store/use-interaction-scope'
import { useFloorplanRender } from './floorplan-render-context'
import { RoomBoundaryConnect } from './room-boundary-connect'
import { beginRoomBoundaryInteraction } from './room-boundary-interaction'

export const ROOM_BOUNDARY_REPAIRABLE_COLOR = '#dc2626'
export const ROOM_BOUNDARY_MANUAL_COLOR = '#f59e0b'

export type RoomBoundaryOverlayEntry = {
  endpoint: RoomBoundaryEndpoint
  issue?: RoomBoundaryIssue
  candidate?: RoomBoundaryCandidate
  status: 'repairable' | 'manual'
}

function endpointKey(endpoint: Pick<RoomBoundaryEndpoint, 'wallId' | 'endpoint'>) {
  return `${endpoint.wallId}:${endpoint.endpoint}`
}

/** Pick the single candidate shown by the 2D overlay for one dangling endpoint. */
export function selectBestRoomBoundaryCandidate(
  issue: Pick<RoomBoundaryIssue, 'candidates'>,
): RoomBoundaryCandidate | undefined {
  return issue.candidates.find((candidate) => candidate.safe) ?? issue.candidates[0]
}

/**
 * Keep the overlay deliberately sparse: one marker for every dangling endpoint
 * and at most one candidate segment for each marker. The panel can still show
 * all candidate reasons without turning the floor plan into a spider web.
 */
export function buildRoomBoundaryOverlayEntries(
  diagnostics: Pick<RoomBoundaryDiagnostics, 'danglingEndpoints' | 'issues'>,
  repairableIssueIds?: ReadonlySet<string>,
): RoomBoundaryOverlayEntry[] {
  const issuesByEndpoint = new Map(
    diagnostics.issues.map((issue) => [endpointKey(issue), issue] as const),
  )

  return diagnostics.danglingEndpoints.map((endpoint) => {
    const issue = issuesByEndpoint.get(endpointKey(endpoint))
    const candidate = issue ? selectBestRoomBoundaryCandidate(issue) : undefined
    return {
      endpoint,
      issue,
      candidate,
      status:
        candidate?.safe || (issue !== undefined && repairableIssueIds?.has(issue.id) === true)
          ? 'repairable'
          : 'manual',
    }
  })
}

const EMPTY_WALLS: WallNode[] = []
const EMPTY_ZONES: ZoneNode[] = []

function useLevelWalls(levelId: LevelNode['id'] | null): WallNode[] {
  return useScene(
    useShallow((state) => {
      if (!levelId) return EMPTY_WALLS
      const level = state.nodes[levelId]
      if (level?.type !== 'level') return EMPTY_WALLS
      return level.children
        .map((childId) => state.nodes[childId])
        .filter((node): node is WallNode => node?.type === 'wall')
    }),
  )
}

function useLevelZones(levelId: LevelNode['id'] | null): ZoneNode[] {
  return useScene(
    useShallow((state) => {
      if (!levelId) return EMPTY_ZONES
      const level = state.nodes[levelId]
      if (level?.type !== 'level') return EMPTY_ZONES
      return level.children
        .map((childId) => state.nodes[childId])
        .filter((node): node is ZoneNode => node?.type === 'zone')
    }),
  )
}

type MarkerPointerState = { current: { x: number; y: number; dragged: boolean } | null }

export function roomBoundaryMarkerPointerHandlers(
  pending: MarkerPointerState,
  onDrag?: (event: PointerEvent<SVGGElement>) => void,
) {
  return {
    onPointerDown(event: PointerEvent<SVGGElement>) {
      event.stopPropagation()
      if (event.button !== 0) return
      pending.current = { x: event.clientX, y: event.clientY, dragged: false }
      event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    onPointerMove(event: PointerEvent<SVGGElement>) {
      const start = pending.current
      if (
        !start ||
        start.dragged ||
        !onDrag ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4
      )
        return
      start.dragged = true
      onDrag({
        ...event,
        button: 0,
        clientX: start.x,
        clientY: start.y,
        preventDefault: () => event.preventDefault(),
        // The registry must also receive this move after taking ownership.
        stopPropagation: () => {},
      })
    },
    onPointerUp(event: PointerEvent<SVGGElement>) {
      if (!pending.current?.dragged) event.stopPropagation()
    },
  }
}

export function RoomBoundaryMarker({
  entry,
  metricNotation,
  onActivate,
  onEndpointDrag,
  sceneRotationDeg,
  unit,
  unitsPerPixel,
}: {
  entry: RoomBoundaryOverlayEntry
  metricNotation: Parameters<typeof formatLinearMeasurement>[2]
  onActivate: (
    event: MouseEvent<SVGGElement> | KeyboardEvent<SVGGElement>,
    wallId: WallNode['id'],
  ) => void
  onEndpointDrag?: (endpoint: RoomBoundaryEndpoint, event: PointerEvent<SVGGElement>) => void
  sceneRotationDeg: number
  unit: Parameters<typeof formatLinearMeasurement>[1]
  unitsPerPixel: number
}) {
  const pending = useRef<{ x: number; y: number; dragged: boolean } | null>(null)
  const color = entry.issue?.reviewedOpen
    ? '#16a34a'
    : entry.status === 'repairable'
      ? ROOM_BOUNDARY_REPAIRABLE_COLOR
      : ROOM_BOUNDARY_MANUAL_COLOR
  const [x, z] = entry.endpoint.point
  const candidate = entry.candidate
  const target = candidate?.targetPoint
  const candidateDistance = candidate?.distance ?? Number.NaN
  const hasGap =
    target !== undefined &&
    Number.isFinite(candidateDistance) &&
    candidateDistance > 1e-6 &&
    (target[0] !== x || target[1] !== z)

  const markerRadius = 6 * unitsPerPixel
  const stroke = 1.5 * unitsPerPixel
  const dash = `${4 * unitsPerPixel} ${3 * unitsPerPixel}`
  const labelFontSize = 10 * unitsPerPixel
  const labelX = hasGap && target ? (x + target[0]) / 2 : x
  const labelZ = hasGap && target ? (z + target[1]) / 2 : z
  const dx = hasGap && target ? target[0] - x : 0
  const dz = hasGap && target ? target[1] - z : 0
  const gapLength = Math.hypot(dx, dz)
  const offset = gapLength > 1e-6 ? (8 * unitsPerPixel) / gapLength : 0
  const labelOffsetX = -dz * offset
  const labelOffsetZ = dx * offset
  const label =
    hasGap && candidate ? formatLinearMeasurement(candidateDistance, unit, metricNotation) : null
  const issueId = entry.issue?.id ?? endpointKey(entry.endpoint)

  const handleKeyDown = (event: KeyboardEvent<SVGGElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    onActivate(event, entry.endpoint.wallId)
  }

  return (
    <g
      aria-label={`벽 ${entry.endpoint.wallId} ${entry.endpoint.endpoint} 경계 점검`}
      className="group/room-boundary"
      data-room-boundary-status={entry.status}
      data-testid={`room-boundary-marker-${issueId}`}
      onClick={(event) => {
        if (pending.current?.dragged) {
          event.stopPropagation()
          pending.current = null
          return
        }
        onActivate(event, entry.endpoint.wallId)
      }}
      onKeyDown={handleKeyDown}
      {...roomBoundaryMarkerPointerHandlers(
        pending,
        onEndpointDrag ? (event) => onEndpointDrag(entry.endpoint, event) : undefined,
      )}
      role="button"
      style={{ outline: 'none' }}
      tabIndex={0}
    >
      <circle
        aria-hidden="true"
        className="hidden group-focus-visible/room-boundary:block"
        cx={x}
        cy={z}
        data-room-boundary-focus="true"
        fill="none"
        pointerEvents="none"
        r={9 * unitsPerPixel}
        stroke={color}
        strokeWidth={2 * unitsPerPixel}
        tabIndex={-1}
      />
      {hasGap && target ? (
        <line
          data-room-boundary-candidate="best"
          pointerEvents="none"
          stroke={color}
          strokeDasharray={dash}
          strokeWidth={stroke}
          x1={x}
          x2={target[0]}
          y1={z}
          y2={target[1]}
        />
      ) : null}
      <circle
        cx={x}
        cy={z}
        data-room-boundary-marker="endpoint"
        fill="#ffffff"
        fillOpacity={0.92}
        r={markerRadius}
        stroke={color}
        strokeWidth={stroke}
      />
      <circle cx={x} cy={z} fill={color} r={Math.max(unitsPerPixel, markerRadius * 0.28)} />
      {label ? (
        <g transform={`rotate(${-sceneRotationDeg} ${labelX} ${labelZ})`}>
          <text
            fill={color}
            fontFamily="-apple-system, system-ui, sans-serif"
            fontSize={labelFontSize}
            fontWeight={600}
            pointerEvents="none"
            textAnchor="middle"
            x={labelX + labelOffsetX}
            y={labelZ + labelOffsetZ + labelFontSize * 0.35}
          >
            {label}
          </text>
        </g>
      ) : null}
    </g>
  )
}

export const FloorplanZoneClosureLayer = memo(function FloorplanZoneClosureLayer({
  onEndpointDrag,
}: {
  onEndpointDrag?: (endpoint: RoomBoundaryEndpoint, event: PointerEvent<SVGGElement>) => void
}) {
  const scope = useInteractionScope((state) => state.scope)
  const readOnly = useScene((state) => state.readOnly)
  const levelId = useViewer((state) => state.selection.levelId)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const setSelection = useViewer((state) => state.setSelection)
  const setPhase = useEditor((state) => state.setPhase)
  const setMode = useEditor((state) => state.setMode)
  const setStructureLayer = useEditor((state) => state.setStructureLayer)
  const setActiveSidebarPanel = useEditor((state) => state.setActiveSidebarPanel)
  const renderContext = useFloorplanRender()
  const walls = useLevelWalls(levelId)
  const zones = useLevelZones(levelId)
  const diagnostics = useMemo(
    () => (levelId ? diagnoseRoomBoundaries(levelId, walls, zones) : null),
    [levelId, walls, zones],
  )
  const entries = useMemo(
    () => (diagnostics ? buildRoomBoundaryOverlayEntries(diagnostics) : []),
    [diagnostics],
  )

  if (!levelId || !diagnostics || entries.length === 0) return null

  const handleActivate = (
    event: MouseEvent<SVGGElement> | KeyboardEvent<SVGGElement>,
    wallId: WallNode['id'],
    endpoint: 'start' | 'end',
  ) => {
    event.preventDefault()
    event.stopPropagation()
    setPhase('structure')
    setStructureLayer('zones')
    setMode('select')
    setActiveSidebarPanel('site')
    setSelection({ selectedIds: [wallId], zoneId: null })
    if (!readOnly) beginRoomBoundaryInteraction(wallId, endpoint)
  }

  const unitsPerPixel = renderContext?.unitsPerPixel ?? 0.01
  const sceneRotationDeg = renderContext?.sceneRotationDeg ?? 0

  return (
    <g data-testid="floorplan-zone-closure-layer">
      {(scope.kind === 'reshaping' && scope.intent === 'boundary-connect' ? [] : entries).map(
        (entry) => (
          <RoomBoundaryMarker
            entry={entry}
            key={entry.issue?.id ?? endpointKey(entry.endpoint)}
            metricNotation={metricNotation}
            onActivate={(event, wallId) => handleActivate(event, wallId, entry.endpoint.endpoint)}
            onEndpointDrag={
              readOnly
                ? undefined
                : (endpoint, event) => {
                    useInteractionScope
                      .getState()
                      .endIf(
                        (current) =>
                          current.kind === 'reshaping' && current.intent === 'boundary-connect',
                      )
                    onEndpointDrag?.(endpoint, event)
                  }
            }
            sceneRotationDeg={sceneRotationDeg}
            unit={unit}
            unitsPerPixel={unitsPerPixel}
          />
        ),
      )}
      <RoomBoundaryConnect />
    </g>
  )
})

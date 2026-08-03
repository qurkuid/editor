'use client'

import { type AnyNodeId, BodyNode, createPlanarFaceBody } from '@pascal-app/core'
import {
  constrainPlanDraftPoint,
  type FloorplanToolContext,
  isGridSnapActive,
  markToolCancelConsumed,
  triggerSFX,
  useDraftLengthInput,
  useInteractionScope,
} from '@pascal-app/editor'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBodyToolOptions } from './options'
import {
  resolveBodyDraftFeedback,
  resolveCircleDraft,
  resolveLineFaceDraft,
  shouldCloseLineDraft,
} from './primitive-draft'
import { type BodyDraftPoint, resolveRectangleDraft } from './rectangle-draft'

const snap = (value: number, step: number) => (step > 0 ? Math.round(value / step) * step : value)
const CLOSE_TOLERANCE = 0.12

function clientToPlanPoint(
  group: SVGGElement,
  clientX: number,
  clientY: number,
): BodyDraftPoint | null {
  const matrix = group.getScreenCTM()
  if (!matrix) return null
  const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return [local.x, local.y]
}

export function FloorplanBodyToolLayer({
  activeLevelId,
  finishTool,
  gridSnapStep,
  sceneApi,
  selectNode,
}: FloorplanToolContext) {
  const primitive = useBodyToolOptions((state) => state.primitive)
  const groupRef = useRef<SVGGElement>(null)
  const pointsRef = useRef<BodyDraftPoint[]>([])
  const [points, setPoints] = useState<BodyDraftPoint[]>([])
  const [hover, setHover] = useState<BodyDraftPoint | null>(null)
  const { clear: clearLength, getLengthMeters } = useDraftLengthInput(
    () => pointsRef.current.length > 0,
  )
  const feedback = useMemo(() => resolveBodyDraftFeedback(points, hover), [hover, points])

  const updatePoints = useCallback((next: BodyDraftPoint[]) => {
    pointsRef.current = next
    setPoints(next)
  }, [])
  const polygon = useMemo(() => {
    if (!hover) return null
    const [first, second] = points
    if (primitive === 'rectangle' && first && second) {
      return resolveRectangleDraft(first, second, hover, getLengthMeters())
    }
    if (primitive === 'circle' && first && !second) {
      return resolveCircleDraft(first, hover, getLengthMeters())
    }
    return null
  }, [getLengthMeters, hover, points, primitive])

  useEffect(() => {
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'body' })
    return () =>
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'body')
  }, [])

  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(activeLevelId && group && svg)) return
    const previousCursor = svg.style.cursor
    svg.style.cursor = 'crosshair'
    updatePoints([])
    setHover(null)
    clearLength()
    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    const resolvePoint = (event: MouseEvent | PointerEvent): BodyDraftPoint | null => {
      const raw = clientToPlanPoint(group, event.clientX, event.clientY)
      if (!raw) return null
      const step = isGridSnapActive() ? gridSnapStep : 0
      const snapped: BodyDraftPoint = [snap(raw[0], step), snap(raw[1], step)]
      const anchor = pointsRef.current.at(-1)
      return anchor ? constrainPlanDraftPoint(anchor, snapped, getLengthMeters()) : snapped
    }
    const finish = (draft: readonly BodyDraftPoint[], name: string) => {
      const body = BodyNode.parse({
        ...createPlanarFaceBody(draft.map(([x, z]) => [x, 0, z])),
        name,
      })
      sceneApi.upsert(body, activeLevelId as AnyNodeId)
      selectNode(body.id)
      triggerSFX('sfx:structure-build')
      finishTool()
    }
    const onPointerMove = (event: PointerEvent) => {
      consume(event)
      setHover(resolvePoint(event))
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      consume(event)
      const point = resolvePoint(event)
      if (!point) return
      const current = pointsRef.current
      const first = current[0]
      const second = current[1]
      if (primitive === 'line') {
        if (current.length >= 3 && first && shouldCloseLineDraft(first, point, CLOSE_TOLERANCE)) {
          const lineFace = resolveLineFaceDraft(current)
          if (lineFace) finish(lineFace, 'Line Face')
          return
        }
        updatePoints([...current, point])
      } else if (primitive === 'circle') {
        if (current.length === 0) updatePoints([point])
        else if (first) {
          const circle = resolveCircleDraft(first, point, getLengthMeters())
          if (circle) finish(circle, 'Circle Face')
        }
      } else if (current.length < 2) updatePoints([...current, point])
      else if (first && second) {
        const rectangle = resolveRectangleDraft(first, second, point, getLengthMeters())
        if (rectangle) finish(rectangle, 'Rectangle Face')
      }
      clearLength()
      if (current.length === 0) triggerSFX('sfx:structure-build-start')
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && primitive === 'line') {
        const lineFace = resolveLineFaceDraft(pointsRef.current)
        if (lineFace) finish(lineFace, 'Line Face')
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      markToolCancelConsumed()
      if (pointsRef.current.length > 0) updatePoints(pointsRef.current.slice(0, -1))
      else finishTool()
      clearLength()
    }
    svg.addEventListener('pointermove', onPointerMove, true)
    svg.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      if (svg.style.cursor === 'crosshair') svg.style.cursor = previousCursor
      svg.removeEventListener('pointermove', onPointerMove, true)
      svg.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [
    activeLevelId,
    clearLength,
    finishTool,
    getLengthMeters,
    gridSnapStep,
    primitive,
    sceneApi,
    selectNode,
    updatePoints,
  ])

  return (
    <g ref={groupRef}>
      {feedback.path.length > 1 ? (
        <polyline
          fill="none"
          points={feedback.path.map((point) => point.join(',')).join(' ')}
          pointerEvents="none"
          stroke="#0284c7"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {polygon ? (
        <polygon
          fill="#38bdf8"
          fillOpacity={0.24}
          points={polygon.map((point) => point.join(',')).join(' ')}
          pointerEvents="none"
          stroke="#0284c7"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {feedback.committed.map((point, index) => (
        <circle
          cx={point[0]}
          cy={point[1]}
          fill={index === 0 ? '#22c55e' : '#0284c7'}
          key={`${point[0]}:${point[1]}:${index}`}
          pointerEvents="none"
          r={index === 0 ? 0.1 : 0.07}
          stroke="#f8fafc"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {feedback.cursor ? (
        <circle
          cx={feedback.cursor[0]}
          cy={feedback.cursor[1]}
          fill="#0ea5e9"
          fillOpacity={0.3}
          pointerEvents="none"
          r={0.1}
          stroke="#0ea5e9"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </g>
  )
}

export default FloorplanBodyToolLayer

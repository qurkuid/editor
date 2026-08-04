'use client'

import { useEffect, useRef } from 'react'
import { PIVOT_ROTATE_AXIS_COLORS } from '../../lib/pivot-rotate-math'
import usePivotRotate from '../../store/use-pivot-rotate'
import { formatAngleRadians } from '../tools/shared/segment-angle'
import { useFloorplanRender } from './floorplan-render-context'

// 2D presentation of the pivot-rotate gesture (bottom-menu Rotate). The
// shared `usePivotRotate` store owns the state machine and every scene
// effect; this layer converts SVG pointer input into level-frame plan points
// and draws the protractor chrome (pivot marker, reference arm, swept arc)
// in the active axis color. The rotating nodes themselves preview through
// `useLiveNodeOverrides`, which the registry layer already merges.

const CLICK_MAX_DRIFT_PX = 5
const ARC_SEGMENTS = 48

type PlanPoint = { x: number; z: number }

function clientToPlanPoint(group: SVGGElement, clientX: number, clientY: number): PlanPoint | null {
  const matrix = group.getScreenCTM()
  if (!matrix) return null
  const local = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse())
  return { x: local.x, z: local.y }
}

export function FloorplanPivotRotateLayer() {
  const stage = usePivotRotate((s) => s.stage)
  if (stage === 'idle') return null
  return <FloorplanPivotRotateLayerInner />
}

function FloorplanPivotRotateLayerInner() {
  const stage = usePivotRotate((s) => s.stage)
  const pivot = usePivotRotate((s) => s.pivot)
  const reference = usePivotRotate((s) => s.reference)
  const cursor = usePivotRotate((s) => s.cursor)
  const delta = usePivotRotate((s) => s.delta)
  const typedDigits = usePivotRotate((s) => s.typedDigits)
  const axis = usePivotRotate((s) => s.axis)
  const horizontalAxesAllowed = usePivotRotate((s) => s.horizontalAxesAllowed)
  const renderContext = useFloorplanRender()
  const groupRef = useRef<SVGGElement>(null)
  const accent = PIVOT_ROTATE_AXIS_COLORS[axis]

  useEffect(() => {
    const group = groupRef.current
    const svg = group?.ownerSVGElement
    if (!(group && svg)) return

    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }

    let down: { x: number; y: number } | null = null

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      consume(event)
      down = { x: event.clientX, y: event.clientY }
    }
    const onPointerMove = (event: PointerEvent) => {
      const plan = clientToPlanPoint(group, event.clientX, event.clientY)
      if (plan) usePivotRotate.getState().updateCursor(plan, event.altKey)
    }
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      consume(event)
      const start = down
      down = null
      if (
        !start ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_MAX_DRIFT_PX
      )
        return
      const plan = clientToPlanPoint(group, event.clientX, event.clientY)
      if (plan) usePivotRotate.getState().placePoint(plan)
    }

    svg.addEventListener('pointerdown', onPointerDown, true)
    svg.addEventListener('pointermove', onPointerMove, true)
    svg.addEventListener('pointerup', onPointerUp, true)
    svg.addEventListener('click', consume, true)
    svg.addEventListener('dblclick', consume, true)
    return () => {
      svg.removeEventListener('pointerdown', onPointerDown, true)
      svg.removeEventListener('pointermove', onPointerMove, true)
      svg.removeEventListener('pointerup', onPointerUp, true)
      svg.removeEventListener('click', consume, true)
      svg.removeEventListener('dblclick', consume, true)
    }
  }, [])

  const unitsPerPixel = renderContext?.unitsPerPixel ?? 0.01
  const sceneRotationDeg = renderContext?.sceneRotationDeg ?? 0
  const markerRadius = 5 * unitsPerPixel
  const labelFontSize = 12 * unitsPerPixel

  const arm = stage === 'reference' ? cursor : reference
  const armLength = pivot && arm ? Math.hypot(arm.x - pivot.x, arm.z - pivot.z) : 0
  const arcRadius = Math.max(Math.min(armLength * 0.6, armLength), 24 * unitsPerPixel)

  let arcPoints = ''
  let labelPos: PlanPoint | null = null
  if (stage === 'angle' && pivot && reference && Math.abs(delta) > 1e-4) {
    const startAngle = Math.atan2(reference.z - pivot.z, reference.x - pivot.x)
    const points: string[] = []
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
      const angle = startAngle + (delta * i) / ARC_SEGMENTS
      points.push(
        `${pivot.x + Math.cos(angle) * arcRadius},${pivot.z + Math.sin(angle) * arcRadius}`,
      )
    }
    arcPoints = points.join(' ')
    const midAngle = startAngle + delta / 2
    const labelRadius = arcRadius + 18 * unitsPerPixel
    labelPos = {
      x: pivot.x + Math.cos(midAngle) * labelRadius,
      z: pivot.z + Math.sin(midAngle) * labelRadius,
    }
  }

  // Display convention matches the typed-angle sign: screen-CCW positive.
  // The axis letter shows only when arrows can actually switch it.
  const axisPrefix = horizontalAxesAllowed ? `${axis.toUpperCase()} ` : ''
  const labelText =
    axisPrefix + (typedDigits !== '' ? `${typedDigits}°` : formatAngleRadians(-delta))

  return (
    <g pointerEvents="none" ref={groupRef}>
      {pivot ? (
        <g>
          <circle
            cx={pivot.x}
            cy={pivot.z}
            fill="none"
            r={markerRadius}
            stroke={accent}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={pivot.x} cy={pivot.z} fill={accent} r={markerRadius * 0.35} />
        </g>
      ) : null}
      {pivot && arm ? (
        <line
          stroke={accent}
          strokeDasharray="6 5"
          strokeOpacity={0.85}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          x1={pivot.x}
          x2={arm.x}
          y1={pivot.z}
          y2={arm.z}
        />
      ) : null}
      {stage === 'angle' && pivot && cursor ? (
        <line
          stroke={accent}
          strokeOpacity={0.95}
          strokeWidth={1.75}
          vectorEffect="non-scaling-stroke"
          x1={pivot.x}
          x2={cursor.x}
          y1={pivot.z}
          y2={cursor.z}
        />
      ) : null}
      {arcPoints ? (
        <polyline
          fill="none"
          points={arcPoints}
          stroke={accent}
          strokeOpacity={0.95}
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
      {stage === 'angle' && pivot && (labelPos || typedDigits !== '') ? (
        <text
          dominantBaseline="central"
          fill={accent}
          fontSize={labelFontSize}
          fontWeight="700"
          paintOrder="stroke"
          stroke="rgba(15, 23, 42, 0.75)"
          strokeWidth={3 * unitsPerPixel}
          textAnchor="middle"
          transform={`rotate(${-sceneRotationDeg} ${(labelPos ?? pivot).x} ${(labelPos ?? pivot).z})`}
          x={(labelPos ?? pivot).x}
          y={(labelPos ?? pivot).z - (labelPos ? 0 : 24 * unitsPerPixel)}
        >
          {labelText}
        </text>
      ) : null}
    </g>
  )
}

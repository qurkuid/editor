'use client'

import { emitter, LightingFixtureNode } from '@pascal-app/core'
import {
  constrainPlanDraftPoint,
  type FloorplanToolContext,
  getContinuation,
  isGridSnapActive,
  markToolCancelConsumed,
  triggerSFX,
  useDraftLengthInput,
} from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import { useLightingToolOptions } from '../lighting/options'
import {
  LINEAR_LIGHT_MIN_LENGTH,
  resolveLightingCommitPoint,
  resolveLightingGridPoint,
  resolveLinearLightSegment,
} from '../lighting/placement'

export default function FloorplanLightingFixtureTool({
  activeLevelId,
  finishTool,
  gridSnapStep,
  sceneApi,
  selectNode,
}: FloorplanToolContext) {
  const lightType = useLightingToolOptions((state) => state.lightType)
  const circuitId = useLightingToolOptions((state) => state.circuitId)
  const fixtureHeight = useLightingToolOptions((state) => state.fixtureHeight)
  const ref = useRef<SVGGElement>(null)
  const pointRef = useRef<[number, number] | null>(null)
  const [point, setPoint] = useState<[number, number] | null>(null)
  // Two-click wall-style draft, only entered for `lightType === 'linear'` —
  // mirrors the 3D tool's FSM: refs are the truth the handlers read,
  // `linearEnd` exists purely to trigger the re-render that redraws the
  // segment preview.
  const draftingRef = useRef(false)
  const startRef = useRef<[number, number] | null>(null)
  const [linearEnd, setLinearEnd] = useState<[number, number] | null>(null)
  const {
    raw,
    clear: clearDraftLength,
    getLengthMeters,
  } = useDraftLengthInput(() => lightType === 'linear' && draftingRef.current)

  // A typed length changes `raw` without a new pointer event — replay it
  // against the last known cursor point so the segment preview (and the
  // point that will commit) reflects the digits as they're typed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: raw is read through getLengthMeters(), not referenced directly — it's an intentional re-run trigger, not a value the effect body needs listed a second time.
  useEffect(() => {
    if (!(draftingRef.current && startRef.current && pointRef.current)) return
    setLinearEnd(constrainPlanDraftPoint(startRef.current, pointRef.current, getLengthMeters()))
  }, [raw, getLengthMeters])

  useEffect(() => {
    const group = ref.current
    const svg = group?.ownerSVGElement
    if (!(activeLevelId && group && svg)) return
    const resolve = (event: MouseEvent | PointerEvent): [number, number] | null => {
      const matrix = group.getScreenCTM()
      if (!matrix) return null
      const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      return resolveLightingGridPoint([local.x, local.y], gridSnapStep, isGridSnapActive())
    }
    const stop = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    const onMove = (event: PointerEvent) => {
      stop(event)
      const next = resolve(event)
      pointRef.current = next
      if (lightType === 'linear' && draftingRef.current && startRef.current && next) {
        setLinearEnd(constrainPlanDraftPoint(startRef.current, next, getLengthMeters()))
      } else {
        setPoint(next)
      }
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      stop(event)
      const snapshot = pointRef.current
      const fresh = snapshot ? null : resolve(event)
      if (!snapshot && !fresh) return
      const resolved = resolveLightingCommitPoint(snapshot, () => fresh as [number, number])

      if (lightType === 'linear') {
        if (!draftingRef.current) {
          // Click 1: fix the start point and enter the draft.
          startRef.current = resolved
          draftingRef.current = true
          setLinearEnd(resolved)
          return
        }
        // Click 2: commit the segment.
        const start = startRef.current!
        const end = constrainPlanDraftPoint(start, resolved, getLengthMeters())
        const segment = resolveLinearLightSegment(start, end)
        if (segment.length < LINEAR_LIGHT_MIN_LENGTH) return
        const node = LightingFixtureNode.parse({
          name: 'Linear light',
          parentId: activeLevelId,
          position: [segment.position[0], fixtureHeight, segment.position[1]],
          rotation: [0, segment.rotationY, 0],
          lightType: 'linear',
          circuitId,
          start,
          end,
        })
        sceneApi.upsert(node, activeLevelId)
        selectNode(node.id)
        triggerSFX('sfx:structure-build')
        clearDraftLength()
        draftingRef.current = false
        startRef.current = null
        setLinearEnd(null)
        // Same continuation contract as the 3D tool — 2D/3D parity.
        if (getContinuation('point') !== 'repeat') {
          finishTool()
        }
        return
      }

      const [x, z] = resolved
      const node = LightingFixtureNode.parse({
        name: `${lightType[0]?.toUpperCase()}${lightType.slice(1)} light`,
        parentId: activeLevelId,
        position: [x, fixtureHeight, z],
        lightType,
        circuitId,
      })
      sceneApi.upsert(node, activeLevelId)
      selectNode(node.id)
      triggerSFX('sfx:structure-build')
      // Same continuation contract as the 3D tool — 2D/3D parity.
      if (getContinuation('point') !== 'repeat') {
        finishTool()
      }
    }
    const onCancel = () => {
      if (lightType === 'linear' && draftingRef.current) {
        markToolCancelConsumed()
        clearDraftLength()
        draftingRef.current = false
        startRef.current = null
        setLinearEnd(null)
      }
    }
    svg.addEventListener('pointermove', onMove, true)
    svg.addEventListener('click', onClick, true)
    emitter.on('tool:cancel', onCancel)
    return () => {
      svg.removeEventListener('pointermove', onMove, true)
      svg.removeEventListener('click', onClick, true)
      emitter.off('tool:cancel', onCancel)
      draftingRef.current = false
      startRef.current = null
      setLinearEnd(null)
    }
  }, [
    activeLevelId,
    circuitId,
    clearDraftLength,
    finishTool,
    fixtureHeight,
    getLengthMeters,
    gridSnapStep,
    lightType,
    sceneApi,
    selectNode,
  ])

  const draftStart = lightType === 'linear' ? startRef.current : null

  return (
    <g ref={ref}>
      {draftStart && linearEnd && (
        <g>
          <line
            stroke="#f59e0b"
            strokeWidth={0.05}
            x1={draftStart[0]}
            x2={linearEnd[0]}
            y1={draftStart[1]}
            y2={linearEnd[1]}
          />
          <circle
            cx={draftStart[0]}
            cy={draftStart[1]}
            fill="#fffbeb"
            r={0.05}
            stroke="#f59e0b"
            strokeWidth={0.015}
          />
          <circle
            cx={linearEnd[0]}
            cy={linearEnd[1]}
            fill="#fffbeb"
            r={0.05}
            stroke="#f59e0b"
            strokeWidth={0.015}
          />
        </g>
      )}
      {!draftStart && point && (
        <g transform={`translate(${point[0]} ${point[1]})`}>
          <circle fill="#fffbeb" r={0.16} stroke="#f59e0b" strokeWidth={0.025} />
          <path
            d="M -0.1 -0.1 L 0.1 0.1 M 0.1 -0.1 L -0.1 0.1"
            stroke="#f59e0b"
            strokeWidth={0.02}
          />
        </g>
      )}
    </g>
  )
}

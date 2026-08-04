'use client'

import { collectAlignmentAnchors, emitter, LightingFixtureNode, useScene } from '@pascal-app/core'
import {
  constrainPlanDraftPoint,
  type FloorplanToolContext,
  getContinuation,
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  triggerSFX,
  useAlignmentGuides,
  useDraftLengthInput,
} from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import { useLightingToolOptions } from '../lighting/options'
import {
  LINEAR_LIGHT_MIN_LENGTH,
  resolveLightingAlignedPoint,
  resolveLightingArrayPoints,
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
  const placement = useLightingToolOptions((state) => state.placement)
  const arrayCount = useLightingToolOptions((state) => state.arrayCount)
  const itemAsset = useLightingToolOptions((state) => state.itemAsset)
  // Point/spot runs share the linear fixture's two-click draft — 2D/3D parity.
  const arrayActive = placement === 'array' && (lightType === 'point' || lightType === 'spot')
  // A chosen catalog model rides on each committed fixture (point/spot only).
  const combinedAsset =
    itemAsset && (lightType === 'point' || lightType === 'spot') ? itemAsset : null
  const ref = useRef<SVGGElement>(null)
  const pointRef = useRef<[number, number] | null>(null)
  const [point, setPoint] = useState<[number, number] | null>(null)
  // Two-click wall-style draft, entered for `lightType === 'linear'` and for
  // point/spot array runs — mirrors the 3D tool's FSM: refs are the truth the
  // handlers read, `linearEnd` exists purely to trigger the re-render that
  // redraws the segment preview.
  const draftingRef = useRef(false)
  const startRef = useRef<[number, number] | null>(null)
  const [linearEnd, setLinearEnd] = useState<[number, number] | null>(null)
  const {
    raw,
    clear: clearDraftLength,
    getLengthMeters,
  } = useDraftLengthInput(() => (lightType === 'linear' || arrayActive) && draftingRef.current)

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
    // Alignment candidates — anchors of every alignable object on the active
    // level, refreshed after each fixture commits so a run of fixtures can
    // align to the ones already placed. 2D/3D parity with the 3D tool.
    let alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '', activeLevelId)
    const alignPoint = (point: [number, number]): [number, number] => {
      const { point: aligned, guides } = resolveLightingAlignedPoint(point, alignmentCandidates, {
        showGuides: isAlignmentGuideActive(),
        applySnap: isMagneticSnapActive(),
      })
      useAlignmentGuides.getState().set(guides)
      return aligned
    }
    const resolve = (event: MouseEvent | PointerEvent): [number, number] | null => {
      const matrix = group.getScreenCTM()
      if (!matrix) return null
      const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      const grid = resolveLightingGridPoint([local.x, local.y], gridSnapStep, isGridSnapActive())
      return alignPoint(grid)
    }
    const stop = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    const onMove = (event: PointerEvent) => {
      stop(event)
      const next = resolve(event)
      pointRef.current = next
      if (draftingRef.current && startRef.current && next) {
        setLinearEnd(constrainPlanDraftPoint(startRef.current, next, getLengthMeters()))
      } else {
        setPoint(next)
      }
    }
    const finishGesture = () => {
      triggerSFX('sfx:structure-build')
      clearDraftLength()
      draftingRef.current = false
      startRef.current = null
      setLinearEnd(null)
      useAlignmentGuides.getState().clear()
      // Same continuation contract as the 3D tool — 2D/3D parity.
      if (getContinuation('lighting') === 'repeat') {
        alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '', activeLevelId)
      } else {
        finishTool()
      }
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      stop(event)
      const snapshot = pointRef.current
      const fresh = snapshot ? null : resolve(event)
      if (!snapshot && !fresh) return
      const resolved = resolveLightingCommitPoint(snapshot, () => fresh as [number, number])

      if (arrayActive) {
        if (!draftingRef.current) {
          // Click 1: fix the start point and enter the draft.
          startRef.current = resolved
          draftingRef.current = true
          setLinearEnd(resolved)
          return
        }
        // Click 2: commit the divided run as ONE node — count, moves,
        // rotation, and property edits then apply to the whole run at once.
        const start = startRef.current!
        const end = constrainPlanDraftPoint(start, resolved, getLengthMeters())
        const segment = resolveLinearLightSegment(start, end)
        const degenerate = resolveLightingArrayPoints(start, end, arrayCount).length === 1
        const node = LightingFixtureNode.parse({
          name: combinedAsset?.name ?? `${lightType[0]?.toUpperCase()}${lightType.slice(1)} light`,
          parentId: activeLevelId,
          lightType,
          circuitId,
          ...(combinedAsset ? { asset: combinedAsset } : {}),
          ...(degenerate
            ? { position: [start[0], fixtureHeight, start[1]] }
            : {
                position: [segment.position[0], fixtureHeight, segment.position[1]],
                rotation: [0, segment.rotationY, 0],
                start,
                end,
                count: arrayCount,
              }),
        })
        sceneApi.upsert(node, activeLevelId)
        selectNode(node.id)
        finishGesture()
        return
      }

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
        finishGesture()
        return
      }

      const [x, z] = resolved
      const node = LightingFixtureNode.parse({
        name: combinedAsset?.name ?? `${lightType[0]?.toUpperCase()}${lightType.slice(1)} light`,
        parentId: activeLevelId,
        position: [x, fixtureHeight, z],
        lightType,
        circuitId,
        ...(combinedAsset ? { asset: combinedAsset } : {}),
      })
      sceneApi.upsert(node, activeLevelId)
      selectNode(node.id)
      finishGesture()
    }
    const onCancel = () => {
      if (draftingRef.current) {
        markToolCancelConsumed()
        clearDraftLength()
        draftingRef.current = false
        startRef.current = null
        setLinearEnd(null)
        useAlignmentGuides.getState().clear()
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
      useAlignmentGuides.getState().clear()
    }
  }, [
    activeLevelId,
    arrayActive,
    arrayCount,
    circuitId,
    clearDraftLength,
    combinedAsset,
    finishTool,
    fixtureHeight,
    getLengthMeters,
    gridSnapStep,
    lightType,
    sceneApi,
    selectNode,
  ])

  const draftStart = lightType === 'linear' || arrayActive ? startRef.current : null
  const arrayPoints =
    arrayActive && draftStart && linearEnd
      ? resolveLightingArrayPoints(draftStart, linearEnd, arrayCount)
      : null

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
          {arrayPoints?.map(([x, z], index) => (
            <g key={`${x}:${z}:${index}`} transform={`translate(${x} ${z})`}>
              <circle fill="#fffbeb" r={0.16} stroke="#f59e0b" strokeWidth={0.025} />
              <path
                d="M -0.1 -0.1 L 0.1 0.1 M 0.1 -0.1 L -0.1 0.1"
                stroke="#f59e0b"
                strokeWidth={0.02}
              />
            </g>
          ))}
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

'use client'

import {
  collectAlignmentAnchors,
  emitter,
  type GridEvent,
  LightingFixtureNode,
  useScene,
} from '@pascal-app/core'
import {
  constrainPlanDraftPoint,
  EDITOR_LAYER,
  getContinuation,
  isAlignmentGuideActive,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  triggerSFX,
  useAlignmentGuides,
  useDraftLengthInput,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import { useLightingToolOptions } from '../lighting/options'
import {
  LINEAR_LIGHT_MIN_LENGTH,
  resolveLightingAlignedPoint,
  resolveLightingArrayPoints,
  resolveLightingCommitPoint,
  resolveLightingGridPoint,
  resolveLinearLightSegment,
} from '../lighting/placement'
import { LightingFixtureVisual, LightingFloorMarker } from './renderer'

export default function LightingFixtureTool() {
  const levelId = useViewer((state) => state.selection.levelId)
  const lightType = useLightingToolOptions((state) => state.lightType)
  const circuitId = useLightingToolOptions((state) => state.circuitId)
  const fixtureHeight = useLightingToolOptions((state) => state.fixtureHeight)
  const placement = useLightingToolOptions((state) => state.placement)
  const arrayCount = useLightingToolOptions((state) => state.arrayCount)
  const itemAsset = useLightingToolOptions((state) => state.itemAsset)
  // Point/spot runs share the linear fixture's two-click draft: click a start,
  // click an end, and the run is divided into `arrayCount` fixtures.
  const arrayActive = placement === 'array' && (lightType === 'point' || lightType === 'spot')
  // A chosen catalog model rides on each committed fixture (point/spot only).
  const combinedAsset =
    itemAsset && (lightType === 'point' || lightType === 'spot') ? itemAsset : null
  const ref = useRef<Group>(null)
  const pointRef = useRef<[number, number] | null>(null)
  const [visible, setVisible] = useState(false)
  // Two-click wall-style draft, entered for `lightType === 'linear'` and for
  // point/spot array runs. `draftingRef`/`startRef` are the FSM the event
  // handlers read; `linearDraft` exists purely to trigger the re-render that
  // redraws the segment preview.
  const draftingRef = useRef(false)
  const startRef = useRef<[number, number] | null>(null)
  const [linearDraft, setLinearDraft] = useState<{
    start: [number, number]
    end: [number, number]
  } | null>(null)
  const { clear: clearDraftLength, getLengthMeters } = useDraftLengthInput(
    () => (lightType === 'linear' || arrayActive) && draftingRef.current,
  )
  const preview = useMemo(() => {
    const segment = linearDraft
      ? resolveLinearLightSegment(linearDraft.start, linearDraft.end)
      : null
    return LightingFixtureNode.parse({
      lightType,
      circuitId,
      position: [0, fixtureHeight, 0],
      ...(combinedAsset ? { asset: combinedAsset } : {}),
      ...(lightType === 'linear' && linearDraft
        ? { start: linearDraft.start, end: linearDraft.end, rotation: [0, segment!.rotationY, 0] }
        : {}),
    })
  }, [circuitId, combinedAsset, fixtureHeight, lightType, linearDraft])

  useEffect(() => {
    if (!levelId) return
    // Alignment candidates — anchors of every alignable object on the active
    // level, refreshed after each fixture commits so a run of fixtures can
    // align to the ones already placed.
    let alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '', levelId)
    const alignPoint = (point: [number, number]): [number, number] => {
      const { point: aligned, guides } = resolveLightingAlignedPoint(point, alignmentCandidates, {
        showGuides: isAlignmentGuideActive(),
        applySnap: isMagneticSnapActive(),
      })
      useAlignmentGuides.getState().set(guides)
      return aligned
    }
    const resolvePoint = (event: GridEvent): [number, number] => {
      const editor = useEditor.getState()
      const grid = resolveLightingGridPoint(
        [event.localPosition[0], event.localPosition[2]],
        editor.gridSnapStep,
        isGridSnapActive(),
      )
      return alignPoint(grid)
    }
    const onMove = (event: GridEvent) => {
      const point = resolvePoint(event)
      pointRef.current = point
      if (draftingRef.current && startRef.current) {
        const end = constrainPlanDraftPoint(startRef.current, point, getLengthMeters())
        if (lightType === 'linear') {
          const segment = resolveLinearLightSegment(startRef.current, end)
          ref.current?.position.set(segment.position[0], 0, segment.position[1])
        } else {
          ref.current?.position.set(end[0], 0, end[1])
        }
        setLinearDraft({ start: startRef.current, end })
      } else {
        ref.current?.position.set(point[0], 0, point[1])
      }
      setVisible(true)
    }
    const finishGesture = () => {
      triggerSFX('sfx:structure-build')
      clearDraftLength()
      draftingRef.current = false
      startRef.current = null
      setLinearDraft(null)
      useAlignmentGuides.getState().clear()
      // 'repeat' keeps the tool armed so a run of fixtures is one gesture
      // per fixture instead of re-picking the tool every time.
      if (getContinuation('lighting') === 'repeat') {
        alignmentCandidates = collectAlignmentAnchors(useScene.getState().nodes, '', levelId)
      } else {
        useEditor.getState().setTool(null)
        useEditor.getState().setMode('select')
      }
    }
    const onClick = (event: GridEvent) => {
      if (arrayActive) {
        const point = resolveLightingCommitPoint(pointRef.current, () => resolvePoint(event))
        if (!draftingRef.current) {
          // Click 1: fix the start point and enter the draft.
          startRef.current = point
          draftingRef.current = true
          setLinearDraft({ start: point, end: point })
          return
        }
        // Click 2: commit the divided run as ONE node — count, moves,
        // rotation, and property edits then apply to the whole run at once.
        const start = startRef.current!
        const end = constrainPlanDraftPoint(start, point, getLengthMeters())
        const segment = resolveLinearLightSegment(start, end)
        const degenerate = resolveLightingArrayPoints(start, end, arrayCount).length === 1
        const node = LightingFixtureNode.parse({
          name: combinedAsset?.name ?? `${lightType[0]?.toUpperCase()}${lightType.slice(1)} light`,
          parentId: levelId,
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
        useScene.getState().createNode(node, levelId)
        useViewer.getState().setSelection({ selectedIds: [node.id] })
        finishGesture()
        return
      }
      if (lightType === 'linear') {
        const point = resolveLightingCommitPoint(pointRef.current, () => resolvePoint(event))
        if (!draftingRef.current) {
          // Click 1: fix the start point and enter the draft.
          startRef.current = point
          draftingRef.current = true
          setLinearDraft({ start: point, end: point })
          return
        }
        // Click 2: commit the segment.
        const start = startRef.current!
        const end = constrainPlanDraftPoint(start, point, getLengthMeters())
        const segment = resolveLinearLightSegment(start, end)
        if (segment.length < LINEAR_LIGHT_MIN_LENGTH) return
        const node = LightingFixtureNode.parse({
          name: 'Linear light',
          parentId: levelId,
          position: [segment.position[0], fixtureHeight, segment.position[1]],
          rotation: [0, segment.rotationY, 0],
          lightType: 'linear',
          circuitId,
          start,
          end,
        })
        useScene.getState().createNode(node, levelId)
        useViewer.getState().setSelection({ selectedIds: [node.id] })
        finishGesture()
        return
      }
      const [x, z] = resolveLightingCommitPoint(pointRef.current, () => resolvePoint(event))
      const node = LightingFixtureNode.parse({
        name: combinedAsset?.name ?? `${lightType[0]?.toUpperCase()}${lightType.slice(1)} light`,
        parentId: levelId,
        position: [x, fixtureHeight, z],
        lightType,
        circuitId,
        ...(combinedAsset ? { asset: combinedAsset } : {}),
      })
      useScene.getState().createNode(node, levelId)
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      finishGesture()
    }
    const onCancel = () => {
      if (draftingRef.current) {
        markToolCancelConsumed()
        clearDraftLength()
        draftingRef.current = false
        startRef.current = null
        setLinearDraft(null)
        useAlignmentGuides.getState().clear()
      }
    }
    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    emitter.on('tool:cancel', onCancel)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      emitter.off('tool:cancel', onCancel)
      draftingRef.current = false
      startRef.current = null
      setLinearDraft(null)
      useAlignmentGuides.getState().clear()
    }
  }, [
    arrayActive,
    arrayCount,
    circuitId,
    clearDraftLength,
    combinedAsset,
    fixtureHeight,
    getLengthMeters,
    levelId,
    lightType,
  ])

  // Markers only — a per-point light preview would flood the scene with live
  // lights; the cursor group already shows one full fixture visual.
  const arrayPoints =
    arrayActive && linearDraft
      ? resolveLightingArrayPoints(linearDraft.start, linearDraft.end, arrayCount)
      : null

  if (!levelId) return null
  return (
    <>
      {arrayPoints && (
        <group layers={EDITOR_LAYER}>
          {arrayPoints.map(([x, z], index) => (
            <group key={`${x}:${z}:${index}`} position={[x, 0, z]}>
              <LightingFloorMarker />
            </group>
          ))}
        </group>
      )}
      <group layers={EDITOR_LAYER} ref={ref} visible={visible}>
        {(lightType !== 'linear' || linearDraft) && (
          <group position={[0, fixtureHeight, 0]}>
            <LightingFixtureVisual node={preview} preview />
          </group>
        )}
        <LightingFloorMarker />
      </group>
    </>
  )
}

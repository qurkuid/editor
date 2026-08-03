'use client'

import { emitter, type GridEvent, LightingFixtureNode, useScene } from '@pascal-app/core'
import {
  constrainPlanDraftPoint,
  EDITOR_LAYER,
  getContinuation,
  isGridSnapActive,
  markToolCancelConsumed,
  triggerSFX,
  useDraftLengthInput,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import { DoubleSide, type Group } from 'three'
import { useLightingToolOptions } from '../lighting/options'
import {
  LINEAR_LIGHT_MIN_LENGTH,
  resolveLightingCommitPoint,
  resolveLightingGridPoint,
  resolveLinearLightSegment,
} from '../lighting/placement'
import { LightingFixtureVisual } from './renderer'

// Mirrors the 2D floorplan marker's geometry and amber palette (#f59e0b
// stroke / #fffbeb fill) so the same snapped point reads identically in
// both views.
const MARKER_OUTER_RADIUS = 0.16
const MARKER_INNER_RADIUS = 0.13
const MARKER_CROSS_LENGTH = 0.2
const MARKER_CROSS_THICKNESS = 0.02
const MARKER_Y = 0.01

function LightingFloorMarker() {
  return (
    <group position={[0, MARKER_Y, 0]}>
      <mesh layers={EDITOR_LAYER} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[MARKER_OUTER_RADIUS, 32]} />
        <meshBasicMaterial
          color="#fffbeb"
          depthTest={false}
          opacity={0.5}
          side={DoubleSide}
          transparent
        />
      </mesh>
      <mesh layers={EDITOR_LAYER} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[MARKER_INNER_RADIUS, MARKER_OUTER_RADIUS, 32]} />
        <meshBasicMaterial color="#f59e0b" depthTest={false} side={DoubleSide} transparent />
      </mesh>
      <mesh layers={EDITOR_LAYER} rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[MARKER_CROSS_LENGTH, MARKER_CROSS_THICKNESS, MARKER_CROSS_THICKNESS]} />
        <meshBasicMaterial color="#f59e0b" depthTest={false} transparent />
      </mesh>
      <mesh layers={EDITOR_LAYER} rotation={[0, -Math.PI / 4, 0]}>
        <boxGeometry args={[MARKER_CROSS_LENGTH, MARKER_CROSS_THICKNESS, MARKER_CROSS_THICKNESS]} />
        <meshBasicMaterial color="#f59e0b" depthTest={false} transparent />
      </mesh>
    </group>
  )
}

export default function LightingFixtureTool() {
  const levelId = useViewer((state) => state.selection.levelId)
  const lightType = useLightingToolOptions((state) => state.lightType)
  const circuitId = useLightingToolOptions((state) => state.circuitId)
  const fixtureHeight = useLightingToolOptions((state) => state.fixtureHeight)
  const ref = useRef<Group>(null)
  const pointRef = useRef<[number, number] | null>(null)
  const [visible, setVisible] = useState(false)
  // Two-click wall-style draft, only entered for `lightType === 'linear'`.
  // `draftingRef`/`startRef` are the FSM the event handlers read; `linearDraft`
  // exists purely to trigger the re-render that redraws the segment preview.
  const draftingRef = useRef(false)
  const startRef = useRef<[number, number] | null>(null)
  const [linearDraft, setLinearDraft] = useState<{
    start: [number, number]
    end: [number, number]
  } | null>(null)
  const { clear: clearDraftLength, getLengthMeters } = useDraftLengthInput(
    () => lightType === 'linear' && draftingRef.current,
  )
  const preview = useMemo(() => {
    const segment = linearDraft
      ? resolveLinearLightSegment(linearDraft.start, linearDraft.end)
      : null
    return LightingFixtureNode.parse({
      lightType,
      circuitId,
      position: [0, fixtureHeight, 0],
      ...(lightType === 'linear' && linearDraft
        ? { start: linearDraft.start, end: linearDraft.end, rotation: [0, segment!.rotationY, 0] }
        : {}),
    })
  }, [circuitId, fixtureHeight, lightType, linearDraft])

  useEffect(() => {
    if (!levelId) return
    const resolvePoint = (event: GridEvent): [number, number] => {
      const editor = useEditor.getState()
      return resolveLightingGridPoint(
        [event.localPosition[0], event.localPosition[2]],
        editor.gridSnapStep,
        isGridSnapActive(),
      )
    }
    const onMove = (event: GridEvent) => {
      const point = resolvePoint(event)
      pointRef.current = point
      if (lightType === 'linear' && draftingRef.current && startRef.current) {
        const end = constrainPlanDraftPoint(startRef.current, point, getLengthMeters())
        const segment = resolveLinearLightSegment(startRef.current, end)
        ref.current?.position.set(segment.position[0], 0, segment.position[1])
        setLinearDraft({ start: startRef.current, end })
      } else {
        ref.current?.position.set(point[0], 0, point[1])
      }
      setVisible(true)
    }
    const onClick = (event: GridEvent) => {
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
        triggerSFX('sfx:structure-build')
        clearDraftLength()
        draftingRef.current = false
        startRef.current = null
        setLinearDraft(null)
        // 'repeat' keeps the tool armed so a run of fixtures is one gesture
        // per fixture instead of re-picking the tool every time.
        if (getContinuation('point') !== 'repeat') {
          useEditor.getState().setTool(null)
          useEditor.getState().setMode('select')
        }
        return
      }
      const [x, z] = resolveLightingCommitPoint(pointRef.current, () => resolvePoint(event))
      const node = LightingFixtureNode.parse({
        name: `${lightType[0]?.toUpperCase()}${lightType.slice(1)} light`,
        parentId: levelId,
        position: [x, fixtureHeight, z],
        lightType,
        circuitId,
      })
      useScene.getState().createNode(node, levelId)
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      triggerSFX('sfx:structure-build')
      // 'repeat' keeps the tool armed so a run of downlights is one gesture
      // per fixture instead of re-picking the tool every time.
      if (getContinuation('point') !== 'repeat') {
        useEditor.getState().setTool(null)
        useEditor.getState().setMode('select')
      }
    }
    const onCancel = () => {
      if (lightType === 'linear' && draftingRef.current) {
        markToolCancelConsumed()
        clearDraftLength()
        draftingRef.current = false
        startRef.current = null
        setLinearDraft(null)
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
    }
  }, [circuitId, clearDraftLength, fixtureHeight, getLengthMeters, levelId, lightType])

  if (!levelId) return null
  return (
    <group layers={EDITOR_LAYER} ref={ref} visible={visible}>
      {(lightType !== 'linear' || linearDraft) && (
        <group position={[0, fixtureHeight, 0]}>
          <LightingFixtureVisual node={preview} preview />
        </group>
      )}
      <LightingFloorMarker />
    </group>
  )
}

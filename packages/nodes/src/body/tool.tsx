'use client'

import { BodyNode, createPlanarFaceBody, emitter, type GridEvent, useScene } from '@pascal-app/core'
import {
  CursorSphere,
  constrainPlanDraftPoint,
  EDITOR_LAYER,
  isGridSnapActive,
  triggerSFX,
  useDraftLengthInput,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BufferGeometry, Float32BufferAttribute, Mesh } from 'three'
import { buildBodyGeometry } from './geometry'
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

export const bodyToolUses3DInteraction = (viewMode: '3d' | '2d' | 'split') => viewMode !== '2d'

const BodyTool = () => {
  const { gl } = useThree()
  const activeLevelId = useViewer((state) => state.selection.levelId)
  const viewMode = useEditor((state) => state.viewMode)
  const primitive = useBodyToolOptions((state) => state.primitive)
  const pointsRef = useRef<BodyDraftPoint[]>([])
  const [points, setPoints] = useState<BodyDraftPoint[]>([])
  const [hover, setHover] = useState<BodyDraftPoint | null>(null)
  const { clear: clearLength, getLengthMeters } = useDraftLengthInput(
    () => pointsRef.current.length > 0,
  )
  const feedback = useMemo(() => resolveBodyDraftFeedback(points, hover), [hover, points])
  const pathGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    const vertices = feedback.path.slice(1).flatMap((point, index) => {
      const previous = feedback.path[index]
      return previous ? [previous[0], 0.018, previous[1], point[0], 0.018, point[1]] : []
    })
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    return geometry
  }, [feedback.path])

  const draftPolygon = useMemo(() => {
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
  const preview = useMemo(() => {
    if (!draftPolygon) return null
    const body = createPlanarFaceBody(draftPolygon.map(([x, z]) => [x, 0.006, z]))
    const group = buildBodyGeometry(body)
    group.traverse((object) => {
      object.layers.set(EDITOR_LAYER)
      if (!(object instanceof Mesh)) return
      const material = object.material.clone()
      material.transparent = true
      material.opacity = 0.35
      material.depthWrite = false
      object.material = material
    })
    return group
  }, [draftPolygon])

  useEffect(
    () => () => {
      preview?.traverse((object) => {
        if (!(object instanceof Mesh)) return
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) material.dispose()
      })
    },
    [preview],
  )

  useEffect(() => () => pathGeometry.dispose(), [pathGeometry])

  useEffect(() => {
    if (!(activeLevelId && bodyToolUses3DInteraction(viewMode))) return
    const previous = gl.domElement.style.cursor
    gl.domElement.style.cursor = 'crosshair'
    return () => {
      if (gl.domElement.style.cursor === 'crosshair') gl.domElement.style.cursor = previous
    }
  }, [activeLevelId, gl.domElement, viewMode])

  useEffect(() => {
    if (!(activeLevelId && bodyToolUses3DInteraction(viewMode))) return
    pointsRef.current = []
    setPoints([])
    setHover(null)
    clearLength()
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'body' })
    const updatePoints = (next: BodyDraftPoint[]) => {
      pointsRef.current = next
      setPoints(next)
    }
    const resolvePoint = (event: GridEvent): BodyDraftPoint => {
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const raw: BodyDraftPoint = [
        snap(event.localPosition[0], step),
        snap(event.localPosition[2], step),
      ]
      const anchor = pointsRef.current.at(-1)
      return anchor ? constrainPlanDraftPoint(anchor, raw, getLengthMeters()) : raw
    }
    const finish = (polygon: readonly BodyDraftPoint[], name: string) => {
      const body = BodyNode.parse({
        ...createPlanarFaceBody(polygon.map(([x, z]) => [x, 0, z])),
        name,
      })
      useScene.getState().createNode(body, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [body.id] })
      triggerSFX('sfx:structure-build')
      useEditor.getState().setTool(null)
      useEditor.getState().setMode('select')
    }
    const onMove = (event: GridEvent) => setHover(resolvePoint(event))
    const onClick = (event: GridEvent) => {
      const point = resolvePoint(event)
      const current = pointsRef.current
      const first = current[0]
      const second = current[1]
      if (primitive === 'line') {
        if (current.length >= 3 && first && shouldCloseLineDraft(first, point, CLOSE_TOLERANCE)) {
          const polygon = resolveLineFaceDraft(current)
          if (polygon) finish(polygon, 'Line Face')
          return
        }
        updatePoints([...current, point])
      } else if (primitive === 'circle') {
        if (current.length === 0) updatePoints([point])
        else if (first) {
          const polygon = resolveCircleDraft(first, point, getLengthMeters())
          if (polygon) finish(polygon, 'Circle Face')
        }
      } else if (current.length < 2) updatePoints([...current, point])
      else if (first && second) {
        const polygon = resolveRectangleDraft(first, second, point, getLengthMeters())
        if (polygon) finish(polygon, 'Rectangle Face')
      }
      clearLength()
      if (current.length === 0) triggerSFX('sfx:structure-build-start')
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter' && primitive === 'line') {
        const polygon = resolveLineFaceDraft(pointsRef.current)
        if (polygon) finish(polygon, 'Line Face')
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (pointsRef.current.length > 0) updatePoints(pointsRef.current.slice(0, -1))
      else {
        useEditor.getState().setTool(null)
        useEditor.getState().setMode('select')
      }
      clearLength()
    }
    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      window.removeEventListener('keydown', onKeyDown, true)
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'body')
    }
  }, [activeLevelId, clearLength, getLengthMeters, primitive, viewMode])

  if (!activeLevelId) return null
  return (
    <group>
      {preview ? <primitive object={preview} /> : null}
      {feedback.path.length > 1 ? (
        <lineSegments geometry={pathGeometry} layers={EDITOR_LAYER} renderOrder={3}>
          <lineBasicMaterial color="#0284c7" depthTest={false} depthWrite={false} />
        </lineSegments>
      ) : null}
      {feedback.committed.map((point, index) => (
        <mesh
          key={`${point[0]}:${point[1]}:${index}`}
          layers={EDITOR_LAYER}
          position={[point[0], 0.024, point[1]]}
          renderOrder={4}
        >
          <sphereGeometry args={[index === 0 ? 0.09 : 0.065, 20, 14]} />
          <meshBasicMaterial
            color={index === 0 ? '#22c55e' : '#0284c7'}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      ))}
      {feedback.cursor ? (
        <CursorSphere
          color="#0ea5e9"
          height={0}
          position={[feedback.cursor[0], 0.02, feedback.cursor[1]]}
          showTooltip={false}
        />
      ) : null}
    </group>
  )
}

export default BodyTool

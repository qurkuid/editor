'use client'

import {
  type AnyNodeId,
  remapBodyFeatureAnnotations,
  runAsSingleSceneHistoryStep,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { executeImprintBodyFace, executeSplitBodyFace } from '@pascal-app/core/modeling-operations'
import {
  constrainPlanDraftPoint,
  isGridSnapActive,
  markToolCancelConsumed,
  triggerSFX,
  useDraftLengthInput,
  useEditor,
  useInteractionScope,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { type Group, type Object3D, Raycaster, Vector2 } from 'three'
import {
  bodyGeometryPatch,
  createFaceProjection,
  isBodyFaceImprintEligible,
  isBodyFaceSplitEligible,
  resolveFaceDraftPolygon,
} from './face-imprint-geometry'
import { useBodyFaceDraftLifecycle } from './face-imprint-lifecycle'
import { BodyFaceImprintPreview } from './face-imprint-preview'
import { resolveBodyFaceId } from './face-target'
import { type BodyFaceDraft, useBodyToolOptions } from './options'
import {
  resolveArcDraft,
  resolveBodyDraftFeedback,
  resolveCircleDraft,
  resolveLineFaceDraft,
  shouldCloseLineDraft,
  snapLineDraftPoint,
} from './primitive-draft'
import { type BodyDraftPoint, resolveRectangleDraft } from './rectangle-draft'

export function BodyFaceDraftTool({ bodyId, faceId }: BodyFaceDraft) {
  const { camera, gl } = useThree()
  const body = useScene((state) => {
    const node = state.nodes[bodyId as AnyNodeId]
    return node?.type === 'body' ? node : null
  })
  const primitive = useBodyToolOptions((state) => state.primitive)
  const arcSegments = useBodyToolOptions((state) => state.arcSegments)
  const polygonSides = useBodyToolOptions((state) => state.polygonSides)
  const outerRef = useRef<Group>(null)
  const targetRef = useRef<Object3D | null>(null)
  const pointsRef = useRef<BodyDraftPoint[]>([])
  const [target, setTarget] = useState<Object3D | null>(null)
  const [points, setPoints] = useState<BodyDraftPoint[]>([])
  const [hover, setHover] = useState<BodyDraftPoint | null>(null)
  const { clear: clearLength, getLengthMeters } = useDraftLengthInput(
    () => pointsRef.current.length > 0,
  )
  const face = body?.faces.find((candidate) => candidate.id === faceId) ?? null
  const splitEligible =
    (primitive === 'line' || primitive === 'arc') &&
    Boolean(body && face && isBodyFaceSplitEligible(body, face.id))
  const faceDraftEligible = Boolean(
    body && face && (isBodyFaceImprintEligible(body, face.id) || splitEligible),
  )
  const projection = useMemo(
    () => (body && face && faceDraftEligible ? createFaceProjection(body, face.id) : null),
    [body, face, faceDraftEligible],
  )

  useBodyFaceDraftLifecycle(
    bodyId,
    faceId,
    Boolean(body && face && projection && faceDraftEligible),
  )

  useFrame(() => {
    const outer = outerRef.current
    const nextTarget = targetRef.current
    if (!outer || !nextTarget?.parent) return
    outer.position.copy(nextTarget.position)
    outer.quaternion.copy(nextTarget.quaternion)
    outer.scale.copy(nextTarget.scale)
  })

  useEffect(() => {
    if (!body) return
    let frameId = 0
    const resolve = () => {
      const next = sceneRegistry.nodes.get(body.id) ?? null
      targetRef.current = next
      setTarget((current) => (current === next ? current : next))
      if (!next) frameId = window.requestAnimationFrame(resolve)
    }
    resolve()
    return () => window.cancelAnimationFrame(frameId)
  }, [body])

  const feedback = useMemo(() => resolveBodyDraftFeedback(points, hover), [hover, points])
  const draftPolygon = useMemo(
    () =>
      resolveFaceDraftPolygon(
        primitive,
        points,
        hover,
        getLengthMeters(),
        arcSegments,
        polygonSides,
      ),
    [arcSegments, getLengthMeters, hover, points, polygonSides, primitive],
  )
  useEffect(() => {
    if (!target || !body || !face || !projection || !faceDraftEligible) return
    const previousCursor = gl.domElement.style.cursor
    gl.domElement.style.cursor = 'crosshair'
    pointsRef.current = []
    setPoints([])
    setHover(null)
    clearLength()
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'body' })
    const raycaster = new Raycaster()
    const pointer = new Vector2()
    const updatePoints = (next: BodyDraftPoint[]) => {
      pointsRef.current = next
      setPoints(next)
    }
    const consume = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
    }
    const resolvePoint = (event: PointerEvent | MouseEvent): BodyDraftPoint | null => {
      const rect = gl.domElement.getBoundingClientRect()
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera)
      const hit = raycaster
        .intersectObject(target, true)
        .find((candidate) => resolveBodyFaceId(candidate.object) === face.id)
      if (!hit) return null
      const local = target.worldToLocal(hit.point.clone())
      const raw = projection.toPlane([local.x, local.y, local.z])
      const step = isGridSnapActive() ? useEditor.getState().gridSnapStep : 0
      const snapped: BodyDraftPoint = [
        step > 0 ? Math.round(raw[0] / step) * step : raw[0],
        step > 0 ? Math.round(raw[1] / step) * step : raw[1],
      ]
      const anchor = pointsRef.current.at(-1)
      const constrained = anchor
        ? constrainPlanDraftPoint(anchor, snapped, getLengthMeters())
        : snapped
      return primitive === 'line'
        ? snapLineDraftPoint(pointsRef.current, constrained, 0.12)
        : constrained
    }
    const commitResult = (
      result: {
        body: NonNullable<typeof body>
        topologyRemap: Parameters<typeof remapBodyFeatureAnnotations>[3]
      },
      selectedFaceId: string,
    ): boolean => {
      try {
        runAsSingleSceneHistoryStep(useScene, () => {
          const scene = useScene.getState()
          const updates = remapBodyFeatureAnnotations(
            scene.nodes,
            body.id,
            result.body,
            result.topologyRemap,
          )
          scene.updateNodes([{ id: body.id, data: bodyGeometryPatch(result.body) }, ...updates])
        })
        useBodyToolOptions.getState().setSelectedFeature({
          bodyId: body.id,
          kind: 'face',
          featureId: selectedFaceId,
        })
        useBodyToolOptions.getState().setFaceDraft(null)
        triggerSFX('sfx:structure-build')
        useEditor.getState().setTool(null)
        useEditor.getState().setMode('select')
        useViewer.getState().setSelection({ selectedIds: [body.id] })
        return true
      } catch {
        return false
      }
    }
    const finish = (polygon: readonly BodyDraftPoint[]): boolean => {
      const profile = polygon.map(projection.fromPlane)
      try {
        const result = executeImprintBodyFace(body, { faceId: face.id, profilePoints: profile })
        return commitResult(result, result.insetFaceId)
      } catch {
        return false
      }
    }
    const finishOpen = (path: readonly BodyDraftPoint[]): boolean => {
      if (path.length < 2 || !splitEligible) return false
      try {
        const result = executeSplitBodyFace(body, {
          faceId: face.id,
          pathPoints: path.map(projection.fromPlane),
        })
        return commitResult(result, result.splitFaceId)
      } catch {
        return false
      }
    }
    const resolveArc = (draft: readonly BodyDraftPoint[]) => {
      const first = draft[0]
      const second = draft[1]
      const third = draft[2]
      return first && second && third
        ? resolveArcDraft(first, second, third, useBodyToolOptions.getState().arcSegments)
        : null
    }
    const onMove = (event: PointerEvent) => {
      const point = resolvePoint(event)
      if (!point) return
      consume(event)
      setHover(point)
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      const point = resolvePoint(event)
      if (!point) return
      consume(event)
      const current = pointsRef.current
      const first = current[0]
      const second = current[1]
      if (primitive === 'line') {
        if (current.length >= 3 && first && shouldCloseLineDraft(first, point, 0.12)) {
          const lineFace = resolveLineFaceDraft(current)
          if (lineFace) finish(lineFace)
          return
        }
        updatePoints([...current, point])
      } else if (primitive === 'circle') {
        if (current.length === 0) updatePoints([point])
        else if (first) {
          const circle = resolveCircleDraft(first, point, getLengthMeters())
          if (circle) finish(circle)
        }
      } else if (primitive === 'arc') {
        if (current.length < 3) updatePoints([...current, point])
      } else if (primitive === 'polygon') {
        if (current.length === 0) updatePoints([point])
        else if (first) {
          const polygon = resolveFaceDraftPolygon(
            primitive,
            [first],
            point,
            getLengthMeters(),
            arcSegments,
            useBodyToolOptions.getState().polygonSides,
          )
          if (polygon) finish(polygon)
        }
      } else if (current.length < 2) updatePoints([...current, point])
      else if (first && second) {
        const rectangle = resolveRectangleDraft(first, second, point, getLengthMeters())
        if (rectangle) finish(rectangle)
      }
      clearLength()
      if (current.length === 0) triggerSFX('sfx:structure-build-start')
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const isClose = event.key === 'c' || event.key === 'C'
      const isEnter = event.key === 'Enter'
      if (
        primitive === 'arc' &&
        (isEnter || (isClose && !(event.metaKey || event.ctrlKey || event.altKey)))
      ) {
        const arc = resolveArc(pointsRef.current)
        if (isClose && arc) {
          if (finish(arc)) {
            event.preventDefault()
            consume(event)
          }
          return
        }
        if (isEnter && arc && finishOpen(arc)) {
          event.preventDefault()
          consume(event)
        }
        return
      }
      if (
        primitive === 'line' &&
        (isEnter || (isClose && !(event.metaKey || event.ctrlKey || event.altKey)))
      ) {
        const lineFace = resolveLineFaceDraft(pointsRef.current)
        if (lineFace) {
          if (finish(lineFace)) {
            event.preventDefault()
            consume(event)
          }
          return
        }
        if (finishOpen(pointsRef.current)) {
          event.preventDefault()
          consume(event)
        }
        return
      }
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      markToolCancelConsumed()
      if (pointsRef.current.length > 0) updatePoints(pointsRef.current.slice(0, -1))
      else {
        useBodyToolOptions.getState().setFaceDraft(null)
        useEditor.getState().setTool(null)
        useEditor.getState().setMode('select')
      }
      clearLength()
    }
    gl.domElement.addEventListener('pointermove', onMove, true)
    gl.domElement.addEventListener('click', onClick, true)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      if (gl.domElement.style.cursor === 'crosshair') gl.domElement.style.cursor = previousCursor
      gl.domElement.removeEventListener('pointermove', onMove, true)
      gl.domElement.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKeyDown, true)
      useInteractionScope
        .getState()
        .endIf((scope) => scope.kind === 'drafting' && scope.tool === 'body')
    }
  }, [
    body,
    arcSegments,
    camera,
    clearLength,
    face,
    faceDraftEligible,
    getLengthMeters,
    gl.domElement,
    primitive,
    projection,
    splitEligible,
    target,
  ])

  if (!target || !body || !face || !projection || !faceDraftEligible) {
    return null
  }
  const content = (
    <BodyFaceImprintPreview
      draftPolygon={draftPolygon}
      feedback={feedback}
      outerRef={outerRef}
      projection={projection}
    />
  )
  return createPortal(content, target.parent ?? target, undefined)
}

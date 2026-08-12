'use client'

import {
  type AnyNodeId,
  type BodyEvent,
  type BodyNode,
  emitter,
  type GridEvent,
  type MeasurementPoint,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  CursorSphere,
  constrainSpatialDraftPoint,
  consumePlacementDragRelease,
  getSegmentGridStep,
  isGridSnapActive,
  isMagneticSnapActive,
  markToolCancelConsumed,
  snapBuildingLocalToWorldGrid,
  triggerSFX,
  useDraftLengthHud,
  useDraftLengthInput,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Vector3 } from 'three'
import {
  associateSurfaceHit,
  createMeasurementSurfaceQuerySession,
  worldPointScreenDistance,
} from '../measurement/surface-query'
import { resolveBodyFaceId } from './face-target'
import { matchBodyMeasurementFeature, resolveBodyMeasurementFaceId } from './measurement'
import {
  bodyPlanCenter,
  createBodyMoveEffectState,
  resolveBodyMoveTranslation,
  resolveBodyPointMoveTranslation,
} from './move-session'
import {
  type BodyMoveSnap,
  BodyMoveSnapMarker,
  bodyMoveSnapFromBinding,
  bodyMoveSnapFromSurfaceHit,
} from './move-snap'
import { useBodyToolOptions } from './options'

type PointerEventSource = PointerEvent | { readonly nativeEvent: PointerEvent }
function normalizePointerEvent(source: PointerEventSource): PointerEvent {
  return 'nativeEvent' in source ? source.nativeEvent : source
}

function isFloorplanSourcedEvent(event: GridEvent): boolean {
  const target = normalizePointerEvent(event.nativeEvent).target
  if (!(target instanceof Element)) return false
  return target.closest('[data-floorplan-scene]') != null
}

export const MoveBodyTool: React.FC<{ node: BodyNode }> = ({ node }) => {
  const { camera, gl, scene } = useThree()
  const activatedAtRef = useRef<number>(Date.now())
  const originalCenterRef = useRef(bodyPlanCenter(node))
  const basePointRef = useRef<[number, number, number] | null>(null)
  const dragAnchorRef = useRef<[number, number] | null>(null)
  const surfaceQuery = useMemo(
    () => createMeasurementSurfaceQuerySession(scene, { excludeNodeIds: [node.id] }),
    [node.id, scene],
  )
  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>(() => {
    const center = originalCenterRef.current
    return [center[0], 0, center[1]]
  })
  const [baseSnap, setBaseSnap] = useState<BodyMoveSnap | null>(null)
  const [targetSnap, setTargetSnap] = useState<BodyMoveSnap | null>(null)
  const sessionActiveRef = useRef(false)
  const { clear: clearLength, getLengthMeters } = useDraftLengthInput(
    () => sessionActiveRef.current,
  )

  const exitMoveMode = useCallback(() => {
    useBodyToolOptions.getState().setSelectionAction(null)
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => () => surfaceQuery.dispose(), [surfaceQuery])

  useEffect(() => {
    const bodyId = node.id
    const effectState = createBodyMoveEffectState({
      body: node,
      preview: 'override',
      autofold: useBodyToolOptions.getState().autofold,
      feature: useBodyToolOptions.getState().selectedFeature,
    })
    const session = effectState.session
    const placementDragMode = useEditor.getState().placementDragMode
    sessionActiveRef.current = true
    clearLength()
    useDraftLengthHud.getState().setPreviewInvalid(false)
    dragAnchorRef.current = null
    basePointRef.current = null
    let committed = false

    const bodyObject = sceneRegistry.nodes.get(bodyId)
    const levelObject =
      (node.parentId ? sceneRegistry.nodes.get(node.parentId) : undefined) ??
      bodyObject?.parent ??
      scene

    const eventPointInLevel = (event: BodyEvent): [number, number, number] => {
      const local = levelObject.worldToLocal(new Vector3(...event.position))
      return [local.x, local.y, local.z]
    }

    const resolveBaseCandidate = (event: BodyEvent) => {
      const point = eventPointInLevel(event)
      const visibleFaceId = event.normal
        ? resolveBodyMeasurementFaceId(node, point, event.normal)
        : resolveBodyFaceId(event.object)
      const inferenceSnap = isGridSnapActive() || isMagneticSnapActive()
      const snap = inferenceSnap
        ? bodyMoveSnapFromBinding(
            node,
            matchBodyMeasurementFeature(
              node,
              point,
              Number.POSITIVE_INFINITY,
              (candidate) =>
                worldPointScreenDistance(
                  levelObject.localToWorld(new Vector3(...candidate)),
                  normalizePointerEvent(event.nativeEvent),
                  camera,
                  gl.domElement,
                ),
              visibleFaceId,
            ),
          )
        : null
      return { point: snap?.point ?? point, snap }
    }

    const resolveDestinationAssociation = (
      resolved: ReturnType<typeof surfaceQuery.resolvePointer>,
      nativeEvent: PointerEvent,
    ) => {
      if (!resolved) return { associated: null, snap: null }
      const targetNode = resolved.hit.targetNodeId
        ? useScene.getState().nodes[resolved.hit.targetNodeId as AnyNodeId]
        : undefined
      if (targetNode?.type === 'body') {
        const visibleFaceId = resolveBodyMeasurementFaceId(
          targetNode,
          resolved.hit.point,
          resolved.hit.normal,
        )
        const binding = matchBodyMeasurementFeature(
          targetNode,
          resolved.hit.point,
          Number.POSITIVE_INFINITY,
          (candidate) =>
            worldPointScreenDistance(
              levelObject.localToWorld(new Vector3(...candidate)),
              nativeEvent,
              camera,
              gl.domElement,
            ),
          visibleFaceId,
        )
        const snap = bodyMoveSnapFromBinding(targetNode, binding)
        return {
          associated: snap
            ? {
                ...resolved.hit,
                point: [snap.point[0], snap.point[1], snap.point[2]] satisfies MeasurementPoint,
              }
            : null,
          snap: snap
            ? {
                ...snap,
                normal: [
                  resolved.hit.normal[0],
                  resolved.hit.normal[1],
                  resolved.hit.normal[2],
                ] satisfies MeasurementPoint,
              }
            : null,
        }
      }
      const associated = associateSurfaceHit(resolved.hit)
      return { associated, snap: bodyMoveSnapFromSurfaceHit(associated) }
    }

    const clearSnapFeedback = () => {
      setBaseSnap(null)
      setTargetSnap(null)
    }

    const previewBaseCandidate = (event: BodyEvent) => {
      if (placementDragMode || basePointRef.current || event.node.id !== bodyId) return
      event.stopPropagation()
      const candidate = resolveBaseCandidate(event)
      setBaseSnap(candidate.snap)
      setCursorLocalPos(candidate.point)
    }

    const clearBaseHover = (event: BodyEvent) => {
      if (!placementDragMode && !basePointRef.current && event.node.id === bodyId) {
        setBaseSnap(null)
      }
    }

    const applyPreview = (event: GridEvent) => {
      if (isFloorplanSourcedEvent(event)) return
      const nativeEvent = normalizePointerEvent(event.nativeEvent)
      const forceFree = nativeEvent.altKey
      const typedRaw = useDraftLengthHud.getState().raw.trim()
      const typedInput = typedRaw.length > 0
      const typedLength = typedInput ? getLengthMeters() : null
      const hasValidTypedLength = !typedInput || typedLength !== null
      useDraftLengthHud.getState().setPreviewInvalid(!hasValidTypedLength)
      const step = forceFree || !isGridSnapActive() ? 0 : getSegmentGridStep()
      const [x, z] = snapBuildingLocalToWorldGrid(
        [event.localPosition[0], event.localPosition[2]],
        step,
      )

      if (!placementDragMode) {
        const basePoint = basePointRef.current
        if (!basePoint) {
          setTargetSnap(null)
          return
        }
        const magneticSnap = isMagneticSnapActive()
        const inferenceSnap = isGridSnapActive() || magneticSnap
        const resolved = forceFree
          ? null
          : surfaceQuery.resolvePointer({
              event: nativeEvent,
              camera,
              canvas: gl.domElement,
              levelObject,
              anchorOrAnchors: basePoint,
              applyMagneticSnap: magneticSnap,
              showAlignmentGuides: false,
            })
        const { associated, snap } = inferenceSnap
          ? resolveDestinationAssociation(resolved, nativeEvent)
          : { associated: null, snap: null }
        const hit = snap ? associated : resolved?.hit
        setTargetSnap(snap)
        const targetPoint: [number, number, number] = hit ? [...hit.point] : [x, basePoint[1], z]
        const constrainedTargetPoint =
          hasValidTypedLength && typedLength !== null
            ? constrainSpatialDraftPoint(basePoint, targetPoint, typedLength)
            : targetPoint
        const translation = hasValidTypedLength
          ? resolveBodyPointMoveTranslation({ basePoint, targetPoint: constrainedTargetPoint })
          : ([Number.NaN, Number.NaN, Number.NaN] as [number, number, number])
        const valid = session.preview(translation)
        useDraftLengthHud.getState().setPreviewInvalid(!hasValidTypedLength || !valid)
        setCursorLocalPos(constrainedTargetPoint)
        return
      }

      const anchor = dragAnchorRef.current ?? [x, z]
      dragAnchorRef.current = anchor
      const dx = x - anchor[0]
      const dz = z - anchor[1]
      const magneticSnap = isMagneticSnapActive()
      const inferenceSnap = isGridSnapActive() || magneticSnap
      const resolved = forceFree
        ? null
        : surfaceQuery.resolvePointer({
            event: nativeEvent,
            camera,
            canvas: gl.domElement,
            levelObject,
            anchorOrAnchors: null,
            surfacePreference: { kind: 'horizontal' },
            applyMagneticSnap: magneticSnap,
            showAlignmentGuides: false,
          })
      const { associated, snap } = inferenceSnap
        ? resolveDestinationAssociation(resolved, nativeEvent)
        : { associated: null, snap: null }
      setTargetSnap(snap)
      const hit = snap ? associated : resolved?.hit
      const surfacePoint = hit && Math.abs(hit.normal[1]) >= 0.85 ? hit.point : null
      const targetPoint: [number, number, number] = surfacePoint ? [...surfacePoint] : [x, 0, z]
      const constrainedTargetPoint =
        hasValidTypedLength && typedLength !== null
          ? constrainSpatialDraftPoint([anchor[0], 0, anchor[1]], targetPoint, typedLength)
          : targetPoint
      const translation = hasValidTypedLength
        ? surfacePoint
          ? resolveBodyMoveTranslation({
              body: node,
              planTranslation: [dx, dz],
              surfacePoint: constrainedTargetPoint,
            })
          : resolveBodyMoveTranslation({
              body: node,
              planTranslation: [
                constrainedTargetPoint[0] - anchor[0],
                constrainedTargetPoint[2] - anchor[1],
              ],
              surfacePoint: null,
            })
        : ([Number.NaN, Number.NaN, Number.NaN] as [number, number, number])
      const valid = session.preview(translation)
      useDraftLengthHud.getState().setPreviewInvalid(!hasValidTypedLength || !valid)
      const center = originalCenterRef.current
      setCursorLocalPos([
        center[0] + constrainedTargetPoint[0] - anchor[0],
        constrainedTargetPoint[1],
        center[1] + constrainedTargetPoint[2] - anchor[1],
      ])
    }

    const commitCurrent = (
      nativeEvent?: { stopPropagation?: () => void },
      allowImmediate = false,
    ) => {
      if (committed) return
      if (!allowImmediate && Date.now() - activatedAtRef.current < 150) {
        nativeEvent?.stopPropagation?.()
        return
      }
      if (!session.canCommit()) return
      committed = session.commit()
      if (!committed) return
      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [bodyId] })
      useEditor.getState().setMovingNodeOrigin('3d')
      clearSnapFeedback()
      clearLength()
      useDraftLengthHud.getState().setPreviewInvalid(false)
      exitMoveMode()
      nativeEvent?.stopPropagation?.()
    }

    const commitFromGrid = (event: GridEvent) => {
      if (isFloorplanSourcedEvent(event)) return
      commitCurrent(event.nativeEvent)
    }

    const commitFromBody = (event: BodyEvent) => {
      if (!placementDragMode && !basePointRef.current) {
        if (event.node.id !== bodyId) return
        const candidate = resolveBaseCandidate(event)
        basePointRef.current = candidate.point
        setBaseSnap(candidate.snap)
        setTargetSnap(null)
        setCursorLocalPos(candidate.point)
        event.stopPropagation()
        return
      }
      commitCurrent(event.nativeEvent)
    }

    const onPlacementDragPointerUp = (event: PointerEvent) => {
      if (!consumePlacementDragRelease(event)) return
      activatedAtRef.current = 0
      commitCurrent(event)
    }

    const onCancel = () => {
      session.cancel()
      clearLength()
      useDraftLengthHud.getState().setPreviewInvalid(false)
      useViewer.getState().setSelection({ selectedIds: [bodyId] })
      clearSnapFeedback()
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('grid:move', applyPreview)
    emitter.on('grid:click', commitFromGrid)
    emitter.on('body:move', previewBaseCandidate)
    emitter.on('body:leave', clearBaseHover)
    emitter.on('body:click', commitFromBody)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('pointerup', onPlacementDragPointerUp)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCancel()
        return
      }
      if (event.key !== 'Enter' || !session.canCommit()) return
      event.preventDefault()
      event.stopPropagation()
      commitCurrent(event, true)
    }
    window.addEventListener('keydown', onKeyDown, true)

    return () => {
      if (!committed) session.cancel()
      sessionActiveRef.current = false
      clearLength()
      useDraftLengthHud.getState().setPreviewInvalid(false)
      useBodyToolOptions.getState().setSelectionAction(null)
      clearSnapFeedback()
      emitter.off('grid:move', applyPreview)
      emitter.off('grid:click', commitFromGrid)
      emitter.off('body:move', previewBaseCandidate)
      emitter.off('body:leave', clearBaseHover)
      emitter.off('body:click', commitFromBody)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('pointerup', onPlacementDragPointerUp)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [camera, clearLength, exitMoveMode, getLengthMeters, gl.domElement, node, scene, surfaceQuery])

  return (
    <group>
      <CursorSphere position={cursorLocalPos} showTooltip={false} />
      {baseSnap && <BodyMoveSnapMarker persistent snap={baseSnap} />}
      {targetSnap && <BodyMoveSnapMarker persistent={false} snap={targetSnap} />}
    </group>
  )
}

export default MoveBodyTool

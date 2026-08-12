'use client'

import {
  type AnyNodeId,
  type BodyEvent,
  type BodyNode,
  type BodySelectionActionKind,
  emitter,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  EDITOR_LAYER,
  markToolCancelConsumed,
  type Tool,
  useEditor,
  useInteractionScope,
  usePivotRotate,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import { type Object3D, Vector3 } from 'three'
import { worldPointScreenDistance } from '../measurement/surface-query'
import { resolveBodyFaceId } from './face-target'
import { isBodyFeatureSelectionValid, resolveBodyFeatureSelection } from './feature-selection'
import { bodyMeasurementFeatures, matchBodyMeasurementFeature } from './measurement'
import { OffsetHandle } from './offset-handle'
import { bodyActionToolChanged, useBodyToolOptions } from './options'
import { PushPullHandle } from './push-pull-handle'
import { retargetBodySelectionAction } from './selection-action'
import { SweepHandle } from './sweep-handle'

const BodySelectionAffordance = () => {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const { camera, gl } = useThree()
  const glDomElement = gl.domElement
  const viewMode = useEditor((state) => state.viewMode)
  const tool = useEditor((state) => state.tool)
  const body = useScene((state) => {
    if (selectedIds.length !== 1) return null
    const node = state.nodes[selectedIds[0] as AnyNodeId]
    return node?.type === 'body' ? (node as BodyNode) : null
  })
  const [target, setTarget] = useState<Object3D | null>(null)
  const selectedFeature = useBodyToolOptions((state) => state.selectedFeature)
  const setSelectedFeature = useBodyToolOptions((state) => state.setSelectedFeature)
  const selectionAction = useBodyToolOptions((state) => state.selectionAction)
  const setSelectionAction = useBodyToolOptions((state) => state.setSelectionAction)
  const rotateStage = usePivotRotate((state) => state.stage)
  const armedToolRef = useRef<Tool | null>(tool)
  const bodyId = body?.id ?? null
  const clearSelectionAction = useCallback(() => {
    setSelectionAction(null)
    if (bodyId) emitter.emit('body:selection-action', { bodyId, action: null })
  }, [bodyId, setSelectionAction])

  useEffect(() => {
    if (!selectionAction || selectionAction.bodyId === bodyId) return
    setSelectionAction(null)
  }, [bodyId, selectionAction, setSelectionAction])

  useEffect(() => {
    if (!selectionAction || !bodyActionToolChanged(armedToolRef.current, tool)) return
    clearSelectionAction()
  }, [clearSelectionAction, selectionAction, tool])

  useEffect(() => {
    if (selectionAction?.kind !== 'rotate' || rotateStage !== 'idle') return
    clearSelectionAction()
  }, [clearSelectionAction, rotateStage, selectionAction])

  const pushPullArmed = selectionAction?.kind === 'push-pull'
  const offsetTargeting = selectionAction?.kind === 'offset' && selectionAction.faceId === null
  const sweepArmed = selectionAction?.kind === 'sweep'
  const scaleArmed = selectionAction?.kind === 'scale'
  useEffect(() => {
    if (!(pushPullArmed || offsetTargeting || sweepArmed)) return
    const previousCursor = document.body.style.cursor
    const previousCanvasCursor = glDomElement.style.cursor
    document.body.style.cursor = 'crosshair'
    glDomElement.style.cursor = 'crosshair'
    const onCancel = () => {
      markToolCancelConsumed()
      setSelectionAction(null)
      if (sweepArmed && bodyId) {
        useInteractionScope
          .getState()
          .endIf(
            (scope) =>
              scope.kind === 'reshaping' && scope.nodeId === bodyId && scope.reshape === 'sweep',
          )
      }
    }
    emitter.on('tool:cancel', onCancel)
    return () => {
      emitter.off('tool:cancel', onCancel)
      if (document.body.style.cursor === 'crosshair') document.body.style.cursor = previousCursor
      if (glDomElement.style.cursor === 'crosshair') {
        glDomElement.style.cursor = previousCanvasCursor
      }
    }
  }, [bodyId, glDomElement, offsetTargeting, pushPullArmed, setSelectionAction, sweepArmed])

  useEffect(() => {
    if (!scaleArmed) return
    const onCancel = () => {
      markToolCancelConsumed()
      clearSelectionAction()
    }
    emitter.on('tool:cancel', onCancel)
    return () => emitter.off('tool:cancel', onCancel)
  }, [clearSelectionAction, scaleArmed])

  useEffect(() => {
    if (!bodyId) {
      setTarget(null)
      return
    }
    let frameId = 0
    const resolve = () => {
      const next = sceneRegistry.nodes.get(bodyId as AnyNodeId) ?? null
      setTarget((current) => (current === next ? current : next))
      if (!next) frameId = window.requestAnimationFrame(resolve)
    }
    resolve()
    return () => window.cancelAnimationFrame(frameId)
  }, [bodyId])

  useEffect(
    () => () => {
      useBodyToolOptions.getState().setSelectionAction(null)
    },
    [],
  )

  useEffect(() => {
    if (!body) return
    const onSelectionAction = (event: {
      bodyId: BodyNode['id']
      action: BodySelectionActionKind | null
    }) => {
      if (event.bodyId !== body.id) return
      if (event.action === null) {
        setSelectionAction(null)
        useInteractionScope
          .getState()
          .endIf(
            (scope) =>
              scope.kind === 'reshaping' && scope.nodeId === body.id && scope.reshape === 'sweep',
          )
        return
      }
      armedToolRef.current = useEditor.getState().tool
      if (event.action === 'move') {
        setSelectionAction({ bodyId: body.id, kind: 'move' })
        const editor = useEditor.getState()
        editor.setPlacementDragMode(false)
        editor.setMovingNode(body)
        useViewer.getState().setSelection({ selectedIds: [] })
        return
      }
      if (event.action === 'rotate') {
        const options = useBodyToolOptions.getState()
        const selected = options.selectedFeature
        const feature = selected ? { ...selected, autofold: options.autofold } : null
        if (
          !usePivotRotate
            .getState()
            .start(
              [body.id],
              feature && feature.bodyId === body.id ? { [body.id]: feature } : undefined,
            )
        )
          return
        setSelectionAction({ bodyId: body.id, kind: 'rotate' })
        return
      }
      if (event.action === 'scale') {
        setSelectionAction({ bodyId: body.id, kind: 'scale' })
        return
      }
      if (event.action === 'sweep') {
        setSelectedFeature(null)
        setSelectionAction({ bodyId: body.id, kind: 'sweep', faceId: null, hitPoint: null })
        return
      }
      setSelectedFeature(null)
      setSelectionAction(
        event.action === 'offset'
          ? { bodyId: body.id, kind: 'offset', faceId: null, hitPoint: null }
          : { bodyId: body.id, kind: 'push-pull', faceId: null },
      )
    }
    emitter.on('body:selection-action', onSelectionAction)
    return () => emitter.off('body:selection-action', onSelectionAction)
  }, [body, setSelectedFeature, setSelectionAction])

  useEffect(() => {
    if (!bodyId) return
    const onBodyClick = (event: BodyEvent) => {
      if (event.node.id !== bodyId) return
      const faceId = resolveBodyFaceId(event.object, event.faceIndex)
      if (!faceId) return
      if (!body) return
      const feature = selectionAction
        ? null
        : resolveBodyFeatureSelection(
            body,
            matchBodyMeasurementFeature(
              body,
              event.localPosition,
              Number.POSITIVE_INFINITY,
              (point) =>
                worldPointScreenDistance(
                  target?.localToWorld(new Vector3(...point)) ?? new Vector3(...event.position),
                  event.nativeEvent.nativeEvent,
                  camera,
                  glDomElement,
                ),
              faceId,
            )?.featureId ?? faceId,
          )
      setSelectedFeature(feature ?? { bodyId, kind: 'face', featureId: faceId })
      const action = retargetBodySelectionAction({
        action: selectionAction,
        body,
        faceId,
        hitPoint: event.localPosition,
      })
      if (action) setSelectionAction(action)
    }
    emitter.on('body:click', onBodyClick)
    return () => emitter.off('body:click', onBodyClick)
  }, [
    body,
    bodyId,
    camera,
    glDomElement,
    selectionAction,
    setSelectedFeature,
    setSelectionAction,
    target,
  ])

  useEffect(() => {
    if (!body) return
    if (!isBodyFeatureSelectionValid(body, selectedFeature)) {
      setSelectedFeature(null)
    }
  }, [body, selectedFeature, setSelectedFeature])

  const pushPullFaceId = selectionAction?.kind === 'push-pull' ? selectionAction.faceId : null
  const offsetFaceId = selectionAction?.kind === 'offset' ? selectionAction.faceId : null
  const offsetHitPoint = selectionAction?.kind === 'offset' ? selectionAction.hitPoint : null
  const sweepFaceId = selectionAction?.kind === 'sweep' ? selectionAction.faceId : null
  const sweepHitPoint = selectionAction?.kind === 'sweep' ? selectionAction.hitPoint : null
  if (!body || !target || viewMode === '2d') return null
  const selectedGeometry = selectedFeature
    ? bodyMeasurementFeatures(body).find(({ id }) => id === selectedFeature.featureId)?.geometry
    : null
  const highlight =
    selectedFeature?.kind === 'vertex' && selectedGeometry?.kind === 'point' ? (
      <mesh position={selectedGeometry.point} layers={EDITOR_LAYER} renderOrder={1003}>
        <sphereGeometry args={[0.025, 12, 8]} />
        <meshBasicMaterial color="#22d3ee" depthTest={false} depthWrite={false} />
      </mesh>
    ) : selectedFeature?.kind === 'edge' && selectedGeometry?.kind === 'segment' ? (
      <lineSegments layers={EDITOR_LAYER} renderOrder={1003}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[new Float32Array([...selectedGeometry.start, ...selectedGeometry.end]), 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial color="#22d3ee" depthTest={false} depthWrite={false} />
      </lineSegments>
    ) : null
  const action =
    pushPullFaceId || (offsetFaceId && offsetHitPoint) || (sweepFaceId && sweepHitPoint)
      ? createPortal(
          pushPullFaceId ? (
            <PushPullHandle autoStart body={body} faceId={pushPullFaceId} target={target} />
          ) : offsetFaceId && offsetHitPoint ? (
            <OffsetHandle
              autoStart
              body={body}
              faceId={offsetFaceId}
              hitPoint={offsetHitPoint}
              target={target}
            />
          ) : (
            <SweepHandle
              autoStart
              body={body}
              faceId={sweepFaceId}
              hitPoint={sweepHitPoint}
              target={target}
            />
          ),
          target.parent ?? target,
          undefined,
        )
      : null
  return (
    <>
      {highlight ? createPortal(highlight, target, undefined) : null}
      {action}
    </>
  )
}

export default BodySelectionAffordance

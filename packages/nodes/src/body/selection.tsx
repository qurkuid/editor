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
  markToolCancelConsumed,
  type Tool,
  useEditor,
  useInteractionScope,
  usePivotRotate,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { createPortal, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Object3D } from 'three'
import { resolveBodyFaceId } from './face-target'
import { OffsetHandle } from './offset-handle'
import { bodyActionToolChanged, useBodyToolOptions } from './options'
import { PushPullHandle } from './push-pull-handle'
import { retargetBodySelectionAction } from './selection-action'
import { SweepHandle } from './sweep-handle'

const BodySelectionAffordance = () => {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const glDomElement = useThree((state) => state.gl.domElement)
  const viewMode = useEditor((state) => state.viewMode)
  const tool = useEditor((state) => state.tool)
  const body = useScene((state) => {
    if (selectedIds.length !== 1) return null
    const node = state.nodes[selectedIds[0] as AnyNodeId]
    return node?.type === 'body' ? (node as BodyNode) : null
  })
  const [target, setTarget] = useState<Object3D | null>(null)
  const selectedFace = useBodyToolOptions((state) => state.selectedFace)
  const setSelectedFace = useBodyToolOptions((state) => state.setSelectedFace)
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
        if (!usePivotRotate.getState().start([body.id])) return
        setSelectionAction({ bodyId: body.id, kind: 'rotate' })
        return
      }
      if (event.action === 'scale') {
        setSelectionAction({ bodyId: body.id, kind: 'scale' })
        return
      }
      if (event.action === 'sweep') {
        setSelectedFace(null)
        setSelectionAction({ bodyId: body.id, kind: 'sweep', faceId: null, hitPoint: null })
        return
      }
      setSelectedFace(null)
      setSelectionAction(
        event.action === 'offset'
          ? { bodyId: body.id, kind: 'offset', faceId: null, hitPoint: null }
          : { bodyId: body.id, kind: 'push-pull', faceId: null },
      )
    }
    emitter.on('body:selection-action', onSelectionAction)
    return () => emitter.off('body:selection-action', onSelectionAction)
  }, [body, setSelectedFace, setSelectionAction])

  useEffect(() => {
    if (!bodyId) return
    const onBodyClick = (event: BodyEvent) => {
      if (event.node.id !== bodyId) return
      const faceId = resolveBodyFaceId(event.object, event.faceIndex)
      if (!faceId) return
      setSelectedFace({ bodyId, faceId })
      if (!body) return
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
  }, [body, bodyId, selectionAction, setSelectedFace, setSelectionAction])

  useEffect(() => {
    if (!body) return
    if (
      selectedFace?.bodyId !== body.id ||
      !body.faces.some((face) => face.id === selectedFace.faceId)
    ) {
      const faceId = body.faces[0]?.id
      setSelectedFace(faceId ? { bodyId: body.id, faceId } : null)
    }
  }, [body, selectedFace, setSelectedFace])

  const pushPullFaceId = selectionAction?.kind === 'push-pull' ? selectionAction.faceId : null
  const offsetFaceId = selectionAction?.kind === 'offset' ? selectionAction.faceId : null
  const offsetHitPoint = selectionAction?.kind === 'offset' ? selectionAction.hitPoint : null
  const sweepFaceId = selectionAction?.kind === 'sweep' ? selectionAction.faceId : null
  const sweepHitPoint = selectionAction?.kind === 'sweep' ? selectionAction.hitPoint : null
  if (
    !body ||
    !target ||
    viewMode === '2d' ||
    (!pushPullFaceId && !(offsetFaceId && offsetHitPoint) && !(sweepFaceId && sweepHitPoint))
  )
    return null
  const mount = target.parent ?? target
  return createPortal(
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
    mount,
    undefined,
  )
}

export default BodySelectionAffordance

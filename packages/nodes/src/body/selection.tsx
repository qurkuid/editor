'use client'

import {
  type AnyNodeId,
  type BodyEvent,
  type BodyNode,
  emitter,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { createPortal } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import type { Object3D } from 'three'
import { resolveBodyFaceId } from './face-target'
import { useBodyToolOptions } from './options'
import { PushPullHandle } from './push-pull-handle'

const BodySelectionAffordance = () => {
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const viewMode = useEditor((state) => state.viewMode)
  const body = useScene((state) => {
    if (selectedIds.length !== 1) return null
    const node = state.nodes[selectedIds[0] as AnyNodeId]
    return node?.type === 'body' ? (node as BodyNode) : null
  })
  const [target, setTarget] = useState<Object3D | null>(null)
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null)
  const pendingFace = useBodyToolOptions((state) => state.pendingFace)
  const setPendingFace = useBodyToolOptions((state) => state.setPendingFace)
  const bodyId = body?.id ?? null

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

  useEffect(() => {
    if (!bodyId) return
    const onBodyClick = (event: BodyEvent) => {
      if (event.node.id !== bodyId) return
      const faceId = resolveBodyFaceId(event.object)
      if (faceId) setSelectedFaceId(faceId)
    }
    emitter.on('body:click', onBodyClick)
    return () => emitter.off('body:click', onBodyClick)
  }, [bodyId])

  useEffect(() => {
    if (!body) return
    if (!selectedFaceId || !body.faces.some((face) => face.id === selectedFaceId)) {
      setSelectedFaceId(body.faces[0]?.id ?? null)
    }
  }, [body, selectedFaceId])

  useEffect(() => {
    if (!body || !pendingFace || pendingFace.bodyId !== body.id) return
    if (!body.faces.some((face) => face.id === pendingFace.faceId)) return
    setSelectedFaceId(pendingFace.faceId)
    setPendingFace(null)
  }, [body, pendingFace, setPendingFace])

  if (!body || !target || viewMode === '2d') return null
  const mount = target.parent ?? target
  return createPortal(
    <PushPullHandle body={body} faceId={selectedFaceId} target={target} />,
    mount,
    undefined,
  )
}

export default BodySelectionAffordance

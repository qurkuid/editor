'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type BodyEvent,
  type BodyNode,
  emitter,
  getBodyFaceFrame,
  pauseSceneHistory,
  pushPullBodyFace,
  resumeSceneHistory,
  sceneRegistry,
  useScene,
} from '@pascal-app/core'
import {
  DimensionPill,
  parseDraftLength,
  swallowNextClick,
  triggerSFX,
  useDraftLengthInput,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { createPortal, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Group, type Object3D, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { resolveBodyFaceId } from './face-target'
import { resolvePushPullDistance } from './push-pull'

const MIN_DISTANCE = 0.000001

type ActivePushPull = {
  source: BodyNode
  faceId: string
  cursorDistance: number
  distance: number
  cleanup: () => void
}

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

  if (!body || !target || viewMode === '2d') return null
  const mount = target.parent ?? target
  return createPortal(
    <PushPullHandle body={body} faceId={selectedFaceId} target={target} />,
    mount,
    undefined,
  )
}

function PushPullHandle({
  body,
  faceId,
  target,
}: {
  body: BodyNode
  faceId: string | null
  target: Object3D
}) {
  const { camera, gl } = useThree()
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const outerRef = useRef<Group>(null)
  const dragRef = useRef<ActivePushPull | null>(null)
  const finishRef = useRef<(cancelled: boolean) => void>(() => {})
  const applyDistanceRef = useRef<(typedLength?: number | null) => void>(() => {})
  const [dragging, setDragging] = useState(false)
  const {
    clear: clearLength,
    getLengthMeters,
    raw,
  } = useDraftLengthInput(() => dragRef.current !== null)

  useFrame(() => {
    const outer = outerRef.current
    if (!outer) return
    outer.position.copy(target.position)
    outer.quaternion.copy(target.quaternion)
    outer.scale.copy(target.scale)
  })

  const source = dragRef.current?.source ?? body
  const face = source.faces.find((candidate) => candidate.id === faceId) ?? null
  const eligible =
    face !== null &&
    face.innerLoopIds.length === 0 &&
    source.halfEdges
      .filter((edge) => edge.loopId === face.outerLoopId)
      .every((edge) => edge.curveId === undefined)
  const frame = useMemo(() => {
    const currentFaceId = dragRef.current?.faceId ?? faceId
    if (!currentFaceId) return null
    try {
      return getBodyFaceFrame(body, currentFaceId)
    } catch {
      return face ? getBodyFaceFrame(source, face.id) : null
    }
  }, [body, face, faceId, source])

  const applyDistance = useCallback(
    (typedLength?: number | null) => {
      const active = dragRef.current
      if (!active) return
      const distance = resolvePushPullDistance(
        active.cursorDistance,
        typedLength === undefined ? getLengthMeters() : typedLength,
      )
      if (Math.abs(distance) < MIN_DISTANCE) return
      const result = pushPullBodyFace(active.source, active.faceId, distance)
      active.distance = distance
      useScene.getState().updateNode(active.source.id as AnyNodeId, result.body as Partial<AnyNode>)
    },
    [getLengthMeters],
  )
  applyDistanceRef.current = applyDistance

  const typedLengthMeters = useMemo(
    () => parseDraftLength(raw, unit, metricNotation),
    [metricNotation, raw, unit],
  )
  useEffect(() => {
    if (dragRef.current) applyDistanceRef.current(typedLengthMeters)
  }, [typedLengthMeters])

  const finish = useCallback(
    (cancelled: boolean) => {
      const active = dragRef.current
      if (!active) return
      active.cleanup()
      dragRef.current = null
      useScene
        .getState()
        .updateNode(active.source.id as AnyNodeId, active.source as Partial<AnyNode>)
      resumeSceneHistory(useScene)
      if (!cancelled && Math.abs(active.distance) >= MIN_DISTANCE) {
        const result = pushPullBodyFace(active.source, active.faceId, active.distance)
        useScene
          .getState()
          .updateNode(active.source.id as AnyNodeId, result.body as Partial<AnyNode>)
        triggerSFX('sfx:structure-build')
      }
      clearLength()
      useViewer.getState().setInputDragging(false)
      document.body.style.cursor = ''
      setDragging(false)
    },
    [clearLength],
  )
  finishRef.current = finish

  useEffect(
    () => () => {
      if (dragRef.current) finishRef.current(true)
    },
    [],
  )

  const begin = useCallback(() => {
    if (!eligible || !frame || !face || dragRef.current) return
    pauseSceneHistory(useScene)
    clearLength()
    useViewer.getState().setInputDragging(true)
    document.body.style.cursor = 'ns-resize'
    setDragging(true)

    const anchorWorld = target.localToWorld(new Vector3(...frame.centroid))
    const normalWorld = new Vector3(...frame.normal).transformDirection(target.matrixWorld)
    const viewDirection = camera.getWorldDirection(new Vector3())
    const planeNormal = new Vector3().crossVectors(normalWorld, viewDirection)
    if (planeNormal.lengthSq() < 0.000001) planeNormal.crossVectors(normalWorld, camera.up)
    planeNormal.normalize()
    const dragPlane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, anchorWorld)
    const raycaster = new Raycaster()
    let clickFrame = 0

    const onPointerMove = (event: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      const pointer = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera)
      const hit = new Vector3()
      if (!raycaster.ray.intersectPlane(dragPlane, hit)) return
      const localHit = target.worldToLocal(hit.clone())
      const delta = localHit.sub(new Vector3(...frame.centroid))
      const active = dragRef.current
      if (!active) return
      active.cursorDistance = delta.dot(new Vector3(...frame.normal))
      applyDistanceRef.current()
    }
    const onCommit = (event: MouseEvent) => {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      swallowNextClick()
      finishRef.current(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      finishRef.current(true)
    }
    const cleanup = () => {
      window.cancelAnimationFrame(clickFrame)
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('click', onCommit, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
    dragRef.current = { source: body, faceId: face.id, cursorDistance: 0, distance: 0, cleanup }
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('keydown', onKeyDown, true)
    clickFrame = window.requestAnimationFrame(() => {
      window.addEventListener('click', onCommit, true)
    })
  }, [body, camera, clearLength, eligible, face, frame, gl.domElement, target])

  if ((!eligible && !dragging) || !frame) return null
  const position = [
    frame.centroid[0] + frame.normal[0] * 0.18,
    frame.centroid[1] + frame.normal[1] * 0.18,
    frame.centroid[2] + frame.normal[2] * 0.18,
  ] as [number, number, number]

  return (
    <group ref={outerRef}>
      <Html center position={position} zIndexRange={[100, 0]}>
        {dragging ? (
          <div className="pointer-events-none">
            <DimensionPill
              parts={[
                {
                  key: 'distance',
                  prefix: 'Push/Pull',
                  value: dragRef.current?.distance ?? 0,
                  signed: true,
                },
              ]}
              primary="distance"
              unit={unit}
            />
          </div>
        ) : (
          <button
            className="whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-3 py-1.5 font-medium text-foreground text-xs shadow-md backdrop-blur hover:bg-accent"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              begin()
            }}
            type="button"
          >
            Push/Pull
          </button>
        )}
      </Html>
    </group>
  )
}

export default BodySelectionAffordance

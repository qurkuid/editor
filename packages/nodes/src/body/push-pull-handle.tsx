'use client'

import { type BodyNode, getBodyFaceFrame, sceneRegistry } from '@pascal-app/core'
import {
  isGridSnapActive,
  isMagneticSnapActive,
  parseDraftLength,
  swallowNextClick,
  triggerSFX,
  useDraftLengthInput,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Group, type Object3D, Plane, Raycaster, Vector2, Vector3 } from 'three'
import {
  associateSurfaceHit,
  createMeasurementSurfaceQuerySession,
} from '../measurement/surface-query'
import { isBodyFaceImprintEligible, isBodyFacePushPullEligible } from './face-imprint-geometry'
import { resolvePushPullDistance } from './push-pull'
import { PushPullFaceActions } from './push-pull-face-actions'
import { type BodyPushPullSession, createBodyPushPullSession } from './push-pull-session'
import { projectPushPullSnapDistance, snapPushPullDistanceToGrid } from './push-pull-snap'

const PUSH_PULL_HANDLE = 'body:push-pull'

type PushPullHandleProps = {
  readonly body: BodyNode
  readonly faceId: string | null
  readonly target: Object3D
}

export function PushPullHandle({ body, faceId, target }: PushPullHandleProps) {
  const { camera, gl, scene } = useThree()
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const surfaceQuery = useMemo(
    () => createMeasurementSurfaceQuerySession(scene, { excludeNodeIds: [body.id] }),
    [body.id, scene],
  )
  const outerRef = useRef<Group>(null)
  const sessionRef = useRef<BodyPushPullSession | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const cursorDistanceRef = useRef(0)
  const finishRef = useRef<(cancelled: boolean) => void>(() => {})
  const applyDistanceRef = useRef<(typedLength?: number | null) => void>(() => {})
  const [dragging, setDragging] = useState(false)
  const [distance, setDistance] = useState(0)
  const {
    clear: clearLength,
    getLengthMeters,
    raw,
  } = useDraftLengthInput(() => sessionRef.current !== null)

  useFrame(() => {
    const outer = outerRef.current
    if (!outer) return
    outer.position.copy(target.position)
    outer.quaternion.copy(target.quaternion)
    outer.scale.copy(target.scale)
  })

  useEffect(() => () => surfaceQuery.dispose(), [surfaceQuery])

  const face = body.faces.find((candidate) => candidate.id === faceId) ?? null
  const eligible = faceId !== null && isBodyFacePushPullEligible(body, faceId)
  const imprintEligible = face !== null && isBodyFaceImprintEligible(body, face.id)
  const frame = useMemo(() => {
    if (!faceId) return null
    try {
      return getBodyFaceFrame(body, faceId)
    } catch {
      return null
    }
  }, [body, faceId])

  const applyDistance = useCallback(
    (cursorDistance: number, typedLength?: number | null) => {
      const session = sessionRef.current
      if (!session) return
      const distance = resolvePushPullDistance(
        cursorDistance,
        typedLength === undefined ? getLengthMeters() : typedLength,
      )
      if (session.preview(distance)) setDistance(distance)
    },
    [getLengthMeters],
  )

  const typedLengthMeters = useMemo(
    () => parseDraftLength(raw, unit, metricNotation),
    [metricNotation, raw, unit],
  )

  useEffect(() => {
    const session = sessionRef.current
    if (!session) return
    applyDistanceRef.current(typedLengthMeters)
  }, [typedLengthMeters])

  const finish = useCallback(
    (cancelled: boolean) => {
      const session = sessionRef.current
      if (!session) return
      cleanupRef.current?.()
      cleanupRef.current = null
      cursorDistanceRef.current = 0
      sessionRef.current = null
      const committed = cancelled ? false : session.commit()
      if (cancelled) session.cancel()
      if (committed) triggerSFX('sfx:structure-build')
      clearLength()
      useViewer.getState().setInputDragging(false)
      document.body.style.cursor = ''
      setDistance(0)
      setDragging(false)
    },
    [clearLength],
  )
  finishRef.current = finish

  useEffect(
    () => () => {
      if (sessionRef.current) finishRef.current(true)
    },
    [],
  )

  const begin = useCallback(() => {
    if (!eligible || !frame || !face || sessionRef.current) return
    clearLength()
    useViewer.getState().setInputDragging(true)
    document.body.style.cursor = 'ns-resize'
    setDragging(true)
    cursorDistanceRef.current = 0

    const anchorWorld = target.localToWorld(new Vector3(...frame.centroid))
    const normalWorld = new Vector3(...frame.normal).transformDirection(target.matrixWorld)
    const viewDirection = camera.getWorldDirection(new Vector3())
    const planeNormal = new Vector3().crossVectors(normalWorld, viewDirection)
    if (planeNormal.lengthSq() < 0.000001) planeNormal.crossVectors(normalWorld, camera.up)
    planeNormal.normalize()
    const dragPlane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, anchorWorld)
    const raycaster = new Raycaster()
    const bodyAnchor = frame.centroid
    const bodyNormal = frame.normal
    const levelObject =
      (body.parentId ? sceneRegistry.nodes.get(body.parentId) : undefined) ?? target.parent ?? scene
    let clickFrame = 0

    const previewFromCursor = (cursorDistance: number, typedLength?: number | null) => {
      applyDistance(cursorDistance, typedLength)
    }
    applyDistanceRef.current = (typedLength) =>
      previewFromCursor(cursorDistanceRef.current, typedLength)

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
      let cursorDistance = delta.dot(new Vector3(...frame.normal))
      if (isMagneticSnapActive()) {
        const resolved = surfaceQuery.resolvePointer({
          event,
          camera,
          canvas: gl.domElement,
          levelObject,
          anchorOrAnchors: null,
          applyMagneticSnap: true,
          showAlignmentGuides: false,
        })
        if (resolved) {
          const associated = associateSurfaceHit(resolved.hit)
          const snapWorld = levelObject.localToWorld(new Vector3(...associated.point))
          const snapLocal = target.worldToLocal(snapWorld.clone())
          cursorDistance = projectPushPullSnapDistance({
            anchor: bodyAnchor,
            normal: bodyNormal,
            point: [snapLocal.x, snapLocal.y, snapLocal.z],
          })
        }
      } else if (isGridSnapActive()) {
        cursorDistance = snapPushPullDistanceToGrid(
          cursorDistance,
          useEditor.getState().gridSnapStep,
        )
      }
      cursorDistanceRef.current = cursorDistance
      previewFromCursor(cursorDistanceRef.current)
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
    cleanupRef.current = () => {
      window.cancelAnimationFrame(clickFrame)
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('click', onCommit, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
    sessionRef.current = createBodyPushPullSession({
      body,
      faceId: face.id,
      handle: PUSH_PULL_HANDLE,
    })
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('keydown', onKeyDown, true)
    clickFrame = window.requestAnimationFrame(() => {
      window.addEventListener('click', onCommit, true)
    })
  }, [
    applyDistance,
    body,
    camera,
    clearLength,
    eligible,
    face,
    frame,
    gl.domElement,
    scene,
    surfaceQuery,
    target,
  ])

  if ((!eligible && !dragging) || !frame || !face) return null
  const position: [number, number, number] = [
    frame.centroid[0] + frame.normal[0] * 0.18,
    frame.centroid[1] + frame.normal[1] * 0.18,
    frame.centroid[2] + frame.normal[2] * 0.18,
  ]

  return (
    <group ref={outerRef}>
      <Html center position={position} zIndexRange={[100, 0]}>
        <PushPullFaceActions
          bodyId={body.id}
          distance={distance}
          dragging={dragging}
          faceId={face.id}
          imprintEligible={imprintEligible}
          onBegin={begin}
        />
      </Html>
    </group>
  )
}

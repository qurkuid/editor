'use client'

import { type BodyNode, getBodyFaceFrame, sceneRegistry } from '@pascal-app/core'
import {
  isGridSnapActive,
  isMagneticSnapActive,
  parseDraftLength,
  swallowNextClick,
  triggerSFX,
  useDraftLengthHud,
  useDraftLengthInput,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Html } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Group, type Object3D, Raycaster, Vector2, Vector3 } from 'three'
import {
  associateSurfaceHit,
  createMeasurementSurfaceQuerySession,
} from '../measurement/surface-query'
import {
  isBodyFaceImprintEligible,
  isBodyFacePushPullEligible,
  isBodyFaceSplitEligible,
} from './face-imprint-geometry'
import { useBodyToolOptions } from './options'
import { resolvePushPullDistance } from './push-pull'
import { PushPullFaceActions } from './push-pull-face-actions'
import { type BodyPushPullSession, createBodyPushPullSession } from './push-pull-session'
import {
  projectPushPullDistance,
  resolvePushPullRayCandidate,
  snapPushPullDistanceToGrid,
} from './push-pull-snap'

const PUSH_PULL_HANDLE = 'body:push-pull'

type PushPullHandleProps = {
  readonly body: BodyNode
  readonly faceId: string | null
  readonly target: Object3D
  readonly autoStart?: boolean
}

export function PushPullHandle({ autoStart = false, body, faceId, target }: PushPullHandleProps) {
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
  const hasValidPreviewRef = useRef(false)
  const finishRef = useRef<(cancelled: boolean) => void>(() => {})
  const applyDistanceRef = useRef<(typedLength?: number | null) => void>(() => {})
  const [dragging, setDragging] = useState(false)
  const [distance, setDistance] = useState(0)
  const [previewValid, setPreviewValid] = useState(false)
  const {
    clear: clearLength,
    getLengthMeters,
    raw,
  } = useDraftLengthInput(() => sessionRef.current !== null, {
    onEscape: () => finishRef.current(true),
  })

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
  const imprintEligible =
    face !== null &&
    (isBodyFaceImprintEligible(body, face.id) || isBodyFaceSplitEligible(body, face.id))
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
      const typedRaw = useDraftLengthHud.getState().raw.trim()
      const typedInput = typedRaw.length > 0
      const typedValue = typedLength === undefined ? getLengthMeters() : typedLength
      const distance =
        typedInput && (typedValue === null || !Number.isFinite(typedValue))
          ? Number.NaN
          : resolvePushPullDistance(cursorDistance, typedValue)
      const valid = session.preview(distance)
      hasValidPreviewRef.current = valid
      setPreviewValid(valid)
      useDraftLengthHud.getState().setPreviewInvalid(!valid)
      setDistance(valid ? distance : 0)
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
      hasValidPreviewRef.current = false
      setPreviewValid(false)
      sessionRef.current = null
      const committed = cancelled || !session.canCommit() ? false : session.commit()
      if (cancelled || !committed) session.cancel()
      if (committed) triggerSFX('sfx:structure-build')
      clearLength()
      useDraftLengthHud.getState().setPreviewInvalid(false)
      useViewer.getState().setInputDragging(false)
      document.body.style.cursor = ''
      setDistance(0)
      setDragging(false)
      useBodyToolOptions.getState().setSelectionAction(null)
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
    useDraftLengthHud.getState().setPreviewInvalid(false)
    useViewer.getState().setInputDragging(true)
    document.body.style.cursor = 'ns-resize'
    setDragging(true)
    cursorDistanceRef.current = 0
    hasValidPreviewRef.current = false
    setPreviewValid(false)

    const anchorWorld = target.localToWorld(new Vector3(...frame.centroid))
    const normalWorld = new Vector3(...frame.normal)
      .transformDirection(target.matrixWorld)
      .normalize()
    const anchorPoint: [number, number, number] = [anchorWorld.x, anchorWorld.y, anchorWorld.z]
    const normalPoint: [number, number, number] = [normalWorld.x, normalWorld.y, normalWorld.z]
    const raycaster = new Raycaster()
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
      const candidate = resolvePushPullRayCandidate({
        rayOrigin: [raycaster.ray.origin.x, raycaster.ray.origin.y, raycaster.ray.origin.z],
        rayDirection: [
          raycaster.ray.direction.x,
          raycaster.ray.direction.y,
          raycaster.ray.direction.z,
        ],
        anchor: anchorPoint,
        normal: normalPoint,
      })
      if (!candidate) return
      let cursorDistance = projectPushPullDistance({
        anchor: anchorPoint,
        normal: normalPoint,
        point: candidate,
      })
      if (!event.altKey && isMagneticSnapActive()) {
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
          cursorDistance = projectPushPullDistance({
            anchor: anchorPoint,
            normal: normalPoint,
            point: [snapWorld.x, snapWorld.y, snapWorld.z],
          })
        }
      } else if (!event.altKey && isGridSnapActive()) {
        cursorDistance = snapPushPullDistanceToGrid(
          cursorDistance,
          useEditor.getState().gridSnapStep,
        )
      }
      cursorDistanceRef.current = cursorDistance
      previewFromCursor(cursorDistanceRef.current)
    }
    const onCommit = (event: MouseEvent) => {
      if (!hasValidPreviewRef.current) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      swallowNextClick()
      finishRef.current(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' && event.key !== 'Enter') return
      if (event.key === 'Enter' && !hasValidPreviewRef.current) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      finishRef.current(event.key === 'Escape')
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

  useEffect(() => {
    if (!autoStart) return
    const frameId = window.requestAnimationFrame(begin)
    return () => window.cancelAnimationFrame(frameId)
  }, [autoStart, begin])

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
          previewValid={previewValid}
        />
      </Html>
    </group>
  )
}

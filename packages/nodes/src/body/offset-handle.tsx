'use client'

import { type BodyNode, getBodyFaceFrame, sceneRegistry } from '@pascal-app/core'
import {
  EDITOR_LAYER,
  isGridSnapActive,
  isMagneticSnapActive,
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
import {
  BufferGeometry,
  type Group,
  Line,
  LineBasicMaterial,
  type Object3D,
  Plane,
  Raycaster,
  Vector2,
  Vector3,
} from 'three'
import {
  associateSurfaceHit,
  createMeasurementSurfaceQuerySession,
} from '../measurement/surface-query'
import { isBodyFaceOffsetEligible } from './face-imprint-geometry'
import { OffsetFaceActions } from './offset-face-actions'
import { createOffsetPointerInteraction, resolveOffsetPointerDistance } from './offset-interaction'
import {
  type BodyOffsetPreviewPoint,
  type BodyOffsetSession,
  createBodyOffsetSession,
} from './offset-session'
import { useBodyToolOptions } from './options'
import { snapPushPullDistanceToGrid } from './push-pull-snap'

const OFFSET_HANDLE = 'body:offset'

type OffsetHandleProps = {
  readonly body: BodyNode
  readonly faceId: string | null
  readonly hitPoint: readonly [number, number, number] | null
  readonly target: Object3D
  readonly autoStart?: boolean
}

export function resolveOffsetDistance(
  cursorDistance: number,
  typedDistance: number | null,
  typedInput = false,
): number {
  return typedInput ? (typedDistance ?? Number.NaN) : (typedDistance ?? cursorDistance)
}

export function resolveOffsetDisplayDistance(distance: number): number {
  return Number.isFinite(distance) ? distance : 0
}

export function OffsetHandle({
  autoStart = false,
  body,
  faceId,
  hitPoint,
  target,
}: OffsetHandleProps) {
  const { camera, gl, scene } = useThree()
  const surfaceQuery = useMemo(
    () => createMeasurementSurfaceQuerySession(scene, { excludeNodeIds: [body.id] }),
    [body.id, scene],
  )
  const outerRef = useRef<Group>(null)
  const sessionRef = useRef<BodyOffsetSession | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const cursorDistanceRef = useRef(0)
  const hasValidPreviewRef = useRef(false)
  const finishRef = useRef<(cancelled: boolean) => void>(() => {})
  const applyDistanceRef = useRef<(typedLength?: number | null) => void>(() => {})
  const [dragging, setDragging] = useState(false)
  const [distance, setDistance] = useState(0)
  const [previewValid, setPreviewValid] = useState(false)
  const [previewOutlinePoints, setPreviewOutlinePoints] = useState<BodyOffsetPreviewPoint[] | null>(
    null,
  )
  const {
    clear: clearLength,
    getLengthMeters,
    raw,
  } = useDraftLengthInput(() => sessionRef.current !== null, {
    onEscape: () => finishRef.current(true),
    signed: true,
  })
  const typedLengthMeters = useMemo(
    () => (raw.trim() ? getLengthMeters() : null),
    [getLengthMeters, raw],
  )

  useFrame(() => {
    const outer = outerRef.current
    if (!outer) return
    outer.position.copy(target.position)
    outer.quaternion.copy(target.quaternion)
    outer.scale.copy(target.scale)
  })

  useEffect(() => () => surfaceQuery.dispose(), [surfaceQuery])

  const face = body.faces.find((candidate) => candidate.id === faceId) ?? null
  const eligible = faceId !== null && isBodyFaceOffsetEligible(body, faceId)
  const frame = useMemo(() => {
    if (!faceId) return null
    try {
      return getBodyFaceFrame(body, faceId)
    } catch {
      return null
    }
  }, [body, faceId])
  const interaction = useMemo(
    () => (faceId && hitPoint ? createOffsetPointerInteraction(body, faceId, hitPoint) : null),
    [body, faceId, hitPoint],
  )

  const applyDistance = useCallback(
    (cursorDistance: number, typedLength?: number | null) => {
      const session = sessionRef.current
      if (!session) return
      const typedInput = useDraftLengthHud.getState().raw.trim().length > 0
      const nextDistance = resolveOffsetDistance(
        cursorDistance,
        typedLength === undefined ? getLengthMeters() : typedLength,
        typedInput,
      )
      const valid = session.preview(nextDistance)
      hasValidPreviewRef.current = valid
      setPreviewValid(valid)
      setPreviewOutlinePoints(valid ? session.previewFaceLoopPoints() : null)
      useDraftLengthHud.getState().setPreviewInvalid(!valid)
      setDistance(resolveOffsetDisplayDistance(nextDistance))
    },
    [getLengthMeters],
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
      setPreviewOutlinePoints(null)
      const createdFaceId = session.createdFaceId()
      sessionRef.current = null
      const committed = cancelled || !session.canCommit() ? false : session.commit()
      if (cancelled || !committed) session.cancel()
      if (committed) triggerSFX('sfx:structure-build')
      if (committed && createdFaceId) {
        useBodyToolOptions.getState().setSelectedFace({ bodyId: body.id, faceId: createdFaceId })
      }
      clearLength()
      useViewer.getState().setInputDragging(false)
      document.body.style.cursor = ''
      setDistance(0)
      setDragging(false)
      useBodyToolOptions.getState().setSelectionAction(null)
    },
    [body.id, clearLength],
  )
  finishRef.current = finish

  useEffect(
    () => () => {
      if (sessionRef.current) finishRef.current(true)
    },
    [],
  )

  const begin = useCallback(() => {
    if (!eligible || !frame || !face || !interaction || !hitPoint || sessionRef.current) return
    clearLength()
    useDraftLengthHud.getState().setSignedMode(true)
    useViewer.getState().setInputDragging(true)
    document.body.style.cursor = 'ns-resize'
    setDragging(true)
    cursorDistanceRef.current = 0
    hasValidPreviewRef.current = false
    setPreviewValid(false)
    setPreviewOutlinePoints(null)

    const anchorWorld = target.localToWorld(new Vector3(...hitPoint))
    const normalWorld = new Vector3(...frame.normal).transformDirection(target.matrixWorld)
    normalWorld.normalize()
    const dragPlane = new Plane().setFromNormalAndCoplanarPoint(normalWorld, anchorWorld)
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
      const hit = new Vector3()
      if (!raycaster.ray.intersectPlane(dragPlane, hit)) return
      const localHit = target.worldToLocal(hit.clone())
      let cursorDistance = resolveOffsetPointerDistance(interaction, [
        localHit.x,
        localHit.y,
        localHit.z,
      ])
      if (cursorDistance === null) return
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
          const snapLocal = target.worldToLocal(snapWorld.clone())
          cursorDistance = resolveOffsetPointerDistance(interaction, [
            snapLocal.x,
            snapLocal.y,
            snapLocal.z,
          ])
          if (cursorDistance === null) return
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
    sessionRef.current = createBodyOffsetSession({
      body,
      faceId: face.id,
      handle: OFFSET_HANDLE,
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
    hitPoint,
    interaction,
    scene,
    surfaceQuery,
    target,
  ])

  useEffect(() => {
    if (!autoStart) return
    const frameId = window.requestAnimationFrame(begin)
    return () => window.cancelAnimationFrame(frameId)
  }, [autoStart, begin])

  const previewOutline = useMemo(() => {
    if (!previewOutlinePoints) return null
    const [firstPoint, ...remainingPoints] = previewOutlinePoints
    if (!firstPoint) return null
    const geometry = new BufferGeometry().setFromPoints(
      [firstPoint, ...remainingPoints, firstPoint].map((point) => new Vector3(...point)),
    )
    const line = new Line(
      geometry,
      new LineBasicMaterial({
        color: 0x6ca3ff,
        depthTest: false,
        depthWrite: false,
        opacity: 0.95,
        transparent: true,
      }),
    )
    line.layers.set(EDITOR_LAYER)
    line.renderOrder = 1002
    line.frustumCulled = false
    line.raycast = () => {}
    return line
  }, [previewOutlinePoints])

  useEffect(() => {
    if (!previewOutline) return
    return () => {
      previewOutline.geometry.dispose()
      const material = previewOutline.material
      if (Array.isArray(material)) {
        material.forEach((entry) => {
          entry.dispose()
        })
      } else material.dispose()
    }
  }, [previewOutline])

  if ((!eligible && !dragging) || !frame || !face || !interaction) return null
  const position: [number, number, number] = [
    frame.centroid[0] + frame.normal[0] * 0.18,
    frame.centroid[1] + frame.normal[1] * 0.18,
    frame.centroid[2] + frame.normal[2] * 0.18,
  ]

  return (
    <group ref={outerRef}>
      {previewOutline ? <primitive object={previewOutline} /> : null}
      <Html center position={position} zIndexRange={[100, 0]}>
        <OffsetFaceActions
          distance={distance}
          dragging={dragging}
          onBegin={begin}
          previewValid={previewValid}
        />
      </Html>
    </group>
  )
}

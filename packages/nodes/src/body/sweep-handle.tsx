'use client'

import { type BodyNode, getBodyFaceFrame } from '@pascal-app/core'
import {
  constrainSpatialDraftPoint,
  isGridSnapActive,
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
import { type Group, type Object3D, Plane, Raycaster, Vector2, Vector3 } from 'three'
import { isBodyFaceSweepEligible } from './face-imprint-geometry'
import { useBodyToolOptions } from './options'
import { SweepFaceActions } from './sweep-face-actions'
import { type BodySweepSession, createBodySweepSession } from './sweep-session'

const SNAP_EPSILON = 0.04

type SweepHandleProps = {
  readonly body: BodyNode
  readonly faceId: string | null
  readonly hitPoint: readonly [number, number, number] | null
  readonly target: Object3D
  readonly autoStart?: boolean
}

function snapLength(value: number, step: number): number {
  return Math.round(value / step) * step
}

function distanceBetween(first: readonly [number, number, number], second: Vector3): number {
  return Math.hypot(first[0] - second.x, first[1] - second.y, first[2] - second.z)
}

export function SweepHandle({
  autoStart = false,
  body,
  faceId,
  hitPoint,
  target,
}: SweepHandleProps) {
  const { camera, gl } = useThree()
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const outerRef = useRef<Group>(null)
  const sessionRef = useRef<BodySweepSession | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const pathRef = useRef<[number, number, number][]>([])
  const cursorRef = useRef<Vector3 | null>(null)
  const candidateRef = useRef<[number, number, number] | null>(null)
  const altRef = useRef(false)
  const previewValidRef = useRef(false)
  const applyCursorRef = useRef<() => void>(() => {})
  const finishRef = useRef<(cancelled: boolean) => void>(() => {})
  const [pathPoints, setPathPoints] = useState<readonly [number, number, number][]>([])
  const [dragging, setDragging] = useState(false)
  const [previewValid, setPreviewValid] = useState(false)
  const [closed, setClosed] = useState(false)
  const { clear: clearLength, raw } = useDraftLengthInput(() => sessionRef.current !== null)

  const face = body.faces.find((candidate) => candidate.id === faceId) ?? null
  const frame = useMemo(() => {
    if (!faceId) return null
    try {
      return getBodyFaceFrame(body, faceId)
    } catch {
      return null
    }
  }, [body, faceId])
  const typedLengthMeters = useMemo(
    () => parseDraftLength(raw, unit, metricNotation),
    [metricNotation, raw, unit],
  )

  useFrame(() => {
    const outer = outerRef.current
    if (!outer) return
    outer.position.copy(target.position)
    outer.quaternion.copy(target.quaternion)
    outer.scale.copy(target.scale)
  })

  const preview = useCallback((nextPath: readonly [number, number, number][]) => {
    const session = sessionRef.current
    if (!session) return false
    const valid = session.preview(nextPath)
    previewValidRef.current = valid
    setPreviewValid(valid)
    useDraftLengthHud.getState().setPreviewInvalid(!valid)
    return valid
  }, [])

  const finish = useCallback(
    (cancelled: boolean) => {
      const session = sessionRef.current
      if (!session) return
      cleanupRef.current?.()
      cleanupRef.current = null
      sessionRef.current = null
      const committed = !cancelled && session.canCommit() && session.commit()
      if (!committed) session.cancel()
      if (committed) triggerSFX('sfx:structure-build')
      clearLength()
      useDraftLengthHud.getState().setPreviewInvalid(false)
      useViewer.getState().setInputDragging(false)
      document.body.style.cursor = ''
      setDragging(false)
      setPreviewValid(false)
      previewValidRef.current = false
      setClosed(false)
      pathRef.current = []
      candidateRef.current = null
      setPathPoints([])
      useBodyToolOptions.getState().setSelectionAction(null)
    },
    [clearLength],
  )
  finishRef.current = finish

  const applyCursor = useCallback(() => {
    const cursor = cursorRef.current
    const frameValue = frame
    const currentPath = pathRef.current
    if (!cursor || !frameValue || currentPath.length === 0) return
    const previous = currentPath[currentPath.length - 1]!
    const normal = new Vector3(...frameValue.normal).normalize()
    let next: [number, number, number]
    if (currentPath.length === 1) {
      let signedLength = new Vector3(previous[0], previous[1], previous[2])
        .sub(cursor)
        .multiplyScalar(-1)
        .dot(normal)
      if (isGridSnapActive() && !altRef.current) {
        signedLength = snapLength(signedLength, useEditor.getState().gridSnapStep)
      }
      if (typedLengthMeters !== null)
        signedLength = signedLength < 0 ? -typedLengthMeters : typedLengthMeters
      next = [
        previous[0] + normal.x * signedLength,
        previous[1] + normal.y * signedLength,
        previous[2] + normal.z * signedLength,
      ]
    } else {
      const rawPoint: [number, number, number] = [cursor.x, cursor.y, cursor.z]
      const distance = Math.hypot(
        rawPoint[0] - previous[0],
        rawPoint[1] - previous[1],
        rawPoint[2] - previous[2],
      )
      const gridLength =
        isGridSnapActive() && !altRef.current
          ? snapLength(distance, useEditor.getState().gridSnapStep)
          : null
      next = constrainSpatialDraftPoint(previous, rawPoint, typedLengthMeters ?? gridLength)
    }
    candidateRef.current = next
    preview([...currentPath, next])
  }, [frame, preview, typedLengthMeters])
  applyCursorRef.current = applyCursor

  useEffect(() => {
    if (sessionRef.current && (typedLengthMeters === null || Number.isFinite(typedLengthMeters))) {
      applyCursorRef.current()
    }
  }, [typedLengthMeters])

  const begin = useCallback(() => {
    if (
      !faceId ||
      !hitPoint ||
      !face ||
      !frame ||
      !isBodyFaceSweepEligible(body, faceId) ||
      sessionRef.current
    )
      return
    clearLength()
    useViewer.getState().setInputDragging(true)
    document.body.style.cursor = 'crosshair'
    setDragging(true)
    setClosed(false)
    pathRef.current = [[hitPoint[0], hitPoint[1], hitPoint[2]]]
    candidateRef.current = null
    setPathPoints(pathRef.current)
    setPreviewValid(false)
    const anchorWorld = target.localToWorld(new Vector3(...hitPoint))
    const normalWorld = new Vector3(...frame.normal)
      .transformDirection(target.matrixWorld)
      .normalize()
    const viewDirection = camera.getWorldDirection(new Vector3())
    const planeNormal = new Vector3().crossVectors(normalWorld, viewDirection)
    if (planeNormal.lengthSq() <= 1e-8) planeNormal.crossVectors(normalWorld, camera.up)
    planeNormal.normalize()
    const workPlane = new Plane().setFromNormalAndCoplanarPoint(planeNormal, anchorWorld)
    const raycaster = new Raycaster()
    const onPointerMove = (event: PointerEvent) => {
      const rect = gl.domElement.getBoundingClientRect()
      const pointer = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera)
      const worldHit = new Vector3()
      if (!raycaster.ray.intersectPlane(workPlane, worldHit)) return
      altRef.current = event.altKey
      cursorRef.current = target.worldToLocal(worldHit)
      applyCursorRef.current()
    }
    const onClick = (event: MouseEvent) => {
      const cursor = cursorRef.current
      const candidate = candidateRef.current
      const currentPath = pathRef.current
      if (!cursor || !candidate || !previewValidRef.current) return
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation()
      const last = currentPath[currentPath.length - 1]!
      const first = currentPath[0]!
      if (currentPath.length >= 3 && distanceBetween(first, cursor) <= SNAP_EPSILON) {
        const closedPath = [...currentPath, first]
        if (preview(closedPath)) {
          setClosed(true)
          swallowNextClick()
          finishRef.current(false)
        }
        return
      }
      if (currentPath.length >= 2 && distanceBetween(last, cursor) <= SNAP_EPSILON) {
        swallowNextClick()
        finishRef.current(false)
        return
      }
      const next = [...currentPath, candidate]
      currentPath.push(candidate)
      setPathPoints([...currentPath])
      preview(next)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finishRef.current(true)
        return
      }
      if (event.key === 'Enter' && previewValidRef.current) {
        event.preventDefault()
        event.stopPropagation()
        finishRef.current(false)
        return
      }
      if ((event.key === 'c' || event.key === 'C') && pathRef.current.length >= 3) {
        event.preventDefault()
        const first = pathRef.current[0]!
        const closedPath = [...pathRef.current, first]
        if (preview(closedPath)) {
          setClosed(true)
          finishRef.current(false)
        }
        return
      }
      if (
        event.key === 'Backspace' &&
        pathRef.current.length > 1 &&
        !useDraftLengthHud.getState().raw
      ) {
        event.preventDefault()
        pathRef.current.pop()
        setPathPoints([...pathRef.current])
        applyCursorRef.current()
      }
    }
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', onPointerMove, true)
      window.removeEventListener('click', onClick, true)
      window.removeEventListener('keydown', onKeyDown, true)
    }
    sessionRef.current = createBodySweepSession({ body, faceId })
    window.addEventListener('pointermove', onPointerMove, true)
    window.addEventListener('click', onClick, true)
  }, [body, camera, clearLength, face, faceId, frame, gl.domElement, hitPoint, preview, target])

  useEffect(() => {
    if (!autoStart) return
    const frameId = window.requestAnimationFrame(begin)
    return () => window.cancelAnimationFrame(frameId)
  }, [autoStart, begin])

  useEffect(
    () => () => {
      if (sessionRef.current) finishRef.current(true)
    },
    [],
  )

  if (!face || !frame || !faceId || !hitPoint) return null
  const position: [number, number, number] = [
    frame.centroid[0] + frame.normal[0] * 0.18,
    frame.centroid[1] + frame.normal[1] * 0.18,
    frame.centroid[2] + frame.normal[2] * 0.18,
  ]
  return (
    <group ref={outerRef}>
      <Html center position={position} zIndexRange={[100, 0]}>
        <SweepFaceActions
          closed={closed}
          dragging={dragging}
          onBegin={begin}
          previewValid={previewValid}
          stationCount={pathPoints.length}
        />
      </Html>
    </group>
  )
}

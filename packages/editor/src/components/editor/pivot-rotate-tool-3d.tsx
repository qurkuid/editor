'use client'

import { useViewer } from '@pascal-app/viewer'
import { createPortal, useThree } from '@react-three/fiber'
import { useEffect, useMemo } from 'react'
import { BufferGeometry, Plane, Vector2, Vector3 } from 'three'
import { EDITOR_LAYER } from '../../lib/constants'
import { PIVOT_ROTATE_AXIS_COLORS, type PivotPlanPoint } from '../../lib/pivot-rotate-math'
import usePivotRotate from '../../store/use-pivot-rotate'
import { levelFrame } from './group-transform-shared'
import { GuideRing, RotationGuide, type RotationGuideData } from './node-arrow-handles'

// 3D presentation of the pivot-rotate gesture (bottom-menu Rotate) — the
// sibling of `FloorplanPivotRotateLayer`. Pointer input raycasts the level's
// ground plane and feeds level-frame plan points into the shared
// `usePivotRotate` store; the chrome (pivot ring, arms, swept wedge) renders
// in world space, portalled to the scene root like the group-rotate gizmo.
// The rotating meshes preview through `useLiveNodeOverrides` on their own.

const CLICK_MAX_DRIFT_PX = 5
const CHROME_LIFT = 0.02
// Below ~0.5° the wedge degenerates; mirror the group-rotate threshold.
const MIN_GUIDE_SWEEP = 0.0087

export function PivotRotateTool3D() {
  const stage = usePivotRotate((s) => s.stage)
  if (stage === 'idle') return null
  return <PivotRotateTool3DInner />
}

function PivotRotateTool3DInner() {
  const { camera, raycaster, gl, scene } = useThree()
  const stage = usePivotRotate((s) => s.stage)
  const pivot = usePivotRotate((s) => s.pivot)
  const reference = usePivotRotate((s) => s.reference)
  const cursor = usePivotRotate((s) => s.cursor)
  const delta = usePivotRotate((s) => s.delta)
  const axis = usePivotRotate((s) => s.axis)
  const levelId = useViewer((s) => s.selection.levelId)
  const accent = PIVOT_ROTATE_AXIS_COLORS[axis]

  // The level's frame is static for the whole gesture (nothing re-parents
  // mid-rotate), so resolve the world↔level matrices and ground plane once.
  const frame = useMemo(() => levelFrame(levelId), [levelId])
  const planeY = useMemo(() => new Vector3().setFromMatrixPosition(frame.matrix).y, [frame])

  useEffect(() => {
    const el = gl.domElement
    const ndc = new Vector2()
    const hit = new Vector3()
    const plane = new Plane(new Vector3(0, 1, 0), -planeY)

    const toPlan = (clientX: number, clientY: number): PivotPlanPoint | null => {
      const rect = el.getBoundingClientRect()
      ndc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(ndc, camera)
      if (!raycaster.ray.intersectPlane(plane, hit)) return null
      const local = hit.clone().applyMatrix4(frame.inverse)
      return { x: local.x, z: local.z }
    }

    // Click-to-place with drag discrimination: camera drags travel past the
    // drift threshold, so orbiting mid-gesture never places a point. Nothing
    // is consumed — with the editor held in build mode, click-to-select is
    // already disarmed, and the camera keeps working.
    let down: { x: number; y: number } | null = null
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      down = { x: event.clientX, y: event.clientY }
    }
    const onPointerMove = (event: PointerEvent) => {
      const plan = toPlan(event.clientX, event.clientY)
      if (plan) usePivotRotate.getState().updateCursor(plan, event.altKey)
    }
    const onPointerUp = (event: PointerEvent) => {
      if (event.button !== 0) return
      const start = down
      down = null
      if (
        !start ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > CLICK_MAX_DRIFT_PX
      )
        return
      const plan = toPlan(event.clientX, event.clientY)
      if (plan) usePivotRotate.getState().placePoint(plan)
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerUp)
    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerUp)
    }
  }, [camera, raycaster, gl, frame, planeY])

  const toWorld = (point: PivotPlanPoint): Vector3 =>
    new Vector3(point.x, 0, point.z).applyMatrix4(frame.matrix).setY(planeY + CHROME_LIFT)

  const worldPivot = pivot ? toWorld(pivot) : null
  const worldCursor = cursor ? toWorld(cursor) : null
  const arm = stage === 'reference' ? cursor : reference
  const worldArm = arm ? toWorld(arm) : null

  let guide: RotationGuideData | null = null
  if (stage === 'angle' && pivot && reference && worldPivot && Math.abs(delta) >= MIN_GUIDE_SWEEP) {
    const worldReference = toWorld(reference)
    const startAngle = Math.atan2(worldReference.z - worldPivot.z, worldReference.x - worldPivot.x)
    const armLength = worldReference.distanceTo(worldPivot)
    const radius = Math.min(Math.max(armLength * 0.6, 0.3), 3)
    const midAngle = startAngle + delta / 2
    const labelRadius = radius + 0.22
    guide = {
      center: [worldPivot.x, worldPivot.y, worldPivot.z],
      startAngle,
      endAngle: startAngle + delta,
      radius,
      labelPos: [
        worldPivot.x + Math.cos(midAngle) * labelRadius,
        worldPivot.y + 0.02,
        worldPivot.z + Math.sin(midAngle) * labelRadius,
      ],
      sweep: Math.abs(delta),
    }
  }

  // Axis indicator through the pivot: a colored line along the active
  // rotation axis (level frame), so the arrow-key axis switch reads at a
  // glance. Vertical for y, horizontal for x / z.
  const AXIS_REACH = 2.5
  let axisLine: { from: Vector3; to: Vector3 } | null = null
  if (pivot && worldPivot) {
    if (axis === 'y') {
      axisLine = {
        from: worldPivot.clone(),
        to: worldPivot.clone().setY(worldPivot.y + AXIS_REACH),
      }
    } else {
      const offset = axis === 'x' ? { x: AXIS_REACH, z: 0 } : { x: 0, z: AXIS_REACH }
      axisLine = {
        from: toWorld({ x: pivot.x - offset.x, z: pivot.z - offset.z }),
        to: toWorld({ x: pivot.x + offset.x, z: pivot.z + offset.z }),
      }
    }
  }

  return createPortal(
    <>
      {stage === 'pivot' && worldCursor ? (
        <GuideRing
          center={[worldCursor.x, 0, worldCursor.z]}
          color={accent}
          radius={0.06}
          y={worldCursor.y}
        />
      ) : null}
      {worldPivot ? (
        <GuideRing
          center={[worldPivot.x, 0, worldPivot.z]}
          color={accent}
          radius={0.08}
          y={worldPivot.y}
        />
      ) : null}
      {axisLine ? <ChromeLine color={accent} from={axisLine.from} to={axisLine.to} /> : null}
      {worldPivot && worldArm ? (
        <ChromeLine color={accent} from={worldPivot} to={worldArm} />
      ) : null}
      {stage === 'angle' && worldPivot && worldCursor ? (
        <ChromeLine color={accent} from={worldPivot} to={worldCursor} />
      ) : null}
      {guide ? <RotationGuide color={accent} data={guide} /> : null}
    </>,
    scene,
  )
}

function ChromeLine({ from, to, color }: { from: Vector3; to: Vector3; color: string }) {
  const geometry = useMemo(() => new BufferGeometry().setFromPoints([from, to]), [from, to])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    // @ts-expect-error - R3F accepts Three line primitives, matching the rotation guide outline.
    <line frustumCulled={false} geometry={geometry} layers={EDITOR_LAYER} renderOrder={1009}>
      <lineBasicNodeMaterial
        color={color}
        depthTest={false}
        depthWrite={false}
        opacity={0.9}
        transparent
      />
    </line>
  )
}

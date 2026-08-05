'use client'

import { type CameraPose, emitter } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import { Plane, Raycaster, Vector2, Vector3 } from 'three'
import { create } from 'zustand'

/**
 * One-shot "walk to point" mode (SketchUp's Position Camera): arm it from
 * the Views panel, click a spot in the 3D viewport, and the camera flies
 * to eye height above that spot, facing the direction you approached from.
 */
export const useWalkToPoint = create<{
  armed: boolean
  setArmed: (armed: boolean) => void
}>()((set) => ({
  armed: false,
  setArmed: (armed) => set({ armed }),
}))

const EYE_HEIGHT = 1.6
const LOOK_AHEAD = 4
const CLICK_SLOP_PX = 5

const groundPlane = new Plane(new Vector3(0, 1, 0), 0)

export function WalkToPointController() {
  const armed = useWalkToPoint((s) => s.armed)
  const gl = useThree((s) => s.gl)
  const camera = useThree((s) => s.camera)
  const scene = useThree((s) => s.scene)

  useEffect(() => {
    if (!armed) return

    const el = gl.domElement
    const prevCursor = el.style.cursor
    el.style.cursor = 'crosshair'

    let downAt: [number, number] | null = null

    const suppressClick = (e: MouseEvent) => {
      e.preventDefault()
      e.stopImmediatePropagation()
    }

    const onPointerDown = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY]
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!downAt) return
      const moved = Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1])
      downAt = null
      // A drag is camera navigation, not a teleport click.
      if (moved > CLICK_SLOP_PX) return

      // Swallow the event before the selection pipeline sees it, and the
      // trailing click it would otherwise dispatch.
      e.preventDefault()
      e.stopImmediatePropagation()
      el.addEventListener('click', suppressClick, { capture: true, once: true })

      const rect = el.getBoundingClientRect()
      const ndc = new Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      )
      const raycaster = new Raycaster()
      raycaster.setFromCamera(ndc, camera)
      // Default raycaster layers (layer 0) skip grid/editor-overlay layers.
      const hit =
        raycaster.intersectObjects(scene.children, true).find((h) => h.object.visible)?.point ??
        raycaster.ray.intersectPlane(groundPlane, new Vector3())
      if (!hit) return

      const from = new Vector3()
      camera.getWorldPosition(from)
      // Face the direction of travel — horizontal camera→click vector; a
      // near-vertical (top-down) approach falls back to camera forward.
      const forward = new Vector3(hit.x - from.x, 0, hit.z - from.z)
      if (forward.lengthSq() < 1e-6) {
        camera.getWorldDirection(forward)
        forward.y = 0
      }
      if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1)
      forward.normalize()

      const eyeY = hit.y + EYE_HEIGHT
      const pose: CameraPose = {
        position: [hit.x, eyeY, hit.z],
        target: [hit.x + forward.x * LOOK_AHEAD, eyeY, hit.z + forward.z * LOOK_AHEAD],
        // Walking is a human-eye view — always perspective, at the current FOV.
        projection: 'perspective',
        fov: useViewer.getState().fov,
      }
      emitter.emit('camera-controls:apply-pose', pose)
      useWalkToPoint.getState().setArmed(false)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useWalkToPoint.getState().setArmed(false)
    }

    el.addEventListener('pointerdown', onPointerDown, true)
    el.addEventListener('pointerup', onPointerUp, true)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      el.style.cursor = prevCursor
      el.removeEventListener('pointerdown', onPointerDown, true)
      el.removeEventListener('pointerup', onPointerUp, true)
      el.removeEventListener('click', suppressClick, true)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [armed, camera, gl, scene])

  return null
}

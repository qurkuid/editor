'use client'

import {
  type BodyEvent,
  type BodyNode,
  emitter,
  type GridEvent,
  sceneRegistry,
} from '@pascal-app/core'
import {
  CursorSphere,
  consumePlacementDragRelease,
  getSegmentGridStep,
  isMagneticSnapActive,
  markToolCancelConsumed,
  snapBuildingLocalToWorldGrid,
  triggerSFX,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createMeasurementSurfaceQuerySession } from '../measurement/surface-query'
import {
  bodyPlanCenter,
  createBodyMoveEffectState,
  createBodyMoveInitialDragAnchor,
  resolveBodyMoveTranslation,
} from './move-session'

type PointerEventSource = PointerEvent | { readonly nativeEvent: PointerEvent }

function normalizePointerEvent(source: PointerEventSource): PointerEvent {
  return 'nativeEvent' in source ? source.nativeEvent : source
}

function isFloorplanSourcedEvent(event: GridEvent): boolean {
  const target = normalizePointerEvent(event.nativeEvent).target
  if (!(target instanceof Element)) return false
  return target.closest('[data-floorplan-scene]') != null
}

export const MoveBodyTool: React.FC<{ node: BodyNode }> = ({ node }) => {
  const { camera, gl, scene } = useThree()
  const activatedAtRef = useRef<number>(Date.now())
  const originalCenterRef = useRef(bodyPlanCenter(node))
  const dragAnchorRef = useRef<[number, number] | null>(
    createBodyMoveInitialDragAnchor(node, useEditor.getState().placementDragMode),
  )
  const surfaceQuery = useMemo(
    () => createMeasurementSurfaceQuerySession(scene, { excludeNodeIds: [node.id] }),
    [node.id, scene],
  )
  const [cursorLocalPos, setCursorLocalPos] = useState<[number, number, number]>(() => {
    const center = originalCenterRef.current
    return [center[0], 0, center[1]]
  })

  const exitMoveMode = useCallback(() => {
    useEditor.getState().setMovingNode(null)
  }, [])

  useEffect(() => () => surfaceQuery.dispose(), [surfaceQuery])

  useEffect(() => {
    const bodyId = node.id
    const effectState = createBodyMoveEffectState({
      body: node,
      placementDragMode: useEditor.getState().placementDragMode,
      preview: 'override',
    })
    const session = effectState.session
    dragAnchorRef.current = effectState.anchor
    let committed = false

    const applyPreview = (event: GridEvent) => {
      if (isFloorplanSourcedEvent(event)) return
      const nativeEvent = normalizePointerEvent(event.nativeEvent)
      const forceFree = nativeEvent.altKey
      const step = forceFree ? 0 : getSegmentGridStep()
      const [x, z] = snapBuildingLocalToWorldGrid(
        [event.localPosition[0], event.localPosition[2]],
        step,
      )
      const anchor = dragAnchorRef.current ?? [x, z]
      dragAnchorRef.current = anchor
      const dx = x - anchor[0]
      const dz = z - anchor[1]
      const bodyObject = sceneRegistry.nodes.get(bodyId)
      const levelObject =
        (node.parentId ? sceneRegistry.nodes.get(node.parentId) : undefined) ??
        bodyObject?.parent ??
        scene
      const resolved = forceFree
        ? null
        : surfaceQuery.resolvePointer({
            event: nativeEvent,
            camera,
            canvas: gl.domElement,
            levelObject,
            anchorOrAnchors: null,
            surfacePreference: { kind: 'horizontal' },
            applyMagneticSnap: isMagneticSnapActive(),
            showAlignmentGuides: false,
          })
      const surfacePoint =
        resolved && Math.abs(resolved.hit.normal[1]) >= 0.85 ? resolved.hit.point : null
      const translation = resolveBodyMoveTranslation({
        body: node,
        planTranslation: [dx, dz],
        surfacePoint,
      })
      session.preview(translation)
      const center = originalCenterRef.current
      setCursorLocalPos([center[0] + translation[0], translation[1], center[1] + translation[2]])
    }

    const commitCurrent = (nativeEvent?: { stopPropagation?: () => void }) => {
      if (committed) return
      if (Date.now() - activatedAtRef.current < 150) {
        nativeEvent?.stopPropagation?.()
        return
      }
      if (!session.canCommit()) return
      committed = session.commit()
      if (!committed) return
      triggerSFX('sfx:item-place')
      useViewer.getState().setSelection({ selectedIds: [bodyId] })
      useEditor.getState().setMovingNodeOrigin('3d')
      exitMoveMode()
      nativeEvent?.stopPropagation?.()
    }

    const commitFromGrid = (event: GridEvent) => {
      if (isFloorplanSourcedEvent(event)) return
      commitCurrent(event.nativeEvent)
    }

    const commitFromBody = (event: BodyEvent) => {
      commitCurrent(event.nativeEvent)
    }

    const onPlacementDragPointerUp = (event: PointerEvent) => {
      if (!consumePlacementDragRelease(event)) return
      activatedAtRef.current = 0
      commitCurrent(event)
    }

    const onCancel = () => {
      session.cancel()
      useViewer.getState().setSelection({ selectedIds: [bodyId] })
      markToolCancelConsumed()
      exitMoveMode()
    }

    emitter.on('grid:move', applyPreview)
    emitter.on('grid:click', commitFromGrid)
    emitter.on('body:click', commitFromBody)
    emitter.on('tool:cancel', onCancel)
    window.addEventListener('pointerup', onPlacementDragPointerUp)

    return () => {
      if (!committed) session.cancel()
      emitter.off('grid:move', applyPreview)
      emitter.off('grid:click', commitFromGrid)
      emitter.off('body:click', commitFromBody)
      emitter.off('tool:cancel', onCancel)
      window.removeEventListener('pointerup', onPlacementDragPointerUp)
    }
  }, [camera, exitMoveMode, gl.domElement, node, scene, surfaceQuery])

  return <CursorSphere position={cursorLocalPos} showTooltip={false} />
}

export default MoveBodyTool

import {
  emitter,
  type GridEvent,
  type GuideNode,
  type NodeEvent,
  sceneRegistry,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useCallback, useEffect, useState } from 'react'
import { Matrix4, Vector3 } from 'three'
import { resolveGuideSurfacePlacement } from '../../../lib/guide-surface-placement'
import useEditor from '../../../store/use-editor'

type SurfacePlacementEvent = GridEvent | NodeEvent

const SURFACE_CLICK_EVENTS = [
  'wall:click',
  'body:click',
  'slab:click',
  'ceiling:click',
  'roof:click',
  'roof-segment:click',
  'item:click',
  'cabinet:click',
  'cabinet-module:click',
  'shelf:click',
  'stair:click',
  'stair-segment:click',
  'column:click',
  'door:click',
  'window:click',
  'fence:click',
  'elevator:click',
  'box-vent:click',
  'ridge-vent:click',
  'turbine-vent:click',
  'cupola:click',
  'eyebrow-vent:click',
  'gutter:click',
  'chimney:click',
  'solar-panel:click',
  'skylight:click',
  'dormer:click',
  'downspout:click',
  'duct-segment:click',
  'duct-fitting:click',
  'duct-terminal:click',
  'hvac-equipment:click',
  'lineset:click',
  'liquid-line:click',
  'pipe-segment:click',
  'pipe-fitting:click',
  'pipe-trap:click',
] as const

export function useGuideSurfacePlacement(
  guide: GuideNode,
  onUpdate: (patch: Partial<GuideNode>) => void,
) {
  const [isPlacing, setIsPlacing] = useState(false)
  const cancel = useCallback(() => setIsPlacing(false), [])

  useEffect(() => {
    if (!isPlacing) return

    const place = (event: SurfacePlacementEvent) => {
      if ('node' in event && (event.viaHandle || !event.normal)) return
      const worldPoint = new Vector3(...event.position)
      const worldNormal =
        'node' in event && event.normal
          ? new Vector3(...event.normal).transformDirection(event.object.matrixWorld)
          : new Vector3(0, 1, 0)
      const parent = guide.parentId ? sceneRegistry.nodes.get(guide.parentId) : undefined
      const localPoint = parent ? parent.worldToLocal(worldPoint) : worldPoint
      const localNormal = parent
        ? worldNormal.transformDirection(new Matrix4().copy(parent.matrixWorld).invert())
        : worldNormal
      const placement = resolveGuideSurfacePlacement(
        [localPoint.x, localPoint.y, localPoint.z],
        [localNormal.x, localNormal.y, localNormal.z],
      )
      if ('stopPropagation' in event) event.stopPropagation()
      onUpdate(placement)
      useViewer.getState().setSelection({ selectedIds: [] })
      useEditor.getState().setSelectedReferenceId(guide.id)
      setIsPlacing(false)
    }

    emitter.on('grid:click', place)
    for (const eventName of SURFACE_CLICK_EVENTS) emitter.on(eventName, place)

    return () => {
      emitter.off('grid:click', place)
      for (const eventName of SURFACE_CLICK_EVENTS) emitter.off(eventName, place)
    }
  }, [guide.id, guide.parentId, isPlacing, onUpdate])

  useEffect(() => {
    if (!isPlacing) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cancel, isPlacing])

  const start = useCallback(() => {
    useEditor.getState().setMode('select')
    setIsPlacing(true)
  }, [])

  return { cancel, isPlacing, start }
}

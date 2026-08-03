'use client'

import { type AnyNode, emitter, type GridEvent, snapPointToGrid, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useRef, useState } from 'react'
import { sfxEmitter } from '../../../lib/sfx-bus'
import useEditor, { getContinuation, isGridSnapActive } from '../../../store/use-editor'
import { PlacementBox } from '../shared/placement-box'
import { createFurnitureNode, FURNITURE_KIND_MOUNT_HEIGHT } from './furniture-factory'
import { useFurniturePlacementOptions } from './furniture-placement-options'

const ROTATE_STEP_RAD = Math.PI / 4

// Point-and-place for the furniture assembly armed in the furniture tab.
// Mirrors the lighting fixture tool's floor placement (single click on the
// active level, no wall-run/stretch machinery) rather than the modular
// cabinet tool's run-building path, since a furniture piece is one node.
export const FurnitureTool = () => {
  const activeLevelId = useViewer((s) => s.selection.levelId)
  const unit = useViewer((s) => s.unit)
  const kind = useFurniturePlacementOptions((s) => s.kind)
  const dimensions = useFurniturePlacementOptions((s) => s.dimensions)
  const bayCount = useFurniturePlacementOptions((s) => s.bayCount)
  const [position, setPosition] = useState<[number, number, number] | null>(null)
  const [yaw, setYaw] = useState(0)
  const yawRef = useRef(0)
  const positionRef = useRef<[number, number, number] | null>(null)

  useEffect(() => {
    if (!activeLevelId) return
    positionRef.current = null
    setPosition(null)
    yawRef.current = 0
    setYaw(0)

    // Levels share the same local XZ origin (they only differ in world Y —
    // see roof-tool.tsx), so the building-local XZ the grid ray reports is
    // already the level-local XZ a floor-standing node needs.
    const resolvePoint = (event: GridEvent): [number, number, number] => {
      const [lx, , lz] = event.localPosition
      const step = useEditor.getState().gridSnapStep
      const [sx, sz] = isGridSnapActive() ? snapPointToGrid([lx, lz], step) : [lx, lz]
      return [sx, 0, sz]
    }

    const onMove = (event: GridEvent) => {
      const next = resolvePoint(event)
      positionRef.current = next
      setPosition(next)
    }

    const onClick = (event: GridEvent) => {
      const current = positionRef.current ?? resolvePoint(event)
      const node = createFurnitureNode({
        kind,
        dimensions,
        bayCount,
        parentId: activeLevelId,
        position: current,
        rotation: yawRef.current,
      })
      useScene.getState().createNode(node as AnyNode, activeLevelId)
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      sfxEmitter.emit('sfx:item-place')
      // 'repeat' keeps the tool armed so placing a run of furniture is one
      // gesture per piece instead of re-picking the preset every time.
      if (getContinuation('point') !== 'repeat') {
        useEditor.getState().setTool(null)
        useEditor.getState().setMode('select')
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (event.key !== 'r' && event.key !== 'R' && event.key !== 't' && event.key !== 'T') return
      event.preventDefault()
      event.stopPropagation()
      const steps = event.key === 't' || event.key === 'T' ? -1 : 1
      yawRef.current += steps * ROTATE_STEP_RAD
      setYaw(yawRef.current)
      sfxEmitter.emit('sfx:item-rotate')
    }

    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [activeLevelId, bayCount, dimensions, kind])

  if (!activeLevelId || !position) return null
  const mountHeight = FURNITURE_KIND_MOUNT_HEIGHT[kind]
  return (
    <PlacementBox
      dimensions={[dimensions.width, dimensions.height, dimensions.depth]}
      measurements={{ unit }}
      position={[position[0], position[1] + mountHeight, position[2]]}
      rotationY={yaw}
      valid
    />
  )
}

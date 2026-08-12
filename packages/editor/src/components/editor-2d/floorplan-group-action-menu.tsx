'use client'

import { type AnyNodeId, type BodyNode, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { commitBodyBoolean, commitBodySolidTool } from '../../lib/body-boolean'
import { commitBodyComponent, commitBodyGroup } from '../../lib/body-container-actions'
import { isActive } from '../../lib/interaction/scope'
import { sfxEmitter } from '../../lib/sfx-bus'
import useEditor from '../../store/use-editor'
import useInteractionScope, { useMovingNode } from '../../store/use-interaction-scope'
import {
  deleteSelection,
  duplicateSelectionAndPickUp,
  startGroupPickUp,
} from '../editor/group-actions'
import { NodeActionMenu } from '../editor/node-action-menu'

/**
 * Floating Move / Duplicate / Delete pill for a MULTI-selection in the 2D
 * floor plan — the group sibling of `FloorplanRegistryActionMenu` (which is
 * sole-selection only). Anchored above the dashed group selection box; every
 * action targets the whole selection: Move picks the group up (it rides the
 * cursor until a click places it), Duplicate clones the selection and picks
 * the clones up, Delete removes everything selected.
 *
 * Gated on floorplan hover so it never coexists with the 3D group menu in
 * split view (that one hides while the floor plan is hovered), and hidden
 * during any active interaction so it never competes with a live drag.
 */
export function FloorplanGroupActionMenu() {
  const isMultiSelect = useViewer((s) => s.selection.selectedIds.length > 1)
  const movingNode = useMovingNode()
  const isFloorplanHovered = useEditor((s) => s.isFloorplanHovered)
  const scopeActive = useInteractionScope((s) => isActive(s.scope))
  const selectedIds = useViewer((s) => s.selection.selectedIds)
  const nodes = useScene((s) => s.nodes)
  const bodyPair = useMemo(() => {
    if (selectedIds.length !== 2) return null
    const pair = selectedIds.map((id) => nodes[id as AnyNodeId])
    return pair[0]?.type === 'body' && pair[1]?.type === 'body'
      ? ([pair[0], pair[1]] as const)
      : null
  }, [nodes, selectedIds])
  const bodySelection = useMemo(() => {
    const bodies = selectedIds.map((id) => nodes[id as AnyNodeId])
    return bodies.length >= 2 && bodies.every((node) => node?.type === 'body')
      ? bodies.filter((node): node is BodyNode => node?.type === 'body')
      : null
  }, [nodes, selectedIds])

  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)

  const isVisible = isMultiSelect && !movingNode && isFloorplanHovered && !scopeActive

  const handleIntersect = () => {
    if (!bodyPair) return
    try {
      commitBodyBoolean(bodyPair[0], bodyPair[1], 'intersect')
      useViewer.getState().setSelection({ selectedIds: [bodyPair[0].id] })
      sfxEmitter.emit('sfx:item-place')
    } catch {
      return
    }
  }

  const handleUnion = () => {
    if (!bodyPair) return
    try {
      commitBodyBoolean(bodyPair[0], bodyPair[1], 'union')
      useViewer.getState().setSelection({ selectedIds: [bodyPair[0].id] })
      sfxEmitter.emit('sfx:item-place')
    } catch {
      return
    }
  }

  const handleSubtract = () => {
    if (!bodyPair) return
    try {
      commitBodyBoolean(bodyPair[0], bodyPair[1], 'subtract')
      useViewer.getState().setSelection({ selectedIds: [bodyPair[0].id] })
      sfxEmitter.emit('sfx:item-place')
    } catch {
      return
    }
  }

  const handleSolidTool = (operation: 'outer-shell' | 'trim' | 'split') => {
    if (!bodyPair) return
    try {
      const bodies = commitBodySolidTool(bodyPair[0], bodyPair[1], operation)
      useViewer.getState().setSelection({ selectedIds: bodies.map((body) => body.id) })
      sfxEmitter.emit('sfx:item-place')
    } catch {
      return
    }
  }

  const handleGroupBodies = () => {
    if (!bodySelection) return
    const id = commitBodyGroup(bodySelection.map((body) => body.id))
    if (id) useViewer.getState().setSelection({ selectedIds: [id] })
  }

  const handleCreateComponent = () => {
    if (!bodySelection) return
    const id = commitBodyComponent(bodySelection.map((body) => body.id))
    if (id) useViewer.getState().setSelection({ selectedIds: [id] })
  }

  useEffect(() => {
    if (!isVisible) {
      setPosition(null)
      return
    }
    let raf = 0
    const tick = () => {
      raf = requestAnimationFrame(tick)
      // The dashed group box exists exactly while the multi-selection has
      // transformable participants — anchor to its top edge. Only publish
      // actual changes so the idle poll doesn't re-render every frame.
      const box = document.querySelector('[data-group-selection-box]') as SVGGElement | null
      if (!box) {
        setPosition((prev) => (prev === null ? prev : null))
        return
      }
      const rect = box.getBoundingClientRect()
      const next = { left: rect.left + rect.width / 2, top: rect.top }
      setPosition((prev) =>
        prev && Math.abs(prev.left - next.left) < 0.5 && Math.abs(prev.top - next.top) < 0.5
          ? prev
          : next,
      )
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isVisible])

  if (!(isVisible && position)) return null

  return createPortal(
    <div
      className="pointer-events-none fixed z-30"
      style={{
        left: position.left,
        top: position.top,
        transform: 'translate(-50%, calc(-100% - 12px))',
      }}
    >
      <NodeActionMenu
        onDelete={() => deleteSelection()}
        onDuplicate={() => duplicateSelectionAndPickUp()}
        onMove={() => startGroupPickUp()}
        onIntersect={bodyPair ? handleIntersect : undefined}
        onSubtract={bodyPair ? handleSubtract : undefined}
        onUnion={bodyPair ? handleUnion : undefined}
        onOuterShell={bodyPair ? () => handleSolidTool('outer-shell') : undefined}
        onTrim={bodyPair ? () => handleSolidTool('trim') : undefined}
        onSplit={bodyPair ? () => handleSolidTool('split') : undefined}
        onGroupBodies={bodySelection ? handleGroupBodies : undefined}
        onCreateComponent={bodySelection ? handleCreateComponent : undefined}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
      />
    </div>,
    document.body,
  )
}

'use client'

import { emitter, type GridEvent, LightingSwitchNode, useScene } from '@pascal-app/core'
import { EDITOR_LAYER, isGridSnapActive, triggerSFX, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Group } from 'three'
import { useLightingToolOptions } from '../lighting/options'
import { LightingSwitchVisual } from './renderer'

export default function LightingSwitchTool() {
  const levelId = useViewer((state) => state.selection.levelId)
  const circuitId = useLightingToolOptions((state) => state.circuitId)
  const switchHeight = useLightingToolOptions((state) => state.switchHeight)
  const ref = useRef<Group>(null)
  const [visible, setVisible] = useState(false)
  const preview = useMemo(
    () => LightingSwitchNode.parse({ circuitId, position: [0, switchHeight, 0] }),
    [circuitId, switchHeight],
  )
  useEffect(() => {
    if (!levelId) return
    const snap = (value: number) => {
      if (!isGridSnapActive()) return value
      const step = useEditor.getState().gridSnapStep
      return Math.round(value / step) * step
    }
    const onMove = (event: GridEvent) => {
      ref.current?.position.set(
        snap(event.localPosition[0]),
        switchHeight,
        snap(event.localPosition[2]),
      )
      setVisible(true)
    }
    const onClick = (event: GridEvent) => {
      const node = LightingSwitchNode.parse({
        name: 'Light switch',
        parentId: levelId,
        position: [snap(event.localPosition[0]), switchHeight, snap(event.localPosition[2])],
        circuitId,
      })
      useScene.getState().createNode(node, levelId)
      useViewer.getState().setSelection({ selectedIds: [node.id] })
      triggerSFX('sfx:structure-build')
      useEditor.getState().setTool(null)
      useEditor.getState().setMode('select')
    }
    emitter.on('grid:move', onMove)
    emitter.on('grid:click', onClick)
    return () => {
      emitter.off('grid:move', onMove)
      emitter.off('grid:click', onClick)
    }
  }, [circuitId, levelId, switchHeight])
  if (!levelId) return null
  return (
    <group layers={EDITOR_LAYER} ref={ref} visible={visible}>
      <LightingSwitchVisual node={preview} preview />
    </group>
  )
}

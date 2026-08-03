'use client'

import { LightingSwitchNode } from '@pascal-app/core'
import { type FloorplanToolContext, triggerSFX } from '@pascal-app/editor'
import { useEffect, useRef, useState } from 'react'
import { useLightingToolOptions } from '../lighting/options'

export default function FloorplanLightingSwitchTool({
  activeLevelId,
  finishTool,
  gridSnapStep,
  sceneApi,
  selectNode,
}: FloorplanToolContext) {
  const circuitId = useLightingToolOptions((state) => state.circuitId)
  const switchHeight = useLightingToolOptions((state) => state.switchHeight)
  const ref = useRef<SVGGElement>(null)
  const [point, setPoint] = useState<[number, number] | null>(null)
  useEffect(() => {
    const group = ref.current
    const svg = group?.ownerSVGElement
    if (!(activeLevelId && group && svg)) return
    const resolve = (event: MouseEvent | PointerEvent): [number, number] | null => {
      const matrix = group.getScreenCTM()
      if (!matrix) return null
      const local = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse())
      return [
        Math.round(local.x / gridSnapStep) * gridSnapStep,
        Math.round(local.y / gridSnapStep) * gridSnapStep,
      ]
    }
    const stop = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
    }
    const onMove = (event: PointerEvent) => {
      stop(event)
      setPoint(resolve(event))
    }
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return
      stop(event)
      const next = resolve(event)
      if (!next) return
      const node = LightingSwitchNode.parse({
        name: 'Light switch',
        parentId: activeLevelId,
        position: [next[0], switchHeight, next[1]],
        circuitId,
      })
      sceneApi.upsert(node, activeLevelId)
      selectNode(node.id)
      triggerSFX('sfx:structure-build')
      finishTool()
    }
    svg.addEventListener('pointermove', onMove, true)
    svg.addEventListener('click', onClick, true)
    return () => {
      svg.removeEventListener('pointermove', onMove, true)
      svg.removeEventListener('click', onClick, true)
    }
  }, [activeLevelId, circuitId, finishTool, gridSnapStep, sceneApi, selectNode, switchHeight])
  return (
    <g ref={ref}>
      {point && (
        <g transform={`translate(${point[0]} ${point[1]})`}>
          <rect
            fill="#f5f5f4"
            height={0.16}
            rx={0.03}
            stroke="#0f766e"
            strokeWidth={0.02}
            width={0.24}
            x={-0.12}
            y={-0.08}
          />
          <path d="M 0 -0.05 L 0 0.05" stroke="#0f766e" strokeWidth={0.025} />
        </g>
      )}
    </g>
  )
}

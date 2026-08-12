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
  const gangCount = useLightingToolOptions((state) => state.switchGangCount)
  const circuitIds = useLightingToolOptions((state) => state.switchCircuitIds)
  const switchShape = useLightingToolOptions((state) => state.switchShape)
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
        circuitIds,
        gangCount,
        switchShape,
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
  }, [
    activeLevelId,
    circuitId,
    circuitIds,
    finishTool,
    gangCount,
    gridSnapStep,
    sceneApi,
    selectNode,
    switchHeight,
    switchShape,
  ])
  return (
    <g ref={ref}>
      {point && (
        <g transform={`translate(${point[0]} ${point[1]})`}>
          {(() => {
            const width = Math.max(0.24, gangCount * 0.09 + 0.08)
            return (
              <>
                <rect
                  fill="#f5f5f4"
                  height={0.16}
                  rx={switchShape === 'round' ? 0.08 : 0.03}
                  stroke="#0f766e"
                  strokeWidth={0.02}
                  width={width}
                  x={-width / 2}
                  y={-0.08}
                />
                {Array.from({ length: gangCount }, (_, index) => {
                  const x = (index - (gangCount - 1) / 2) * 0.09
                  return switchShape === 'round' ? (
                    <circle cx={x} cy={0} fill="#d6d3d1" key={x} r={0.03} stroke="#0f766e" />
                  ) : (
                    <path
                      d={`M ${x} -0.05 L ${x} 0.05`}
                      key={x}
                      stroke="#0f766e"
                      strokeWidth={0.025}
                    />
                  )
                })}
              </>
            )
          })()}
        </g>
      )}
    </g>
  )
}

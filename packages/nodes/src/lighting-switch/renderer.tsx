'use client'

import {
  type AnyNodeId,
  type LightingCircuitNode,
  type LightingSwitchNode,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useRef } from 'react'
import type { Group } from 'three'

export function LightingSwitchVisual({
  node,
  preview = false,
}: {
  node: LightingSwitchNode
  preview?: boolean
}) {
  const circuit = useScene((state) =>
    node.circuitId
      ? (state.nodes[node.circuitId as AnyNodeId] as LightingCircuitNode | undefined)
      : undefined,
  )
  const on = preview || circuit?.enabled === true
  const width = Math.max(0.16, node.gangCount * 0.075 + 0.085)
  return (
    <group rotation={[0, node.rotation, 0]}>
      <mesh castShadow>
        <boxGeometry args={[width, 0.24, 0.035]} />
        <meshStandardMaterial color="#e7e5e4" opacity={preview ? 0.55 : 1} transparent={preview} />
      </mesh>
      {Array.from({ length: node.gangCount }, (_, index) => {
        const x = (index - (node.gangCount - 1) / 2) * 0.075
        return (
          <mesh
            key={x}
            position={[x, on ? 0.015 : -0.015, 0.025]}
            rotation={
              node.switchShape === 'round' ? [Math.PI / 2, 0, 0] : [on ? -0.12 : 0.12, 0, 0]
            }
          >
            {node.switchShape === 'round' ? (
              <cylinderGeometry args={[0.027, 0.027, 0.025, 24]} />
            ) : (
              <boxGeometry args={[0.055, 0.12, 0.025]} />
            )}
            <meshStandardMaterial
              color={on ? '#14b8a6' : '#78716c'}
              emissive={on ? '#0f766e' : '#000000'}
              emissiveIntensity={on ? 0.4 : 0}
            />
          </mesh>
        )
      })}
    </group>
  )
}

export default function LightingSwitchRenderer({ node }: { node: LightingSwitchNode }) {
  const ref = useRef<Group>(null)
  useRegistry(node.id, 'lighting-switch', ref)
  const events = useNodeEvents(node, 'lighting-switch')
  return (
    <group position={node.position} ref={ref} visible={node.visible !== false} {...events}>
      <LightingSwitchVisual node={node} />
    </group>
  )
}

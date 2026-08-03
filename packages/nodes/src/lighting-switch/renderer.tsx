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
  return (
    <group rotation={[0, node.rotation, 0]}>
      <mesh castShadow>
        <boxGeometry args={[0.16, 0.24, 0.035]} />
        <meshStandardMaterial color="#e7e5e4" opacity={preview ? 0.55 : 1} transparent={preview} />
      </mesh>
      <mesh position={[0, on ? 0.015 : -0.015, 0.025]} rotation={[on ? -0.12 : 0.12, 0, 0]}>
        <boxGeometry args={[0.07, 0.12, 0.025]} />
        <meshStandardMaterial
          color={on ? '#14b8a6' : '#78716c'}
          emissive={on ? '#0f766e' : '#000000'}
          emissiveIntensity={on ? 0.4 : 0}
        />
      </mesh>
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

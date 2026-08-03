'use client'

import {
  type AnyNodeId,
  kelvinToRgb,
  type LightingCircuitNode,
  type LightingFixtureNode,
  lumensToCandela,
  resolveLightingFixtureEnabled,
  spotLumensToCandela,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { useNodeEvents } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import type { Group, Object3D, SpotLight } from 'three'
import { resolveLinearLightLength } from '../lighting/placement'

export function LightingFixtureVisual({
  node,
  preview = false,
}: {
  node: LightingFixtureNode
  preview?: boolean
}) {
  const circuit = useScene((state) =>
    node.circuitId
      ? (state.nodes[node.circuitId as AnyNodeId] as LightingCircuitNode | undefined)
      : undefined,
  )
  const powered = preview || resolveLightingFixtureEnabled(node, circuit)
  const rgb = useMemo(() => kelvinToRgb(node.colorTemperature), [node.colorTemperature])
  const color = `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
  const spotRef = useRef<SpotLight>(null)
  const targetRef = useRef<Object3D>(null)

  useEffect(() => {
    if (spotRef.current && targetRef.current) spotRef.current.target = targetRef.current
  }, [])

  const pointIntensity = powered ? lumensToCandela(node.lumens) : 0
  const spotIntensity = powered ? spotLumensToCandela(node.lumens, node.beamAngle) : 0
  const areaIntensity = powered
    ? node.lumens / Math.max(Math.PI * node.areaSize[0] * node.areaSize[1], 0.01)
    : 0
  const linearLength = resolveLinearLightLength(node.start, node.end)
  const linearIntensity = powered
    ? node.lumens / Math.max(Math.PI * linearLength * node.linearWidth, 0.01)
    : 0

  return (
    <group rotation={node.rotation}>
      <mesh castShadow position={[0, 0.025, 0]}>
        {node.lightType === 'area' ? (
          <boxGeometry args={[node.areaSize[0], 0.05, node.areaSize[1]]} />
        ) : node.lightType === 'linear' ? (
          <boxGeometry args={[linearLength, 0.04, node.linearWidth]} />
        ) : (
          <cylinderGeometry args={[0.11, 0.15, 0.08, 24]} />
        )}
        <meshStandardMaterial
          color={powered ? '#fff7d6' : '#78716c'}
          emissive={color}
          emissiveIntensity={powered ? 1.2 : 0}
          opacity={preview ? 0.55 : 1}
          transparent={preview}
        />
      </mesh>
      {node.lightType === 'point' && (
        <pointLight color={color} distance={node.range} intensity={pointIntensity} />
      )}
      {node.lightType === 'spot' && (
        <>
          <spotLight
            angle={(node.beamAngle * Math.PI) / 360}
            color={color}
            distance={node.range}
            intensity={spotIntensity}
            penumbra={0.25}
            ref={spotRef}
          />
          <object3D position={[0, -1, 0]} ref={targetRef} />
        </>
      )}
      {node.lightType === 'area' && (
        <rectAreaLight
          color={color}
          height={node.areaSize[1]}
          intensity={areaIntensity}
          rotation={[-Math.PI / 2, 0, 0]}
          width={node.areaSize[0]}
        />
      )}
      {node.lightType === 'linear' && (
        <rectAreaLight
          color={color}
          height={node.linearWidth}
          intensity={linearIntensity}
          rotation={[-Math.PI / 2, 0, 0]}
          width={linearLength}
        />
      )}
    </group>
  )
}

export default function LightingFixtureRenderer({ node }: { node: LightingFixtureNode }) {
  const ref = useRef<Group>(null)
  useRegistry(node.id, 'lighting-fixture', ref)
  const events = useNodeEvents(node, 'lighting-fixture')
  return (
    <group position={node.position} ref={ref} visible={node.visible !== false} {...events}>
      <LightingFixtureVisual node={node} />
    </group>
  )
}

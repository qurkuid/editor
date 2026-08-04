'use client'

import {
  type AnyNodeId,
  ItemNode,
  kelvinToRgb,
  type LightingCircuitNode,
  type LightingFixtureNode,
  lumensToCandela,
  resolveLightingFixtureEnabled,
  spotLumensToCandela,
  useLiveNodeOverrides,
  useRegistry,
  useScene,
} from '@pascal-app/core'
import { OVERLAY_LAYER, useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useEffect, useMemo, useRef } from 'react'
import { DoubleSide, type Group, type Object3D, type SpotLight } from 'three'
import { ItemPreview } from '../item/renderer'
import { resolveLightingRunOffsets, resolveLinearLightLength } from '../lighting/placement'

// Amber floor-coordinate marker (#f59e0b stroke / #fffbeb fill), matching the
// 2D floorplan glyph and the placement preview so the same spot reads
// identically before and after commit. Overlay layer: excluded from renders,
// exports, and thumbnails like every other editor chrome.
const MARKER_OUTER_RADIUS = 0.16
const MARKER_INNER_RADIUS = 0.13
const MARKER_CROSS_LENGTH = 0.2
const MARKER_CROSS_THICKNESS = 0.02
const MARKER_Y = 0.01

export function LightingFloorMarker() {
  return (
    <group position={[0, MARKER_Y, 0]}>
      <mesh layers={OVERLAY_LAYER} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[MARKER_OUTER_RADIUS, 32]} />
        <meshBasicMaterial
          color="#fffbeb"
          depthTest={false}
          opacity={0.5}
          side={DoubleSide}
          transparent
        />
      </mesh>
      <mesh layers={OVERLAY_LAYER} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[MARKER_INNER_RADIUS, MARKER_OUTER_RADIUS, 32]} />
        <meshBasicMaterial color="#f59e0b" depthTest={false} side={DoubleSide} transparent />
      </mesh>
      <mesh layers={OVERLAY_LAYER} rotation={[0, Math.PI / 4, 0]}>
        <boxGeometry args={[MARKER_CROSS_LENGTH, MARKER_CROSS_THICKNESS, MARKER_CROSS_THICKNESS]} />
        <meshBasicMaterial color="#f59e0b" depthTest={false} transparent />
      </mesh>
      <mesh layers={OVERLAY_LAYER} rotation={[0, -Math.PI / 4, 0]}>
        <boxGeometry args={[MARKER_CROSS_LENGTH, MARKER_CROSS_THICKNESS, MARKER_CROSS_THICKNESS]} />
        <meshBasicMaterial color="#f59e0b" depthTest={false} transparent />
      </mesh>
    </group>
  )
}

// Downward spot with its target parented alongside, so each unit of a run
// aims straight down independently of the run's rotation.
function SpotUnit({
  beamAngle,
  color,
  distance,
  intensity,
}: {
  beamAngle: number
  color: string
  distance: number
  intensity: number
}) {
  const spotRef = useRef<SpotLight>(null)
  const targetRef = useRef<Object3D>(null)

  useEffect(() => {
    if (spotRef.current && targetRef.current) spotRef.current.target = targetRef.current
  }, [])

  return (
    <>
      <spotLight
        angle={(beamAngle * Math.PI) / 360}
        color={color}
        distance={distance}
        intensity={intensity}
        penumbra={0.25}
        ref={spotRef}
      />
      <object3D position={[0, -1, 0]} ref={targetRef} />
    </>
  )
}

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

  const pointIntensity = powered ? lumensToCandela(node.lumens) : 0
  const spotIntensity = powered ? spotLumensToCandela(node.lumens, node.beamAngle) : 0
  const areaIntensity = powered
    ? node.lumens / Math.max(Math.PI * node.areaSize[0] * node.areaSize[1], 0.01)
    : 0
  const linearLength = resolveLinearLightLength(node.start, node.end)
  const linearIntensity = powered
    ? node.lumens / Math.max(Math.PI * linearLength * node.linearWidth, 0.01)
    : 0

  // A combined catalog model replaces the primitive body — the physical light
  // sources below still come from this node, so circuit/lumens control the
  // illumination while the GLB provides the visible luminaire.
  const assetNode = useMemo(
    () => (node.asset ? ItemNode.parse({ asset: node.asset }) : null),
    [node.asset],
  )

  // A point/spot run is ONE node rendering `count` units spread along its
  // local +X axis; a single fixture is the degenerate one-offset run.
  const isRun = (node.lightType === 'point' || node.lightType === 'spot') && node.start && node.end
  const offsets = isRun ? resolveLightingRunOffsets(linearLength, node.count ?? 2) : [0]

  return (
    <group rotation={node.rotation}>
      {offsets.map((offset) => (
        <group key={offset} position={[offset, 0, 0]}>
          {assetNode ? (
            <ItemPreview node={assetNode} />
          ) : (
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
          )}
          {node.lightType === 'point' && (
            <pointLight color={color} distance={node.range} intensity={pointIntensity} />
          )}
          {node.lightType === 'spot' && (
            <SpotUnit
              beamAngle={node.beamAngle}
              color={color}
              distance={node.range}
              intensity={spotIntensity}
            />
          )}
        </group>
      ))}
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

export default function LightingFixtureRenderer({
  node: storeNode,
}: {
  node: LightingFixtureNode
}) {
  const ref = useRef<Group>(null)
  useRegistry(storeNode.id, 'lighting-fixture', ref)
  const events = useNodeEvents(storeNode, 'lighting-fixture')
  // Merge live drag overrides so the fixture turns in real time while the
  // rotate gizmo is dragged — the handle publishes per-tick patches through
  // `useLiveNodeOverrides` and only commits to the store on release.
  const liveOverride = useLiveNodeOverrides((s) => s.overrides.get(storeNode.id))
  const node = useMemo(
    () => (liveOverride ? ({ ...storeNode, ...liveOverride } as LightingFixtureNode) : storeNode),
    [storeNode, liveOverride],
  )
  // The registered group carries position AND rotation so the rotate gizmo's
  // rig and ring turn with the fixture. The visual therefore gets a
  // rotation-zeroed node — it applies `node.rotation` itself for the benefit
  // of the placement preview, which has no registered wrapper.
  const visualNode = useMemo(
    () => ({ ...node, rotation: [0, 0, 0] as [number, number, number] }),
    [node],
  )
  // Floor-coordinate marker(s) under each light while the fixture is
  // SELECTED — the same glyph the placement preview shows, so a ceiling
  // fixture's plan position stays locatable, without cluttering the scene by
  // default. Local −Y drops from the mount height back to the level floor.
  const selected = useViewer((state) => state.selection.selectedIds.includes(storeNode.id))
  const isRun = (node.lightType === 'point' || node.lightType === 'spot') && node.start && node.end
  const markerOffsets = selected
    ? isRun
      ? resolveLightingRunOffsets(resolveLinearLightLength(node.start, node.end), node.count ?? 2)
      : [0]
    : null
  return (
    <group
      position={node.position}
      ref={ref}
      rotation={node.rotation}
      visible={node.visible !== false}
      {...events}
    >
      <LightingFixtureVisual node={visualNode} />
      {markerOffsets?.map((offset) => (
        <group key={offset} position={[offset, -node.position[1], 0]}>
          <LightingFloorMarker />
        </group>
      ))}
    </group>
  )
}

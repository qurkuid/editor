'use client'

import {
  buildWallConstructionLayerSpans,
  getWallBandConstruction,
  getWallCurveFrameAt,
  getWallCurveLength,
  type WallNode,
} from '@pascal-app/core'
import type { WallConstructionDisplayMode } from '@pascal-app/editor'
import { useMemo } from 'react'
import { DoubleSide, Shape, Vector2 } from 'three'
import {
  buildWallStudPlacements,
  buildWallTopSectionSpans,
  WALL_LAYER_COLORS,
} from './construction-visual'

function layerOpacity(
  kind: Parameters<typeof buildWallConstructionLayerSpans>[0]['layers'][number]['kind'],
) {
  if (kind === 'timber-stud') return 0.95
  if (kind === 'cavity') return 0.06
  if (kind === 'gypsum-board' || kind === 'finish') return 0.24
  return 0.38
}

type FullConstructionMode = Exclude<WallConstructionDisplayMode, 'finish'>

export function WallConstructionPreview({
  mode,
  node,
}: {
  mode: FullConstructionMode
  node: WallNode
}) {
  const length = getWallCurveLength(node)
  const height = node.height ?? 2.5
  const construction = getWallBandConstruction(node, node.faceBands?.count === 4 ? 'top' : 'upper')
  const spans = useMemo(() => {
    const allSpans = buildWallConstructionLayerSpans(construction)
    return mode === 'frame' ? allSpans.filter((span) => span.kind === 'timber-stud') : allSpans
  }, [construction, mode])
  const curved = Math.abs(node.curveOffset ?? 0) > 1e-6

  if (length <= 0 || spans.length === 0) return null

  if (curved) {
    return (
      <group name="wall-construction-preview">
        {spans.map((span) => {
          const layer = construction.layers[span.layerIndex]!
          return span.kind === 'timber-stud' ? (
            <CurvedTimberStudLayer
              height={height}
              key={span.layerIndex}
              layer={layer}
              length={length}
              node={node}
              offset={span.center}
              thickness={span.thickness}
            />
          ) : (
            <CurvedConstructionLayer
              color={WALL_LAYER_COLORS[span.kind]}
              endOffset={span.end}
              height={height}
              key={span.layerIndex}
              kind={span.kind}
              node={node}
              startOffset={span.start}
            />
          )
        })}
      </group>
    )
  }

  return (
    <group name="wall-construction-preview">
      {spans.flatMap((span) => {
        const layer = construction.layers[span.layerIndex]!
        if (span.kind !== 'timber-stud') {
          return (
            <mesh
              key={span.layerIndex}
              position={[length / 2, height / 2, span.center]}
              renderOrder={3}
            >
              <boxGeometry args={[length, height, span.thickness]} />
              <meshStandardMaterial
                color={WALL_LAYER_COLORS[span.kind]}
                depthWrite={false}
                metalness={0}
                opacity={layerOpacity(span.kind)}
                roughness={0.82}
                transparent
              />
            </mesh>
          )
        }

        const memberWidth = Math.min(layer.memberWidth ?? 0.033, layer.studSpacing ?? 0.3)
        return buildWallStudPlacements(length, layer.studSpacing, memberWidth).map(
          ({ center }, index) => (
            <mesh
              key={`${span.layerIndex}-${index}`}
              position={[center, height / 2, span.center]}
              renderOrder={3}
            >
              <boxGeometry args={[Math.min(memberWidth, length), height, span.thickness]} />
              <meshStandardMaterial
                color={WALL_LAYER_COLORS[span.kind]}
                metalness={0}
                opacity={layerOpacity(span.kind)}
                polygonOffset
                polygonOffsetFactor={-2}
                roughness={0.82}
                transparent
              />
            </mesh>
          ),
        )
      })}
    </group>
  )
}

export function WallConstructionTopSection({ node }: { node: WallNode }) {
  const length = getWallCurveLength(node)
  const height = node.height ?? 2.5
  const construction = getWallBandConstruction(node, node.faceBands?.count === 4 ? 'top' : 'upper')
  const spans = useMemo(() => buildWallTopSectionSpans(construction), [construction])
  const curved = Math.abs(node.curveOffset ?? 0) > 1e-6

  if (length <= 0 || spans.length === 0) return null

  if (curved) {
    return (
      <group name="wall-construction-top-section">
        {spans.flatMap((span) => {
          const layer = construction.layers[span.layerIndex]!
          return span.kind === 'timber-stud' ? (
            <CurvedTimberStudLayer
              centerY={height + 0.002}
              height={0.004}
              key={span.layerIndex}
              layer={layer}
              length={length}
              node={node}
              offset={span.center}
              thickness={span.thickness}
            />
          ) : (
            <CurvedTopSectionLayer
              color={WALL_LAYER_COLORS[span.kind]}
              endOffset={span.end}
              height={height}
              key={span.layerIndex}
              node={node}
              startOffset={span.start}
            />
          )
        })}
      </group>
    )
  }

  return (
    <group name="wall-construction-top-section">
      {spans.flatMap((span) => {
        const layer = construction.layers[span.layerIndex]!
        if (span.kind === 'timber-stud') {
          const memberWidth = Math.min(layer.memberWidth ?? 0.033, layer.studSpacing ?? 0.3)
          return buildWallStudPlacements(length, layer.studSpacing, memberWidth).map(
            ({ center }, index) => (
              <mesh
                key={`${span.layerIndex}-${index}`}
                position={[center, height + 0.002, span.center]}
                renderOrder={4}
              >
                <boxGeometry args={[Math.min(memberWidth, length), 0.004, span.thickness]} />
                <meshStandardMaterial color={WALL_LAYER_COLORS[span.kind]} roughness={0.82} />
              </mesh>
            ),
          )
        }
        return (
          <mesh
            key={span.layerIndex}
            position={[length / 2, height + 0.002, span.center]}
            renderOrder={4}
          >
            <boxGeometry args={[length, 0.004, span.thickness]} />
            <meshStandardMaterial color={WALL_LAYER_COLORS[span.kind]} roughness={0.82} />
          </mesh>
        )
      })}
    </group>
  )
}

function CurvedTimberStudLayer({
  centerY,
  height,
  layer,
  length,
  node,
  offset,
  thickness,
}: {
  centerY?: number
  height: number
  layer: Parameters<typeof buildWallConstructionLayerSpans>[0]['layers'][number]
  length: number
  node: WallNode
  offset: number
  thickness: number
}) {
  const placements = useMemo(() => {
    const chordAngle = Math.atan2(node.end[1] - node.start[1], node.end[0] - node.start[0])
    const cos = Math.cos(chordAngle)
    const sin = Math.sin(chordAngle)
    return buildWallStudPlacements(length, layer.studSpacing, layer.memberWidth).map(
      ({ ratio }) => {
        const frame = getWallCurveFrameAt(node, ratio)
        const worldX = frame.point.x + frame.normal.x * offset
        const worldZ = frame.point.y + frame.normal.y * offset
        const dx = worldX - node.start[0]
        const dz = worldZ - node.start[1]
        const tangentX = cos * frame.tangent.x + sin * frame.tangent.y
        const tangentZ = sin * frame.tangent.x - cos * frame.tangent.y
        return {
          x: cos * dx + sin * dz,
          z: sin * dx - cos * dz,
          rotationY: Math.atan2(-tangentZ, tangentX),
        }
      },
    )
  }, [layer.memberWidth, layer.studSpacing, length, node, offset])
  const memberWidth = Math.min(layer.memberWidth ?? 0.033, layer.studSpacing ?? 0.3, length)

  return placements.map((placement, index) => (
    <mesh
      key={index}
      position={[placement.x, centerY ?? height / 2, placement.z]}
      renderOrder={3}
      rotation={[0, placement.rotationY, 0]}
    >
      <boxGeometry args={[memberWidth, height, thickness]} />
      <meshStandardMaterial
        color={WALL_LAYER_COLORS['timber-stud']}
        metalness={0}
        polygonOffset
        polygonOffsetFactor={-2}
        roughness={0.82}
      />
    </mesh>
  ))
}

function useCurvedLayerShape(node: WallNode, startOffset: number, endOffset: number) {
  return useMemo(() => {
    const angle = Math.atan2(node.end[1] - node.start[1], node.end[0] - node.start[0])
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const toLocal = (x: number, z: number) => {
      const dx = x - node.start[0]
      const dz = z - node.start[1]
      return new Vector2(cos * dx + sin * dz, sin * dx - cos * dz)
    }
    const segments = 32
    const first = Array.from({ length: segments + 1 }, (_, index) => {
      const frame = getWallCurveFrameAt(node, index / segments)
      return toLocal(
        frame.point.x + frame.normal.x * startOffset,
        frame.point.y + frame.normal.y * startOffset,
      )
    })
    const second = Array.from({ length: segments + 1 }, (_, index) => {
      const frame = getWallCurveFrameAt(node, 1 - index / segments)
      return toLocal(
        frame.point.x + frame.normal.x * endOffset,
        frame.point.y + frame.normal.y * endOffset,
      )
    })
    return new Shape([...first, ...second])
  }, [endOffset, node, startOffset])
}

function CurvedTopSectionLayer({
  color,
  endOffset,
  height,
  node,
  startOffset,
}: {
  color: string
  endOffset: number
  height: number
  node: WallNode
  startOffset: number
}) {
  const shape = useCurvedLayerShape(node, startOffset, endOffset)
  return (
    <mesh position={[0, height + 0.002, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={4}>
      <extrudeGeometry args={[shape, { bevelEnabled: false, depth: 0.004 }]} />
      <meshStandardMaterial color={color} roughness={0.82} side={DoubleSide} />
    </mesh>
  )
}

function CurvedConstructionLayer({
  color,
  endOffset,
  height,
  kind,
  node,
  startOffset,
}: {
  color: string
  endOffset: number
  height: number
  kind: Parameters<typeof buildWallConstructionLayerSpans>[0]['layers'][number]['kind']
  node: WallNode
  startOffset: number
}) {
  const shape = useCurvedLayerShape(node, startOffset, endOffset)

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
      <extrudeGeometry args={[shape, { bevelEnabled: false, depth: height }]} />
      <meshStandardMaterial
        color={color}
        depthWrite={kind === 'timber-stud'}
        metalness={0}
        opacity={layerOpacity(kind)}
        polygonOffset
        polygonOffsetFactor={-2}
        roughness={0.82}
        side={DoubleSide}
        transparent
      />
    </mesh>
  )
}

'use client'

import { type AnyNodeId, type ConstructionGuideNode, useLiveNodeOverrides } from '@pascal-app/core'
import { useEffect, useMemo } from 'react'
import { BufferGeometry, Color, DoubleSide, Float32BufferAttribute } from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { CONSTRUCTION_GUIDE_COLOR } from './floorplan'

// 3D presentation of a construction guide: the same dashed line as the floor
// plan, lying on the level ground. Dashes are thin triangle quads (not line
// primitives — those draw empty under the WebGPU backend), sharing the
// proven MeshBasicNodeMaterial path of the editor's guide rings.
// Non-interactive reference chrome: no raycast, so it never competes with
// real geometry for clicks; editing (slide / delete) stays on the 2D plan.
const GUIDE_3D_EXTENT = 200
const DASH = 0.45
const GAP = 0.3
const DASH_HALF_WIDTH = 0.012
const GROUND_LIFT = 0.02

const disableRaycast = () => {}

const ConstructionGuideRenderer = ({ node }: { node: ConstructionGuideNode }) => {
  // Live overrides make the 2D slide drag preview in 3D too.
  const liveOverride = useLiveNodeOverrides((state) => state.get(node.id as AnyNodeId))
  const effective = liveOverride ? ({ ...node, ...liveOverride } as ConstructionGuideNode) : node
  const [originX, originZ] = effective.origin
  const [rawDirectionX, rawDirectionZ] = effective.direction

  const geometry = useMemo(() => {
    const length = Math.hypot(rawDirectionX, rawDirectionZ) || 1
    const dx = rawDirectionX / length
    const dz = rawDirectionZ / length
    const nx = -dz * DASH_HALF_WIDTH
    const nz = dx * DASH_HALF_WIDTH
    const positions: number[] = []
    for (let s = -GUIDE_3D_EXTENT; s < GUIDE_3D_EXTENT; s += DASH + GAP) {
      const e = Math.min(s + DASH, GUIDE_3D_EXTENT)
      const ax = originX + dx * s
      const az = originZ + dz * s
      const bx = originX + dx * e
      const bz = originZ + dz * e
      // Two triangles per dash: (a-, b-, b+) and (a-, b+, a+).
      positions.push(
        ax - nx,
        GROUND_LIFT,
        az - nz,
        bx - nx,
        GROUND_LIFT,
        bz - nz,
        bx + nx,
        GROUND_LIFT,
        bz + nz,
        ax - nx,
        GROUND_LIFT,
        az - nz,
        bx + nx,
        GROUND_LIFT,
        bz + nz,
        ax + nx,
        GROUND_LIFT,
        az + nz,
      )
    }
    const built = new BufferGeometry()
    built.setAttribute('position', new Float32BufferAttribute(positions, 3))
    return built
  }, [originX, originZ, rawDirectionX, rawDirectionZ])
  useEffect(() => () => geometry.dispose(), [geometry])

  const material = useMemo(() => {
    const built = new MeshBasicNodeMaterial()
    built.color = new Color(CONSTRUCTION_GUIDE_COLOR)
    built.side = DoubleSide
    built.transparent = true
    built.opacity = 0.7
    built.depthWrite = false
    return built
  }, [])
  useEffect(() => () => material.dispose(), [material])

  if (effective.visible === false) return null
  return (
    <mesh frustumCulled={false} geometry={geometry} material={material} raycast={disableRaycast} />
  )
}

export default ConstructionGuideRenderer

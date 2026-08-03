'use client'

import { type GuideNode, useRegistry } from '@pascal-app/core'
import { useAssetUrl, useNodeEvents, useViewer } from '@pascal-app/viewer'
import { useLoader } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef } from 'react'
import { DoubleSide, type Group, type Texture, TextureLoader } from 'three'
import { float, texture } from 'three/tsl'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { createGuidePlaneGeometry } from './geometry'

export const GuideRenderer = ({ node }: { node: GuideNode }) => {
  const showGuides = useViewer((s) => s.showGuides)
  const ref = useRef<Group>(null)
  useRegistry(node.id, 'guide', ref)
  const events = useNodeEvents(node, 'guide')

  const resolvedUrl = useAssetUrl(node.url)

  return (
    <group
      position={node.position}
      ref={ref}
      rotation={node.rotation}
      visible={showGuides && node.visible !== false}
      {...events}
    >
      {resolvedUrl && (
        <Suspense>
          <GuidePlane
            opacity={node.opacity}
            perspectiveCorners={node.perspectiveCorners}
            scale={node.scale}
            url={resolvedUrl}
          />
        </Suspense>
      )}
    </group>
  )
}

const GuidePlane = ({
  url,
  scale,
  opacity,
  perspectiveCorners,
}: Pick<GuideNode, 'opacity' | 'perspectiveCorners' | 'scale'> & { readonly url: string }) => {
  const tex = useLoader(TextureLoader, url) as Texture

  // Pass the geometry as a prop. JSX-child `<planeGeometry>` plus
  // `frustumCulled={false}` lets the mesh submit a first-frame draw
  // with R3F's empty placeholder BufferGeometry before the child
  // attaches — WebGPU then flags "Vertex buffer slot 0 required by
  // [RenderPipeline renderPipeline_MeshBasicNodeMaterial_NNNN] was
  // not set." Same fix as wall-move-side-handles.tsx / grid.tsx.
  const { geometry, material } = useMemo(() => {
    const img = tex.image as HTMLImageElement | ImageBitmap
    const w = img.width || 1
    const h = img.height || 1
    const aspect = w / h

    // Default: 10 meters wide, height from aspect ratio
    const planeWidth = 10 * scale
    const planeHeight = (10 / aspect) * scale

    const normalizedOpacity = opacity / 100

    const mat = new MeshBasicNodeMaterial({
      transparent: true,
      colorNode: texture(tex),
      opacityNode: float(normalizedOpacity),
      side: DoubleSide,
      depthWrite: false,
    })

    const geom = createGuidePlaneGeometry({
      height: planeHeight,
      perspectiveCorners,
      width: planeWidth,
    })
    geom.boundingBox = null
    geom.boundingSphere = null

    return { geometry: geom, material: mat }
  }, [opacity, perspectiveCorners, scale, tex])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  return (
    <mesh
      frustumCulled={false}
      geometry={geometry}
      material={material}
      rotation={[-Math.PI / 2, 0, 0]}
    />
  )
}

export default GuideRenderer

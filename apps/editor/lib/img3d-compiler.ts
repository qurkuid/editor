import type { AssetInput } from '@pascal-app/core'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { BoxGeometry } from 'three/src/geometries/BoxGeometry.js'
import { CapsuleGeometry } from 'three/src/geometries/CapsuleGeometry.js'
import { CylinderGeometry } from 'three/src/geometries/CylinderGeometry.js'
import { SphereGeometry } from 'three/src/geometries/SphereGeometry.js'
import { MeshStandardMaterial } from 'three/src/materials/MeshStandardMaterial.js'
import { Box3 } from 'three/src/math/Box3.js'
import { Vector3 } from 'three/src/math/Vector3.js'
import { Group } from 'three/src/objects/Group.js'
import { Mesh } from 'three/src/objects/Mesh.js'
import type { Img3dPart, Img3dSculpt } from './img3d-contract'

export type Img3dCompileOptions = {
  readonly assetId: string
  readonly thumbnail: string
  readonly dimensions: Img3dDimensions
}

export type Img3dDimensions = {
  readonly width: number
  readonly height: number
  readonly depth: number
}

export type Img3dCompiledAsset = {
  readonly glb: Blob
  readonly asset: AssetInput
  readonly metadata: {
    readonly version: 1
    readonly partCount: number
    readonly slots: readonly string[]
  }
}

export class Img3dDegenerateBoundsError extends Error {
  readonly name = 'Img3dDegenerateBoundsError'

  constructor(readonly rawDimensions: readonly [number, number, number]) {
    super(`img3d sculpt has degenerate raw bounds: ${rawDimensions.join(' × ')}`)
  }
}

function ensureBlobFileReader(): void {
  if (typeof FileReader !== 'undefined') return
  Object.defineProperty(globalThis, 'FileReader', {
    configurable: true,
    value: class {
      result: ArrayBuffer | null = null
      onloadend: (() => void) | null = null

      readAsArrayBuffer(blob: Blob): void {
        void blob.arrayBuffer().then((result) => {
          this.result = result
          this.onloadend?.()
        })
      }
    },
  })
}

function cleanDimension(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function geometryFor(part: Img3dPart) {
  switch (part.primitive) {
    case 'box':
      return new BoxGeometry(...part.size)
    case 'sphere':
      return new SphereGeometry(part.radius, part.widthSegments, part.heightSegments)
    case 'cylinder':
      return new CylinderGeometry(part.radius, part.radius, part.height, part.radialSegments)
    case 'capsule':
      return new CapsuleGeometry(part.radius, part.length, part.capSegments, part.radialSegments)
    default:
      throw new TypeError(`Unsupported img3d primitive: ${part satisfies never}`)
  }
}

export function normalizeImg3dObject(object: Group, dimensions: Img3dDimensions): Group {
  object.updateMatrixWorld(true)
  const rawBounds = new Box3().setFromObject(object)
  const rawSize = rawBounds.getSize(new Vector3())
  if (rawSize.x <= 0 || rawSize.y <= 0 || rawSize.z <= 0) {
    throw new Img3dDegenerateBoundsError([rawSize.x, rawSize.y, rawSize.z])
  }
  object.scale.set(
    dimensions.width / rawSize.x,
    dimensions.height / rawSize.y,
    dimensions.depth / rawSize.z,
  )
  object.updateMatrixWorld(true)
  const scaledBounds = new Box3().setFromObject(object)
  const scaledCenter = scaledBounds.getCenter(new Vector3())
  object.position.set(-scaledCenter.x, -scaledBounds.min.y, -scaledCenter.z)
  object.updateMatrixWorld(true)
  return object
}

export function createImg3dObject(sculpt: Img3dSculpt, dimensions: Img3dDimensions): Group {
  const materials = sculpt.materials.map(
    (material) =>
      new MeshStandardMaterial({
        name: material.slot ? `slot_${material.slot}` : material.name,
        color: material.color,
        roughness: material.roughness,
        metalness: material.metalness,
      }),
  )
  const group = new Group()
  group.name = sculpt.name
  for (const part of sculpt.parts) {
    const material = materials[part.material]
    if (!material) throw new RangeError(`Missing img3d material ${part.material}`)
    const mesh = new Mesh(geometryFor(part), material)
    mesh.name = part.name
    mesh.position.set(...part.position)
    mesh.rotation.set(...part.rotation)
    group.add(mesh)
  }
  return normalizeImg3dObject(group, dimensions)
}

export async function compileImg3dSculpt(
  sculpt: Img3dSculpt,
  options: Img3dCompileOptions,
): Promise<Img3dCompiledAsset> {
  const object = createImg3dObject(sculpt, options.dimensions)
  ensureBlobFileReader()
  const result = await new GLTFExporter().parseAsync(object, {
    binary: true,
    onlyVisible: true,
    trs: false,
  })
  if (!(result instanceof ArrayBuffer))
    throw new TypeError('GLTFExporter did not return binary GLB')
  const slots = sculpt.materials.flatMap((material) => (material.slot ? [material.slot] : []))
  return {
    glb: new Blob([result], { type: 'model/gltf-binary' }),
    asset: {
      id: options.assetId,
      category: 'img3d',
      name: sculpt.name,
      thumbnail: options.thumbnail,
      src: `asset://${options.assetId}`,
      dimensions: [
        cleanDimension(options.dimensions.width),
        cleanDimension(options.dimensions.height),
        cleanDimension(options.dimensions.depth),
      ],
      source: 'mine',
    },
    metadata: { version: 1, partCount: sculpt.parts.length, slots },
  }
}

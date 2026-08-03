import { describe, expect, test } from 'bun:test'
import type {
  AnyNode,
  AnyNodeId,
  CabinetNode as CabinetNodeType,
  HandleDescriptor,
  LinearResizeHandle,
  SceneApi,
} from '@pascal-app/core'
import { createDefaultFurnitureAssembly } from '@pascal-app/core'
import { cabinetDefinition } from '../definition'
import { CabinetNode } from '../schema'

function furnitureFixture(withFurniture = true) {
  const furniture = createDefaultFurnitureAssembly({
    furnitureKind: 'wardrobe',
    dimensions: { width: 2.4, height: 2.4, depth: 0.6 },
    bayCount: 3,
  })
  const node = CabinetNode.parse({
    id: 'cabinet_furniture-resize',
    width: 2.4,
    depth: 0.6,
    carcassHeight: 2.4,
    showPlinth: false,
    withCountertop: false,
    ...(withFurniture ? { furniture } : {}),
  }) as CabinetNodeType
  const nodes = { [node.id]: node } as Record<AnyNodeId, AnyNode>
  const sceneApi = {
    nodes: () => nodes,
    get: (id: AnyNodeId) => nodes[id],
    markDirty: () => {},
  } as unknown as SceneApi
  return { node, sceneApi }
}

function handlesFor(node: CabinetNodeType, sceneApi: SceneApi) {
  const build = cabinetDefinition.handles as (
    node: CabinetNodeType,
    sceneApi: SceneApi,
  ) => HandleDescriptor<CabinetNodeType>[]
  return build(node, sceneApi)
}

function linearHandle(
  node: CabinetNodeType,
  sceneApi: SceneApi,
  axis: 'x' | 'y' | 'z',
  anchor?: 'min' | 'max',
) {
  return handlesFor(node, sceneApi).find(
    (handle): handle is LinearResizeHandle<CabinetNodeType> =>
      handle.kind === 'linear-resize' &&
      handle.axis === axis &&
      (anchor === undefined || handle.anchor === anchor),
  )!
}

describe('furniture cabinet resize writes through to the assembly', () => {
  test('width handle resizes the assembly and rescales bays to match', () => {
    const { node, sceneApi } = furnitureFixture()
    const patch = linearHandle(node, sceneApi, 'x', 'min').apply(node, 3, sceneApi)

    expect(patch.width).toBe(3)
    expect(patch.furniture?.dimensions.width).toBe(3)
    // Bays must keep summing to the assembly width, or buildFurnitureAssembly
    // reports bay-width-mismatch and the carcass renders wrong.
    const bayTotal = patch.furniture?.bays.reduce((total, bay) => total + bay.width, 0) ?? 0
    expect(bayTotal).toBeCloseTo(3, 10)
    expect(patch.furniture?.bays).toHaveLength(3)
  })

  test('depth handle resizes the assembly depth', () => {
    const { node, sceneApi } = furnitureFixture()
    const patch = linearHandle(node, sceneApi, 'z').apply(node, 0.45, sceneApi)

    expect(patch.depth).toBe(0.45)
    expect(patch.furniture?.dimensions.depth).toBe(0.45)
  })

  test('height handle resizes the assembly height', () => {
    const { node, sceneApi } = furnitureFixture()
    const patch = linearHandle(node, sceneApi, 'y').apply(node, 2.1, sceneApi)

    expect(patch.carcassHeight).toBe(2.1)
    expect(patch.furniture?.dimensions.height).toBe(2.1)
  })

  test('a cabinet without a furniture assembly is untouched', () => {
    const { node, sceneApi } = furnitureFixture(false)
    const patch = linearHandle(node, sceneApi, 'x', 'min').apply(node, 3, sceneApi)

    expect(patch.width).toBe(3)
    expect(patch.furniture).toBeUndefined()
  })

  // The default furniture width (2.4m) already exceeds MAX_CABINET_WIDTH
  // (1.2m, sized for a single module), so a bound that used the module cap
  // pinned max === current width — the left/right handles could shrink the
  // furniture but never grow it back or beyond its starting size.
  test('width handle can grow a furniture cabinet past a single module width', () => {
    const { node, sceneApi } = furnitureFixture()
    const rightHandle = linearHandle(node, sceneApi, 'x', 'min')
    const leftHandle = linearHandle(node, sceneApi, 'x', 'max')

    expect(rightHandle.max(node, sceneApi)).toBeGreaterThan(node.width)
    expect(leftHandle.max(node, sceneApi)).toBeGreaterThan(node.width)
  })

  test('depth handle can grow a furniture cabinet past a single module depth', () => {
    const deepFixture = furnitureFixture()
    deepFixture.node.depth = 0.85 // already beyond MAX_CABINET_DEPTH (0.8)
    const handle = linearHandle(deepFixture.node, deepFixture.sceneApi, 'z')

    expect(handle.max(deepFixture.node, deepFixture.sceneApi)).toBeGreaterThan(
      deepFixture.node.depth,
    )
  })
})

import { describe, expect, test } from 'bun:test'
import type { AnyNode, GeometryContext } from '@pascal-app/core'
import type { BufferAttribute, Mesh } from 'three'
import {
  COUNTERTOP_CUTOUT_KINDS,
  newCountertopCutout,
  patchCountertopCutout,
} from '../countertop-cutouts'
import { buildCabinetGeometry } from '../geometry'
import { CabinetModuleNode, CabinetNode } from '../schema'
import { COOKTOP_DEFAULT_HEIGHT, COOKTOP_STANDARD_WIDTH } from '../stack'

function findMeshByName(root: { children: unknown[] }, name: string): Mesh {
  const queue = [...root.children]
  while (queue.length > 0) {
    const item = queue.shift() as { children?: unknown[]; name?: string }
    if (item.name === name) return item as Mesh
    if (item.children) queue.push(...item.children)
  }
  throw new Error(`Mesh not found: ${name}`)
}

function vertexCount(mesh: Mesh): number {
  return (mesh.geometry.getAttribute('position') as BufferAttribute).count
}

function hasVertex(
  mesh: Mesh,
  predicate: (point: { x: number; y: number; z: number }) => boolean,
): boolean {
  const position = mesh.geometry.getAttribute('position') as BufferAttribute
  for (let i = 0; i < position.count; i += 1) {
    if (predicate({ x: position.getX(i), y: position.getY(i), z: position.getZ(i) })) return true
  }
  return false
}

function geometryContext({ children }: { children: AnyNode[] }): GeometryContext {
  const nodes = new Map(children.map((node) => [node.id, node]))
  return {
    children,
    parent: null,
    resolve: (id) => nodes.get(id) as never,
    siblings: [],
  }
}

describe('CabinetNode countertopCutouts schema', () => {
  test('defaults to an empty array', () => {
    const run = CabinetNode.parse({ id: 'cabinet_defaults' })
    expect(run.countertopCutouts).toEqual([])
  })

  test('accepts a rect cutout with size and defaults kind/cornerRadius', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_rect',
      countertopCutouts: [
        {
          id: 'c1',
          shape: 'rect',
          position: { x: 0.2, z: -0.1 },
          size: { width: 0.1, depth: 0.08 },
        },
      ],
    })
    expect(run.countertopCutouts).toHaveLength(1)
    expect(run.countertopCutouts[0]).toMatchObject({ kind: 'custom', cornerRadius: 0 })
  })

  test('accepts a circle cutout with radius', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_circle',
      countertopCutouts: [
        { id: 'c1', kind: 'outlet', shape: 'circle', position: { x: 0, z: 0 }, radius: 0.04 },
      ],
    })
    expect(run.countertopCutouts[0]).toMatchObject({ kind: 'outlet', radius: 0.04 })
  })

  test('a rect cutout without a size fails validation', () => {
    expect(() =>
      CabinetNode.parse({
        id: 'cabinet_bad-rect',
        countertopCutouts: [{ id: 'c1', shape: 'rect', position: { x: 0, z: 0 } }],
      }),
    ).toThrow()
  })

  test('a circle cutout with rect fields (width/depth) but no radius fails validation', () => {
    expect(() =>
      CabinetNode.parse({
        id: 'cabinet_bad-circle',
        countertopCutouts: [
          {
            id: 'c1',
            shape: 'circle',
            position: { x: 0, z: 0 },
            size: { width: 0.1, depth: 0.1 },
          },
        ],
      }),
    ).toThrow()
  })

  test('rejects an out-of-range radius', () => {
    expect(() =>
      CabinetNode.parse({
        id: 'cabinet_bad-radius',
        countertopCutouts: [{ id: 'c1', shape: 'circle', position: { x: 0, z: 0 }, radius: 5 }],
      }),
    ).toThrow()
  })

  test('rejects an out-of-range position', () => {
    expect(() =>
      CabinetNode.parse({
        id: 'cabinet_bad-position',
        countertopCutouts: [
          { id: 'c1', shape: 'circle', position: { x: 100, z: 0 }, radius: 0.05 },
        ],
      }),
    ).toThrow()
  })

  test('module nodes carry the same field', () => {
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_cutouts',
      countertopCutouts: [{ id: 'c1', shape: 'circle', position: { x: 0, z: 0 }, radius: 0.03 }],
    })
    expect(module.countertopCutouts).toHaveLength(1)
  })
})

describe('newCountertopCutout / patchCountertopCutout', () => {
  // Defaults are sink-sized on purpose: a new cutout has to be visible in the
  // slab straight away, otherwise it reads as "nothing happened".
  test('creates a usable default rect cutout', () => {
    const cutout = newCountertopCutout('rect')
    expect(cutout.shape).toBe('rect')
    if (cutout.shape === 'rect') {
      expect(cutout.size.width).toBeGreaterThanOrEqual(0.3)
      expect(cutout.size.depth).toBeGreaterThanOrEqual(0.3)
      expect(cutout.cornerRadius).toBeGreaterThanOrEqual(0)
    }
  })

  test('creates a small default circle cutout', () => {
    const cutout = newCountertopCutout('circle')
    expect(cutout.shape).toBe('circle')
    if (cutout.shape === 'circle') {
      expect(cutout.radius).toBeGreaterThan(0)
    }
  })

  test('generates unique ids', () => {
    const a = newCountertopCutout('rect')
    const b = newCountertopCutout('rect')
    expect(a.id).not.toBe(b.id)
  })

  test('patch overrides only the given fields', () => {
    const cutout = newCountertopCutout('rect')
    const patched = patchCountertopCutout(cutout, { position: { x: 0.5, z: -0.2 }, kind: 'outlet' })
    expect(patched.position).toEqual({ x: 0.5, z: -0.2 })
    expect(patched.kind).toBe('outlet')
    expect(patched.id).toBe(cutout.id)
  })

  test('COUNTERTOP_CUTOUT_KINDS lists every kind the schema accepts', () => {
    expect(COUNTERTOP_CUTOUT_KINDS).toEqual(['sink', 'cooktop', 'outlet', 'custom'])
  })
})

describe('buildCabinetGeometry — module countertop cutouts', () => {
  test('a freeform cutout is CSG-cut out of the module countertop', () => {
    const plain = CabinetModuleNode.parse({
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
      withCountertop: true,
      countertopThickness: 0.02,
    })
    const withCutout = CabinetModuleNode.parse({
      ...plain,
      countertopCutouts: [{ id: 'c1', shape: 'circle', position: { x: 0, z: 0 }, radius: 0.05 }],
    })

    const plainGroup = buildCabinetGeometry(plain, undefined, 'rendered', false)
    const cutGroup = buildCabinetGeometry(withCutout, undefined, 'rendered', false)

    // A plain box countertop has 24 vertices; the cut slab has the opening baked in.
    expect(vertexCount(findMeshByName(plainGroup, 'cabinet-countertop'))).toBe(24)
    expect(vertexCount(findMeshByName(cutGroup, 'cabinet-countertop'))).toBeGreaterThan(24)
  })

  test('two cutouts (rect + circle) both open the slab', () => {
    const node = CabinetModuleNode.parse({
      width: 0.9,
      depth: 0.6,
      carcassHeight: 0.72,
      withCountertop: true,
      countertopThickness: 0.02,
      countertopCutouts: [
        {
          id: 'c1',
          kind: 'outlet',
          shape: 'rect',
          position: { x: -0.3, z: 0 },
          size: { width: 0.1, depth: 0.08 },
          cornerRadius: 0.01,
        },
        { id: 'c2', shape: 'circle', position: { x: 0.3, z: 0 }, radius: 0.04 },
      ],
    })
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    const countertop = findMeshByName(group, 'cabinet-countertop')
    expect(vertexCount(countertop)).toBeGreaterThan(24)

    // Both cutouts are well over 0.04 m across their narrowest dimension —
    // a tight 0.02 m window around each center stays inside the opening
    // without brushing the rim, so no top-surface vertex should land there.
    const topY = (node.showPlinth ? node.plinthHeight : 0) + node.carcassHeight
    for (const x of [-0.3, 0.3]) {
      const hasSurfaceAtCutoutCenter = hasVertex(
        countertop,
        (point) =>
          Math.abs(point.x - x) < 0.02 && Math.abs(point.z) < 0.02 && point.y > topY - 0.001,
      )
      expect(hasSurfaceAtCutoutCenter).toBe(false)
    }
  })

  test('a cutout fully outside the slab footprint does not crash', () => {
    const node = CabinetModuleNode.parse({
      width: 0.6,
      depth: 0.58,
      carcassHeight: 0.72,
      withCountertop: true,
      countertopThickness: 0.02,
      countertopCutouts: [{ id: 'c1', shape: 'circle', position: { x: 5, z: 0 }, radius: 0.05 }],
    })

    expect(() => buildCabinetGeometry(node, undefined, 'rendered', false)).not.toThrow()
    const group = buildCabinetGeometry(node, undefined, 'rendered', false)
    expect(findMeshByName(group, 'cabinet-countertop')).toBeDefined()
  })

  test('a cooktop now cuts its surface footprint out of the countertop', () => {
    const plain = CabinetModuleNode.parse({
      width: COOKTOP_STANDARD_WIDTH,
      carcassHeight: 0.72,
      withCountertop: true,
      countertopThickness: 0.02,
    })
    const withCooktop = CabinetModuleNode.parse({
      ...plain,
      stack: [{ id: 'cooktop', type: 'cooktop-gas', height: COOKTOP_DEFAULT_HEIGHT }],
    })

    const plainGroup = buildCabinetGeometry(plain, undefined, 'rendered', false)
    const cutGroup = buildCabinetGeometry(withCooktop, undefined, 'rendered', false)

    expect(vertexCount(findMeshByName(plainGroup, 'cabinet-countertop'))).toBe(24)
    expect(vertexCount(findMeshByName(cutGroup, 'cabinet-countertop'))).toBeGreaterThan(24)
  })
})

describe('buildCabinetGeometry — run countertop cutouts', () => {
  test('a freeform cutout declared on the run is cut out of the run countertop', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_cutout-run',
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
      countertopCutouts: [{ id: 'c1', shape: 'circle', position: { x: 0.3, z: 0 }, radius: 0.04 }],
    })
    const modules = [
      CabinetModuleNode.parse({
        id: 'cabinet-module_a',
        parentId: run.id,
        cabinetType: 'base',
        position: [0, 0.1, 0],
        width: 1.2,
        depth: 0.58,
        carcassHeight: 0.72,
      }),
    ]

    const group = buildCabinetGeometry(
      run,
      geometryContext({ children: modules }),
      'rendered',
      false,
    )
    const countertop = findMeshByName(group, 'cabinet-run-countertop')
    expect(vertexCount(countertop)).toBeGreaterThan(24)
  })

  test('a cooktop module cuts the run countertop above it', () => {
    const run = CabinetNode.parse({
      id: 'cabinet_cooktop-run',
      withCountertop: true,
      countertopThickness: 0.02,
      countertopOverhang: 0.02,
    })
    const modules = [
      CabinetModuleNode.parse({
        id: 'cabinet-module_plain',
        parentId: run.id,
        cabinetType: 'base',
        position: [-0.6, 0.1, 0],
        width: 0.6,
        depth: 0.58,
        carcassHeight: 0.72,
      }),
      CabinetModuleNode.parse({
        id: 'cabinet-module_cooktop',
        parentId: run.id,
        cabinetType: 'base',
        // Flush against the plain module's right edge (-0.3) so both stay in
        // the same contiguous span and share one countertop slab.
        position: [-0.3 + COOKTOP_STANDARD_WIDTH / 2, 0.1, 0],
        width: COOKTOP_STANDARD_WIDTH,
        depth: 0.58,
        carcassHeight: 0.72,
        stack: [{ id: 'cooktop', type: 'cooktop-gas', height: COOKTOP_DEFAULT_HEIGHT }],
      }),
    ]

    const group = buildCabinetGeometry(
      run,
      geometryContext({ children: modules }),
      'rendered',
      false,
    )
    const countertop = findMeshByName(group, 'cabinet-run-countertop')
    expect(vertexCount(countertop)).toBeGreaterThan(24)
  })
})

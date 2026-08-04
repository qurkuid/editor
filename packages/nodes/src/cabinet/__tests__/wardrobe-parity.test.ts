import { describe, expect, test } from 'bun:test'
import type { GeometryContext } from '@pascal-app/core'
import { Box3, type Mesh, type Object3D } from 'three'
import { cabinetDefinition, cabinetModuleDefinition } from '../definition'
import { buildCabinetGeometry } from '../geometry'
import { CabinetModuleNode, CabinetNode } from '../schema'

// The furniture builder is being rebuilt on the cabinet system, so the two
// capabilities the cabinet stack was missing — a wardrobe hanging rail and an
// EP end panel — are covered here alongside the run geometry they land in.

function moduleNode(id: string, stack: unknown[], overrides: Record<string, unknown> = {}) {
  return CabinetModuleNode.parse({
    ...cabinetModuleDefinition.defaults(),
    id,
    parentId: 'cabinet_wardrobe',
    stack,
    ...overrides,
  })
}

function runNode(overrides: Record<string, unknown> = {}) {
  return CabinetNode.parse({
    ...cabinetDefinition.defaults(),
    id: 'cabinet_wardrobe',
    runTier: 'tall',
    children: ['cabinet-module_a'],
    ...overrides,
  })
}

function ctxWith(modules: ReturnType<typeof moduleNode>[]): GeometryContext {
  return {
    children: modules,
    parent: null,
    resolve: (id: string) => modules.find((module) => module.id === id),
    siblings: [],
  } as unknown as GeometryContext
}

function meshesNamed(root: Object3D, fragment: string): Mesh[] {
  const found: Mesh[] = []
  root.traverse((child) => {
    if (child.name.includes(fragment)) found.push(child as Mesh)
  })
  return found
}

describe('wardrobe hanging rail', () => {
  test('a door compartment with hanger gets a rod; without it, none', () => {
    const withRail = moduleNode('cabinet-module_a', [
      { id: 'c0', type: 'door', doorType: 'double', shelfCount: 1, hanger: true },
    ])
    const withoutRail = moduleNode('cabinet-module_a', [
      { id: 'c0', type: 'door', doorType: 'double', shelfCount: 1 },
    ])

    expect(
      meshesNamed(buildCabinetGeometry(withRail, ctxWith([withRail])), 'cabinet-hanger'),
    ).toHaveLength(1)
    expect(
      meshesNamed(buildCabinetGeometry(withoutRail, ctxWith([withoutRail])), 'cabinet-hanger'),
    ).toHaveLength(0)
  })

  test('a shelf compartment can carry a rail too, and keeps its shelves', () => {
    const module = moduleNode('cabinet-module_a', [
      { id: 'c0', type: 'shelf', shelfCount: 2, hanger: true },
    ])
    const group = buildCabinetGeometry(module, ctxWith([module]))

    expect(meshesNamed(group, 'cabinet-hanger')).toHaveLength(1)
    expect(meshesNamed(group, 'cabinet-shelf')).toHaveLength(2)
  })

  test('the rail hangs below the opening top and stays inside the module', () => {
    const module = moduleNode('cabinet-module_a', [
      { id: 'c0', type: 'door', doorType: 'double', hanger: true },
    ])
    const group = buildCabinetGeometry(module, ctxWith([module]))
    const [rail] = meshesNamed(group, 'cabinet-hanger')
    const moduleBounds = new Box3().setFromObject(group)
    const railBounds = new Box3().setFromObject(rail!)

    expect(railBounds.min.x).toBeGreaterThan(moduleBounds.min.x)
    expect(railBounds.max.x).toBeLessThan(moduleBounds.max.x)
    expect(railBounds.max.y).toBeLessThan(moduleBounds.max.y)
  })
})

describe('EP end panel', () => {
  test('renders only on the ends that are both requested and exposed', () => {
    const module = moduleNode('cabinet-module_a', [{ id: 'c0', type: 'door' }])
    const ctx = ctxWith([module])

    const none = buildCabinetGeometry(runNode(), ctx)
    const left = buildCabinetGeometry(runNode({ endPanels: { left: true, right: false } }), ctx)
    const both = buildCabinetGeometry(runNode({ endPanels: { left: true, right: true } }), ctx)

    expect(meshesNamed(none, 'cabinet-run-end-panel')).toHaveLength(0)
    expect(meshesNamed(left, 'cabinet-run-end-panel-left')).toHaveLength(1)
    expect(meshesNamed(left, 'cabinet-run-end-panel-right')).toHaveLength(0)
    expect(meshesNamed(both, 'cabinet-run-end-panel')).toHaveLength(2)
  })

  test('sits outboard of the carcass, widening the run by one board per end', () => {
    const module = moduleNode('cabinet-module_a', [{ id: 'c0', type: 'door' }])
    const ctx = ctxWith([module])
    const bare = new Box3().setFromObject(buildCabinetGeometry(runNode(), ctx))
    const panelled = new Box3().setFromObject(
      buildCabinetGeometry(runNode({ endPanels: { left: true, right: true } }), ctx),
    )

    // An empty run yields an empty Box3 (±Infinity), where the width
    // comparison below passes vacuously — assert real geometry first.
    expect(Number.isFinite(bare.min.x)).toBe(true)
    expect(Number.isFinite(panelled.min.x)).toBe(true)

    const board = module.boardThickness
    expect(panelled.min.x).toBeCloseTo(bare.min.x - board)
    expect(panelled.max.x).toBeCloseTo(bare.max.x + board)
  })
})

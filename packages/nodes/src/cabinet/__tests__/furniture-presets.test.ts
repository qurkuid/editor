import { describe, expect, test } from 'bun:test'
import type { GeometryContext } from '@pascal-app/core'
import { Box3, type Object3D } from 'three'
import { createFurnitureRun, furnitureRunKinds } from '../furniture-presets'
import { buildCabinetGeometry } from '../geometry'

function ctxFor(modules: ReturnType<typeof createFurnitureRun>['modules']): GeometryContext {
  return {
    children: modules,
    parent: null,
    resolve: (id: string) => modules.find((module) => module.id === id),
    siblings: [],
  } as unknown as GeometryContext
}

function named(root: Object3D, fragment: string): Object3D[] {
  const found: Object3D[] = []
  root.traverse((child) => {
    if (child.name.includes(fragment)) found.push(child)
  })
  return found
}

describe('furniture presets build real cabinet runs', () => {
  // A run node renders only run-level parts (plinth, worktop, end panels);
  // each module is its own scene node drawing its own carcass and fronts. So
  // the footprint of a placement is the union, the way the scene assembles it.
  function placementBounds(kind: Parameters<typeof createFurnitureRun>[0]['kind'], count = 3) {
    const { run, modules } = createFurnitureRun({ kind, moduleCount: count })
    const bounds = new Box3()
    bounds.union(new Box3().setFromObject(buildCabinetGeometry(run, ctxFor(modules))))
    for (const module of modules) {
      bounds.union(new Box3().setFromObject(buildCabinetGeometry(module, ctxFor(modules))))
    }
    return { run, modules, bounds }
  }

  test.each(furnitureRunKinds())('%s renders geometry with a finite footprint', (kind) => {
    const { run, modules, bounds } = placementBounds(kind)

    expect(modules).toHaveLength(3)
    expect(modules.every((module) => module.parentId === run.id)).toBe(true)
    expect(Number.isFinite(bounds.min.x)).toBe(true)
    expect(bounds.max.y).toBeGreaterThan(bounds.min.y)
  })

  test.each(furnitureRunKinds())('%s lays modules out edge to edge, no overlap', (kind) => {
    const { modules } = createFurnitureRun({ kind, moduleCount: 4 })
    const centres = modules.map((module) => module.position[0])

    for (let i = 1; i < centres.length; i += 1) {
      expect(centres[i]! - centres[i - 1]!).toBeCloseTo(modules[i]!.width)
    }
    // Centred on the run origin, so placement lands where the user clicked.
    expect(centres[0]! + centres[centres.length - 1]!).toBeCloseTo(0)
  })

  test('a wardrobe gets a hanging rail and EP ends; a base run gets neither', () => {
    const wardrobe = createFurnitureRun({ kind: 'wardrobe' })
    const baseRun = createFurnitureRun({ kind: 'base-run' })

    // Rail is module geometry, EP is run geometry — assert each where it lives.
    const wardrobeModule = buildCabinetGeometry(wardrobe.modules[0]!, ctxFor(wardrobe.modules))
    const wardrobeRun = buildCabinetGeometry(wardrobe.run, ctxFor(wardrobe.modules))
    const baseModule = buildCabinetGeometry(baseRun.modules[0]!, ctxFor(baseRun.modules))
    const baseRunGroup = buildCabinetGeometry(baseRun.run, ctxFor(baseRun.modules))

    expect(named(wardrobeModule, 'cabinet-hanger').length).toBeGreaterThan(0)
    expect(named(wardrobeRun, 'cabinet-run-end-panel')).toHaveLength(2)
    expect(named(baseModule, 'cabinet-hanger')).toHaveLength(0)
    expect(named(baseRunGroup, 'cabinet-run-end-panel')).toHaveLength(0)
  })

  test('only the base kinds carry a worktop; wall and tall do not', () => {
    expect(createFurnitureRun({ kind: 'base-run' }).run.withCountertop).toBe(true)
    expect(createFurnitureRun({ kind: 'island' }).run.withCountertop).toBe(true)
    expect(createFurnitureRun({ kind: 'upper-run' }).run.withCountertop).toBe(false)
    expect(createFurnitureRun({ kind: 'wardrobe' }).run.withCountertop).toBe(false)
  })

  test('wall cabinets mount off the floor, floor-standing kinds do not', () => {
    const at: [number, number, number] = [2, 0, 3]
    expect(createFurnitureRun({ kind: 'upper-run', position: at }).run.position[1]).toBeCloseTo(1.5)
    expect(createFurnitureRun({ kind: 'base-run', position: at }).run.position[1]).toBeCloseTo(0)
    expect(createFurnitureRun({ kind: 'wardrobe', position: at }).run.position[1]).toBeCloseTo(0)
  })
})

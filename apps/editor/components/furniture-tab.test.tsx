import { expect, test } from 'bun:test'
import { createFurnitureRun, useCabinetPlacementType } from '@pascal-app/nodes'
import { FurnitureTab } from './furniture-tab'

// The gallery no longer builds a standalone furniture assembly — it arms the
// cabinet tool with a placement type, and the run comes from the shared
// preset builder. Cover that contract rather than the retired node factory.
test('every gallery preset builds a cabinet run the tool can place', () => {
  for (const type of ['wardrobe', 'cabinet', 'upper-run', 'tall', 'island'] as const) {
    useCabinetPlacementType.getState().setType(type)
    expect(useCabinetPlacementType.getState().type).toBe(type)
  }

  const { run, modules } = createFurnitureRun({
    kind: 'wardrobe',
    moduleCount: 2,
    parentId: 'level_test',
  })

  expect(run.type).toBe('cabinet')
  expect(run.parentId).toBe('level_test')
  expect(run.furniture).toBeUndefined()
  expect(modules).toHaveLength(2)
  expect(modules.every((module) => module.type === 'cabinet-module')).toBe(true)
  expect(FurnitureTab).toBeFunction()
})

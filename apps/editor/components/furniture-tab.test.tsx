import { expect, test } from 'bun:test'
import { createFurnitureNode, FurnitureTab } from './furniture-tab'

test('creates a furniture assembly from the visible Furniture menu defaults', () => {
  const node = createFurnitureNode({
    kind: 'wardrobe',
    dimensions: { width: 2.4, height: 2.4, depth: 0.6 },
    bayCount: 2,
    parentId: 'level_test',
  })

  expect(node.type).toBe('cabinet')
  expect(node.parentId).toBe('level_test')
  expect(node.furniture?.bays).toHaveLength(2)
  expect(node.furniture?.dimensions).toEqual({ width: 2.4, height: 2.4, depth: 0.6 })
  expect(FurnitureTab).toBeFunction()
})

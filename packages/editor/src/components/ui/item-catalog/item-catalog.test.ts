import { expect, test } from 'bun:test'
import { BodyNode } from '@pascal-app/core'
import {
  catalogReplacementNode,
  lightingReplacementNode,
  wallReplacementNode,
} from './item-catalog'

test('replaces an imported body at the same footprint and size', () => {
  const body = BodyNode.parse({
    id: 'body_imported',
    type: 'body',
    parentId: 'level_1',
    vertices: [
      { id: 'v0', position: [2, 1, 4] },
      { id: 'v1', position: [6, 1, 4] },
      { id: 'v2', position: [6, 3, 10] },
    ],
    halfEdges: [
      { id: 'e0', vertexId: 'v0', nextId: 'e1', loopId: 'l0' },
      { id: 'e1', vertexId: 'v1', nextId: 'e2', loopId: 'l0' },
      { id: 'e2', vertexId: 'v2', nextId: 'e0', loopId: 'l0' },
    ],
    loops: [{ id: 'l0', faceId: 'f0', kind: 'outer' }],
    faces: [{ id: 'f0', outerLoopId: 'l0' }],
    shells: [{ id: 's0', faceIds: ['f0'] }],
    metadata: { source: 'SketchUp' },
  })

  const replacement = catalogReplacementNode(body, {
    id: 'chair',
    category: 'chair',
    name: 'Chair',
    thumbnail: '/chair.png',
    src: '/chair.glb',
    dimensions: [2, 1, 3],
  })

  expect(replacement.type).toBe('item')
  expect(replacement.parentId).toBe('level_1')
  expect(replacement.position).toEqual([4, 1, 7])
  expect(replacement.scale).toEqual([2, 2, 2])
  expect(replacement.metadata).toMatchObject({
    source: 'SketchUp',
    replacedSketchUpBodyId: 'body_imported',
  })
})

test('converts an imported body to an editable Pascal wall', () => {
  const body = importedBody()
  const wall = wallReplacementNode(body)

  expect(wall.type).toBe('wall')
  expect(wall.start).toEqual([4, 4])
  expect(wall.end).toEqual([4, 10])
  expect(wall.thickness).toBe(4)
  expect(wall.height).toBe(2)
  expect(wall.supportOffset).toBe(1)
})

test('converts an imported body to an editable Pascal light', () => {
  const body = importedBody()
  const asset = {
    id: 'pendant',
    category: '조명',
    name: 'Pendant',
    thumbnail: '/pendant.png',
    src: '/pendant.glb',
    dimensions: [1, 1, 1],
  } satisfies Parameters<typeof lightingReplacementNode>[1]
  const light = lightingReplacementNode(body, asset)

  expect(light.type).toBe('lighting-fixture')
  expect(light.position).toEqual([4, 2, 7])
  expect(light.lightType).toBe('point')
  expect(light.asset).toMatchObject(asset)
  expect(light.metadata).toMatchObject({ replacedSketchUpBodyId: 'body_imported' })
})

function importedBody() {
  return BodyNode.parse({
    id: 'body_imported',
    type: 'body',
    parentId: 'level_1',
    vertices: [
      { id: 'v0', position: [2, 1, 4] },
      { id: 'v1', position: [6, 1, 4] },
      { id: 'v2', position: [6, 3, 10] },
    ],
    halfEdges: [
      { id: 'e0', vertexId: 'v0', nextId: 'e1', loopId: 'l0' },
      { id: 'e1', vertexId: 'v1', nextId: 'e2', loopId: 'l0' },
      { id: 'e2', vertexId: 'v2', nextId: 'e0', loopId: 'l0' },
    ],
    loops: [{ id: 'l0', faceId: 'f0', kind: 'outer' }],
    faces: [{ id: 'f0', outerLoopId: 'l0' }],
    shells: [{ id: 's0', faceIds: ['f0'] }],
    metadata: { source: 'SketchUp' },
  })
}

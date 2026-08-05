import { describe, expect, test } from 'bun:test'
import { ConstructionGuideNode, type GeometryContext } from '@pascal-app/core'
import {
  buildConstructionGuideFloorplan,
  CONSTRUCTION_GUIDE_EXTENT,
  guideFrame,
  guideLineEndpoints,
} from './floorplan'

const ctx = (selected = false): GeometryContext =>
  ({
    resolve: () => undefined,
    children: [],
    parent: null,
    siblings: [],
    ...(selected
      ? { viewState: { selected: true, highlighted: false, palette: { selectedStroke: '#25f' } } }
      : {}),
  }) as unknown as GeometryContext

const guide = (origin: [number, number], direction: [number, number]) =>
  ConstructionGuideNode.parse({ parentId: 'level_test', origin, direction })

describe('guideFrame', () => {
  test('normalizes the direction and derives the +90° normal', () => {
    const frame = guideFrame([1, 2], [3, 0])
    expect(frame.direction[0]).toBeCloseTo(1)
    expect(frame.direction[1]).toBeCloseTo(0)
    expect(frame.normal[0]).toBeCloseTo(0)
    expect(frame.normal[1]).toBeCloseTo(1)
  })
})

describe('guideLineEndpoints', () => {
  test('spans the extent both ways from the origin', () => {
    const { a, b } = guideLineEndpoints(guideFrame([5, 0], [0, 2]))
    expect(a).toEqual([5, -CONSTRUCTION_GUIDE_EXTENT])
    expect(b).toEqual([5, CONSTRUCTION_GUIDE_EXTENT])
  })
})

describe('buildConstructionGuideFloorplan', () => {
  test('emits dashed line + hit line, and the slide handle only when selected', () => {
    const node = guide([0, 0], [1, 0])
    const idle = buildConstructionGuideFloorplan(node, ctx())
    expect(idle?.kind).toBe('group')
    const idleKinds = (idle as { children: { kind: string }[] }).children.map((c) => c.kind)
    expect(idleKinds).toEqual(['line', 'hit-line'])

    const selected = buildConstructionGuideFloorplan(node, ctx(true))
    const selectedKinds = (selected as { children: { kind: string }[] }).children.map((c) => c.kind)
    expect(selectedKinds).toEqual(['line', 'hit-line', 'edge-handle'])
  })

  test('hidden guides emit nothing', () => {
    const node = { ...guide([0, 0], [1, 0]), visible: false }
    expect(buildConstructionGuideFloorplan(node, ctx())).toBeNull()
  })

  test('schema rejects a zero direction', () => {
    expect(() => guide([0, 0], [0, 0])).toThrow()
  })
})

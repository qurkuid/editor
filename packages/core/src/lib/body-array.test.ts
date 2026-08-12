import { describe, expect, test } from 'bun:test'
import { BodyNode } from '../schema/nodes/body'
import { createBodyCircularArray, createBodyLinearArray } from './body-array'
import { createRectangleBody, validateBodyTopology } from './body-topology'

function sourceBody(): BodyNode {
  return BodyNode.parse({
    ...createRectangleBody({ width: 2, depth: 1 }),
    id: 'body_array_source',
    parentId: 'level_array_source',
    faces: [
      {
        ...createRectangleBody({ width: 2, depth: 1 }).faces[0]!,
        surface: {
          materialRef: 'scene:oak',
          uvOrigin: [0.2, 0.3, 0.4],
          uvU: [0.5, 0, 0],
          uvV: [0, 0, 0.5],
        },
      },
    ],
  })
}

describe('Body arrays', () => {
  test('creates linear instances with fresh node ids and stable topology ids', () => {
    const source = sourceBody()
    const clones = createBodyLinearArray(source, { count: 3, offset: [2, 1, -0.5] })

    expect(clones).toHaveLength(2)
    expect(new Set(clones.map((clone) => clone.id)).size).toBe(2)
    expect(clones.every((clone) => clone.parentId === source.parentId)).toBe(true)
    expect(clones[0]?.vertices.map(({ id }) => id)).toEqual(source.vertices.map(({ id }) => id))
    expect(clones[1]?.vertices.map(({ id }) => id)).toEqual(source.vertices.map(({ id }) => id))
    expect(clones[0]?.vertices[0]?.position).toEqual([2, 1, -0.5])
    expect(clones[1]?.vertices[0]?.position).toEqual([4, 2, -1])
    expect(clones[0]?.faces[0]?.surface.materialRef).toBe('scene:oak')
    expect(clones[0]?.faces[0]?.surface.uvOrigin).toEqual([2.2, 1.3, -0.09999999999999998])
    expect(clones[0]?.faces[0]?.surface.uvU).toEqual([0.5, 0, 0])
    expect(clones[0]?.faces[0]?.surface.uvV).toEqual([0, 0, 0.5])
    expect(source.vertices[0]?.position).toEqual([0, 0, 0])
    expect(validateBodyTopology(clones[0]!)).toEqual({ valid: true, diagnostics: [] })
    expect(validateBodyTopology(clones[1]!)).toEqual({ valid: true, diagnostics: [] })
  })

  test('creates a full circular array with the default 2π angle', () => {
    const source = sourceBody()
    const clones = createBodyCircularArray(source, {
      count: 4,
      center: [0, 0, 0],
      axis: [0, 2, 0],
      fullCircle: true,
    })

    expect(clones).toHaveLength(3)
    expect(clones[0]?.vertices[0]?.position).toEqual([0, 0, 0])
    expect(clones[0]?.vertices[1]?.position[0]).toBeCloseTo(0)
    expect(clones[0]?.vertices[1]?.position[2]).toBeCloseTo(-2)
    expect(clones[1]?.vertices[1]?.position[0]).toBeCloseTo(-2)
    expect(clones[1]?.vertices[1]?.position[2]).toBeCloseTo(0)
    expect(clones[2]?.vertices[1]?.position[0]).toBeCloseTo(0)
    expect(clones[2]?.vertices[1]?.position[2]).toBeCloseTo(2)
    expect(clones.every((clone) => clone.faces[0]?.surface.materialRef === 'scene:oak')).toBe(true)
  })

  test('uses the endpoint-inclusive signed angle for partial circular arrays', () => {
    const source = sourceBody()
    const clones = createBodyCircularArray(source, {
      count: 3,
      center: [0, 0, 0],
      axis: [0, 1, 0],
      angle: Math.PI,
    })

    expect(clones[0]?.vertices[1]?.position[0]).toBeCloseTo(0)
    expect(clones[0]?.vertices[1]?.position[2]).toBeCloseTo(-2)
    expect(clones[1]?.vertices[1]?.position[0]).toBeCloseTo(-2)
    expect(clones[1]?.vertices[1]?.position[2]).toBeCloseTo(0)
  })

  test('rejects invalid counts, offsets, angles, and axes without changing the source', () => {
    const source = sourceBody()
    const before = structuredClone(source)

    expect(() => createBodyLinearArray(source, { count: 1, offset: [1, 0, 0] })).toThrow('count')
    expect(() => createBodyLinearArray(source, { count: 2, offset: [Number.NaN, 0, 0] })).toThrow(
      'offset',
    )
    expect(() =>
      createBodyCircularArray(source, {
        count: 2,
        center: [0, 0, 0],
        axis: [0, 0, 0],
        angle: 1,
      }),
    ).toThrow('axis')
    expect(() =>
      createBodyCircularArray(source, {
        count: 2,
        center: [0, 0, 0],
        axis: [0, 1, 0],
      }),
    ).toThrow('angle')
    expect(source).toEqual(before)
  })
})

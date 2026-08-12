import { describe, expect, test } from 'bun:test'
import { BodyNode } from '../schema/nodes/body'
import {
  BodyCsgError,
  booleanBodies,
  intersectBodies,
  outerShellBodies,
  splitBodies,
  subtractBodies,
  trimBodies,
  unionBodies,
} from './body-csg'
import { inspectBodySolid } from './body-solid'
import {
  createPlanarFaceBody,
  getBodyLoopVertices,
  getBodySemanticHash,
  pushPullBodyFace,
  validateBodyTopology,
} from './body-topology'

function faceNormal(body: BodyNode, faceId: string): [number, number, number] {
  const face = body.faces.find((candidate) => candidate.id === faceId)!
  const points = getBodyLoopVertices(body, face.outerLoopId)
  for (let first = 0; first < points.length - 2; first += 1) {
    for (let second = first + 1; second < points.length - 1; second += 1) {
      for (let third = second + 1; third < points.length; third += 1) {
        const a = [
          points[second]![0] - points[first]![0],
          points[second]![1] - points[first]![1],
          points[second]![2] - points[first]![2],
        ] as const
        const b = [
          points[third]![0] - points[first]![0],
          points[third]![1] - points[first]![1],
          points[third]![2] - points[first]![2],
        ] as const
        const normal: [number, number, number] = [
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ]
        if (normal.some((value) => Math.abs(value) > 1e-8)) return normal
      }
    }
  }
  throw new Error(`degenerate face ${faceId}`)
}

function prism(
  id: string,
  profile: ReadonlyArray<readonly [number, number, number]>,
  height: number,
  surface?: { materialRef?: string; uvOrigin?: [number, number, number] },
): BodyNode {
  const planar = BodyNode.parse({
    ...createPlanarFaceBody(profile),
    id: `body_${id}`,
    parentId: 'level_csg',
    bodyDefaults: { materialRef: surface?.materialRef },
    faces: [
      {
        id: 'face:0',
        outerLoopId: 'loop:0',
        surface: {
          materialRef: surface?.materialRef,
          uvOrigin: surface?.uvOrigin ?? [0, 0, 0],
          uvU: [1, 0, 0],
          uvV: [0, 0, 1],
        },
      },
    ],
  })
  const body = pushPullBodyFace(planar, 'face:0', height).body
  return BodyNode.parse({
    ...body,
    id: `body_${id}`,
    parentId: 'level_csg',
    faces: body.faces.map((face) => ({
      ...face,
      surface: surface ? { ...face.surface, materialRef: surface.materialRef } : face.surface,
    })),
  })
}

function box(
  id: string,
  origin: readonly [number, number, number],
  width: number,
  height: number,
  depth: number,
  materialRef = 'scene:target',
): BodyNode {
  return prism(
    id,
    [
      [origin[0], origin[1], origin[2]],
      [origin[0] + width, origin[1], origin[2]],
      [origin[0] + width, origin[1], origin[2] + depth],
      [origin[0], origin[1], origin[2] + depth],
    ],
    height,
    {
      materialRef,
      uvOrigin: materialRef === 'scene:tool' ? [0.4, 0.5, 0.6] : [0.25, 0.5, 0.75],
    },
  )
}

describe('Body CSG', () => {
  test('intersects overlapping boxes with deterministic topology and provenance', () => {
    const target = box('target', [0, 0, 0], 2, 2, 2)
    const tool = box('tool', [1, 0.5, 1], 2, 2, 2, 'scene:tool')
    const first = intersectBodies(target, tool)
    const second = intersectBodies(target, tool)

    expect(first.body.id).toBe(target.id)
    expect(first.body.parentId).toBe(target.parentId)
    expect(first.body.name).toBe(target.name)
    expect(first.body.revision).toBe(target.revision + 1)
    expect(first.body).toEqual(second.body)
    expect(first.topologyRemap).toEqual(second.topologyRemap)
    expect(validateBodyTopology(first.body).valid).toBe(true)
    expect(inspectBodySolid(first.body)).toMatchObject({ validSolid: true, volume: 1.5 })
    expect(first.body.faces.map((face) => face.surface.materialRef)).toEqual(
      expect.arrayContaining(['scene:target', 'scene:tool']),
    )
    expect(first.body.faces.map((face) => face.surface.uvOrigin)).toEqual(
      expect.arrayContaining([
        [0.25, 0.5, 0.75],
        [0.4, 0.5, 0.6],
      ]),
    )
    expect(first.topologyRemap.preserved).toEqual(['shell:0'])
    expect(first.topologyRemap.deleted).not.toContain('shell:0')
    expect(first.topologyRemap.split['face:0']).toBeDefined()
  })

  test('supports all operations for a non-axis-aligned triangular prism', () => {
    const target = prism(
      'triangle',
      [
        [0, 0, 0],
        [2, 0, 0.4],
        [0.2, 0, 2],
      ],
      2,
    )
    const tool = box('tool', [0.1, 0.2, 0.1], 1, 1, 1)
    for (const operation of ['union', 'subtract', 'intersect'] as const) {
      const result = booleanBodies(target, tool, operation)
      expect(inspectBodySolid(result.body).validSolid).toBe(true)
      expect(inspectBodySolid(result.body).volume).toBeGreaterThan(0)
      expect(validateBodyTopology(result.body).valid).toBe(true)
      expect(result.body).toEqual(booleanBodies(target, tool, operation).body)
    }
  })

  test('supports all operations for overlapping boxes', () => {
    const target = box('target', [0, 0, 0], 2, 2, 2)
    const tool = box('tool', [1, 0.5, 1], 2, 2, 2, 'scene:tool')
    const expectedVolumes = { union: 14.5, subtract: 6.5, intersect: 1.5 }
    for (const operation of ['union', 'subtract', 'intersect'] as const) {
      const result = booleanBodies(target, tool, operation)
      const inspection = inspectBodySolid(result.body)
      expect(inspection.validSolid).toBe(true)
      expect(inspection.volume).toBeCloseTo(expectedVolumes[operation], 6)
      expect(validateBodyTopology(result.body).valid).toBe(true)
      expect(result.body).toEqual(booleanBodies(target, tool, operation).body)
    }
    const subtractResult = subtractBodies(target, tool)
    const cutFaces = subtractResult.body.faces.filter((face) => {
      if (face.surface.materialRef !== 'scene:tool') return false
      return getBodyLoopVertices(subtractResult.body, face.outerLoopId).every(
        (point) => Math.abs(point[0] - 1) <= 1e-8,
      )
    })
    expect(cutFaces.length).toBeGreaterThan(0)
    expect(cutFaces.every((face) => faceNormal(subtractResult.body, face.id)[0] > 0)).toBe(true)
  })

  test('scopes remap provenance to target faces when operands share feature IDs', () => {
    const target = box('target', [0, 0, 0], 2, 2, 2)
    const tool = box('tool', [1, 0.5, 1], 2, 2, 2, 'scene:tool')
    const result = unionBodies(target, tool)
    const remappedTargetFace = result.topologyRemap.split['face:0'] ?? []

    expect(remappedTargetFace.length).toBeGreaterThan(0)
    expect(
      remappedTargetFace.every(
        (faceId) =>
          result.body.faces.find((face) => face.id === faceId)?.surface.materialRef ===
          'scene:target',
      ),
    ).toBe(true)
    expect(result.body.faces.some((face) => face.surface.materialRef === 'scene:tool')).toBe(true)
    expect(result.topologyRemap).toEqual(unionBodies(target, tool).topologyRemap)
  })

  test('supports concave L-prism operations as one valid shell', () => {
    const concave = prism(
      'concave',
      [
        [0, 0, 0],
        [2, 0, 0],
        [2, 0, 1],
        [1, 0, 1],
        [1, 0, 2],
        [0, 0, 2],
      ],
      1,
    )
    const tool = box('tool', [0.2, 0.2, 0.2], 1, 1, 1)
    const expectedVolumes = { union: 3.232, subtract: 2.232, intersect: 0.768 }
    for (const operation of ['union', 'subtract', 'intersect'] as const) {
      const result = booleanBodies(concave, tool, operation)
      const inspection = inspectBodySolid(result.body)
      expect(inspection.validSolid).toBe(true)
      expect(validateBodyTopology(result.body).valid).toBe(true)
      expect(result.body.shells).toHaveLength(1)
      expect(inspection.volume).toBeCloseTo(expectedVolumes[operation], 6)
      expect(getBodySemanticHash(result.body)).toBe(
        getBodySemanticHash(booleanBodies(concave, tool, operation).body),
      )
    }
  })

  test('rejects empty, touching, mismatched-parent, and invalid inputs without mutation', () => {
    const target = box('target', [0, 0, 0], 1, 1, 1)
    const before = getBodySemanticHash(target)
    expect(() => intersectBodies(target, box('disjoint', [2, 0, 0], 1, 1, 1))).toThrow(
      'empty result',
    )
    expect(() => intersectBodies(target, box('touching', [1, 0, 0], 1, 1, 1))).toThrow(BodyCsgError)
    expect(() =>
      intersectBodies(
        target,
        BodyNode.parse({ ...box('other', [0, 0, 0], 1, 1, 1), parentId: 'other_parent' }),
      ),
    ).toThrow('share a parent')
    expect(getBodySemanticHash(target)).toBe(before)
  })

  test('implements outer shell, trim, and split with fixed piece order', () => {
    const target = box('target', [0, 0, 0], 2, 2, 2)
    const tool = box('tool', [1, 0, 1], 2, 2, 2, 'scene:tool')

    expect(inspectBodySolid(outerShellBodies(target, tool).body).volume).toBeCloseTo(14, 6)
    expect(inspectBodySolid(trimBodies(target, tool).body).volume).toBeCloseTo(6, 6)

    const first = splitBodies(target, tool)
    const second = splitBodies(target, tool)
    expect(first.pieces.map((piece) => piece.kind)).toEqual([
      'target-only',
      'intersection',
      'tool-only',
    ])
    const volumes = first.pieces.map((piece) => inspectBodySolid(piece.body).volume ?? 0)
    expect(volumes[0]).toBeCloseTo(6, 6)
    expect(volumes[1]).toBeCloseTo(2, 6)
    expect(volumes[2]).toBeCloseTo(6, 6)
    expect(first).toEqual(second)
    expect(first.pieces.map((piece) => piece.body.id)).toEqual([
      target.id,
      tool.id,
      `${target.id}:split:${tool.id}`,
    ])
  })

  test('split omits only empty pieces and requires at least two results', () => {
    const target = box('target', [0, 0, 0], 1, 1, 1)
    const disjoint = box('tool', [2, 0, 0], 1, 1, 1)
    expect(splitBodies(target, disjoint).pieces.map((piece) => piece.kind)).toEqual([
      'target-only',
      'tool-only',
    ])

    expect(() => splitBodies(target, box('same', [0, 0, 0], 1, 1, 1))).toThrow(
      'at least two non-empty pieces',
    )
  })

  test('keeps a representative Solid Tools batch within the focused performance budget', () => {
    const target = box('perf-target', [0, 0, 0], 2, 2, 2)
    const tool = box('perf-tool', [1, 0, 1], 2, 2, 2)
    const startedAt = performance.now()
    for (let index = 0; index < 10; index += 1) splitBodies(target, tool)
    expect(performance.now() - startedAt).toBeLessThan(1000)
  })
})

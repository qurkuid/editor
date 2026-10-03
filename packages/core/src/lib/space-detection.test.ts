import { describe, expect, test } from 'bun:test'
import { BuildingNode, CeilingNode, LevelNode, SlabNode, WallNode, ZoneNode } from '../schema'
import type { AnyNode, AnyNodeId } from '../schema/types'
import { resolveCeilingHeight } from '../services/level-height'
import { getCeilingClampBound } from '../services/storey'
import { simplifyClosedPolygon } from './polygon-geometry'
import {
  detectSpacesForLevel,
  initSpaceDetectionSync,
  planAutoCeilingsForLevel,
  planAutoSlabsForLevel,
  planAutoZonesForLevel,
  resolveAutoZonePolygon,
  wallClosesRoom,
} from './space-detection'
import { createDefaultWallFaceBands } from './wall-construction'

const square: Array<[number, number]> = [
  [0, 0],
  [4, 0],
  [4, 3],
  [0, 3],
]

function roomPolygon() {
  return square.map(([x, y]) => ({ x, y }))
}

type PolygonPoint = [number, number]

const TEST_GEOMETRY_EPSILON = 1e-8
const TEST_AREA_EPSILON = 1e-9

function testCross(first: PolygonPoint, second: PolygonPoint, third: PolygonPoint) {
  return (
    (second[0] - first[0]) * (third[1] - second[1]) -
    (second[1] - first[1]) * (third[0] - second[0])
  )
}

function testSignedArea(polygon: PolygonPoint[]) {
  return (
    polygon.reduce((area, point, index) => {
      const next = polygon[(index + 1) % polygon.length]!
      return area + point[0] * next[1] - next[0] * point[1]
    }, 0) / 2
  )
}

function cleanTestPolygon(polygon: PolygonPoint[]) {
  const clean: PolygonPoint[] = []
  for (const point of polygon) {
    const previous = clean[clean.length - 1]
    if (
      previous &&
      Math.hypot(point[0] - previous[0], point[1] - previous[1]) <= TEST_GEOMETRY_EPSILON
    ) {
      continue
    }
    clean.push([...point])
  }
  if (
    clean.length > 1 &&
    Math.hypot(clean[0]![0] - clean.at(-1)![0], clean[0]![1] - clean.at(-1)![1]) <=
      TEST_GEOMETRY_EPSILON
  ) {
    clean.pop()
  }

  let changed = true
  while (changed && clean.length >= 3) {
    changed = false
    for (let index = 0; index < clean.length; index += 1) {
      const first = clean[(index + clean.length - 1) % clean.length]!
      const current = clean[index]!
      const last = clean[(index + 1) % clean.length]!
      if (
        Math.abs(testCross(first, current, last)) <= TEST_GEOMETRY_EPSILON &&
        current[0] >= Math.min(first[0], last[0]) - TEST_GEOMETRY_EPSILON &&
        current[0] <= Math.max(first[0], last[0]) + TEST_GEOMETRY_EPSILON &&
        current[1] >= Math.min(first[1], last[1]) - TEST_GEOMETRY_EPSILON &&
        current[1] <= Math.max(first[1], last[1]) + TEST_GEOMETRY_EPSILON
      ) {
        clean.splice(index, 1)
        changed = true
        break
      }
    }
  }
  return clean
}

function testPointInTriangle(point: PolygonPoint, triangle: PolygonPoint[]) {
  return triangle.every(
    (edgeStart, index) =>
      testCross(edgeStart, triangle[(index + 1) % triangle.length]!, point) >=
      -TEST_GEOMETRY_EPSILON,
  )
}

function triangulateTestPolygon(input: PolygonPoint[]) {
  const polygon = cleanTestPolygon(input)
  if (polygon.length < 3 || Math.abs(testSignedArea(polygon)) <= TEST_AREA_EPSILON) return []
  if (testSignedArea(polygon) < 0) polygon.reverse()

  const indices = polygon.map((_, index) => index)
  const triangles: PolygonPoint[][] = []
  let guard = 0
  while (indices.length > 3) {
    guard += 1
    if (guard > polygon.length * polygon.length * 2) {
      throw new Error('test polygon triangulation did not converge')
    }
    let foundEar = false
    for (let position = 0; position < indices.length; position += 1) {
      const previous = indices[(position + indices.length - 1) % indices.length]!
      const current = indices[position]!
      const next = indices[(position + 1) % indices.length]!
      const triangle = [polygon[previous]!, polygon[current]!, polygon[next]!]
      if (
        testCross(...(triangle as [PolygonPoint, PolygonPoint, PolygonPoint])) <=
        TEST_GEOMETRY_EPSILON
      ) {
        continue
      }
      if (
        indices.some(
          (index) =>
            index !== previous &&
            index !== current &&
            index !== next &&
            testPointInTriangle(polygon[index]!, triangle),
        )
      ) {
        continue
      }
      triangles.push(triangle)
      indices.splice(position, 1)
      foundEar = true
      break
    }
    if (!foundEar) {
      throw new Error('test polygon is not simple enough to triangulate')
    }
  }
  triangles.push(indices.map((index) => polygon[index]!))
  return triangles
}

function testLineIntersection(
  firstStart: PolygonPoint,
  firstEnd: PolygonPoint,
  secondStart: PolygonPoint,
  secondEnd: PolygonPoint,
): PolygonPoint {
  const denominator =
    (firstStart[0] - firstEnd[0]) * (secondStart[1] - secondEnd[1]) -
    (firstStart[1] - firstEnd[1]) * (secondStart[0] - secondEnd[0])
  if (Math.abs(denominator) <= TEST_GEOMETRY_EPSILON) return [...firstEnd]
  const firstNumerator = firstStart[0] * firstEnd[1] - firstStart[1] * firstEnd[0]
  const secondNumerator = secondStart[0] * secondEnd[1] - secondStart[1] * secondEnd[0]
  return [
    (firstNumerator * (secondStart[0] - secondEnd[0]) -
      (firstStart[0] - firstEnd[0]) * secondNumerator) /
      denominator,
    (firstNumerator * (secondStart[1] - secondEnd[1]) -
      (firstStart[1] - firstEnd[1]) * secondNumerator) /
      denominator,
  ]
}

function clipTestPolygon(subject: PolygonPoint[], clip: PolygonPoint[]) {
  let output = subject.map((point) => [...point] as PolygonPoint)
  for (let index = 0; index < clip.length; index += 1) {
    const clipStart = clip[index]!
    const clipEnd = clip[(index + 1) % clip.length]!
    if (output.length === 0) break
    const next: PolygonPoint[] = []
    let previous = output.at(-1)!
    let previousInside = testCross(clipStart, clipEnd, previous) >= -TEST_GEOMETRY_EPSILON
    for (const current of output) {
      const currentInside = testCross(clipStart, clipEnd, current) >= -TEST_GEOMETRY_EPSILON
      if (currentInside !== previousInside) {
        next.push(testLineIntersection(previous, current, clipStart, clipEnd))
      }
      if (currentInside) next.push(current)
      previous = current
      previousInside = currentInside
    }
    output = cleanTestPolygon(next)
  }
  return output
}

function exactPolygonIntersectionArea(first: PolygonPoint[], second: PolygonPoint[]) {
  const firstTriangles = triangulateTestPolygon(first)
  const secondTriangles = triangulateTestPolygon(second)
  let area = 0
  for (const firstTriangle of firstTriangles) {
    for (const secondTriangle of secondTriangles) {
      const clipped = clipTestPolygon(firstTriangle, secondTriangle)
      if (clipped.length >= 3) area += Math.abs(testSignedArea(clipped))
    }
  }
  return area
}

function squareWalls(height = 2.5) {
  return [
    WallNode.parse({ start: [0, 0], end: [4, 0], height }),
    WallNode.parse({ start: [4, 0], end: [4, 3], height }),
    WallNode.parse({ start: [4, 3], end: [0, 3], height }),
    WallNode.parse({ start: [0, 3], end: [0, 0], height }),
  ]
}

type FrozenWallDefinition = {
  id: string
  start: [number, number]
  end: [number, number]
}

const residualTopologyFixtures: Record<string, FrozenWallDefinition[]> = {
  p12: [
    {
      id: 'p12-rud45',
      start: [6.012983493757884, -0.4182776708280799],
      end: [6.012983493757884, -2.3346776708280794],
    },
    {
      id: 'p12-wnmj',
      start: [6.012983493757884, -2.3346776708280794],
      end: [6.012983493757884, -3.18407767082808],
    },
    {
      id: 'p12-3stc',
      start: [7.381783493757883, 2.467422329171921],
      end: [7.381783493757883, -3.1840776708280796],
    },
    {
      id: 'p12-cn0d',
      start: [4.689083493757882, -0.41827767082808],
      end: [4.689083493757882, 1.34122232917192],
    },
    {
      id: 'p12-noxn',
      start: [4.689083493757882, 1.34122232917192],
      end: [4.689083493757882, 2.467422329171921],
    },
    {
      id: 'p12-ahgr',
      start: [4.689083493757882, -0.41827767082808],
      end: [6.368183493757881, -0.4182776708280799],
    },
    {
      id: 'p12-iki6',
      start: [6.012983493757884, -3.18407767082808],
      end: [7.381783493757883, -3.18407767082808],
    },
    {
      id: 'p12-h3d9',
      start: [6.368183493757881, 1.34122232917192],
      end: [6.368183493757881, -0.41827767082808],
    },
    {
      id: 'p12-1saz',
      start: [4.689083493757882, 2.467422329171921],
      end: [7.381783493757883, 2.467422329171921],
    },
    {
      id: 'p12-7zso',
      start: [6.012983493757884, -0.5128101644013427],
      end: [6.368183493757881, -0.3071776708280795],
    },
  ],
  p14: [
    {
      id: 'p14-lypc',
      start: [-0.9824480664077965, 1.9729346223948023],
      end: [-0.9824480664077965, 0.9068346223948018],
    },
    {
      id: 'p14-ti41',
      start: [-4.180748066407797, 0.906834622394802],
      end: [-1.679248066407797, 0.906834622394802],
    },
    {
      id: 'p14-8el8',
      start: [-1.679248066407797, 0.906834622394802],
      end: [-0.9824480664077964, 0.906834622394802],
    },
    {
      id: 'p14-4kil',
      start: [-1.6792480664077967, 1.9729346223948023],
      end: [-0.9824480664077965, 1.9729346223948023],
    },
    {
      id: 'p14-iuyl',
      start: [-1.6792480664077967, 0.8494269721215777],
      end: [-1.6792480664077967, 1.9729346223948023],
    },
    {
      id: 'p14-flh8',
      start: [-1.6792480664077967, 0.8494269721215777],
      end: [-2.055548066407797, 0.9337346223948025],
    },
  ],
  p22: [
    {
      id: 'p22-m9be',
      start: [-1.4252186529023256, -3.227412619285043],
      end: [0.09641851514779853, -3.227812629055823],
    },
    {
      id: 'p22-2a0d',
      start: [-1.4252186529023256, -3.720117749693086],
      end: [-1.4252186529023256, -3.227412619285043],
    },
    {
      id: 'p22-cxa4',
      start: [-1.4252186529023256, -3.720117749693086],
      end: [2.584208180661554, -3.7608954756897957],
    },
    {
      id: 'p22-ufgb',
      start: [2.584208180661554, -3.7608954756897957],
      end: [4.147081347097673, -3.7767906189095295],
    },
    {
      id: 'p22-jkwa',
      start: [0.09531958678588434, -1.689812435268218],
      end: [0.09641851514779831, -3.227812629055823],
    },
    {
      id: 'p22-z8xm',
      start: [1.6815813470976737, -1.689812435268218],
      end: [1.6815813470976737, -4.862112435268219],
    },
    {
      id: 'p22-5d2v',
      start: [0.09531958678588434, -1.689812435268218],
      end: [1.6815813470976737, -1.689812435268218],
    },
    {
      id: 'p22-uzmq',
      start: [1.6815813470976737, -4.862112435268219],
      end: [2.5268813470976728, -4.862112435268219],
    },
    {
      id: 'p22-wumj',
      start: [2.5268813470976728, -3.7788232675815596],
      end: [2.5268813470976728, -4.862112435268219],
    },
    {
      id: 'p22-q2be',
      start: [2.5268813470976728, -3.77882326758156],
      end: [2.819181347097674, -3.6874124352682185],
    },
  ],
  p35: [
    {
      id: 'p35-94bw',
      start: [-4.312317318598669, -1.0869782123991136],
      end: [-1.5298173185986705, -1.0869782123991136],
    },
    {
      id: 'p35-826i',
      start: [-5.890317318598671, -0.0708782123991134],
      end: [-5.890317318598671, -1.6185782123991141],
    },
    {
      id: 'p35-7upn',
      start: [-5.890317318598671, -1.6185782123991141],
      end: [-5.890317318598671, -3.0353782123991135],
    },
    {
      id: 'p35-vvhq',
      start: [-1.5298173185986708, -1.0869782123991136],
      end: [-1.5298173185986708, -2.044878212399113],
    },
    {
      id: 'p35-rthd',
      start: [-1.5298173185986708, -2.044878212399113],
      end: [-1.5298173185986708, -3.035378212399113],
    },
    {
      id: 'p35-bd7c',
      start: [-4.31231731859867, 0.389921787600886],
      end: [-4.31231731859867, -1.6185782123991137],
    },
    {
      id: 'p35-38in',
      start: [-5.890317318598671, -3.035378212399113],
      end: [-4.40681731859867, -3.035378212399113],
    },
    {
      id: 'p35-xj44',
      start: [-4.40681731859867, -3.035378212399113],
      end: [-1.5298173185986708, -3.035378212399113],
    },
    {
      id: 'p35-qyir',
      start: [-5.906602477328828, -1.618578212399114],
      end: [-4.31231731859867, -1.618578212399114],
    },
    {
      id: 'p35-2j9b',
      start: [-5.906602477328828, -1.618578212399114],
      end: [-5.82461731859867, -1.1814782123991134],
    },
  ],
}

function residualTopologyWalls(fixture: FrozenWallDefinition[]) {
  return fixture.map((wall) => WallNode.parse({ ...wall, id: `wall_${wall.id}` }))
}

function polygonBoundaryIssueCount(polygon: Array<[number, number]>) {
  if (polygon.length < 3) return 1
  const orient = (a: [number, number], b: [number, number], c: [number, number]) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const epsilon = 1e-8
  const onSegment = (a: [number, number], b: [number, number], point: [number, number]) =>
    point[0] >= Math.min(a[0], b[0]) - epsilon &&
    point[0] <= Math.max(a[0], b[0]) + epsilon &&
    point[1] >= Math.min(a[1], b[1]) - epsilon &&
    point[1] <= Math.max(a[1], b[1]) + epsilon
  const segmentsTouch = (
    firstStart: [number, number],
    firstEnd: [number, number],
    secondStart: [number, number],
    secondEnd: [number, number],
  ) => {
    const firstStartSide = orient(firstStart, firstEnd, secondStart)
    const firstEndSide = orient(firstStart, firstEnd, secondEnd)
    const secondStartSide = orient(secondStart, secondEnd, firstStart)
    const secondEndSide = orient(secondStart, secondEnd, firstEnd)
    if (firstStartSide * firstEndSide < -epsilon && secondStartSide * secondEndSide < -epsilon) {
      return true
    }
    return (
      (Math.abs(firstStartSide) <= epsilon && onSegment(firstStart, firstEnd, secondStart)) ||
      (Math.abs(firstEndSide) <= epsilon && onSegment(firstStart, firstEnd, secondEnd)) ||
      (Math.abs(secondStartSide) <= epsilon && onSegment(secondStart, secondEnd, firstStart)) ||
      (Math.abs(secondEndSide) <= epsilon && onSegment(secondStart, secondEnd, firstEnd))
    )
  }
  let count = 0
  for (let first = 0; first < polygon.length; first += 1) {
    const firstStart = polygon[first]!
    const firstEnd = polygon[(first + 1) % polygon.length]!
    if (Math.hypot(firstEnd[0] - firstStart[0], firstEnd[1] - firstStart[1]) <= epsilon) {
      count += 1
    }
    for (let second = first + 1; second < polygon.length; second += 1) {
      if (second === first + 1 || (first === 0 && second === polygon.length - 1)) continue
      const secondStart = polygon[second]!
      const secondEnd = polygon[(second + 1) % polygon.length]!
      if (segmentsTouch(firstStart, firstEnd, secondStart, secondEnd)) count += 1
    }
  }
  return count
}

const residualExpectedSpaceCounts: Record<string, number> = {
  p12: 1,
  p14: 1,
  p22: 2,
  p35: 1,
}

function samePrefixRoomWalls() {
  const rectangle = (y: number) => {
    const x = -1000
    const width = 4
    const height = 0.2
    return [
      WallNode.parse({ start: [x, y], end: [x + width, y] }),
      WallNode.parse({ start: [x + width, y], end: [x + width, y + height] }),
      WallNode.parse({
        start: [x + width, y + height],
        end: [x, y + height],
      }),
      WallNode.parse({ start: [x, y + height], end: [x, y] }),
    ]
  }

  return [...rectangle(0.1), ...rectangle(0.9)]
}

function slab(elevation: number) {
  return SlabNode.parse({
    polygon: square,
    elevation,
    autoFromWalls: true,
  })
}

describe('planAutoCeilingsForLevel', () => {
  test('creates auto ceilings height-less so they follow the level top', () => {
    const created = planAutoCeilingsForLevel([roomPolygon()], [], {
      storeyHeight: 2.7,
    }).create[0]

    expect(created).toBeDefined()
    // Follows-mode: no stored height — the effective height derives from
    // the clamp bound at read time via resolveCeilingHeight.
    expect('height' in created!).toBe(false)
    expect(created?.autoFromWalls).toBe(true)
  })

  test('never writes a height onto a matched auto ceiling', () => {
    const ceiling = CeilingNode.parse({
      polygon: square,
      autoFromWalls: true,
    })

    const plan = planAutoCeilingsForLevel([roomPolygon()], [ceiling], {
      storeyHeight: 3,
    })

    // Same polygon, follows-mode height — nothing to update.
    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
  })

  test('creates and reconciles an auto ceiling at the enclosing wall top', () => {
    const context = {
      heightForRoom: () => 3.09,
    }
    const created = planAutoCeilingsForLevel([roomPolygon()], [], context).create[0]

    expect(created?.height).toBeCloseTo(3.09)

    const existing = CeilingNode.parse({
      polygon: square,
      height: 2.49,
      autoFromWalls: true,
    })
    const update = planAutoCeilingsForLevel([roomPolygon()], [existing], context).update[0]

    expect(update?.id).toBe(existing.id)
    expect(update?.data.height).toBeCloseTo(3.09)
  })

  test('a leftover explicit height on a matched auto ceiling is not rewritten', () => {
    const ceiling = CeilingNode.parse({
      polygon: square,
      height: 2.55,
      autoFromWalls: true,
    })

    const plan = planAutoCeilingsForLevel([roomPolygon()], [ceiling], {
      storeyHeight: 3,
    })

    // The sync no longer re-derives auto heights; a user-set explicit
    // height survives (still under the bound, so no clamp either).
    expect(plan.update).toHaveLength(0)
  })

  test('does not replace a manual ceiling with an auto ceiling', () => {
    const manualCeiling = CeilingNode.parse({
      polygon: square,
      height: 2.5,
      autoFromWalls: false,
    })

    // Storey plane above the stored 2.5 so the stage 3-B manual re-clamp
    // stays out of this test's scope (suppression only).
    const plan = planAutoCeilingsForLevel([roomPolygon()], [manualCeiling], {
      storeyHeight: 2.7,
    })

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
  })

  test('demotes an orphaned auto ceiling to manual with its polygon untouched', () => {
    const ceiling = CeilingNode.parse({
      polygon: square,
      height: 2.55,
      autoFromWalls: true,
    })

    const plan = planAutoCeilingsForLevel([], [ceiling])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]?.id).toBe(ceiling.id)
    // Ceilings render the stored polygon in both modes, so no polygon bake.
    expect(plan.update[0]?.data).toEqual({ autoFromWalls: false })
  })

  test('deletes an unmatched auto ceiling absorbed by a room merge', () => {
    const leftCeiling = CeilingNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      autoFromWalls: true,
    })
    const rightCeiling = CeilingNode.parse({
      polygon: [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
      autoFromWalls: true,
    })
    const mergedRoom = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 3 },
      { x: 0, y: 3 },
    ]

    const plan = planAutoCeilingsForLevel([mergedRoom], [leftCeiling, rightCeiling])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(1)
    const survivorId = plan.update[0]?.id
    expect([leftCeiling.id, rightCeiling.id]).toContain(plan.delete[0]!)
    expect(plan.delete[0]).not.toBe(survivorId)
  })

  test('a demoted ceiling suppresses re-creating an auto ceiling when the room re-forms', () => {
    const ceiling = CeilingNode.parse({
      polygon: square,
      height: 2.55,
      autoFromWalls: true,
    })

    const demotion = planAutoCeilingsForLevel([], [ceiling]).update[0]
    const demoted = CeilingNode.parse({ ...ceiling, ...demotion?.data })
    expect(demoted.autoFromWalls).toBe(false)

    // Storey plane above the stored 2.55 so the stage 3-B manual re-clamp
    // stays out of this test's scope (suppression only).
    const plan = planAutoCeilingsForLevel([roomPolygon()], [demoted], {
      storeyHeight: 2.7,
    })

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
  })
})

// Two stacked levels; the deck slab (occupying [-0.3, 0] over the upper
// level's plane) covers the queried level below, so the clamp bound is
// 2.5 - 0.3 - 0.01 = 2.19 (scenario gate 11's flush deck).
function stackedDeckNodes(): Record<AnyNodeId, AnyNode> {
  const deck = SlabNode.parse({
    id: 'slab_deck',
    parentId: 'level_1',
    polygon: square,
    elevation: 0,
    thickness: 0.3,
  })
  const list: AnyNode[] = [
    BuildingNode.parse({ id: 'building_a', children: ['level_0', 'level_1'] }),
    LevelNode.parse({ id: 'level_0', level: 0, height: 2.5, parentId: 'building_a' }),
    LevelNode.parse({
      id: 'level_1',
      level: 1,
      height: 2.5,
      parentId: 'building_a',
      children: ['slab_deck'],
    }),
    deck,
  ]
  return Object.fromEntries(list.map((node) => [node.id, node])) as Record<AnyNodeId, AnyNode>
}

describe('stage 3-B ceiling clamp bound', () => {
  test('height-less auto ceilings resolve under the covering-slab bound at read time', () => {
    const nodes = stackedDeckNodes()
    const created = planAutoCeilingsForLevel([roomPolygon()], [], {
      storeyHeight: 2.5,
      ceilingClampBound: (polygon) => getCeilingClampBound('level_0', nodes, polygon),
    }).create[0]

    expect(created).toBeDefined()
    expect('height' in created!).toBe(false)
    // Follows-mode: the effective height is the deck-limited bound.
    expect(resolveCeilingHeight({ ...created!, parentId: 'level_0' }, nodes)).toBeCloseTo(2.19)
  })

  test('clamps a manual ceiling above the bound down to it (plane-only degradation)', () => {
    const manual = CeilingNode.parse({ polygon: square, height: 2.6, autoFromWalls: false })

    const plan = planAutoCeilingsForLevel([roomPolygon()], [manual], { storeyHeight: 2.5 })

    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]?.id).toBe(manual.id)
    expect(plan.update[0]?.data.polygon).toBeUndefined()
    expect(plan.update[0]?.data.height).toBeCloseTo(2.49)
  })

  test('never raises a manual ceiling sitting below the bound', () => {
    const manual = CeilingNode.parse({ polygon: square, height: 2.0, autoFromWalls: false })

    const plan = planAutoCeilingsForLevel([roomPolygon()], [manual], { storeyHeight: 2.5 })

    expect(plan.update).toHaveLength(0)
  })

  test('skips follows-mode manual ceilings (never converts them to explicit)', () => {
    const nodes = stackedDeckNodes()
    const manual = CeilingNode.parse({ polygon: square, autoFromWalls: false })

    const plan = planAutoCeilingsForLevel([roomPolygon()], [manual], {
      storeyHeight: 2.5,
      ceilingClampBound: (polygon) => getCeilingClampBound('level_0', nodes, polygon),
    })

    expect(plan.update).toHaveLength(0)
  })

  test('a flush deck above clamps a manual ceiling at the plane margin to its underside', () => {
    // Scenario gate 11: manual ceiling at storeyHeight - 0.01 (the no-deck
    // bound) → deck occupying [-0.3, 0] above → clamps to 2.5 - 0.3 - 0.01.
    const nodes = stackedDeckNodes()
    const manual = CeilingNode.parse({ polygon: square, height: 2.49, autoFromWalls: false })

    const plan = planAutoCeilingsForLevel([roomPolygon()], [manual], {
      storeyHeight: 2.5,
      ceilingClampBound: (polygon) => getCeilingClampBound('level_0', nodes, polygon),
    })

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]?.id).toBe(manual.id)
    expect(plan.update[0]?.data.height).toBeCloseTo(2.19)
  })
})

// Minimal store stand-ins for initSpaceDetectionSync: a zustand-shaped
// scene store (getState/subscribe/temporal) whose write methods mutate the
// nodes record and re-notify, and an editor store carrying `spaces`.
function createSceneStoreStub(initialNodes: Record<string, AnyNode>) {
  const listeners = new Set<(state: unknown) => void>()
  const state: Record<string, unknown> & { nodes: Record<string, AnyNode> } = {
    nodes: initialNodes,
  }
  const notify = () => {
    for (const listener of [...listeners]) listener(state)
  }
  state.updateNodes = (updates: Array<{ id: string; data: Record<string, unknown> }>) => {
    const next: Record<string, AnyNode> = { ...state.nodes }
    for (const { id, data } of updates) {
      const existing = next[id]
      if (existing) next[id] = { ...existing, ...data } as AnyNode
    }
    state.nodes = next
    notify()
  }
  state.deleteNodes = (ids: string[]) => {
    const next: Record<string, AnyNode> = { ...state.nodes }
    for (const id of ids) delete next[id]
    state.nodes = next
    notify()
  }
  state.createNodes = (entries: Array<{ node: AnyNode; parentId: string }>) => {
    const next: Record<string, AnyNode> = { ...state.nodes }
    for (const { node, parentId } of entries) {
      next[node.id] = { ...node, parentId } as AnyNode
      const parent = next[parentId] as (AnyNode & { children?: string[] }) | undefined
      if (parent) {
        next[parentId] = { ...parent, children: [...(parent.children ?? []), node.id] } as AnyNode
      }
    }
    state.nodes = next
    notify()
  }
  return {
    getState: () => state,
    subscribe: (listener: (state: unknown) => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    temporal: { getState: () => ({ pause() {}, resume() {} }) },
    setNodes(next: Record<string, AnyNode>) {
      state.nodes = next
      notify()
    },
  }
}

function createEditorStoreStub() {
  const state = {
    spaces: {} as Record<string, unknown>,
    setSpaces(next: Record<string, unknown>) {
      state.spaces = next
    },
  }
  return { getState: () => state }
}

function closedRoomFixture(prefix: string) {
  const building = BuildingNode.parse({ id: `building_${prefix}` })
  const levelId = `level_${prefix}`
  const walls = squareWalls().map((wall, index) =>
    WallNode.parse({ ...wall, id: `wall_${prefix}_${index}`, parentId: levelId }),
  )
  const autoSlab = SlabNode.parse({
    id: `slab_${prefix}`,
    parentId: levelId,
    polygon: square,
    autoFromWalls: true,
  })
  const autoCeiling = CeilingNode.parse({
    id: `ceiling_${prefix}`,
    parentId: levelId,
    polygon: square,
    autoFromWalls: true,
  })
  const level = LevelNode.parse({
    id: levelId,
    level: 0,
    height: 2.5,
    parentId: building.id,
    children: [...walls, autoSlab, autoCeiling].map((node) => node.id),
  })
  const nodes = Object.fromEntries(
    [building, level, ...walls, autoSlab, autoCeiling].map((node) => [node.id, node]),
  ) as Record<string, AnyNode>
  return { building, level, walls, autoSlab, autoCeiling, nodes }
}

function edgeSupportSlabs(prefix: string, levelId: string, elevation: number) {
  const polygons: Array<Array<[number, number]>> = [
    [
      [-0.3, -0.3],
      [4.3, -0.3],
      [4.3, 0.3],
      [-0.3, 0.3],
    ],
    [
      [3.7, -0.3],
      [4.3, -0.3],
      [4.3, 3.3],
      [3.7, 3.3],
    ],
    [
      [-0.3, 2.7],
      [4.3, 2.7],
      [4.3, 3.3],
      [-0.3, 3.3],
    ],
    [
      [-0.3, -0.3],
      [0.3, -0.3],
      [0.3, 3.3],
      [-0.3, 3.3],
    ],
  ]
  return polygons.map((polygon, index) =>
    SlabNode.parse({
      id: `slab_${prefix}_${index}`,
      parentId: levelId,
      polygon,
      elevation,
      autoFromWalls: false,
    }),
  )
}

describe('reactive ceiling re-clamp through the detection sync', () => {
  test('a flush deck created on the level above clamps the existing manual ceiling below', () => {
    const walls = [
      WallNode.parse({ start: [0, 0], end: [4, 0], parentId: 'level_0' }),
      WallNode.parse({ start: [4, 0], end: [4, 3], parentId: 'level_0' }),
      WallNode.parse({ start: [4, 3], end: [0, 3], parentId: 'level_0' }),
      WallNode.parse({ start: [0, 3], end: [0, 0], parentId: 'level_0' }),
    ]
    const manualCeiling = CeilingNode.parse({
      id: 'ceiling_main',
      parentId: 'level_0',
      polygon: square,
      height: 2.49,
      autoFromWalls: false,
    })
    const initialNodes = Object.fromEntries(
      [
        BuildingNode.parse({ id: 'building_a', children: ['level_0', 'level_1'] }),
        LevelNode.parse({
          id: 'level_0',
          level: 0,
          height: 2.5,
          parentId: 'building_a',
          children: [...walls.map((wall) => wall.id), 'ceiling_main'],
        }),
        LevelNode.parse({ id: 'level_1', level: 1, height: 2.5, parentId: 'building_a' }),
        ...walls,
        manualCeiling,
      ].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const sceneStore = createSceneStoreStub(initialNodes)
    const editorStore = createEditorStoreStub()
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore)

    try {
      // Scenario gate 11's reactive half: the deck lands on the level
      // ABOVE, so only the covering-underside part of level_0's structure
      // snapshot changes — the sync must still re-run and clamp down.
      const deck = SlabNode.parse({
        id: 'slab_deck',
        parentId: 'level_1',
        polygon: square,
        elevation: 0,
        thickness: 0.3,
      })
      const current = sceneStore.getState().nodes
      const levelAbove = current.level_1 as AnyNode
      sceneStore.setNodes({
        ...current,
        slab_deck: deck,
        level_1: { ...levelAbove, children: ['slab_deck'] } as AnyNode,
      })

      const ceiling = sceneStore.getState().nodes.ceiling_main as CeilingNode
      expect(ceiling.height).toBeCloseTo(2.5 - 0.3 - 0.01)
    } finally {
      unsubscribe()
    }
  })
})

describe('auto slab trigger ownership', () => {
  test('an auto slab elevation persists until a later wall reconcile', () => {
    const fixture = closedRoomFixture('auto_elevation')
    const sceneStore = createSceneStoreStub(fixture.nodes)
    const editorStore = createEditorStoreStub()
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore)

    try {
      sceneStore.setNodes({
        ...sceneStore.getState().nodes,
        [fixture.autoSlab.id]: { ...fixture.autoSlab, elevation: 0.4 },
      })
      expect((sceneStore.getState().nodes[fixture.autoSlab.id] as SlabNode).elevation).toBeCloseTo(
        0.4,
      )

      const current = sceneStore.getState().nodes
      sceneStore.setNodes({
        ...current,
        [fixture.walls[0]!.id]: { ...fixture.walls[0], end: [4.2, 0] },
        [fixture.walls[1]!.id]: { ...fixture.walls[1], start: [4.2, 0] },
      })

      const reconciled = sceneStore.getState().nodes[fixture.autoSlab.id] as SlabNode
      // The edit itself is preserved; a later wall-topology pass is allowed
      // to re-derive the automatic plane from its current supports.
      expect(reconciled.elevation).toBeCloseTo(0.05)
      expect(reconciled.polygon).not.toEqual(fixture.autoSlab.polygon)
    } finally {
      unsubscribe()
    }
  })

  test('manual support create, elevation, and delete still replan the auto slab', () => {
    const fixture = closedRoomFixture('manual_support')
    const sceneStore = createSceneStoreStub(fixture.nodes)
    const editorStore = createEditorStoreStub()
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore)
    const supports = edgeSupportSlabs('manual_support', fixture.level.id, 0.4)

    try {
      const level = sceneStore.getState().nodes[fixture.level.id] as LevelNode
      sceneStore.setNodes({
        ...sceneStore.getState().nodes,
        ...Object.fromEntries(supports.map((slab) => [slab.id, slab])),
        [fixture.level.id]: {
          ...level,
          children: [...level.children, ...supports.map((slab) => slab.id)],
        },
      })
      expect((sceneStore.getState().nodes[fixture.autoSlab.id] as SlabNode).elevation).toBeCloseTo(
        0.45,
      )

      const raisedSupports = supports.map((slab) => ({ ...slab, elevation: 0.6 }))
      sceneStore.setNodes({
        ...sceneStore.getState().nodes,
        ...Object.fromEntries(raisedSupports.map((slab) => [slab.id, slab])),
      })
      expect((sceneStore.getState().nodes[fixture.autoSlab.id] as SlabNode).elevation).toBeCloseTo(
        0.65,
      )

      const withoutSupports = { ...sceneStore.getState().nodes }
      for (const slab of supports) delete withoutSupports[slab.id]
      sceneStore.setNodes(withoutSupports)
      expect((sceneStore.getState().nodes[fixture.autoSlab.id] as SlabNode).elevation).toBeCloseTo(
        0.05,
      )
    } finally {
      unsubscribe()
    }
  })
})

test('an above-level auto slab reclamps below without resurrecting its owner', () => {
  const fixture = closedRoomFixture('above_auto')
  const upperLevel = LevelNode.parse({
    id: 'level_above_auto_upper',
    level: 1,
    height: 2.5,
    parentId: fixture.building.id,
  })
  const building = BuildingNode.parse({
    ...fixture.building,
    children: [fixture.level.id, upperLevel.id],
  })
  const manualCeiling = CeilingNode.parse({
    id: 'ceiling_above_auto_manual',
    parentId: fixture.level.id,
    polygon: [
      [0.1, 0.1],
      [3.9, 0.1],
      [3.9, 2.9],
      [0.1, 2.9],
    ],
    height: 2.49,
    autoFromWalls: false,
  })
  const lowerLevel = LevelNode.parse({
    ...fixture.level,
    children: fixture.level.children
      .filter((childId) => childId !== fixture.autoCeiling.id)
      .concat(manualCeiling.id),
  })
  const initialNodes = { ...fixture.nodes }
  delete initialNodes[fixture.autoCeiling.id]
  const sceneStore = createSceneStoreStub({
    ...initialNodes,
    [building.id]: building,
    [lowerLevel.id]: lowerLevel,
    [upperLevel.id]: upperLevel,
    [manualCeiling.id]: manualCeiling,
  })
  const editorStore = createEditorStoreStub()
  const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore)

  try {
    const upperSlab = SlabNode.parse({
      id: 'slab_above_auto_deck',
      parentId: upperLevel.id,
      polygon: square,
      elevation: 0,
      thickness: 0.3,
      autoFromWalls: true,
    })
    sceneStore.setNodes({
      ...sceneStore.getState().nodes,
      [upperSlab.id]: upperSlab,
      [upperLevel.id]: { ...upperLevel, children: [upperSlab.id] },
    })

    expect(getCeilingClampBound(fixture.level.id, sceneStore.getState().nodes, square)).toBeCloseTo(
      2.19,
    )
    expect((sceneStore.getState().nodes[manualCeiling.id] as CeilingNode).height).toBeCloseTo(2.19)

    sceneStore.setNodes({
      ...sceneStore.getState().nodes,
      [upperSlab.id]: { ...upperSlab, thickness: 0.4 },
    })
    expect((sceneStore.getState().nodes[manualCeiling.id] as CeilingNode).height).toBeCloseTo(2.09)

    sceneStore.setNodes({
      ...sceneStore.getState().nodes,
      [upperSlab.id]: { ...upperSlab, thickness: 0.4, recessed: true },
    })
    expect(getCeilingClampBound(fixture.level.id, sceneStore.getState().nodes, square)).toBeCloseTo(
      2.49,
    )

    const withoutUpperAuto = { ...sceneStore.getState().nodes }
    delete withoutUpperAuto[upperSlab.id]
    sceneStore.setNodes({
      ...withoutUpperAuto,
      [upperLevel.id]: { ...upperLevel, children: [] },
    })
    expect(
      Object.values(sceneStore.getState().nodes).filter(
        (node) => node.type === 'slab' && node.parentId === upperLevel.id,
      ),
    ).toHaveLength(0)
    expect(
      Object.values(sceneStore.getState().nodes).filter(
        (node) => node.type === 'slab' && node.parentId === fixture.level.id,
      ),
    ).toHaveLength(1)
  } finally {
    unsubscribe()
  }
})

describe('raised auto-room surfaces', () => {
  test('inherits the enclosing walls construction plane when the room closes', () => {
    const wallData = [
      { id: 'wall_bottom', start: [0, 0], end: [4, 0] },
      { id: 'wall_right', start: [4, 0], end: [4, 3] },
      { id: 'wall_top', start: [4, 3], end: [0, 3] },
      { id: 'wall_left', start: [0, 3], end: [0, 0] },
    ] as const
    const walls = wallData.map((wall) =>
      WallNode.parse({
        ...wall,
        parentId: 'level_0',
        height: 2.5,
        supportOffset: 0.6,
      }),
    )
    const initialWalls = walls.slice(0, 3)
    const initialNodes = Object.fromEntries(
      [
        BuildingNode.parse({ id: 'building_a', children: ['level_0'] }),
        LevelNode.parse({
          id: 'level_0',
          level: 0,
          height: 2.5,
          parentId: 'building_a',
          children: initialWalls.map((wall) => wall.id),
        }),
        ...initialWalls,
      ].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>

    const sceneStore = createSceneStoreStub(initialNodes)
    const editorStore = createEditorStoreStub()
    const unsubscribe = initSpaceDetectionSync(sceneStore, editorStore)

    try {
      const current = sceneStore.getState().nodes
      const level = current.level_0 as LevelNode
      const closingWall = walls[3]!
      sceneStore.setNodes({
        ...current,
        [closingWall.id]: closingWall,
        level_0: {
          ...level,
          children: [...level.children, closingWall.id],
        } as LevelNode,
      })

      const generated = Object.values(sceneStore.getState().nodes)
      const autoSlab = generated.find(
        (node): node is SlabNode => node.type === 'slab' && node.autoFromWalls,
      )
      const autoCeiling = generated.find(
        (node): node is CeilingNode => node.type === 'ceiling' && node.autoFromWalls,
      )

      expect(autoSlab?.elevation).toBeCloseTo(0.65)
      expect(autoSlab?.thickness).toBeCloseTo(0.05)
      expect(autoCeiling?.height).toBeCloseTo(3.09)

      const raisedAgain = { ...sceneStore.getState().nodes }
      for (const wall of walls) {
        raisedAgain[wall.id] = { ...raisedAgain[wall.id], supportOffset: 0.8 } as AnyNode
      }
      sceneStore.setNodes(raisedAgain)

      const reconciled = Object.values(sceneStore.getState().nodes)
      const reconciledSlab = reconciled.find(
        (node): node is SlabNode => node.type === 'slab' && node.autoFromWalls,
      )
      const reconciledCeiling = reconciled.find(
        (node): node is CeilingNode => node.type === 'ceiling' && node.autoFromWalls,
      )
      expect(reconciledSlab?.elevation).toBeCloseTo(0.85)
      expect(reconciledCeiling?.height).toBeCloseTo(3.29)
    } finally {
      unsubscribe()
    }
  })
})

describe('detectSpacesForLevel', () => {
  const areaOf = (polygon: Array<{ x: number; y: number }>) => {
    let area = 0
    for (let i = 0; i < polygon.length; i += 1) {
      const a = polygon[i]!
      const b = polygon[(i + 1) % polygon.length]!
      area += a.x * b.y - b.x * a.y
    }
    return Math.abs(area / 2)
  }

  test('detects an isolated four-wall room', () => {
    const walls = squareWalls()
    const { roomPolygons, spaces } = detectSpacesForLevel('level-1', walls)
    expect(roomPolygons).toHaveLength(1)
    expect(new Set(spaces[0]?.wallIds)).toEqual(new Set(walls.map((wall) => wall.id)))
    expect(spaces[0]?.boundaryFaces).toHaveLength(4)
    expect(
      spaces[0]?.boundaryFaces.map((boundary) => `${boundary.wallId}:${boundary.face}`).sort(),
    ).toEqual(walls.map((wall) => `${wall.id}:front`).sort())
  })

  test('excludes dangling wall branches from a room boundary', () => {
    const roomWalls = squareWalls()
    const branch = WallNode.parse({ start: [0, 0], end: [1, 1] })

    const { roomPolygons, spaces } = detectSpacesForLevel('level-1', [...roomWalls, branch])

    expect(roomPolygons).toHaveLength(1)
    expect(roomPolygons[0]).toHaveLength(4)
    expect(areaOf(roomPolygons[0]!)).toBeCloseTo(12)
    expect(spaces[0]?.wallIds.sort()).toEqual(roomWalls.map((wall) => wall.id).sort())
    expect(spaces[0]?.boundaryFaces).toHaveLength(4)
  })

  test('detects a room closed against the middle of an existing wall (T-junction)', () => {
    // Big 6×5 room; a smaller room hangs below, its two verticals landing on the
    // interior of the big room's bottom wall (x=1 and x=3, not endpoints). Before
    // planarization those touch points were dangling nodes and the small room
    // was never detected.
    const walls = [
      WallNode.parse({ start: [0, 0], end: [6, 0] }),
      WallNode.parse({ start: [6, 0], end: [6, 5] }),
      WallNode.parse({ start: [6, 5], end: [0, 5] }),
      WallNode.parse({ start: [0, 5], end: [0, 0] }),
      WallNode.parse({ start: [1, 0], end: [1, -2] }),
      WallNode.parse({ start: [1, -2], end: [3, -2] }),
      WallNode.parse({ start: [3, -2], end: [3, 0] }),
    ]

    const { roomPolygons, spaces } = detectSpacesForLevel('level-1', walls)
    const areas = roomPolygons.map((poly) => areaOf(poly)).sort((a, b) => a - b)
    const smallRoom = spaces.find((space) => areaOf(space.polygon.map(([x, y]) => ({ x, y }))) < 5)

    expect(roomPolygons).toHaveLength(2)
    expect(areas[0]).toBeCloseTo(4, 1) // small room: 2×2
    expect(areas[1]).toBeCloseTo(30, 1) // big room: 6×5
    expect(new Set(smallRoom?.wallIds)).toEqual(
      new Set([walls[0]!.id, walls[4]!.id, walls[5]!.id, walls[6]!.id]),
    )

    const longWallId = walls[0]!.id
    const longWallBoundaries = spaces.flatMap((space) =>
      space.boundaryFaces.filter((boundary) => boundary.wallId === longWallId),
    )
    expect(longWallBoundaries).toHaveLength(4)
    expect(longWallBoundaries.filter((boundary) => boundary.face === 'back')).toHaveLength(1)
    expect(longWallBoundaries.filter((boundary) => boundary.face === 'front')).toHaveLength(3)
    expect(longWallBoundaries.map((boundary) => boundary.points)).toContainEqual([
      [1, 0],
      [3, 0],
    ])
  })

  test('keeps distinct detected loops when canonical signatures share a prefix', () => {
    const { spaces } = detectSpacesForLevel('level-canonical-space-ids', samePrefixRoomWalls())
    const ids = spaces.map((space) => space.id)

    expect(spaces).toHaveLength(2)
    expect(new Set(ids).size).toBe(2)
    expect(ids.some((id) => id.includes('-1000.000,0.100|'))).toBe(true)
    expect(ids.some((id) => id.includes('-1000.000,0.900|'))).toBe(true)
  })
})

describe('residual topology refinement', () => {
  for (const [name, fixture] of Object.entries(residualTopologyFixtures)) {
    test(`${name} keeps reduced detected faces simple`, () => {
      const walls = residualTopologyWalls(fixture)
      const before = walls.map((wall) => ({
        id: wall.id,
        start: [...wall.start],
        end: [...wall.end],
      }))
      const { spaces } = detectSpacesForLevel(`level-${name}`, walls)
      const slabs = planAutoSlabsForLevel(
        spaces.map((space) => space.polygon.map(([x, y]) => ({ x, y }))),
        [],
      ).create

      expect(spaces).toHaveLength(residualExpectedSpaceCounts[name]!)
      expect(new Set(spaces.map((space) => space.id)).size).toBe(spaces.length)
      expect(spaces.every((space) => space.polygon.length >= 3)).toBe(true)
      const wallIds = new Set(walls.map((wall) => wall.id))
      expect(
        spaces.every((space) => space.boundaryFaces.every((face) => wallIds.has(face.wallId))),
      ).toBe(true)
      expect(
        spaces.reduce((count, space) => count + polygonBoundaryIssueCount(space.polygon), 0),
      ).toBe(0)
      expect(
        slabs.reduce((count, slabNode) => count + polygonBoundaryIssueCount(slabNode.polygon), 0),
      ).toBe(0)
      expect(
        walls.map((wall) => ({ id: wall.id, start: [...wall.start], end: [...wall.end] })),
      ).toEqual(before)
    })
  }

  test('splits a true interior X crossing into four simple faces', () => {
    const walls = [
      WallNode.parse({ id: 'wall_x_bottom', start: [0, 0], end: [4, 0] }),
      WallNode.parse({ id: 'wall_x_right', start: [4, 0], end: [4, 4] }),
      WallNode.parse({ id: 'wall_x_top', start: [4, 4], end: [0, 4] }),
      WallNode.parse({ id: 'wall_x_left', start: [0, 4], end: [0, 0] }),
      WallNode.parse({ id: 'wall_x_diagonal_a', start: [0, 0], end: [4, 4] }),
      WallNode.parse({ id: 'wall_x_diagonal_b', start: [0, 4], end: [4, 0] }),
    ]
    const before = walls.map((wall) => ({
      id: wall.id,
      start: [...wall.start],
      end: [...wall.end],
    }))
    const { spaces } = detectSpacesForLevel('level-x-crossing', walls)

    expect(spaces).toHaveLength(4)
    expect(spaces.every((space) => space.polygon.length === 3)).toBe(true)
    expect(spaces.every((space) => space.boundaryFaces.length === 3)).toBe(true)
    expect(
      walls.map((wall) => ({ id: wall.id, start: [...wall.start], end: [...wall.end] })),
    ).toEqual(before)
  })

  test('leaves a collinear door passage gap open', () => {
    const walls = [
      WallNode.parse({
        id: 'wall_gap_bottom_a',
        start: [0, 0],
        end: [1.8, 0],
        children: ['door_gap'],
      }),
      WallNode.parse({ id: 'wall_gap_bottom_b', start: [2, 0], end: [4, 0] }),
      WallNode.parse({ id: 'wall_gap_right', start: [4, 0], end: [4, 3] }),
      WallNode.parse({ id: 'wall_gap_top', start: [4, 3], end: [0, 3] }),
      WallNode.parse({ id: 'wall_gap_left', start: [0, 3], end: [0, 0] }),
    ]
    const before = walls.map((wall) => ({
      id: wall.id,
      start: [...wall.start],
      end: [...wall.end],
    }))
    const { spaces } = detectSpacesForLevel('level-collinear-gap', walls)

    expect(spaces).toHaveLength(0)
    expect(
      walls.map((wall) => ({ id: wall.id, start: [...wall.start], end: [...wall.end] })),
    ).toEqual(before)
  })

  test('keeps exact T contacts even when both incident walls host doors', () => {
    const walls = [
      WallNode.parse({
        id: 'wall_exact_door_bottom',
        start: [0, 0],
        end: [6, 0],
        children: ['door_host'],
      }),
      WallNode.parse({ id: 'wall_exact_door_right', start: [6, 0], end: [6, 5] }),
      WallNode.parse({ id: 'wall_exact_door_top', start: [6, 5], end: [0, 5] }),
      WallNode.parse({ id: 'wall_exact_door_left', start: [0, 5], end: [0, 0] }),
      WallNode.parse({
        id: 'wall_exact_door_bay_left',
        start: [1, 0],
        end: [1, -2],
        children: ['door_incident'],
      }),
      WallNode.parse({ id: 'wall_exact_door_bay_bottom', start: [1, -2], end: [3, -2] }),
      WallNode.parse({ id: 'wall_exact_door_bay_right', start: [3, -2], end: [3, 0] }),
    ]
    const { spaces } = detectSpacesForLevel('level-exact-door-t', walls)

    expect(spaces).toHaveLength(2)
    expect(
      spaces
        .flatMap((space) => space.boundaryFaces)
        .some(
          (face) =>
            face.wallId === 'wall_exact_door_bottom' &&
            face.points.some(([x, y]) => x === 1 && y === 0),
        ),
    ).toBe(true)
  })

  test('keeps every incident of the reduced p22 shared vertex on one graph point', () => {
    const shared: [number, number] = [-5.025518652902327, -1.6854124352682183]
    const walls = [
      WallNode.parse({
        id: 'wall_p22_shared_horizontal',
        start: shared,
        end: [-1.4252186529023256, -1.6854124352682183],
        children: ['door_shared'],
      }),
      WallNode.parse({
        id: 'wall_p22_shared_vertical',
        start: shared,
        end: [-5.025518652902327, -5.314105621751716],
        children: ['window_shared'],
      }),
      WallNode.parse({
        id: 'wall_p22_shared_bottom',
        start: [-5.025518652902327, -5.314105621751716],
        end: [-1.4252186529023256, -5.326038463488074],
      }),
      WallNode.parse({
        id: 'wall_p22_shared_right',
        start: [-1.4252186529023256, -5.326038463488074],
        end: [-1.4252186529023256, -1.6854124352682183],
      }),
      WallNode.parse({
        id: 'wall_p22_shared_near_host',
        start: [-4.943818652902326, -1.6854124352682183],
        end: [-5.220369686634644, -1.8480614015358998],
      }),
    ]
    const { spaces } = detectSpacesForLevel('level-p22-shared-vertex', walls)

    expect(spaces).toHaveLength(1)
    expect(spaces[0]?.polygon).not.toContainEqual([-5.004521475119624, -1.7211138070907186])
    expect(walls[0]?.start).toEqual(shared)
    expect(walls[1]?.start).toEqual(shared)
  })

  test('fails approximate projection when a shared endpoint has a curved incident', () => {
    const walls = [
      WallNode.parse({ id: 'wall_curve_shared_bottom', start: [0, 0], end: [4, 0] }),
      WallNode.parse({
        id: 'wall_curve_shared_left',
        start: [0, 0],
        end: [0, -4],
        curveOffset: 0.2,
      }),
      WallNode.parse({ id: 'wall_curve_shared_far', start: [0, -4], end: [4, -4] }),
      WallNode.parse({ id: 'wall_curve_shared_right', start: [4, -4], end: [4, 0] }),
      WallNode.parse({ id: 'wall_curve_shared_near_host', start: [0.08, 0], end: [-0.2, -0.16] }),
    ]
    const { spaces } = detectSpacesForLevel('level-curve-shared-vertex', walls)

    expect(spaces).toHaveLength(1)
    expect(spaces[0]?.boundaryFaces.some((face) => face.wallId === 'wall_curve_shared_left')).toBe(
      true,
    )
  })

  test('splits a straight host at an exact endpoint from a curved bay', () => {
    const walls = [
      WallNode.parse({ id: 'wall_curved_t_bottom', start: [0, 0], end: [6, 0] }),
      WallNode.parse({ id: 'wall_curved_t_right', start: [6, 0], end: [6, 5] }),
      WallNode.parse({ id: 'wall_curved_t_top', start: [6, 5], end: [0, 5] }),
      WallNode.parse({ id: 'wall_curved_t_left', start: [0, 5], end: [0, 0] }),
      WallNode.parse({
        id: 'wall_curved_t_bay_left',
        start: [1, 0],
        end: [1, -2],
        curveOffset: 0.2,
      }),
      WallNode.parse({ id: 'wall_curved_t_bay_bottom', start: [1, -2], end: [3, -2] }),
      WallNode.parse({ id: 'wall_curved_t_bay_right', start: [3, -2], end: [3, 0] }),
    ]
    const before = walls.map((wall) => ({
      id: wall.id,
      start: [...wall.start],
      end: [...wall.end],
    }))
    const { spaces } = detectSpacesForLevel('level-curved-exact-t', walls)

    expect(spaces).toHaveLength(2)
    expect(
      spaces
        .flatMap((space) => space.boundaryFaces)
        .some(
          (face) =>
            face.wallId === 'wall_curved_t_bottom' &&
            face.points.some(([x, y]) => x === 1 && y === 0),
        ),
    ).toBe(true)
    expect(
      walls.map((wall) => ({ id: wall.id, start: [...wall.start], end: [...wall.end] })),
    ).toEqual(before)
  })

  test('keeps a close parallel wall separate from the enclosing room', () => {
    const walls = [
      WallNode.parse({ id: 'wall_parallel_bottom', start: [0, 0], end: [4, 0] }),
      WallNode.parse({ id: 'wall_parallel_right', start: [4, 0], end: [4, 3] }),
      WallNode.parse({ id: 'wall_parallel_top', start: [4, 3], end: [0, 3] }),
      WallNode.parse({ id: 'wall_parallel_left', start: [0, 3], end: [0, 0] }),
      WallNode.parse({ id: 'wall_parallel_near', start: [0.5, 0.05], end: [3.5, 0.05] }),
    ]
    const before = walls.map((wall) => ({
      id: wall.id,
      start: [...wall.start],
      end: [...wall.end],
    }))
    const { spaces } = detectSpacesForLevel('level-parallel-gap', walls)

    expect(spaces).toHaveLength(1)
    expect(spaces[0]?.wallIds).not.toContain('wall_parallel_near')
    expect(
      walls.map((wall) => ({ id: wall.id, start: [...wall.start], end: [...wall.end] })),
    ).toEqual(before)
  })

  test('closes a compact three-wall endpoint corner without mutating authored walls', () => {
    const walls = [
      WallNode.parse({
        id: 'wall_p07_top',
        start: [-0.6216924548734495, 2.904138363417701],
        end: [0.7031075451265515, 2.904138363417701],
        thickness: 0.2347,
      }),
      WallNode.parse({
        id: 'wall_p07_left',
        start: [-0.6216924548734496, 2.904138363417701],
        end: [-0.6216924548734496, 0.5557383634177002],
        thickness: 0.2347,
      }),
      WallNode.parse({
        id: 'wall_p07_bottom',
        start: [-0.60729245487345, 0.5557383634177003],
        end: [0.7031075451265515, 0.5557383634177003],
        thickness: 0.2347,
        children: ['door_p07'],
      }),
      WallNode.parse({
        id: 'wall_p07_right',
        start: [0.7031075451265515, 0.5557383634177002],
        end: [0.7031075451265515, 2.904138363417701],
        thickness: 0.2347,
      }),
      WallNode.parse({
        id: 'wall_p07_diagonal',
        start: [-0.6216924548734496, 0.545578679623234],
        end: [-0.7280976681316088, 0.4705062267908951],
        thickness: 0.1588,
      }),
    ]
    const before = walls.map((wall) => ({
      id: wall.id,
      start: [...wall.start],
      end: [...wall.end],
    }))
    const { spaces } = detectSpacesForLevel('level-p07-corner', walls)

    expect(spaces).toHaveLength(1)
    expect(spaces[0]?.wallIds).toEqual(
      expect.arrayContaining([
        'wall_p07_top',
        'wall_p07_left',
        'wall_p07_bottom',
        'wall_p07_right',
      ]),
    )
    expect(
      walls.map((wall) => ({ id: wall.id, start: [...wall.start], end: [...wall.end] })),
    ).toEqual(before)

    const sourceLines = [
      { axis: 'x' as const, value: 0.7031075451265515 },
      { axis: 'x' as const, value: -0.6216924548734496 },
      { axis: 'y' as const, value: 2.904138363417701 },
      { axis: 'y' as const, value: 0.5557383634177002 },
    ]
    expect(
      spaces[0]?.polygon.every(([x, y]) =>
        sourceLines.some(({ axis, value }) => Math.abs((axis === 'x' ? x : y) - value) <= 1e-7),
      ),
    ).toBe(true)
  })

  test('leaves an incomplete endpoint corner component open', () => {
    const walls = [
      WallNode.parse({
        id: 'wall_incomplete_corner_top',
        start: [0, 3],
        end: [4, 3],
      }),
      WallNode.parse({
        id: 'wall_incomplete_corner_left',
        start: [0, 3],
        end: [-0.014, 0],
      }),
      WallNode.parse({
        id: 'wall_incomplete_corner_bottom',
        start: [0.014, 0],
        end: [4, 0],
      }),
      WallNode.parse({
        id: 'wall_incomplete_corner_right',
        start: [4, 0],
        end: [4, 3],
      }),
      // This third endpoint is near the same physical corner and is parallel
      // to the left wall. The left/bottom and bottom/competitor pairs agree,
      // but the left/competitor pair has no line intersection. Completeness
      // must therefore reject the whole component instead of projecting only
      // two of its incident walls.
      WallNode.parse({
        id: 'wall_incomplete_corner_competitor',
        start: [0.014, -0.01],
        end: [0.014, -1],
      }),
    ]
    const before = walls.map((wall) => ({
      id: wall.id,
      start: [...wall.start],
      end: [...wall.end],
    }))

    const withoutCompetitor = walls.filter(
      (wall) => wall.id !== 'wall_incomplete_corner_competitor',
    )
    expect(
      detectSpacesForLevel('level-incomplete-corner-closable', withoutCompetitor).spaces,
    ).toHaveLength(1)
    expect(detectSpacesForLevel('level-incomplete-corner', walls).spaces).toHaveLength(0)
    expect(
      walls.map((wall) => ({ id: wall.id, start: [...wall.start], end: [...wall.end] })),
    ).toEqual(before)
  })

  test('uses construction-envelope thickness for endpoint components', () => {
    const faceBands = { ...createDefaultWallFaceBands(0.2347), enabled: true }
    const walls = [
      WallNode.parse({
        id: 'wall_face_band_top',
        start: [-0.6216924548734495, 2.904138363417701],
        end: [0.7031075451265515, 2.904138363417701],
        thickness: 0.01,
        faceBands,
      }),
      WallNode.parse({
        id: 'wall_face_band_left',
        start: [-0.6216924548734496, 2.904138363417701],
        end: [-0.6216924548734496, 0.5557383634177002],
        thickness: 0.01,
        faceBands,
      }),
      WallNode.parse({
        id: 'wall_face_band_bottom',
        start: [-0.60729245487345, 0.5557383634177003],
        end: [0.7031075451265515, 0.5557383634177003],
        thickness: 0.01,
        faceBands,
      }),
      WallNode.parse({
        id: 'wall_face_band_right',
        start: [0.7031075451265515, 0.5557383634177002],
        end: [0.7031075451265515, 2.904138363417701],
        thickness: 0.01,
        faceBands,
      }),
      WallNode.parse({
        id: 'wall_face_band_diagonal',
        start: [-0.6216924548734496, 0.545578679623234],
        end: [-0.7280976681316088, 0.4705062267908951],
        thickness: 0.01,
        faceBands: { ...createDefaultWallFaceBands(0.1588), enabled: true },
      }),
    ]

    const wallsWithoutFaceBands = walls.map((wall) => {
      const { faceBands: _faceBands, ...withoutFaceBands } = wall
      return WallNode.parse(withoutFaceBands)
    })
    expect(
      detectSpacesForLevel('level-face-band-corner-without-envelope', wallsWithoutFaceBands).spaces,
    ).toHaveLength(0)
    expect(detectSpacesForLevel('level-face-band-corner', walls).spaces).toHaveLength(1)
  })

  test('does not close a near-parallel separated endcap pair from distance alone', () => {
    const walls = [
      WallNode.parse({ id: 'wall_near_parallel_end', start: [0, -2], end: [0, 0], thickness: 0.2 }),
      WallNode.parse({
        id: 'wall_near_parallel_start',
        start: [0.0007, 0.04],
        end: [0.0357, 2.04],
        thickness: 0.2,
      }),
      WallNode.parse({
        id: 'wall_near_parallel_bottom',
        start: [0, -2],
        end: [2, -2],
        thickness: 0.2,
      }),
      WallNode.parse({
        id: 'wall_near_parallel_right',
        start: [2, -2],
        end: [2, 2.04],
        thickness: 0.2,
      }),
      WallNode.parse({
        id: 'wall_near_parallel_top',
        start: [2, 2.04],
        end: [0.0357, 2.04],
        thickness: 0.2,
      }),
    ]
    const { spaces } = detectSpacesForLevel('level-near-parallel-endcaps', walls)

    expect(spaces).toHaveLength(0)
  })

  test('fails closed when a dangling endpoint has competing hosts', () => {
    const walls = [
      WallNode.parse({ id: 'wall_ambiguous_bottom', start: [0, 0], end: [4, 0] }),
      WallNode.parse({ id: 'wall_ambiguous_right', start: [4, 0], end: [4, 3] }),
      WallNode.parse({ id: 'wall_ambiguous_top', start: [4, 3], end: [0, 3] }),
      WallNode.parse({ id: 'wall_ambiguous_left', start: [0, 3], end: [0, 0] }),
      WallNode.parse({ id: 'wall_ambiguous_host', start: [1, -1], end: [1, 1] }),
      WallNode.parse({ id: 'wall_ambiguous_source', start: [1.05, 0.05], end: [1.3, 0.5] }),
    ]
    const { spaces } = detectSpacesForLevel('level-ambiguous-contact', walls)

    expect(spaces).toHaveLength(1)
    expect(spaces[0]?.wallIds).not.toContain('wall_ambiguous_source')
  })

  test('keeps curved wall sampling outside straight intersection planarization', () => {
    const walls = [
      WallNode.parse({ id: 'wall_curve_bottom', start: [0, 0], end: [4, 0], curveOffset: 0.2 }),
      WallNode.parse({ id: 'wall_curve_right', start: [4, 0], end: [4, 3] }),
      WallNode.parse({ id: 'wall_curve_top', start: [4, 3], end: [0, 3] }),
      WallNode.parse({ id: 'wall_curve_left', start: [0, 3], end: [0, 0] }),
    ]
    const before = walls.map((wall) => ({
      id: wall.id,
      start: [...wall.start],
      end: [...wall.end],
    }))
    const { spaces } = detectSpacesForLevel('level-curved-boundary', walls)

    expect(spaces).toHaveLength(1)
    expect(spaces[0]?.polygon.length).toBeGreaterThan(4)
    expect(spaces[0]?.boundaryFaces.some((face) => face.wallId === 'wall_curve_bottom')).toBe(true)
    expect(
      walls.map((wall) => ({ id: wall.id, start: [...wall.start], end: [...wall.end] })),
    ).toEqual(before)
  })
})

describe('procedural zones', () => {
  test('reactive wall deletion updates imported zone review state without changing its source identity', () => {
    const level = LevelNode.parse({ id: 'level_zone_sync' })
    const walls = squareWalls().map((wall) => ({ ...wall, parentId: level.id }))
    const zone = ZoneNode.parse({
      name: 'Bedroom',
      parentId: level.id,
      polygon: square,
      spaceRole: 'room',
      autoFromWalls: true,
      boundaryWallIds: walls.map((wall) => wall.id),
      metadata: { source: 'apt-vector', sourceRoomId: 'bedroom' },
    })
    const original = Object.fromEntries([level, ...walls, zone].map((node) => [node.id, node]))
    const scene = createSceneStoreStub(original)
    const stop = initSpaceDetectionSync(scene, createEditorStoreStub())
    expect(scene.getState().nodes[zone.id]).toEqual(zone)
    const broken = { ...original }
    delete broken[walls[0]!.id]
    scene.setNodes(broken)
    expect(scene.getState().nodes[zone.id]).toMatchObject({
      id: zone.id,
      name: zone.name,
      polygon: zone.polygon,
      autoFromWalls: true,
      boundaryWallIds: zone.boundaryWallIds,
      metadata: { ...zone.metadata, boundaryNeedsReview: true },
    })
    scene.setNodes(original)
    expect((scene.getState().nodes[zone.id] as typeof zone).metadata).toEqual(zone.metadata)
    stop()
  })
  test('follows an imported approximate room through a wall edit and marks a removed boundary for review', () => {
    const walls = squareWalls()
    const previousSpaces = detectSpacesForLevel('level-1', walls).spaces
    const zone = ZoneNode.parse({
      name: 'Bedroom',
      spaceRole: 'room',
      floorFinish: 'Timber',
      polygon: [
        [0.05, 0.05],
        [3.95, 0.05],
        [3.95, 2.95],
        [0.05, 2.95],
      ],
      metadata: { source: 'apt-vector', sourceRoomId: 'room-1' },
    })
    const moved = [
      { ...walls[0]!, end: [5, 0] as [number, number] },
      { ...walls[1]!, start: [5, 0] as [number, number], end: [5, 3] as [number, number] },
      { ...walls[2]!, start: [5, 3] as [number, number] },
      walls[3]!,
    ]
    const plan = planAutoZonesForLevel(detectSpacesForLevel('level-1', moved).spaces, [zone], {
      previousSpaces,
      changedWalls: walls,
    })
    expect(plan.update[0]?.data.polygon).toContainEqual([5, 0])
    const adopted = ZoneNode.parse({ ...zone, ...plan.update[0]?.data })
    const broken = planAutoZonesForLevel([], [adopted], { previousSpaces, changedWalls: walls })
    expect(broken.update[0]?.data.metadata).toEqual({ ...zone.metadata, boundaryNeedsReview: true })
    expect(adopted.name).toBe('Bedroom')
    expect(adopted.floorFinish).toBe('Timber')
  })

  test('split wall IDs with unchanged room geometry update the binding without a false warning', () => {
    const walls = squareWalls()
    const zone = ZoneNode.parse({
      name: 'Kitchen',
      polygon: square,
      autoFromWalls: true,
      boundaryWallIds: walls.map((wall) => wall.id),
    })
    const split = WallNode.parse({ start: [2, 0], end: [4, 0] })
    const nextWalls = [{ ...walls[0]!, end: [2, 0] as [number, number] }, split, ...walls.slice(1)]
    const plan = planAutoZonesForLevel(detectSpacesForLevel('level-1', nextWalls).spaces, [zone])
    expect(plan.update[0]?.data.boundaryWallIds).toContain(split.id)
    expect(plan.update[0]?.data.metadata?.boundaryNeedsReview).not.toBe(true)
  })

  test('a deleted imported room boundary reports uncertainty without renaming or merging rooms', () => {
    const walls = squareWalls()
    const zone = ZoneNode.parse({
      name: 'Kitchen',
      spaceRole: 'room',
      polygon: square,
      metadata: { source: 'apt-vector' },
    })
    const plan = planAutoZonesForLevel([], [zone], {
      previousSpaces: detectSpacesForLevel('level-1', walls).spaces,
      changedWalls: [walls[0]!],
    })
    expect(plan.update[0]?.data.metadata?.boundaryNeedsReview).toBe(true)
    expect(plan.update[0]?.data.name).toBeUndefined()
    expect(plan.update[0]?.data.polygon).toBeUndefined()
  })
  test('adopts an exact room footprint and records its enclosing walls', () => {
    const walls = squareWalls()
    const { spaces } = detectSpacesForLevel('level-1', walls)
    const zone = ZoneNode.parse({ name: 'Kitchen', polygon: square })

    const plan = planAutoZonesForLevel(spaces, [zone])

    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]?.data.autoFromWalls).toBe(true)
    expect(new Set(plan.update[0]?.data.boundaryWallIds)).toEqual(
      new Set(walls.map((wall) => wall.id)),
    )
  })

  test('derives the live polygon from effective wall endpoints', () => {
    const walls = squareWalls()
    const zone = ZoneNode.parse({
      name: 'Kitchen',
      polygon: square,
      autoFromWalls: true,
      boundaryWallIds: walls.map((wall) => wall.id),
    })
    const movedWalls = [
      { ...walls[0]!, end: [5, 0] as [number, number] },
      { ...walls[1]!, start: [5, 0] as [number, number], end: [5, 3] as [number, number] },
      { ...walls[2]!, start: [5, 3] as [number, number] },
      walls[3]!,
    ]
    const byId = new Map(movedWalls.map((wall) => [wall.id, wall]))

    const polygon = resolveAutoZonePolygon(zone, (id) =>
      byId.get(id as (typeof walls)[number]['id']),
    )
    const plan = planAutoZonesForLevel(detectSpacesForLevel('level-1', movedWalls).spaces, [zone])

    expect(polygon).toContainEqual([5, 0])
    expect(polygon).toContainEqual([5, 3])
    expect(polygon).not.toContainEqual([4, 0])
    expect(plan.update[0]?.data.polygon).toContainEqual([5, 0])
  })

  test('leaves an unrelated site zone manual', () => {
    const { spaces } = detectSpacesForLevel('level-1', squareWalls())
    const zone = ZoneNode.parse({
      name: 'Lawn',
      polygon: [
        [10, 10],
        [12, 10],
        [12, 12],
        [10, 12],
      ],
    })

    expect(planAutoZonesForLevel(spaces, [zone]).update).toHaveLength(0)
  })

  test('adopts one inset apartment zone to the exact detected space footprint', () => {
    const walls = squareWalls()
    const { spaces } = detectSpacesForLevel('level-1', walls)
    const zone = ZoneNode.parse({
      id: 'zone_apartment_inset',
      name: '거실',
      color: '#8f8878',
      spaceRole: 'room',
      polygon: [
        [0.4, 0.4],
        [3.6, 0.4],
        [3.6, 2.6],
        [0.4, 2.6],
      ],
      metadata: { source: 'apt-vector', sourceRoomId: 'r1', cls: 'living' },
    })

    const plan = planAutoZonesForLevel(spaces, [zone], {
      adoptContainedApartmentZones: true,
    })

    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]?.id).toBe(zone.id)
    expect(plan.update[0]?.data).toMatchObject({
      autoFromWalls: true,
      polygon: spaces[0]?.polygon,
      boundaryWallIds: spaces[0]?.wallIds,
    })
    expect(plan.update[0]?.data.name).toBeUndefined()
    expect(plan.update[0]?.data.metadata).toBeUndefined()
  })

  test('keeps an exact enclosed apartment owner without creating a duplicate', () => {
    const walls = squareWalls()
    const { spaces } = detectSpacesForLevel('level_zone_exact_owner', walls)
    const zone = ZoneNode.parse({
      id: 'zone_exact_apartment_owner',
      name: 'Living',
      color: '#8f8878',
      spaceRole: 'room',
      enclosureStatus: 'enclosed',
      autoFromWalls: true,
      boundaryWallIds: spaces[0]!.wallIds,
      polygon: spaces[0]!.polygon,
      metadata: { source: 'apt-vector', sourceRoomId: 'living', cls: 'living' },
    })

    const plan = planAutoZonesForLevel(spaces, [zone], {
      adoptContainedApartmentZones: true,
      createMissingZones: { source: 'apt-vector', generatedFrom: 'detected-space' },
    })

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
    expect(zone).toMatchObject({
      id: 'zone_exact_apartment_owner',
      name: 'Living',
      color: '#8f8878',
      enclosureStatus: 'enclosed',
      metadata: { source: 'apt-vector', sourceRoomId: 'living', cls: 'living' },
    })
  })

  test('keeps ambiguous apartment subdivisions when an exact and inset zone claim one space', () => {
    const { spaces } = detectSpacesForLevel('level-1', squareWalls())
    const zones = [
      ZoneNode.parse({
        id: 'zone_open_living',
        name: '거실',
        spaceRole: 'room',
        polygon: [
          [0, 0],
          [4, 0],
          [4, 3],
          [0, 3],
        ],
        metadata: { source: 'apt-vector', sourceRoomId: 'living' },
      }),
      ZoneNode.parse({
        id: 'zone_open_entry',
        name: '현관',
        spaceRole: 'room',
        polygon: [
          [0.4, 0.4],
          [3.6, 0.4],
          [3.6, 2.6],
          [0.4, 2.6],
        ],
        metadata: { source: 'apt-vector', sourceRoomId: 'entry' },
      }),
    ]

    const plan = planAutoZonesForLevel(spaces, zones, {
      adoptContainedApartmentZones: true,
    })

    expect(plan.update).toHaveLength(2)
    for (const zone of zones) {
      const update = plan.update.find((entry) => entry.id === zone.id)
      expect(update?.data).toMatchObject({
        enclosureStatus: 'open',
        metadata: {
          source: 'apt-vector',
          sourceRoomId: zone.metadata?.sourceRoomId,
          boundaryNeedsReview: true,
        },
      })
      expect(update?.data.name).toBeUndefined()
      expect(update?.data.polygon).toBeUndefined()
    }
  })

  test('requires the import flag and apt-vector provenance before contained adoption', () => {
    const { spaces } = detectSpacesForLevel('level-1', squareWalls())
    const inset = [
      [0.4, 0.4],
      [3.6, 0.4],
      [3.6, 2.6],
      [0.4, 2.6],
    ] as Array<[number, number]>
    const aptZone = ZoneNode.parse({
      id: 'zone_flagged',
      name: '거실',
      spaceRole: 'room',
      polygon: inset,
      metadata: { source: 'apt-vector', sourceRoomId: 'r1' },
    })
    const manualZone = ZoneNode.parse({
      id: 'zone_manual',
      name: '기록',
      spaceRole: 'room',
      polygon: inset,
      metadata: { source: 'survey' },
    })

    expect(planAutoZonesForLevel(spaces, [aptZone]).update).toHaveLength(0)
    expect(
      planAutoZonesForLevel(spaces, [manualZone], { adoptContainedApartmentZones: true }).update,
    ).toHaveLength(0)
  })

  test('creates a provenance-tagged zone for every detected apartment room when labels are empty', () => {
    const level = LevelNode.parse({ id: 'level_zone_import_empty' })
    const walls = squareWalls().map((wall) => ({ ...wall, parentId: level.id }))
    const spaces = detectSpacesForLevel(level.id, walls).spaces
    const plan = planAutoZonesForLevel(spaces, [], {
      createMissingZones: { source: 'apt-vector', generatedFrom: 'detected-space' },
    })

    expect(plan.update).toHaveLength(0)
    expect(plan.create).toHaveLength(1)
    expect(plan.create[0]).toMatchObject({
      parentId: level.id,
      autoFromWalls: true,
      spaceRole: 'room',
      enclosureStatus: 'enclosed',
      boundaryWallIds: spaces[0]?.wallIds,
      metadata: { source: 'apt-vector', generatedFrom: 'detected-space' },
    })
  })

  test('does not let an auto room demoted to open cover replacement spaces', () => {
    const level = LevelNode.parse({ id: 'level_zone_replacement_spaces' })
    const walls = samePrefixRoomWalls().map((wall) => ({ ...wall, parentId: level.id }))
    const spaces = detectSpacesForLevel(level.id, walls).spaces
    const obsoleteZone = ZoneNode.parse({
      id: 'zone_obsolete_generated_room',
      parentId: level.id,
      name: 'Room 2',
      autoFromWalls: true,
      spaceRole: 'room',
      boundaryWallIds: ['wall_obsolete_generated'],
      polygon: [
        [-1000, 0.1],
        [-996, 0.1],
        [-996, 1.1],
        [-1000, 1.1],
      ],
      metadata: { source: 'apt-vector', generatedFrom: 'detected-space' },
    })

    const plan = planAutoZonesForLevel(spaces, [obsoleteZone], {
      createMissingZones: { source: 'apt-vector', generatedFrom: 'detected-space' },
    })

    expect(plan.update).toHaveLength(1)
    expect(plan.update[0]).toMatchObject({
      id: obsoleteZone.id,
      data: {
        enclosureStatus: 'open',
        metadata: {
          source: 'apt-vector',
          generatedFrom: 'detected-space',
          boundaryNeedsReview: true,
        },
      },
    })
    expect(plan.update[0]?.data.name).toBeUndefined()
    expect(plan.update[0]?.data.polygon).toBeUndefined()
    expect(plan.create).toHaveLength(2)
    expect(plan.create.every((zone) => zone.enclosureStatus === 'enclosed')).toBe(true)
    expect(plan.create.every((zone) => zone.metadata?.generatedFrom === 'detected-space')).toBe(
      true,
    )
  })

  test('keeps an enclosed generated room as coverage when it still matches', () => {
    const level = LevelNode.parse({ id: 'level_zone_matched_generated' })
    const walls = squareWalls().map((wall) => ({ ...wall, parentId: level.id }))
    const spaces = detectSpacesForLevel(level.id, walls).spaces
    const generatedZone = ZoneNode.parse({
      id: 'zone_matched_generated_room',
      parentId: level.id,
      name: 'Room 1',
      autoFromWalls: true,
      spaceRole: 'room',
      enclosureStatus: 'enclosed',
      boundaryWallIds: spaces[0]!.wallIds,
      polygon: spaces[0]!.polygon,
      metadata: { source: 'apt-vector', generatedFrom: 'detected-space' },
    })

    const plan = planAutoZonesForLevel(spaces, [generatedZone], {
      createMissingZones: { source: 'apt-vector', generatedFrom: 'detected-space' },
    })

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
  })

  test('keeps a manual open room as coverage without changing its provenance', () => {
    const level = LevelNode.parse({ id: 'level_zone_manual_coverage' })
    const walls = samePrefixRoomWalls().map((wall) => ({ ...wall, parentId: level.id }))
    const spaces = detectSpacesForLevel(level.id, walls).spaces
    const manualZone = ZoneNode.parse({
      id: 'zone_manual_open_room',
      parentId: level.id,
      name: 'Manual room',
      enclosureStatus: 'open',
      polygon: [
        [-1000.01, 0.09],
        [-995.99, 0.09],
        [-995.99, 0.31],
        [-1000.01, 0.31],
      ],
      metadata: { source: 'user', boundaryNeedsReview: true },
    })

    const plan = planAutoZonesForLevel(spaces, [manualZone], {
      createMissingZones: { source: 'apt-vector', generatedFrom: 'detected-space' },
    })

    expect(plan.create).toHaveLength(1)
    expect(plan.create[0]?.polygon).toEqual(spaces[1]!.polygon)
    expect(plan.update).toHaveLength(0)
  })

  test('does not create a duplicate room over a union of semantic subdivisions', () => {
    const level = LevelNode.parse({ id: 'level_zone_semantic_union' })
    const walls = squareWalls().map((wall) => ({ ...wall, parentId: level.id }))
    const [left, right] = [
      ZoneNode.parse({
        id: 'zone_semantic_left',
        parentId: level.id,
        name: 'Living',
        polygon: [
          [0, 0],
          [2, 0],
          [2, 3],
          [0, 3],
        ],
        metadata: { source: 'user' },
      }),
      ZoneNode.parse({
        id: 'zone_semantic_right',
        parentId: level.id,
        name: 'Dining',
        polygon: [
          [2, 0],
          [4, 0],
          [4, 3],
          [2, 3],
        ],
        metadata: { source: 'user' },
      }),
    ]
    const plan = planAutoZonesForLevel(
      detectSpacesForLevel(level.id, walls).spaces,
      [left!, right!],
      {
        createMissingZones: { source: 'apt-vector', generatedFrom: 'detected-space' },
      },
    )
    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
  })

  test('creates one physical owner when open apt-vector review subdivisions cover a closed space', () => {
    const level = LevelNode.parse({ id: 'level_zone_review_union' })
    const walls = squareWalls().map((wall) => ({ ...wall, parentId: level.id }))
    const spaces = detectSpacesForLevel(level.id, walls).spaces
    const [left, right] = [
      ZoneNode.parse({
        id: 'zone_review_left',
        parentId: level.id,
        name: 'Living',
        spaceRole: 'room',
        enclosureStatus: 'open',
        polygon: [
          [0, 0],
          [2, 0],
          [2, 3],
          [0, 3],
        ],
        metadata: {
          source: 'apt-vector',
          sourceRoomId: 'living',
          boundaryNeedsReview: true,
        },
      }),
      ZoneNode.parse({
        id: 'zone_review_right',
        parentId: level.id,
        name: 'Dining',
        spaceRole: 'room',
        enclosureStatus: 'open',
        polygon: [
          [2, 0],
          [4, 0],
          [4, 3],
          [2, 3],
        ],
        metadata: {
          source: 'apt-vector',
          sourceRoomId: 'dining',
          boundaryNeedsReview: true,
        },
      }),
    ]

    const plan = planAutoZonesForLevel(spaces, [left!, right!], {
      adoptContainedApartmentZones: true,
      createMissingZones: { source: 'apt-vector', generatedFrom: 'detected-space' },
    })

    expect(plan.update).toHaveLength(0)
    expect(plan.create).toHaveLength(1)
    expect(plan.create[0]).toMatchObject({
      parentId: level.id,
      autoFromWalls: true,
      enclosureStatus: 'enclosed',
      boundaryWallIds: spaces[0]?.wallIds,
      polygon: spaces[0]?.polygon,
      metadata: { source: 'apt-vector', generatedFrom: 'detected-space' },
    })
    expect(plan.create[0]?.id).not.toBe(left?.id)
    expect(plan.create[0]?.id).not.toBe(right?.id)
  })

  test('keeps an unmatched apartment zone open for review and restores it to enclosed', () => {
    const level = LevelNode.parse({ id: 'level_zone_status' })
    const walls = squareWalls().map((wall) => ({ ...wall, parentId: level.id }))
    const zone = ZoneNode.parse({
      id: 'zone_status_room',
      parentId: level.id,
      name: 'Bedroom',
      spaceRole: 'room',
      autoFromWalls: true,
      boundaryWallIds: walls.map((wall) => wall.id),
      polygon: square,
      metadata: { source: 'apt-vector' },
    })
    const broken = planAutoZonesForLevel([], [zone], {
      previousSpaces: detectSpacesForLevel(level.id, walls).spaces,
      changedWalls: [walls[0]!],
    })
    expect(broken.update[0]?.data.enclosureStatus).toBe('open')
    expect(broken.update[0]?.data.metadata).toEqual({
      source: 'apt-vector',
      boundaryNeedsReview: true,
    })

    const restored = ZoneNode.parse({ ...zone, ...broken.update[0]?.data })
    const enclosed = planAutoZonesForLevel(detectSpacesForLevel(level.id, walls).spaces, [restored])
    expect(enclosed.update[0]?.data.enclosureStatus).toBe('enclosed')
    expect(enclosed.update[0]?.data.metadata).toEqual({ source: 'apt-vector' })
  })

  test('creates a missing zone after an apt-vector wall edit closes a live room', () => {
    const level = LevelNode.parse({ id: 'level_zone_live_create' })
    const apartmentSource = {
      source: 'apt-vector',
      apartmentId: 'apt-live',
      planId: 'plan-live',
    }
    const openWalls = squareWalls()
      .slice(0, 3)
      .map((wall) => ({ ...wall, parentId: level.id, metadata: apartmentSource }))
    const initial = Object.fromEntries(
      [level, ...openWalls].map((node) => [node.id, node]),
    ) as Record<string, AnyNode>
    const scene = createSceneStoreStub(initial)
    const stop = initSpaceDetectionSync(scene, createEditorStoreStub())
    try {
      const closing = WallNode.parse({
        id: 'wall_live_closing',
        parentId: level.id,
        start: [0, 3],
        end: [0, 0],
        metadata: apartmentSource,
      })
      scene.setNodes({ ...scene.getState().nodes, [closing.id]: closing })
      const zones = Object.values(scene.getState().nodes).filter((node) => node.type === 'zone')
      expect(zones).toHaveLength(1)
      expect(zones[0]).toMatchObject({
        autoFromWalls: true,
        enclosureStatus: 'enclosed',
        metadata: {
          source: 'apt-vector',
          generatedFrom: 'detected-space',
          apartmentId: 'apt-live',
          planId: 'plan-live',
        },
      })
    } finally {
      stop()
    }
  })
})

describe('wallClosesRoom', () => {
  test('is false while a chain is still open, true once it encloses a room', () => {
    const open = [
      WallNode.parse({ start: [0, 0], end: [4, 0] }),
      WallNode.parse({ start: [4, 0], end: [4, 3] }),
      WallNode.parse({ start: [4, 3], end: [0, 3] }),
    ]
    const closing = WallNode.parse({ start: [0, 3], end: [0, 0] })

    expect(wallClosesRoom(open, closing)).toBe(false)
    expect(wallClosesRoom([...open, closing], closing)).toBe(true)
  })

  test('fires when a bay is sealed against the middle of an existing wall', () => {
    const bigRoom = [
      WallNode.parse({ start: [0, 0], end: [6, 0] }),
      WallNode.parse({ start: [6, 0], end: [6, 5] }),
      WallNode.parse({ start: [6, 5], end: [0, 5] }),
      WallNode.parse({ start: [0, 5], end: [0, 0] }),
    ]
    const bayLeft = WallNode.parse({ start: [1, 0], end: [1, -2] })
    const bayBottom = WallNode.parse({ start: [1, -2], end: [3, -2] })
    const bayRight = WallNode.parse({ start: [3, -2], end: [3, 0] })

    // Two sides down and across: not enclosed yet.
    expect(wallClosesRoom([...bigRoom, bayLeft, bayBottom], bayBottom)).toBe(false)
    // The final side lands on the interior of the big room's bottom wall.
    expect(wallClosesRoom([...bigRoom, bayLeft, bayBottom, bayRight], bayRight)).toBe(true)
  })
})

describe('planAutoSlabsForLevel', () => {
  test('creates and reconciles an auto slab on the enclosing wall plane', () => {
    const context = {
      elevationForRoom: () => 0.65,
    }
    const created = planAutoSlabsForLevel([roomPolygon()], [], context).create[0]

    expect(created?.elevation).toBeCloseTo(0.65)

    const existing = slab(0.05)
    const update = planAutoSlabsForLevel([roomPolygon()], [existing], context).update[0]

    expect(update?.id).toBe(existing.id)
    expect(update?.data.elevation).toBeCloseTo(0.65)
  })

  test('preserves a p42 shallow shared bend across auto slabs and ceilings without churn', () => {
    // These are raw detected-space polygons 0 and 7 from the frozen p42
    // apartment replay (3FO3YWCYEPV9). Translating the pair keeps the source
    // geometry while making the regression fixture independent of the plan's
    // world-space origin.
    const p42RawRooms: PolygonPoint[][] = [
      [
        [2.4833162727438722, -3.8852224848374206],
        [5.984516272743869, -3.8852224848374206],
        [7.983849689202724, -3.8852224848374206],
        [8.09751627274387, -3.785022484837421],
        [8.14421627274387, -3.5247224848374206],
        [8.14421627274387, -1.3066224848374204],
        [6.315116272743872, -1.30662248483742],
        [6.315116272743872, 2.32147751516258],
        [6.31511627274387, 2.326677515162579],
        [2.0160162727438693, 2.2615775151625783],
        [2.0160162727438693, -0.18215363954094152],
        [-0.2585837272561293, -0.16653668011160805],
        [-0.2585837272561289, -0.2269224848374215],
        [-3.1688837272561283, -0.2269224848374215],
        [-5.944483727256129, -0.2269224848374215],
        [-8.45128372725613, -0.2269224848374215],
        [-8.45128372725613, -1.303090573574621],
        [-6.71558372725613, -1.2848252436542578],
        [-4.432583727256129, -1.260800499626955],
        [-3.1641837272561295, -1.2474527180569897],
        [-1.7147163474623806, -1.2488418742562966],
        [-1.6001740587478412, -2.29350618649488],
        [-1.6555837272561293, -3.044022484837421],
        [0.2792162727438699, -3.044022484837421],
        [0.2792162727438699, -4.47262248483742],
        [0.2792162727438699, -4.899822484837421],
        [2.4299162727438706, -4.899822484837421],
        [2.4299162727438706, -4.339122484837421],
        [2.2912162727438705, -4.339122484837421],
        [2.336416272743871, -4.232322484837421],
      ],
      [
        [5.984516272743869, -4.899822484837421],
        [9.75321627274387, -4.899822484837422],
        [9.75321627274387, -3.5247224848374206],
        [8.14421627274387, -3.5247224848374206],
        [8.09751627274387, -3.785022484837421],
        [7.983849689202724, -3.8852224848374206],
        [5.984516272743869, -3.8852224848374206],
      ],
    ]
    const origin = p42RawRooms[1]![0]!
    const roomPolygons = p42RawRooms.map((polygon) =>
      polygon.map(([x, y]) => [x - origin[0], y - origin[1]] as PolygonPoint),
    )
    const rooms = roomPolygons.map((polygon) => polygon.map(([x, y]) => ({ x, y })))
    const legacyPolygons = roomPolygons.map((polygon) => simplifyClosedPolygon(polygon, 0.08))
    const currentPolygons = roomPolygons.map((polygon) => simplifyClosedPolygon(polygon, 1e-6))

    // The frozen-before planner used 80mm per-room simplification. Its exact
    // intersection is the known p42 actual-face overlap, not a bbox artifact.
    const frozenBeforeArea = exactPolygonIntersectionArea(legacyPolygons[0]!, legacyPolygons[1]!)
    expect(frozenBeforeArea).toBeCloseTo(0.009064660124479929, 9)

    const generatedSlabs = planAutoSlabsForLevel(rooms, []).create
    const generatedCeilings = planAutoCeilingsForLevel(rooms, []).create
    expect(generatedSlabs).toHaveLength(2)
    expect(generatedCeilings).toHaveLength(2)
    expect(
      exactPolygonIntersectionArea(generatedSlabs[0]!.polygon, generatedSlabs[1]!.polygon),
    ).toBeLessThan(TEST_AREA_EPSILON)
    expect(
      exactPolygonIntersectionArea(generatedCeilings[0]!.polygon, generatedCeilings[1]!.polygon),
    ).toBeLessThan(TEST_AREA_EPSILON)
    expect(generatedSlabs.map((slab) => slab.polygon)).toEqual(currentPolygons)
    expect(generatedCeilings.map((ceiling) => ceiling.polygon)).toEqual(currentPolygons)

    const existingSlabs = [
      SlabNode.parse({
        id: 'slab_p42_shallow_bend',
        polygon: legacyPolygons[0],
        autoFromWalls: true,
      }),
      SlabNode.parse({
        id: 'slab_p42_shallow_neighbor',
        polygon: legacyPolygons[1],
        autoFromWalls: true,
      }),
    ]
    const existingCeilings = [
      CeilingNode.parse({
        id: 'ceiling_p42_shallow_bend',
        polygon: legacyPolygons[0],
        autoFromWalls: true,
      }),
      CeilingNode.parse({
        id: 'ceiling_p42_shallow_neighbor',
        polygon: legacyPolygons[1],
        autoFromWalls: true,
      }),
    ]
    const slabPlan = planAutoSlabsForLevel(rooms, existingSlabs)
    const ceilingPlan = planAutoCeilingsForLevel(rooms, existingCeilings)
    const updatedSlabPolygons = existingSlabs.map(
      (surface) =>
        slabPlan.update.find((update) => update.id === surface.id)?.data.polygon ?? surface.polygon,
    )
    const updatedCeilingPolygons = existingCeilings.map(
      (surface) =>
        ceilingPlan.update.find((update) => update.id === surface.id)?.data.polygon ??
        surface.polygon,
    )

    expect(slabPlan.create).toHaveLength(0)
    expect(slabPlan.delete).toHaveLength(0)
    expect(slabPlan.update.map((update) => update.id).sort()).toEqual(
      existingSlabs.map((surface) => surface.id).sort(),
    )
    expect(ceilingPlan.create).toHaveLength(0)
    expect(ceilingPlan.delete).toHaveLength(0)
    expect(ceilingPlan.update.map((update) => update.id).sort()).toEqual(
      existingCeilings.map((surface) => surface.id).sort(),
    )
    expect(
      exactPolygonIntersectionArea(updatedSlabPolygons[0]!, updatedSlabPolygons[1]!),
    ).toBeLessThan(TEST_AREA_EPSILON)
    expect(
      exactPolygonIntersectionArea(updatedCeilingPolygons[0]!, updatedCeilingPolygons[1]!),
    ).toBeLessThan(TEST_AREA_EPSILON)

    const exactManualSlab = SlabNode.parse({
      id: 'slab_manual_exact_shared_bend',
      polygon: roomPolygons[1],
      autoFromWalls: false,
    })
    const exactManualCeiling = CeilingNode.parse({
      id: 'ceiling_manual_exact_shared_bend',
      polygon: roomPolygons[1],
      autoFromWalls: false,
    })
    const exactManualSlabPlan = planAutoSlabsForLevel(rooms, [exactManualSlab])
    const exactManualCeilingPlan = planAutoCeilingsForLevel(rooms, [exactManualCeiling])
    expect(exactManualSlabPlan.create).toHaveLength(1)
    expect(exactManualSlabPlan.create[0]?.polygon).toEqual(currentPolygons[0])
    expect(exactManualCeilingPlan.create).toHaveLength(1)
    expect(exactManualCeilingPlan.create[0]?.polygon).toEqual(currentPolygons[0])

    const firstRoomX = roomPolygons[0]!.map(([x]) => x)
    const firstRoomY = roomPolygons[0]!.map(([, y]) => y)
    const containingPolygon: PolygonPoint[] = [
      [Math.min(...firstRoomX) - 0.1, Math.min(...firstRoomY) - 0.1],
      [Math.max(...firstRoomX) + 0.1, Math.min(...firstRoomY) - 0.1],
      [Math.max(...firstRoomX) + 0.1, Math.max(...firstRoomY) + 0.1],
      [Math.min(...firstRoomX) - 0.1, Math.max(...firstRoomY) + 0.1],
    ]
    const containingManualSlab = SlabNode.parse({
      id: 'slab_manual_containing_shared_bend',
      polygon: containingPolygon,
      autoFromWalls: false,
    })
    const containingManualCeiling = CeilingNode.parse({
      id: 'ceiling_manual_containing_shared_bend',
      polygon: containingPolygon,
      autoFromWalls: false,
    })
    expect(planAutoSlabsForLevel([rooms[0]!], [containingManualSlab]).create).toHaveLength(0)
    expect(planAutoCeilingsForLevel([rooms[0]!], [containingManualCeiling]).create).toHaveLength(0)
  })

  test('matches two identical rooms to their own existing auto-slabs without churn', () => {
    // Two rooms with identical polygon signatures previously collided in a
    // signature-keyed Map, so one detected room never matched an existing slab
    // and churned (delete + recreate) on every pass.
    const slabA = slab(0.05)
    const slabB = slab(0.05)

    const plan = planAutoSlabsForLevel([roomPolygon(), roomPolygon()], [slabA, slabB])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
  })

  test('deletes an extra auto-slab when only one identical room is detected', () => {
    const plan = planAutoSlabsForLevel([roomPolygon()], [slab(0.05), slab(0.05)])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(1)
  })

  test('demotes an orphaned auto slab to manual when its room disappears', () => {
    const painted = SlabNode.parse({
      polygon: square,
      elevation: 0.4,
      autoFromWalls: true,
    })

    const plan = planAutoSlabsForLevel([], [painted])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
    expect(plan.update).toHaveLength(1)

    const update = plan.update[0]
    expect(update?.id).toBe(painted.id)
    // Demotion flips only the flag — the stored polygon stays untouched
    // (render offsets derive from level context at geometry build time).
    expect(update?.data).toEqual({ autoFromWalls: false })
  })

  test('deletes an unmatched auto slab whose area was absorbed by a room merge', () => {
    const leftSlab = SlabNode.parse({
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      autoFromWalls: true,
    })
    const rightSlab = SlabNode.parse({
      polygon: [
        [4, 0],
        [8, 0],
        [8, 3],
        [4, 3],
      ],
      autoFromWalls: true,
    })
    const mergedRoom = [
      { x: 0, y: 0 },
      { x: 8, y: 0 },
      { x: 8, y: 3 },
      { x: 0, y: 3 },
    ]

    const plan = planAutoSlabsForLevel([mergedRoom], [leftSlab, rightSlab])

    expect(plan.create).toHaveLength(0)
    expect(plan.delete).toHaveLength(1)
    expect(plan.update).toHaveLength(1)
    const survivorId = plan.update[0]?.id
    expect([leftSlab.id, rightSlab.id]).toContain(plan.delete[0]!)
    expect(plan.delete[0]).not.toBe(survivorId)
    // The survivor stays auto — updated to the merged polygon, not demoted.
    expect(plan.update[0]?.data.autoFromWalls).toBeUndefined()
  })

  test('a demoted slab suppresses re-creating an auto slab when the room re-forms', () => {
    const auto = slab(0.05)

    const demotion = planAutoSlabsForLevel([], [auto]).update[0]
    const demoted = SlabNode.parse({ ...auto, ...demotion?.data })
    expect(demoted.autoFromWalls).toBe(false)

    const plan = planAutoSlabsForLevel([roomPolygon()], [demoted])

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
  })

  test('manual slabs that split one room suppress a replacement full-room slab', () => {
    const left = SlabNode.parse({
      polygon: [
        [0, 0],
        [2, 0],
        [2, 3],
        [0, 3],
      ],
      autoFromWalls: false,
    })
    const right = SlabNode.parse({
      polygon: [
        [2, 0],
        [4, 0],
        [4, 3],
        [2, 3],
      ],
      autoFromWalls: false,
    })

    const plan = planAutoSlabsForLevel([roomPolygon()], [left, right])

    expect(plan.create).toHaveLength(0)
    expect(plan.update).toHaveLength(0)
    expect(plan.delete).toHaveLength(0)
  })
})

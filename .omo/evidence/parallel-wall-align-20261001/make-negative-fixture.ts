import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BuildingNode, DoorNode, LevelNode, SiteNode, WallNode } from '../../../packages/core/src/schema'

const siteId = 'site_parallel_negative_fixture'
const buildingId = 'building_parallel_negative_fixture'
const levelId = 'level_parallel_negative_fixture'

const cases = [
  {
    id: 'perpendicular-only',
    selectedWallId: 'wall_neg_perpendicular_selected',
    expectedError: 'no-parallel-continuation',
    purpose: 'A single endpoint branch is perpendicular and must not qualify.',
  },
  {
    id: 'ambiguous-two-refs',
    selectedWallId: 'wall_neg_ambiguous_selected',
    expectedError: 'ambiguous-parallel-continuation',
    purpose: 'Two opposite parallel continuations share the selected start.',
  },
  {
    id: 'protected-interior-t',
    selectedWallId: 'wall_neg_t_selected',
    expectedError: 'detached-wall-junction',
    purpose: 'A branch starts on the selected wall interior and would detach.',
  },
  {
    id: 'hosted-overflow-linked',
    selectedWallId: 'wall_neg_overflow_selected',
    expectedError: 'attachment-outside-wall',
    purpose: 'A linked wall shortens and its hosted opening no longer fits.',
  },
] as const

function wall(
  id: string,
  start: [number, number],
  end: [number, number],
  children: string[] = [],
) {
  return WallNode.parse({ id, parentId: levelId, start, end, children })
}

const perpendicularSelected = wall(
  'wall_neg_perpendicular_selected',
  [0, 0],
  [4, 0],
)
const perpendicularReference = wall('wall_neg_perpendicular_ref', [4, 0], [4, 3])

const ambiguousSelected = wall('wall_neg_ambiguous_selected', [20, 0], [24, 0.2])
const ambiguousReferenceA = wall('wall_neg_ambiguous_ref_a', [20, 0], [16, -0.2])
const ambiguousReferenceB = wall('wall_neg_ambiguous_ref_b', [20, 0], [15, -0.25])

const protectedTSelected = wall('wall_neg_t_selected', [40, 0], [44, 0.1])
const protectedTReference = wall('wall_neg_t_ref', [44, 0.1], [48, 0.1])
const protectedTBranch = wall('wall_neg_t_branch', [42, 0.05], [42, 2])

const overflowSelected = wall('wall_neg_overflow_selected', [60, 0], [64, 0.1])
const overflowReference = wall('wall_neg_overflow_ref', [64, 0.1], [68, 0.1])
const overflowLinked = wall(
  'wall_neg_overflow_linked',
  [60, 0],
  [60, 0.5],
  ['door_neg_overflow'],
)
const overflowDoor = DoorNode.parse({
  id: 'door_neg_overflow',
  parentId: overflowLinked.id,
  wallId: overflowLinked.id,
  position: [0.45, 0, 0],
  width: 0.1,
})

const walls = [
  perpendicularSelected,
  perpendicularReference,
  ambiguousSelected,
  ambiguousReferenceA,
  ambiguousReferenceB,
  protectedTSelected,
  protectedTReference,
  protectedTBranch,
  overflowSelected,
  overflowReference,
  overflowLinked,
]
const level = LevelNode.parse({
  id: levelId,
  parentId: buildingId,
  children: walls.map((node) => node.id),
})
const building = BuildingNode.parse({ id: buildingId, parentId: siteId, children: [level.id] })
const site = SiteNode.parse({
  id: siteId,
  parentId: null,
  children: [building.id],
  polygon: {
    type: 'polygon',
    points: [
      [-10, -10],
      [80, -10],
      [80, 20],
      [-10, 20],
    ],
  },
})

const nodes = Object.fromEntries([
  [site.id, site],
  [building.id, building],
  [level.id, level],
  ...walls.map((node) => [node.id, node] as const),
  [overflowDoor.id, overflowDoor],
])

const fixture = {
  format: 'pascal-parallel-wall-negative-fixture/v1',
  description:
    'Disconnected same-level groups for negative parallel-wall alignment browser checks.',
  graph: {
    nodes,
    rootNodeIds: [site.id],
    collections: {},
    materials: {},
  },
  cases,
  uiReadyCheck: {
    selectEach: cases.map(({ id, selectedWallId, expectedError }) => ({
      id,
      selectedWallId,
      expectedError,
      action: 'click the shared single-wall parallel-alignment action',
      assert: 'graph and undo history remain unchanged',
    })),
    disconnectedGroups: {
      perpendicular: [perpendicularSelected.id, perpendicularReference.id],
      ambiguous: [ambiguousSelected.id, ambiguousReferenceA.id, ambiguousReferenceB.id],
      protectedT: [protectedTSelected.id, protectedTReference.id, protectedTBranch.id],
      hostedOverflow: [overflowSelected.id, overflowReference.id, overflowLinked.id, overflowDoor.id],
    },
  },
}

const outputPath = resolve(
  process.argv[2] ?? '.omo/evidence/parallel-wall-align-20261001/negative-fixture.json',
)
writeFileSync(outputPath, `${JSON.stringify(fixture, null, 2)}\n`)
console.log(JSON.stringify({ status: 'PASS', outputPath, nodeCount: Object.keys(nodes).length, caseCount: cases.length }))

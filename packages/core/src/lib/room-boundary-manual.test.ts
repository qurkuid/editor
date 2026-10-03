import { describe, expect, test } from 'bun:test'
import { DoorNode, ItemNode, LevelNode, WallNode } from '../schema'
import {
  buildManualRoomBoundaryRepair,
  buildRoomBoundaryOpenReviewUpdate,
  isRoomBoundaryReviewedOpen,
  roomBoundarySnapshot,
} from './room-boundary'

const level = LevelNode.parse({ id: 'level_manual_boundary' })
function fixture() {
  const a = WallNode.parse({
    id: 'wall_manual_a',
    parentId: level.id,
    start: [0, 0],
    end: [1.8, 0],
  })
  const b = WallNode.parse({
    id: 'wall_manual_b',
    parentId: level.id,
    start: [2, 0.2],
    end: [2, 2],
  })
  return { [level.id]: level, [a.id]: a, [b.id]: b }
}
const input = {
  levelId: level.id,
  wallId: 'wall_manual_a' as const,
  endpoint: 'end' as const,
  targetWallId: 'wall_manual_b' as const,
}

describe('explicit manual room boundary repair', () => {
  test('extends both walls of an open L without requiring a room', () => {
    const nodes = fixture()
    const plan = buildManualRoomBoundaryRepair(nodes, input)
    expect(plan.ok).toBe(true)
    expect(plan.point).toEqual([2, 0])
    expect(plan.updates.find((u) => u.id === input.wallId)?.data).toMatchObject({ end: [2, 0] })
    expect(plan.updates.find((u) => u.id === input.targetWallId)?.data).toMatchObject({
      start: [2, 0],
    })
    expect(nodes[input.wallId].end).toEqual([1.8, 0])
  })
  test('allows a one metre explicit gap and preserves target segment identity', () => {
    const nodes = fixture()
    nodes[input.wallId] = { ...nodes[input.wallId], end: [1, 0] }
    nodes[input.targetWallId] = { ...nodes[input.targetWallId], start: [2, -1] }
    const plan = buildManualRoomBoundaryRepair(nodes, input)
    expect(plan.ok).toBe(true)
    expect(plan.updates).toHaveLength(1)
    expect(plan.updates[0]?.data).toMatchObject({ end: [2, 0] })
  })
  test('rebases a hosted opening and rejects precise stale snapshots', () => {
    const nodes = fixture()
    const door = DoorNode.parse({
      id: 'door_manual',
      parentId: input.targetWallId,
      wallId: input.targetWallId,
      width: 0.6,
      position: [0.8, 1, 0],
    })
    const scene = { ...nodes, [door.id]: door }
    const signature = roomBoundarySnapshot(scene, level.id)
    const plan = buildManualRoomBoundaryRepair(scene, { ...input, expectedSnapshot: signature })
    expect(plan.ok).toBe(true)
    expect(
      (plan.updates.find((u) => u.id === door.id)?.data as typeof door).position[0],
    ).toBeCloseTo(1)
    scene[input.wallId] = { ...scene[input.wallId], end: [1.8001, 0] }
    expect(
      buildManualRoomBoundaryRepair(scene, { ...input, expectedSnapshot: signature }),
    ).toMatchObject({ ok: false, reason: 'stale', updates: [] })
  })
  test('rejects different levels, curves and detached existing T junctions', () => {
    const nodes = fixture()
    expect(
      buildManualRoomBoundaryRepair(
        {
          ...nodes,
          [input.targetWallId]: { ...nodes[input.targetWallId], parentId: 'level_other' },
        },
        input,
      ).ok,
    ).toBe(false)
    expect(
      buildManualRoomBoundaryRepair(
        { ...nodes, [input.wallId]: { ...nodes[input.wallId], curveOffset: 0.2 } },
        input,
      ).ok,
    ).toBe(false)
  })
  test('explicit selection disambiguates competing targets and keeps the unselected wall exact', () => {
    const nodes = fixture()
    const competing = WallNode.parse({
      ...nodes[input.targetWallId],
      id: 'wall_manual_competing',
      start: [2.03, 0.3],
      end: [2.03, 2],
    })
    const scene = { ...nodes, [competing.id]: competing }
    const plan = buildManualRoomBoundaryRepair(scene, input)
    expect(plan.ok).toBe(true)
    expect(plan.point).toEqual([2, 0])
    expect(plan.updates.some((update) => update.id === competing.id)).toBe(false)
    expect(scene[competing.id]).toEqual(competing)
  })
  test('joins a collinear explicit gap but rejects the far target endpoint and separated parallel walls', () => {
    const nodes = fixture()
    const target = {
      ...nodes[input.targetWallId],
      start: [2, 0] as [number, number],
      end: [4, 0] as [number, number],
    }
    const scene = { ...nodes, [target.id]: target }
    expect(buildManualRoomBoundaryRepair(scene, { ...input, targetEndpoint: 'start' }).ok).toBe(
      true,
    )
    expect(buildManualRoomBoundaryRepair(scene, { ...input, targetEndpoint: 'end' }).ok).toBe(false)
    expect(
      buildManualRoomBoundaryRepair(
        { ...scene, [target.id]: { ...target, start: [2, 1], end: [4, 1] } },
        input,
      ),
    ).toMatchObject({ ok: false, reason: 'parallel', updates: [] })
  })
  test('rejects detaching a preexisting target T contact and reversing the source', () => {
    const nodes = fixture()
    const host = WallNode.parse({
      id: 'wall_t_host',
      parentId: level.id,
      start: [1, 0.2],
      end: [3, 0.2],
    })
    const scene = { ...nodes, [host.id]: host }
    const baseline = structuredClone(scene)
    expect(buildManualRoomBoundaryRepair(scene, input).ok).toBe(false)
    expect(scene).toEqual(baseline)
    expect(
      buildManualRoomBoundaryRepair(
        {
          ...nodes,
          [input.targetWallId]: { ...nodes[input.targetWallId], start: [-1, 0.2], end: [-1, 2] },
        },
        input,
      ).ok,
    ).toBe(false)
  })
  test('rejects new collinear overlaps but retains unrelated preexisting overlaps', () => {
    const nodes = fixture()
    const third = WallNode.parse({
      id: 'wall_overlap',
      parentId: level.id,
      start: [1.9, 0],
      end: [2.4, 0],
    })
    expect(buildManualRoomBoundaryRepair({ ...nodes, [third.id]: third }, input)).toMatchObject({
      ok: false,
      reason: 'overlap',
      updates: [],
    })
    const unrelated = {
      ...third,
      start: [10, 10] as [number, number],
      end: [12, 10] as [number, number],
    }
    const duplicate = { ...unrelated, id: 'wall_overlap_duplicate' as const }
    expect(
      buildManualRoomBoundaryRepair(
        { ...nodes, [unrelated.id]: unrelated, [duplicate.id]: duplicate },
        input,
      ).ok,
    ).toBe(true)
  })
  test('checks final footprint of an item on a linked wall after the corner turns', () => {
    const nodes = fixture()
    const linked = WallNode.parse({
      id: 'wall_linked_item',
      parentId: level.id,
      start: [2, 0.2],
      end: [3, 0.2],
    })
    const item = ItemNode.parse({
      id: 'item_boundary',
      parentId: linked.id,
      wallId: linked.id,
      wallT: 0.35,
      position: [0.35, 1, 0],
      rotation: [0, 0, 0],
      asset: {
        id: 'cabinet',
        name: 'Cabinet',
        category: 'cabinet',
        thumbnail: '',
        src: 'https://example.com/item.glb',
        dimensions: [0.6, 1, 2],
        attachTo: 'wall',
      },
    })
    linked.children = [item.id]
    expect(
      buildManualRoomBoundaryRepair({ ...nodes, [linked.id]: linked, [item.id]: item }, input),
    ).toMatchObject({ ok: false, reason: 'attachment-outside-wall', updates: [] })
  })
  test('intentional open review preserves metadata and expires on geometry changes', () => {
    const wall = { ...fixture()[input.wallId], metadata: { source: 'fixture', other: 42 } }
    const update = buildRoomBoundaryOpenReviewUpdate(wall, 'end', true)
    const reviewed = { ...wall, ...update.data } as typeof wall
    expect(reviewed.metadata).toMatchObject({ source: 'fixture', other: 42 })
    expect(isRoomBoundaryReviewedOpen(reviewed, 'end')).toBe(true)
    expect(isRoomBoundaryReviewedOpen({ ...reviewed, end: [1.8001, 0] }, 'end')).toBe(false)
    const reset = {
      ...reviewed,
      ...buildRoomBoundaryOpenReviewUpdate(reviewed, 'end', false).data,
    } as typeof wall
    expect(isRoomBoundaryReviewedOpen(reset, 'end')).toBe(false)
  })
})

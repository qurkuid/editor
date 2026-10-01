import { describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  ConstructionGuideNode,
  DoorNode,
  ItemNode,
  LevelNode,
  WallNode,
  ZoneNode,
} from '../schema'
import { AxisGuideStretchError, buildAxisGuideStretchPlan } from './axis-guide-stretch'

function verticalScene() {
  const level = LevelNode.parse({ id: 'level_main', children: [] })
  const guide = ConstructionGuideNode.parse({
    id: 'cguide_main',
    parentId: level.id,
    origin: [0, 0],
    direction: [0, 1],
  })
  const fixed = WallNode.parse({
    id: 'wall_fixed',
    parentId: level.id,
    start: [-4, 2],
    end: [-2, 2],
  })
  const crossing = WallNode.parse({
    id: 'wall_crossing',
    parentId: level.id,
    start: [-1, 0],
    end: [1, 0],
    children: ['door_on_guide', 'door_selected'],
  })
  const selected = WallNode.parse({
    id: 'wall_selected',
    parentId: level.id,
    start: [1, 1],
    end: [3, 1],
  })
  const doorOnGuide = DoorNode.parse({
    id: 'door_on_guide',
    parentId: crossing.id,
    wallId: crossing.id,
    position: [1, 1, 0],
    width: 1.8,
    height: 2,
  })
  const doorSelected = DoorNode.parse({
    id: 'door_selected',
    parentId: crossing.id,
    wallId: crossing.id,
    position: [1.5, 1, 0],
    width: 0.8,
    height: 2,
  })
  const semantic = ZoneNode.parse({
    id: 'zone_semantic',
    parentId: level.id,
    name: 'Living room',
    polygon: [
      [0.5, -1],
      [2, -1],
      [2, 2],
      [0.5, 2],
    ],
    autoFromWalls: false,
    spaceRole: 'room',
    color: '#f00',
    metadata: { source: 'authored' },
  })
  const nodes: Record<AnyNodeId, AnyNode> = {
    [level.id]: LevelNode.parse({
      ...level,
      children: [guide.id, fixed.id, crossing.id, selected.id, semantic.id],
    }),
    [guide.id]: guide,
    [fixed.id]: fixed,
    [crossing.id]: crossing,
    [selected.id]: selected,
    [doorOnGuide.id]: doorOnGuide,
    [doorSelected.id]: doorSelected,
    [semantic.id]: semantic,
  }
  return { nodes, guide, fixed, crossing, selected, doorOnGuide, doorSelected, semantic }
}

describe('buildAxisGuideStretchPlan', () => {
  test('moves selected-side walls, changes only a straight crossing endpoint, and remaps hosted centers', () => {
    const scene = verticalScene()
    const plan = buildAxisGuideStretchPlan(scene.nodes, {
      guideId: scene.guide.id,
      side: 1,
      distance: 2,
    })

    expect(plan.axis).toBe('x')
    expect(plan.delta).toBe(2)
    expect(plan.updates.find(({ id }) => id === scene.fixed.id)).toBeUndefined()
    expect(plan.updates.find(({ id }) => id === scene.crossing.id)?.data).toEqual({
      start: [-1, 0],
      end: [3, 0],
    })
    expect(plan.updates.find(({ id }) => id === scene.selected.id)?.data).toEqual({
      start: [3, 1],
      end: [5, 1],
    })
    expect(plan.updates.find(({ id }) => id === scene.doorOnGuide.id)).toBeUndefined()
    expect(plan.updates.find(({ id }) => id === scene.doorSelected.id)?.data).toEqual({
      position: [3.5, 1, 0],
    })
    expect(plan.updates.find(({ id }) => id === scene.semantic.id)?.data).toEqual({
      polygon: [
        [2.5, -1],
        [4, -1],
        [4, 2],
        [2.5, 2],
      ],
    })
  })

  test('supports horizontal guides with positive Z as the selected side', () => {
    const level = LevelNode.parse({ id: 'level_horizontal', children: [] })
    const guide = ConstructionGuideNode.parse({
      id: 'cguide_horizontal',
      parentId: level.id,
      origin: [0, 0],
      direction: [1, 0],
    })
    const wall = WallNode.parse({
      id: 'wall_horizontal',
      parentId: level.id,
      start: [0, -2],
      end: [0, 1],
    })
    const nodes: Record<AnyNodeId, AnyNode> = {
      [level.id]: LevelNode.parse({ ...level, children: [guide.id, wall.id] }),
      [guide.id]: guide,
      [wall.id]: wall,
    }

    const plan = buildAxisGuideStretchPlan(nodes, {
      guideId: guide.id,
      side: 1,
      distance: 1,
    })

    expect(plan.axis).toBe('z')
    expect(plan.updates).toEqual([{ id: wall.id, data: { start: [0, -2], end: [0, 2] } }])
  })

  test('keeps points on the guide fixed and rejects unsupported crossings atomically', () => {
    const scene = verticalScene()
    const onGuide = WallNode.parse({
      id: 'wall_on_guide',
      parentId: scene.guide.parentId,
      start: [0, -2],
      end: [0, 2],
    })
    const oblique = WallNode.parse({
      id: 'wall_oblique',
      parentId: scene.guide.parentId,
      start: [-1, -3],
      end: [1, 3],
    })
    const nodes = {
      ...scene.nodes,
      [onGuide.id]: onGuide,
      [oblique.id]: oblique,
    }
    expect(() =>
      buildAxisGuideStretchPlan(nodes, { guideId: scene.guide.id, side: 1, distance: 2 }),
    ).toThrowError(AxisGuideStretchError)
    try {
      buildAxisGuideStretchPlan(nodes, { guideId: scene.guide.id, side: 1, distance: 2 })
    } catch (error) {
      expect(error).toMatchObject({ code: 'unsupported-crossing-wall' })
    }
  })

  test('rejects diagonal guides and invalid distances', () => {
    const scene = verticalScene()
    const diagonal = ConstructionGuideNode.parse({
      id: 'cguide_diagonal',
      parentId: scene.guide.parentId,
      origin: [0, 0],
      direction: [1, 1],
    })
    const nodes = { ...scene.nodes, [diagonal.id]: diagonal }
    expect(() =>
      buildAxisGuideStretchPlan(nodes, { guideId: diagonal.id, side: 1, distance: 1 }),
    ).toThrowError(AxisGuideStretchError)
    expect(() =>
      buildAxisGuideStretchPlan(scene.nodes, { guideId: scene.guide.id, side: 1, distance: 0 }),
    ).toThrowError(AxisGuideStretchError)
  })

  test('normalizes guide direction and uses wall-local item rotation for edge clearance', () => {
    const level = LevelNode.parse({ id: 'level_item_edge', children: [] })
    const guide = ConstructionGuideNode.parse({
      id: 'cguide_item_edge',
      parentId: level.id,
      origin: [0, 0],
      direction: [1e9, 1],
    })
    const wall = WallNode.parse({
      id: 'wall_item_edge',
      parentId: level.id,
      start: [0, -2],
      end: [0, 2],
    })
    const item = ItemNode.parse({
      id: 'item_item_edge',
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 1, 0],
      rotation: [0, 0, 0],
      asset: {
        id: 'asset_item_edge',
        category: 'fixture',
        name: 'Edge fixture',
        thumbnail: 'https://example.com/item.png',
        src: 'https://example.com/item.glb',
        dimensions: [3.8, 1, 0.1],
        attachTo: 'wall',
      },
    })
    const nodes: Record<AnyNodeId, AnyNode> = {
      [level.id]: LevelNode.parse({ ...level, children: [guide.id, wall.id] }),
      [guide.id]: guide,
      [wall.id]: wall,
      [item.id]: item,
    }

    expect(() =>
      buildAxisGuideStretchPlan(nodes, { guideId: guide.id, side: 1, distance: -1 }),
    ).toThrowError(AxisGuideStretchError)
    try {
      buildAxisGuideStretchPlan(nodes, { guideId: guide.id, side: 1, distance: -1 })
    } catch (error) {
      expect(error).toMatchObject({ code: 'attachment-outside-wall' })
    }
  })

  test('normalizes legacy wall-attached items with a local wallT update', () => {
    const level = LevelNode.parse({ id: 'level_item_wallt', children: [] })
    const guide = ConstructionGuideNode.parse({
      id: 'cguide_item_wallt',
      parentId: level.id,
      origin: [0, 0],
      direction: [0, 1],
    })
    const wall = WallNode.parse({
      id: 'wall_item_wallt',
      parentId: level.id,
      start: [0, 0],
      end: [3, 0],
    })
    const item = ItemNode.parse({
      id: 'item_item_wallt',
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 1, 0],
      asset: {
        id: 'asset_item_wallt',
        category: 'fixture',
        name: 'Wall fixture',
        thumbnail: 'https://example.com/item.png',
        src: 'https://example.com/item.glb',
        dimensions: [0.5, 1, 0.1],
        attachTo: 'wall',
      },
    })
    const nodes: Record<AnyNodeId, AnyNode> = {
      [level.id]: LevelNode.parse({ ...level, children: [guide.id, wall.id] }),
      [guide.id]: guide,
      [wall.id]: wall,
      [item.id]: item,
    }

    const plan = buildAxisGuideStretchPlan(nodes, {
      guideId: guide.id,
      side: 1,
      distance: 1,
    })

    expect(plan.updates.find(({ id }) => id === item.id)?.data).toEqual({
      position: [3, 1, 0],
      wallT: 0.75,
    })
  })

  test('rejects a new hosted-opening collision before returning a partial plan', () => {
    const level = LevelNode.parse({ id: 'level_opening_collision', children: [] })
    const guide = ConstructionGuideNode.parse({
      id: 'cguide_opening_collision',
      parentId: level.id,
      origin: [0, 0],
      direction: [0, 1],
    })
    const wall = WallNode.parse({
      id: 'wall_opening_collision',
      parentId: level.id,
      start: [-2, 0],
      end: [2, 0],
    })
    const movingDoor = DoorNode.parse({
      id: 'door_opening_moving',
      parentId: wall.id,
      wallId: wall.id,
      position: [2.3, 1, 0],
      width: 0.2,
      height: 2,
    })
    const fixedDoor = DoorNode.parse({
      id: 'door_opening_fixed',
      parentId: wall.id,
      wallId: wall.id,
      position: [2, 1, 0],
      width: 0.2,
      height: 2,
    })
    const nodes: Record<AnyNodeId, AnyNode> = {
      [level.id]: LevelNode.parse({
        ...level,
        children: [guide.id, wall.id, movingDoor.id, fixedDoor.id],
      }),
      [guide.id]: guide,
      [wall.id]: wall,
      [movingDoor.id]: movingDoor,
      [fixedDoor.id]: fixedDoor,
    }

    expect(() =>
      buildAxisGuideStretchPlan(nodes, { guideId: guide.id, side: 1, distance: -0.2 }),
    ).toThrowError(AxisGuideStretchError)
    try {
      buildAxisGuideStretchPlan(nodes, { guideId: guide.id, side: 1, distance: -0.2 })
    } catch (error) {
      expect(error).toMatchObject({ code: 'attachment-collision' })
    }
    expect(wall.end).toEqual([2, 0])
    expect(movingDoor.position).toEqual([2.3, 1, 0])
  })

  test('updates an existing auto zone from the stretched wall enclosure', () => {
    const level = LevelNode.parse({ id: 'level_auto_zone', children: [] })
    const guide = ConstructionGuideNode.parse({
      id: 'cguide_auto_zone',
      parentId: level.id,
      origin: [0, 0],
      direction: [0, 1],
    })
    const bottom = WallNode.parse({
      id: 'wall_auto_bottom',
      parentId: level.id,
      start: [-2, -2],
      end: [2, -2],
    })
    const right = WallNode.parse({
      id: 'wall_auto_right',
      parentId: level.id,
      start: [2, -2],
      end: [2, 2],
    })
    const top = WallNode.parse({
      id: 'wall_auto_top',
      parentId: level.id,
      start: [2, 2],
      end: [-2, 2],
    })
    const left = WallNode.parse({
      id: 'wall_auto_left',
      parentId: level.id,
      start: [-2, 2],
      end: [-2, -2],
    })
    const zone = ZoneNode.parse({
      id: 'zone_auto_room',
      parentId: level.id,
      name: 'Auto room',
      polygon: [
        [-2, -2],
        [2, -2],
        [2, 2],
        [-2, 2],
      ],
      autoFromWalls: true,
      boundaryWallIds: [bottom.id, right.id, top.id, left.id],
      spaceRole: 'room',
    })
    const walls = [bottom, right, top, left]
    const nodes: Record<AnyNodeId, AnyNode> = {
      [level.id]: LevelNode.parse({
        ...level,
        children: [guide.id, zone.id, ...walls.map((wall) => wall.id)],
      }),
      [guide.id]: guide,
      [zone.id]: zone,
      ...Object.fromEntries(walls.map((wall) => [wall.id, wall])),
    }

    const plan = buildAxisGuideStretchPlan(nodes, {
      guideId: guide.id,
      side: 1,
      distance: 1,
    })

    expect(plan.updates.find(({ id }) => id === zone.id)?.data).toEqual({
      polygon: [
        [-2, -2],
        [3, -2],
        [3, 2],
        [-2, 2],
      ],
    })
  })

  test('rejects a newly created wall contact atomically', () => {
    const level = LevelNode.parse({ id: 'level_new_contact', children: [] })
    const guide = ConstructionGuideNode.parse({
      id: 'cguide_new_contact',
      parentId: level.id,
      origin: [0, 0],
      direction: [0, 1],
    })
    const moving = WallNode.parse({
      id: 'wall_new_contact_moving',
      parentId: level.id,
      start: [1, 0],
      end: [2, 0],
    })
    const fixed = WallNode.parse({
      id: 'wall_new_contact_fixed',
      parentId: level.id,
      start: [-1, -1],
      end: [-1, 0],
    })
    const nodes: Record<AnyNodeId, AnyNode> = {
      [level.id]: LevelNode.parse({ ...level, children: [guide.id, moving.id, fixed.id] }),
      [guide.id]: guide,
      [moving.id]: moving,
      [fixed.id]: fixed,
    }

    expect(() =>
      buildAxisGuideStretchPlan(nodes, { guideId: guide.id, side: 1, distance: -3 }),
    ).toThrowError(AxisGuideStretchError)
    try {
      buildAxisGuideStretchPlan(nodes, { guideId: guide.id, side: 1, distance: -3 })
    } catch (error) {
      expect(error).toMatchObject({ code: 'broken-wall-junction' })
    }
    expect(moving.start).toEqual([1, 0])
    expect(moving.end).toEqual([2, 0])
  })

  test('retains an existing hosted overlap when the stretch does not worsen it', () => {
    const level = LevelNode.parse({ id: 'level_existing_overlap', children: [] })
    const guide = ConstructionGuideNode.parse({
      id: 'cguide_existing_overlap',
      parentId: level.id,
      origin: [0, 0],
      direction: [0, 1],
    })
    const wall = WallNode.parse({
      id: 'wall_existing_overlap',
      parentId: level.id,
      start: [-2, 0],
      end: [2, 0],
    })
    const firstDoor = DoorNode.parse({
      id: 'door_existing_overlap_a',
      parentId: wall.id,
      wallId: wall.id,
      position: [2.2, 1, 0],
      width: 0.6,
      height: 2,
    })
    const secondDoor = DoorNode.parse({
      id: 'door_existing_overlap_b',
      parentId: wall.id,
      wallId: wall.id,
      position: [2.4, 1, 0],
      width: 0.6,
      height: 2,
    })
    const nodes: Record<AnyNodeId, AnyNode> = {
      [level.id]: LevelNode.parse({
        ...level,
        children: [guide.id, wall.id, firstDoor.id, secondDoor.id],
      }),
      [guide.id]: guide,
      [wall.id]: wall,
      [firstDoor.id]: firstDoor,
      [secondDoor.id]: secondDoor,
    }

    const plan = buildAxisGuideStretchPlan(nodes, {
      guideId: guide.id,
      side: 1,
      distance: 1,
    })

    expect(plan.updates.find(({ id }) => id === firstDoor.id)?.data).toEqual({
      position: [3.2, 1, 0],
    })
    expect(plan.updates.find(({ id }) => id === secondDoor.id)?.data).toEqual({
      position: [3.4, 1, 0],
    })
  })

  test('translates a curved wall on the selected side while preserving its curve data', () => {
    const scene = verticalScene()
    const curved = WallNode.parse({
      id: 'wall_curved',
      parentId: scene.guide.parentId,
      start: [1, -4],
      end: [1, -2],
      curveOffset: 0.25,
    })
    const nodes = { ...scene.nodes, [curved.id]: curved }
    const plan = buildAxisGuideStretchPlan(nodes, {
      guideId: scene.guide.id,
      side: 1,
      distance: 1,
    })
    expect(plan.updates.find(({ id }) => id === curved.id)?.data).toEqual({
      start: [2, -4],
      end: [2, -2],
    })
    expect(curved.curveOffset).toBe(0.25)
  })
})

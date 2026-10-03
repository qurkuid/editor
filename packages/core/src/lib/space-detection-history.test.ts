import { expect, test } from 'bun:test'
import { BuildingNode, CeilingNode, LevelNode, SlabNode, WallNode, ZoneNode } from '../schema'
import { clearSceneHistory, default as useScene } from '../store/use-scene'
import { initSpaceDetectionSync } from './space-detection'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

function samePrefixRoomHistoryFixture() {
  const level = LevelNode.parse({ id: 'level_same_prefix_history' })
  const rectangle = (prefix: string, y: number) => {
    const x = -1000
    const width = 4
    const height = 0.2
    const south = WallNode.parse({
      id: `${prefix}_south`,
      parentId: level.id,
      start: [x, y],
      end: [x + width, y],
    })
    const east = WallNode.parse({
      id: `${prefix}_east`,
      parentId: level.id,
      start: [x + width, y],
      end: [x + width, y + height],
    })
    const north = WallNode.parse({
      id: `${prefix}_north`,
      parentId: level.id,
      start: [x + width, y + height],
      end: [x, y + height],
    })
    const west = WallNode.parse({
      id: `${prefix}_west`,
      parentId: level.id,
      start: [x, y + height],
      end: [x, y],
    })
    return { open: [south, east, north], closing: west }
  }

  const first = rectangle('wall_same_prefix_a', 0.1)
  const second = rectangle('wall_same_prefix_b', 0.9)
  return {
    level: LevelNode.parse({
      ...level,
      children: [...first.open, ...second.open].map((wall) => wall.id),
    }),
    openWalls: [...first.open, ...second.open],
    closingWalls: [first.closing, second.closing],
  }
}

test('undo/redo restores zone review metadata without regenerating the restored snapshot', () => {
  const level = LevelNode.parse({ id: 'level_zone_history' })
  const walls = [
    WallNode.parse({ start: [0, 0], end: [4, 0], parentId: level.id }),
    WallNode.parse({ start: [4, 0], end: [4, 3], parentId: level.id }),
    WallNode.parse({ start: [4, 3], end: [0, 3], parentId: level.id }),
    WallNode.parse({ start: [0, 3], end: [0, 0], parentId: level.id }),
  ]
  const zone = ZoneNode.parse({
    name: 'Bedroom',
    parentId: level.id,
    spaceRole: 'room',
    polygon: [
      [0.05, 0.05],
      [3.95, 0.05],
      [3.95, 2.95],
      [0.05, 2.95],
    ],
    metadata: { source: 'apt-vector', sourceRoomId: 'bedroom' },
  })
  const original = Object.fromEntries([level, ...walls, zone].map((node) => [node.id, node]))
  useScene.setState({
    nodes: original,
    rootNodeIds: [level.id],
    collections: {},
    materials: {},
    readOnly: false,
  })
  clearSceneHistory()
  const editorState = {
    spaces: {},
    setSpaces(spaces: object) {
      this.spaces = spaces
    },
  }
  const stop = initSpaceDetectionSync(useScene, { getState: () => editorState })
  try {
    useScene.getState().deleteNode(walls[0]!.id)
    const deleted = useScene.getState().nodes
    expect((deleted[zone.id] as typeof zone).metadata).toEqual({
      ...zone.metadata,
      boundaryNeedsReview: true,
    })
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(original)
    expect(Object.keys(editorState.spaces)).toHaveLength(1)
    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes).toEqual(deleted)
    expect(Object.keys(editorState.spaces)).toHaveLength(0)
  } finally {
    stop()
    clearSceneHistory()
  }
})

test('apt-vector wall closure creates a room zone in the same undo step', () => {
  const level = LevelNode.parse({ id: 'level_apt_closure_history' })
  const walls = [
    WallNode.parse({
      id: 'wall_apt_closure_south',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
      metadata: { source: 'apt-vector' },
    }),
    WallNode.parse({
      id: 'wall_apt_closure_east',
      parentId: level.id,
      start: [4, 0],
      end: [4, 3],
      metadata: { source: 'apt-vector' },
    }),
    WallNode.parse({
      id: 'wall_apt_closure_north',
      parentId: level.id,
      start: [4, 3],
      end: [0, 3],
      metadata: { source: 'apt-vector' },
    }),
  ]
  const closingWall = WallNode.parse({
    id: 'wall_apt_closure_west',
    parentId: level.id,
    start: [0, 3],
    end: [0, 0],
    metadata: { source: 'apt-vector' },
  })
  const original = Object.fromEntries([level, ...walls].map((node) => [node.id, node]))
  useScene.setState({
    nodes: original,
    rootNodeIds: [level.id],
    collections: {},
    materials: {},
    readOnly: false,
  })
  clearSceneHistory()
  const editorState = {
    spaces: {},
    setSpaces(spaces: object) {
      this.spaces = spaces
    },
  }
  const stop = initSpaceDetectionSync(useScene, { getState: () => editorState })
  try {
    useScene.getState().createNode(closingWall, level.id)
    const closed = useScene.getState().nodes
    const generatedZones = Object.values(closed).filter(
      (node: any) =>
        node.type === 'zone' &&
        node.autoFromWalls === true &&
        node.metadata?.generatedFrom === 'detected-space',
    )
    expect(generatedZones).toHaveLength(1)
    expect(Object.keys(editorState.spaces)).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[closingWall.id]).toBeUndefined()
    expect(
      Object.values(useScene.getState().nodes).some(
        (node: any) => node.type === 'zone' && node.metadata?.generatedFrom === 'detected-space',
      ),
    ).toBe(false)

    useScene.temporal.getState().redo()
    expect(useScene.getState().nodes[closingWall.id]).toBeDefined()
    expect(
      Object.values(useScene.getState().nodes).some(
        (node: any) => node.type === 'zone' && node.metadata?.generatedFrom === 'detected-space',
      ),
    ).toBe(true)
  } finally {
    stop()
    clearSceneHistory()
  }
})

test('one history step replaces an obsolete generated room with two closed rooms', () => {
  const { level: baseLevel, openWalls, closingWalls } = samePrefixRoomHistoryFixture()
  const obsoleteZone = ZoneNode.parse({
    id: 'zone_obsolete_history_room',
    parentId: baseLevel.id,
    name: 'Room 2',
    autoFromWalls: true,
    spaceRole: 'room',
    boundaryWallIds: ['wall_obsolete_history'],
    polygon: [
      [-1000, 0.1],
      [-996, 0.1],
      [-996, 1.1],
      [-1000, 1.1],
    ],
    metadata: { source: 'apt-vector', generatedFrom: 'detected-space' },
  })
  const level = LevelNode.parse({
    ...baseLevel,
    children: [...openWalls, obsoleteZone].map((node) => node.id),
  })
  const original = Object.fromEntries(
    [level, ...openWalls, obsoleteZone].map((node) => [node.id, node]),
  )
  useScene.setState({
    nodes: original,
    rootNodeIds: [level.id],
    collections: {},
    materials: {},
    readOnly: false,
  })
  clearSceneHistory()
  const editorState = {
    spaces: {} as Record<string, { id: string }>,
    setSpaces(spaces: Record<string, { id: string }>) {
      this.spaces = spaces
    },
  }
  const stop = initSpaceDetectionSync(useScene, { getState: () => editorState })
  try {
    useScene.getState().createNodes(closingWalls.map((node) => ({ node, parentId: level.id })))
    const closed = useScene.getState().nodes
    const replacements = Object.values(closed).filter(
      (node: any) =>
        node.type === 'zone' &&
        node.id !== obsoleteZone.id &&
        node.metadata?.generatedFrom === 'detected-space',
    )
    expect(Object.keys(editorState.spaces)).toHaveLength(2)
    expect(replacements).toHaveLength(2)
    expect(closed[obsoleteZone.id]).toMatchObject({
      name: obsoleteZone.name,
      polygon: obsoleteZone.polygon,
      enclosureStatus: 'open',
      metadata: {
        source: 'apt-vector',
        generatedFrom: 'detected-space',
        boundaryNeedsReview: true,
      },
    })

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(original)
    expect(Object.keys(editorState.spaces)).toHaveLength(0)

    useScene.temporal.getState().redo()
    const redone = useScene.getState().nodes
    expect(redone[closingWalls[0]!.id]).toBeDefined()
    expect(redone[closingWalls[1]!.id]).toBeDefined()
    expect(
      Object.values(redone).filter(
        (node: any) =>
          node.type === 'zone' &&
          node.id !== obsoleteZone.id &&
          node.metadata?.generatedFrom === 'detected-space',
      ),
    ).toHaveLength(2)
    expect(Object.keys(editorState.spaces)).toHaveLength(2)

    // Re-publishing the restored scene is a hydration baseline and must not
    // create another pair of generated zones.
    useScene.setState({ nodes: { ...redone } })
    expect(
      Object.values(useScene.getState().nodes).filter(
        (node: any) =>
          node.type === 'zone' &&
          node.id !== obsoleteZone.id &&
          node.metadata?.generatedFrom === 'detected-space',
      ),
    ).toHaveLength(2)
  } finally {
    stop()
    clearSceneHistory()
  }
})

test('live space history keeps same-prefix loops through undo and redo', () => {
  const { level, openWalls, closingWalls } = samePrefixRoomHistoryFixture()
  const original = Object.fromEntries([level, ...openWalls].map((node) => [node.id, node]))
  useScene.setState({
    nodes: original,
    rootNodeIds: [level.id],
    collections: {},
    materials: {},
    readOnly: false,
  })
  clearSceneHistory()
  const editorState = {
    spaces: {} as Record<string, { id: string }>,
    setSpaces(spaces: Record<string, { id: string }>) {
      this.spaces = spaces
    },
  }
  const stop = initSpaceDetectionSync(useScene, { getState: () => editorState })
  try {
    useScene.getState().createNode(closingWalls[0]!, level.id)
    useScene.getState().createNode(closingWalls[1]!, level.id)

    expect(Object.keys(editorState.spaces)).toHaveLength(2)
    expect(new Set(Object.values(editorState.spaces).map((space) => space.id)).size).toBe(2)

    useScene.temporal.getState().undo()
    expect(Object.keys(editorState.spaces)).toHaveLength(1)

    useScene.temporal.getState().redo()
    expect(Object.keys(editorState.spaces)).toHaveLength(2)
    expect(new Set(Object.values(editorState.spaces).map((space) => space.id)).size).toBe(2)
  } finally {
    stop()
    clearSceneHistory()
  }
})

test('deleting an auto slab is one history step and never recreates on reload', () => {
  const building = BuildingNode.parse({ id: 'building_auto_slab_history', children: [] })
  const level = LevelNode.parse({
    id: 'level_auto_slab_history',
    level: 0,
    height: 2.5,
    parentId: building.id,
  })
  const walls = [
    WallNode.parse({
      id: 'wall_auto_slab_history_south',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
    }),
    WallNode.parse({
      id: 'wall_auto_slab_history_east',
      parentId: level.id,
      start: [4, 0],
      end: [4, 3],
    }),
    WallNode.parse({
      id: 'wall_auto_slab_history_north',
      parentId: level.id,
      start: [4, 3],
      end: [0, 3],
    }),
    WallNode.parse({
      id: 'wall_auto_slab_history_west',
      parentId: level.id,
      start: [0, 3],
      end: [0, 0],
    }),
  ]
  const autoSlab = SlabNode.parse({
    id: 'slab_auto_slab_history',
    parentId: level.id,
    polygon: [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ],
    autoFromWalls: true,
  })
  const autoCeiling = CeilingNode.parse({
    id: 'ceiling_auto_slab_history',
    parentId: level.id,
    polygon: autoSlab.polygon,
    autoFromWalls: true,
  })
  const finalizedBuilding = BuildingNode.parse({
    ...building,
    children: [level.id],
  })
  const finalizedLevel = LevelNode.parse({
    ...level,
    children: [...walls, autoSlab, autoCeiling].map((node) => node.id),
  })
  const original = Object.fromEntries(
    [finalizedBuilding, finalizedLevel, ...walls, autoSlab, autoCeiling].map((node) => [
      node.id,
      node,
    ]),
  )
  useScene.setState({
    nodes: original,
    rootNodeIds: [finalizedBuilding.id],
    collections: {},
    materials: {},
    readOnly: false,
  })
  clearSceneHistory()
  const editorState = {
    spaces: {},
    setSpaces(spaces: object) {
      this.spaces = spaces
    },
  }
  const stop = initSpaceDetectionSync(useScene, { getState: () => editorState })
  try {
    useScene.getState().deleteNode(autoSlab.id)
    const deleted = useScene.getState().nodes
    expect(deleted[autoSlab.id]).toBeUndefined()
    expect(
      Object.values(deleted).filter(
        (node: any) => node.type === 'slab' && node.parentId === finalizedLevel.id,
      ),
    ).toHaveLength(0)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes).toEqual(original)

    useScene.temporal.getState().redo()
    const redone = useScene.getState().nodes
    expect(redone).toEqual(deleted)
    expect(redone[autoSlab.id]).toBeUndefined()

    // Re-publishing the deleted scene is a hydration baseline; it must not
    // treat the absent derived surface as a wall edit and resurrect it.
    useScene.setState({ nodes: { ...redone } })
    expect(useScene.getState().nodes[autoSlab.id]).toBeUndefined()
  } finally {
    stop()
    clearSceneHistory()
  }
})

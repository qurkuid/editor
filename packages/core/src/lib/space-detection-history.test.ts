import { expect, test } from 'bun:test'
import { LevelNode, WallNode, ZoneNode } from '../schema'
import { clearSceneHistory, default as useScene } from '../store/use-scene'
import { initSpaceDetectionSync } from './space-detection'

globalThis.requestAnimationFrame ??= (callback) => {
  callback(0)
  return 0
}
globalThis.cancelAnimationFrame ??= () => {}

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

import { afterEach, beforeEach, expect, test } from 'bun:test'
import { LevelNode, useScene, WallNode, ZoneNode } from '@pascal-app/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { RelatedZonePanel } from './related-zone-panel'

const LEVEL_ID = 'level_related_zone_panel'
const WALL_ID = 'wall_related_zone_panel'
const ZONE_ID = 'zone_related_zone_panel'
const sceneInitialState = useScene.getInitialState()
const originalScene = {
  nodes: sceneInitialState.nodes,
  rootNodeIds: sceneInitialState.rootNodeIds,
}

function setNodes(
  ...nodes: Array<
    | ReturnType<typeof LevelNode.parse>
    | ReturnType<typeof WallNode.parse>
    | ReturnType<typeof ZoneNode.parse>
  >
) {
  const scene = {
    nodes: Object.fromEntries(nodes.map((node) => [node.id, node])),
    rootNodeIds: [],
  }
  useScene.setState(scene as never)
  Object.assign(useScene.getInitialState(), scene)
}

beforeEach(() => {
  const wall = WallNode.parse({
    id: WALL_ID,
    parentId: LEVEL_ID,
    start: [0, 0],
    end: [2, 0],
  })
  const zone = ZoneNode.parse({
    id: ZONE_ID,
    parentId: LEVEL_ID,
    name: '거실',
    polygon: [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ],
    autoFromWalls: true,
    boundaryWallIds: [WALL_ID],
    roomNumber: '101',
    occupancy: '거실',
  })
  setNodes(LevelNode.parse({ id: LEVEL_ID }), wall, zone)
})

afterEach(() => {
  useScene.setState(originalScene as never)
  Object.assign(useScene.getInitialState(), originalScene)
})

test('renders related zones as accessible native buttons with room details', () => {
  const markup = renderToStaticMarkup(<RelatedZonePanel nodeId={WALL_ID} />)

  expect(markup).toMatch(/<button[^>]*class="w-full rounded-md border[^"]*"[^>]*type="button"/)
  expect(markup).toContain('거실')
  expect(markup).toContain('101')
})

test('omits the related-zone section when no zone is related', () => {
  const wall = useScene.getState().nodes[WALL_ID] as ReturnType<typeof WallNode.parse>
  setNodes(wall)

  const markup = renderToStaticMarkup(<RelatedZonePanel nodeId={WALL_ID} />)

  expect(markup).not.toContain('data-testid="related-zone-list"')
})

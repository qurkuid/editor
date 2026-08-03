import { beforeEach, describe, expect, test } from 'bun:test'
import {
  AnyNode,
  type AnyNodeId,
  type AnyNodeValue,
  BodyNode,
  BuildingNode,
  LevelNode,
  SiteNode,
} from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'
import { useViewer } from '@pascal-app/viewer'
import { applyAiModelingPlan } from './ai-control'

const siteId = 'site_ai_persistence' as AnyNodeId
const buildingId = 'building_ai_persistence' as AnyNodeId

function resetScene(): void {
  const building = BuildingNode.parse({
    id: buildingId,
    parentId: siteId,
    children: [],
  })
  const site = SiteNode.parse({ id: siteId, children: [buildingId] })
  useScene.setState({
    nodes: { [siteId]: site, [buildingId]: building },
    rootNodeIds: [siteId],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    installedPlugins: [],
    readOnly: false,
  })
  useScene.temporal.getState().clear()
  useViewer.getState().resetSelection()
}

describe('AI modeling persistence', () => {
  beforeEach(resetScene)

  test('attaches a parentless rounded frame to the existing hierarchy before reload', () => {
    applyAiModelingPlan({
      message: 'Created one rounded hollow frame wall.',
      patches: [
        {
          op: 'createRoundedRectangularFrameBody',
          id: 'body_ai_persistent_frame',
          origin: [0, 0, 0],
          width: 2,
          height: 2.4,
          depth: 0.1,
          openingWidth: 1,
          openingHeight: 0.8,
          topCornerRadius: 0.2,
        },
      ],
    })

    const savedState = useScene.getState()
    const serialized = JSON.stringify({
      nodes: savedState.nodes,
      rootNodeIds: savedState.rootNodeIds,
    })
    const decoded = JSON.parse(serialized) as {
      nodes: Record<string, unknown>
      rootNodeIds: AnyNodeId[]
    }
    const parsedNodes = Object.fromEntries(
      Object.entries(decoded.nodes).map(([id, node]) => [id, AnyNode.parse(node)]),
    ) as Record<AnyNodeId, AnyNodeValue>

    useScene.getState().setScene(parsedNodes, decoded.rootNodeIds)

    const body = BodyNode.parse(useScene.getState().nodes.body_ai_persistent_frame)
    const level = LevelNode.parse(useScene.getState().nodes[body.parentId as AnyNodeId])
    expect(level.parentId).toBe(buildingId)
    expect(level.children).toContain(body.id)
    expect(BuildingNode.parse(useScene.getState().nodes[buildingId]).children).toContain(level.id)
  })
})

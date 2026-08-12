import { beforeEach, describe, expect, test } from 'bun:test'
import { createRectangleBody, getBodySemanticHash } from '@pascal-app/core'
import {
  executeOffsetBodyFace,
  executePushPullBodyFace,
} from '@pascal-app/core/modeling-operations'
import {
  AnyNode,
  type AnyNodeId,
  type AnyNodeValue,
  BodyNode,
  BuildingNode,
  LevelNode,
  SceneMaterial,
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

  test('preserves an Offset Body and complete scene metadata through JSON reload', () => {
    const material = SceneMaterial.parse({
      id: 'mat_offset_persistence',
      name: 'Offset persistence material',
      material: { preset: 'custom', properties: { color: '#b91c1c', roughness: 0.75 } },
    })
    const plain = executePushPullBodyFace(createRectangleBody({ width: 2, depth: 2 }), {
      faceId: 'face:0',
      distance: 1,
    }).body
    const source = BodyNode.parse({
      ...plain,
      id: 'body_offset_persistence',
      faces: plain.faces.map((face) =>
        face.id === 'face:0'
          ? {
              ...face,
              surface: {
                materialRef: 'scene:mat_offset_persistence',
                uvOrigin: [0.25, 1, 0.75],
                uvU: [2, 0, 0],
                uvV: [0, 0, 3],
              },
            }
          : face,
      ),
    })
    const expected = executeOffsetBodyFace(source, { faceId: 'face:0', distance: -0.2 })
    useScene.getState().setScene({ [source.id]: source }, [source.id])
    useScene.getState().addSceneMaterial(material)
    useScene.temporal.getState().clear()

    applyAiModelingPlan({
      message: 'Inset the selected face by 200 mm.',
      patches: [{ op: 'offsetBodyFace', id: source.id, faceId: 'face:0', distance: -0.2 }],
    })
    const committed = BodyNode.parse(useScene.getState().nodes[source.id])
    expect(getBodySemanticHash(committed)).toBe(getBodySemanticHash(expected.body))
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    const savedState = useScene.getState()
    const serialized = JSON.stringify({
      nodes: savedState.nodes,
      rootNodeIds: savedState.rootNodeIds,
      materials: savedState.materials,
    })
    const decoded = JSON.parse(serialized) as {
      nodes: Record<string, unknown>
      rootNodeIds: AnyNodeId[]
      materials: typeof savedState.materials
    }
    const parsedNodes = Object.fromEntries(
      Object.entries(decoded.nodes).map(([id, node]) => [id, AnyNode.parse(node)]),
    ) as Record<AnyNodeId, AnyNodeValue>

    useScene.getState().setScene(parsedNodes, decoded.rootNodeIds, {
      materials: decoded.materials,
    })

    const reloaded = BodyNode.parse(useScene.getState().nodes[source.id])
    expect(getBodySemanticHash(reloaded)).toBe(getBodySemanticHash(expected.body))
    expect(reloaded.vertices.map(({ id }) => id)).toEqual(
      expected.body.vertices.map(({ id }) => id),
    )
    expect(reloaded.halfEdges.map(({ id }) => id)).toEqual(
      expected.body.halfEdges.map(({ id }) => id),
    )
    expect(reloaded.loops.map(({ id }) => id)).toEqual(expected.body.loops.map(({ id }) => id))
    expect(reloaded.faces.map(({ id }) => id)).toEqual(expected.body.faces.map(({ id }) => id))
    expect(
      JSON.parse(JSON.stringify(reloaded.faces.map(({ id, surface }) => ({ id, surface })))),
    ).toEqual(
      JSON.parse(JSON.stringify(expected.body.faces.map(({ id, surface }) => ({ id, surface })))),
    )
    expect(reloaded.faces.some(({ id }) => id === expected.createdFaceId)).toBe(true)
    expect(reloaded.faces.find(({ id }) => id === expected.createdFaceId)?.surface).toEqual(
      expected.body.faces.find(({ id }) => id === expected.createdFaceId)?.surface,
    )
    expect(useScene.getState().materials[material.id]).toEqual(material)
  })
})

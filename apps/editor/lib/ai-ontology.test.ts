import { describe, expect, test } from 'bun:test'
import { WallNode } from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'
import { useViewer } from '@pascal-app/viewer'
import { buildAiSceneContext } from './ai-control'
import { AiChatRequestSchema, buildAiModelingPrompt } from './ai-provider'

describe('AI ontology context contract', () => {
  test('preserves selected semantic refs and does not carry an ontology graph', () => {
    const request = AiChatRequestSchema.parse({
      messages: [{ role: 'user', content: 'Explain this wall.' }],
      scene: {
        coordinateSystem: { groundPlane: 'XZ', upAxis: 'Y', unit: 'm' },
        nodeCount: 1,
        nodes: {},
        rootNodeIds: [],
        materials: {},
        selection: {
          buildingId: null,
          levelId: null,
          zoneId: null,
          selectedIds: ['wall_1'],
          selectedNodes: [],
          semanticRefs: [
            {
              nodeId: 'wall_1',
              packId: 'pascal-architecture-core',
              classId: 'pascal:architecture/wall',
              version: '1.0.0',
            },
          ],
        },
      },
    })

    const prompt = buildAiModelingPrompt(request)

    expect(prompt).toContain('pascal-architecture-core')
    expect(prompt).toContain('pascal:architecture/wall')
    expect(prompt).toContain('"version":"1.0.0"')
    expect(prompt).not.toContain('ontologyGraph')
  })

  test('builds selected semantic refs from the current node definitions', () => {
    const wall = WallNode.parse({
      id: 'wall_ai_ontology',
      start: [0, 0],
      end: [2, 0],
    })
    try {
      useScene.getState().setScene({ [wall.id]: wall }, [wall.id])
      useViewer.getState().setSelection({ selectedIds: [wall.id] })
      const context = buildAiSceneContext()

      expect(context.selection.semanticRefs).toEqual([
        {
          nodeId: wall.id,
          packId: 'pascal-architecture-core',
          classId: 'pascal:architecture/wall',
          version: '1.0.0',
        },
      ])
    } finally {
      useViewer.getState().resetSelection()
      useScene.getState().unloadScene()
      useScene.temporal.getState().clear()
    }
  })
})

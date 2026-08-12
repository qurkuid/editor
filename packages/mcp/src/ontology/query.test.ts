import '../bridge/node-shims'

import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WallNode, WindowNode } from '@pascal-app/core/schema'
import { SceneBridge } from '../bridge/scene-bridge'
import { createSceneOperations } from '../operations'
import { queryDesignOntology, queryDesignOntologyInputSchema } from './query'

function makeOperations(): {
  bridge: SceneBridge
  operations: ReturnType<typeof createSceneOperations>
} {
  const bridge = new SceneBridge()
  const wall = WallNode.parse({
    id: 'wall_ontology_host',
    start: [0, 0],
    end: [4, 0],
    thickness: 0.2,
  })
  const window = WindowNode.parse({
    id: 'window_ontology_hosted',
    wallId: wall.id,
    parentId: wall.id,
  })
  bridge.setScene({ [wall.id]: wall, [window.id]: window }, [wall.id])
  bridge.clearHistory()
  return { bridge, operations: createSceneOperations({ bridge }) }
}

describe('design ontology queries', () => {
  test('returns Wall class, allowed operations, and evidence within bounds', async () => {
    const { operations } = makeOperations()
    const result = await queryDesignOntology(
      operations,
      queryDesignOntologyInputSchema.parse({ query: 'wall', maxResults: 1, maxNodes: 1 }),
    )

    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(result.results).toHaveLength(1)
    expect(result.results[0]?.id).toBe('pascal:architecture/wall')
    expect(result.results[0]?.allowedOperations).toContain('create_wall')
    expect(result.results[0]?.evidence.length).toBeGreaterThan(0)
    expect(result.results.length).toBeLessThanOrEqual(1)
    expect(result.edges.length).toBeLessThanOrEqual(1)
  })

  test('resolves the actual host Wall for a Window scene node', async () => {
    const { operations } = makeOperations()
    const result = await queryDesignOntology(
      operations,
      queryDesignOntologyInputSchema.parse({ nodeId: 'window_ontology_hosted', maxNodes: 5 }),
    )

    expect(result.status).toBe('available')
    if (result.status !== 'available') return
    expect(result.scene).toEqual({
      requestedNodeId: 'window_ontology_hosted',
      resolvedNodeType: 'window',
      hostWall: { nodeId: 'wall_ontology_host', classId: 'pascal:architecture/wall' },
    })
    expect(result.results[0]?.semanticRef).toEqual({
      packId: 'pascal-architecture-core',
      classId: 'pascal:architecture/window',
      version: '1.0.0',
    })
  })

  test('returns invalid without mutating scene JSON or history', async () => {
    const { bridge, operations } = makeOperations()
    const root = await mkdtemp(join(tmpdir(), 'pascal-invalid-ontology-'))
    try {
      await writeFile(join(root, 'manifest.json'), JSON.stringify({ packId: 'wrong' }))
      const beforeScene = JSON.stringify(bridge.exportJSON())
      const beforeHistory = bridge.getHistory()
      const result = await queryDesignOntology(
        operations,
        queryDesignOntologyInputSchema.parse({ query: 'wall' }),
        root,
      )

      expect(result.status).toBe('invalid')
      expect(JSON.stringify(bridge.exportJSON())).toBe(beforeScene)
      expect(bridge.getHistory()).toEqual(beforeHistory)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('executes all twelve competency-question id/evidence goldens', async () => {
    const { operations } = makeOperations()
    for (let index = 1; index <= 12; index += 1) {
      const questionId = `CQ-${String(index).padStart(2, '0')}`
      const result = await queryDesignOntology(
        operations,
        queryDesignOntologyInputSchema.parse({
          questionId,
          packVersion: '1.0.0',
        }),
      )
      expect(result.status).toBe('available')
      if (result.status !== 'available') continue
      expect(result.competencyQuestion).toMatchObject({ id: questionId, passed: true })
    }
  })

  test('rejects a requested Pack version mismatch before querying', async () => {
    const { operations } = makeOperations()
    const result = await queryDesignOntology(
      operations,
      queryDesignOntologyInputSchema.parse({
        questionId: 'CQ-01',
        packVersion: '9.9.9',
      }),
    )

    expect(result).toEqual({
      status: 'invalid',
      code: 'version',
      message: 'Ontology pack version mismatch',
      details: ['requested 9.9.9', 'available 1.0.0'],
    })
  })
})

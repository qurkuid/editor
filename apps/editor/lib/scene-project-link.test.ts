import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import {
  projectLinkHost,
  readSceneProjectId,
  SCENE_PROJECT_KEY,
  sceneProjectPatch,
} from './scene-project-link'

function scene(...nodes: Array<Record<string, unknown>>): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((n) => [n.id as string, n as unknown as AnyNode]))
}

describe('where the link lives', () => {
  test('the building node holds it when there is one', () => {
    const nodes = scene({ id: 'level_1', type: 'level' }, { id: 'building_1', type: 'building' })
    expect(projectLinkHost(nodes, ['level_1'])?.id).toBe('building_1')
  })

  test('a scene with no building falls back to its first root', () => {
    const nodes = scene({ id: 'level_1', type: 'level' }, { id: 'level_2', type: 'level' })
    expect(projectLinkHost(nodes, ['level_1', 'level_2'])?.id).toBe('level_1')
  })

  test('stale root ids still resolve to a parentless node', () => {
    const nodes = scene({ id: 'level_1', type: 'level' })
    expect(projectLinkHost(nodes, ['level_gone'])?.id).toBe('level_1')
  })

  test('an empty scene has nowhere to put it', () => {
    expect(projectLinkHost({}, [])).toBeNull()
    expect(sceneProjectPatch({}, 'prj_1', [])).toBeNull()
  })
})

describe('reading and writing', () => {
  const nodes = scene({
    id: 'building_1',
    type: 'building',
    metadata: { name: 'keep me', [SCENE_PROJECT_KEY]: 'prj_1' },
  })

  test('reads the linked project', () => {
    expect(readSceneProjectId(nodes)).toBe('prj_1')
  })

  test('an unlinked scene reads as null, not empty string', () => {
    expect(readSceneProjectId(scene({ id: 'building_1', type: 'building' }))).toBeNull()
    expect(
      readSceneProjectId(scene({ id: 'building_1', type: 'building', metadata: {} })),
    ).toBeNull()
  })

  test('writing preserves whatever else is in metadata', () => {
    const patch = sceneProjectPatch(nodes, 'prj_2')
    expect(patch?.nodeId).toBe('building_1')
    expect(patch?.metadata).toEqual({ name: 'keep me', [SCENE_PROJECT_KEY]: 'prj_2' })
  })

  test('clearing removes only the link', () => {
    const patch = sceneProjectPatch(nodes, null)
    expect(patch?.metadata).toEqual({ name: 'keep me' })
  })

  test('a round trip preserves the value', () => {
    const patch = sceneProjectPatch(nodes, 'prj_3')!
    const next = scene({ id: 'building_1', type: 'building', metadata: patch.metadata })
    expect(readSceneProjectId(next)).toBe('prj_3')
  })
})

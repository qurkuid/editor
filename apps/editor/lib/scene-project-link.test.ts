import { describe, expect, test } from 'bun:test'
import type { AnyNode } from '@pascal-app/core'
import type { EstimateItemPayload } from './estimate-submit'
import {
  canonicalSceneEstimateUrl,
  projectLinkHost,
  readSceneEstimateSubmissions,
  readSceneProjectId,
  SCENE_ESTIMATE_SUBMISSIONS_KEY,
  SCENE_PROJECT_KEY,
  type SceneEstimateSubmissionV1,
  sceneEstimateSubmissionPatch,
  sceneProjectPatch,
} from './scene-project-link'

function scene(...nodes: Array<Record<string, unknown>>): Record<string, AnyNode> {
  return Object.fromEntries(nodes.map((n) => [n.id as string, n as unknown as AnyNode]))
}

function item(index: number): EstimateItemPayload {
  return {
    description: `item-${index}`,
    materialId: `material-${index}`,
    quantity: index + 1,
    unitPrice: 1000 + index,
  }
}

function submission(overrides: Partial<SceneEstimateSubmissionV1> = {}): SceneEstimateSubmissionV1 {
  return {
    estimateId: 'estimate-1',
    estimateUrl: 'https://intm.kr/newportal/estimates/estimate-1/edit',
    failedItems: 0,
    itemCount: 1,
    items: [item(1)],
    projectId: 'project-1',
    schemaVersion: 1,
    submittedAt: '2026-10-02T00:00:00.000Z',
    title: 'Kitchen estimate',
    ...overrides,
  }
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

describe('estimate submission history', () => {
  test('preserves the project link and unrelated metadata through a JSON round trip', () => {
    const nodes = scene({
      id: 'building_1',
      type: 'building',
      metadata: { color: 'blue', [SCENE_PROJECT_KEY]: 'project-1' },
    })
    const patch = sceneEstimateSubmissionPatch(nodes, submission())!
    const next = scene({
      id: 'building_1',
      type: 'building',
      metadata: JSON.parse(JSON.stringify(patch.metadata)),
    })

    expect(patch.metadata).toMatchObject({ color: 'blue', [SCENE_PROJECT_KEY]: 'project-1' })
    expect(readSceneEstimateSubmissions(next)).toEqual([submission()])
    expect(readSceneProjectId(next)).toBe('project-1')
  })

  test('keeps full, partial, and all-failed attempted item snapshots', () => {
    let nodes = scene({ id: 'building_1', type: 'building' })
    const results = [
      submission({ estimateId: 'full', title: 'Full', itemCount: 2, items: [item(1), item(2)] }),
      submission({
        estimateId: 'partial',
        title: 'Partial',
        itemCount: 1,
        failedItems: 1,
        items: [item(3), item(4)],
      }),
      submission({
        estimateId: 'all-failed',
        title: 'All failed',
        itemCount: 0,
        failedItems: 2,
        items: [item(5), item(6)],
      }),
    ]

    for (const result of results) {
      const patch = sceneEstimateSubmissionPatch(nodes, result)!
      nodes = scene({ id: 'building_1', type: 'building', metadata: patch.metadata })
    }

    expect(readSceneEstimateSubmissions(nodes)).toEqual([...results].reverse())
  })

  test('filters by project and de-duplicates before capping at ten newest records', () => {
    let nodes = scene({ id: 'building_1', type: 'building' })
    for (let index = 0; index < 12; index += 1) {
      const patch = sceneEstimateSubmissionPatch(
        nodes,
        submission({
          estimateId: `estimate-${index}`,
          submittedAt: `2026-10-02T00:${String(index).padStart(2, '0')}:00.000Z`,
        }),
      )!
      nodes = scene({ id: 'building_1', type: 'building', metadata: patch.metadata })
    }

    const capped = readSceneEstimateSubmissions(nodes)
    expect(capped).toHaveLength(10)
    expect(capped.map((record) => record.estimateId)).toEqual(
      Array.from({ length: 10 }, (_, index) => `estimate-${11 - index}`),
    )

    const directlyStored = scene({
      id: 'building_1',
      type: 'building',
      metadata: {
        [SCENE_ESTIMATE_SUBMISSIONS_KEY]: Array.from({ length: 12 }, (_, index) =>
          submission({ estimateId: `direct-${index}` }),
        ),
      },
    })
    expect(readSceneEstimateSubmissions(directlyStored)).toHaveLength(10)

    const replacement = submission({ estimateId: 'estimate-5', title: 'Updated title' })
    const replacementPatch = sceneEstimateSubmissionPatch(nodes, replacement)!
    const replaced = readSceneEstimateSubmissions(
      scene({ id: 'building_1', type: 'building', metadata: replacementPatch.metadata }),
    )
    expect(replaced[0]).toEqual(replacement)
    expect(replaced.filter((record) => record.estimateId === 'estimate-5')).toHaveLength(1)

    const projectFiltered = replaced.filter((record) => record.projectId === 'project-1')
    expect(projectFiltered.every((record) => record.projectId === 'project-1')).toBe(true)
    expect(replaced.filter((record) => record.projectId === 'other-project')).toHaveLength(0)
  })

  test('drops malformed history records without throwing', () => {
    const valid = submission()
    const nodes = scene({
      id: 'building_1',
      type: 'building',
      metadata: {
        [SCENE_ESTIMATE_SUBMISSIONS_KEY]: [
          valid,
          { ...valid, schemaVersion: 2 },
          { ...valid, submittedAt: 'yesterday' },
          { ...valid, itemCount: 2 },
          { ...valid, items: [{ description: '', quantity: 1, unitPrice: 100 }] },
          null,
        ],
      },
    })

    expect(readSceneEstimateSubmissions(nodes)).toEqual([valid])
  })

  test('does not append a pre-document failure result', () => {
    const nodes = scene({ id: 'building_1', type: 'building' })
    const failedResult = { error: 'INTM refused the document', ok: false }
    expect(
      sceneEstimateSubmissionPatch(nodes, failedResult as unknown as SceneEstimateSubmissionV1),
    ).toBeNull()
    expect(readSceneEstimateSubmissions(nodes)).toEqual([])
  })

  test('only trusts canonical server-origin estimate links', () => {
    const valid = submission()
    expect(canonicalSceneEstimateUrl('https://intm.kr', valid)).toBe(valid.estimateUrl)
    expect(canonicalSceneEstimateUrl('https://apt.intm.kr/editor', valid)).toBeNull()
    expect(canonicalSceneEstimateUrl('https://intm.kr/anything?x=1#hash', valid)).toBeNull()
    expect(canonicalSceneEstimateUrl('https://user:pass@intm.kr', valid)).toBeNull()
    expect(canonicalSceneEstimateUrl('ftp://intm.kr', valid)).toBeNull()
    expect(canonicalSceneEstimateUrl('not a url', valid)).toBeNull()

    for (const estimateUrl of [
      'https://evil.example/newportal/estimates/estimate-1/edit',
      'https://user:pass@intm.kr/newportal/estimates/estimate-1/edit',
      'https://intm.kr/newportal/estimates/estimate-1/edit?x=1',
      'https://intm.kr/newportal/estimates/estimate-1/edit#hash',
      'https://intm.kr/newportal/estimates/other/edit',
      'https://intm.kr/estimates/estimate-1/edit',
    ]) {
      expect(canonicalSceneEstimateUrl('https://intm.kr', { ...valid, estimateUrl })).toBeNull()
    }
  })
})

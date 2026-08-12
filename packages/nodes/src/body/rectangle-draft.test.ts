import { describe, expect, test } from 'bun:test'
import {
  createRectangleBody,
  getBodyLoopVertices,
  imprintBodyFace,
  pushPullBodyFace,
} from '@pascal-app/core'
import { bodyDefinition } from './definition'
import {
  isBodyFaceImprintEligible,
  isBodyFaceSplitEligible,
  resolveFaceDraftPolygon,
} from './face-imprint-geometry'
import { useBodyToolOptions } from './options'
import { resolveRegularPolygonDraft } from './primitive-draft'
import { resolveRectangleDraft } from './rectangle-draft'
import { bodyToolUses3DInteraction } from './tool'

test('body definition loads the selection affordance', async () => {
  const selection = bodyDefinition.affordanceTools?.selection
  expect(typeof selection).toBe('function')
  if (typeof selection !== 'function') throw new Error('Expected selection affordance')
  const module = await selection()
  expect(typeof module.default).toBe('function')
})

describe('resolveRectangleDraft', () => {
  test('uses cursor side and exact depth to form a rotated rectangle', () => {
    expect(resolveRectangleDraft([0, 0], [1, 1], [0, 2], 0.5)).toEqual([
      [0, 0],
      [1, 1],
      [0.6464466094067263, 1.3535533905932737],
      [-0.35355339059327373, 0.35355339059327373],
    ])
  })

  test('returns null for a zero-length first edge', () => {
    expect(resolveRectangleDraft([1, 1], [1, 1], [2, 2], 1)).toBeNull()
  })
})

test('resolves a three-click Arc face from committed points without hover state', () => {
  const draft = resolveFaceDraftPolygon(
    'arc',
    [
      [0, 0],
      [1, 1],
      [2, 0],
    ],
    null,
    null,
  )
  expect(draft).not.toBeNull()
  expect(draft).toHaveLength(33)
  expect(draft?.[0]).toEqual([0, 0])
  expect(draft?.at(-1)).toEqual([2, 0])
})

test('resolves a two-click Polygon face draft with the typed radius', () => {
  const draft = resolveFaceDraftPolygon('polygon', [[0, 0]], [2, 0], 1, undefined, 5)
  expect(draft).toHaveLength(5)
  expect(draft?.[0]).toEqual([1, 0])
})

describe('body tool view ownership', () => {
  test('releases the hidden 3D input owner in 2D-only mode', () => {
    expect(bodyToolUses3DInteraction('3d')).toBe(true)
    expect(bodyToolUses3DInteraction('split')).toBe(true)
    expect(bodyToolUses3DInteraction('2d')).toBe(false)
  })
})

test('clears only the matching face draft when its tool instance is released', () => {
  const first = { bodyId: 'body:first', faceId: 'face:first' }
  const replacement = { bodyId: 'body:replacement', faceId: 'face:replacement' }
  useBodyToolOptions.getState().setFaceDraft(first)
  useBodyToolOptions.getState().clearFaceDraftIfMatches(first)
  expect(useBodyToolOptions.getState().faceDraft).toBeNull()

  useBodyToolOptions.getState().setFaceDraft(replacement)
  useBodyToolOptions.getState().clearFaceDraftIfMatches(first)
  expect(useBodyToolOptions.getState().faceDraft).toEqual(replacement)
  useBodyToolOptions.getState().setFaceDraft(null)
})

test('keeps Body actions inert until a face is armed for Push/Pull', () => {
  const options = useBodyToolOptions.getState()
  expect(options.selectionAction).toBeNull()

  options.setSelectionAction({ bodyId: 'body:0', kind: 'push-pull', faceId: null })
  expect(useBodyToolOptions.getState().selectionAction).toEqual({
    bodyId: 'body:0',
    kind: 'push-pull',
    faceId: null,
  })

  options.setSelectionAction({ bodyId: 'body:0', kind: 'push-pull', faceId: 'face:0' })
  expect(useBodyToolOptions.getState().selectionAction).toEqual({
    bodyId: 'body:0',
    kind: 'push-pull',
    faceId: 'face:0',
  })

  options.setSelectionAction(null)
  expect(useBodyToolOptions.getState().selectionAction).toBeNull()
})

test('limits face imprint to line-edged faces on closed Bodies', () => {
  const open = createRectangleBody({ width: 2, depth: 2 })
  const closed = pushPullBodyFace(open, 'face:0', 1).body

  expect(isBodyFaceImprintEligible(open, 'face:0')).toBe(false)
  expect(isBodyFaceImprintEligible(closed, 'face:0')).toBe(true)
})

test('arms open line splits for planar faces while keeping imprint eligibility closed-only', () => {
  const open = createRectangleBody({ width: 2, depth: 2 })
  const closed = pushPullBodyFace(open, 'face:0', 1).body
  expect(isBodyFaceSplitEligible(open, 'face:0')).toBe(true)
  expect(isBodyFaceSplitEligible(closed, 'face:0')).toBe(true)
})

test('hands a face rectangle draft to existing Push/Pull for boss and recess', () => {
  const source = pushPullBodyFace(createRectangleBody({ width: 2, depth: 2 }), 'face:0', 1).body
  const draft = resolveRectangleDraft([0.5, 0.5], [1.5, 0.5], [1.5, 1.5], null)
  if (!draft) throw new Error('Expected rectangle draft')
  const profile = draft.map(([x, z]): [number, number, number] => [x, 1, z])
  const inset = imprintBodyFace(source, 'face:0', profile)

  const boss = pushPullBodyFace(inset.body, inset.insetFaceId, 0.25)
  expect(
    getBodyLoopVertices(boss.body, `${inset.insetFaceId}:outer:2`).every(
      (point) => Math.abs(point[1] - 1.25) < 1e-9,
    ),
  ).toBe(true)

  const recess = pushPullBodyFace(inset.body, inset.insetFaceId, -0.25)
  expect(
    getBodyLoopVertices(recess.body, `${inset.insetFaceId}:outer:2`).every(
      (point) => Math.abs(point[1] - 0.75) < 1e-9,
    ),
  ).toBe(true)
})

test('hands a regular Polygon profile to existing imprint and Push/Pull', () => {
  const source = pushPullBodyFace(createRectangleBody({ width: 2, depth: 2 }), 'face:0', 1).body
  const draft = resolveRegularPolygonDraft([0.5, 0.5], [0.75, 0.5], null, 5)
  if (!draft) throw new Error('Expected Polygon draft')
  const profile = draft.map(([x, z]): [number, number, number] => [x, 1, z])
  const inset = imprintBodyFace(source, 'face:0', profile)
  expect(inset.body.faces.some((face) => face.id === inset.insetFaceId)).toBe(true)

  const boss = pushPullBodyFace(inset.body, inset.insetFaceId, 0.25)
  expect(
    getBodyLoopVertices(boss.body, `${inset.insetFaceId}:outer:2`).every(
      (point) => Math.abs(point[1] - 1.25) < 1e-9,
    ),
  ).toBe(true)
})

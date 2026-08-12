import { createRectangleBody } from '@pascal-app/core'
import {
  executeImprintBodyFace,
  executeOffsetBodyFace,
  executePushPullBodyFace,
} from '@pascal-app/core/modeling-operations'
import { BodyNode, type BodyNode as BodyNodeType } from '@pascal-app/core/schema'

export type OffsetFixture = {
  readonly body: BodyNodeType
  readonly faceId: string
  readonly distance: number
}

export function makeOffsetSolid(id: string): BodyNodeType {
  return BodyNode.parse({
    ...executePushPullBodyFace(createRectangleBody({ width: 2, depth: 2 }), {
      faceId: 'face:0',
      distance: 1,
    }).body,
    id,
  })
}

export function makeNestedOffsetSource(id: string): OffsetFixture {
  const inward = executeOffsetBodyFace(makeOffsetSolid(id), {
    faceId: 'face:0',
    distance: -0.4,
  })
  return { body: inward.body, faceId: inward.createdFaceId, distance: 0.1 }
}

function makeCurvedOffsetSource(id: string): BodyNodeType {
  const source = makeOffsetSolid(id)
  const target = source.halfEdges.find((edge) => edge.loopId === 'loop:0')
  if (!target) throw new Error('Offset fixture omitted the target edge')
  return BodyNode.parse({
    ...source,
    curves: [
      {
        id: 'curve:offset-arc',
        kind: 'circular-arc',
        center: [0, 1, 0],
        normal: [0, 1, 0],
        radius: 1,
        startAngle: 0,
        endAngle: Math.PI,
      },
    ],
    halfEdges: source.halfEdges.map((edge) =>
      edge.id === target.id ? { ...edge, curveId: 'curve:offset-arc' } : edge,
    ),
  })
}

function makeConcaveOffsetSource(id: string): OffsetFixture {
  const source = makeOffsetSolid(id)
  const imprint = executeImprintBodyFace(source, {
    faceId: 'face:0',
    profilePoints: [
      [0.3, 1, 0.3],
      [1.7, 1, 0.3],
      [1.7, 1, 0.8],
      [1.1, 1, 0.8],
      [1.1, 1, 1.7],
      [0.3, 1, 1.7],
    ],
  })
  return { body: imprint.body, faceId: imprint.insetFaceId, distance: -0.25 }
}

export function invalidOffsetFixtures(id: string): readonly OffsetFixture[] {
  const solid = makeOffsetSolid(id)
  const nested = makeNestedOffsetSource(id)
  const concave = makeConcaveOffsetSource(id)
  return [
    { body: nested.body, faceId: 'face:0', distance: -0.1 },
    { body: solid, faceId: 'face:0', distance: 0.1 },
    { body: makeCurvedOffsetSource(id), faceId: 'face:0', distance: -0.1 },
    { body: solid, faceId: 'face:0', distance: -1 },
    concave,
    { body: solid, faceId: 'face:0', distance: 0 },
  ]
}

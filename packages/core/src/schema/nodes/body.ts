import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

const FeatureId = z.string().trim().min(1)
const Point3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])

export const BodyVertex = z.object({
  id: FeatureId,
  position: Point3,
})

export const BodyHalfEdge = z.object({
  id: FeatureId,
  vertexId: FeatureId,
  twinId: FeatureId.nullable().default(null),
  nextId: FeatureId,
  loopId: FeatureId,
  curveId: FeatureId.optional(),
})

export const BodyLoop = z.object({
  id: FeatureId,
  faceId: FeatureId,
  kind: z.enum(['outer', 'inner']),
})

export const BodyFaceSurface = z.object({
  materialRef: z.string().optional(),
  uvOrigin: Point3.default([0, 0, 0]),
  uvU: Point3.default([1, 0, 0]),
  uvV: Point3.default([0, 0, 1]),
})

export const BodyFace = z.object({
  id: FeatureId,
  outerLoopId: FeatureId,
  innerLoopIds: z.array(FeatureId).default([]),
  surface: BodyFaceSurface.default({
    uvOrigin: [0, 0, 0],
    uvU: [1, 0, 0],
    uvV: [0, 0, 1],
  }),
})

export const BodyShell = z.object({
  id: FeatureId,
  faceIds: z.array(FeatureId),
})

const BodyLineCurve = z.object({
  id: FeatureId,
  kind: z.literal('line'),
})

const BodyCircularArcCurve = z.object({
  id: FeatureId,
  kind: z.literal('circular-arc'),
  center: Point3,
  normal: Point3,
  radius: z.number().finite().positive(),
  startAngle: z.number().finite(),
  endAngle: z.number().finite(),
})

export const BodyCurve = z.discriminatedUnion('kind', [BodyLineCurve, BodyCircularArcCurve])

export const BodyNode = BaseNode.extend({
  id: objectId('body'),
  type: nodeType('body'),
  revision: z.number().int().nonnegative().default(0),
  shells: z.array(BodyShell),
  vertices: z.array(BodyVertex),
  halfEdges: z.array(BodyHalfEdge),
  loops: z.array(BodyLoop),
  faces: z.array(BodyFace),
  curves: z.array(BodyCurve).default([]),
  bodyDefaults: z
    .object({
      materialRef: z.string().optional(),
    })
    .default({}),
}).describe('Direct-modeling body with persistent half-edge topology')

export type BodyNode = z.infer<typeof BodyNode>
export type BodyVertex = z.infer<typeof BodyVertex>
export type BodyHalfEdge = z.infer<typeof BodyHalfEdge>
export type BodyLoop = z.infer<typeof BodyLoop>
export type BodyFace = z.infer<typeof BodyFace>
export type BodyShell = z.infer<typeof BodyShell>
export type BodyCurve = z.infer<typeof BodyCurve>

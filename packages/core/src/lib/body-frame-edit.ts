import { z } from 'zod'
import { BodyNode, type BodyNode as BodyNodeType } from '../schema/nodes/body'
import { createRoundedRectangularFrameBody } from './body-frame'
import {
  assertRoundedFrameOpeningPlacement,
  calculateRoundedFrameOpeningPlacement,
  RoundedFrameOpeningBoundsError,
  type RoundedFrameOpeningPlacement,
} from './body-frame-opening'

export type { RoundedFrameOpeningPlacement }
export { RoundedFrameOpeningBoundsError }

const roundedFrameMetadata = z.object({
  primitive: z.literal('rounded-rectangular-frame'),
  width: z.number().finite().positive(),
  height: z.number().finite().positive(),
  depth: z.number().finite().positive(),
  openingWidth: z.number().finite().positive(),
  openingHeight: z.number().finite().positive(),
  openingOffsetX: z.number().finite().nonnegative(),
  openingOffsetY: z.number().finite().nonnegative(),
  topCornerRadius: z.number().finite().nonnegative(),
  arcSegments: z.number().int().min(2),
})

type Point3 = [number, number, number]

export type RoundedRectangularFrameParameters = z.infer<typeof roundedFrameMetadata> & {
  origin: Point3
  basisX: Point3
  basisY: Point3
  basisZ: Point3
}

function basisBetween(from: Point3, to: Point3, length: number): Point3 {
  return [(to[0] - from[0]) / length, (to[1] - from[1]) / length, (to[2] - from[2]) / length]
}

function worldPoint(point: Point3, parameters: RoundedRectangularFrameParameters): Point3 {
  const [x, y, z] = point
  return [
    parameters.origin[0] +
      parameters.basisX[0] * x +
      parameters.basisY[0] * y +
      parameters.basisZ[0] * z,
    parameters.origin[1] +
      parameters.basisX[1] * x +
      parameters.basisY[1] * y +
      parameters.basisZ[1] * z,
    parameters.origin[2] +
      parameters.basisX[2] * x +
      parameters.basisY[2] * y +
      parameters.basisZ[2] * z,
  ]
}

export function getRoundedRectangularFrameParameters(
  body: BodyNodeType,
): RoundedRectangularFrameParameters | null {
  const metadata = roundedFrameMetadata.safeParse(body.metadata)
  const origin = body.vertices.find((vertex) => vertex.id === 'vertex:front:outer:0')?.position
  const innerOrigin = body.vertices.find((vertex) => vertex.id === 'vertex:front:inner:0')?.position
  const innerX = body.vertices.find((vertex) => vertex.id === 'vertex:front:inner:1')?.position
  const innerY = body.vertices.find((vertex) => vertex.id === 'vertex:front:inner:3')?.position
  const innerZ = body.vertices.find((vertex) => vertex.id === 'vertex:back:inner:0')?.position
  if (!metadata.success || !origin || !innerOrigin || !innerX || !innerY || !innerZ) return null
  return {
    ...metadata.data,
    origin,
    basisX: basisBetween(innerOrigin, innerX, metadata.data.openingWidth),
    basisY: basisBetween(innerOrigin, innerY, metadata.data.openingHeight),
    basisZ: basisBetween(innerOrigin, innerZ, metadata.data.depth),
  }
}

export function updateRoundedRectangularFrameRadius(
  body: BodyNodeType,
  topCornerRadius: number,
): BodyNodeType {
  const parameters = getRoundedRectangularFrameParameters(body)
  if (!parameters) throw new TypeError('Body is not a rounded rectangular frame')
  const centeredX = (parameters.width - parameters.openingWidth) / 2
  const centeredY = (parameters.height - parameters.openingHeight) / 2
  assertRoundedFrameOpeningPlacement(
    { ...parameters, topCornerRadius },
    parameters.openingOffsetX - centeredX,
    parameters.openingOffsetY - centeredY,
  )

  return rebuildRoundedRectangularFrame(body, parameters, {
    topCornerRadius,
    openingOffsetX: parameters.openingOffsetX,
    openingOffsetY: parameters.openingOffsetY,
    preserveOuterVertices: false,
  })
}

export function updateRoundedRectangularFrameOpening(
  body: BodyNodeType,
  position: { readonly centerOffsetX: number; readonly centerOffsetY: number },
): BodyNodeType {
  const parameters = getRoundedRectangularFrameParameters(body)
  if (!parameters) throw new TypeError('Body is not a rounded rectangular frame')
  assertRoundedFrameOpeningPlacement(parameters, position.centerOffsetX, position.centerOffsetY)
  return rebuildRoundedRectangularFrame(body, parameters, {
    topCornerRadius: parameters.topCornerRadius,
    openingOffsetX: (parameters.width - parameters.openingWidth) / 2 + position.centerOffsetX,
    openingOffsetY: (parameters.height - parameters.openingHeight) / 2 + position.centerOffsetY,
    preserveOuterVertices: true,
  })
}

export function getRoundedRectangularFrameOpeningPlacement(
  body: BodyNodeType,
): RoundedFrameOpeningPlacement | null {
  const parameters = getRoundedRectangularFrameParameters(body)
  return parameters ? calculateRoundedFrameOpeningPlacement(parameters) : null
}

function rebuildRoundedRectangularFrame(
  body: BodyNodeType,
  parameters: RoundedRectangularFrameParameters,
  values: {
    readonly topCornerRadius: number
    readonly openingOffsetX: number
    readonly openingOffsetY: number
    readonly preserveOuterVertices: boolean
  },
): BodyNodeType {
  const rebuilt = createRoundedRectangularFrameBody({
    width: parameters.width,
    height: parameters.height,
    depth: parameters.depth,
    openingWidth: parameters.openingWidth,
    openingHeight: parameters.openingHeight,
    arcSegments: parameters.arcSegments,
    topCornerRadius: values.topCornerRadius,
    id: body.id,
    name: body.name,
  })
  const previousVertices = new Map(body.vertices.map((vertex) => [vertex.id, vertex]))
  const previousFaces = new Map(body.faces.map((face) => [face.id, face]))
  const existingMetadata =
    body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata
      : {}
  const rebuiltMetadata =
    rebuilt.metadata && typeof rebuilt.metadata === 'object' && !Array.isArray(rebuilt.metadata)
      ? rebuilt.metadata
      : {}

  const centerOffsetX = (parameters.width - parameters.openingWidth) / 2
  const centerOffsetY = (parameters.height - parameters.openingHeight) / 2
  return BodyNode.parse({
    ...body,
    ...rebuilt,
    id: body.id,
    name: body.name,
    parentId: body.parentId,
    visible: body.visible,
    revision: body.revision + 1,
    bodyDefaults: body.bodyDefaults,
    metadata: {
      ...existingMetadata,
      ...rebuiltMetadata,
      openingOffsetX: values.openingOffsetX,
      openingOffsetY: values.openingOffsetY,
    },
    vertices: rebuilt.vertices.map((vertex) => {
      const [x, y, z] = vertex.position
      const localPoint: Point3 = vertex.id.includes(':inner:')
        ? [x + values.openingOffsetX - centerOffsetX, y + values.openingOffsetY - centerOffsetY, z]
        : [x, y, z]
      return {
        ...vertex,
        position:
          values.preserveOuterVertices && vertex.id.includes(':outer:')
            ? (previousVertices.get(vertex.id)?.position ?? worldPoint(localPoint, parameters))
            : worldPoint(localPoint, parameters),
      }
    }),
    faces: rebuilt.faces.map((face) => ({
      ...face,
      surface: previousFaces.get(face.id)?.surface ?? face.surface,
    })),
  })
}

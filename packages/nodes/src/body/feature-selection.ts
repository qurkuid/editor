import type { BodyNode } from '@pascal-app/core'
import type { BodyFeatureSelection } from './options'

export function resolveBodyFeatureSelection(
  body: BodyNode,
  featureId: string,
): BodyFeatureSelection | null {
  if (body.vertices.some(({ id }) => id === featureId)) {
    return { bodyId: body.id, kind: 'vertex', featureId }
  }
  const edgeId = featureId.endsWith(':midpoint')
    ? featureId.slice(0, -':midpoint'.length)
    : featureId
  if (body.halfEdges.some(({ id }) => id === edgeId)) {
    return { bodyId: body.id, kind: 'edge', featureId: edgeId }
  }
  const faceId = featureId.endsWith(':center') ? featureId.slice(0, -':center'.length) : featureId
  return body.faces.some(({ id }) => id === faceId)
    ? { bodyId: body.id, kind: 'face', featureId: faceId }
    : null
}

export function isBodyFeatureSelectionValid(
  body: BodyNode,
  selection: BodyFeatureSelection | null,
): boolean {
  if (!selection || selection.bodyId !== body.id) return false
  switch (selection.kind) {
    case 'vertex':
      return body.vertices.some(({ id }) => id === selection.featureId)
    case 'edge':
      return body.halfEdges.some(({ id }) => id === selection.featureId)
    case 'face':
      return body.faces.some(({ id }) => id === selection.featureId)
  }
}

export type BodyDraftPoint = [number, number]

const MIN_EDGE_LENGTH = 0.001

export function resolveRectangleDraft(
  start: BodyDraftPoint,
  edgeEnd: BodyDraftPoint,
  cursor: BodyDraftPoint,
  exactDepth: number | null,
): [BodyDraftPoint, BodyDraftPoint, BodyDraftPoint, BodyDraftPoint] | null {
  const dx = edgeEnd[0] - start[0]
  const dz = edgeEnd[1] - start[1]
  const edgeLength = Math.hypot(dx, dz)
  if (edgeLength < MIN_EDGE_LENGTH) return null
  const normal: BodyDraftPoint = [-dz / edgeLength, dx / edgeLength]
  const cursorDepth = (cursor[0] - edgeEnd[0]) * normal[0] + (cursor[1] - edgeEnd[1]) * normal[1]
  const depth = exactDepth === null ? cursorDepth : (cursorDepth < 0 ? -1 : 1) * exactDepth
  if (Math.abs(depth) < MIN_EDGE_LENGTH) return null
  const offset: BodyDraftPoint = [normal[0] * depth, normal[1] * depth]
  return [
    start,
    edgeEnd,
    [edgeEnd[0] + offset[0], edgeEnd[1] + offset[1]],
    [start[0] + offset[0], start[1] + offset[1]],
  ]
}

export function resolvePushPullDistance(
  cursorDistance: number,
  typedLength: number | null,
): number {
  if (typedLength === null) return cursorDistance
  return (cursorDistance < 0 ? -1 : 1) * typedLength
}

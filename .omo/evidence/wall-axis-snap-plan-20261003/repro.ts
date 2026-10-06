import { inferWallDirection } from '../../../packages/editor/src/lib/wall-direction-lock'
import { resolveWallEndpointPoint } from '../../../packages/editor/src/components/tools/wall/wall-drafting'

const tilted = inferWallDirection([0, 0], [4, 0.05], 0.001, [
  { start: [0, 0], end: [4, 0.06] },
])
const cardinal = inferWallDirection([0, 0], [4, 0.05], 0.001)
const lCorner = resolveWallEndpointPoint({
  start: [0, 0], point: [4.04, 0.03], walls: [], inferDirection: true,
  step: 0.001, magnetic: false, guides: [],
  junctionReference: { sharedPoint: [4.04, 0.03], oppositeEndpoints: [[4, 3]] },
})
console.log(JSON.stringify({
  tiltedReference: { actual: tilted, isExactHorizontal: tilted?.[1] === 0 },
  cardinalControl: { actual: cardinal, isExactHorizontal: cardinal?.[1] === 0 },
  lCorner: { actual: lCorner.point, expected: [4, 0], bothAxesExact: lCorner.point[0] === 4 && lCorner.point[1] === 0 },
}, null, 2))
if (!tilted || tilted[1] === 0 || cardinal?.[1] !== 0 || lCorner.point[0] === 4) {
  throw new Error('Inspected baseline no longer reproduces the planning assumptions')
}

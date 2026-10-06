import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three'

const EPSILON = 1e-6
type Corner = { point: Vector3; weights: number[] }

export function conformWallGeometry(source: BufferGeometry): BufferGeometry {
  const position = source.getAttribute('position')
  if (!position || Object.keys(source.morphAttributes).length > 0) return source

  const unique: Vector3[] = []
  let changed = false
  // ponytail: quadratic within one wall; use spatial buckets if complex walls make export slow.
  const points = Array.from({ length: position.count }, (_, index) => {
    const point = new Vector3().fromBufferAttribute(position, index)
    const match = unique.find((other) => other.distanceToSquared(point) <= EPSILON ** 2)
    if (match) {
      if (!match.equals(point)) changed = true
      return match
    }
    unique.push(point)
    return point
  })
  const attributes = Object.entries(source.attributes).map(([name, attribute]) => ({
    name,
    attribute,
    values: [] as number[],
  }))
  const result = new BufferGeometry()
  let count = 0
  const writeCorner = (corner: Corner, indices: number[]) => {
    for (const { name, attribute, values } of attributes) {
      for (let component = 0; component < attribute.itemSize; component++) {
        values.push(
          name === 'position'
            ? corner.point.getComponent(component)
            : indices.reduce(
                (sum, index, i) =>
                  sum + attribute.getComponent(index, component) * corner.weights[i]!,
                0,
              ),
        )
      }
    }
    count++
  }
  const writeTriangle = (corners: Corner[], indices: number[], material: number) => {
    const previous = result.groups.at(-1)
    if (previous?.materialIndex === material) previous.count += 3
    else result.addGroup(count, 3, material)
    for (const corner of corners) writeCorner(corner, indices)
  }
  const vertexCount = source.index?.count ?? position.count
  const groups = source.groups.length
    ? source.groups
    : [{ start: 0, count: vertexCount, materialIndex: 0 }]
  for (const group of groups) {
    const start = Math.max(group.start, source.drawRange.start)
    const end = Math.min(
      group.start + group.count,
      source.drawRange.start + source.drawRange.count,
      vertexCount,
    )
    for (let offset = start; offset + 2 < end; offset += 3) {
      const indices = [0, 1, 2].map((i) => source.index?.getX(offset + i) ?? offset + i)
      const triangle = indices.map((index) => points[index]!)
      const ab = triangle[1]!.clone().sub(triangle[0]!)
      const ac = triangle[2]!.clone().sub(triangle[0]!)
      const maxEdgeSq = Math.max(
        ab.lengthSq(),
        ac.lengthSq(),
        triangle[1]!.distanceToSquared(triangle[2]!),
      )
      if (ab.clone().cross(ac).lengthSq() <= EPSILON ** 2 * maxEdgeSq) {
        changed = true
        continue
      }
      const boundary: Corner[] = []
      for (let edge = 0; edge < 3; edge++) {
        const next = (edge + 1) % 3
        const a = triangle[edge]!
        const b = triangle[next]!
        const direction = b.clone().sub(a)
        const lengthSq = direction.lengthSq()
        boundary.push({ point: a, weights: [0, 1, 2].map((i) => (i === edge ? 1 : 0)) })
        const splits: { point: Vector3; t: number }[] = []
        for (const point of unique) {
          if (point === a || point === b) continue
          const t = point.clone().sub(a).dot(direction) / lengthSq
          if (t <= 0 || t >= 1) continue
          if (a.clone().addScaledVector(direction, t).distanceToSquared(point) > EPSILON ** 2)
            continue
          splits.push({ point, t })
        }
        splits.sort((a, b) => a.t - b.t)
        for (const { point, t } of splits) {
          boundary.push({
            point,
            weights: [0, 1, 2].map((i) => (i === edge ? 1 - t : i === next ? t : 0)),
          })
        }
      }
      const material = group.materialIndex ?? 0
      if (boundary.length === 3) {
        writeTriangle(boundary, indices, material)
        continue
      }
      changed = true
      // A center fan retains collinear edge vertices that polygon triangulation may discard.
      const center: Corner = {
        point: triangle.reduce((sum, point) => sum.add(point), new Vector3()).multiplyScalar(1 / 3),
        weights: [1 / 3, 1 / 3, 1 / 3],
      }
      const fan: Corner[][] = []
      for (let i = 0; i < boundary.length; i++) {
        const start = boundary[i]!
        const end = boundary[(i + 1) % boundary.length]!
        const reverse = fan.findIndex(
          (triangle) => triangle[1]!.point === end.point && triangle[2]!.point === start.point,
        )
        if (reverse >= 0) fan.splice(reverse, 1)
        else fan.push([center, start, end])
      }
      for (const triangle of fan) writeTriangle(triangle, indices, material)
    }
  }
  if (!changed) return source
  for (const { name, attribute, values } of attributes) {
    result.setAttribute(name, new Float32BufferAttribute(values, attribute.itemSize))
  }
  return result
}

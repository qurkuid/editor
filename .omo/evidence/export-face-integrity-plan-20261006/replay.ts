import { readFileSync } from 'node:fs'
import { calculateLevelMiters, getWallPlaneTop, resolveLevelId, sceneRegistry } from '../../../packages/core/dist/index.js'
import { computeWallSlabSupport } from '../../../packages/core/dist/hooks/spatial-grid/spatial-grid-manager.js'
import { generateExtrudedWall } from '../../../packages/viewer/src/systems/wall/wall-system'
import { buildWallConstructionGeometry } from '../../../packages/nodes/src/wall/construction-geometry'
import { conformWallGeometry } from '../../../packages/editor/src/lib/conform-wall-geometry'
import * as T from '../../../packages/editor/node_modules/three'

const { nodes } = JSON.parse(readFileSync(process.argv[2] ?? '/Users/changseok/Downloads/layout_2026-10-06.json', 'utf8'))
const walls = Object.values(nodes).filter((n: any) => n.type === 'wall') as any[]
const slabs = Object.values(nodes).filter((n: any) => n.type === 'slab') as any[]
const miters = calculateLevelMiters(walls)
function inspect(g: any) {
  const p = g.getAttribute('position'), edges = new Map<string, number[]>()
  let dropped = 0, shortEdges = 0
  for (let offset = 0; offset < (g.index?.count ?? p.count); offset += 3) {
    const ps = [0, 1, 2].map(i => new T.Vector3().fromBufferAttribute(p, g.index?.getX(offset + i) ?? offset + i))
    // DXF threshold 1e-12 in mm^4 is 1e-24 in metre^4.
    if (ps[1]!.clone().sub(ps[0]!).cross(ps[2]!.clone().sub(ps[0]!)).lengthSq() < 1e-24) {
      dropped++
      continue
    }
    const ks = ps.map(p => p.toArray().map(v => Math.round(v * 1e7)).join(','))
    for (let i = 0; i < 3; i++) {
      const a = ks[i]!, b = ks[(i + 1) % 3]!, key = [a, b].sort().join('|')
      const uses = edges.get(key) ?? []
      uses.push(a < b ? 1 : -1)
      edges.set(key, uses)
      if (ps[i]!.distanceTo(ps[(i + 1) % 3]!) < 0.0000254) shortEdges++
    }
  }
  return {
    triangles: (g.index?.count ?? p.count) / 3,
    badEdges: [...edges.values()].filter(v => v.length !== 2 || v[0]! + v[1]! !== 0).length,
    dropped, shortEdgeOccurrences: shortEdges,
  }
}
const results = walls.map(wall => {
  // The real producer refuses opening cuts without a registered wall host.
  sceneRegistry.nodes.set(wall.id, new T.Mesh())
  const support = computeWallSlabSupport(wall, slabs, walls, wall.supportSlabId)
  const offset = wall.supportOffset ?? 0
  const envelope = generateExtrudedWall(
    wall, wall.children.map((id: string) => nodes[id]).filter(Boolean), miters,
    support.elevation + offset, support.baseElevation + offset,
    support.baseSegments.map(s => ({ ...s, elevation: s.elevation + offset })),
    getWallPlaneTop(wall, resolveLevelId(wall, nodes), nodes),
  )
  const parts = buildWallConstructionGeometry(wall, envelope)
  return { id: wall.id, parts: parts.map(part => ({
    raw: inspect(part.geometry), conformed: inspect(conformWallGeometry(part.geometry)),
  })) }
})
const allClosed = results.every(wall => wall.parts.length > 0 && wall.parts.every(part => part.conformed.badEdges === 0 && part.conformed.dropped === 0))
const allRawBroken = results.every(wall => wall.parts.some(part => part.raw.badEdges > 0))
console.log(JSON.stringify({ scenario: 'actual downloaded layout -> registered wall host -> opening/support CSG -> construction CSG -> existing conformance', walls: results.length, allRawBroken, allClosed, results }, null, 2))
if (results.length !== 42 || !allRawBroken || !allClosed) process.exit(1)

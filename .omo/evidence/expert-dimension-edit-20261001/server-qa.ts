import { Database } from 'bun:sqlite'
import { gunzipSync } from 'node:zlib'
import { readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { deepStrictEqual } from 'node:assert'

const [mode, commit, fixedEnd = 'start'] = process.argv.slice(2)
if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid source commit')
const release = `/Volumes/DATABASE/floorplan-releases/20261001-${commit.slice(0,8)}`
const { buildLevelWallConstructionDimensionPlan } = await import(`${release}/packages/nodes/dist/wall/construction-dimensions.js`)
const { constructionDimensionStandard } = await import(`${release}/packages/nodes/dist/shared/construction-dimension-standards.js`)
const { preflightWallDimensionEdit } = await import(`${release}/packages/nodes/dist/shared/dimension-edit-preflight.js`)
const db = new Database(`${homedir()}/.pascal/data/pascal.db`, { readonly: true })
const row = db.query('SELECT version,graph_json FROM scenes WHERE id=?').get('8552ea8b9254') as { version: number; graph_json: string }
if (!row) throw Error('QA scene missing')
const raw = row.graph_json.startsWith('gzip:') ? gunzipSync(Buffer.from(row.graph_json.slice(5), 'base64')).toString() : row.graph_json
const graph = JSON.parse(raw)
const file = `/Volumes/DATABASE/floorplan-deploy-backups/20261001-${commit.slice(0,8)}/dimension-qa-${fixedEnd}.json`
if (mode === 'capture') {
  const wall = graph.nodes.wall_5qyptzh6g8yjff4t
  if (!wall) throw Error('QA wall missing')
  const walls = Object.values(graph.nodes).filter((n: any) => n.type === 'wall' && n.parentId === wall.parentId)
  const standard = constructionDimensionStandard({ datumPolicy: 'wall-face', intersectionReferencePolicy: 'both-faces' })
  const descriptor = buildLevelWallConstructionDimensionPlan(walls, graph.nodes, standard).get(wall.id)?.find((e: any) => e.tier === 'interior-overall')?.editDescriptor
  if (!descriptor) throw Error('QA descriptor missing')
  const request = { descriptor, targetDistance: 2.2, fixedEnd }
  preflightWallDimensionEdit({ node: wall, nodes: graph.nodes, request })
  writeFileSync(file, JSON.stringify({ graph, wallId: wall.id, request }), { mode: 0o600 })
  console.log(JSON.stringify({ captured: true, version: row.version, nodes: Object.keys(graph.nodes).length, preflight: 'PASS' }))
} else {
  const before = JSON.parse(readFileSync(file, 'utf8'))
  const plan = preflightWallDimensionEdit({ node: before.graph.nodes[before.wallId], nodes: before.graph.nodes, request: before.request })
  const expected = structuredClone(before.graph)
  for (const { id, data } of plan.updates) expected.nodes[id] = { ...expected.nodes[id], ...data }
  let maxNumericDelta=0
function compare(actual:any, expected:any, path:string):void {
 if(typeof actual==='number' && typeof expected==='number') {
  const delta=Math.abs(actual-expected); maxNumericDelta=Math.max(maxNumericDelta,delta)
  if(delta>1e-10) throw Error('Numeric mismatch at '+path)
  return
 }
 if(actual===expected) return
 if(actual && expected && typeof actual==='object' && typeof expected==='object') {
  const keys=Object.keys(actual).sort(), expectedKeys=Object.keys(expected).sort()
  if(JSON.stringify(keys)!==JSON.stringify(expectedKeys)) throw Error('Keys mismatch at '+path)
  for(const key of keys) compare(actual[key],expected[key],path+'.'+key)
  return
 }
 throw Error('Value mismatch at '+path)
}
  if (mode === 'undo') deepStrictEqual(graph, before.graph)
  else compare(graph,expected,'graph')
  console.log(JSON.stringify({ plannedGraph: 'PASS', numericTolerance: mode === 'undo' ? 0 : 1e-10, maxNumericDelta, mode, version: row.version, updates: plan.updates.length, nodes: Object.keys(graph.nodes).length }))
}
db.close()

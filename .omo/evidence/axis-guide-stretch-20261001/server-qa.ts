import { Database } from 'bun:sqlite'
import { gunzipSync } from 'node:zlib'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { deepStrictEqual } from 'node:assert'
import { buildAxisGuideStretchPlan } from '/Volumes/DATABASE/floorplan-releases/20261001-b9c56927/packages/core/dist/index.js'

const [mode, axis, sideText = '1', distanceText = '.5'] = process.argv.slice(2)
const db = new Database(`${homedir()}/.pascal/data/pascal.db`, { readonly: true })
const row = db.query('SELECT version,graph_json FROM scenes WHERE id=?').get('8552ea8b9254') as { version: number; graph_json: string }
if (!row) throw Error('QA scene missing')
const raw = row.graph_json.startsWith('gzip:') ? gunzipSync(Buffer.from(row.graph_json.slice(5), 'base64')).toString() : row.graph_json
const graph = JSON.parse(raw)
const file = `/Volumes/DATABASE/floorplan-deploy-backups/20261001-b9c56927/axis-qa-${axis}.json`
if (mode === 'capture') {
  const guides = Object.values(graph.nodes).filter((n: any) => n.type === 'construction-guide' && (axis === 'x' ? Math.abs(n.direction[0]) < 1e-6 : Math.abs(n.direction[1]) < 1e-6)) as any[]
  const guide = guides.at(-1)
  if (!guide) throw Error('Direct guide missing')
  writeFileSync(file, JSON.stringify({ graph, guideId: guide.id }), { mode: 0o600 })
  chmodSync(file, 0o600)
  console.log(JSON.stringify({ captured: true, axis, version: row.version, nodes: Object.keys(graph.nodes).length }))
} else {
  const before = JSON.parse(readFileSync(file, 'utf8'))
  const plan = buildAxisGuideStretchPlan(before.graph.nodes, { guideId: before.guideId, side: Number(sideText), distance: Number(distanceText) })
  const expected = structuredClone(before.graph)
  for (const { id, data } of plan.updates) expected.nodes[id] = { ...expected.nodes[id], ...data }
  deepStrictEqual(graph, mode === 'undo' ? before.graph : expected)
  console.log(JSON.stringify({ exactGraph: 'PASS', mode, axis, version: row.version, updates: plan.updates.length, nodes: Object.keys(graph.nodes).length }))
}
db.close()

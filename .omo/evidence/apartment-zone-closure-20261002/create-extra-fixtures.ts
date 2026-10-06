import { WallNode } from '../../../packages/core/src/schema'
const original = await Bun.file('.omo/evidence/apartment-zone-closure-20261002/browser-fixture.json').json()
for (const kind of ['closed', 'passage']) {
  const payload = structuredClone(original)
  payload.id = `qa-zone-${kind}-20261002`
  payload.name = `QA 공간 경계 ${kind} — 임시 테스트`
  const nodes = payload.graph.nodes
  const south = nodes.wall_zone_qa_south
  south.end = [2,-1.5]
  if (kind === 'passage') {
    south.end = [0,-1.5]
    const fragment = WallNode.parse({ id:'wall_zone_qa_fragment', parentId: 'level_zone_closure_qa', start:[0.4,-1.5], end:[2,-1.5], metadata:{source:'apt-vector'} })
    nodes[fragment.id] = fragment
    nodes.level_zone_closure_qa.children.push(fragment.id)
    nodes.door_zone_qa.position[0] = 1
  }
  const response = await fetch('http://localhost:3002/api/scenes', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(payload)})
  console.log(kind,response.status,await response.text())
}

const payload = await Bun.file('.omo/evidence/apartment-zone-closure-20261002/browser-fixture.json').json()
payload.id = 'qa-zone-final-20261002'
payload.name = 'QA 아파트 존 최종 검증 — 임시 테스트'
const nodes = payload.graph.nodes
nodes.wall_zone_qa_east.start = [2,-1.3]
nodes.wall_zone_qa_south.children = []
nodes.wall_zone_qa_east.children = ['door_zone_qa']
nodes.door_zone_qa.parentId = 'wall_zone_qa_east'
nodes.door_zone_qa.wallId = 'wall_zone_qa_east'
nodes.door_zone_qa.position = [1.4,1,0]
for(const n of Object.values(nodes) as any[]) if(n.type==='wall') n.metadata={source:'apt-vector',apartmentId:'qa-apartment',planId:'qa-plan'}
await Bun.write('.omo/evidence/apartment-zone-closure-20261002/final-fixture.json',JSON.stringify(payload,null,2))
const r = await fetch('http://localhost:3002/api/scenes', {method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
console.log(r.status)

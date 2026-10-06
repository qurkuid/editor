const payload = await Bun.file('.omo/evidence/apartment-zone-closure-20261002/browser-fixture.json').json()
payload.id = 'qa-zone-bundle-20261002'
payload.name = 'QA 두 벽 모서리 연결 — 임시 테스트'
payload.graph.nodes.wall_zone_qa_east.start = [2,-1.3]
const r = await fetch('http://localhost:3002/api/scenes', {method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
console.log(r.status)

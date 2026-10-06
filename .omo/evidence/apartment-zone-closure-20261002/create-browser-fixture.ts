import { SiteNode, BuildingNode, LevelNode, WallNode, DoorNode } from '../../../packages/core/src/schema'
const level = LevelNode.parse({ id: 'level_zone_closure_qa', name: '공간 경계 검증', level: 0 })
const walls = [
  WallNode.parse({ id: 'wall_zone_qa_south', start: [-2, -1.5], end: [1.8, -1.5], parentId: level.id, metadata: { source: 'apt-vector' } }),
  WallNode.parse({ id: 'wall_zone_qa_east', start: [2, -1.5], end: [2, 1.5], parentId: level.id, metadata: { source: 'apt-vector' } }),
  WallNode.parse({ id: 'wall_zone_qa_north', start: [2, 1.5], end: [-2, 1.5], parentId: level.id, metadata: { source: 'apt-vector' } }),
  WallNode.parse({ id: 'wall_zone_qa_west', start: [-2, 1.5], end: [-2, -1.5], parentId: level.id, metadata: { source: 'apt-vector' } }),
]
const door = DoorNode.parse({ id: 'door_zone_qa', parentId: walls[0]!.id, wallId: walls[0]!.id, width: 0.8, position: [1.5, 1, 0] })
walls[0]!.children = [door.id]
level.children = walls.map(w => w.id)
const building = BuildingNode.parse({ id: 'building_zone_qa', name: '테스트 아파트', children: [level.id] })
level.parentId = building.id
const site = SiteNode.parse({ id: 'site_zone_qa', name: '경계 진단 테스트', children: [building.id] })
building.parentId = site.id
const graph = { nodes: Object.fromEntries([site, building, level, ...walls, door].map(n => [n.id, n])), rootNodeIds: [site.id], collections: {}, materials: {} }
await Bun.write('.omo/evidence/apartment-zone-closure-20261002/browser-fixture.json', JSON.stringify({ id: 'qa-zone-closure-20261002', name: 'QA 공간 경계 — 임시 테스트', graph }, null, 2))
const response = await fetch('http://localhost:3002/api/scenes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'qa-zone-closure-20261002', name: 'QA 공간 경계 — 임시 테스트', graph }) })
console.log(response.status, await response.text())

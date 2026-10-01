import { expect, test } from 'bun:test'
import * as THREE from 'three'
import { exportSceneToDxf } from './dxf-export'

function records(text: string) {
  const lines = text.trim().split(/\r?\n/)
  const result: { type: string; values: Map<number, string[]> }[] = []
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i])
    const value = lines[i + 1]!
    if (code === 0) result.push({ type: value, values: new Map() })
    else {
      const values = result.at(-1)!.values
      values.set(code, [...(values.get(code) ?? []), value])
    }
  }
  return result
}

test('DXF keeps each wall, door and window in its own named block and type layer', () => {
  const root = new THREE.Group()
  root.position.set(3, 2, -4)
  const wall = new THREE.Mesh(new THREE.BoxGeometry(4, 3, 0.2))
  wall.userData = { pascalId: 'wall_1', kind: 'wall', label: '외벽' }
  const door = new THREE.Group()
  door.userData = { pascalId: 'door_1', kind: 'door', label: '문' }
  door.add(new THREE.Mesh(new THREE.BoxGeometry(1, 2, 0.05)))
  const window = new THREE.Group()
  window.userData = { pascalId: 'window_1', kind: 'window', label: '창' }
  window.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.05)))
  wall.add(door, window)
  const collision = new THREE.Mesh(new THREE.BoxGeometry(100, 100, 100))
  collision.visible = false
  wall.add(collision)
  root.add(wall)
  const before = wall.geometry.toJSON()
  const dxf = exportSceneToDxf(root)
  expect(dxf).toContain('AC1015\r\n')
  expect(dxf).toContain('AcDbBlockTableRecord')
  expect(dxf).toContain('$EXTMIN\r\n10\r\n1000\r\n')
  expect(dxf).toContain('$EXTMAX\r\n10\r\n5000\r\n')
  const parsed = records(dxf)
  const blocks = parsed.filter((r) => r.type === 'BLOCK')
  const inserts = parsed.filter((r) => r.type === 'INSERT')
  expect(blocks.map((r) => r.values.get(2)![0])).toContain('wall_1')
  expect(inserts.map((r) => r.values.get(8)![0]).sort()).toEqual([
    'Pascal_Door',
    'Pascal_Wall',
    'Pascal_Window',
  ])
  expect(inserts.map((r) => r.values.get(2)![0]).sort()).toEqual(['door_1', 'wall_1', 'window_1'])
  expect(parsed.filter((r) => r.type === '3DFACE')).toHaveLength(36)
  expect(parsed.filter((r) => r.type === '3DFACE').every((r) => r.values.get(8)![0] === '0')).toBe(
    true,
  )
  expect(wall.geometry.toJSON()).toEqual(before)
  const vertices = parsed
    .filter((r) => r.type === '3DFACE')
    .flatMap((r) =>
      [0, 1, 2].map((i) => [
        Number(r.values.get(10 + i)![0]),
        Number(r.values.get(20 + i)![0]),
        Number(r.values.get(30 + i)![0]),
      ]),
    )
  expect(Math.min(...vertices.map((p) => p[0]!))).toBe(1000)
  expect(Math.max(...vertices.map((p) => p[2]!))).toBe(3500)
})

test('DXF references a packaged floorplan image at its world position and scale', () => {
  const image = {
    name: 'guide_test',
    filename: 'guide_test.png',
    width: 1000,
    height: 600,
    origin: new THREE.Vector3(100, 200, -10),
    u: new THREE.Vector3(10, 0, 0),
    v: new THREE.Vector3(0, 10, 0),
  }
  const dxf = exportSceneToDxf(new THREE.Group(), [image])
  const parsed = records(dxf)
  const raster = parsed.find((r) => r.type === 'IMAGE')!
  const definition = parsed.find((r) => r.type === 'IMAGEDEF')!
  expect(raster.values.get(8)).toEqual(['Pascal_Guide'])
  expect(raster.values.get(10)).toEqual(['100'])
  expect(raster.values.get(11)).toEqual(['10'])
  expect(raster.values.get(13)).toEqual(['1000'])
  expect(raster.values.get(340)).toEqual(definition.values.get(5))
  expect(definition.values.get(1)).toEqual(['guide_test.png'])
  const handles = parsed.flatMap((r) => r.values.get(5) ?? [])
  expect(new Set(handles).size).toBe(handles.length)
  const refs = parsed.flatMap((r) =>
    [330, 340, 350, 360].flatMap((code) => r.values.get(code) ?? []),
  )
  expect(refs.every((handle) => handle === '0' || handles.includes(handle))).toBe(true)
})

test('DXF excludes unused draw ranges, keeps mirrored winding, and rejects non-finite coordinates', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1))
  mesh.userData = { pascalId: 'wall_2', kind: 'wall' }
  mesh.geometry.setDrawRange(0, 6)
  mesh.scale.x = -1
  const parsed = records(exportSceneToDxf(mesh))
  expect(parsed.filter((r) => r.type === '3DFACE')).toHaveLength(2)
  for (const face of parsed.filter((r) => r.type === '3DFACE')) {
    const [a, b, c] = [0, 1, 2].map(
      (i) =>
        new THREE.Vector3(
          Number(face.values.get(10 + i)![0]),
          Number(face.values.get(20 + i)![0]),
          Number(face.values.get(30 + i)![0]),
        ),
    )
    expect(b!.sub(a!).cross(c!.sub(a!)).x).toBeLessThan(0)
  }
  mesh.geometry.getAttribute('position').setX(0, Number.NaN)
  expect(() => exportSceneToDxf(mesh)).toThrow('non-finite')
})

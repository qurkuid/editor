import { expect, test } from 'bun:test'
import { Group, Mesh, PlaneGeometry } from 'three'
import { floorplanImagePlacement } from './floorplan-image-export'

test('floorplan image keeps floor rotation, level elevation, width and height in CAD millimeters', () => {
  const level = new Group()
  level.position.set(2, 3, -4)
  const mesh = new Mesh(new PlaneGeometry(10, 6))
  mesh.rotation.x = -Math.PI / 2
  level.add(mesh)
  level.updateMatrixWorld(true)
  const placement = floorplanImagePlacement(mesh, 1000, 600)
  expect(placement.origin.x).toBeCloseTo(-3000)
  expect(placement.origin.y).toBeCloseTo(1000)
  expect(placement.origin.z).toBeCloseTo(3000)
  expect(placement.u.x).toBeCloseTo(10)
  expect(placement.v.y).toBeCloseTo(10)
  expect(placement.v.z).toBeCloseTo(0)
})

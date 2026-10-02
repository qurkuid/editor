import { expect, test } from 'bun:test'
import {
  calculateLevelMiters,
  createWallBandConstructionPreset,
  DoorNode,
  sceneRegistry,
  WallNode,
  WindowNode,
} from '@pascal-app/core'
import { Box3, Mesh, Vector3 } from 'three'
import { generateExtrudedWall } from '../../../viewer/src/systems/wall/wall-system'
import { buildWallConstructionGeometry } from './construction-geometry'

test('assembly contains real layers and studs with empty cavities and door/window cutouts', () => {
  const wall = WallNode.parse({
    start: [0, 0],
    end: [4, 0],
    height: 2.5,
    thickness: 0.181,
    faceBands: {
      construction: { upper: createWallBandConstructionPreset('stud-gypsum-finish', 0.181) },
    },
  })
  const door = DoorNode.parse({ position: [2, 1, 0], width: 1, height: 2 })
  const window = WindowNode.parse({ position: [3.3, 1.4, 0], width: 0.6, height: 1 })
  sceneRegistry.nodes.set(wall.id, new Mesh())
  const envelope = generateExtrudedWall(wall, [door, window], calculateLevelMiters([wall]))
  sceneRegistry.nodes.delete(wall.id)
  const parts = buildWallConstructionGeometry(wall, envelope)
  expect(parts.length).toBeGreaterThan(3)
  expect(parts.some((part) => part.kind === 'cavity')).toBe(false)
  const board = parts.find((part) => part.kind === 'gypsum-board')!
  board.geometry.computeBoundingBox()
  expect(board.geometry.boundingBox!.getSize(new Vector3()).z).toBeCloseTo(0.0095, 5)
  for (const part of parts) {
    const p = part.geometry.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const insideDoor = p.getX(i) > 1.5001 && p.getX(i) < 2.4999 && p.getY(i) < 1.9999
      expect(insideDoor).toBe(false)
      const insideWindow =
        p.getX(i) > 3.0001 && p.getX(i) < 3.5999 && p.getY(i) > 0.9001 && p.getY(i) < 1.8999
      expect(insideWindow).toBe(false)
    }
    part.geometry.dispose()
  }
  envelope.dispose()
})

test('bands occupy their configured heights and overlay retains the existing wall core', () => {
  const wall = WallNode.parse({
    start: [0, 0],
    end: [2, 0],
    height: 3,
    thickness: 0.1,
    faceBands: {
      enabled: true,
      count: 2,
      lowerHeight: 1,
      construction: {
        lower: createWallBandConstructionPreset('mdf'),
        upper: createWallBandConstructionPreset('glass'),
      },
    },
  })
  const envelope = generateExtrudedWall(wall, [], calculateLevelMiters([wall]))
  const parts = buildWallConstructionGeometry(wall, envelope)
  for (const part of parts) part.geometry.computeBoundingBox()
  const mdf = parts.find((part) => part.kind === 'mdf')!
  expect(mdf.geometry.boundingBox!.max.y).toBeCloseTo(1)
  expect(mdf.geometry.boundingBox!.getSize(new Vector3()).z).toBeCloseTo(0.009)
  const core = parts.find((part) => part.layerIndex === -1)!
  expect(core.geometry.boundingBox!.getSize(new Vector3()).z).toBeCloseTo(0.1)
  const glass = parts.find((part) => part.kind === 'glass')!
  expect(glass.geometry.boundingBox!.min.y).toBeCloseTo(1)
  expect(glass.geometry.boundingBox!.max.y).toBeCloseTo(3)
  expect(glass.geometry.boundingBox!.getSize(new Vector3()).z).toBeCloseTo(0.012)
  const bounds = parts.reduce((box, part) => box.union(part.geometry.boundingBox!), new Box3())
  expect(bounds.max.y).toBeCloseTo(3)
  for (const part of parts) part.geometry.dispose()
  envelope.dispose()
})

test('finish parts use the signed physical center and structural parts omit a surface side', () => {
  const wall = WallNode.parse({
    start: [0, 0],
    end: [2, 0],
    height: 2.5,
    thickness: 0.3,
    frontSide: 'interior',
    backSide: 'exterior',
    faceBands: {
      construction: {
        upper: {
          mode: 'overlay',
          layers: [
            { kind: 'finish', thickness: 0.01 },
            { kind: 'concrete', thickness: 0.1 },
          ],
        },
      },
    },
  })
  const envelope = generateExtrudedWall(wall, [], calculateLevelMiters([wall]))
  const parts = buildWallConstructionGeometry(wall, envelope)
  const finish = parts.find((part) => part.kind === 'finish')
  expect(finish?.surfaceSide).toBe('interior')
  expect(parts.filter((part) => part.kind !== 'finish').every((part) => !part.surfaceSide)).toBe(
    true,
  )
  for (const part of parts) part.geometry.dispose()
  envelope.dispose()
})

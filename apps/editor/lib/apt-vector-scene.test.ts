import { describe, expect, test } from 'bun:test'
import { type AptVectorDoc, buildVectorNodes } from './apt-vector-scene'

// 10000 x 8000 mm plan on a 1000 x 800 px image (10 mm/px), centre (5000, 4000).
// The vectorizer emits openings as GAPS between wall segments, so the north
// wall arrives split into three pieces around a door and a window gap.
const doc: AptVectorDoc = {
  unit: 'mm',
  imageSize: [1000, 800],
  mmPerPx: 10,
  walls: [
    { id: 'w0a', kind: 'exterior', start: [1000, 1000], end: [2000, 1000], thickness: 200 },
    { id: 'w0b', kind: 'exterior', start: [2900, 1000], end: [6000, 1000], thickness: 200 },
    { id: 'w0c', kind: 'exterior', start: [7500, 1000], end: [9000, 1000], thickness: 200 },
    { id: 'w1', kind: 'exterior', start: [9000, 1000], end: [9000, 7000], thickness: 200 },
    { id: 'w2a', kind: 'interior', start: [1000, 4000], end: [4000, 4000], thickness: 100 },
    { id: 'w2b', kind: 'interior', start: [5200, 4000], end: [9000, 4000], thickness: 100 },
  ],
  openings: [
    { id: 'o0', type: 'door', a: [2000, 1000], b: [2900, 1000], wallThickness: 200 },
    { id: 'o1', type: 'window', a: [6000, 1000], b: [7500, 1000], wallThickness: 200 },
    { id: 'o2', type: 'opening', a: [4000, 4000], b: [5200, 4000], wallThickness: 100 },
    // nowhere near a wall → dropped
    { id: 'o3', type: 'door', a: [3000, 6000], b: [3900, 6000], wallThickness: 100 },
  ],
  rooms: [],
}

describe('buildVectorNodes', () => {
  test('merges gap-flanking walls and maps to centred level metres', () => {
    const built = buildVectorNodes(doc)
    expect(built).not.toBeNull()
    const { walls, guideScale } = built!
    // three split north pieces → one wall; two interior pieces → one wall
    expect(walls).toHaveLength(3)
    const north = walls.find((wall) => wall.start[1] === -3 && wall.end[1] === -3)!
    const [lo, hi] = [north.start[0], north.end[0]].sort((p, q) => p - q)
    expect(lo).toBeCloseTo(-4)
    expect(hi).toBeCloseTo(4)
    expect(north.thickness).toBeCloseTo(0.2)
    // 1000 px * 10 mm/px = 10 m plan width → the 10 m guide plane needs scale 1
    expect(guideScale).toBeCloseTo(1)
  })

  test('hosts openings inside the merged wall with wall-local positions', () => {
    const { walls, openings } = buildVectorNodes(doc)!
    expect(openings).toHaveLength(3)
    const north = walls.find((wall) => wall.start[1] === -3 && wall.end[1] === -3)!

    const door = openings.find((node) => node.type === 'door')!
    expect(door.wallId).toBe(north.id)
    expect(door.width).toBeCloseTo(0.9)
    // gap centre 2450 mm → 1.45 m from the merged wall start (1000 mm)
    expect(door.position[0]).toBeCloseTo(1.45)
    expect(door.position[1]).toBeCloseTo(1.05)

    const window = openings.find((node) => node.type === 'window' && node.openingKind === 'window')!
    expect(window.wallId).toBe(north.id)
    expect(window.width).toBeCloseTo(1.5)
    expect(window.position[0]).toBeCloseTo(5.75)
    expect(window.position[1]).toBeCloseTo(0.9 + 0.75)

    const opening = openings.find(
      (node) => node.type === 'window' && node.openingKind === 'opening',
    )!
    const interior = walls.find((wall) => wall.start[1] === 0 && wall.end[1] === 0)!
    expect(opening.wallId).toBe(interior.id)
    expect(opening.position[0]).toBeCloseTo(3.6)
    expect(opening.position[1]).toBeCloseTo(1.05)
  })

  test('extends a single flank across a corner-door gap', () => {
    const corner: AptVectorDoc = {
      ...doc,
      walls: [
        { id: 'a', kind: 'interior', start: [1000, 1000], end: [3000, 1000], thickness: 100 },
        { id: 'b', kind: 'interior', start: [3900, 800], end: [3900, 3000], thickness: 100 },
        { id: 'c', kind: 'interior', start: [1000, 3000], end: [3900, 3000], thickness: 100 },
      ],
      openings: [
        // gap runs from wall `a`'s free end to the face of perpendicular `b`
        { id: 'o', type: 'door', a: [3000, 1000], b: [3900, 1000], wallThickness: 100 },
      ],
    }
    const built = buildVectorNodes(corner)!
    const door = built.openings[0]!
    const host = built.walls.find((wall) => wall.id === door.wallId)!
    // wall `a` was extended across the gap to reach x=3900
    expect(Math.max(host.start[0], host.end[0])).toBeCloseTo(-1.1)
    expect(door.width).toBeCloseTo(0.9)
  })

  test('refuses untrustworthy documents', () => {
    expect(buildVectorNodes({ ...doc, mmPerPx: null })).toBeNull()
    expect(buildVectorNodes({ ...doc, metrics: { style: 'wood-dense' } })).toBeNull()
    expect(buildVectorNodes({ ...doc, walls: doc.walls.slice(0, 2) })).toBeNull()
  })
})

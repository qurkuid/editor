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
  rooms: [
    {
      id: 'r0',
      name: '거실',
      cls: 'living',
      areaM2: 28.1,
      polygon: [
        [3000, 1200],
        [8800, 1200],
        [8800, 3800],
        [3000, 3800],
      ],
    },
    {
      id: 'r1',
      name: null,
      cls: 'bath',
      areaM2: 3.2,
      polygon: [
        [1200, 1200],
        [2800, 1200],
        [2800, 3800],
        [1200, 3800],
      ],
    },
    // degenerate polygon → skipped
    { id: 'r2', name: null, cls: 'hall', areaM2: null, polygon: [[0, 0]] as never },
  ],
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

  test('creates room zones from labeled polygons', () => {
    const { zones } = buildVectorNodes(doc)!
    expect(zones).toHaveLength(2)
    const living = zones.find((zone) => zone.name === '거실')!
    expect(living.spaceRole).toBe('room')
    expect(living.polygon[0]![0]).toBeCloseTo(-2)
    expect(living.polygon[0]![1]).toBeCloseTo(-2.8)
    // unlabeled room falls back to the class name in Korean
    expect(zones.some((zone) => zone.name === '욕실')).toBe(true)
  })

  test('snaps corner and tee gaps closed along each wall axis', () => {
    const gappy: AptVectorDoc = {
      ...doc,
      rooms: [],
      openings: [],
      walls: [
        // L-corner left open by 200 mm on each leg
        { id: 'a', kind: 'exterior', start: [1000, 1200], end: [1000, 3000], thickness: 150 },
        { id: 'b', kind: 'exterior', start: [1200, 1000], end: [3000, 1000], thickness: 150 },
        // tee: this wall stops 300 mm short of wall `a`'s centreline
        { id: 'c', kind: 'interior', start: [1300, 2000], end: [3000, 2000], thickness: 100 },
        // same-run continuation split off by 0 mm — must merge, not seam
        { id: 'd', kind: 'exterior', start: [3000, 1000], end: [3150, 1000], thickness: 150 },
        // isolated 150 mm pier far from everything — survives the length filter
        { id: 'e', kind: 'interior', start: [5000, 5000], end: [5150, 5000], thickness: 100 },
      ],
    }
    const { walls } = buildVectorNodes(gappy)!
    const cornerV = walls.find((wall) => wall.thickness! > 0.12 && wall.start[0] === wall.end[0])!
    const cornerH = walls.find(
      (wall) => wall.thickness! > 0.12 && wall.start[1] === wall.end[1] && segLenOf(wall) > 1,
    )!
    // both legs now reach the shared corner (1000, 1000) mm → (-4, -3) m
    expect(Math.min(cornerV.start[1], cornerV.end[1])).toBeCloseTo(-3)
    expect(Math.min(cornerH.start[0], cornerH.end[0])).toBeCloseTo(-4)
    // the collinear continuation `d` was absorbed into the same wall node
    expect(Math.max(cornerH.start[0], cornerH.end[0])).toBeCloseTo(-1.85)
    // the tee wall extends to wall `a`'s centreline x = -4
    const tee = walls.find((wall) => wall.thickness! < 0.12 && segLenOf(wall) > 1)!
    expect(Math.min(tee.start[0], tee.end[0])).toBeCloseTo(-4)
    // the isolated 150 mm pier survived as its own wall
    expect(walls.some((wall) => segLenOf(wall) < 0.2)).toBe(true)
  })

  test('deduplicates overlapping opening detections on one wall', () => {
    const dup: AptVectorDoc = {
      ...doc,
      rooms: [],
      openings: [
        // precise pair-gap window …
        { id: 'o1', type: 'window', a: [6000, 1000], b: [7500, 1000], wallThickness: 200 },
        // … plus an overshooting duplicate of the same opening
        { id: 'o1b', type: 'window', a: [6000, 1000], b: [7900, 1000], wallThickness: 200 },
        // door and window describing the same gap → the door wins
        { id: 'o0', type: 'window', a: [2000, 1000], b: [2900, 1000], wallThickness: 200 },
        { id: 'o0b', type: 'door', a: [2000, 1000], b: [2900, 1000], wallThickness: 200 },
      ],
    }
    const { openings } = buildVectorNodes(dup)!
    expect(openings).toHaveLength(2)
    expect(openings.filter((node) => node.type === 'door')).toHaveLength(1)
    const windows = openings.filter((node) => node.type === 'window')
    expect(windows).toHaveLength(1)
    // the tighter detection was kept
    expect(windows[0]!.width).toBeCloseTo(1.5)
  })

  test('extends a single flank across a corner-door gap', () => {
    const corner: AptVectorDoc = {
      ...doc,
      rooms: [],
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

function segLenOf(wall: { start: [number, number]; end: [number, number] }): number {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

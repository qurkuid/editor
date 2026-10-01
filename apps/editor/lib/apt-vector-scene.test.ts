import { describe, expect, test } from 'bun:test'
import { calculateLevelMiters, getWallPlanFootprint } from '@pascal-app/core'
import { unionPolygons } from '../../../packages/viewer/src/lib/polygon-union'
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
  test('connects X and T crossings without overlapping wall footprints and preserves openings', () => {
    const crossing: AptVectorDoc = {
      ...doc,
      rooms: [],
      walls: [
        { id: 'a', kind: 'exterior', start: [1000, 4000], end: [9000, 4000], thickness: 200 },
        { id: 'b', kind: 'interior', start: [5000, 1000], end: [5000, 7000], thickness: 100 },
        { id: 'c', kind: 'interior', start: [7000, 4000], end: [7000, 7000], thickness: 100 },
      ],
      openings: [
        { id: 'door', type: 'door', a: [2000, 4000], b: [2900, 4000], wallThickness: 200 },
        { id: 'window', type: 'window', a: [7600, 4000], b: [8400, 4000], wallThickness: 200 },
      ],
    }
    crossing.walls.splice(
      0,
      1,
      { id: 'a0', kind: 'exterior', start: [1000, 4000], end: [2000, 4000], thickness: 200 },
      { id: 'a1', kind: 'exterior', start: [2900, 4000], end: [7600, 4000], thickness: 200 },
      { id: 'a2', kind: 'exterior', start: [8400, 4000], end: [9000, 4000], thickness: 200 },
    )
    const built = buildVectorNodes(crossing)!
    const miters = calculateLevelMiters(built.walls)
    expect(miters.junctions.get('0,0')?.connectedWalls).toHaveLength(4)
    expect(miters.junctions.get('2000,0')?.connectedWalls).toHaveLength(2)
    const polygons = built.walls.map((wall) =>
      getWallPlanFootprint(wall, miters).map((p) => [p.x, p.y] as [number, number]),
    )
    const area = (ring: [number, number][]) =>
      Math.abs(
        ring.reduce((sum, p, i) => {
          const q = ring[(i + 1) % ring.length]!
          return sum + p[0] * q[1] - q[0] * p[1]
        }, 0) / 2,
      )
    const union = unionPolygons(polygons)
    expect(union).toHaveLength(1)
    expect(polygons.reduce((sum, ring) => sum + area(ring), 0)).toBeCloseTo(
      union.reduce((sum, ring) => sum + area(ring), 0),
      7,
    )
    expect(built.openings).toHaveLength(2)
    for (const opening of built.openings) {
      const host = built.walls.find((wall) => wall.id === opening.wallId)!
      expect(host.children).toContain(opening.id)
      expect(opening.position[0] - opening.width / 2).toBeGreaterThanOrEqual(0)
      expect(opening.position[0] + opening.width / 2).toBeLessThanOrEqual(segLenOf(host) + 1e-7)
      expect(host.start[0] + opening.position[0]).toBeCloseTo(opening.type === 'door' ? -2.55 : 3)
      expect(host.faceBands?.construction?.upper?.layers[0]?.kind).toBe('concrete')
    }
  })

  test('uses solid concrete for apartment walls while preserving detected thickness', () => {
    const { walls, openings } = buildVectorNodes(doc)!
    expect(new Set(walls.map((wall) => wall.thickness))).toEqual(new Set([0.1, 0.2]))
    for (const wall of walls) {
      expect(wall.faceBands?.construction?.upper).toMatchObject({
        mode: 'assembly',
        layers: [{ kind: 'concrete', thickness: wall.thickness, wasteFactor: 0 }],
      })
      expect(wall.faceBands?.construction?.upper?.layers).toHaveLength(1)
    }
    for (const opening of openings) {
      expect(walls.some((wall) => wall.id === opening.wallId)).toBe(true)
    }
  })

  test('keeps an opening whole when a detected branch meets its span', () => {
    const built = buildVectorNodes({
      ...doc,
      rooms: [],
      walls: [
        { id: 'a', kind: 'exterior', start: [1000, 1000], end: [3000, 1000], thickness: 200 },
        { id: 'b', kind: 'exterior', start: [4000, 1000], end: [9000, 1000], thickness: 200 },
        { id: 'c', kind: 'interior', start: [3500, 1000], end: [3500, 7000], thickness: 100 },
      ],
      openings: [{ id: 'o', type: 'window', a: [3000, 1000], b: [4000, 1000], wallThickness: 200 }],
    })!
    expect(built.walls).toHaveLength(2)
    expect(built.openings).toHaveLength(1)
    const opening = built.openings[0]!
    const host = built.walls.find((wall) => wall.id === opening.wallId)!
    expect(opening.parentId).toBe(host.id)
    expect(host.children).toEqual([opening.id])
    expect(opening.width).toBeCloseTo(1)
    expect(host.start[0] + opening.position[0]).toBeCloseTo(-1.5)
  })

  test('merges gap-flanking walls and maps to centred level metres', () => {
    const built = buildVectorNodes(doc)
    expect(built).not.toBeNull()
    const { walls, guideScale } = built!
    expect(walls).toHaveLength(3)
    expect(walls.filter((wall) => wall.start[0] === 4 && wall.end[0] === 4)).toHaveLength(1)
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

  test('uses the semantic opening span and preserves source provenance', () => {
    const semantic: AptVectorDoc = {
      ...doc,
      openings: [
        {
          ...doc.openings[0]!,
          src: 'fixture-split',
          hinge: [2050, 1000],
          radius: 450,
          barrierA: [1900, 1000],
          barrierB: [3100, 1000],
          barrierThickness: 1200,
        },
        ...doc.openings.slice(1),
      ],
    }
    const built = buildVectorNodes(semantic)!
    const door = built.openings.find((node) => node.type === 'door')!
    const host = built.walls.find((wall) => wall.id === door.wallId)!

    expect(door.width).toBeCloseTo(0.9)
    expect(door.metadata).toMatchObject({
      source: 'apt-vector',
      sourceOpeningId: 'o0',
      sourceOpeningType: 'door',
      sourceOpeningSource: 'fixture-split',
      sourceWidthMm: 900,
      sourceHinge: [2050, 1000],
      sourceRadius: 450,
    })
    // The wider room barrier is ignored for host geometry; only a/b define
    // the semantic gap that the importer spans.
    expect(host.start[0]).toBeCloseTo(-4)
    expect(host.end[0]).toBeCloseTo(4)
  })

  test('recovers an ordered fixture-split door only onto an anchored sibling host', () => {
    const ordered: AptVectorDoc = {
      unit: 'mm',
      imageSize: [2000, 2000],
      mmPerPx: 1,
      walls: [
        { id: 'anchor', kind: 'interior', start: [600, 0], end: [600, 1000], thickness: 81.2 },
        {
          id: 'far-anchor',
          kind: 'interior',
          start: [1000, 1300],
          end: [1600, 1300],
          thickness: 81.2,
        },
        { id: 'third', kind: 'interior', start: [100, 1800], end: [400, 1800], thickness: 100 },
      ],
      openings: [
        {
          id: 'o14',
          type: 'door',
          a: [100, 100],
          b: [700, 700],
          wallThickness: 81.2,
          src: 'fixture-split',
        },
        {
          id: 'o15',
          type: 'door',
          a: [700, 700],
          b: [1300, 1300],
          wallThickness: 81.2,
          src: 'fixture-split',
        },
      ],
      rooms: [],
    }
    const built = buildVectorNodes(ordered)!
    const halves = built.openings.filter((opening) => opening.type === 'door')
    expect(built.diagnostics.unhostedOpeningIds).toEqual([])
    expect(halves).toHaveLength(2)
    expect(halves.map((opening) => opening.metadata?.sourceOpeningId).sort()).toEqual([
      'o14',
      'o15',
    ])
    expect(new Set(halves.map((opening) => opening.wallId)).size).toBe(1)
    const host = built.walls.find((wall) => wall.id === halves[0]!.wallId)!
    expect(host.children?.sort()).toEqual(halves.map((opening) => opening.id).sort())
    for (const opening of halves) expect(opening.width).toBeCloseTo(Math.SQRT2 * 0.6)

    const unanchored = buildVectorNodes({
      ...ordered,
      openings: [
        {
          id: 'orphan-a',
          type: 'door',
          a: [100, 1700],
          b: [700, 1100],
          wallThickness: 81.2,
          src: 'fixture-split',
        },
        {
          id: 'orphan-b',
          type: 'door',
          a: [700, 1100],
          b: [1300, 500],
          wallThickness: 81.2,
          src: 'fixture-split',
        },
      ],
    })!
    expect(unanchored.diagnostics.unhostedOpeningIds.sort()).toEqual(['orphan-a', 'orphan-b'])
    expect(unanchored.openings).toHaveLength(0)

    const nonFixture = buildVectorNodes({
      ...ordered,
      openings: [
        {
          id: 'plain-a',
          type: 'door',
          a: [100, 1700],
          b: [700, 1100],
          wallThickness: 81.2,
        },
        {
          id: 'plain-b',
          type: 'door',
          a: [700, 1100],
          b: [1300, 500],
          wallThickness: 81.2,
        },
      ],
    })!
    expect(nonFixture.diagnostics.unhostedOpeningIds.sort()).toEqual(['plain-a', 'plain-b'])
    expect(nonFixture.openings).toHaveLength(0)
  })

  test('preserves a narrow source opening and rejects invalid tiny spans', () => {
    const narrow = buildVectorNodes({
      ...doc,
      rooms: [],
      walls: [
        { id: 'a', kind: 'interior', start: [1000, 1000], end: [2000, 1000], thickness: 100 },
        { id: 'b', kind: 'interior', start: [2330, 1000], end: [9000, 1000], thickness: 100 },
        { id: 'c', kind: 'interior', start: [9000, 1000], end: [9000, 3000], thickness: 100 },
      ],
      openings: [
        { id: 'uncertain', type: 'opening', a: [2000, 1000], b: [2330, 1000], wallThickness: 100 },
      ],
    })!
    const uncertain = narrow.openings[0]!
    expect(uncertain.openingKind).toBe('opening')
    expect(uncertain.width).toBeCloseTo(0.33)
    expect(uncertain.metadata).toMatchObject({ sourceOpeningId: 'uncertain', sourceWidthMm: 330 })

    const invalid = buildVectorNodes({
      ...doc,
      openings: [{ ...doc.openings[0]!, a: [Number.NaN, 1000] }, ...doc.openings.slice(1)],
    })!
    expect(invalid.diagnostics.unhostedOpeningIds).toContain('o0')

    const tiny = buildVectorNodes({
      ...doc,
      walls: [
        { ...doc.walls[0]! },
        { ...doc.walls[1]!, start: [2200, 1000] },
        ...doc.walls.slice(2),
      ],
      openings: [{ ...doc.openings[0]!, b: [2200, 1000] }, ...doc.openings.slice(1)],
    })!
    expect(tiny.diagnostics.unhostedOpeningIds).toContain('o0')
    expect(tiny.openings).toHaveLength(2)
  })

  test('creates room zones from labeled polygons', () => {
    const withBigBath: AptVectorDoc = {
      ...doc,
      rooms: [
        ...doc.rooms,
        {
          id: 'r3',
          name: null,
          cls: 'bath',
          areaM2: 7.5,
          polygon: [
            [5200, 4200],
            [8800, 4200],
            [8800, 7000],
            [5200, 7000],
          ],
        },
      ],
    }
    const { zones: zonesWithBig } = buildVectorNodes(withBigBath)!
    // a big unlabeled white-tile room is a utility space, not a bathroom
    expect(
      zonesWithBig.find((zone) => zone.polygon.length === 4 && zone.name === '공간'),
    ).toBeTruthy()

    const { zones } = buildVectorNodes(doc)!
    expect(zones).toHaveLength(2)
    const living = zones.find((zone) => zone.name === '거실')!
    expect(living.spaceRole).toBe('room')
    expect(living.metadata).toMatchObject({ sourceRoomId: 'r0' })
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
    const { openings, diagnostics } = buildVectorNodes(dup)!
    expect(openings).toHaveLength(2)
    expect(openings.filter((node) => node.type === 'door')).toHaveLength(1)
    const windows = openings.filter((node) => node.type === 'window')
    expect(windows).toHaveLength(1)
    // the tighter detection was kept
    expect(windows[0]!.width).toBeCloseTo(1.5)
    expect(diagnostics.dedupedOpeningIds.sort()).toEqual(['o0', 'o1b'])
  })

  test('reports what the conversion left out', () => {
    const { diagnostics } = buildVectorNodes(doc)!
    // orphan opening far from every wall
    expect(diagnostics.unhostedOpeningIds).toEqual(['o3'])
    expect(diagnostics.dedupedOpeningIds).toEqual([])
    expect(diagnostics.droppedWallIds).toEqual([])
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

  test('hosts an opening embedded in an already continuous source wall', () => {
    const embedded: AptVectorDoc = {
      ...doc,
      walls: [{ ...doc.walls[0]!, end: [9000, 1000] }, ...doc.walls.slice(3)],
      openings: [
        { id: 'embedded', type: 'window', a: [1500, 1000], b: [2500, 1000], wallThickness: 100 },
      ],
    }
    const built = buildVectorNodes(embedded)!
    expect(built.diagnostics.unhostedOpeningIds).toEqual([])
    expect(built.openings).toHaveLength(1)
    expect(built.openings[0]!.width).toBeCloseTo(1)
    expect(built.walls.some((wall) => wall.id === built.openings[0]!.wallId)).toBe(true)
  })

  test('absorbs a short angled duplicate fully inside a longer source wall body', () => {
    const traced: AptVectorDoc = {
      ...doc,
      rooms: [],
      openings: [],
      walls: [
        { id: 'short', kind: 'interior', start: [2940, 2600], end: [3000, 2300], thickness: 250 },
        { id: 'long', kind: 'interior', start: [3000, 2000], end: [3000, 2800], thickness: 250 },
        { id: 'other', kind: 'exterior', start: [6000, 1000], end: [9000, 1000], thickness: 200 },
      ],
    }
    const built = buildVectorNodes(traced)!
    expect(built.walls).toHaveLength(2)
    const retained = built.walls.find((wall) => wall.thickness === 0.25)!
    expect(retained.start[0]).toBeCloseTo(-2)
    expect(retained.end[0]).toBeCloseTo(-2)
  })

  test('admits a wood render only with measured walls and predominantly labeled polygons', () => {
    const measured: AptVectorDoc = {
      ...doc,
      rooms: doc.rooms.slice(0, 2).map((room) => ({ ...room, name: room.name ?? '욕실' })),
      metrics: { style: 'wood-dense', wallIoU: 0.71 },
    }
    expect(buildVectorNodes(measured)).not.toBeNull()
    expect(
      buildVectorNodes({ ...measured, metrics: { style: 'wood-dense', wallIoU: 0.69 } }),
    ).toBeNull()
    expect(
      buildVectorNodes({
        ...measured,
        rooms: measured.rooms.map((room) => ({ ...room, name: null })),
      }),
    ).toBeNull()
  })

  test('anchors a measured window to both short crossing-wall endpoints', () => {
    const measured: AptVectorDoc = {
      ...doc,
      rooms: [],
      walls: [
        { id: 'west', kind: 'exterior', start: [1000, 1000], end: [1000, 4500], thickness: 200 },
        { id: 'east', kind: 'exterior', start: [4000, 1000], end: [4000, 4600], thickness: 200 },
        { id: 'north', kind: 'exterior', start: [1000, 1000], end: [4000, 1000], thickness: 200 },
      ],
      openings: [
        {
          id: 'glass',
          type: 'window',
          src: 'boundary',
          a: [1500, 5000],
          b: [3500, 5000],
          wallThickness: 200,
        },
      ],
    }
    const built = buildVectorNodes(measured)!
    expect(built.diagnostics.unhostedOpeningIds).toEqual([])
    expect(built.openings).toHaveLength(1)
    const host = built.walls.find((wall) => wall.id === built.openings[0]!.wallId)!
    expect(host.start[1]).toBeCloseTo(1)
    expect(host.end[1]).toBeCloseTo(1)
    expect(
      built.walls
        .filter((wall) => wall.start[0] === wall.end[0])
        .every((wall) => Math.max(wall.start[1], wall.end[1]) >= 1),
    ).toBe(true)
    const unanchored = buildVectorNodes({
      ...measured,
      walls: measured.walls.map((wall) =>
        wall.id === 'east' ? { ...wall, end: [4000, 4000] } : wall,
      ),
    })!
    expect(unanchored.diagnostics.unhostedOpeningIds).toEqual(['glass'])
    const west = unanchored.walls.find((wall) => wall.start[0] === -4 && wall.end[0] === -4)!
    expect(Math.max(west.start[1], west.end[1])).toBeCloseTo(0.5)
  })
})

function segLenOf(wall: { start: [number, number]; end: [number, number] }): number {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

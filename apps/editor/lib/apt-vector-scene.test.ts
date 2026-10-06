import { describe, expect, test } from 'bun:test'
import {
  CeilingNode,
  calculateLevelMiters,
  DEFAULT_WALL_THICKNESS,
  detectSpacesForLevel,
  GuideNode,
  getWallConstructionEnvelopeThickness,
  getWallPlanFootprint,
  SlabNode,
  WallNode,
} from '@pascal-app/core'
import { unionPolygons } from '../../../packages/viewer/src/lib/polygon-union'
import {
  APT_GUIDE_SCALE_RECOVERY_MESSAGE,
  APT_VECTOR_DOCUMENT_ERROR_MESSAGE,
  type AptVectorDoc,
  buildVectorNodes,
  connectWallJunctions,
  normalizeAptVectorDocForGuide,
  selectAptGuideForCalibration,
  selectAptGuideForImport,
} from './apt-vector-scene'

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

function weldFixture(walls: AptVectorDoc['walls']): AptVectorDoc {
  return { unit: 'mm', imageSize: [10000, 10000], mmPerPx: 1, walls, openings: [], rooms: [] }
}

const closedRoomDoc: AptVectorDoc = {
  unit: 'mm',
  imageSize: [10000, 10000],
  mmPerPx: 1,
  walls: [
    {
      id: 'closed-bottom',
      kind: 'exterior',
      start: [3000, 3000],
      end: [7000, 3000],
      thickness: 200,
    },
    {
      id: 'closed-right',
      kind: 'exterior',
      start: [7000, 3000],
      end: [7000, 7000],
      thickness: 200,
    },
    { id: 'closed-top', kind: 'exterior', start: [7000, 7000], end: [3000, 7000], thickness: 200 },
    { id: 'closed-left', kind: 'exterior', start: [3000, 7000], end: [3000, 3000], thickness: 200 },
  ],
  openings: [],
  rooms: [],
}

const p30AtomicHostDoc: AptVectorDoc = {
  source: '3FO3TOWE773J.jpg',
  unit: 'mm',
  docVersion: 15,
  imageSize: [2484, 1656],
  mmPerPx: 9.452211127015419,
  walls: [
    {
      id: 'w6',
      kind: 'interior',
      start: [10057.2, 6257.4],
      end: [10057.2, 4319.7],
      thickness: 144.4,
    },
    {
      id: 'w22',
      kind: 'exterior',
      start: [11503.3, 3988.8],
      end: [11503.3, 3686.4],
      thickness: 234.7,
    },
    {
      id: 'w55',
      kind: 'exterior',
      start: [11522.2, 2920.7],
      end: [11503.3, 3213.8],
      thickness: 162.5,
    },
    {
      id: 'w56',
      kind: 'exterior',
      start: [11503.3, 3213.8],
      end: [11418.3, 3308.3],
      thickness: 162.5,
    },
    {
      id: 'w57',
      kind: 'exterior',
      start: [11418.3, 3308.3],
      end: [11408.8, 3459.5],
      thickness: 162.5,
    },
    {
      id: 'w58',
      kind: 'exterior',
      start: [11408.8, 3459.5],
      end: [11408.8, 3591.8],
      thickness: 162.5,
    },
    {
      id: 'w59',
      kind: 'exterior',
      start: [11408.8, 3591.8],
      end: [11503.3, 3686.4],
      thickness: 162.5,
    },
  ],
  openings: [
    {
      id: 'o2',
      type: 'door',
      a: [10168.3, 4297.2],
      b: [10853.9, 4158.7],
      wallThickness: 270.8,
      src: 'pair',
      hinge: [10853.9, 4158.7],
      radius: 699.5,
    },
  ],
  rooms: [],
  metrics: {
    planId: '3FO3TOWE773J',
    style: 'standard',
    wallIoU: 0.851,
    scale: 9.452,
    walls: 75,
    doors: 12,
    windows: 12,
    openings: 5,
    rooms: 14,
  },
}

// A compact source-backed slice of p30's entrance cluster.  The three source
// walls are enough to prove the dual-jamb decision without coupling the unit
// test to the full candidate document or to its room labels.
const p30DualJambDoc: AptVectorDoc = {
  unit: 'mm',
  imageSize: [20000, 10000],
  mmPerPx: 1,
  walls: [
    {
      id: 'w6',
      kind: 'interior',
      start: [10057.2, 6257.4],
      end: [10057.2, 4319.7],
      thickness: 144.4,
    },
    {
      id: 'w19',
      kind: 'exterior',
      start: [8648.8, 4319.7],
      end: [10057.2, 4319.7],
      thickness: 270.8,
    },
    {
      id: 'w52',
      kind: 'exterior',
      start: [10000.4, 4310.2],
      end: [10047.7, 4177.9],
      thickness: 237.8,
    },
    {
      id: 'w45',
      kind: 'exterior',
      start: [10992.9, 4130.6],
      end: [11446.6, 4130.6],
      thickness: 270.8,
    },
    {
      id: 'w60',
      kind: 'interior',
      start: [11504.6, 4385.8],
      end: [11503.3, 4187.3],
      thickness: 161.3,
    },
    {
      id: 'w67',
      kind: 'interior',
      start: [11504.6, 4385.8],
      end: [11504.6, 4026.6],
      thickness: 144.4,
    },
    {
      id: 'w68',
      kind: 'interior',
      start: [11503.3, 3988.8],
      end: [11503.3, 4348],
      thickness: 234.7,
    },
  ],
  openings: [
    {
      id: 'o2',
      type: 'door',
      a: [10168.3, 4297.2],
      b: [10853.9, 4158.7],
      wallThickness: 270.8,
      src: 'pair',
    },
    {
      id: 'o21',
      type: 'door',
      a: [10170.6, 4216.8],
      b: [10860.6, 4176.8],
      wallThickness: 151.2,
      src: 'frame',
    },
    {
      id: 'o22',
      type: 'door',
      a: [10170.6, 4075],
      b: [10860.6, 4035],
      wallThickness: 151.2,
      src: 'frame',
    },
    {
      id: 'o28',
      type: 'door',
      a: [10142.2, 4319.7],
      b: [11428.9, 4319.7],
      wallThickness: 270.8,
      src: 'ray',
      barrierA: [10057.2, 4319.7],
      barrierB: [11446.6, 4319.7],
      barrierThickness: 270.8,
    },
  ],
  rooms: [],
}

function polygonSignature(points: readonly [number, number][]): string {
  return points
    .map(([x, y]) => [Math.round(x * 1e6), Math.round(y * 1e6)] as const)
    .sort(([ax, ay], [bx, by]) => ax - bx || ay - by)
    .map(([x, y]) => `${x},${y}`)
    .join(';')
}

function polygonArea(points: readonly [number, number][]): number {
  return Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]!
      return sum + point[0] * next[1] - next[0] * point[1]
    }, 0) / 2,
  )
}

function fixtureLevelPoint(point: [number, number]): [number, number] {
  return [(point[0] - 5000) / 1000, (point[1] - 5000) / 1000]
}

function pointDistance(a: [number, number], b: [number, number]): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function pointToSegmentDistance(
  point: [number, number],
  start: [number, number],
  end: [number, number],
): number {
  const dx = end[0] - start[0]
  const dy = end[1] - start[1]
  const lengthSquared = dx * dx + dy * dy
  const t = Math.max(
    0,
    Math.min(
      1,
      lengthSquared === 0
        ? 0
        : ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared,
    ),
  )
  return pointDistance(point, [start[0] + t * dx, start[1] + t * dy])
}

function withoutP30Barriers(input: AptVectorDoc): AptVectorDoc {
  return {
    ...structuredClone(input),
    openings: input.openings.map((opening) => {
      if (opening.id !== 'o28') return { ...opening }
      const {
        barrierA: _barrierA,
        barrierB: _barrierB,
        barrierThickness: _barrierThickness,
        ...rest
      } = opening
      return rest
    }),
  }
}

function canonicalVectorScene(scene: ReturnType<typeof buildVectorNodes>) {
  if (!scene) return null
  const wallIdentity = new Map(
    scene.walls.map((wall) => [
      wall.id,
      JSON.stringify({ start: wall.start, end: wall.end, thickness: wall.thickness }),
    ]),
  )
  const normalize = (value: unknown, key = ''): unknown => {
    if (key === 'id' || key === 'parentId') return undefined
    if (key === 'wallId') return wallIdentity.get(value as string) ?? value
    if (key === 'children') return Array.isArray(value) ? value.length : value
    if (Array.isArray(value)) return value.map((item) => normalize(item)).sort(sortCanonical)
    if (!value || typeof value !== 'object') return value
    const record = value as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(record)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entryKey, entryValue]) => [entryKey, normalize(entryValue, entryKey)])
        .filter(([, entryValue]) => entryValue !== undefined),
    )
  }
  const sorted = (items: readonly unknown[]) =>
    items.map((item) => normalize(item)).sort(sortCanonical)
  return {
    walls: sorted(scene.walls),
    openings: sorted(scene.openings),
    zones: sorted(scene.zones),
    slabs: sorted(scene.slabs),
    ceilings: sorted(scene.ceilings),
    guideScale: scene.guideScale,
    diagnostics: normalize(scene.diagnostics),
  }
}

function sortCanonical(left: unknown, right: unknown): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right))
}

function p30WithOpening(opening: AptVectorDoc['openings'][number]): AptVectorDoc {
  return {
    ...p30DualJambDoc,
    openings: [...p30DualJambDoc.openings, opening],
  }
}

function hasApprovedP30Host(scene: ReturnType<typeof buildVectorNodes>): boolean {
  const winner = scene?.openings.find((opening) => opening.metadata?.sourceOpeningId === 'o28')
  if (!winner) return false
  const host = scene.walls.find((wall) => wall.id === winner.wallId)
  if (!host) return false
  const expectedStart: [number, number] = [0.0572, -0.6803]
  const expectedEnd: [number, number] = [1.5033, -0.6803]
  const envelopeMatches =
    (pointDistance(host.start, expectedStart) <= 1e-6 &&
      pointDistance(host.end, expectedEnd) <= 1e-6) ||
    (pointDistance(host.start, expectedEnd) <= 1e-6 &&
      pointDistance(host.end, expectedStart) <= 1e-6)
  return envelopeMatches && host.thickness === DEFAULT_WALL_THICKNESS && winner.width > 1.28
}

function expectP30OrdinaryParity(variant: AptVectorDoc): void {
  const guardedInput = structuredClone(variant)
  const ordinaryInput = withoutP30Barriers(variant)
  const guardedBefore = structuredClone(guardedInput)
  const ordinaryBefore = structuredClone(ordinaryInput)
  const guarded = buildVectorNodes(guardedInput)
  const ordinary = buildVectorNodes(ordinaryInput)
  expect(guarded).not.toBeNull()
  expect(ordinary).not.toBeNull()
  expect(guardedInput).toEqual(guardedBefore)
  expect(ordinaryInput).toEqual(ordinaryBefore)
  expect(canonicalVectorScene(guarded)).toEqual(canonicalVectorScene(ordinary))
  expect(hasApprovedP30Host(guarded)).toBe(false)
}

function scaleGuide(overrides: Record<string, unknown> = {}) {
  return GuideNode.parse({
    id: 'guide_scale_reference',
    parentId: 'level_scale_reference',
    url: 'asset://scale-reference',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: 0.8,
    scaleReference: {
      start: [0, 0],
      end: [6.76, 0],
      realLengthMeters: 6.76,
      measuredLengthUnits: 6.76,
      metersPerUnit: 1,
      label: '6760 mm',
    },
    metadata: { apartmentId: 'apt_scale_reference', planId: 'plan_scale_reference' },
    ...overrides,
  })
}

function scaleContext(guide = scaleGuide()) {
  return {
    guide,
    levelId: 'level_scale_reference',
    apartmentId: 'apt_scale_reference',
    planId: 'plan_scale_reference',
  }
}

const pixelScaleDoc: AptVectorDoc = {
  unit: 'px',
  imageSize: [800, 600],
  mmPerPx: null,
  docVersion: 15,
  walls: [{ id: 'pixel-wall', kind: 'exterior', start: [10, 20], end: [30, 20], thickness: 2 }],
  openings: [
    {
      id: 'pixel-opening',
      type: 'door',
      a: [10, 20],
      b: [15, 20],
      wallThickness: 2,
      hinge: [11, 20],
      radius: 4,
      barrierA: [9, 20],
      barrierB: [16, 20],
      barrierThickness: 3,
    },
  ],
  rooms: [
    {
      id: 'pixel-room',
      name: null,
      cls: 'living',
      areaM2: 12.3,
      polygon: [
        [1, 2],
        [3, 2],
        [3, 4],
      ],
    },
  ],
  metrics: { style: 'plain', wallIoU: 0.8 },
}

describe('normalizeAptVectorDocForGuide', () => {
  test('selects an explicitly selected strict guide and rejects duplicate ambiguity', () => {
    const first = scaleGuide({ id: 'guide_first' })
    const second = scaleGuide({ id: 'guide_second' })
    expect(selectAptGuideForCalibration([first], null)?.id).toBe('guide_first')
    expect(selectAptGuideForCalibration([first, second], 'guide_second')?.id).toBe('guide_second')
    expect(selectAptGuideForCalibration([first, second], null)).toBeNull()
    expect(selectAptGuideForCalibration([first, second], 'unrelated')).toBeNull()
  })

  test('preserves the established millimetre guide candidate while pixel recovery is strict', () => {
    const candidate = scaleGuide({ id: 'guide_legacy_candidate' })
    const strict = scaleGuide({ id: 'guide_strict_same_plan' })

    expect(selectAptGuideForImport(candidate, strict, false)).toBe(candidate)
    expect(selectAptGuideForImport(candidate, strict, true)).toBe(strict)
    expect(selectAptGuideForImport(candidate, null, true)).toBeNull()
  })

  test('converts a pixel document from a strict same-guide Set Scale reference', () => {
    const original = structuredClone(pixelScaleDoc)
    const result = normalizeAptVectorDocForGuide(pixelScaleDoc, scaleContext())
    expect(result).toMatchObject({
      ok: true,
      doc: { unit: 'mm', mmPerPx: 10 },
      calibration: {
        source: 'guide-reference',
        guideId: 'guide_scale_reference',
        guideScale: 0.8,
        mmPerPx: 10,
      },
    })
    if (!result.ok) return
    expect(result.doc).not.toBe(pixelScaleDoc)
    expect(result.doc.walls[0]).toMatchObject({
      start: [100, 200],
      end: [300, 200],
      thickness: 20,
    })
    expect(result.doc.openings[0]).toMatchObject({
      a: [100, 200],
      b: [150, 200],
      wallThickness: 20,
      hinge: [110, 200],
      radius: 40,
      barrierA: [90, 200],
      barrierB: [160, 200],
      barrierThickness: 30,
    })
    expect(result.doc.rooms[0]?.polygon).toEqual([
      [10, 20],
      [30, 20],
      [30, 40],
    ])
    expect(result.doc.docVersion).toBe(15)
    expect(result.doc.metrics).toEqual(pixelScaleDoc.metrics)
    expect(pixelScaleDoc).toEqual(original)
  })

  test('passes recovered millimetres through without a second scale', () => {
    const pixelClosed: AptVectorDoc = {
      unit: 'px',
      imageSize: [1000, 1000],
      mmPerPx: null,
      walls: closedRoomDoc.walls.map((wall) => ({
        ...wall,
        start: [wall.start[0] / 10, wall.start[1] / 10],
        end: [wall.end[0] / 10, wall.end[1] / 10],
        thickness: wall.thickness / 10,
      })),
      openings: [],
      rooms: [],
    }
    const guide = scaleGuide({
      scale: 1.25,
      scaleReference: {
        start: [0, 0],
        end: [10, 0],
        realLengthMeters: 10,
        measuredLengthUnits: 10,
        metersPerUnit: 1,
        label: '10000 mm',
      },
    })
    const normalized = normalizeAptVectorDocForGuide(pixelClosed, scaleContext(guide))
    expect(normalized.ok).toBe(true)
    if (!normalized.ok) return
    const frame = {
      scale: 1.25,
      position: [3, 0, 4] as [number, number, number],
      rotationY: 0.3,
      flipX: true,
      flipY: false,
    }
    const recovered = buildVectorNodes(normalized.doc, frame)!
    const direct = buildVectorNodes(closedRoomDoc, frame)!
    expect(recovered.guideScale).toBeCloseTo(1.25)
    expect(recovered.walls.map(segLenOf).sort()).toEqual(direct.walls.map(segLenOf).sort())
    expect(recovered.walls.map((wall) => wall.start)).toEqual(
      direct.walls.map((wall) => wall.start),
    )
    expect(recovered.slabs[0]?.polygon).toEqual(direct.slabs[0]?.polygon)
  })

  test('keeps already calibrated millimetre documents unchanged', () => {
    const result = normalizeAptVectorDocForGuide(doc)
    expect(result).toEqual({ ok: true, doc, calibration: null })
    expect(result.ok && result.doc).toBe(doc)
  })

  test('rejects missing, mismatched, and placeholder guide calibration', () => {
    const cases = [
      [null, 'guide-required'],
      [scaleGuide({ metadata: { planId: 'plan_scale_reference' } }), 'guide-identity-mismatch'],
      [
        scaleGuide({
          metadata: { apartmentId: 'other-apartment', planId: 'plan_scale_reference' },
        }),
        'guide-identity-mismatch',
      ],
      [
        scaleGuide({ metadata: { apartmentId: 'apt_scale_reference', planId: 'other-plan' } }),
        'guide-identity-mismatch',
      ],
      [scaleGuide({ parentId: 'other-level' }), 'guide-identity-mismatch'],
      [scaleGuide({ scaleReference: null }), 'missing-scale-reference'],
      [scaleGuide({ scale: 1, scaleReference: null }), 'missing-scale-reference'],
    ] as const
    for (const [guide, code] of cases) {
      const result = normalizeAptVectorDocForGuide(
        pixelScaleDoc,
        guide ? scaleContext(guide) : null,
      )
      expect(result).toMatchObject({ ok: false, code, message: APT_GUIDE_SCALE_RECOVERY_MESSAGE })
    }
  })

  test('rejects stale or internally inconsistent Set Scale references', () => {
    const stale = scaleGuide({
      scaleReference: {
        start: [0, 0],
        end: [6.76, 0],
        realLengthMeters: 6.76,
        measuredLengthUnits: 8.45,
        metersPerUnit: 0.8,
        label: '6760 mm',
      },
    })
    const mismatched = scaleGuide({
      scaleReference: {
        start: [0, 0],
        end: [6.8, 0],
        realLengthMeters: 6.76,
        measuredLengthUnits: 6.76,
        metersPerUnit: 1,
        label: '6760 mm',
      },
    })
    for (const guide of [stale, mismatched]) {
      expect(normalizeAptVectorDocForGuide(pixelScaleDoc, scaleContext(guide))).toMatchObject({
        ok: false,
        code: 'inconsistent-scale-reference',
        message: APT_GUIDE_SCALE_RECOVERY_MESSAGE,
      })
    }
  })

  test('rejects non-planar, non-finite, ambiguous, and malformed vector input', () => {
    expect(
      normalizeAptVectorDocForGuide({ ...pixelScaleDoc, unit: 'mm', mmPerPx: null }),
    ).toMatchObject({
      ok: false,
      code: 'invalid-mm-scale',
      message: APT_VECTOR_DOCUMENT_ERROR_MESSAGE,
    })
    expect(
      normalizeAptVectorDocForGuide({ ...pixelScaleDoc, mmPerPx: 2 }, scaleContext()),
    ).toMatchObject({
      ok: false,
      code: 'ambiguous-units',
      message: APT_VECTOR_DOCUMENT_ERROR_MESSAGE,
    })
    expect(
      normalizeAptVectorDocForGuide(
        { ...pixelScaleDoc, imageSize: [Infinity, 600] },
        scaleContext(),
      ),
    ).toMatchObject({ ok: false, code: 'invalid-pixel-document' })
    const invalidReference = scaleGuide()
    invalidReference.scaleReference!.start[0] = Number.NaN
    expect(
      normalizeAptVectorDocForGuide(pixelScaleDoc, scaleContext(invalidReference)),
    ).toMatchObject({
      ok: false,
      code: 'invalid-scale-reference',
      message: APT_GUIDE_SCALE_RECOVERY_MESSAGE,
    })
    expect(
      normalizeAptVectorDocForGuide(
        pixelScaleDoc,
        scaleContext(scaleGuide({ rotation: [0.1, 0, 0] })),
      ),
    ).toMatchObject({ ok: false, code: 'invalid-guide-transform' })
    expect(
      normalizeAptVectorDocForGuide(
        { ...pixelScaleDoc, walls: [{ ...pixelScaleDoc.walls[0]!, thickness: Number.MAX_VALUE }] },
        scaleContext(),
      ),
    ).toMatchObject({ ok: false, code: 'invalid-pixel-document' })
  })
})

describe('buildVectorNodes', () => {
  test('fixes automatic walls at 100 mm concrete with concrete-plate finishes across guide scales', () => {
    const input = structuredClone(doc)
    const before = structuredClone(input)

    for (const scale of [undefined, 0.5, 2] as const) {
      const built = buildVectorNodes(input, scale === undefined ? {} : { scale })!
      expect(built.walls.length).toBeGreaterThan(0)
      for (const wall of built.walls) {
        expect(wall.thickness).toBe(DEFAULT_WALL_THICKNESS)
        expect(getWallConstructionEnvelopeThickness(wall)).toBeCloseTo(DEFAULT_WALL_THICKNESS)
        expect(wall.faceBands?.construction?.upper).toMatchObject({
          layers: [{ kind: 'concrete', thickness: DEFAULT_WALL_THICKNESS }],
        })
        expect(wall.faceBands?.construction?.upper?.layers).toHaveLength(1)
        expect(wall.slots).toEqual({
          interior: 'library:concrete-plate',
          exterior: 'library:concrete-plate',
        })
      }
      for (const opening of built.openings) {
        const host = built.walls.find((wall) => wall.id === opening.wallId)
        expect(host?.thickness).toBe(DEFAULT_WALL_THICKNESS)
        expect(host).toBeDefined()
      }
    }

    expect(input).toEqual(before)
  })

  test('does not weld a short bevel beyond its original segment length', () => {
    const shortBevel = weldFixture([
      {
        id: 'short-bevel',
        kind: 'interior',
        start: [1000, 2000],
        end: [1127.279, 1872.721],
        thickness: 100,
      },
      { id: 'cross', kind: 'exterior', start: [1693, 500], end: [1693, 1500], thickness: 250 },
      { id: 'far', kind: 'interior', start: [7000, 7000], end: [9000, 7000], thickness: 350 },
    ])

    const built = buildVectorNodes(shortBevel)!
    const wall = built.walls.find((candidate) => candidate.thickness === 0.1)!
    const originalEnd = fixtureLevelPoint([1127.279, 1872.721])
    expect(
      Math.min(pointDistance(wall.start, originalEnd), pointDistance(wall.end, originalEnd)),
    ).toBe(0)
    expect(segLenOf(wall)).toBeCloseTo(0.18)
  })

  test('allows a normal long wall to weld by at most one metre', () => {
    const normal = weldFixture([
      { id: 'long', kind: 'interior', start: [1000, 3000], end: [4000, 3000], thickness: 100 },
      { id: 'cross', kind: 'exterior', start: [4800, 500], end: [4800, 5000], thickness: 250 },
      { id: 'far', kind: 'interior', start: [7000, 7000], end: [9000, 7000], thickness: 350 },
    ])

    const built = buildVectorNodes(normal)!
    const wall = built.walls.find((candidate) => candidate.thickness === 0.1)!
    const originalEnd = fixtureLevelPoint([4000, 3000])
    const weldedEnd = wall.start[0] > wall.end[0] ? wall.start : wall.end
    const movement = pointDistance(weldedEnd, originalEnd)
    expect(movement).toBeCloseTo(0.8)
    expect(movement).toBeLessThanOrEqual(1)
  })

  test('keeps two-pass collinear welds within the original endpoint budget', () => {
    const twoPass = weldFixture([
      { id: 'long', kind: 'interior', start: [1000, 3000], end: [4000, 3000], thickness: 100 },
      { id: 'near', kind: 'exterior', start: [4700, 3100], end: [4850, 3100], thickness: 250 },
      { id: 'far', kind: 'exterior', start: [5200, 3100], end: [5350, 3100], thickness: 350 },
    ])

    const built = buildVectorNodes(twoPass)!
    const wall = built.walls.find((candidate) => candidate.thickness === 0.1)!
    const originalEnd = fixtureLevelPoint([4000, 3000])
    const weldedEnd = wall.start[0] > wall.end[0] ? wall.start : wall.end
    expect(pointDistance(weldedEnd, originalEnd)).toBeLessThanOrEqual(1)
    expect(weldedEnd[0]).toBeCloseTo(fixtureLevelPoint([4700, 3000])[0])
  })

  test('materializes merged wall groups in stable source order', () => {
    const orderedGroups = weldFixture([
      {
        id: 'a',
        kind: 'interior',
        start: [1000, 1000],
        end: [3000, 1000],
        thickness: 250,
      },
      {
        id: 'far',
        kind: 'interior',
        start: [1000, 4000],
        end: [3000, 4000],
        thickness: 250,
      },
      {
        id: 'b',
        kind: 'interior',
        start: [3200, 1000],
        end: [5000, 1000],
        thickness: 250,
      },
    ])

    const built = buildVectorNodes(orderedGroups)!
    expect(built.walls.map((wall) => [wall.start, wall.end])).toEqual([
      [
        [-4, -4],
        [0, -4],
      ],
      [
        [-4, -1],
        [-2, -1],
      ],
    ])
  })

  test('keeps a non-retained exact-contact room closed after weld', () => {
    const exactContactRoom = weldFixture([
      {
        id: 'bottom',
        kind: 'exterior',
        start: [3000, 3000],
        end: [6000, 3000],
        thickness: 200,
      },
      {
        id: 'right',
        kind: 'exterior',
        start: [6800, 3000],
        end: [6800, 7000],
        thickness: 200,
      },
      {
        id: 'top',
        kind: 'exterior',
        start: [6800, 7000],
        end: [3000, 7000],
        thickness: 200,
      },
      {
        id: 'left',
        kind: 'exterior',
        start: [3000, 7000],
        end: [3000, 3000],
        thickness: 200,
      },
      // This ordinary tee touches the bottom centerline exactly but is not a
      // retained source-chain relation. The bottom-right gap still needs the
      // existing weld to close the room.
      {
        id: 'exact-contact-tee',
        kind: 'interior',
        start: [5000, 3000],
        end: [5000, 3400],
        thickness: 120,
      },
    ])

    const built = buildVectorNodes(exactContactRoom)!
    expect(built.slabs).toHaveLength(1)
    expect(built.ceilings).toHaveLength(1)
    expect(built.zones).toHaveLength(1)
    expect(
      built.walls.some(
        (wall) =>
          wall.start[0] === 1.8 && wall.start[1] === -2 && wall.end[0] === 1.8 && wall.end[1] === 2,
      ),
    ).toBe(true)
  })

  test('rejects a crossing that overruns a mutually dangling short wall', () => {
    const mutual = weldFixture([
      { id: 'long', kind: 'interior', start: [1000, 3000], end: [2000, 3000], thickness: 100 },
      { id: 'short', kind: 'exterior', start: [2800, 2000], end: [2800, 2180], thickness: 250 },
      { id: 'far', kind: 'interior', start: [7000, 7000], end: [9000, 7000], thickness: 350 },
    ])

    const built = buildVectorNodes(mutual)!
    const wall = built.walls.find((candidate) => candidate.thickness === 0.1)!
    const originalEnd = fixtureLevelPoint([2000, 3000])
    const weldedEnd = wall.start[0] > wall.end[0] ? wall.start : wall.end
    expect(pointDistance(weldedEnd, originalEnd)).toBe(0)
  })

  test('keeps the p03 source-outside fake peak out of imported endpoints', () => {
    const source: AptVectorDoc = {
      source: '3FO3YJE3RM5X.jpg',
      unit: 'mm',
      docVersion: 13,
      imageSize: [2484, 1656],
      mmPerPx: 4.7746848146401675,
      walls: [
        {
          id: 'w13',
          kind: 'exterior',
          start: [3008.1, 1692.6],
          end: [3135.8, 1564.9],
          thickness: 141.4,
        },
        {
          id: 'w18',
          kind: 'exterior',
          start: [3800.6, 1566.1],
          end: [3929, 1694.5],
          thickness: 145.9,
        },
        {
          id: 'w0',
          kind: 'exterior',
          start: [3022.4, 5729.6],
          end: [8336.6, 5729.6],
          thickness: 246.2,
        },
      ],
      openings: [],
      rooms: [],
    }
    const baseline = {
      walls: [
        {
          start: [-2.462558539783087, -2.720339026522058],
          end: [-2.002058539783088, -2.2598390265220587],
        },
      ],
    }
    const built = buildVectorNodes(source)!
    const sourceScale = source.mmPerPx! * 2
    const sourcePoint: [number, number] = [363, 140]
    const sourceToPixels = ([x, y]: [number, number]): [number, number] => [
      x / sourceScale,
      y / sourceScale,
    ]
    const levelToPixels = ([x, y]: [number, number]): [number, number] => [
      (x * 1000 + (source.imageSize[0] * source.mmPerPx!) / 2) / sourceScale,
      (y * 1000 + (source.imageSize[1] * source.mmPerPx!) / 2) / sourceScale,
    ]
    const sourceWallDistance = Math.min(
      ...source.walls.map((wall) =>
        pointToSegmentDistance(sourcePoint, sourceToPixels(wall.start), sourceToPixels(wall.end)),
      ),
    )
    const endpointDistance = (walls: { start: [number, number]; end: [number, number] }[]) =>
      Math.min(
        ...walls
          .flatMap((wall) => [levelToPixels(wall.start), levelToPixels(wall.end)])
          .map((point) => pointDistance(sourcePoint, point)),
      )

    expect(sourceWallDistance).toBeGreaterThan(30)
    expect(endpointDistance(baseline.walls)).toBeLessThan(15)
    expect(
      endpointDistance(built.walls.map((wall) => ({ start: wall.start, end: wall.end }))),
    ).toBeGreaterThan(30)
  })

  test('creates room zones from closed walls when the vector document has no room labels', () => {
    const unlabeled: AptVectorDoc = {
      unit: 'mm',
      imageSize: [1000, 1000],
      mmPerPx: 1,
      walls: [
        { id: 'empty-bottom', kind: 'exterior', start: [0, 0], end: [4000, 0], thickness: 200 },
        {
          id: 'empty-right',
          kind: 'exterior',
          start: [4000, 0],
          end: [4000, 3000],
          thickness: 200,
        },
        { id: 'empty-top', kind: 'exterior', start: [4000, 3000], end: [0, 3000], thickness: 200 },
        { id: 'empty-left', kind: 'exterior', start: [0, 3000], end: [0, 0], thickness: 200 },
      ],
      openings: [],
      rooms: [],
    }

    const built = buildVectorNodes(unlabeled)!
    expect(built.zones).toHaveLength(1)
    expect(built.zones[0]).toMatchObject({
      autoFromWalls: true,
      spaceRole: 'room',
      enclosureStatus: 'enclosed',
      metadata: { source: 'apt-vector', generatedFrom: 'detected-space' },
    })
    expect(built.zones[0]?.boundaryWallIds).toHaveLength(4)
  })

  test('creates one default auto slab and heightless auto ceiling from final closed walls', () => {
    const built = buildVectorNodes(closedRoomDoc)!

    expect(built.slabs).toHaveLength(1)
    expect(built.ceilings).toHaveLength(1)
    expect(built.slabs[0]).toMatchObject({ autoFromWalls: true, elevation: 0.05, metadata: {} })
    expect(built.ceilings[0]).toMatchObject({ autoFromWalls: true, metadata: {} })
    expect(built.ceilings[0]?.height).toBeUndefined()
  })

  test('suppresses manual and retained auto surface coverage without suppressing a far room', () => {
    const base = buildVectorNodes(closedRoomDoc)!
    const room = base.slabs[0]!.polygon
    const surface = (polygon: [number, number][], autoFromWalls: boolean, id: string) => ({
      slab: SlabNode.parse({ id: `slab_${id}`, polygon, autoFromWalls }),
      ceiling: CeilingNode.parse({ id: `ceiling_${id}`, polygon, autoFromWalls }),
    })
    const exact = surface(room, false, 'exact')
    const containing = surface(
      [
        [-3, -3],
        [3, -3],
        [3, 3],
        [-3, 3],
      ],
      false,
      'containing',
    )
    const left = surface(
      [
        [-2, -2],
        [0, -2],
        [0, 2],
        [-2, 2],
      ],
      false,
      'left',
    )
    const right = surface(
      [
        [0, -2],
        [2, -2],
        [2, 2],
        [0, 2],
      ],
      false,
      'right',
    )
    const far = surface(
      [
        [10, 10],
        [11, 10],
        [11, 11],
        [10, 11],
      ],
      false,
      'far',
    )
    const retainedAuto = surface(room, true, 'retained-auto')
    const buildWith = (slabNodes: (typeof exact.slab)[], ceilingNodes: (typeof exact.ceiling)[]) =>
      buildVectorNodes(
        closedRoomDoc,
        {},
        {
          existingSlabs: slabNodes,
          existingCeilings: ceilingNodes,
        },
      )!

    expect(buildWith([exact.slab], [exact.ceiling]).slabs).toHaveLength(0)
    expect(buildWith([containing.slab], [containing.ceiling]).ceilings).toHaveLength(0)
    expect(buildWith([left.slab, right.slab], [left.ceiling, right.ceiling])).toMatchObject({
      slabs: [],
      ceilings: [],
    })
    expect(buildWith([far.slab], [far.ceiling])).toMatchObject({
      slabs: [{ autoFromWalls: true }],
      ceilings: [{ autoFromWalls: true }],
    })
    expect(buildWith([retainedAuto.slab], [retainedAuto.ceiling])).toMatchObject({
      slabs: [],
      ceilings: [],
    })
  })

  test('does not create surfaces from an open wall loop or a source room polygon', () => {
    const built = buildVectorNodes({
      ...closedRoomDoc,
      walls: closedRoomDoc.walls.slice(0, 3),
      rooms: [
        {
          id: 'source-room',
          name: '거실',
          cls: 'living',
          areaM2: 16,
          polygon: [
            [3200, 3200],
            [6800, 3200],
            [6800, 6800],
            [3200, 6800],
          ],
        },
      ],
    })!

    expect(built.zones).toHaveLength(1)
    expect(built.slabs).toHaveLength(0)
    expect(built.ceilings).toHaveLength(0)
  })

  test('derives transformed surface signatures from final walls after frame rotation, flip, and scale', () => {
    const base = buildVectorNodes(closedRoomDoc)!
    const framed = buildVectorNodes(closedRoomDoc, {
      flipX: true,
      rotationY: Math.PI / 2,
      scale: 1.5,
      position: [2, 0, -3],
    })!
    const finalSpaces = detectSpacesForLevel('apt-vector-frame-proof', framed.walls).spaces

    expect(finalSpaces).toHaveLength(1)
    expect(framed.slabs).toHaveLength(1)
    expect(framed.ceilings).toHaveLength(1)
    expect(polygonSignature(framed.slabs[0]!.polygon)).toBe(
      polygonSignature(finalSpaces[0]!.polygon),
    )
    expect(polygonSignature(framed.ceilings[0]!.polygon)).toBe(
      polygonSignature(finalSpaces[0]!.polygon),
    )
    expect(polygonSignature(framed.slabs[0]!.polygon)).not.toBe(
      polygonSignature(base.slabs[0]!.polygon),
    )
    expect(polygonArea(framed.slabs[0]!.polygon)).toBeCloseTo(
      polygonArea(base.slabs[0]!.polygon) * 1.5 ** 2,
    )
  })

  test('keeps imported node ids unique across walls, openings, zones, and surfaces', () => {
    const built = buildVectorNodes(closedRoomDoc)!
    const nodes = [
      ...built.walls,
      ...built.openings,
      ...built.zones,
      ...built.slabs,
      ...built.ceilings,
    ]
    expect(new Set(nodes.map((node) => node.id)).size).toBe(nodes.length)
  })

  test('applies centered image flips to all planar output and preserves opening semantics', () => {
    const base = buildVectorNodes(doc)!
    const horizontal = buildVectorNodes(doc, { flipX: true })!
    const vertical = buildVectorNodes(doc, { flipY: true })!
    const combined = buildVectorNodes(doc, { flipX: true, flipY: true })!

    for (const [flipped, flipX, flipY] of [
      [horizontal, true, false],
      [vertical, false, true],
      [combined, true, true],
    ] as const) {
      expect(flipped.walls).toHaveLength(base.walls.length)
      expect(flipped.zones).toHaveLength(base.zones.length)
      expect(flipped.guideScale).toBe(base.guideScale)
      for (let index = 0; index < base.walls.length; index += 1) {
        const source = base.walls[index]!
        const target = flipped.walls[index]!
        expect(target.thickness).toBeCloseTo(source.thickness)
        expect(segLenOf(target)).toBeCloseTo(segLenOf(source))
        expect(target.start[0]).toBeCloseTo(flipX ? -source.start[0] : source.start[0])
        expect(target.start[1]).toBeCloseTo(flipY ? -source.start[1] : source.start[1])
        expect(target.end[0]).toBeCloseTo(flipX ? -source.end[0] : source.end[0])
        expect(target.end[1]).toBeCloseTo(flipY ? -source.end[1] : source.end[1])
      }
      for (let index = 0; index < base.zones.length; index += 1) {
        const source = base.zones[index]!
        const target = flipped.zones[index]!
        for (let pointIndex = 0; pointIndex < source.polygon.length; pointIndex += 1) {
          const sourcePoint = source.polygon[pointIndex]!
          const targetPoint = target.polygon[pointIndex]!
          expect(targetPoint[0]).toBeCloseTo(flipX ? -sourcePoint[0] : sourcePoint[0])
          expect(targetPoint[1]).toBeCloseTo(flipY ? -sourcePoint[1] : sourcePoint[1])
        }
      }
      const baseDoor = base.openings.find((opening) => opening.type === 'door')!
      const flippedDoor = flipped.openings.find((opening) => opening.type === 'door')!
      expect(flippedDoor.width).toBeCloseTo(baseDoor.width)
      expect(flippedDoor.position[0]).toBeCloseTo(baseDoor.position[0])
      expect(flippedDoor.hingesSide).toBe(baseDoor.hingesSide)
      expect(flippedDoor.swingDirection).toBe(
        flipX !== flipY
          ? baseDoor.swingDirection === 'inward'
            ? 'outward'
            : 'inward'
          : baseDoor.swingDirection,
      )
      expect(flippedDoor.metadata).toEqual(baseDoor.metadata)
    }
  })

  test('applies a moved, yaw-rotated, uniformly scaled guide frame after extraction', () => {
    const base = buildVectorNodes(doc)!
    const framed = buildVectorNodes(doc, {
      position: [2, 0, 3],
      rotationY: Math.PI / 2,
      scale: 1.5,
    })!
    const transform = ([x, z]: [number, number]) => [2 + 1.5 * z, 3 - 1.5 * x] as [number, number]
    expect(framed.guideScale).toBe(1.5)
    for (let index = 0; index < base.walls.length; index += 1) {
      const source = base.walls[index]!
      const target = framed.walls[index]!
      const expectedStart = transform(source.start)
      const expectedEnd = transform(source.end)
      expect(target.start[0]).toBeCloseTo(expectedStart[0])
      expect(target.start[1]).toBeCloseTo(expectedStart[1])
      expect(target.end[0]).toBeCloseTo(expectedEnd[0])
      expect(target.end[1]).toBeCloseTo(expectedEnd[1])
      expect(target.thickness).toBe(DEFAULT_WALL_THICKNESS)
      expect(target.faceBands?.construction?.upper?.layers[0]?.thickness).toBeCloseTo(
        DEFAULT_WALL_THICKNESS,
      )
    }
    const baseDoor = base.openings.find((opening) => opening.type === 'door')!
    const framedDoor = framed.openings.find((opening) => opening.type === 'door')!
    expect(framedDoor.width).toBeCloseTo(baseDoor.width * 1.5)
    expect(framedDoor.position[0]).toBeCloseTo(baseDoor.position[0] * 1.5)
    expect(framedDoor.wallId).toBeTruthy()
    expect(framed.walls.find((wall) => wall.id === framedDoor.wallId)?.children).toContain(
      framedDoor.id,
    )
    expect(framedDoor.metadata).toEqual(baseDoor.metadata)
  })

  test('rejects non-finite or non-positive guide frame scales', () => {
    expect(buildVectorNodes(doc, { scale: 0 })).toBeNull()
    expect(buildVectorNodes(doc, { scale: Number.NaN })).toBeNull()
  })

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
    expect(miters.junctions.get('2000,0')?.connectedWalls).toHaveLength(3)
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

  test('clusters overlapping physical corner contacts while keeping disjoint cuts', () => {
    const cornerContacts: AptVectorDoc = {
      ...doc,
      rooms: [],
      walls: [
        { id: 'host', kind: 'exterior', start: [1000, 4000], end: [9000, 4000], thickness: 200 },
        { id: 'near-a', kind: 'interior', start: [5000, 3000], end: [5000, 5000], thickness: 200 },
        { id: 'near-b', kind: 'interior', start: [5070, 3000], end: [5070, 5000], thickness: 100 },
        { id: 'far', kind: 'interior', start: [8000, 3000], end: [8000, 5000], thickness: 100 },
        {
          id: 'authored-short-a',
          kind: 'interior',
          start: [1000, 7000],
          end: [1133.913, 7000],
          thickness: 100,
        },
        {
          id: 'authored-short-b',
          kind: 'interior',
          start: [2000, 7300],
          end: [2214.082, 7300],
          thickness: 100,
        },
        {
          id: 'authored-short-c',
          kind: 'interior',
          start: [3000, 7600],
          end: [3252.661, 7600],
          thickness: 100,
        },
      ],
      openings: [],
    }
    const built = buildVectorNodes(cornerContacts)!
    const horizontal = built.walls
      .filter(
        (wall) => Math.abs(wall.start[1]) < 1e-7 && Math.abs(wall.end[1] - wall.start[1]) < 1e-7,
      )
      .sort((a, b) => a.start[0] - b.start[0])

    expect(horizontal).toHaveLength(3)
    expect(segLenOf(horizontal[0]!)).toBeCloseTo(4)
    expect(segLenOf(horizontal[1]!)).toBeCloseTo(3)
    expect(segLenOf(horizontal[2]!)).toBeCloseTo(1)
    expect(built.walls.every((wall) => segLenOf(wall) >= 0.12)).toBe(true)
    expect(horizontal[1]?.start[0]).toBeCloseTo(0)
    expect(horizontal[1]?.end[0]).toBeCloseTo(3)
    const authoredShorts = built.walls
      .filter((wall) => segLenOf(wall) < 0.3)
      .map(segLenOf)
      .sort((a, b) => a - b)
    expect(authoredShorts).toHaveLength(3)
    expect(authoredShorts[0]).toBeCloseTo(0.133913, 5)
    expect(authoredShorts[1]).toBeCloseTo(0.214082, 5)
    expect(authoredShorts[2]).toBeCloseTo(0.252661, 5)
  })

  test('keeps a short host whole when one corner band touches both endpoints', () => {
    const host = WallNode.parse({ start: [-0.25, 0], end: [0.25, 0], thickness: 0.2 })
    const vertical = WallNode.parse({ start: [-0.1, -0.15], end: [-0.1, 0.15], thickness: 0.3 })
    const diagonal = WallNode.parse({ start: [0.025, -0.075], end: [0.175, 0.075], thickness: 0.3 })
    const connected = connectWallJunctions([host, vertical, diagonal], [])
    const hostSegments = connected.walls.filter((wall) => wall.thickness === 0.2)
    expect(hostSegments).toHaveLength(1)
    expect(hostSegments[0]!.start[0]).toBeCloseTo(-0.25)
    expect(hostSegments[0]!.end[0]).toBeCloseTo(0.25)
    expect(segLenOf(hostSegments[0]!)).toBeCloseTo(0.5)
  })

  test('keeps an opening guard local to the affected contact cluster', () => {
    const built = buildVectorNodes({
      ...doc,
      rooms: [],
      walls: [
        { id: 'host', kind: 'exterior', start: [1000, 4000], end: [9000, 4000], thickness: 200 },
        { id: 'near-a', kind: 'interior', start: [5000, 3000], end: [5000, 5000], thickness: 200 },
        { id: 'near-b', kind: 'interior', start: [5070, 3000], end: [5070, 5000], thickness: 100 },
        { id: 'far', kind: 'interior', start: [8000, 3000], end: [8000, 5000], thickness: 100 },
      ],
      openings: [
        { id: 'door', type: 'door', a: [4600, 4000], b: [5400, 4000], wallThickness: 200 },
      ],
    })!
    const host = built.walls.find(
      (wall) => Math.abs(wall.start[1]) < 1e-7 && wall.children.length > 0,
    )!
    const horizontal = built.walls
      .filter(
        (wall) => Math.abs(wall.start[1]) < 1e-7 && Math.abs(wall.end[1] - wall.start[1]) < 1e-7,
      )
      .sort((a, b) => a.start[0] - b.start[0])
    expect(horizontal).toHaveLength(2)
    expect(segLenOf(horizontal[0]!)).toBeCloseTo(7)
    expect(segLenOf(horizontal[1]!)).toBeCloseTo(1)
    expect(segLenOf(host)).toBeCloseTo(7)
    expect(host.children).toHaveLength(1)
    const opening = built.openings[0]!
    expect(opening.parentId).toBe(host.id)
    expect(opening.wallId).toBe(host.id)
  })

  test('reconciles apartment zones to finalized T-split wall spaces', () => {
    const tPlan: AptVectorDoc = {
      unit: 'mm',
      imageSize: [1000, 1000],
      mmPerPx: 10,
      walls: [
        { id: 'bottom', kind: 'exterior', start: [1000, 1000], end: [9000, 1000], thickness: 200 },
        { id: 'right', kind: 'exterior', start: [9000, 1000], end: [9000, 9000], thickness: 200 },
        { id: 'top', kind: 'exterior', start: [9000, 9000], end: [1000, 9000], thickness: 200 },
        { id: 'left', kind: 'exterior', start: [1000, 9000], end: [1000, 1000], thickness: 200 },
        { id: 'branch', kind: 'interior', start: [3000, 1000], end: [3000, 4000], thickness: 100 },
      ],
      openings: [],
      rooms: [
        {
          id: 'r1',
          name: '거실',
          cls: 'living',
          areaM2: 60,
          polygon: [
            [1100, 1100],
            [8900, 1100],
            [8900, 8900],
            [1100, 8900],
          ],
        },
      ],
    }

    const built = buildVectorNodes(tPlan)!
    const expectedSpace = detectSpacesForLevel('apt-vector-import', built.walls).spaces[0]!
    const zone = built.zones[0]!
    const bottomSegments = built.walls.filter(
      (wall) => Math.abs(wall.start[1] + 4) < 1e-7 && Math.abs(wall.end[1] + 4) < 1e-7,
    )
    const branch = built.walls.find(
      (wall) =>
        Math.abs(wall.start[0] + 2) < 1e-7 &&
        Math.abs(wall.end[0] + 2) < 1e-7 &&
        Math.abs(wall.end[1] - wall.start[1]) > 1,
    )

    expect(bottomSegments).toHaveLength(2)
    for (const wall of bottomSegments) expect(expectedSpace.wallIds).toContain(wall.id)
    expect(zone.autoFromWalls).toBe(true)
    expect(zone.clearDimensionPolicy).toBe('finish-faces')
    expect(zone.polygon).toEqual(expectedSpace.polygon)
    expect(new Set(zone.boundaryWallIds)).toEqual(new Set(expectedSpace.wallIds))
    expect(zone.metadata).toMatchObject({ source: 'apt-vector', sourceRoomId: 'r1', cls: 'living' })
    expect(zone.name).toBe('거실')
    expect(zone.color).toBe('#8f8878')
    expect(branch).toBeDefined()
    expect(zone.boundaryWallIds).not.toContain(branch?.id)
    expect(
      bottomSegments.every((wall) => wall.frontSide !== 'unknown' && wall.backSide !== 'unknown'),
    ).toBe(true)
  })

  test('uses fixed 100 mm solid concrete and concrete-plate finishes for apartment walls', () => {
    const { walls, openings } = buildVectorNodes(doc)!
    expect(new Set(walls.map((wall) => wall.thickness))).toEqual(new Set([0.1]))
    for (const wall of walls) {
      expect(wall.faceBands?.construction?.upper).toMatchObject({
        mode: 'assembly',
        layers: [{ kind: 'concrete', thickness: wall.thickness, wasteFactor: 0 }],
      })
      expect(wall.faceBands?.construction?.upper?.layers).toHaveLength(1)
      expect(wall.slots).toEqual({
        interior: 'library:concrete-plate',
        exterior: 'library:concrete-plate',
      })
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
    expect(walls).toHaveLength(4)
    expect(walls.filter((wall) => wall.start[0] === 4 && wall.end[0] === 4)).toHaveLength(2)
    const north = walls.find((wall) => wall.start[1] === -3 && wall.end[1] === -3)!
    const [lo, hi] = [north.start[0], north.end[0]].sort((p, q) => p - q)
    expect(lo).toBeCloseTo(-4)
    expect(hi).toBeCloseTo(4)
    expect(north.thickness).toBe(DEFAULT_WALL_THICKNESS)
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
    expect(living.clearDimensionPolicy).toBe('finish-faces')
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
    const cornerV = walls.find(
      (wall) => wall.start[0] === wall.end[0] && Math.abs(wall.start[0] + 4) < 1e-7,
    )!
    const cornerH = walls.find(
      (wall) => wall.start[1] === wall.end[1] && Math.abs(wall.start[1] + 3) < 1e-7,
    )!
    // both legs now reach the shared corner (1000, 1000) mm → (-4, -3) m
    expect(Math.min(cornerV.start[1], cornerV.end[1])).toBeCloseTo(-3)
    expect(Math.min(cornerH.start[0], cornerH.end[0])).toBeCloseTo(-4)
    // the collinear continuation `d` was absorbed into the same wall node
    expect(Math.max(cornerH.start[0], cornerH.end[0])).toBeCloseTo(-1.85)
    // the tee wall extends to wall `a`'s centreline x = -4
    const tee = walls.find(
      (wall) => wall.start[1] === wall.end[1] && Math.abs(wall.start[1] + 2) < 1e-7,
    )!
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
    const retained = built.walls.find((wall) => wall.start[0] === wall.end[0])!
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

  test('rejects an unsafe second synthesized crossing atomically and leaves the opening unhosted', () => {
    const input = structuredClone(p30AtomicHostDoc)
    const before = JSON.stringify(input)
    const built = buildVectorNodes(input)

    expect(built).not.toBeNull()
    expect(JSON.stringify(input)).toBe(before)
    expect(built!.diagnostics.unhostedOpeningIds).toEqual(['o2'])
    expect(built!.diagnostics.dedupedOpeningIds).not.toContain('o2')
    expect(built!.openings.some((opening) => opening.metadata?.sourceOpeningId === 'o2')).toBe(
      false,
    )
    expect(built!.walls.some((wall) => Math.abs(wall.thickness - 0.2708) <= 1e-4)).toBe(false)
  })

  test('keeps p30 on the unique full-span ray and accounts for contained losers', () => {
    const built = buildVectorNodes(p30DualJambDoc)!
    const winner = built.openings.find((opening) => opening.metadata?.sourceOpeningId === 'o28')
    expect(winner).toBeDefined()
    expect(winner!.metadata).toMatchObject({
      sourceOpeningId: 'o28',
      sourceOpeningSource: 'ray',
    })
    expect(winner!.width).toBeCloseTo(1.2867, 6)
    expect(winner!.metadata?.sourceWidthMm).toBeCloseTo(1286.7, 6)
    expect(
      built.openings.filter((opening) => opening.metadata?.sourceOpeningId === 'o28'),
    ).toHaveLength(1)
    expect(
      built.openings.some((opening) =>
        ['o2', 'o21', 'o22'].includes(opening.metadata?.sourceOpeningId as string),
      ),
    ).toBe(false)
    expect(built.diagnostics.dedupedOpeningIds).toEqual(
      expect.arrayContaining(['o2', 'o21', 'o22']),
    )
    expect(built.diagnostics.unhostedOpeningIds).toEqual([])

    const levelPoint = ([x, y]: [number, number]): [number, number] => [
      (x - 10000) / 1000,
      (y - 5000) / 1000,
    ]
    const rawA = levelPoint([10142.2, 4319.7])
    const rawB = levelPoint([11428.9, 4319.7])
    const host = built.walls.find((wall) => wall.id === winner!.wallId)!
    expect(pointToSegmentDistance(rawA, host.start, host.end)).toBeLessThanOrEqual(1e-6)
    expect(pointToSegmentDistance(rawB, host.start, host.end)).toBeLessThanOrEqual(1e-6)
    expect(winner!.width).toBeCloseTo(pointDistance(rawA, rawB), 6)

    const repeat = buildVectorNodes(p30DualJambDoc)!
    const canonical = (scene: ReturnType<typeof buildVectorNodes>) => ({
      walls: scene!.walls.map((wall) => ({
        start: wall.start,
        end: wall.end,
        thickness: wall.thickness,
        children: wall.children.length,
      })),
      openings: scene!.openings.map((opening) => ({
        type: opening.type,
        width: opening.width,
        position: opening.position,
        sourceOpeningId: opening.metadata?.sourceOpeningId,
      })),
      diagnostics: scene!.diagnostics,
    })
    expect(canonical(built)).toEqual(canonical(repeat))
  })

  test('fails the full-span override closed for unsupported p30 cluster variants', () => {
    const variants: AptVectorDoc[] = [
      {
        ...p30DualJambDoc,
        walls: p30DualJambDoc.walls.filter(
          (wall) => !['w45', 'w60', 'w67', 'w68'].includes(wall.id),
        ),
      },
      {
        ...p30DualJambDoc,
        openings: p30DualJambDoc.openings.map((opening) =>
          opening.id === 'o28' ? { ...opening, barrierB: [12000, 4130.6] } : opening,
        ),
      },
      {
        ...p30DualJambDoc,
        openings: [
          ...p30DualJambDoc.openings,
          { ...p30DualJambDoc.openings.find((opening) => opening.id === 'o28')!, id: 'o28b' },
        ],
      },
      {
        ...p30DualJambDoc,
        walls: [
          ...p30DualJambDoc.walls,
          {
            id: 'intermediate-pier',
            kind: 'interior',
            start: [10750, 4100],
            end: [10750, 4450],
            thickness: 150,
          },
        ],
      },
      {
        ...p30DualJambDoc,
        walls: [
          ...p30DualJambDoc.walls,
          {
            id: 'shallow-angle-pier',
            kind: 'interior',
            start: [10600, 4200],
            end: [10900, 4400],
            thickness: 120,
          },
        ],
      },
      {
        ...p30DualJambDoc,
        walls: [
          ...p30DualJambDoc.walls,
          {
            id: 'parallel-pier',
            kind: 'interior',
            start: [10600, 4319.7],
            end: [10900, 4319.7],
            thickness: 120,
          },
        ],
      },
      {
        ...p30DualJambDoc,
        openings: p30DualJambDoc.openings
          .filter((opening) => opening.id === 'o28' || opening.id === 'o21')
          .map((opening) =>
            opening.id === 'o21' ? { ...opening, a: [10300, 4200], b: [10300, 4100] } : opening,
          ),
      },
    ]
    const expectedHostStart = [0.0572, -0.6803] as [number, number]
    const expectedHostEnd = [1.5033, -0.6803] as [number, number]
    for (const variant of variants) {
      const built = buildVectorNodes(variant)!
      expect(built.diagnostics.dedupedOpeningIds).not.toEqual(
        expect.arrayContaining(['o2', 'o21', 'o22']),
      )
      const opening = built.openings.find((item) => item.metadata?.sourceOpeningId === 'o28')
      if (opening) {
        const host = built.walls.find((wall) => wall.id === opening.wallId)!
        const hostMatchesApprovedEnvelope =
          (pointDistance(host.start, expectedHostStart) <= 1e-6 &&
            pointDistance(host.end, expectedHostEnd) <= 1e-6) ||
          (pointDistance(host.start, expectedHostEnd) <= 1e-6 &&
            pointDistance(host.end, expectedHostStart) <= 1e-6)
        expect(hostMatchesApprovedEnvelope).toBe(false)
      }
    }
  })

  test('uses exact source-trace membership and witnesses for the full-span ray', () => {
    const frameFamilyOnly: AptVectorDoc = {
      ...p30DualJambDoc,
      openings: p30DualJambDoc.openings.filter((opening) =>
        ['o21', 'o22', 'o28'].includes(opening.id),
      ),
    }
    const familyBuilt = buildVectorNodes(frameFamilyOnly)!
    expect(familyBuilt.diagnostics.dedupedOpeningIds).toEqual(
      expect.arrayContaining(['o21', 'o22']),
    )

    const perturbedDisplacement = buildVectorNodes({
      ...frameFamilyOnly,
      openings: frameFamilyOnly.openings.map((opening) =>
        opening.id === 'o22' ? { ...opening, b: [10860.61, 4035] } : opening,
      ),
    })!
    expect(perturbedDisplacement.diagnostics.dedupedOpeningIds).not.toContain('o21')

    const perturbedThickness = buildVectorNodes({
      ...frameFamilyOnly,
      openings: frameFamilyOnly.openings.map((opening) =>
        opening.id === 'o22' ? { ...opening, wallThickness: 151.21 } : opening,
      ),
    })!
    expect(perturbedThickness.diagnostics.dedupedOpeningIds).not.toContain('o21')

    const disjointDifferentAxis = buildVectorNodes({
      ...p30DualJambDoc,
      openings: [
        ...p30DualJambDoc.openings,
        {
          id: 'o-disjoint-axis',
          type: 'door',
          a: [10800, 4580],
          b: [10900, 4580],
          wallThickness: 151.2,
          src: 'frame',
        },
      ],
    })!
    expect(disjointDifferentAxis.diagnostics.dedupedOpeningIds).toEqual(
      expect.arrayContaining(['o2', 'o21', 'o22']),
    )
    expect(disjointDifferentAxis.diagnostics.dedupedOpeningIds).not.toContain('o-disjoint-axis')

    const ambiguousDifferentAxis = buildVectorNodes({
      ...p30DualJambDoc,
      openings: [
        p30DualJambDoc.openings.find((opening) => opening.id === 'o28')!,
        {
          id: 'o-ambiguous-axis',
          type: 'door',
          a: [10800, 4100],
          b: [10800, 4400],
          wallThickness: 151.2,
          src: 'frame',
        },
      ],
    })!
    expect(ambiguousDifferentAxis.diagnostics.dedupedOpeningIds).not.toContain('o-ambiguous-axis')

    const boundaryOnlyContact = buildVectorNodes({
      ...p30DualJambDoc,
      openings: [
        p30DualJambDoc.openings.find((opening) => opening.id === 'o28')!,
        {
          id: 'o-boundary-contact',
          type: 'door',
          a: [10300, 4530.7],
          b: [11000, 4530.7],
          wallThickness: 151.2,
          src: 'frame',
        },
      ],
    })!
    expect(boundaryOnlyContact.diagnostics.dedupedOpeningIds).not.toContain('o-boundary-contact')

    const unsupportedConnectedKind = buildVectorNodes({
      ...p30DualJambDoc,
      openings: [
        p30DualJambDoc.openings.find((opening) => opening.id === 'o28')!,
        {
          id: 'o-unsupported-source',
          type: 'door',
          a: [10300, 4319.7],
          b: [11000, 4319.7],
          wallThickness: 151.2,
          src: 'boundary',
        },
      ],
    })!
    expect(unsupportedConnectedKind.diagnostics.dedupedOpeningIds).not.toContain(
      'o-unsupported-source',
    )

    const outOfSpanMember = buildVectorNodes({
      ...p30DualJambDoc,
      openings: [
        p30DualJambDoc.openings.find((opening) => opening.id === 'o28')!,
        {
          id: 'o-out-of-span',
          type: 'door',
          a: [11350, 4200],
          b: [11600, 4400],
          wallThickness: 151.2,
          src: 'frame',
        },
      ],
    })!
    expect(outOfSpanMember.diagnostics.dedupedOpeningIds).not.toContain('o-out-of-span')

    const collinearComponent: AptVectorDoc = {
      ...p30DualJambDoc,
      openings: p30DualJambDoc.openings
        .filter((opening) => ['o21', 'o22', 'o28'].includes(opening.id))
        .map((opening) =>
          opening.id === 'o22'
            ? { ...opening, a: [10170.6, 4216.8], b: [10860.6, 4176.8] }
            : opening,
        ),
    }
    const collinearBuilt = buildVectorNodes(collinearComponent)!
    expect(collinearBuilt.diagnostics.dedupedOpeningIds).not.toEqual(
      expect.arrayContaining(['o21', 'o22']),
    )
    expectP30OrdinaryParity(collinearComponent)
  })

  test('preflights full p30 clusters before suppression and preserves ordinary fallback parity', () => {
    const connectedDifferentAxis = p30WithOpening({
      id: 'o-connected-different-axis',
      type: 'door',
      a: [11000, 4100],
      b: [11000, 4400],
      wallThickness: 151.2,
      src: 'frame',
    })
    const boundaryOnly = p30WithOpening({
      id: 'o-boundary-only',
      type: 'door',
      a: [10300, 4530.7],
      b: [11000, 4530.7],
      wallThickness: 151.2,
      src: 'frame',
    })
    const unsupportedConnected = p30WithOpening({
      id: 'o-unsupported-connected',
      type: 'door',
      a: [10300, 4319.7],
      b: [11000, 4319.7],
      wallThickness: 151.2,
      src: 'boundary',
    })
    const connectedOutOfSpan = p30WithOpening({
      id: 'o-connected-out-of-span',
      type: 'door',
      a: [11350, 4200],
      b: [11600, 4400],
      wallThickness: 151.2,
      src: 'frame',
    })
    const connectedZeroThickness = p30WithOpening({
      id: 'o-connected-zero-thickness',
      type: 'door',
      a: [10300, 4319.7],
      b: [11000, 4319.7],
      wallThickness: 0,
      src: 'boundary',
    })
    const connectedNaNThickness = p30WithOpening({
      id: 'o-connected-nan-thickness',
      type: 'door',
      a: [10300, 4319.7],
      b: [11000, 4319.7],
      wallThickness: Number.NaN,
      src: 'boundary',
    })
    for (const variant of [
      connectedDifferentAxis,
      boundaryOnly,
      unsupportedConnected,
      connectedOutOfSpan,
      connectedZeroThickness,
      connectedNaNThickness,
    ]) {
      expectP30OrdinaryParity(variant)
    }
    const nonfiniteUnlocatable = p30WithOpening({
      id: 'o-nonfinite-unlocatable',
      type: 'door',
      a: [Number.NaN, 4319.7],
      b: [11000, 4319.7],
      wallThickness: 0,
      src: 'boundary',
    })
    const nonfiniteBuilt = buildVectorNodes(nonfiniteUnlocatable)!
    expect(hasApprovedP30Host(nonfiniteBuilt)).toBe(true)
    expect(nonfiniteBuilt.diagnostics.dedupedOpeningIds).toEqual(
      expect.arrayContaining(['o2', 'o21', 'o22']),
    )

    const widthOverMax: AptVectorDoc = {
      ...p30DualJambDoc,
      openings: p30DualJambDoc.openings.map((opening) =>
        opening.id === 'o28' ? { ...opening, b: [11800, 4319.7] } : opening,
      ),
    }
    const barrierTooThin: AptVectorDoc = {
      ...p30DualJambDoc,
      openings: p30DualJambDoc.openings.map((opening) =>
        opening.id === 'o28' ? { ...opening, barrierThickness: 40 } : opening,
      ),
    }
    const barrierTooThick: AptVectorDoc = {
      ...p30DualJambDoc,
      openings: p30DualJambDoc.openings.map((opening) =>
        opening.id === 'o28' ? { ...opening, barrierThickness: 700 } : opening,
      ),
    }
    for (const variant of [widthOverMax, barrierTooThin, barrierTooThick]) {
      expectP30OrdinaryParity(variant)
    }

    const sharedSupport: AptVectorDoc = {
      ...p30DualJambDoc,
      walls: [
        ...p30DualJambDoc.walls,
        {
          id: 'shared-jamb-support',
          kind: 'interior',
          start: [10057.2, 4319.7],
          end: [11503.3, 4319.7],
          thickness: 270.8,
        },
      ],
    }
    const tiedDifferentContacts: AptVectorDoc = {
      ...p30DualJambDoc,
      walls: [
        ...p30DualJambDoc.walls.filter((wall) => !['w6', 'w19'].includes(wall.id)),
        {
          id: 'tie-jamb-upper',
          kind: 'interior',
          start: [9900, 4455.1],
          end: [10200, 4455.1],
          thickness: 270.8,
        },
        {
          id: 'tie-jamb-lower',
          kind: 'interior',
          start: [9900, 4184.3],
          end: [10200, 4184.3],
          thickness: 270.8,
        },
      ],
    }
    expectP30OrdinaryParity(sharedSupport)
    expectP30OrdinaryParity(tiedDifferentContacts)
  })

  test('uses the finite wall footprint when deciding whether a passage has a pier', () => {
    const infiniteLineOnly = buildVectorNodes({
      ...p30DualJambDoc,
      walls: [
        ...p30DualJambDoc.walls,
        {
          id: 'infinite-line-only',
          kind: 'interior',
          start: [11200, 4100],
          end: [11200, 4250],
          thickness: 100,
        },
      ],
    })!
    expect(infiniteLineOnly.diagnostics.dedupedOpeningIds).toEqual(
      expect.arrayContaining(['o2', 'o21', 'o22']),
    )
  })

  test('uses raw source footprints for jamb support and short-pier vetoes', () => {
    const rawThinJamb: AptVectorDoc = {
      ...p30DualJambDoc,
      walls: [
        ...p30DualJambDoc.walls.filter((wall) => !['w6', 'w19', 'w52'].includes(wall.id)),
        {
          id: 'raw-thin-jamb',
          kind: 'interior',
          start: [9900, 4334.7],
          end: [10200, 4334.7],
          thickness: 20,
        },
      ],
    }
    const rawThinJambBuilt = buildVectorNodes(rawThinJamb)!
    expect(rawThinJambBuilt.diagnostics.droppedWallIds).not.toContain('raw-thin-jamb')
    expect(rawThinJambBuilt.diagnostics.dedupedOpeningIds).not.toEqual(
      expect.arrayContaining(['o2', 'o21', 'o22']),
    )
    expectP30OrdinaryParity(rawThinJamb)

    const rawShortPier: AptVectorDoc = {
      ...p30DualJambDoc,
      walls: [
        ...p30DualJambDoc.walls,
        {
          id: 'raw-short-pier',
          kind: 'interior',
          start: [10750, 4294.7],
          end: [10750, 4344.7],
          thickness: 100,
        },
      ],
    }
    const rawShortPierBuilt = buildVectorNodes(rawShortPier)!
    expect(rawShortPierBuilt.diagnostics.droppedWallIds).toContain('raw-short-pier')
    expectP30OrdinaryParity(rawShortPier)

    const rawShortJamb: AptVectorDoc = {
      ...p30DualJambDoc,
      walls: [
        ...p30DualJambDoc.walls.filter((wall) => !['w6', 'w19', 'w52'].includes(wall.id)),
        {
          id: 'raw-short-jamb',
          kind: 'interior',
          start: [10007.2, 4319.7],
          end: [10057.2, 4319.7],
          thickness: 270.8,
        },
      ],
    }
    const rawShortJambBuilt = buildVectorNodes(rawShortJamb)!
    expect(rawShortJambBuilt.diagnostics.droppedWallIds).toContain('raw-short-jamb')
    expectP30OrdinaryParity(rawShortJamb)
  })

  test('keeps the safe synthesized crossing geometry stable across repeated imports', () => {
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
    const first = buildVectorNodes(measured)!
    const second = buildVectorNodes(measured)!
    const geometry = (built: ReturnType<typeof buildVectorNodes>) => ({
      walls: built!.walls.map((wall) => [wall.start, wall.end, wall.thickness]),
      openings: built!.openings.map((opening) => [opening.type, opening.width, opening.position]),
      diagnostics: built!.diagnostics,
    })
    expect(geometry(first)).toEqual(geometry(second))
  })

  test('preserves a retained thin source segment between differently angled outer runs', () => {
    const sourceChain: AptVectorDoc = {
      unit: 'mm',
      imageSize: [10000, 10000],
      mmPerPx: 1,
      rooms: [],
      openings: [],
      walls: [
        {
          id: 'outer-a',
          kind: 'exterior',
          start: [1000, 2000],
          end: [4000, 2000],
          thickness: 250,
        },
        {
          id: 'thin-chain',
          kind: 'interior',
          start: [4000, 2000],
          end: [4250, 2010],
          thickness: 120,
        },
        {
          id: 'outer-b',
          kind: 'exterior',
          start: [4250, 2010],
          end: [5000, 2025],
          thickness: 250,
        },
        {
          id: 'far-wall',
          kind: 'exterior',
          start: [7000, 1000],
          end: [8500, 1000],
          thickness: 200,
        },
      ],
    }

    const built = buildVectorNodes(sourceChain)!
    expect(built.walls).toHaveLength(4)
    expect(built.walls.every((wall) => wall.thickness === DEFAULT_WALL_THICKNESS)).toBe(true)
    expect(built.walls.map(segLenOf).sort((a, b) => a - b)).toEqual([
      expect.closeTo(0.2502, 3),
      expect.closeTo(0.75015, 5),
      expect.closeTo(1.5, 5),
      expect.closeTo(3, 5),
    ])
    expect(countWallSpans(built.walls, [-1, -3], [-0.75, -2.99])).toBe(1)
    expect(containedDuplicateSpan([...built.walls])).toEqual({ count: 0, length: 0 })
  })

  test('opening-host precedence supersedes only its conflicting retained relation', () => {
    const contradictory: AptVectorDoc = {
      unit: 'mm',
      imageSize: [10000, 10000],
      mmPerPx: 1,
      rooms: [],
      walls: [
        {
          id: 'outer-a',
          kind: 'exterior',
          start: [1000, 2000],
          end: [4000, 2000],
          thickness: 250,
        },
        {
          id: 'retained-bridge',
          kind: 'interior',
          start: [4000, 2000],
          end: [4300, 2010],
          thickness: 120,
        },
        {
          id: 'outer-c',
          kind: 'exterior',
          start: [4300, 2010],
          end: [5000, 2025],
          thickness: 250,
        },
        { id: 'far', kind: 'exterior', start: [7000, 1000], end: [8500, 1000], thickness: 200 },
      ],
      openings: [
        {
          id: 'contradictory-window',
          type: 'window',
          src: 'pair',
          a: [3900, 2000],
          b: [4400, 2010],
          wallThickness: 250,
        },
      ],
    }

    const built = buildVectorNodes(contradictory)!
    const hostOpening = built.openings.find(
      (opening) => opening.metadata?.sourceOpeningId === 'contradictory-window',
    )!
    const host = built.walls.find((wall) => wall.id === hostOpening.wallId)!
    expect(host.thickness).toBe(DEFAULT_WALL_THICKNESS)
    expect(segLenOf(host)).toBeCloseTo(4)
    expect(hostOpening.width).toBeCloseTo(0.5001, 4)
    expect(hostOpening.metadata).toMatchObject({
      sourceOpeningId: 'contradictory-window',
      sourceOpeningSource: 'pair',
    })
    expect(built.walls.some((wall) => segLenOf(wall) > 0.29 && segLenOf(wall) < 0.31)).toBe(true)
    expect(built.diagnostics.unhostedOpeningIds).toEqual([])
  })

  test('opening-host keeps an extremal second relation and rejects an interiorized one', () => {
    const valid: AptVectorDoc = {
      unit: 'mm',
      imageSize: [10000, 10000],
      mmPerPx: 1,
      rooms: [],
      openings: [
        {
          id: 'opening',
          type: 'window',
          src: 'pair',
          a: [3900, 2000],
          b: [4400, 2010],
          wallThickness: 250,
        },
      ],
      walls: [
        { id: 'outer-a', kind: 'exterior', start: [1000, 2000], end: [4000, 2000], thickness: 250 },
        {
          id: 'bridge-a',
          kind: 'interior',
          start: [4000, 2000],
          end: [4300, 2010],
          thickness: 120,
        },
        { id: 'outer-c', kind: 'exterior', start: [4300, 2010], end: [5000, 2025], thickness: 250 },
        {
          id: 'bridge-far',
          kind: 'interior',
          start: [5000, 2025],
          end: [5300, 2035],
          thickness: 400,
        },
        {
          id: 'outer-far',
          kind: 'exterior',
          start: [5300, 2035],
          end: [6000, 2050],
          thickness: 250,
        },
        { id: 'far', kind: 'exterior', start: [7000, 1000], end: [8500, 1000], thickness: 200 },
      ],
    }
    const built = buildVectorNodes(valid)!
    expect(built.openings).toHaveLength(1)
    expect(built.walls).toHaveLength(5)
    expect(built.walls.every((wall) => wall.thickness === DEFAULT_WALL_THICKNESS)).toBe(true)
    expect(countWallSpans(built.walls, [0, -2.975], [0.3, -2.965])).toBe(1)
    expect(built.diagnostics.unhostedOpeningIds).toEqual([])

    const rejected: AptVectorDoc = {
      ...valid,
      walls: [
        valid.walls[0]!,
        valid.walls[1]!,
        valid.walls[2]!,
        {
          id: 'competing-bridge',
          kind: 'interior',
          start: [4000, 2000],
          end: [4300, 2030],
          thickness: 400,
        },
        {
          id: 'competing-outer',
          kind: 'exterior',
          start: [4300, 2030],
          end: [5000, 2050],
          thickness: 250,
        },
        valid.walls[5]!,
      ],
    }
    expect(buildVectorNodes(rejected)).toBeNull()
  })

  test('rejects both-side absorption while allowing a far-side and unrelated continuation', () => {
    const source: AptVectorDoc = {
      unit: 'mm',
      imageSize: [10000, 10000],
      mmPerPx: 1,
      rooms: [],
      openings: [],
      walls: [
        { id: 'outer-a', kind: 'exterior', start: [1000, 2000], end: [4000, 2000], thickness: 250 },
        { id: 'bridge', kind: 'interior', start: [4000, 2000], end: [4250, 2010], thickness: 120 },
        { id: 'outer-c', kind: 'exterior', start: [4250, 2010], end: [5000, 2025], thickness: 250 },
        {
          id: 'far-side',
          kind: 'exterior',
          start: [5000, 2025],
          end: [6000, 2045],
          thickness: 250,
        },
        {
          id: 'both-side-absorber',
          kind: 'exterior',
          start: [3500, 1990],
          end: [6500, 2060],
          thickness: 250,
        },
        {
          id: 'unrelated-a',
          kind: 'interior',
          start: [7000, 1000],
          end: [8500, 1000],
          thickness: 200,
        },
        {
          id: 'unrelated-b',
          kind: 'interior',
          start: [8500, 1000],
          end: [9000, 1000],
          thickness: 200,
        },
      ],
    }
    const built = buildVectorNodes(source)!
    expect(built.walls.every((wall) => wall.thickness === DEFAULT_WALL_THICKNESS)).toBe(true)
    expect(built.walls.some((wall) => segLenOf(wall) > 2.24 && segLenOf(wall) < 2.26)).toBe(true)
    expect(built.walls.some((wall) => segLenOf(wall) > 3 && segLenOf(wall) < 3.01)).toBe(true)
    expect(countWallSpans(built.walls, [2, -4], [4, -4])).toBe(1)
  })

  test('keeps opening and retained contacts invariant under DSU source order', () => {
    const ordered: AptVectorDoc = {
      unit: 'mm',
      imageSize: [10000, 10000],
      mmPerPx: 1,
      rooms: [],
      openings: [
        {
          id: 'opening',
          type: 'window',
          src: 'pair',
          a: [3900, 2000],
          b: [4400, 2010],
          wallThickness: 250,
        },
      ],
      walls: [
        { id: 'outer-a', kind: 'exterior', start: [1000, 2000], end: [4000, 2000], thickness: 250 },
        {
          id: 'bridge-a',
          kind: 'interior',
          start: [4000, 2000],
          end: [4300, 2010],
          thickness: 120,
        },
        { id: 'outer-c', kind: 'exterior', start: [4300, 2010], end: [5000, 2025], thickness: 250 },
        {
          id: 'bridge-far',
          kind: 'interior',
          start: [5000, 2025],
          end: [5300, 2035],
          thickness: 400,
        },
        {
          id: 'outer-far',
          kind: 'exterior',
          start: [5300, 2035],
          end: [6000, 2050],
          thickness: 250,
        },
        { id: 'far', kind: 'exterior', start: [7000, 1000], end: [8500, 1000], thickness: 200 },
      ],
    }
    const permutations = [
      ordered.walls,
      [...ordered.walls].reverse(),
      [
        ordered.walls[2]!,
        ordered.walls[0]!,
        ordered.walls[4]!,
        ordered.walls[1]!,
        ordered.walls[5]!,
        ordered.walls[3]!,
      ],
    ]
    const signature = (doc: AptVectorDoc) => {
      const built = buildVectorNodes(doc)!
      return {
        walls: built.walls
          .map((wall) => [...wall.start, ...wall.end, wall.thickness] as number[])
          .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]! || a[4]! - b[4]!),
        openings: built.openings.map((opening) => ({
          width: opening.width,
          hostThickness: built.walls.find((wall) => wall.id === opening.wallId)?.thickness,
        })),
      }
    }
    const first = signature({ ...ordered, walls: permutations[0]! })
    for (const walls of permutations.slice(1))
      expect(signature({ ...ordered, walls })).toEqual(first)
  })

  test('matches retained source endpoints across a pair-index bucket boundary only within tolerance', () => {
    const atTolerance: AptVectorDoc = {
      unit: 'mm',
      imageSize: [10000, 10000],
      mmPerPx: 1,
      rooms: [],
      openings: [],
      walls: [
        {
          id: 'outer-a',
          kind: 'exterior',
          start: [1000, 2000],
          end: [4000.0009, 2000],
          thickness: 250,
        },
        {
          id: 'thin-chain',
          kind: 'interior',
          start: [4000, 2000],
          end: [4250, 2010],
          thickness: 120,
        },
        {
          id: 'outer-b',
          kind: 'exterior',
          start: [4250, 2010],
          end: [5000, 2025],
          thickness: 250,
        },
        { id: 'far', kind: 'exterior', start: [7000, 1000], end: [8500, 1000], thickness: 200 },
      ],
    }
    const beyondTolerance = {
      ...atTolerance,
      walls: atTolerance.walls.map((wall) =>
        wall.id === 'outer-a' ? { ...wall, end: [4000.0011, 2000] as [number, number] } : wall,
      ),
    }

    const within = buildVectorNodes(atTolerance)!
    const beyond = buildVectorNodes(beyondTolerance)!
    expect(within.walls).toHaveLength(4)
    expect(countWallSpans(within.walls, [-1, -3], [-0.75, -2.99])).toBe(1)
    expect(countWallSpans(within.walls, [-4, -3], [0, -3])).toBe(0)
    expect(beyond.walls).toHaveLength(3)
    expect(countWallSpans(beyond.walls, [-1, -3], [-0.75, -2.99])).toBe(1)
    expect(countWallSpans(beyond.walls, [-4, -3], [0, -3])).toBe(1)
  })

  test('keeps an exact window host between touching thick caps without extending into them', () => {
    const sourceWindow: AptVectorDoc = {
      unit: 'mm',
      imageSize: [10000, 10000],
      mmPerPx: 1,
      rooms: [],
      walls: [
        {
          id: 'cap-top',
          kind: 'exterior',
          start: [8000, 2000],
          end: [8000, 2500],
          thickness: 250,
        },
        {
          id: 'flank-top',
          kind: 'exterior',
          start: [8000, 2500],
          end: [8000, 2700],
          thickness: 150,
        },
        {
          id: 'flank-bottom',
          kind: 'exterior',
          start: [8000, 6000],
          end: [8000, 6200],
          thickness: 140,
        },
        {
          id: 'cap-bottom',
          kind: 'exterior',
          start: [8000, 6200],
          end: [8000, 6800],
          thickness: 250,
        },
      ],
      openings: [
        {
          id: 'o5',
          type: 'window',
          src: 'pair',
          a: [8000, 2700],
          b: [8000, 6000],
          wallThickness: 250,
        },
      ],
    }

    const built = buildVectorNodes(sourceWindow)!
    expect(built.openings).toHaveLength(1)
    const opening = built.openings[0]!
    const host = built.walls.find((wall) => wall.id === opening.wallId)!
    expect(opening.type).toBe('window')
    expect(opening.width).toBeCloseTo(3.3)
    expect(opening.metadata).toMatchObject({
      sourceOpeningId: 'o5',
      sourceOpeningType: 'window',
      sourceWidthMm: 3300,
    })
    expect(segLenOf(host)).toBeCloseTo(3.7)
    expect(Math.min(host.start[1], host.end[1])).toBeCloseTo(-2.5)
    expect(Math.max(host.start[1], host.end[1])).toBeCloseTo(1.2)
    expect(containedDuplicateSpan([...built.walls])).toEqual({ count: 0, length: 0 })
  })

  test('fails closed for competing retained source chains', () => {
    const competing: AptVectorDoc = {
      unit: 'mm',
      imageSize: [10000, 10000],
      mmPerPx: 1,
      rooms: [],
      openings: [],
      walls: [
        {
          id: 'outer-a',
          kind: 'exterior',
          start: [1000, 2000],
          end: [4000, 2000],
          thickness: 250,
        },
        {
          id: 'chain-a',
          kind: 'interior',
          start: [4000, 2000],
          end: [4250, 2000],
          thickness: 120,
        },
        {
          id: 'chain-b',
          kind: 'interior',
          start: [4000, 2000],
          end: [4250, 2000],
          // Deliberately outside the 80 mm same-run tolerance: both bridge
          // identities must survive without merging into one marker.
          thickness: 300,
        },
        {
          id: 'outer-b',
          kind: 'exterior',
          start: [4250, 2000],
          end: [5000, 2000],
          thickness: 250,
        },
        {
          id: 'far-wall',
          kind: 'exterior',
          start: [7000, 1000],
          end: [8500, 1000],
          thickness: 200,
        },
      ],
    }

    const built = buildVectorNodes(competing)!
    expect(built.walls).toHaveLength(5)
    expect(built.walls.every((wall) => wall.thickness === DEFAULT_WALL_THICKNESS)).toBe(true)
    expect(countWallSpans(built.walls, [-1, -3], [-0.75, -3])).toBe(2)
    // These are intentionally nonmergeable contributors; preserving both
    // identities leaves the two canonical bridge spans visible.
    expect(containedDuplicateSpan([...built.walls])).toEqual({ count: 2, length: 0.5 })
  })

  test('keeps offset parallel, merely adjacent, and crossing walls distinct', () => {
    const controls: AptVectorDoc = {
      unit: 'mm',
      imageSize: [10000, 10000],
      mmPerPx: 1,
      rooms: [],
      openings: [],
      walls: [
        {
          id: 'offset-a',
          kind: 'interior',
          start: [1000, 1500],
          end: [3000, 1500],
          thickness: 200,
        },
        {
          id: 'offset-b',
          kind: 'interior',
          start: [1000, 1800],
          end: [3000, 1800],
          thickness: 200,
        },
        {
          id: 'adjacent-a',
          kind: 'interior',
          start: [4000, 1500],
          end: [5000, 1500],
          thickness: 200,
        },
        {
          id: 'adjacent-b',
          kind: 'interior',
          start: [5250, 1800],
          end: [6250, 1800],
          thickness: 200,
        },
        {
          id: 'cross-horizontal',
          kind: 'interior',
          start: [7000, 1500],
          end: [9000, 1500],
          thickness: 200,
        },
        {
          id: 'cross-vertical',
          kind: 'interior',
          start: [8000, 1000],
          end: [8000, 2000],
          thickness: 100,
        },
      ],
    }

    const built = buildVectorNodes(controls)!
    expect(built.walls).toHaveLength(8)
    expect(built.walls.every((wall) => wall.thickness === DEFAULT_WALL_THICKNESS)).toBe(true)
    expect(countWallSpans(built.walls, [-4, -3.5], [-1, -3.5])).toBe(1)
    expect(countWallSpans(built.walls, [-4, -3.2], [-2, -3.2])).toBe(1)
    expect(countWallSpans(built.walls, [-1, -3.5], [0, -3.5])).toBe(1)
    expect(countWallSpans(built.walls, [0.25, -3.2], [1.25, -3.2])).toBe(1)
    expect(containedDuplicateSpan([...built.walls])).toEqual({ count: 0, length: 0 })
  })

  test('merges a normal same-thickness continuation through an exact source contact', () => {
    const continuation: AptVectorDoc = {
      unit: 'mm',
      imageSize: [10000, 10000],
      mmPerPx: 1,
      rooms: [],
      openings: [],
      walls: [
        { id: 'a', kind: 'exterior', start: [1000, 2000], end: [4000, 2000], thickness: 250 },
        { id: 'b', kind: 'interior', start: [4000, 2000], end: [4250, 2000], thickness: 250 },
        { id: 'c', kind: 'exterior', start: [4250, 2000], end: [5000, 2000], thickness: 250 },
        { id: 'far', kind: 'exterior', start: [7000, 1000], end: [8500, 1000], thickness: 200 },
      ],
    }

    const built = buildVectorNodes(continuation)!
    const chain = built.walls.filter((wall) => Math.abs(segLenOf(wall) - 4) < 1e-6)
    expect(chain).toHaveLength(1)
    expect(segLenOf(chain[0]!)).toBeCloseTo(4)
    expect(containedDuplicateSpan([...built.walls])).toEqual({ count: 0, length: 0 })
  })

  test('does not preserve a bridge whose endpoints are not the facing outer endpoints', () => {
    const nonFacing: AptVectorDoc = {
      unit: 'mm',
      imageSize: [10000, 10000],
      mmPerPx: 1,
      rooms: [],
      openings: [],
      walls: [
        { id: 'outer-a', kind: 'exterior', start: [1000, 2000], end: [4000, 2000], thickness: 250 },
        {
          id: 'non-facing-bridge',
          kind: 'interior',
          start: [1000, 2000],
          end: [5000, 2060],
          thickness: 120,
        },
        { id: 'outer-b', kind: 'exterior', start: [4250, 2000], end: [5000, 2060], thickness: 250 },
        { id: 'far', kind: 'exterior', start: [7000, 1000], end: [8500, 1000], thickness: 200 },
      ],
    }

    const built = buildVectorNodes(nonFacing)!
    const overlappingRuns = built.walls.filter((wall) => Math.abs(segLenOf(wall) - 4) < 0.001)
    expect(overlappingRuns).toHaveLength(2)
    expect(countWallSpans(overlappingRuns, [-4, -3], [0, -3], 1e-3)).toBe(1)
    expect(countWallSpans(overlappingRuns, [-4, -3], [0, -2.94], 1e-3)).toBe(1)
    expect(built.walls).toHaveLength(3)
  })

  test('preserves a retained bridge contact while connecting an unrelated tee', () => {
    const relationWithTee: AptVectorDoc = {
      unit: 'mm',
      imageSize: [10000, 10000],
      mmPerPx: 1,
      rooms: [],
      openings: [],
      walls: [
        { id: 'outer-a', kind: 'exterior', start: [1000, 2000], end: [4000, 2000], thickness: 250 },
        {
          id: 'thin-chain',
          kind: 'interior',
          start: [4000, 2000],
          end: [4250, 2010],
          thickness: 120,
        },
        {
          id: 'outer-b',
          kind: 'exterior',
          start: [4250, 2010],
          end: [5000, 2025],
          thickness: 250,
        },
        {
          id: 'unrelated-tee',
          kind: 'interior',
          start: [4000, 1500],
          end: [4000, 2000],
          thickness: 100,
        },
        { id: 'far', kind: 'exterior', start: [7000, 1000], end: [8500, 1000], thickness: 200 },
      ],
    }

    const built = buildVectorNodes(relationWithTee)!
    const thin = built.walls.find((wall) => segLenOf(wall) > 0.24 && segLenOf(wall) < 0.26)!
    const tee = built.walls.find(
      (wall) => wall.start[0] === wall.end[0] && Math.abs(segLenOf(wall) - 0.5) < 1e-6,
    )!
    expect([thin.start, thin.end]).toContainEqual([-1, -3])
    expect([tee.start, tee.end]).toContainEqual([-1, -3])
    expect(segLenOf(tee)).toBeCloseTo(0.5)
    expect(containedDuplicateSpan([...built.walls])).toEqual({ count: 0, length: 0 })
  })

  test('keeps a legal continuation on the far side of a retained bridge', () => {
    const continuation: AptVectorDoc = {
      unit: 'mm',
      imageSize: [10000, 10000],
      mmPerPx: 1,
      rooms: [],
      openings: [],
      walls: [
        { id: 'outer-a', kind: 'exterior', start: [1000, 2000], end: [4000, 2000], thickness: 250 },
        {
          id: 'thin-chain',
          kind: 'interior',
          start: [4000, 2000],
          end: [4250, 2010],
          thickness: 120,
        },
        {
          id: 'outer-b',
          kind: 'exterior',
          start: [4250, 2010],
          end: [5000, 2025],
          thickness: 250,
        },
        {
          id: 'outer-b-continuation',
          kind: 'exterior',
          start: [5000, 2025],
          end: [6000, 2045],
          thickness: 250,
        },
        { id: 'far', kind: 'exterior', start: [7000, 1000], end: [8500, 1000], thickness: 200 },
      ],
    }

    const built = buildVectorNodes(continuation)!
    const outer = built.walls.filter((wall) => {
      const length = segLenOf(wall)
      return Math.abs(length - 1.75035) < 1e-4 || Math.abs(length - 3) < 1e-6
    })
    expect(outer).toHaveLength(2)
    expect(outer.map(segLenOf).sort((a, b) => a - b)).toEqual([
      expect.closeTo(1.75035, 5),
      expect.closeTo(3, 5),
    ])
    expect(built.walls.some((wall) => segLenOf(wall) > 0.24 && segLenOf(wall) < 0.26)).toBe(true)
    expect(containedDuplicateSpan([...built.walls])).toEqual({ count: 0, length: 0 })
  })
})

function segLenOf(wall: { start: [number, number]; end: [number, number] }): number {
  return Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
}

function countWallSpans(
  walls: { start: [number, number]; end: [number, number] }[],
  start: [number, number],
  end: [number, number],
  tolerance = 1e-6,
): number {
  const pointMatches = (actual: [number, number], expected: [number, number]) =>
    Math.abs(actual[0] - expected[0]) <= tolerance && Math.abs(actual[1] - expected[1]) <= tolerance
  return walls.filter(
    (wall) =>
      (pointMatches(wall.start, start) && pointMatches(wall.end, end)) ||
      (pointMatches(wall.start, end) && pointMatches(wall.end, start)),
  ).length
}

function containedDuplicateSpan(
  walls: { start: [number, number]; end: [number, number]; thickness?: number | null }[],
): { count: number; length: number } {
  let count = 0
  let length = 0
  for (let i = 0; i < walls.length; i++) {
    const shorter = walls[i]!
    const shorterLength = segLenOf(shorter)
    const shorterDir: [number, number] = [
      (shorter.end[0] - shorter.start[0]) / shorterLength,
      (shorter.end[1] - shorter.start[1]) / shorterLength,
    ]
    for (let j = 0; j < walls.length; j++) {
      if (i === j) continue
      const longer = walls[j]!
      const longerLength = segLenOf(longer)
      if (shorterLength > longerLength + 1e-6) continue
      const longerDir: [number, number] = [
        (longer.end[0] - longer.start[0]) / longerLength,
        (longer.end[1] - longer.start[1]) / longerLength,
      ]
      const project = (point: [number, number]) =>
        (point[0] - longer.start[0]) * longerDir[0] + (point[1] - longer.start[1]) * longerDir[1]
      const distanceToLongerCenterline = (point: [number, number]) =>
        Math.abs(
          (point[0] - longer.start[0]) * longerDir[1] - (point[1] - longer.start[1]) * longerDir[0],
        )
      const halfThickness = (longer.thickness ?? 0.1) / 2 + 1e-6
      const endpointsInside = [shorter.start, shorter.end].every((point) => {
        const at = project(point)
        return (
          at >= -1e-6 &&
          at <= longerLength + 1e-6 &&
          distanceToLongerCenterline(point) <= halfThickness
        )
      })
      if (!endpointsInside) continue
      // The pair metric requires a genuine contained span, not an endpoint-only contact.
      if (
        shorterLength <= 1e-6 ||
        Math.abs(shorterDir[0] * longerDir[0] + shorterDir[1] * longerDir[1]) < 0.99
      )
        continue
      count += 1
      length += shorterLength
      break
    }
  }
  return { count, length }
}

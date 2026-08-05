import { describe, expect, test } from 'bun:test'
import { WallNode } from '../schema/nodes/wall'
import {
  buildWallConstructionLayerSpans,
  calculateWallConstructionQuantities,
  createDefaultWallFaceBands,
  createWallBandConstructionPreset,
  detectWallConstructionPreset,
  getWallBandConstruction,
  getWallConstructionEnvelopeThickness,
  normalizeWallBandConstructionToThickness,
} from './wall-construction'

describe('physical wall band construction', () => {
  test('builds gypsum + 33 mm studs + gypsum as a physical assembly', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [2, 0],
      thickness: 0.1,
      faceBands: {
        enabled: false,
        count: 1,
        lowerHeight: 0.8,
        middleHeight: 0.61,
        upperHeight: 0.61,
        construction: { upper: createWallBandConstructionPreset('gypsum-stud-gypsum') },
      },
    })

    expect(getWallConstructionEnvelopeThickness(wall)).toBeCloseTo(0.052)
    expect(wall.faceBands?.construction?.upper?.layers.map((layer) => layer.kind)).toEqual([
      'gypsum-board',
      'timber-stud',
      'gypsum-board',
    ])
    expect(wall.faceBands?.construction?.upper?.layers[1]).toMatchObject({
      thickness: 0.033,
      memberWidth: 0.033,
      studSpacing: 0.3,
    })
  })

  test('treats an unconfigured legacy 100 mm wall as explicit empty space', () => {
    const wall = WallNode.parse({ start: [0, 0], end: [2, 0], thickness: 0.1 })
    const construction = getWallBandConstruction(wall, 'upper')

    expect(construction.layers).toEqual([
      expect.objectContaining({ kind: 'cavity', thickness: 0.1 }),
    ])
    expect(getWallConstructionEnvelopeThickness(wall)).toBeCloseTo(0.1)
  })

  test('fills only the unexplained remainder with a cavity layer', () => {
    const construction = normalizeWallBandConstructionToThickness(
      createWallBandConstructionPreset('gypsum-stud-gypsum'),
      0.15,
    )

    expect(construction.layers[0]?.thickness).toBeCloseTo(0.0095)
    expect(construction.layers[1]?.thickness).toBeCloseTo(0.033)
    expect(construction.layers[2]?.kind).toBe('cavity')
    expect(construction.layers[2]?.thickness).toBeCloseTo(0.098)
    expect(construction.layers[3]?.thickness).toBeCloseTo(0.0095)
    expect(construction.layers.reduce((sum, layer) => sum + layer.thickness, 0)).toBeCloseTo(0.15)
  })

  test('builds the default stud + gypsum + wallpaper wall with an explicit cavity', () => {
    const construction = createWallBandConstructionPreset('stud-gypsum-finish', 0.1)

    expect(construction.layers.map((layer) => layer.kind)).toEqual([
      'timber-stud',
      'cavity',
      'gypsum-board',
      'finish',
    ])
    expect(construction.layers.map((layer) => layer.thickness)).toEqual([
      0.033, 0.0565, 0.0095, 0.001,
    ])
  })

  test('creates the standard 100 mm wall face-band configuration', () => {
    const faceBands = createDefaultWallFaceBands()

    expect(faceBands.enabled).toBe(false)
    expect(faceBands.count).toBe(1)
    expect(faceBands.construction?.upper?.layers.map((layer) => layer.kind)).toEqual([
      'timber-stud',
      'cavity',
      'gypsum-board',
      'finish',
    ])
    expect(
      faceBands.construction?.upper?.layers.reduce((sum, layer) => sum + layer.thickness, 0),
    ).toBeCloseTo(0.1)
  })

  test('keeps the material sum as the final thickness when no cavity exists', () => {
    const construction = createWallBandConstructionPreset('gypsum-stud-gypsum')
    const wall = WallNode.parse({
      start: [0, 0],
      end: [2, 0],
      thickness: 0.1,
      faceBands: {
        enabled: false,
        count: 1,
        lowerHeight: 0.84,
        middleHeight: 0.61,
        upperHeight: 0.61,
        construction: { upper: construction },
      },
    })

    expect(getWallConstructionEnvelopeThickness(wall)).toBeCloseTo(0.052)
  })

  test('builds contiguous layer spans across the exact wall thickness', () => {
    const spans = buildWallConstructionLayerSpans(
      createWallBandConstructionPreset('gypsum-stud-gypsum', 0.1),
    )

    expect(spans[0]?.start).toBeCloseTo(-0.05)
    expect(spans[0]?.end).toBeCloseTo(spans[1]?.start ?? 0)
    expect(spans[1]?.end).toBeCloseTo(spans[2]?.start ?? 0)
    expect(spans[2]?.kind).toBe('cavity')
    expect(spans[2]?.end).toBeCloseTo(spans[3]?.start ?? 0)
    expect(spans[3]?.end).toBeCloseTo(0.05)
  })

  test('adds a stud and gypsum lining onto the existing wall thickness', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [2, 0],
      thickness: 0.1,
      faceBands: {
        enabled: true,
        count: 2,
        lowerHeight: 0.8,
        middleHeight: 0.61,
        upperHeight: 0.61,
        construction: { lower: createWallBandConstructionPreset('stud-gypsum') },
      },
    })

    expect(getWallConstructionEnvelopeThickness(wall)).toBeCloseTo(0.1425)
  })

  test('calculates board sheets and 300 mm stud quantities per height band', () => {
    const wall = WallNode.parse({
      start: [0, 0],
      end: [2, 0],
      height: 2.4,
      faceBands: {
        enabled: true,
        count: 2,
        lowerHeight: 0.8,
        middleHeight: 0.61,
        upperHeight: 0.61,
        construction: { lower: createWallBandConstructionPreset('stud-gypsum') },
      },
    })

    const quantities = calculateWallConstructionQuantities(wall).filter(
      (quantity) => quantity.band === 'lower',
    )
    expect(quantities).toHaveLength(2)
    expect(quantities[0]).toMatchObject({ band: 'lower', kind: 'timber-stud', studCount: 8 })
    expect(quantities[0]?.linearM).toBeCloseTo(11.44)
    expect(quantities[0]?.volumeM3).toBeCloseTo(0.033 * 0.033 * 11.44)
    expect(quantities[1]).toMatchObject({ band: 'lower', kind: 'gypsum-board', sheetCount: 2 })
  })

  test('round-trips the presets exposed by the wall band editor', () => {
    for (const preset of [
      'finish-only',
      'gypsum',
      'mdf',
      'stud-gypsum',
      'stud-gypsum-finish',
      'gypsum-stud-gypsum',
      'glass',
      'masonry',
      'glass-block',
    ] as const) {
      expect(detectWallConstructionPreset(createWallBandConstructionPreset(preset))).toBe(preset)
    }
  })

  test('material presets define the physical thickness without cavity fill', () => {
    const glass = createWallBandConstructionPreset('glass', 0.1)
    expect(glass.mode).toBe('assembly')
    expect(glass.layers).toEqual([{ kind: 'glass', thickness: 0.012, wasteFactor: 0.05 }])

    const masonry = createWallBandConstructionPreset('masonry', 0.1)
    expect(masonry.layers.some((layer) => layer.kind === 'cavity')).toBe(false)
    expect(masonry.layers[0]?.thickness).toBe(0.09)
  })
})

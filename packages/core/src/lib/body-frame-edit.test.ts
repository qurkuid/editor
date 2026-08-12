import { describe, expect, test } from 'bun:test'
import { BodyNode } from '../schema/nodes/body'
import { createRoundedRectangularFrameBody } from './body-frame'
import {
  getRoundedRectangularFrameOpeningPlacement,
  getRoundedRectangularFrameParameters,
  RoundedFrameOpeningBoundsError,
  updateRoundedRectangularFrameOpening,
  updateRoundedRectangularFrameRadius,
} from './body-frame-edit'
import { validateBodyTopology } from './body-topology'
import { transformBody } from './body-transform'

describe('rounded rectangular frame editing', () => {
  test('changes the top radius while preserving scene identity and painted faces', () => {
    const created = createRoundedRectangularFrameBody({
      id: 'body_editable_frame',
      name: 'Feature wall',
      width: 2,
      height: 2.4,
      depth: 0.1,
      openingWidth: 1,
      openingHeight: 0.8,
      topCornerRadius: 0.2,
      origin: [1, 0.5, 2],
    })
    const source = BodyNode.parse({
      ...created,
      parentId: 'level_ground',
      visible: false,
      revision: 4,
      metadata: { ...created.metadata, intmFinishCode: 'PT-01' },
      faces: created.faces.map((face) =>
        face.id === 'face:front'
          ? { ...face, surface: { ...face.surface, materialRef: 'library:paint-white' } }
          : face,
      ),
    })

    const updated = updateRoundedRectangularFrameRadius(source, 0.35)

    expect(validateBodyTopology(updated)).toEqual({ valid: true, diagnostics: [] })
    expect(updated).toMatchObject({
      id: source.id,
      name: source.name,
      parentId: source.parentId,
      visible: source.visible,
      revision: 5,
    })
    expect(updated.metadata).toMatchObject({
      primitive: 'rounded-rectangular-frame',
      topCornerRadius: 0.35,
      intmFinishCode: 'PT-01',
    })
    expect(updated.faces.find((face) => face.id === 'face:front')?.surface.materialRef).toBe(
      'library:paint-white',
    )
    expect(
      updated.vertices.find((vertex) => vertex.id === 'vertex:front:outer:0')?.position,
    ).toEqual([1, 0.5, 2])
    expect(getRoundedRectangularFrameParameters(updated)?.topCornerRadius).toBe(0.35)
    expect(getRoundedRectangularFrameParameters(source)?.topCornerRadius).toBe(0.2)
  })

  test('does not expose frame parameters for an unrelated body', () => {
    const body = BodyNode.parse({
      shells: [],
      vertices: [],
      halfEdges: [],
      loops: [],
      faces: [],
    })

    expect(getRoundedRectangularFrameParameters(body)).toBeNull()
  })

  test('keeps a transformed frame in its existing coordinate frame', () => {
    const source = transformBody(
      createRoundedRectangularFrameBody({
        width: 2,
        height: 2.4,
        depth: 0.1,
        openingWidth: 1,
        openingHeight: 0.8,
        topCornerRadius: 0.2,
      }),
      {
        translation: [3, 0.5, 1],
        rotationAxis: [0, 1, 0],
        rotationAngle: Math.PI / 2,
        scale: [0.5, 0.5, 0.5],
        pivot: [0, 0, 0],
      },
    )

    const updated = updateRoundedRectangularFrameRadius(source, 0.35)

    for (const vertexId of ['vertex:front:outer:0', 'vertex:front:outer:1']) {
      expect(updated.vertices.find((vertex) => vertex.id === vertexId)?.position).toEqual(
        source.vertices.find((vertex) => vertex.id === vertexId)?.position,
      )
    }
  })

  test('moves only the opening from the frame center', () => {
    const source = createRoundedRectangularFrameBody({
      width: 2,
      height: 2.4,
      depth: 0.1,
      openingWidth: 1,
      openingHeight: 0.8,
      topCornerRadius: 0.2,
      origin: [1, 0.5, 2],
    })
    const outerBefore = source.vertices
      .filter((vertex) => vertex.id.includes(':outer:'))
      .map((vertex) => vertex.position)

    const updated = updateRoundedRectangularFrameOpening(source, {
      centerOffsetX: 0.2,
      centerOffsetY: -0.3,
    })

    const metadata = getRoundedRectangularFrameParameters(updated)
    expect(metadata?.openingOffsetX).toBeCloseTo(0.7)
    expect(metadata?.openingOffsetY).toBeCloseTo(0.5)
    const openingOrigin = updated.vertices.find(
      (vertex) => vertex.id === 'vertex:front:inner:0',
    )?.position
    expect(openingOrigin?.[0]).toBeCloseTo(1.7)
    expect(openingOrigin?.[1]).toBeCloseTo(1)
    expect(openingOrigin?.[2]).toBeCloseTo(2)
    expect(
      updated.vertices
        .filter((vertex) => vertex.id.includes(':outer:'))
        .map((vertex) => vertex.position),
    ).toEqual(outerBefore)
  })

  test('reports center-relative opening movement bounds', () => {
    const source = createRoundedRectangularFrameBody({
      width: 2,
      height: 2.4,
      depth: 0.1,
      openingWidth: 1,
      openingHeight: 0.8,
      topCornerRadius: 0.2,
    })

    const placement = getRoundedRectangularFrameOpeningPlacement(source)

    expect(placement).toMatchObject({
      centerOffsetX: 0,
      centerOffsetY: 0,
      minCenterOffsetX: -0.5,
      maxCenterOffsetX: 0.5,
    })
    expect(placement?.minCenterOffsetY).toBeCloseTo(-0.8)
    expect(placement?.maxCenterOffsetY).toBeCloseTo(0.8)
  })

  test('rejects an opening position outside the wall', () => {
    const source = createRoundedRectangularFrameBody({
      width: 2,
      height: 2.4,
      depth: 0.1,
      openingWidth: 1,
      openingHeight: 0.8,
      topCornerRadius: 0.2,
    })

    expect(() =>
      updateRoundedRectangularFrameOpening(source, {
        centerOffsetX: 0.51,
        centerOffsetY: 0,
      }),
    ).toThrow(RoundedFrameOpeningBoundsError)
  })

  test('rejects a radius that would cut through a moved opening', () => {
    const source = updateRoundedRectangularFrameOpening(
      createRoundedRectangularFrameBody({
        width: 2,
        height: 2.4,
        depth: 0.1,
        openingWidth: 1,
        openingHeight: 0.8,
        topCornerRadius: 0.2,
      }),
      { centerOffsetX: 0, centerOffsetY: 0.75 },
    )

    expect(() => updateRoundedRectangularFrameRadius(source, 1)).toThrow(
      RoundedFrameOpeningBoundsError,
    )
    expect(getRoundedRectangularFrameOpeningPlacement(source)?.maxTopCornerRadius).toBeLessThan(1)
  })
})

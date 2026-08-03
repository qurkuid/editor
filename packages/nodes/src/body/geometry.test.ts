import { describe, expect, test } from 'bun:test'
import {
  createRectangleBody,
  createRoundedRectangularFrameBody,
  type GeometryContext,
  pushPullBodyFace,
  type SceneMaterialId,
} from '@pascal-app/core'
import { Mesh } from 'three'
import { buildBodyGeometry } from './geometry'

describe('buildBodyGeometry', () => {
  test('renders a closed hollow frame with a triangulated center opening', () => {
    const body = createRoundedRectangularFrameBody({
      width: 2,
      height: 2.4,
      depth: 0.1,
      openingWidth: 1,
      openingHeight: 0.8,
      topCornerRadius: 0.2,
    })
    const group = buildBodyGeometry(body)
    const front = group.getObjectByName('face:face:front') as Mesh

    expect(group.children).toHaveLength(body.faces.length)
    expect(front).toBeInstanceOf(Mesh)
    expect(front.geometry.getIndex()?.count).toBeGreaterThan(0)
    expect(front.geometry.getAttribute('position').count).toBe(
      body.vertices.filter((vertex) => vertex.id.startsWith('vertex:front:')).length,
    )
  })

  test('renders a logical face from persistent topology', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })
    const group = buildBodyGeometry(body)
    const face = group.getObjectByName('face:face:0')

    expect(face).toBeInstanceOf(Mesh)
    expect(face?.userData).toMatchObject({
      bodyId: body.id,
      faceId: 'face:0',
      pascalNodeId: body.id,
    })
    expect((face as Mesh).geometry.getAttribute('position').count).toBe(4)
    expect((face as Mesh).geometry.getIndex()?.count).toBe(6)
  })

  test('resolves a face material ref and emits UVs from the persistent surface frame', () => {
    const source = createRectangleBody({ width: 1.2, depth: 0.8 })
    const body = {
      ...source,
      faces: source.faces.map((face) => ({
        ...face,
        surface: { ...face.surface, materialRef: 'scene:body-finish' },
      })),
    }
    const group = buildBodyGeometry(body, {
      resolve: () => undefined,
      children: [],
      siblings: [],
      parent: null,
      materials: {
        ['body-finish' as SceneMaterialId]: {
          id: 'body-finish' as SceneMaterialId,
          name: 'Body finish',
          material: { properties: { color: '#ff0000' } },
        },
      },
    } satisfies GeometryContext)
    const face = group.getObjectByName('face:face:0') as Mesh

    expect(face.geometry.getAttribute('uv').count).toBe(4)
    const uv = Array.from(face.geometry.getAttribute('uv').array)
    expect(uv).toHaveLength(8)
    for (const [index, expected] of [0, 0, 1.2, 0, 1.2, 0.8, 0, 0.8].entries()) {
      expect(uv[index]).toBeCloseTo(expected, 6)
    }
    expect(
      (face.material as { color?: { getHexString: () => string } }).color?.getHexString(),
    ).toBe('ff0000')
  })

  test('keeps the painted moved face material and UV frame after push/pull', () => {
    const source = createRectangleBody({ width: 1.2, depth: 0.8 })
    const painted = {
      ...source,
      faces: source.faces.map((face) => ({
        ...face,
        surface: { ...face.surface, materialRef: 'library:wood-woodplank48' },
      })),
    }
    const result = pushPullBodyFace(painted, 'face:0', 1.2)
    const movedFace = result.body.faces.find((face) => face.id === 'face:0')

    expect(movedFace?.surface).toEqual(painted.faces[0]?.surface)
    expect(
      (buildBodyGeometry(result.body).getObjectByName('face:face:0') as Mesh).geometry.getAttribute(
        'uv',
      ),
    ).toBeDefined()
  })
})

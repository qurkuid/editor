import { describe, expect, test } from 'bun:test'
import {
  createRectangleBody,
  createRoundedRectangularFrameBody,
  type GeometryContext,
  offsetBodyFace,
  pushPullBodyFace,
  type SceneMaterialId,
} from '@pascal-app/core'
import { LineSegments, Mesh } from 'three'
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

  test('merges imported SketchUp faces into one selectable mesh', () => {
    const source = pushPullBodyFace(createRectangleBody({ width: 1.2, depth: 0.8 }), 'face:0', 1)
      .body
    const body = { ...source, metadata: { source: 'SketchUp' } }
    const group = buildBodyGeometry(body)
    const mesh = group.children[0] as Mesh

    expect(group.children).toHaveLength(1)
    expect(mesh.userData.faceIdsByTriangle).toContain('face:0')
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

  test('renders one persistent seam primitive for a committed inward face offset', () => {
    const pushed = pushPullBodyFace(createRectangleBody({ width: 1.2, depth: 0.8 }), 'face:0', 1)
    const offset = offsetBodyFace(pushed.body, 'face:0', -0.2)
    const group = buildBodyGeometry(offset.body)
    const seams = group.children.filter((child) => child instanceof LineSegments)

    expect(seams).toHaveLength(1)
    expect(seams[0]?.name).toBe('body:coplanar-seams')
    expect(seams[0]?.geometry.getAttribute('position').count).toBe(8)
    expect(seams[0]?.userData).toEqual({ bodyId: offset.body.id, pascalNodeId: offset.body.id })
    expect(seams[0]?.material).toMatchObject({ depthTest: true, depthWrite: false })
  })

  test('does not render seams between perpendicular faces of a pushed solid', () => {
    const result = pushPullBodyFace(createRectangleBody({ width: 1.2, depth: 0.8 }), 'face:0', 1)
    const group = buildBodyGeometry(result.body)

    expect(group.children.filter((child) => child instanceof LineSegments)).toHaveLength(0)
  })
})

import {
  buildWallConstructionLayerSpans,
  getWallBandConstruction,
  getWallCurveFrameAt,
  getWallCurveLength,
  getWallFaceBandConfig,
  getWallThickness,
  isCurvedWall,
  type WallConstructionLayer,
  type WallFaceBand,
  type WallNode,
} from '@pascal-app/core'
import { Brush, csgEvaluator, INTERSECTION, prepareBrushForCSG } from '@pascal-app/viewer'
import {
  BoxGeometry,
  type BufferGeometry,
  ExtrudeGeometry,
  MeshBasicMaterial,
  Shape,
  Vector2,
} from 'three'
import { buildWallStudPlacements } from './construction-visual'

export type WallConstructionPart = {
  band: WallFaceBand
  layerIndex: number
  kind: WallConstructionLayer['kind']
  geometry: BufferGeometry
}

const CUT_MATERIAL = new MeshBasicMaterial()

export function hasWallConstruction(node: WallNode) {
  const count = getWallFaceBandConfig(node, node.height ?? 2.5).count
  const bands: WallFaceBand[] =
    count === 1
      ? ['upper']
      : count === 2
        ? ['lower', 'upper']
        : count === 3
          ? ['lower', 'middle', 'upper']
          : ['lower', 'middle', 'upper', 'top']
  return bands.some((band) => {
    const construction = node.faceBands?.construction?.[band]
    return construction && construction.mode !== 'finish' && construction.layers.length > 0
  })
}

export function buildWallConstructionGeometry(
  node: WallNode,
  envelope: BufferGeometry,
): WallConstructionPart[] {
  envelope.computeBoundingBox()
  const bounds = envelope.boundingBox
  if (!bounds || bounds.isEmpty() || bounds.max.y <= bounds.min.y) return []
  const height = bounds.max.y
  const bands = getWallFaceBandConfig(node, height)
  const bandRanges: Array<[WallFaceBand, number, number]> =
    bands.count === 1
      ? [['upper', bounds.min.y, height]]
      : bands.count === 2
        ? [
            ['lower', bounds.min.y, bands.lowerTop],
            ['upper', bands.lowerTop, height],
          ]
        : bands.count === 3
          ? [
              ['lower', bounds.min.y, bands.lowerTop],
              ['middle', bands.lowerTop, bands.middleTop],
              ['upper', bands.middleTop, height],
            ]
          : [
              ['lower', bounds.min.y, bands.lowerTop],
              ['middle', bands.lowerTop, bands.middleTop],
              ['upper', bands.middleTop, bands.upperTop],
              ['top', bands.upperTop, height],
            ]
  const parts: WallConstructionPart[] = []
  const hostGeometry = envelope.clone()
  hostGeometry.clearGroups()
  const host = new Brush(hostGeometry, CUT_MATERIAL)
  prepareBrushForCSG(host)
  const length = getWallCurveLength(node)
  const angle = Math.atan2(node.end[1] - node.start[1], node.end[0] - node.start[0])
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const extension = getWallThickness(node) * 4 + 0.01

  const localPoint = (ratio: number, offset: number, extend = 0) => {
    const frame = getWallCurveFrameAt(node, ratio)
    const dx = frame.point.x + frame.normal.x * offset + frame.tangent.x * extend - node.start[0]
    const dz = frame.point.y + frame.normal.y * offset + frame.tangent.y * extend - node.start[1]
    return new Vector2(cos * dx + sin * dz, -sin * dx + cos * dz)
  }
  const strip = (start: number, end: number, bottom: number, top: number) => {
    const segments = isCurvedWall(node) ? 24 : 1
    const points: Vector2[] = []
    for (const [offset, reverse] of [
      [start, false],
      [end, true],
    ] as const) {
      const first = localPoint(reverse ? 1 : 0, offset, reverse ? extension : -extension)
      points.push(new Vector2(first.x, -first.y))
      for (let i = 0; i <= segments; i++) {
        const index = reverse ? segments - i : i
        const p = localPoint(index / segments, offset)
        points.push(new Vector2(p.x, -p.y))
      }
      const last = localPoint(reverse ? 0 : 1, offset, reverse ? -extension : extension)
      points.push(new Vector2(last.x, -last.y))
    }
    const geometry = new ExtrudeGeometry(new Shape(points), {
      depth: top - bottom,
      bevelEnabled: false,
    })
    geometry.rotateX(-Math.PI / 2)
    geometry.translate(0, bottom, 0)
    return geometry
  }
  const add = (
    geometry: BufferGeometry,
    band: WallFaceBand,
    layerIndex: number,
    kind: WallConstructionPart['kind'],
  ) => {
    geometry.clearGroups()
    const mask = new Brush(geometry, CUT_MATERIAL)
    prepareBrushForCSG(mask)
    try {
      const result = csgEvaluator.evaluate(host, mask, INTERSECTION).geometry
      result.clearGroups()
      if (result.getAttribute('position')?.count > 0)
        parts.push({ band, layerIndex, kind, geometry: result })
      else result.dispose()
    } finally {
      geometry.dispose()
    }
  }
  try {
    for (const [band, bottom, top] of bandRanges) {
      if (top - bottom < 1e-6) continue
      const construction = getWallBandConstruction(node, band)
      const explicit = node.faceBands?.construction?.[band]
      if (!explicit || construction.mode === 'finish' || construction.layers.length === 0) {
        add(
          strip(-(node.thickness ?? 0.1) / 2, (node.thickness ?? 0.1) / 2, bottom, top),
          band,
          -1,
          'custom',
        )
        continue
      }
      const spans = buildWallConstructionLayerSpans(construction)
      const coreThickness = construction.mode === 'overlay' ? (node.thickness ?? 0.1) : 0
      if (coreThickness > 0) {
        const total =
          coreThickness + construction.layers.reduce((sum, layer) => sum + layer.thickness, 0)
        add(strip(-total / 2, -total / 2 + coreThickness, bottom, top), band, -1, 'custom')
      }
      for (const span of spans) {
        if (span.kind === 'cavity') continue
        const start = span.start + coreThickness / 2
        const end = span.end + coreThickness / 2
        const layer = construction.layers[span.layerIndex]!
        if (span.kind !== 'timber-stud') {
          add(strip(start, end, bottom, top), band, span.layerIndex, span.kind)
          continue
        }
        const width = Math.min(layer.memberWidth ?? 0.033, layer.studSpacing ?? 0.3, length)
        const railHeight = Math.min(width, (top - bottom) / 2)
        add(strip(start, end, bottom, bottom + railHeight), band, span.layerIndex, span.kind)
        add(strip(start, end, top - railHeight, top), band, span.layerIndex, span.kind)
        if (top - bottom <= railHeight * 2) continue
        for (const { ratio } of buildWallStudPlacements(length, layer.studSpacing, width)) {
          const p = localPoint(ratio, (start + end) / 2)
          const frame = getWallCurveFrameAt(node, ratio)
          const tangentAngle = Math.atan2(frame.tangent.y, frame.tangent.x) - angle
          const stud = new BoxGeometry(width, top - bottom - railHeight * 2, span.thickness)
          stud.rotateY(-tangentAngle)
          stud.translate(p.x, (bottom + top) / 2, p.y)
          add(stud, band, span.layerIndex, span.kind)
        }
      }
    }
    return parts
  } catch (error) {
    for (const part of parts) part.geometry.dispose()
    throw error
  } finally {
    hostGeometry.dispose()
  }
}

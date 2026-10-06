import { describe, expect, test } from 'bun:test'
import { createRequire } from 'node:module'
import { ZonePlanSketch } from './quantities-panel'

const { renderToStaticMarkup } = createRequire(
  new URL('../../../editor/package.json', import.meta.url),
)('react-dom/server') as typeof import('react-dom/server')

const polygon = [
  [0, 0],
  [6, 0],
  [6, 2],
  [2, 2],
  [2, 5],
  [0, 5],
] as const

const projectedPoints = [
  [73.2, 34],
  [202.8, 34],
  [202.8, 77.2],
  [116.4, 77.2],
  [116.4, 142],
  [73.2, 142],
] as const

const edgeLengths = [6, 2, 4, 3, 2, 5] as const

function renderSketch(inputPolygon: readonly (readonly [number, number])[] = polygon) {
  return renderToStaticMarkup(
    <ZonePlanSketch
      edgeLengths={edgeLengths}
      metricNotation="meters"
      polygon={inputPolygon}
      unit="metric"
    />,
  )
}

function polygonPoints(markup: string): number[][] {
  const points = markup.match(/<polygon[^>]*\bpoints="([^"]+)"/u)?.[1]
  if (!points) return []
  return points.split(' ').map((point) => point.split(',').map(Number))
}

function sketchGroups(markup: string) {
  const groups = [
    ...markup.matchAll(
      /<g><circle\b[^>]*\bcx="([^"]+)"[^>]*\bcy="([^"]+)"[^>]*>[\s\S]*?<text\b[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"[^>]*>([^<]*)<\/text>[\s\S]*?<\/g>/gu,
    ),
  ]
  return groups.map((match) => ({
    circle: [Number(match[1]), Number(match[2])],
    label: [Number(match[3]), Number(match[4])],
    text: match[5],
  }))
}

function expectPointsClose(
  actual: readonly (readonly number[])[],
  expected: readonly (readonly number[])[],
) {
  expect(actual).toHaveLength(expected.length)
  actual.forEach((point, index) => {
    expect(point).toHaveLength(expected[index]!.length)
    point.forEach((value, coordinate) => {
      expect(value).toBeCloseTo(expected[index]![coordinate]!, 8)
    })
  })
}

function expectedLabelPoints(points: readonly (readonly [number, number])[]) {
  const center = points.reduce(
    (sum, point) => [sum[0] + point[0] / points.length, sum[1] + point[1] / points.length],
    [0, 0],
  )

  return points.map((start, index) => {
    const end = points[(index + 1) % points.length]!
    const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2]
    const fromCenter = [midpoint[0] - center[0], midpoint[1] - center[1]]
    const directionLength = Math.hypot(fromCenter[0], fromCenter[1]) || 1
    return [
      midpoint[0] + (fromCenter[0] / directionLength) * 15,
      midpoint[1] + (fromCenter[1] / directionLength) * 15,
    ]
  })
}

describe('ZonePlanSketch', () => {
  test('keeps the canonical X/Z orientation and edge label association', () => {
    const markup = renderSketch()
    const groups = sketchGroups(markup)
    const actualPoints = polygonPoints(markup)

    expectPointsClose(actualPoints, projectedPoints)
    expectPointsClose(
      groups.map((group) => group.circle),
      projectedPoints,
    )
    expect(groups.map((group) => group.text)).toEqual(['6m', '2m', '4m', '3m', '2m', '5m'])

    const labels = expectedLabelPoints(projectedPoints)
    groups.forEach((group, index) => {
      expect(group.label[0]).toBeCloseTo(labels[index]![0]!, 8)
      expect(group.label[1]).toBeCloseTo(labels[index]![1]!, 8)
    })

    expect(actualPoints[0]![1]!).toBeLessThan(actualPoints[4]![1]!)
    expect(actualPoints[3]![0]!).toBeLessThan(actualPoints[2]![0]!)
  })

  test('keeps the same sketch when the source polygon is translated into negative coordinates', () => {
    const translated = polygon.map(([x, y]) => [x - 11, y - 13] as const)
    expectPointsClose(polygonPoints(renderSketch(translated)), projectedPoints)
  })

  test('shows the boundary fallback for fewer than three points', () => {
    const markup = renderSketch([
      [0, 0],
      [1, 1],
    ])

    expect(markup).toContain('Zone boundary unavailable')
    expect(markup).not.toContain('<polygon')
  })
})

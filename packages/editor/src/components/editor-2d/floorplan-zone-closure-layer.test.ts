import { describe, expect, test } from 'bun:test'
import type {
  RoomBoundaryCandidate,
  RoomBoundaryEndpoint,
  RoomBoundaryIssue,
} from '@pascal-app/core'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  buildRoomBoundaryOverlayEntries,
  RoomBoundaryMarker,
  roomBoundaryMarkerPointerHandlers,
  selectBestRoomBoundaryCandidate,
} from './floorplan-zone-closure-layer'

function candidate(overrides: Partial<RoomBoundaryCandidate>): RoomBoundaryCandidate {
  return {
    id: 'candidate-default',
    endpoint: { wallId: 'wall_a', endpoint: 'end', point: [2, 0] },
    targetWallId: 'wall_b',
    targetPoint: [2, 0.2],
    distance: 0.2,
    join: 'end-to-end',
    safe: false,
    ...overrides,
  }
}

describe('floorplan zone closure layer', () => {
  test.each([
    0.01, 0.1,
  ])('keeps keyboard focus indication screen-scaled at %s units per pixel', (unitsPerPixel) => {
    const markup = renderToStaticMarkup(
      createElement(RoomBoundaryMarker, {
        entry: {
          endpoint: { wallId: 'wall_open', endpoint: 'start', point: [2, 3] },
          status: 'manual',
        },
        metricNotation: 'millimeters',
        onActivate: () => {},
        sceneRotationDeg: 0,
        unit: 'metric',
        unitsPerPixel,
      }),
    )
    const marker = markup.match(/^<g\b[^>]*>/)?.[0] ?? ''
    expect(marker).toContain('style="outline:none"')
    expect(marker).toContain('class="group/room-boundary"')
    expect(marker).toContain('role="button"')
    expect(marker).toContain('tabindex="0"')
    expect(marker).toContain('aria-label="벽 wall_open start 경계 점검"')

    const ring = markup.match(/<circle\b[^>]*data-room-boundary-focus="true"[^>]*>/)?.[0] ?? ''
    expect(ring).toContain('class="hidden group-focus-visible/room-boundary:block"')
    expect(ring).toContain('aria-hidden="true"')
    expect(ring).toContain('pointer-events="none"')
    expect(ring).toContain('fill="none"')
    expect(ring).toContain('stroke="#f59e0b"')
    expect(ring).toContain('cx="2"')
    expect(ring).toContain('cy="3"')
    expect(Number(ring.match(/\br="([^"]+)"/)?.[1]) / unitsPerPixel).toBeCloseTo(9)
    expect(Number(ring.match(/\bstroke-width="([^"]+)"/)?.[1]) / unitsPerPixel).toBeCloseTo(2)
  })

  test('shows the best safe candidate instead of a nearer manual candidate', () => {
    const manual = candidate({ id: 'manual', distance: 0.04, reason: 'ambiguous' })
    const safe = candidate({ id: 'safe', distance: 0.2, safe: true })
    const issue: RoomBoundaryIssue = {
      id: 'wall_a:end:2,0',
      wallId: 'wall_a',
      endpoint: 'end',
      point: [2, 0],
      candidates: [manual, safe],
    }

    expect(selectBestRoomBoundaryCandidate(issue)).toBe(safe)
    const endpoint: RoomBoundaryEndpoint = {
      wallId: 'wall_a',
      endpoint: 'end',
      point: [2, 0],
    }
    const [entry] = buildRoomBoundaryOverlayEntries({
      danglingEndpoints: [endpoint],
      issues: [issue],
    })

    expect(entry).toMatchObject({
      candidate: safe,
      status: 'repairable',
    })
  })

  test('keeps a dangling endpoint visible when no candidate is available', () => {
    const endpoint: RoomBoundaryEndpoint = {
      wallId: 'wall_open',
      endpoint: 'start',
      point: [0, 0],
    }

    const [entry] = buildRoomBoundaryOverlayEntries({
      danglingEndpoints: [endpoint],
      issues: [],
    })

    expect(entry).toMatchObject({ endpoint, status: 'manual' })
    expect(entry?.candidate).toBeUndefined()
  })
})

test('marker drag relays original anchor and lets threshold move and release reach registry', () => {
  const pending = { current: null } as Parameters<typeof roomBoundaryMarkerPointerHandlers>[0]
  let stops = 0
  const captured: number[][] = []
  const handlers = roomBoundaryMarkerPointerHandlers(pending, (event) => {
    captured.push([event.clientX, event.clientY])
    event.stopPropagation()
  })
  const event = (x: number, y: number) =>
    ({
      button: 0,
      clientX: x,
      clientY: y,
      pointerId: 1,
      currentTarget: { setPointerCapture() {} },
      preventDefault() {},
      stopPropagation() {
        stops++
      },
    }) as unknown as Parameters<typeof handlers.onPointerDown>[0]
  handlers.onPointerDown(event(100, 200))
  handlers.onPointerMove(event(103, 200))
  expect(captured).toHaveLength(0)
  handlers.onPointerMove(event(106, 208))
  expect(captured).toEqual([[100, 200]])
  handlers.onPointerUp(event(106, 208))
  expect(stops).toBe(1)
  expect(pending.current?.dragged).toBe(true)
  handlers.onPointerDown(event(100, 200))
  handlers.onPointerUp(event(100, 200))
  expect(stops).toBe(3)
})

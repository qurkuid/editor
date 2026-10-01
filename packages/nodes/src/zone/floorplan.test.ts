import { describe, expect, test } from 'bun:test'
import { type FloorplanGeometry, type GeometryContext, ZoneNode } from '@pascal-app/core'
import { readFloorplanGeometryMetadata } from '@pascal-app/editor'
import { buildZoneFloorplan } from './floorplan'

const context = {
  resolve: () => undefined,
  children: [],
  siblings: [],
  parent: null,
} satisfies GeometryContext

function textChildren(geometry: FloorplanGeometry | null) {
  if (geometry?.kind !== 'group') return []
  return geometry.children.filter((child) => child.kind === 'text')
}

describe('buildZoneFloorplan room documentation', () => {
  test('shows unresolved room boundaries in the 2D plan', () => {
    const room = ZoneNode.parse({
      name: 'Bedroom',
      spaceRole: 'room',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      metadata: { boundaryNeedsReview: true },
    })
    expect(textChildren(buildZoneFloorplan(room, context))).toContainEqual(
      expect.objectContaining({ text: '구획 확인 필요' }),
    )
  })
  test('keeps a generic zone label unchanged', () => {
    const zone = ZoneNode.parse({
      id: 'zone_landscape',
      name: 'Courtyard',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
    })

    expect(textChildren(buildZoneFloorplan(zone, context))).toEqual([
      expect.objectContaining({ kind: 'text', text: 'Courtyard', upright: true }),
    ])
  })

  test('centers room name, number, finish, and height information as room annotations', () => {
    const room = ZoneNode.parse({
      id: 'zone_office',
      name: 'Office',
      polygon: [
        [0, 0],
        [4, 0],
        [4, 3],
        [0, 3],
      ],
      spaceRole: 'room',
      roomNumber: '101',
      floorFinish: 'Timber',
      wallFinish: 'Paint',
      ceilingFinish: 'ACT',
      ceilingHeight: 2.7,
      occupancy: 'Business',
    })

    const labels = textChildren(buildZoneFloorplan(room, context))
    expect(labels.map((label) => ('text' in label ? label.text : ''))).toEqual([
      'Office',
      '101',
      'FL: Timber · WL: Paint · CL: ACT',
      'CH: 2.7m · Business',
    ])
    expect(labels.every((label) => label.kind === 'text' && label.upright)).toBe(true)
    expect(
      labels.every((label) => readFloorplanGeometryMetadata(label).annotationRole === 'room-label'),
    ).toBe(true)
  })
})

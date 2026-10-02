import { describe, expect, it } from 'bun:test'
import {
  FinishTemplateCreateRequestSchema,
  ServerZoneFinishTemplateSchema,
} from './finish-template-schema'

const snapshot = {
  version: 1 as const,
  id: 'zone-template_test',
  name: 'Room finish',
  createdAt: '2026-10-02T00:00:00.000Z',
  source: {
    zoneId: 'zone_room',
    fingerprint: {
      levelId: 'level_test',
      zoneId: 'zone_room',
      polygonSignature: '0,0;4,0;4,4;0,4',
      inwardWalls: [
        {
          wallId: 'wall_bottom',
          face: 'front' as const,
          segmentSignature: '0,0|4,0',
          length: 4,
          activeSlotRoles: ['interior'],
        },
      ],
      floor: { slabId: 'slab_floor', polygonSignature: '0,0;4,0;4,4;0,4' },
    },
  },
  walls: [
    {
      sourceFace: {
        wallId: 'wall_bottom',
        face: 'front' as const,
        key: 'wall_bottom:front',
        segmentSignature: '0,0|4,0',
        length: 4,
        activeSlotRoles: ['interior'],
      },
      slots: [
        {
          role: 'interior',
          material: {
            label: 'Oak',
            material: { texture: { url: 'asset://oak' } },
          },
        },
      ],
    },
  ],
  floor: {
    label: 'Oak',
    material: { texture: { url: 'https://cdn.example.test/oak.png' } },
  },
}

describe('finish template server schema', () => {
  it('rejects browser-only material handles while allowing portable URLs', () => {
    expect(ServerZoneFinishTemplateSchema.safeParse(snapshot).success).toBe(false)
    expect(
      ServerZoneFinishTemplateSchema.safeParse({
        ...snapshot,
        walls: [
          {
            ...snapshot.walls[0],
            slots: [
              {
                ...snapshot.walls[0].slots[0],
                material: {
                  ...snapshot.walls[0].slots[0].material,
                  material: { texture: { url: 'data:image/png;base64,AA==' } },
                },
              },
            ],
          },
        ],
      }).success,
    ).toBe(true)
  })

  it('rejects body-owned scope fields while deriving identity from the snapshot', () => {
    expect(
      FinishTemplateCreateRequestSchema.safeParse({
        kind: 'zone',
        visibility: 'private',
        ownerId: 'attacker',
        template: snapshot,
      }).success,
    ).toBe(false)
    const portableSnapshot = {
      ...snapshot,
      walls: [
        {
          ...snapshot.walls[0],
          slots: [
            {
              ...snapshot.walls[0].slots[0],
              material: {
                ...snapshot.walls[0].slots[0].material,
                material: { texture: { url: 'data:image/png;base64,AA==' } },
              },
            },
          ],
        },
      ],
    }
    expect(
      FinishTemplateCreateRequestSchema.safeParse({ kind: 'zone', template: portableSnapshot })
        .success,
    ).toBe(true)
  })

  it('checks wall keys and home source-zone identity at the schema boundary', () => {
    expect(
      ServerZoneFinishTemplateSchema.safeParse({
        ...snapshot,
        walls: [
          {
            ...snapshot.walls[0],
            sourceFace: { ...snapshot.walls[0].sourceFace, key: 'other:front' },
          },
        ],
      }).success,
    ).toBe(false)

    const home = {
      version: 1 as const,
      id: 'home-template_test',
      name: 'Home finish',
      createdAt: snapshot.createdAt,
      zones: [{ sourceZoneId: 'zone_other', sourceZoneName: 'Other', template: snapshot }],
    }
    const result = FinishTemplateCreateRequestSchema.safeParse({ kind: 'home', template: home })
    expect(result.success).toBe(false)
  })

  it('accepts the canonical key for a partial wall range', () => {
    const partial = {
      ...snapshot,
      walls: [
        {
          ...snapshot.walls[0],
          sourceFace: {
            ...snapshot.walls[0].sourceFace,
            start: 0.125,
            end: 0.625,
            key: 'wall_bottom:0.125000:0.625000:front',
          },
          slots: [
            {
              ...snapshot.walls[0].slots[0],
              material: {
                ...snapshot.walls[0].slots[0].material,
                material: { texture: { url: 'data:image/png;base64,AA==' } },
              },
            },
          ],
        },
      ],
    }
    expect(ServerZoneFinishTemplateSchema.safeParse(partial).success).toBe(true)
  })
})

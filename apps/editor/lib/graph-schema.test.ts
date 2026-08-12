import { describe, expect, test } from 'bun:test'
import { apiGraphSchema } from './graph-schema'

const material = {
  id: 'mat_api_red',
  name: 'API red',
  material: {
    preset: 'custom',
    properties: { color: '#b91c1c' },
    texture: { url: '/api/materials/rawpainter/asset/70225' },
  },
}

describe('apiGraphSchema scene materials', () => {
  test('accepts SceneMaterial texture URLs allowed by core', () => {
    const result = apiGraphSchema.safeParse({
      nodes: {},
      rootNodeIds: [],
      materials: { [material.id]: material },
    })

    expect(result.success).toBe(true)
  })

  test('rejects untrusted SceneMaterial texture URLs', () => {
    const result = apiGraphSchema.safeParse({
      nodes: {},
      rootNodeIds: [],
      materials: {
        [material.id]: {
          ...material,
          material: { ...material.material, texture: { url: 'javascript:alert(1)' } },
        },
      },
    })

    expect(result.success).toBe(false)
  })
})

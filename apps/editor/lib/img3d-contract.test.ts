import { describe, expect, test } from 'bun:test'
import {
  IMG3D_MAX_PARTS,
  Img3dRequestSchema,
  Img3dSculptSchema,
  img3dCodexSculptJsonSchema,
} from './img3d-contract'

const image = {
  name: 'chair.png',
  mimeType: 'image/png' as const,
  dataUrl: 'data:image/png;base64,aGVsbG8=',
}

const material = {
  name: 'upholstery',
  color: '#8b5e3c',
  roughness: 0.8,
  metalness: 0,
  slot: 'fabric',
}

const boxPart = {
  name: 'seat',
  primitive: 'box' as const,
  material: 0,
  position: [0, 0.45, 0] as const,
  rotation: [0, 0, 0] as const,
  size: [1.2, 0.1, 0.6] as const,
}

describe('img3d external boundaries', () => {
  test('emits a Codex-compatible structured output schema', () => {
    const serializedSchema = JSON.stringify(img3dCodexSculptJsonSchema)

    expect(serializedSchema).not.toContain('"oneOf"')
    expect(serializedSchema).toContain('"anyOf"')
  })

  test('parses one 5 MB-bounded image and metre dimensions', () => {
    const request = Img3dRequestSchema.parse({
      image,
      dimensions: { width: 1.2, height: 0.9, depth: 0.6 },
      provider: 'codex',
    })

    expect(request.dimensions).toEqual({ width: 1.2, height: 0.9, depth: 0.6 })
    expect(request.provider).toBe('codex')
  })

  test('rejects a decoded image above the shared 5 MB AI boundary', () => {
    expect(() =>
      Img3dRequestSchema.parse({
        image: {
          ...image,
          dataUrl: `data:image/png;base64,${Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64')}`,
        },
        dimensions: { width: 1.2, height: 0.9, depth: 0.6 },
      }),
    ).toThrow('5 MB')
  })

  test('rejects a MIME type that does not match the data URL', () => {
    expect(() =>
      Img3dRequestSchema.parse({
        image: { ...image, mimeType: 'image/jpeg' },
        dimensions: { width: 1.2, height: 0.9, depth: 0.6 },
      }),
    ).toThrow('MIME type')
  })

  test('rejects extra request fields and oversized dimensions', () => {
    expect(() =>
      Img3dRequestSchema.parse({
        image,
        dimensions: { width: 101, height: 1, depth: 1 },
        provider: 'codex',
        script: 'run me',
      }),
    ).toThrow()
  })

  test('rejects arbitrary sculpt properties and executable or remote material data', () => {
    expect(() =>
      Img3dSculptSchema.parse({
        version: 1,
        name: 'Chair',
        materials: [{ ...material, textureUrl: 'https://example.com/texture.png' }],
        parts: [{ ...boxPart, script: 'alert(1)' }],
      }),
    ).toThrow()
  })

  test('bounds part count and primitive segment counts', () => {
    expect(() =>
      Img3dSculptSchema.parse({
        version: 1,
        name: 'Too many parts',
        materials: [material],
        parts: Array.from({ length: IMG3D_MAX_PARTS + 1 }, (_, index) => ({
          ...boxPart,
          name: `part-${index}`,
        })),
      }),
    ).toThrow()
    expect(() =>
      Img3dSculptSchema.parse({
        version: 1,
        name: 'Unbounded cylinder',
        materials: [material],
        parts: [
          {
            name: 'leg',
            primitive: 'cylinder',
            material: 0,
            position: [0, 0.4, 0],
            rotation: [0, 0, 0],
            radius: 0.05,
            height: 0.8,
            radialSegments: 512,
          },
        ],
      }),
    ).toThrow()
  })
})

// @ts-expect-error — bun:test is provided by the Bun runtime; viewer does not
// depend on @types/bun so the import type is unresolved at compile time.
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import type { MaterialSchema } from '@pascal-app/core'
import * as THREE from 'three'

import { ensureKtx2Support, ktx2Loader } from './ktx2-loader'
import {
  clearMaterialCache,
  createMaterial,
  getTextureKey,
  resolveTextureRepeat,
} from './materials'

function materialWithRepeat(repeat: unknown): MaterialSchema {
  return {
    texture: {
      url: 'https://example.com/texture.png',
      repeat,
    },
  } as unknown as MaterialSchema
}

describe('legacy texture repeat values', () => {
  test('normalizes tuple, scalar, and Vector2-shaped repeats', () => {
    expect(resolveTextureRepeat([2, 3], undefined)).toEqual([2, 3])
    expect(resolveTextureRepeat(2, undefined)).toEqual([2, 2])
    expect(resolveTextureRepeat({ x: 2, y: 3 }, undefined)).toEqual([2, 3])
  })

  test('falls back to scale for malformed repeats', () => {
    expect(resolveTextureRepeat({ width: 2 }, 4)).toEqual([4, 4])
  })

  test('keeps distinct Vector2-shaped repeats in distinct cache entries', () => {
    expect(getTextureKey(materialWithRepeat({ x: 2, y: 3 }))).not.toBe(
      getTextureKey(materialWithRepeat({ x: 4, y: 5 })),
    )
  })
})

describe('scene KTX2 textures', () => {
  const supabaseUrlBefore = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseUrl = 'https://supabase.example.com'

  beforeAll(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrl
  })

  afterAll(() => {
    if (supabaseUrlBefore === undefined) {
      delete process.env.NEXT_PUBLIC_SUPABASE_URL
    } else {
      process.env.NEXT_PUBLIC_SUPABASE_URL = supabaseUrlBefore
    }
  })

  async function flushTextureLoad() {
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  function ensureLoaderReady() {
    const detectSupport = spyOn(
      ktx2Loader as unknown as { detectSupport: (renderer: object) => void },
      'detectSupport',
    ).mockImplementation(() => {})
    ensureKtx2Support({})
    detectSupport.mockRestore()
  }

  function sceneMaterial(url: string, bumpUrl?: string, bumpScale = -0.35): MaterialSchema {
    return {
      properties: {
        color: '#d8d8d8',
        roughness: 0.6,
        metalness: 0,
        opacity: 1,
        transparent: false,
        side: 'front',
      },
      texture: {
        url,
        repeat: [2, 3],
        offset: [0.25, 0.5],
        rotationDeg: 30,
        ...(bumpUrl ? { bumpUrl, bumpScale } : {}),
      },
    }
  }

  function textureSlot(material: THREE.Material, slot: 'map' | 'bumpMap') {
    return (material as THREE.Material & Record<'map' | 'bumpMap', THREE.Texture | null>)[slot]
  }

  function makeCompressedTexture(): THREE.CompressedTexture {
    return new THREE.CompressedTexture(
      [{ data: new Uint8Array(16), width: 4, height: 4 }],
      4,
      4,
      THREE.RGBA_S3TC_DXT1_Format,
    )
  }

  test('creates a mapless material and attaches the resolved compressed textures', async () => {
    const ktx2Url = `${supabaseUrl}/storage/v1/object/public/project-assets/finish.ktx2`
    const bumpUrl = `${supabaseUrl}/storage/v1/object/public/project-assets/finish-height.ktx2`
    const compressedTexture = new THREE.CompressedTexture(
      [{ data: new Uint8Array(16), width: 4, height: 4 }],
      4,
      4,
      THREE.RGBA_S3TC_DXT1_Format,
    )
    const load = spyOn(ktx2Loader, 'load').mockImplementation(() => undefined)
    const bumpTexture = makeCompressedTexture()
    const loadAsync = spyOn(ktx2Loader, 'loadAsync').mockImplementation((url: string) =>
      Promise.resolve(url === bumpUrl ? bumpTexture : compressedTexture),
    )

    try {
      ensureLoaderReady()
      const material = createMaterial(sceneMaterial(ktx2Url, bumpUrl))
      const initialVersion = material.version

      expect(textureSlot(material, 'map')).toBeNull()
      expect(textureSlot(material, 'bumpMap')).toBeNull()
      await flushTextureLoad()
      expect(loadAsync).toHaveBeenCalledTimes(2)
      expect(loadAsync).toHaveBeenCalledWith(ktx2Url)
      expect(loadAsync).toHaveBeenCalledWith(bumpUrl)
      expect(textureSlot(material, 'map')).toBe(compressedTexture)
      expect(textureSlot(material, 'bumpMap')).toBe(bumpTexture)
      const map = textureSlot(material, 'map')!
      const bump = textureSlot(material, 'bumpMap')!
      expect(map.repeat.x).toBe(2)
      expect(map.repeat.y).toBe(3)
      expect(map.offset.x).toBe(0.25)
      expect(map.offset.y).toBe(0.5)
      expect(map.center.x).toBe(0.5)
      expect(map.center.y).toBe(0.5)
      expect(map.rotation).toBeCloseTo(Math.PI / 6)
      expect(map.matrix.elements).not.toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
      expect(map.colorSpace).toBe(THREE.SRGBColorSpace)
      expect(bump.colorSpace).toBe(THREE.NoColorSpace)
      expect((material as THREE.Material & { bumpScale?: number }).bumpScale).toBe(-0.35)
      expect(map.userData.pascalTextureRef).toEqual({
        v: 1,
        src: ktx2Url,
        map: 'basecolor',
        colorSpace: 'srgb',
        kind: 'project-asset',
      })
      expect(material.version).toBeGreaterThan(initialVersion)
      const resolvedVersion = material.version
      const cachedMaterial = createMaterial(sceneMaterial(ktx2Url, bumpUrl))
      expect(cachedMaterial).toBe(material)
      expect(loadAsync).toHaveBeenCalledTimes(2)
      expect(material.version).toBe(resolvedVersion)
      expect(load).not.toHaveBeenCalled()
    } finally {
      clearMaterialCache()
      load.mockRestore()
      loadAsync.mockRestore()
    }
  })

  test('keeps the authored flat material renderable after a KTX2 rejection', async () => {
    const ktx2Url = `${supabaseUrl}/storage/v1/object/public/project-assets/rejected.ktx2`
    const error = new Error('transcode failed')
    const retryTexture = makeCompressedTexture()
    let attempts = 0
    const loadAsync = spyOn(ktx2Loader, 'loadAsync').mockImplementation(() => {
      attempts += 1
      return attempts === 1 ? Promise.reject(error) : Promise.resolve(retryTexture)
    })
    const warning = spyOn(console, 'warn').mockImplementation(() => {})

    try {
      ensureLoaderReady()
      const material = createMaterial(sceneMaterial(ktx2Url))
      expect(textureSlot(material, 'map')).toBeNull()
      await flushTextureLoad()
      expect(textureSlot(material, 'map')).toBeNull()
      expect(warning).toHaveBeenCalledWith(
        '[viewer] Failed to load material texture',
        ktx2Url,
        error,
      )
      expect(loadAsync).toHaveBeenCalledTimes(1)

      const cachedMaterial = createMaterial(sceneMaterial(ktx2Url))
      expect(cachedMaterial).toBe(material)
      await flushTextureLoad()
      expect(loadAsync).toHaveBeenCalledTimes(2)
      expect(textureSlot(material, 'map')).toBe(retryTexture)
    } finally {
      clearMaterialCache()
      warning.mockRestore()
      loadAsync.mockRestore()
    }
  })

  test('keeps ordinary image textures on the synchronous TextureLoader path', () => {
    const imageListeners = new Map<string, (this: object) => void>()
    const fakeImage = {
      complete: false,
      addEventListener(type: string, listener: (this: object) => void) {
        imageListeners.set(type, listener)
      },
      removeEventListener(type: string) {
        imageListeners.delete(type)
      },
      set src(_value: string) {
        this.complete = true
        imageListeners.get('load')?.call(this)
      },
    }
    const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElementNS: () => fakeImage,
      },
    })

    try {
      const imageUrl = 'https://assets.example.com/finish.png'
      const material = createMaterial(sceneMaterial(imageUrl))
      const map = textureSlot(material, 'map')
      expect(map).toBeInstanceOf(THREE.Texture)
      expect(map?.image).toBe(fakeImage)
    } finally {
      clearMaterialCache()
      if (previousDocument) {
        Object.defineProperty(globalThis, 'document', previousDocument)
      } else {
        delete (globalThis as { document?: unknown }).document
      }
    }
  })
})

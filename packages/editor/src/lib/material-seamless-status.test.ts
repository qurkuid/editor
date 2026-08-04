import { describe, expect, test } from 'bun:test'
import { getMaterialSeamlessAvailability } from './material-seamless-status'

describe('getMaterialSeamlessAvailability', () => {
  test('offers seamless processing for a regular texture image', () => {
    // Given: a material texture that has not been converted yet.
    const textureUrl = '/api/materials/rawpainter/asset/70225'

    // When: the material row determines which seamless action to show.
    const availability = getMaterialSeamlessAvailability(textureUrl)

    // Then: the action is ready to run.
    expect(availability).toBe('ready')
  })

  test('marks a cached seamless asset as complete', () => {
    // Given: a texture stored under the content-addressed seamless asset scheme.
    const textureUrl = `asset://seamless2-${'a'.repeat(64)}`

    // When: the material row determines which seamless action to show.
    const availability = getMaterialSeamlessAvailability(textureUrl)

    // Then: the action is complete and cannot be run twice.
    expect(availability).toBe('complete')
  })

  test('marks a book-matched asset as complete', () => {
    // Given: a texture baked by the book-match mirror pipeline.
    const textureUrl = `asset://bookmatch-${'b'.repeat(64)}`

    // When: the material row determines which seamless action to show.
    const availability = getMaterialSeamlessAvailability(textureUrl)

    // Then: the action is complete and cannot be run twice.
    expect(availability).toBe('complete')
  })

  test('offers reprocessing for assets from the retired seamless pipeline', () => {
    // Given: a texture produced by the old edge-blur-only pass.
    const textureUrl = `asset://seamless-${'a'.repeat(64)}`

    // When: the material row determines which seamless action to show.
    const availability = getMaterialSeamlessAvailability(textureUrl)

    // Then: the action is ready so the better pipeline can replace it.
    expect(availability).toBe('ready')
  })

  test('disables seamless processing when a material has no texture image', () => {
    // Given: a color-only material without an image texture.
    const textureUrl = undefined

    // When: the material row determines which seamless action to show.
    const availability = getMaterialSeamlessAvailability(textureUrl)

    // Then: the action reports that an image is required.
    expect(availability).toBe('missing-texture')
  })
})

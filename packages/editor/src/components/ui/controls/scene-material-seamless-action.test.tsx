import { describe, expect, test } from 'bun:test'
import type { MaterialSchema, SceneMaterialId } from '@pascal-app/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { SceneMaterialSeamlessAction } from './scene-material-seamless-action'

const colorOnlyMaterial: MaterialSchema = {
  preset: 'custom',
  properties: {
    color: '#ffffff',
    roughness: 0.5,
    metalness: 0,
    opacity: 1,
    transparent: false,
    side: 'front',
  },
}

describe('SceneMaterialSeamlessAction', () => {
  test('explains why seamless processing is unavailable for a color-only material', () => {
    // Given: a scene material without an image texture.
    const id = 'mat_color_only' as SceneMaterialId

    // When: the scene material action is rendered.
    const markup = renderToStaticMarkup(
      <SceneMaterialSeamlessAction id={id} material={colorOnlyMaterial} onChange={() => {}} />,
    )

    // Then: the user sees the missing prerequisite instead of a hidden action.
    expect(markup).toContain('텍스처 이미지 필요')
    expect(markup).toContain('이미지 자재를 먼저 적용하세요')
  })
})

import { expect, test } from 'bun:test'
import { generateSceneMaterialId, toSceneMaterialRef } from '@pascal-app/core'
import { renderToStaticMarkup } from 'react-dom/server'
import { MaterialPaintPanel, resolveCurrentBrush } from './material-paint-panel'

test('shows the selected scene material as the current Painting brush', () => {
  // Given: a scene material is selected as the active paint brush.
  const id = generateSceneMaterialId()
  const material = {
    id,
    name: 'Oak selected by user',
    material: {
      preset: 'custom',
      properties: {
        color: '#7a5230',
        roughness: 0.5,
        metalness: 0,
        opacity: 1,
        transparent: false,
        side: 'front',
      },
    },
  } as const

  // When: the selected brush is resolved and Painting is rendered.
  const currentBrush = resolveCurrentBrush(
    { materialPreset: toSceneMaterialRef(id), sourceTarget: 'wall' },
    { [id]: material },
  )
  const markup = renderToStaticMarkup(<MaterialPaintPanel />)

  // Then: the active brush is identified at the top of the workflow.
  expect(markup).toContain('Current brush')
  expect(currentBrush).toEqual({ name: 'Oak selected by user', color: '#7a5230' })
})

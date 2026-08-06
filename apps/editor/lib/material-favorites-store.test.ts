import { expect, test } from 'bun:test'
import useMaterialFavorites, { materialFavoriteKey } from './material-favorites-store'

test('derives stable keys per favorite kind', () => {
  expect(
    materialFavoriteKey({ kind: 'library', id: 'wood-finewood27', label: 'Finewood 27' }),
  ).toBe('library:wood-finewood27')
  expect(materialFavoriteKey({ kind: 'scene', id: 'mat_1' })).toBe('scene:mat_1')
  expect(materialFavoriteKey({ kind: 'rawpainter', product: { id: 42 } })).toBe('rawpainter:42')
})

test('toggleFavorite adds on first call and removes on second', () => {
  const favorite = { kind: 'library', id: 'wood-finewood27', label: 'Finewood 27' } as const

  useMaterialFavorites.getState().toggleFavorite(favorite)
  expect(useMaterialFavorites.getState().favorites['library:wood-finewood27']).toEqual(favorite)

  useMaterialFavorites.getState().toggleFavorite(favorite)
  expect(useMaterialFavorites.getState().favorites['library:wood-finewood27']).toBeUndefined()
})

import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MergedMaterialCatalog } from './paint-catalog'
import { PaintingTab } from './painting-tab'

test('presents one merged material catalog with a favorites tab', () => {
  // Given: the user opens Painting; RawPainter and the library are no longer
  // separate destinations.

  // When: the Painting sidebar is rendered.
  const markup = renderToStaticMarkup(<PaintingTab />)

  // Then: scope controls, the eraser row, and the two catalog tabs are present.
  expect(markup).toContain('적용 범위')
  expect(markup).toContain('이 면')
  expect(markup).toContain('전체 요소')
  expect(markup).toContain('Shift')
  expect(markup).toContain('지우개')
  expect(markup).toContain('즐겨찾기')

  // And: the merged catalog leads with the local sections and the RawPainter
  // section inside one surface — no separate RawPainter/library toggle.
  expect(markup).toContain('내 자재')
  expect(markup).toContain('기본 자재')
  expect(markup).toContain('RawPainter')
  expect(markup).not.toContain('기본 자재 · 내 자재')
})

test('the house view keeps only the scene-used materials section', () => {
  // Given: the tab bar's house toggle renders the catalog scene-only.
  const markup = renderToStaticMarkup(<MergedMaterialCatalog sceneOnly />)

  // Then: 내 자재 stays; search, built-in catalog, and RawPainter are gone.
  expect(markup).toContain('내 자재')
  expect(markup).not.toContain('기본 자재')
  expect(markup).not.toContain('RawPainter')
})

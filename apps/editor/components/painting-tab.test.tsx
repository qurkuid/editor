import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PaintingTab } from './painting-tab'

test('makes the RawPainter catalog the visible Painting entry point', () => {
  // Given: the user opens Painting without knowing where external materials live.

  // When: the Painting sidebar is rendered.
  const markup = renderToStaticMarkup(<PaintingTab />)

  // Then: RawPainter and the built-in material library are explicit choices.
  expect(markup).toContain('RawPainter')
  expect(markup).toContain('기본 자재')
  expect(markup).toContain('적용 범위')
  expect(markup).toContain('이 면')
  expect(markup).toContain('전체 요소')
  expect(markup).toContain('Shift')

  // And: the workflow guide copy is gone — the tab leads with the controls.
  expect(markup).not.toContain('자재 선택')
  expect(markup).not.toContain('벽·바닥·천장 클릭')
})

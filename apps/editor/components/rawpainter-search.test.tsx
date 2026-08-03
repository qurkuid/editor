import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { RawPainterSearch } from './rawpainter-search'

test('shows an explicit catalog search and clear action', () => {
  // Given: an active RawPainter search term.
  const markup = renderToStaticMarkup(
    <RawPainterSearch
      onChange={() => undefined}
      onClear={() => undefined}
      onSubmit={() => undefined}
      value="oak"
    />,
  )

  // When: the compact search control is rendered.

  // Then: users can identify searchable fields and clear the current search.
  expect(markup).toContain('제품명, 브랜드, 판매처 검색')
  expect(markup).toContain('검색 초기화')
  expect(markup).toContain('value="oak"')
})

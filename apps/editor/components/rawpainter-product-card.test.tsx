import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { RawPainterProductCard } from './rawpainter-product-card'

test('shows the purchasing information supplied by RawPainter', () => {
  // Given: a real catalog-style material with commercial metadata.
  const product = {
    id: 70225,
    name: 'CV20_화이트',
    category: '디자인월',
    subCategory: 'Carving Stone',
    thumbnailUrl: 'https://intm.kr/material.webp',
    brand: '인테리어패밀리',
    store: '이디티씨코퍼레이션',
    price: 229900,
    options: [{ size: '1,160*300', price: 229900 }],
  }

  // When: the material card is rendered.
  const markup = renderToStaticMarkup(
    <RawPainterProductCard onSelect={() => undefined} product={product} selected={false} />,
  )

  // Then: category, brand, seller, size, and price are visible without opening another panel.
  expect(markup).toContain('디자인월')
  expect(markup).toContain('인테리어패밀리')
  expect(markup).toContain('이디티씨코퍼레이션')
  expect(markup).toContain('1,160*300')
  expect(markup).toContain('229,900원')
})

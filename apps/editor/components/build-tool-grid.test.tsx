import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BuildToolGrid } from './build-tool-grid'

describe('BuildToolGrid', () => {
  test('keeps tool names visible without relying on hover tooltips', () => {
    // Given: two modeling tools in the build palette.
    const items = [
      { id: 'wall', label: 'Wall', iconSrc: '/icons/wall.webp' },
      { id: 'painting', label: 'Painting', iconSrc: '/icons/paint.webp' },
    ]

    // When: the tool palette is rendered.
    const markup = renderToStaticMarkup(
      <BuildToolGrid activeId="wall" items={items} onSelect={() => {}} />,
    )

    // Then: each icon has a persistent visible name and accessible button label.
    expect(markup).toContain('>Wall<')
    expect(markup).toContain('>Painting<')
    expect(markup).toContain('aria-label="Wall"')
  })
})

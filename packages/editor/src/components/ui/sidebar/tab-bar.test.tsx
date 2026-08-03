import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { IconRail } from './tab-bar'

test('keeps primary sidebar names visible beside their icons', () => {
  // Given: the editor exposes Modeling and Painting as primary destinations.
  const tabs = [
    { id: 'build', label: 'Modeling', icon: <span>M</span> },
    { id: 'painting', label: 'Painting', icon: <span>P</span> },
  ]

  // When: the desktop icon rail is rendered.
  const markup = renderToStaticMarkup(
    <IconRail activeTab="build" collapsed={false} onIconClick={() => {}} tabs={tabs} />,
  )

  // Then: names and accessible labels are visible without hover.
  expect(markup).toContain('aria-label="Modeling"')
  expect(markup).toContain('>Modeling<')
  expect(markup).toContain('>Painting<')
})

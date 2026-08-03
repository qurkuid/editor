import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { PanelWrapper, resetDesktopInspectorCollapsed } from './panel-wrapper'

test('opens a newly selected object inspector so editing controls are discoverable', () => {
  // Given: no previous inspector expansion state remains.
  resetDesktopInspectorCollapsed()

  // When: a new object inspector is rendered.
  const markup = renderToStaticMarkup(
    <PanelWrapper title="Rectangle Face">
      <span>Top corner R</span>
    </PanelWrapper>,
  )

  // Then: its controls are expanded immediately.
  expect(markup).toContain('aria-expanded="true"')
  expect(markup).toContain('Top corner R')
})

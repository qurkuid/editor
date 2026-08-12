import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { NodeActionMenu } from './node-action-menu'

test('renders an accessible Offset only when the 3D caller provides the action', () => {
  const withOffset = renderToStaticMarkup(<NodeActionMenu onOffset={() => {}} />)
  const floorplanMenu = renderToStaticMarkup(
    <NodeActionMenu onMove={() => {}} onRotate={() => {}} onScale={undefined} />,
  )

  expect(withOffset).toContain('aria-label="Offset"')
  expect(withOffset).toContain('title="Offset"')
  expect(floorplanMenu).not.toContain('aria-label="Offset"')
  expect(floorplanMenu).not.toContain('title="Offset"')
})

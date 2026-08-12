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

test('renders the Pascal item replacement action when provided', () => {
  const markup = renderToStaticMarkup(<NodeActionMenu onReplace={() => {}} />)
  expect(markup).toContain('aria-label="Pascal 아이템으로 교체"')
})

test('renders the Body Autofold toggle with its pressed state', () => {
  const off = renderToStaticMarkup(<NodeActionMenu autofold={false} onAutofoldChange={() => {}} />)
  const on = renderToStaticMarkup(<NodeActionMenu autofold onAutofoldChange={() => {}} />)

  expect(off).toContain('aria-label="Autofold"')
  expect(off).toContain('aria-pressed="false"')
  expect(on).toContain('aria-label="Autofold"')
  expect(on).toContain('aria-pressed="true"')
})

test('renders localized solid inspection and Body boolean actions when provided', () => {
  const markup = renderToStaticMarkup(
    <NodeActionMenu
      onInspect={() => {}}
      onIntersect={() => {}}
      onUnion={() => {}}
      onSubtract={() => {}}
      onOuterShell={() => {}}
      onTrim={() => {}}
      onSplit={() => {}}
    />,
  )

  expect(markup).toContain('aria-label="솔리드 검사"')
  expect(markup).toContain('title="교차(Intersection)"')
  expect(markup).toContain('title="합치기(Union)"')
  expect(markup).toContain('title="빼기(Subtract)"')
  expect(markup).toContain('title="외부 셸"')
  expect(markup).toContain('title="트림"')
  expect(markup).toContain('title="분할"')
})

test('renders Body container edit actions when provided', () => {
  const markup = renderToStaticMarkup(
    <NodeActionMenu onEnterComponentEdit={() => {}} onExitComponentEdit={() => {}} />,
  )

  expect(markup).toContain('aria-label="Edit component"')
  expect(markup).toContain('aria-label="Exit component edit"')
})

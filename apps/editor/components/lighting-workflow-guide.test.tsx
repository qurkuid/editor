import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LightingWorkflowGuide, resolveLightingItems } from './lighting-tab'

test('shows the complete circuit to switch workflow and current progress', () => {
  const markup = renderToStaticMarkup(
    <LightingWorkflowGuide circuitCount={1} fixtureCount={1} switchCount={0} />,
  )

  expect(markup).toContain('조명 설치')
  expect(markup).toContain('회로 만들기')
  expect(markup).toContain('조명 배치')
  expect(markup).toContain('스위치 연결')
  expect(markup).toContain('2 / 3 완료')
})

test('keeps a selectable light item when the remote lighting catalog is empty', () => {
  // Given: the remote SketchUp catalog has no lighting items.
  const remoteItems = []

  // When: the lighting placement catalog is resolved.
  const items = resolveLightingItems(remoteItems)

  // Then: the built-in recessed light remains selectable.
  expect(items.some((item) => item.id === 'recessed-light')).toBe(true)
})

test('keeps SketchUp lighting items alongside built-in lights', () => {
  // Given: a lighting item imported from the SketchUp catalog.
  const sketchUpLight = {
    id: 'sketchup-pendant',
    category: '조명',
    name: 'SketchUp Pendant',
    src: '/pendant.glb',
    dimensions: [1, 1, 1],
    offset: [0, 0, 0],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  } as const

  // When: the lighting placement catalog is resolved.
  const items = resolveLightingItems([sketchUpLight])

  // Then: both sources stay selectable.
  expect(items.some((item) => item.id === 'sketchup-pendant')).toBe(true)
  expect(items.some((item) => item.id === 'recessed-light')).toBe(true)
})

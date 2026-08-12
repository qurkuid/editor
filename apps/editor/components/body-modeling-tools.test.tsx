import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BodyModelingTools, selectBodyPrimitive } from './body-modeling-tools'

test('shows the direct-modeling primitives and face editing guidance', () => {
  const html = renderToStaticMarkup(<BodyModelingTools />)

  // Default locale is Korean — see packages/editor/src/i18n.
  expect(html).toContain('선')
  expect(html).toContain('사각형')
  expect(html).toContain('원')
  expect(html).toContain('호')
  expect(html).toContain('다각형')
  expect(html).toContain('1. 도형 선택')
  expect(html).toContain('2. 뷰포트에 그리기')
  expect(html).toContain('3. 면 선택 · Push/Pull')
  expect(html).toContain('Push/Pull')
  expect(html).toContain('aria-label="선 도구 시작"')
  expect(html).toContain('aria-label="원 도구 시작"')
  expect(html).toContain('aria-label="호 도구 시작"')
  expect(html).toContain('aria-label="다각형 도구 시작"')
  expect(html).toContain('aria-label="호 분할 수 (2–256)"')
  expect(html).toContain('min="2"')
  expect(html).toContain('max="256"')
  expect(html).toContain('aria-label="다각형 변 수 (3–256)"')
})

test('selecting a primitive arms Direct modeling from the persistent sidebar tools', () => {
  const calls: string[] = []

  selectBodyPrimitive('circle', {
    activateBodyTool: () => calls.push('activate'),
    setPrimitive: (primitive) => calls.push(primitive),
  })

  expect(calls).toEqual(['circle', 'activate'])
})

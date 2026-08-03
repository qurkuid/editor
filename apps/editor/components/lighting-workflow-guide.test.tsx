import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { LightingWorkflowGuide } from './lighting-tab'

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

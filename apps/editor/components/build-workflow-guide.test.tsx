import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BuildWorkflowGuide } from './build-workflow-guide'

describe('BuildWorkflowGuide', () => {
  test('shows the point direction dimension sequence while modeling', () => {
    // Given: the wall tool is active in modeling mode.
    const mode = 'build'

    // When: the workflow guide is rendered.
    const markup = renderToStaticMarkup(
      <BuildWorkflowGuide activeLabel="Wall" hasPaintMaterial={false} mode={mode} />,
    )

    // Then: the complete wall placement sequence stays visible.
    expect(markup).toContain('모델링')
    expect(markup).toContain('기준점 클릭')
    expect(markup).toContain('방향 지정 · 치수 입력')
    expect(markup).toContain('마지막 클릭')
  })

  test('shows the material surface workflow while painting', () => {
    // Given: material paint mode with no selected paint material.
    const mode = 'material-paint'

    // When: the workflow guide is rendered.
    const markup = renderToStaticMarkup(
      <BuildWorkflowGuide activeLabel={null} hasPaintMaterial={false} mode={mode} />,
    )

    // Then: the user is directed from material selection to surface application.
    expect(markup).toContain('자재 적용')
    expect(markup).toContain('자재 선택')
    expect(markup).toContain('벽·바닥·천장 클릭')
    expect(markup).toContain('크기·심리스 조정')
  })

  test('shows how to turn a placed door into an opening', () => {
    // Given: the Door tool is active in modeling mode.
    const mode = 'build'

    // When: the workflow guide is rendered.
    const markup = renderToStaticMarkup(
      <BuildWorkflowGuide activeLabel="Door" hasPaintMaterial={false} mode={mode} />,
    )

    // Then: the guide exposes the wall-opening workflow without hidden knowledge.
    expect(markup).toContain('벽에 배치')
    expect(markup).toContain('오른쪽 Type → Opening')
    expect(markup).toContain('Rounded에서 R값 조정')
  })
})

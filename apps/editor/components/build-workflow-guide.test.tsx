import { describe, expect, test } from 'bun:test'
import type { MessageId } from '@pascal-app/editor'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  BuildWorkflowGuide,
  type ChainDraftInput,
  resolveChainDraftProgress,
  resolveWorkflowSteps,
} from './build-workflow-guide'

// Identity translator — the pure derivation functions only care about which
// key was picked and in what state, not the translated string.
const t = (key: MessageId) => key

function chainInput(overrides: Partial<ChainDraftInput> = {}): ChainDraftInput {
  return {
    activeTool: null,
    dimensionRaw: '',
    wall: { start: null, end: null },
    fence: { start: null, end: null },
    roof: { start: null, end: null },
    polygon: { type: null, points: [] },
    path: { kind: null, points: [], cursor: null },
    ...overrides,
  }
}

describe('resolveChainDraftProgress', () => {
  test('no active tool yields no progress', () => {
    expect(resolveChainDraftProgress(chainInput())).toBeNull()
  })

  test('a tool with no matching draft store (e.g. a single-click placement) yields no progress', () => {
    expect(resolveChainDraftProgress(chainInput({ activeTool: 'column' }))).toBeNull()
  })

  test('wall: no anchor yet', () => {
    expect(resolveChainDraftProgress(chainInput({ activeTool: 'wall' }))).toEqual({
      anchorPlaced: false,
      directionSet: false,
    })
  })

  test('wall: anchor placed, cursor still at the anchor', () => {
    const progress = resolveChainDraftProgress(
      chainInput({
        activeTool: 'wall',
        wall: { start: [0, 0], end: [0, 0] },
      }),
    )
    expect(progress).toEqual({ anchorPlaced: true, directionSet: false })
  })

  test('wall: cursor moved away from the anchor sets a direction', () => {
    const progress = resolveChainDraftProgress(
      chainInput({
        activeTool: 'wall',
        wall: { start: [0, 0], end: [2, 0] },
      }),
    )
    expect(progress).toEqual({ anchorPlaced: true, directionSet: true })
  })

  test('wall: typing a dimension sets a direction even before the cursor moves', () => {
    const progress = resolveChainDraftProgress(
      chainInput({
        activeTool: 'wall',
        dimensionRaw: '3',
        wall: { start: [0, 0], end: [0, 0] },
      }),
    )
    expect(progress).toEqual({ anchorPlaced: true, directionSet: true })
  })

  test('fence and roof read their own start/end pair', () => {
    expect(
      resolveChainDraftProgress(
        chainInput({ activeTool: 'fence', fence: { start: [1, 1], end: [4, 1] } }),
      ),
    ).toEqual({ anchorPlaced: true, directionSet: true })
    expect(
      resolveChainDraftProgress(
        chainInput({ activeTool: 'roof', roof: { start: [1, 1], end: [1, 1] } }),
      ),
    ).toEqual({ anchorPlaced: true, directionSet: false })
  })

  test('polygon draft (slab/ceiling): a second vertex sets a direction', () => {
    expect(
      resolveChainDraftProgress(
        chainInput({
          activeTool: 'slab',
          polygon: { type: 'slab', points: [[0, 0]] },
        }),
      ),
    ).toEqual({ anchorPlaced: true, directionSet: false })
    expect(
      resolveChainDraftProgress(
        chainInput({
          activeTool: 'slab',
          polygon: {
            type: 'slab',
            points: [
              [0, 0],
              [2, 0],
            ],
          },
        }),
      ),
    ).toEqual({ anchorPlaced: true, directionSet: true })
  })

  test('polygon draft ignores a stale draft type from a different tool', () => {
    // `ceiling` is still recognized as an anchor-then-direction tool — a
    // leftover `slab` draft from before the tool switch just means "no
    // points placed for `ceiling` yet", not "drop the steps entirely".
    expect(
      resolveChainDraftProgress(
        chainInput({
          activeTool: 'ceiling',
          polygon: { type: 'slab', points: [[0, 0]] },
        }),
      ),
    ).toEqual({ anchorPlaced: false, directionSet: false })
  })

  test('path draft (duct/pipe/lineset/liquid-line): cursor away from the first point sets a direction', () => {
    expect(
      resolveChainDraftProgress(
        chainInput({
          activeTool: 'duct-segment',
          path: { kind: 'duct-segment', points: [[0, 0, 0]], cursor: [0, 0, 0] },
        }),
      ),
    ).toEqual({ anchorPlaced: true, directionSet: false })
    expect(
      resolveChainDraftProgress(
        chainInput({
          activeTool: 'pipe-segment',
          path: { kind: 'pipe-segment', points: [[0, 0, 0]], cursor: [1, 0, 0] },
        }),
      ),
    ).toEqual({ anchorPlaced: true, directionSet: true })
  })
})

describe('resolveWorkflowSteps — default (modeling) branch', () => {
  test('no tool selected: only the first step is active', () => {
    const { steps } = resolveWorkflowSteps({
      activeLabel: null,
      hasPaintMaterial: false,
      mode: 'build',
      chainDraft: null,
      doorProgress: null,
      t,
    })
    expect(steps[0]?.state).toBe('active')
    expect(steps[1]?.state).toBe('upcoming')
  })

  test('a single-click placement tool (no chain progress) only shows two steps', () => {
    const { steps } = resolveWorkflowSteps({
      activeLabel: 'Column',
      hasPaintMaterial: false,
      mode: 'build',
      chainDraft: null,
      doorProgress: null,
      t,
    })
    expect(steps).toHaveLength(2)
    expect(steps[0]?.state).toBe('complete')
    expect(steps[1]?.state).toBe('active')
  })

  test('wall tool armed, no anchor yet: second step active, rest upcoming', () => {
    const { steps } = resolveWorkflowSteps({
      activeLabel: 'Wall',
      hasPaintMaterial: false,
      mode: 'build',
      chainDraft: { anchorPlaced: false, directionSet: false },
      doorProgress: null,
      t,
    })
    expect(steps.map((step) => step.state)).toEqual(['complete', 'active', 'upcoming', 'upcoming'])
  })

  test('anchor placed: second step completes, third becomes active', () => {
    const { steps } = resolveWorkflowSteps({
      activeLabel: 'Wall',
      hasPaintMaterial: false,
      mode: 'build',
      chainDraft: { anchorPlaced: true, directionSet: false },
      doorProgress: null,
      t,
    })
    expect(steps.map((step) => step.state)).toEqual(['complete', 'complete', 'active', 'upcoming'])
  })

  test('direction set: third step completes, fourth (terminal) becomes active', () => {
    const { steps } = resolveWorkflowSteps({
      activeLabel: 'Wall',
      hasPaintMaterial: false,
      mode: 'build',
      chainDraft: { anchorPlaced: true, directionSet: true },
      doorProgress: null,
      t,
    })
    expect(steps.map((step) => step.state)).toEqual(['complete', 'complete', 'complete', 'active'])
  })
})

describe('resolveWorkflowSteps — door branch', () => {
  test('placing: matches the original fixed sequence', () => {
    const { steps, isOpeningTool } = resolveWorkflowSteps({
      activeLabel: 'Door',
      hasPaintMaterial: false,
      mode: 'build',
      chainDraft: null,
      doorProgress: null,
      t,
    })
    expect(isOpeningTool).toBe(true)
    expect(steps.map((step) => step.state)).toEqual(['complete', 'active', 'upcoming', 'upcoming'])
  })

  test('placed and selected, still a door (not yet an opening): placement completes, Type step activates', () => {
    const { steps, isOpeningTool } = resolveWorkflowSteps({
      activeLabel: null,
      hasPaintMaterial: false,
      mode: 'build',
      chainDraft: null,
      doorProgress: { openingKind: 'door', openingShape: 'rectangle' },
      t,
    })
    expect(isOpeningTool).toBe(true)
    expect(steps.map((step) => step.state)).toEqual(['complete', 'complete', 'active', 'upcoming'])
  })

  test('switched to Opening: Type step completes, Rounded step activates', () => {
    const { steps } = resolveWorkflowSteps({
      activeLabel: null,
      hasPaintMaterial: false,
      mode: 'build',
      chainDraft: null,
      doorProgress: { openingKind: 'opening', openingShape: 'rectangle' },
      t,
    })
    expect(steps.map((step) => step.state)).toEqual(['complete', 'complete', 'complete', 'active'])
  })

  test('shape switched to Rounded: the last step completes', () => {
    const { steps } = resolveWorkflowSteps({
      activeLabel: null,
      hasPaintMaterial: false,
      mode: 'build',
      chainDraft: null,
      doorProgress: { openingKind: 'opening', openingShape: 'rounded' },
      t,
    })
    expect(steps.map((step) => step.state)).toEqual([
      'complete',
      'complete',
      'complete',
      'complete',
    ])
  })

  test('a door tool click without a resulting selection does not fall into the door branch', () => {
    const { isOpeningTool } = resolveWorkflowSteps({
      activeLabel: null,
      hasPaintMaterial: false,
      mode: 'build',
      chainDraft: null,
      doorProgress: null,
      t,
    })
    expect(isOpeningTool).toBe(false)
  })
})

describe('BuildWorkflowGuide', () => {
  test('shows the point direction dimension sequence while modeling', () => {
    // Given: the wall tool is active in modeling mode.
    const mode = 'build'

    // When: the workflow guide is rendered.
    const markup = renderToStaticMarkup(
      <BuildWorkflowGuide
        activeLabel="Wall"
        activeTool="wall"
        hasPaintMaterial={false}
        mode={mode}
      />,
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
      <BuildWorkflowGuide
        activeLabel={null}
        activeTool={null}
        hasPaintMaterial={false}
        mode={mode}
      />,
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
      <BuildWorkflowGuide
        activeLabel="Door"
        activeTool="door"
        hasPaintMaterial={false}
        mode={mode}
      />,
    )

    // Then: the guide exposes the wall-opening workflow without hidden knowledge.
    expect(markup).toContain('벽에 배치')
    expect(markup).toContain('오른쪽 Type → Opening')
    expect(markup).toContain('Rounded에서 R값 조정')
  })
})

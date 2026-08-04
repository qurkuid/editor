import { expect, test } from 'bun:test'
import type { FurnitureFront } from '@pascal-app/core'
import {
  type FurnitureInteriorDraft,
  FurnitureTierFrontControls,
  FurnitureTierInteriorControls,
  reduceFurnitureFrontDraft,
  reduceFurnitureInteriorDraft,
} from './panel'

test('keeps the tier interior draft bounded and reversible', () => {
  const initial: FurnitureInteriorDraft = { shelfCount: 0, hanger: false }

  expect(reduceFurnitureInteriorDraft(initial, 'decreaseShelfCount')).toEqual(initial)
  expect(reduceFurnitureInteriorDraft(initial, 'increaseShelfCount')).toEqual({
    shelfCount: 1,
    hanger: false,
  })
  expect(reduceFurnitureInteriorDraft(initial, 'toggleHanger')).toEqual({
    shelfCount: 0,
    hanger: true,
  })
  expect(
    reduceFurnitureInteriorDraft({ shelfCount: 8, hanger: true }, 'increaseShelfCount'),
  ).toEqual({ shelfCount: 8, hanger: true })
})

test('renders the draft stepper, hanger toggle, and Apply/Cancel controls', () => {
  const tree = FurnitureTierInteriorControls({
    draft: { shelfCount: 3, hanger: true },
    onApply: () => undefined,
    onCancel: () => undefined,
    onDraftChange: () => undefined,
  })
  const markup = JSON.stringify(tree, (_key, value) =>
    typeof value === 'function' ? undefined : value,
  )

  expect(markup).toContain('선반 수')
  expect(markup).toContain('선반 수 늘리기')
  expect(markup).toContain('선반 수 줄이기')
  expect(markup).toContain('옷걸이 봉')
  expect(markup).toContain('"aria-pressed":true')
  expect(markup).toContain('취소')
  expect(markup).toContain('적용')
  expect(markup).toContain('Enter 적용')
  expect(markup).toContain('Esc 취소')
})

test('reduces the front draft through kind, leaves, glass, count, direction, and style changes', () => {
  const open: FurnitureFront = { kind: 'open', color: '' }

  const hinged = reduceFurnitureFrontDraft(open, { type: 'setKind', kind: 'hinged' })
  expect(hinged).toEqual({
    kind: 'hinged',
    leaves: 2,
    glass: false,
    color: '',
    materialId: undefined,
  })
  expect(reduceFurnitureFrontDraft(hinged, { type: 'setLeaves', leaves: 1 })).toEqual({
    ...hinged,
    leaves: 1,
  })
  expect(reduceFurnitureFrontDraft(hinged, { type: 'setLeaves', leaves: 9 })).toEqual({
    ...hinged,
    leaves: 2,
  })
  expect(reduceFurnitureFrontDraft(hinged, { type: 'setGlass', glass: true }).kind).toBe('hinged')

  const drawer = reduceFurnitureFrontDraft(open, { type: 'setKind', kind: 'drawer' })
  expect(drawer).toEqual({ kind: 'drawer', count: 1, color: '', materialId: undefined })
  expect(reduceFurnitureFrontDraft(drawer, { type: 'setDrawerCount', count: 4 })).toEqual({
    ...drawer,
    count: 4,
  })
  expect(reduceFurnitureFrontDraft(drawer, { type: 'setDrawerCount', count: 99 })).toEqual({
    ...drawer,
    count: 6,
  })

  const flap = reduceFurnitureFrontDraft(open, { type: 'setKind', kind: 'flap' })
  expect(reduceFurnitureFrontDraft(flap, { type: 'setFlapDirection', direction: 'down' })).toEqual({
    ...flap,
    direction: 'down',
  })

  const pullOut = reduceFurnitureFrontDraft(open, { type: 'setKind', kind: 'pull-out' })
  expect(reduceFurnitureFrontDraft(pullOut, { type: 'setPullOutStyle', style: 'spice' })).toEqual({
    ...pullOut,
    style: 'spice',
  })

  // Actions that don't apply to the current kind are a no-op.
  expect(reduceFurnitureFrontDraft(open, { type: 'setDrawerCount', count: 3 })).toBe(open)
})

test('renders the front kind selector and the sub-options for the active kind only', () => {
  const drawerDraft: FurnitureFront = { kind: 'drawer', count: 3, color: '' }
  const tree = FurnitureTierFrontControls({
    draft: drawerDraft,
    onApply: () => undefined,
    onCancel: () => undefined,
    onDraftChange: () => undefined,
  })
  const markup = JSON.stringify(tree, (_key, value) =>
    typeof value === 'function' ? undefined : value,
  )

  expect(markup).toContain('방식')
  expect(markup).toContain('서랍 수')
  expect(markup).toContain('서랍 수 늘리기')
  expect(markup).toContain('서랍 수 줄이기')
  expect(markup).not.toContain('문짝')
  expect(markup).not.toContain('유리')
  expect(markup).not.toContain('방향')
  expect(markup).toContain('취소')
  expect(markup).toContain('적용')
})

import type { Dictionary } from './types'

/** `apps/editor/components/painting-tab.tsx`. */
export const paintingDictionary = {
  'painting.scope.heading': { ko: '적용 범위', en: 'Apply to' },
  'painting.scope.shiftHint': { ko: 'Shift로 전환', en: 'Shift to toggle' },
  'painting.scope.ariaLabel': { ko: '재질 적용 범위', en: 'Material apply scope' },
  'painting.scope.single': { ko: '이 면', en: 'This face' },
  'painting.scope.object': { ko: '전체 요소', en: 'Whole element' },
  'painting.catalog.rawpainter': { ko: 'RawPainter', en: 'RawPainter' },
  'painting.catalog.library': { ko: '기본 자재 · 내 자재', en: 'Built-in · My materials' },
} as const satisfies Dictionary

import type { Dictionary } from './types'

/** `apps/editor/components/body-modeling-tools.tsx`. Templated entries use
 * `{token}` placeholders the caller fills with `.replace()`. */
export const bodyModelingDictionary = {
  'bodyModeling.title': { ko: '직접 모델링', en: 'Direct Modeling' },
  'bodyModeling.desc': { ko: '선을 면으로, 면을 입체로', en: 'Lines to faces, faces to solids' },
  'bodyModeling.badge': { ko: '면 도구', en: 'Face tools' },

  'bodyModeling.primitive.line': { ko: '선', en: 'Line' },
  'bodyModeling.primitive.rectangle': { ko: '사각형', en: 'Rectangle' },
  'bodyModeling.primitive.circle': { ko: '원', en: 'Circle' },
  'bodyModeling.primitive.startAriaLabel': { ko: '{label} 도구 시작', en: 'Start {label} tool' },

  'bodyModeling.steps.selectShape': { ko: '도형 선택', en: 'Select shape' },
  'bodyModeling.steps.drawInViewport': { ko: '뷰포트에 그리기', en: 'Draw in viewport' },
  'bodyModeling.steps.selectFacePushPull': {
    ko: '면 선택 · Push/Pull',
    en: 'Select face · Push/Pull',
  },
} as const satisfies Dictionary

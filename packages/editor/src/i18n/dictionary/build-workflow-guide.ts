import type { Dictionary } from './types'

/** `apps/editor/components/build-workflow-guide.tsx`. `activeLabel` itself
 * (a node registry `presentation.label`, e.g. "Door") is out of scope —
 * only the guide's own fixed copy is translated here. */
export const buildWorkflowGuideDictionary = {
  'buildWorkflowGuide.paint.title': { ko: '자재 적용', en: 'Apply material' },
  'buildWorkflowGuide.paint.desc': {
    ko: '자재를 고른 뒤 원하는 표면을 클릭하세요',
    en: 'Pick a material, then click the surface you want',
  },
  'buildWorkflowGuide.model.title': { ko: '모델링', en: 'Modeling' },
  'buildWorkflowGuide.model.desc': {
    ko: '점을 찍고 방향을 잡은 뒤 숫자로 정확히 만드세요',
    en: 'Place points, set direction, then type exact numbers',
  },

  'buildWorkflowGuide.paintSteps.chooseMaterial': { ko: '자재 선택', en: 'Choose material' },
  'buildWorkflowGuide.paintSteps.clickSurface': {
    ko: '벽·바닥·천장 클릭',
    en: 'Click wall, floor, or ceiling',
  },
  'buildWorkflowGuide.paintSteps.adjustSize': {
    ko: '크기·심리스 조정',
    en: 'Adjust size · seamless',
  },

  'buildWorkflowGuide.doorSteps.selectDoor': { ko: 'Door 선택', en: 'Select Door' },
  'buildWorkflowGuide.doorSteps.placeOnWall': { ko: '벽에 배치', en: 'Place on wall' },
  'buildWorkflowGuide.doorSteps.typeOpening': {
    ko: '오른쪽 Type → Opening',
    en: 'Right panel Type → Opening',
  },
  'buildWorkflowGuide.doorSteps.adjustRounded': {
    ko: 'Rounded에서 R값 조정',
    en: 'Adjust R value in Rounded',
  },

  'buildWorkflowGuide.defaultSteps.selectElement': { ko: '요소 선택', en: 'Select element' },
  'buildWorkflowGuide.defaultSteps.clickAnchor': { ko: '기준점 클릭', en: 'Click anchor point' },
  'buildWorkflowGuide.defaultSteps.setDirection': {
    ko: '방향 지정 · 치수 입력',
    en: 'Set direction · enter dimensions',
  },
  'buildWorkflowGuide.defaultSteps.finalClick': { ko: '마지막 클릭', en: 'Final click' },

  'buildWorkflowGuide.editHint': {
    ko: '기존 형상 편집: V로 선택하면 오른쪽에 R값·개구부 설정이 열립니다.',
    en: 'Edit existing geometry: press V to select — R value and opening settings open on the right.',
  },
} as const satisfies Dictionary

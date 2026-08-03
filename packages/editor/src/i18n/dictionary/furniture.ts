import type { Dictionary } from './types'

/** `apps/editor/components/furniture-tab.tsx`. Templated entries use `{n}`
 * / other `{token}` placeholders the caller fills with `.replace()`. */
export const furnitureDictionary = {
  'furniture.header.title': { ko: '가구 빌더', en: 'Furniture Builder' },
  'furniture.header.desc': {
    ko: '유형과 크기를 정한 뒤 가구를 추가하세요.',
    en: 'Choose a type and size, then add the furniture.',
  },
  'furniture.selectLevelFirst': {
    ko: '가구를 추가하려면 먼저 레벨을 선택하세요.',
    en: 'Select a level before adding furniture.',
  },

  'furniture.kind.wardrobe': { ko: '붙박이장', en: 'Wardrobe' },
  'furniture.kind.baseRun': { ko: '하부장', en: 'Base' },
  'furniture.kind.upperRun': { ko: '상부장', en: 'Upper' },
  'furniture.kind.tall': { ko: '키큰장', en: 'Tall' },
  'furniture.kind.island': { ko: '아일랜드', en: 'Island' },
  'furniture.kind.set': { ko: '상하부 세트', en: 'Upper + Lower Set' },
  'furniture.kind.sink': { ko: '싱크장', en: 'Sink' },
  'furniture.kind.fallback': { ko: '가구', en: 'Furniture' },

  'furniture.dimension.width': { ko: '너비', en: 'Width' },
  'furniture.dimension.height': { ko: '높이', en: 'Height' },
  'furniture.dimension.depth': { ko: '깊이', en: 'Depth' },
  'furniture.bays.label': { ko: '통 수', en: 'Bays' },
  'furniture.bays.count': { ko: '{n}통', en: '{n} bays' },

  'furniture.armed.hint': {
    ko: '장면을 클릭해 배치하세요 · Esc로 취소',
    en: 'Click in the scene to place it · Esc to cancel',
  },

  'furniture.onThisLevel': { ko: '이 레벨의 가구', en: 'Furniture on this level' },
  'furniture.noneYet': { ko: '아직 가구가 없습니다.', en: 'No furniture assemblies yet.' },
} as const satisfies Dictionary

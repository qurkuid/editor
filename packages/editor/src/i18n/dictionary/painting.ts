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
  'painting.catalog.materials': { ko: '자재', en: 'Materials' },
  'painting.catalog.favorites': { ko: '즐겨찾기', en: 'Favorites' },
  'painting.erase': { ko: '지우개', en: 'Erase' },
  'painting.resetAll': { ko: '원래대로', en: 'Reset all' },
  'painting.section.myMaterials': { ko: '내 자재', en: 'My materials' },
  'painting.section.builtin': { ko: '기본 자재', en: 'Built-in materials' },
  'painting.addMaterial': { ko: '자재 추가', en: 'Add material' },
  'painting.importFile': { ko: '이미지 파일에서 자재 추가', en: 'Add material from image file' },
  'painting.importClipboard': {
    ko: '클립보드 이미지로 자재 추가',
    en: 'Add material from clipboard image',
  },
  'painting.importFailed': { ko: '이미지를 불러오지 못했습니다.', en: "Couldn't read the image." },
  'painting.clipboardNoImage': {
    ko: '클립보드에 이미지가 없습니다.',
    en: 'No image found in the clipboard.',
  },
  'painting.noSceneMaterials': {
    ko: '아직 만든 자재가 없습니다 — +로 추가하세요.',
    en: 'No custom materials yet — add one with +.',
  },
  'painting.favorites.add': { ko: '즐겨찾기에 추가', en: 'Add to favorites' },
  'painting.favorites.remove': { ko: '즐겨찾기에서 제거', en: 'Remove from favorites' },
  'painting.favorites.empty': {
    ko: '자재의 별표를 눌러 즐겨찾기에 추가하세요.',
    en: 'Tap the star on a material to add it here.',
  },
  'painting.ai.request': {
    ko: 'AI로 이 자재 적용 — 모델링 에이전트로 이동',
    en: 'Apply with AI — opens the modeling agent',
  },
} as const satisfies Dictionary

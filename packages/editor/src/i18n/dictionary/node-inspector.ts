import type { Dictionary } from './types'

/** Inline inspector editors and placement hints owned by `@pascal-app/nodes`
 * (cabinet compartments, duct fittings, opening documentation, …). */
export const nodeInspectorDictionary = {
  'nodeInspector.topCornerRadius': { ko: '상단 모서리 R', en: 'Top corner R' },
  'nodeInspector.openingX': { ko: '개구부 X', en: 'Opening X' },
  'nodeInspector.openingY': { ko: '개구부 Y', en: 'Opening Y' },

  'nodeInspector.shelves': { ko: '선반', en: 'Shelves' },
  'nodeInspector.drawers': { ko: '서랍', en: 'Drawers' },
  'nodeInspector.shelvesInside': { ko: '내부 선반', en: 'Shelves inside' },
  'nodeInspector.burnersOn': { ko: '화구', en: 'Burners on' },
  'nodeInspector.topGrate': { ko: '상판 그레이트', en: 'Top grate' },
  'nodeInspector.baskets': { ko: '바구니', en: 'Baskets' },

  'nodeInspector.swapWidthHeightLabel': { ko: '가로/세로 교체', en: 'Swap W/H' },
  'nodeInspector.swapWidthHeightTitle': {
    ko: '가로와 세로를 서로 바꿉니다',
    en: 'Swap width and height',
  },

  'nodeInspector.snappedToDuct': { ko: '덕트에 스냅됨', en: 'Snapped to duct' },
  'nodeInspector.surfaceSnapHint': { ko: 'M 면 스냅', en: 'M surface' },

  'nodeInspector.autoAssigned': { ko: '자동 지정', en: 'Auto-assigned' },
  'nodeInspector.verify': { ko: '확인 필요', en: 'Verify' },
  'nodeInspector.constructionFramed': { ko: '경량벽', en: 'Framed' },
  'nodeInspector.constructionMasonry': { ko: '조적', en: 'Masonry' },
  'nodeInspector.openingNominal': { ko: '공칭', en: 'Nominal' },
  'nodeInspector.openingRough': { ko: '골조 개구부', en: 'Rough opening' },
  'nodeInspector.openingMasonry': { ko: '조적 개구부', en: 'Masonry opening' },
  'nodeInspector.openingFinish': { ko: '마감 개구부', en: 'Finish opening' },
  'nodeInspector.roWidth': { ko: 'RO 가로', en: 'RO Width' },
  'nodeInspector.roHeight': { ko: 'RO 세로', en: 'RO Height' },
  'nodeInspector.moWidth': { ko: 'MO 가로', en: 'MO Width' },
  'nodeInspector.moHeight': { ko: 'MO 세로', en: 'MO Height' },
  'nodeInspector.foWidth': { ko: 'FO 가로', en: 'FO Width' },
  'nodeInspector.foHeight': { ko: 'FO 세로', en: 'FO Height' },
} as const satisfies Dictionary

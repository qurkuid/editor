import type { Dictionary } from './types'

/** Labels that appear on more than one surface (action menus, toolbars,
 * dialogs). Anything used by a single surface belongs in that surface's
 * dictionary instead. */
export const commonDictionary = {
  'common.close': { ko: '닫기', en: 'Close' },
  'common.dismiss': { ko: '닫기', en: 'Dismiss' },
  'common.delete': { ko: '삭제', en: 'Delete' },
  'common.duplicate': { ko: '복제', en: 'Duplicate' },
  'common.edit': { ko: '편집', en: 'Edit' },
  'common.move': { ko: '이동', en: 'Move' },
  'common.back': { ko: '뒤로', en: 'Back' },
  'common.opacity': { ko: '불투명도', en: 'Opacity' },
  'common.height': { ko: '높이', en: 'Height' },
  'common.length': { ko: '길이', en: 'Length' },
  'common.curve': { ko: '곡선', en: 'Curve' },
  'common.position': { ko: '위치', en: 'Position' },
  'common.scans': { ko: '스캔', en: 'Scans' },
  'common.guides': { ko: '가이드', en: 'Guides' },
  'common.guideImages': { ko: '가이드 이미지', en: 'Guide images' },
  'common.displaySettings': { ko: '표시 설정', en: 'Display settings' },
  'common.shadows': { ko: '그림자', en: 'Shadows' },
  'common.camera': { ko: '카메라', en: 'Camera' },
  'common.colors': { ko: '색상', en: 'Colors' },
  'common.render': { ko: '렌더', en: 'Render' },
  'common.theme': { ko: '테마', en: 'Theme' },
  'common.edges': { ko: '외곽선', en: 'Edges' },
  'common.orbitLeft': { ko: '왼쪽으로 회전', en: 'Orbit left' },
  'common.orbitRight': { ko: '오른쪽으로 회전', en: 'Orbit right' },
  'common.topView': { ko: '평면 뷰', en: 'Top view' },
  'common.extrusionHeight': { ko: '돌출 높이', en: 'Extrusion height' },
  'common.rotateHint': { ko: 'R/T 회전', en: 'R/T rotate' },
} as const satisfies Dictionary

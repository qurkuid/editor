import type { Dictionary } from './types'

/** Scene-material list and the material property / physical-size editors in
 * `components/ui/controls/`. */
export const materialsDictionary = {
  'materials.roughness': { ko: '거칠기', en: 'Roughness' },
  'materials.metalness': { ko: '금속성', en: 'Metalness' },
  'materials.sideFront': { ko: '앞면', en: 'Front' },
  'materials.sideBack': { ko: '뒷면', en: 'Back' },
  'materials.sideDouble': { ko: '양면', en: 'Double' },
  'materials.widthMillimetres': { ko: '자재 가로 (mm)', en: 'Material width in millimetres' },
  'materials.heightMillimetres': { ko: '자재 세로 (mm)', en: 'Material height in millimetres' },
  'materials.paintWith': { ko: '이 자재로 칠하기', en: 'Paint with' },
  'materials.surfaceType': { ko: '표면 재질', en: 'Surface type' },
  'materials.preset.white': { ko: '화이트', en: 'White' },
  'materials.preset.plaster': { ko: '석고 · 회벽', en: 'Plaster' },
  'materials.preset.concrete': { ko: '콘크리트', en: 'Concrete' },
  'materials.preset.brick': { ko: '벽돌', en: 'Brick' },
  'materials.preset.wood': { ko: '목재', en: 'Wood' },
  'materials.preset.tile': { ko: '타일', en: 'Tile' },
  'materials.preset.marble': { ko: '대리석', en: 'Marble' },
  'materials.preset.metal': { ko: '금속', en: 'Metal' },
  'materials.preset.glass': { ko: '유리', en: 'Glass' },
  'materials.preset.custom': { ko: '사용자 정의', en: 'Custom' },
  'materials.finish': { ko: '마감', en: 'Finish' },
  'materials.finishGloss': { ko: '유광', en: 'Gloss' },
  'materials.finishSemi': { ko: '반광', en: 'Semi-gloss' },
  'materials.finishMatte': { ko: '무광', en: 'Matte' },
  'materials.bumpHeading': { ko: '표면 입체감 (범프맵)', en: 'Surface relief (bump map)' },
  'materials.bumpGenerate': { ko: '텍스처에서 범프맵 생성', en: 'Generate bump from texture' },
  'materials.bumpScale': { ko: '범프 강도', en: 'Bump strength' },
  'materials.bumpRemove': { ko: '범프맵 제거', en: 'Remove bump map' },
  'materials.bumpFailed': {
    ko: '범프맵을 생성하지 못했습니다.',
    en: "Couldn't generate the bump map.",
  },
} as const satisfies Dictionary

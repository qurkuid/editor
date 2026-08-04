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
} as const satisfies Dictionary

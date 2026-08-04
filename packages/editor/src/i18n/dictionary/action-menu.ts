import type { Dictionary } from './types'

/** Selection action menus and the viewport action rail —
 * `components/editor/node-action-menu.tsx`, `components/editor/floating-action-menu.tsx`,
 * and `components/ui/action-menu/*`. */
export const actionMenuDictionary = {
  'actionMenu.wallDisplayMode': { ko: '벽 표시 방식', en: 'Wall display mode' },
  'actionMenu.wallDisplayFinish': { ko: '마감', en: 'Finish' },
  'actionMenu.wallDisplayFrame': { ko: '골조', en: 'Frame' },
  'actionMenu.wallDisplayLayers': { ko: '레이어', en: 'Layers' },
  'actionMenu.findInCatalog': { ko: '카탈로그에서 찾기', en: 'Find in catalog' },
  'actionMenu.cutOut': { ko: '개구부 내기', en: 'Cut Out' },
  'actionMenu.measurementOptions': { ko: '측정 옵션', en: 'Measurement options' },
  'actionMenu.measurementType': { ko: '측정 방식', en: 'Measurement type' },
  'actionMenu.uploadReferenceImage': {
    ko: '스캔·가이드 이미지 올리기',
    en: 'Upload scan or guide image',
  },
  'actionMenu.guideImageSettings': { ko: '가이드 이미지 설정', en: 'Guide image settings' },
  'actionMenu.deleteGuideImage': { ko: '가이드 이미지 삭제', en: 'Delete guide image' },
  'actionMenu.scanSettings': { ko: '스캔 설정', en: 'Scan settings' },
  'actionMenu.deleteScan': { ko: '스캔 삭제', en: 'Delete scan' },
  'actionMenu.referenceSettings': { ko: '참조 설정', en: 'Reference settings' },
  'actionMenu.referenceFloorSettings': { ko: '기준 바닥 설정', en: 'Reference floor settings' },
  'actionMenu.referenceFloor': { ko: '기준 바닥', en: 'Reference floor' },
  'actionMenu.riserDiagram': { ko: '입상 계통도', en: 'Riser diagram' },

  'actionMenu.references': { ko: '참조', en: 'References' },
  'actionMenu.referencesEmpty': {
    ko: 'GLB 메시는 스캔 참조로, 도면 이미지는 가이드 참조로 올리세요.',
    en: 'Upload GLB meshes as scan references or blueprint images as guide references.',
  },
  'actionMenu.visible': { ko: '표시됨', en: 'Visible' },
  'actionMenu.hidden': { ko: '숨김', en: 'Hidden' },
  'actionMenu.show': { ko: '표시', en: 'Show' },
  'actionMenu.hide': { ko: '숨기기', en: 'Hide' },
  'actionMenu.itemsOnThisLevel': { ko: '개 · 이 층', en: 'on this level' },

  'actionMenu.measureSmart': { ko: '자동 인식', en: 'Smart' },
  'actionMenu.measureDistance': { ko: '거리', en: 'Distance' },
  'actionMenu.measureAngle': { ko: '각도', en: 'Angle' },
  'actionMenu.measureArea': { ko: '면적', en: 'Area' },
  'actionMenu.measurePerimeter': { ko: '둘레', en: 'Perimeter' },
  'actionMenu.measureVolume': { ko: '부피', en: 'Volume' },

  'actionMenu.dimLinear': { ko: '선형 치수', en: 'Linear dimension' },
  'actionMenu.dimContinuous': { ko: '연속 치수', en: 'Continuous dimension' },
  'actionMenu.dimRadius': { ko: '반지름 치수', en: 'Radius dimension' },
  'actionMenu.dimDiameter': { ko: '지름 치수', en: 'Diameter dimension' },
  'actionMenu.dimCenterMark': { ko: '중심 표시', en: 'Center mark' },
  'actionMenu.dimChord': { ko: '현 치수', en: 'Chord dimension' },
  'actionMenu.dimArcLength': { ko: '호 길이', en: 'Arc length' },
  'actionMenu.dimAngular': { ko: '각도 치수', en: 'Angular dimension' },
  'actionMenu.dimCoordinate': { ko: '좌표 치수', en: 'Coordinate dimensions' },
  'actionMenu.measureWord': { ko: '측정', en: 'Measure' },
} as const satisfies Dictionary

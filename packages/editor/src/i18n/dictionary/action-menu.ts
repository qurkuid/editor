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
  'actionMenu.replaceWithCatalogItem': {
    ko: 'Pascal 아이템으로 교체',
    en: 'Replace with Pascal item',
  },
  'actionMenu.replaceWithWall': { ko: 'Pascal 벽으로 교체', en: 'Replace with Pascal wall' },
  'actionMenu.replaceWithLight': { ko: 'Pascal 조명으로 교체', en: 'Replace with Pascal light' },
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

  'actionMenu.guideLine': { ko: '가이드선', en: 'Guide line' },
  'actionMenu.verticalGuide': { ko: '수직 가이드', en: 'Vertical guide' },
  'actionMenu.horizontalGuide': { ko: '수평 가이드', en: 'Horizontal guide' },
  'actionMenu.guideStretchDistance': { ko: '늘이기 거리', en: 'Stretch distance' },
  'actionMenu.guideStretchLeft': { ko: '왼쪽으로 늘리기', en: 'Stretch left' },
  'actionMenu.guideStretchRight': { ko: '오른쪽으로 늘리기', en: 'Stretch right' },
  'actionMenu.guideStretchUp': { ko: '위로 늘리기', en: 'Stretch up' },
  'actionMenu.guideStretchDown': { ko: '아래로 늘리기', en: 'Stretch down' },
  'actionMenu.guideStretchInvalid': {
    ko: '유효한 거리를 입력하세요.',
    en: 'Enter a valid distance.',
  },
  'actionMenu.guideStretchUnsupported': {
    ko: '사선 또는 곡선 벽이 가이드에 걸쳐 있어 늘릴 수 없습니다.',
    en: 'A diagonal or curved wall crosses the guide and cannot be stretched.',
  },
  'actionMenu.guideStretchConflict': {
    ko: '거리가 커서 벽·문·창·영역이 겹치거나 경계를 벗어납니다.',
    en: 'That distance would overlap or move a wall, opening, or zone out of bounds.',
  },
  'actionMenu.guideStretchFailed': {
    ko: '가이드 늘이기에 실패했습니다.',
    en: 'Guide stretch failed.',
  },
  'actionMenu.dimensionEditTitle': { ko: '치수 편집', en: 'Edit dimension' },
  'actionMenu.dimensionEditCurrent': { ko: '현재 치수', en: 'Current dimension' },
  'actionMenu.dimensionEditTarget': { ko: '목표 치수', en: 'Target dimension' },
  'actionMenu.dimensionEditFixedEnd': { ko: '고정할 끝', en: 'Fixed end' },
  'actionMenu.dimensionEditStart': { ko: '시작점 고정', en: 'Fix start' },
  'actionMenu.dimensionEditEnd': { ko: '끝점 고정', en: 'Fix end' },
  'actionMenu.dimensionEditLeaf': { ko: '변경 구간', en: 'Segment to change' },
  'actionMenu.dimensionEditApply': { ko: '적용', en: 'Apply' },
  'actionMenu.dimensionEditCancel': { ko: '취소', en: 'Cancel' },
  'actionMenu.dimensionEditInvalid': {
    ko: '0보다 큰 유효한 치수를 입력하세요.',
    en: 'Enter a valid dimension greater than zero.',
  },
  'actionMenu.dimensionEditReadOnly': {
    ko: '이 치수는 편집할 수 없습니다.',
    en: 'This dimension is read-only.',
  },
  'actionMenu.dimensionEditReadOnlyAmbiguous': {
    ko: '여러 경계가 가능해 이동할 벽을 하나로 정할 수 없습니다.',
    en: 'Multiple boundaries are possible, so no single wall move can be chosen.',
  },
  'actionMenu.dimensionEditReadOnlyThickness': {
    ko: '벽과 벽 사이의 두께 치수는 직접 수정할 수 없습니다.',
    en: 'Wall-to-wall thickness dimensions cannot be edited directly.',
  },
  'actionMenu.dimensionEditReadOnlyCurved': {
    ko: '곡선 벽 치수는 직접 수정할 수 없습니다.',
    en: 'Curved-wall dimensions cannot be edited directly.',
  },
  'actionMenu.dimensionEditReadOnlyDatum': {
    ko: '구조 기준선에는 고유한 벽 이동 경로가 없습니다.',
    en: 'Structural datums have no unique wall move path.',
  },
  'actionMenu.dimensionEditReadOnlyMissing': {
    ko: '이 치수의 편집 근거를 찾을 수 없습니다.',
    en: 'The edit provenance for this dimension is unavailable.',
  },
  'actionMenu.dimensionEditReadOnlyUnsupported': {
    ko: '이 치수에는 지원되는 고유한 이동 경로가 없습니다.',
    en: 'This dimension has no supported unique move path.',
  },
  'actionMenu.dimensionEditPreservation': {
    ko: '같은 치수열의 다른 구간은 유지됩니다. 같은 벽을 공유하는 다른 치수열은 함께 변할 수 있습니다.',
    en: 'Other intervals in this dimension chain stay unchanged. Other chains sharing a wall may change too.',
  },
  'actionMenu.dimensionEditFailed': {
    ko: '치수 편집을 적용할 수 없습니다.',
    en: 'The dimension edit could not be applied.',
  },
  'actionMenu.dimensionEditConflict': {
    ko: '벽·개구부·영역이 겹치거나 유효한 경계를 벗어납니다.',
    en: 'Walls, openings, or zones would overlap or leave a valid boundary.',
  },
  'actionMenu.dimensionEditTopology': {
    ko: '벽 접점이나 형상이 유지되지 않아 적용할 수 없습니다.',
    en: 'The edit would break wall contacts or geometry.',
  },
  'actionMenu.dimensionEditTotalMismatch': {
    ko: '선택한 구간만 변경하는 조건으로 목표 총치수를 만들 수 없습니다.',
    en: 'The target total cannot be reached while changing only the selected segment.',
  },
  'actionMenu.dimensionEditOpening': {
    ko: '개구부의 문서 치수 근거를 확인할 수 없습니다.',
    en: 'The opening documentation provenance could not be verified.',
  },
  'actionMenu.eyedropper': { ko: '스포이드', en: 'Eyedropper' },

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

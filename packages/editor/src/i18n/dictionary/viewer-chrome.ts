import type { Dictionary } from './types'

/** Persistent editor chrome around the canvas — viewer toolbars, the scene
 * header, the level selector, the command palette, the walkthrough HUD, and
 * the shared dialog / sidebar primitives. */
export const viewerChromeDictionary = {
  'chrome.visibility': { ko: '표시', en: 'Visibility' },
  'chrome.display': { ko: '표시', en: 'Display' },
  'chrome.grid': { ko: '그리드', en: 'Grid' },
  'chrome.floorplanMode': { ko: '평면도 모드', en: 'Floor plan mode' },
  'chrome.floorplanAnnotations': { ko: '평면도 주석', en: 'Floor plan annotations' },
  'chrome.wallDimensions': { ko: '벽 치수', en: 'Wall dimensions' },
  'chrome.magneticSnap': { ko: '자석 스냅', en: 'Magnetic snap' },
  'chrome.units': { ko: '단위', en: 'Units' },
  'chrome.unitMeters': { ko: '미터', en: 'Meters' },
  'chrome.unitMillimeters': { ko: '밀리미터', en: 'Millimeters' },
  'chrome.unitFeetInches': { ko: '피트·인치', en: 'Feet & inches' },
  'chrome.walkthrough': { ko: '워크스루', en: 'Walkthrough' },
  'chrome.previewMode': { ko: '미리보기 모드', en: 'Preview mode' },
  'chrome.preview': { ko: '미리보기', en: 'Preview' },

  'chrome.levelDragToReorder': { ko: '끌어서 순서 변경', en: 'Drag to reorder' },
  'chrome.levelHeight': { ko: '층고', en: 'Level height' },
  'chrome.addLevelAbove': { ko: '위에 층 추가', en: 'Add level above' },
  'chrome.addLevelBelow': { ko: '아래에 층 추가', en: 'Add level below' },
  'chrome.insertLevelHere': { ko: '여기에 층 삽입', en: 'Insert level here' },
  'chrome.deleteLevel': { ko: '층 삭제', en: 'Delete level' },
  'chrome.duplicateLevel': { ko: '층 복제', en: 'Duplicate Level' },

  'chrome.commandPalette': { ko: '명령 팔레트', en: 'Command Palette' },
  'chrome.typeNewNameAbove': { ko: '위에 새 이름을 입력하세요…', en: 'Type a new name above…' },

  'chrome.sidebar': { ko: '사이드바', en: 'Sidebar' },
  'chrome.sidebarMobileDescription': {
    ko: '모바일 사이드바를 표시합니다.',
    en: 'Displays the mobile sidebar.',
  },
  'chrome.toggleSidebar': { ko: '사이드바 접기/펼치기', en: 'Toggle Sidebar' },
  'chrome.expandSidebar': { ko: '사이드바 펼치기', en: 'Expand sidebar' },

  'chrome.sceneRenderFailed': {
    ko: '에디터 장면을 그리지 못했습니다',
    en: 'The editor scene failed to render',
  },
  'chrome.somethingWentWrong': { ko: '문제가 발생했습니다', en: 'Something went wrong' },
  'chrome.cameraControlsHint': { ko: '카메라 조작 안내', en: 'Camera controls hint' },
  'chrome.dismissCameraControlsHint': {
    ko: '카메라 조작 안내 닫기',
    en: 'Dismiss camera controls hint',
  },
  'chrome.closeCaptureMode': { ko: '캡처 모드 닫기', en: 'Close capture mode' },
  'chrome.validLength': { ko: '유효한 길이', en: 'Valid length' },
  'chrome.invalidLength': { ko: '잘못된 길이', en: 'Invalid length' },

  'chrome.walkthroughExit': { ko: '나가기', en: 'to exit' },
  'chrome.walkthroughClick': { ko: '클릭', en: 'Click' },
  'chrome.walkthroughOr': { ko: '또는', en: 'or' },
  'chrome.walkthroughResume': { ko: '눌러 계속', en: 'to resume' },
  'chrome.walkthroughFreeCursor': { ko: '커서 해제', en: 'free cursor' },
  'chrome.walkthroughOrClickTo': { ko: '또는 클릭하여', en: 'or click to' },
} as const satisfies Dictionary

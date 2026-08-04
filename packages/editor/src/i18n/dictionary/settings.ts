import type { Dictionary } from './types'

/** `packages/editor/src/components/ui/sidebar/panels/settings-panel/index.tsx`
 * — every section label in the built-in Settings panel (Units, Visibility,
 * Export, Thumbnail, Save & Load, Audio, Keyboard, Scene Graph, Danger
 * Zone). The `AudioSettingsDialog` / `KeyboardShortcutsDialog` bodies are
 * separate components and out of scope here — only their section labels. */
export const settingsDictionary = {
  'settings.units.label': { ko: '단위', en: 'Units' },
  'settings.units.system': { ko: '단위계', en: 'System' },
  'settings.units.metric': { ko: '미터법', en: 'Metric' },
  'settings.units.imperial': { ko: '피트·인치', en: 'Imperial' },
  'settings.units.metricNotation': { ko: '미터법 표기', en: 'Metric notation' },
  'settings.units.meters': { ko: '미터', en: 'Meters' },
  'settings.units.millimeters': { ko: '밀리미터', en: 'Millimeters' },

  'settings.visibility.label': { ko: '공개 설정', en: 'Visibility' },
  'settings.visibility.public': { ko: '공개', en: 'Public' },
  'settings.visibility.viewOnlyYou': { ko: '나만 볼 수 있음', en: 'Only you can view' },
  'settings.visibility.viewAnyone': { ko: '누구나 볼 수 있음', en: 'Anyone can view' },
  'settings.visibility.showScans': { ko: '3D 스캔 표시', en: 'Show 3D Scans' },
  'settings.visibility.showFloorplans': { ko: '평면도 표시', en: 'Show Floorplans' },
  'settings.visibility.visibleToPublic': {
    ko: '공개 사용자에게 표시됩니다',
    en: 'Visible to public viewers',
  },
  'settings.visibility.shadows': { ko: '그림자', en: 'Shadows' },
  'settings.visibility.shadowsDesc': {
    ko: '조명이 그림자를 생성합니다',
    en: 'Cast shadows from lights',
  },

  'settings.export.label': { ko: '내보내기', en: 'Export' },
  'settings.export.model3d': { ko: '3D 모델', en: '3D model' },
  'settings.export.glb': { ko: 'GLB 내보내기', en: 'Export GLB' },
  'settings.export.stl': { ko: 'STL 내보내기', en: 'Export STL' },
  'settings.export.obj': { ko: 'OBJ 내보내기', en: 'Export OBJ' },
  'settings.export.floorplan': { ko: '평면도', en: 'Floor plan' },
  'settings.export.defaultMode': { ko: '기본 모드', en: 'Default mode' },
  'settings.export.expertMode': { ko: '전문가 모드', en: 'Expert mode' },
  'settings.export.fullFloorplan': { ko: '전체 평면도', en: 'Full floor plan' },
  'settings.export.structureOnly': { ko: '구조만', en: 'Structure only' },

  'settings.thumbnail.label': { ko: '썸네일', en: 'Thumbnail' },
  'settings.thumbnail.generate': { ko: '썸네일 생성', en: 'Generate Thumbnail' },
  'settings.thumbnail.generating': { ko: '생성 중...', en: 'Generating...' },

  'settings.saveLoad.label': { ko: '저장 및 불러오기', en: 'Save & Load' },
  'settings.saveLoad.save': { ko: '빌드 저장', en: 'Save Build' },
  'settings.saveLoad.load': { ko: '빌드 불러오기', en: 'Load Build' },

  'settings.audio.label': { ko: '오디오', en: 'Audio' },
  'settings.keyboard.label': { ko: '키보드', en: 'Keyboard' },
  'settings.keyboard.rotateShortcutTaken': {
    ko: '이미 사용 중인 키입니다',
    en: 'That key is already in use',
  },
  'settings.keyboard.rebindHint': {
    ko: '키를 클릭한 뒤 새 키를 누르면 변경됩니다',
    en: 'Click a key chip, then press a new key to rebind it',
  },
  'settings.keyboard.pressKey': { ko: '키 입력…', en: 'Press a key…' },
  'settings.keyboard.resetShortcuts': { ko: '기본값 복원', en: 'Reset to defaults' },

  'settings.sceneGraph.label': { ko: '장면 그래프', en: 'Scene Graph' },
  'settings.sceneGraph.explore': { ko: '장면 그래프 탐색', en: 'Explore scene graph' },

  'settings.dangerZone.label': { ko: '위험 구역', en: 'Danger Zone' },
  'settings.dangerZone.clearAndStartNew': {
    ko: '초기화 후 새로 시작',
    en: 'Clear & Start New',
  },
} as const satisfies Dictionary

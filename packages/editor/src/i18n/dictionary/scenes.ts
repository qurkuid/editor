import type { Dictionary } from './types'

/** Standalone app surfaces outside the canvas — the saved-scene pages, the
 * scene loader's conflict notice, and the build tab's tool groups. */
export const scenesDictionary = {
  'scenes.title': { ko: '장면', en: 'Scenes' },
  'scenes.yourScenes': { ko: '내 장면', en: 'Your scenes' },
  'scenes.empty': { ko: '아직 저장한 장면이 없습니다.', en: "You haven't saved any scenes yet." },
  'scenes.noThumbnail': { ko: '썸네일 없음', en: 'No thumbnail' },
  'scenes.notFound': { ko: '장면을 찾을 수 없습니다', en: 'Scene not found' },
  'scenes.saveConflict': {
    ko: '다른 세션이 먼저 저장했습니다 — 새로고침할까요?',
    en: 'Another session saved first — refresh?',
  },

  'build.roofFeatures': { ko: '지붕 부속', en: 'Features' },
  'build.mep': { ko: '설비 (MEP)', en: 'MEP' },
  'build.duct': { ko: '덕트', en: 'Duct' },
  'build.dwvPipe': { ko: '오배수 배관', en: 'DWV Pipe' },
  'build.liquidLine': { ko: '냉매 액관', en: 'Liquid Line' },
  'build.followLineset': { ko: '라인셋 따라가기', en: 'Follow lineset' },
  'scenes.home': { ko: '홈', en: 'Home' },
  'scenes.noScenesYet': {
    ko: '아직 장면이 없습니다. 하나 만들어 시작하세요.',
    en: 'No scenes yet. Create one to get started.',
  },
  'scenes.notFoundDetail': {
    ko: '해당 ID 의 장면을 찾을 수 없습니다:',
    en: "We couldn't find a scene with id",
  },

  'scenes.versions': { ko: '버전', en: 'Versions' },
  'scenes.versionHistory': { ko: '버전 기록', en: 'Version history' },
  'scenes.versionCurrent': { ko: '현재', en: 'Current' },
  'scenes.versionNodes': { ko: '노드', en: 'nodes' },
  'scenes.versionRestore': { ko: '이 버전으로 복원', en: 'Restore this version' },
  'scenes.versionRestoring': { ko: '복원 중…', en: 'Restoring…' },
  'scenes.versionRestored': {
    ko: '복원 완료 — 새 버전으로 저장되었습니다.',
    en: 'Restored — saved as a new version.',
  },
  'scenes.versionRestoreFailed': { ko: '복원 실패', en: 'Restore failed' },
  'scenes.versionEmpty': { ko: '저장된 버전이 없습니다.', en: 'No versions recorded.' },
  'scenes.versionLoadFailed': { ko: '버전 목록을 불러오지 못했습니다.', en: 'Failed to load versions.' },
  'scenes.close': { ko: '닫기', en: 'Close' },
} as const satisfies Dictionary

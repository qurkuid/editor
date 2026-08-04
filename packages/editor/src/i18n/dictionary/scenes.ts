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
} as const satisfies Dictionary

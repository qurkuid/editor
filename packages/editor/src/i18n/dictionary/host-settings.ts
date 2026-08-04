import type { Dictionary } from './types'

/** `apps/editor/components/host-settings-section.tsx` — the language
 * switcher plus AI / materials connection status rows shown above the
 * built-in settings panel sections. */
export const hostSettingsDictionary = {
  'hostSettings.language': { ko: '언어', en: 'Language' },
  'hostSettings.korean': { ko: '한국어', en: '한국어' },
  'hostSettings.english': { ko: 'English', en: 'English' },
  'hostSettings.ai': { ko: 'AI', en: 'AI' },
  'hostSettings.aiProviderLabel': { ko: 'AI 제공자', en: 'AI provider' },
  'hostSettings.aiProviderCodex': { ko: 'Codex', en: 'Codex' },
  'hostSettings.aiProviderClaude': { ko: 'Claude', en: 'Claude' },
  'hostSettings.aiModelLabel': { ko: 'AI 모델', en: 'AI model' },
  'hostSettings.aiEffortLabel': { ko: '추론 강도', en: 'Reasoning effort' },
  'hostSettings.defaultOption': { ko: '기본', en: 'Default' },
  'hostSettings.materials': { ko: '자재', en: 'Materials' },
  'hostSettings.materialsSource': { ko: 'RawPainter', en: 'RawPainter' },
  'hostSettings.connected': { ko: '연결됨', en: 'Connected' },
  'hostSettings.notConnected': { ko: '연결 안 됨', en: 'Not connected' },
  'hostSettings.unavailable': { ko: '사용 불가', en: 'Unavailable' },
  'hostSettings.checking': { ko: '확인 중', en: 'Checking' },
} as const satisfies Dictionary

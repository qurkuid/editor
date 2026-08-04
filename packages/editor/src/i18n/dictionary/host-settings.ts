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
  'hostSettings.cliLogin': { ko: 'CLI 로그인', en: 'Sign in CLI' },
  'hostSettings.cliLoginOpen': {
    ko: '1. 브라우저에서 로그인 링크 열기',
    en: '1. Open the sign-in link in your browser',
  },
  'hostSettings.cliLoginCode': { ko: '2. 이 코드를 입력:', en: '2. Enter this code:' },
  'hostSettings.cliLoginPaste': {
    ko: '2. 발급된 코드를 여기에 붙여넣기',
    en: '2. Paste the code you received',
  },
  'hostSettings.cliLoginSubmit': { ko: '확인', en: 'Submit' },
  'hostSettings.cliLoginCancel': { ko: '취소', en: 'Cancel' },
  'hostSettings.cliLoginWaiting': { ko: '승인 대기 중…', en: 'Waiting for approval…' },
  'hostSettings.cliLoginFailed': { ko: '로그인 실패', en: 'Sign-in failed' },
  'hostSettings.promptPresets': { ko: '상황별 프롬프트', en: 'Saved prompts' },
  'hostSettings.promptPresetAdd': { ko: '프롬프트 추가', en: 'Add prompt' },
  'hostSettings.promptPresetTitle': {
    ko: '제목 (예: 도면 벽 세우기)',
    en: 'Title (e.g. Trace walls from plan)',
  },
  'hostSettings.promptPresetText': {
    ko: '이 상황에서 보낼 지시문을 적어두세요',
    en: 'Write the instruction to send in this situation',
  },
  'hostSettings.promptPresetDelete': { ko: '삭제', en: 'Delete' },
  'hostSettings.materials': { ko: '자재', en: 'Materials' },
  'hostSettings.materialsSource': { ko: 'RawPainter', en: 'RawPainter' },
  'hostSettings.connected': { ko: '연결됨', en: 'Connected' },
  'hostSettings.notConnected': { ko: '연결 안 됨', en: 'Not connected' },
  'hostSettings.unavailable': { ko: '사용 불가', en: 'Unavailable' },
  'hostSettings.checking': { ko: '확인 중', en: 'Checking' },
} as const satisfies Dictionary

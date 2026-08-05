import type { Dictionary } from './types'

/** `apps/editor/components/ai-chat-panel.tsx`. Templated entries use
 * `{token}` placeholders the caller fills with `.replace()`. The
 * `aiChat.op.*` entries back `operationLabel()` — their `ko` strings are
 * pinned to match `ai-chat-panel.test.tsx`'s pre-existing literal
 * assertions (e.g. "가구 Bay 추가"), so don't reword them without updating
 * that test. */
export const aiChatDictionary = {
  'aiChat.header.title': { ko: '모델링 에이전트', en: 'Modeling Agent' },
  'aiChat.header.desc': {
    ko: '화면이 아닌 장면 형식으로 작업',
    en: 'Works on scene structure, not pixels',
  },
  'aiChat.header.nodesBadge': { ko: '노드 {n}개', en: '{n} nodes' },
  'aiChat.header.oauthBadge': { ko: '{provider} OAuth', en: '{provider} OAuth' },
  'aiChat.header.connectedTitle': {
    ko: '{provider} CLI OAuth 연결됨',
    en: '{provider} CLI OAuth connected',
  },
  'aiChat.header.notConnectedTitle': {
    ko: '{provider} 로그인이 필요합니다',
    en: '{provider} login required',
  },
  'aiChat.reset.ariaLabel': { ko: '대화 초기화', en: 'Reset conversation' },

  'aiChat.welcome': {
    ko: '장면 그래프와 노드 스키마를 직접 읽습니다. 벽 길이 변경, 요소 생성, 재질 슬롯 수정처럼 모델 구조를 기준으로 요청하세요.',
    en: 'I read the scene graph and node schemas directly. Ask for changes in terms of model structure — wall length, creating elements, material slots.',
  },
  'aiChat.thinking': { ko: '장면 구조 분석 중', en: 'Analyzing scene structure' },
  'aiChat.thinkingLong': {
    ko: '— 큰 작업은 최대 10분까지 걸릴 수 있어요',
    en: '— large builds can take up to 10 minutes',
  },
  'aiChat.flows.title': { ko: '어떤 작업을 하실 건가요?', en: 'What do you want to do?' },
  'aiChat.flows.close': { ko: '플로우 닫기', en: 'Close flow' },

  'aiChat.pendingPlan.pending': { ko: '실행 대기 · {op}', en: 'Pending · {op}' },
  'aiChat.pendingPlan.desc': {
    ko: '스키마 검증 후 하나의 Undo 단위로 적용됩니다.',
    en: 'Validated against the schema and applied as a single undo step.',
  },
  'aiChat.pendingPlan.apply': { ko: '변경 적용', en: 'Apply changes' },
  'aiChat.pendingPlan.appliedStatus': {
    ko: '{n}개 작업을 적용했습니다. Undo 한 번으로 되돌릴 수 있습니다.',
    en: '{n} operations applied. One undo reverts them.',
  },
  'aiChat.pendingPlan.applyFailed': {
    ko: '모델링 계획이 스키마 검증에 실패했습니다.',
    en: 'Modeling plan failed validation',
  },

  'aiChat.queue.waiting': { ko: '대기 {n}건', en: '{n} queued' },
  'aiChat.queue.autoApplied': {
    ko: '대기 중인 다음 요청을 진행하기 위해 계획을 자동 적용했습니다 ({n}개 작업).',
    en: 'Auto-applied the plan to continue with the queued request ({n} operations).',
  },

  'aiChat.errors.requestFailed': { ko: 'AI 요청이 실패했습니다.', en: 'AI request failed' },

  'aiChat.loginRequired': {
    ko: '{provider} CLI에서 로그인 필요',
    en: 'Sign in to {provider} CLI',
  },

  'aiChat.attach.list.ariaLabel': {
    ko: '첨부된 참고 이미지',
    en: 'Attached reference images',
  },
  'aiChat.attach.remove': { ko: '{name} 삭제', en: 'Remove {name}' },
  'aiChat.attach.button.ariaLabel': { ko: '참고 이미지 첨부', en: 'Attach reference images' },
  'aiChat.attach.button.label': { ko: '이미지', en: 'Image' },
  'aiChat.attach.statusReading': { ko: '이미지 읽는 중…', en: 'Reading images…' },
  'aiChat.attach.statusCount': {
    ko: '{n}/{max} · PNG/JPEG/WebP · 파일당 5MB',
    en: '{n}/{max} · PNG/JPEG/WebP · up to 5MB each',
  },

  'aiChat.textarea.ariaLabel': { ko: 'AI 모델링 요청', en: 'AI modeling request' },
  'aiChat.textarea.placeholder': {
    ko: '예: 선택한 벽을 2400 mm로 늘려줘',
    en: 'e.g. Extend the selected wall to 2400 mm',
  },
  'aiChat.send.ariaLabel': { ko: '모델링 요청 보내기', en: 'Send modeling request' },

  'aiChat.imageErrors.unsupportedType': {
    ko: 'PNG, JPEG, WebP 이미지만 첨부할 수 있습니다.',
    en: 'Only PNG, JPEG, or WebP images can be attached.',
  },
  'aiChat.imageErrors.tooLarge': {
    ko: '이미지 파일은 5MB 이하여야 합니다.',
    en: 'Images must be 5MB or smaller.',
  },
  'aiChat.imageErrors.maxCount': {
    ko: '이미지는 최대 {max}개까지 첨부할 수 있습니다.',
    en: 'You can attach up to {max} images.',
  },
  'aiChat.imageErrors.readFailed': {
    ko: '이미지 파일을 읽지 못했습니다.',
    en: "Couldn't read the image file.",
  },

  'aiChat.op.create': { ko: '생성', en: 'Create' },
  'aiChat.op.update': { ko: '수정', en: 'Update' },
  'aiChat.op.delete': { ko: '삭제', en: 'Delete' },
  'aiChat.op.pushPullBodyFace': { ko: 'Push/Pull', en: 'Push/Pull' },
  'aiChat.op.transformBody': { ko: 'Body 변환', en: 'Body transform' },
  'aiChat.op.paintBodyFace': { ko: 'Body 재질', en: 'Body material' },
  'aiChat.op.makeMaterialSeamless': { ko: 'AI 심리스', en: 'AI seamless' },
  'aiChat.op.updateSceneMaterial': { ko: '자재 수정', en: 'Material update' },
  'aiChat.op.createRoundedRectangularFrameBody': { ko: '곡선 프레임', en: 'Curved frame' },
  'aiChat.op.createFurniture': { ko: '가구', en: 'Furniture' },
  'aiChat.op.setFurnitureTierInterior': { ko: '가구 내부 구성', en: 'Furniture interior' },
  'aiChat.op.insertFurnitureBay': { ko: '가구 Bay 추가', en: 'Furniture bay add' },
  'aiChat.op.deleteFurnitureBay': { ko: '가구 Bay 삭제', en: 'Furniture bay delete' },
  'aiChat.op.resizeFurnitureBay': { ko: '가구 Bay 치수', en: 'Furniture bay size' },
  'aiChat.op.insertFurnitureTier': { ko: '가구 Tier 추가', en: 'Furniture tier add' },
  'aiChat.op.deleteFurnitureTier': { ko: '가구 Tier 삭제', en: 'Furniture tier delete' },
  'aiChat.op.resizeFurnitureTier': { ko: '가구 Tier 치수', en: 'Furniture tier size' },
} as const satisfies Dictionary

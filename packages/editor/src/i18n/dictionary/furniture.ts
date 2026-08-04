import type { Dictionary } from './types'

/** `apps/editor/components/furniture-tab.tsx`. Templated entries use `{n}`
 * / other `{token}` placeholders the caller fills with `.replace()`. */
export const furnitureDictionary = {
  'furniture.header.title': { ko: '가구 빌더', en: 'Furniture Builder' },
  'furniture.header.desc': {
    ko: '유형을 고르고 시작점과 끝점을 찍으세요.',
    en: 'Pick a type, then click a start and end point.',
  },
  'furniture.selectLevelFirst': {
    ko: '가구를 추가하려면 먼저 레벨을 선택하세요.',
    en: 'Select a level before adding furniture.',
  },

  'furniture.kind.wardrobe': { ko: '붙박이장', en: 'Wardrobe' },
  'furniture.kind.baseRun': { ko: '하부장', en: 'Base' },
  'furniture.kind.upperRun': { ko: '상부장', en: 'Upper' },
  'furniture.kind.tall': { ko: '키큰장', en: 'Tall' },
  'furniture.kind.island': { ko: '아일랜드', en: 'Island' },
  'furniture.kind.set': { ko: '상하부 세트', en: 'Upper + Lower Set' },
  'furniture.kind.sink': { ko: '싱크장', en: 'Sink' },
  'furniture.kind.fallback': { ko: '가구', en: 'Furniture' },

  'furniture.dimension.width': { ko: '너비', en: 'Width' },
  'furniture.dimension.height': { ko: '높이', en: 'Height' },
  'furniture.dimension.depth': { ko: '깊이', en: 'Depth' },
  'furniture.bays.label': { ko: '통 수', en: 'Bays' },
  'furniture.bays.count': { ko: '{n}통', en: '{n} bays' },
  'furniture.bays.auto': { ko: '자동', en: 'Auto' },
  'furniture.bays.hint': {
    ko: '시작점과 끝점을 찍으면 그 길이를 통으로 등분합니다.',
    en: 'Click a start and end point — the span divides into equal bays.',
  },

  'furniture.armed.hint': {
    ko: '시작점 클릭 → 끝점 클릭 · 더블클릭/Esc로 완료',
    en: 'Click the start, then the end · Double-click/Esc to finish',
  },

  'furniture.onThisLevel': { ko: '이 레벨의 가구', en: 'Furniture on this level' },
  'furniture.noneYet': { ko: '아직 가구가 없습니다.', en: 'No furniture assemblies yet.' },
} as const satisfies Dictionary

export const statsDictionary = {
  'stats.header.title': { ko: '통계 · 산출', en: 'Takeoff' },
  'stats.header.desc': {
    ko: '씬에서 뽑은 수량을 INTM 자재 단가로 계산합니다.',
    en: 'Scene quantities priced against the INTM catalogue.',
  },
  'stats.scope.level': { ko: '현재 레벨', en: 'This level' },
  'stats.scope.whole': { ko: '전체 씬', en: 'Whole scene' },
  'stats.loading': { ko: '자재 카탈로그 불러오는 중…', en: 'Loading catalogue…' },
  'stats.noCatalogue': {
    ko: 'INTM 카탈로그에 연결되지 않아 수량만 표시합니다.',
    en: 'Not connected to INTM — quantities only, no prices.',
  },
  'stats.total': { ko: '합계 (확정 항목만)', en: 'Total (priced lines only)' },
  'stats.unresolved': {
    ko: '{n}개 항목이 확정되지 않았습니다. 아래에서 규격을 보정하세요.',
    en: '{n} lines are unresolved — correct their specs below.',
  },
  'stats.empty': { ko: '산출할 요소가 없습니다.', en: 'Nothing to measure yet.' },
  'stats.coverage': { ko: '1단위 면적', en: 'Per unit' },
  'stats.waste': { ko: '손실률', en: 'Waste' },
  'stats.save': { ko: 'INTM에 저장', en: 'Save to INTM' },
  'stats.estimate.title': { ko: '견적서 작성', en: 'Create estimate' },
  'stats.estimate.desc': {
    ko: '확정된 {n}개 항목으로 INTM에 견적서를 만듭니다. 미확정 항목은 제외됩니다.',
    en: 'Creates an INTM estimate from the {n} resolved lines. Unresolved lines are excluded.',
  },
  'stats.estimate.projectId': { ko: 'INTM 프로젝트 ID', en: 'INTM project ID' },
  'stats.estimate.project': { ko: '견적서 제목', en: 'Estimate title' },
  'stats.estimate.create': { ko: 'INTM에 견적서 생성', en: 'Create in INTM' },
  'stats.estimate.creating': { ko: '생성 중…', en: 'Creating…' },
  'stats.submitted': {
    ko: '견적서를 만들었습니다 ({n}개 항목).',
    en: 'Estimate created ({n} items).',
  },
  'stats.sharedReadOnly': {
    ko: '공용 자재는 INTM에서 관리자만 수정할 수 있습니다.',
    en: 'Shared materials are admin-only in INTM.',
  },
} as const

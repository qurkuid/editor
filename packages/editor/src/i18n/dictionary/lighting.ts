import type { Dictionary } from './types'

/** `apps/editor/components/lighting-tab.tsx`. Templated entries use
 * `{token}` placeholders the caller fills with `.replace()`. `ON` / `OFF`
 * circuit-state abbreviations and `m` (meters) are kept literal in both
 * locales — conventional electrical/unit shorthand, not prose. */
export const lightingDictionary = {
  'lighting.guide.title': { ko: '조명 설치', en: 'Lighting setup' },
  'lighting.guide.desc': {
    ko: '회로부터 스위치까지 순서대로 연결하세요',
    en: 'Connect from circuit to switch, in order',
  },
  'lighting.guide.stepCircuit': { ko: '회로 만들기', en: 'Create circuit' },
  'lighting.guide.stepFixture': { ko: '조명 배치', en: 'Place fixtures' },
  'lighting.guide.stepSwitch': { ko: '스위치 연결', en: 'Wire switch' },
  'lighting.guide.complete': { ko: '{n} / 3 완료', en: '{n} / 3 done' },

  'lighting.currentCircuit': { ko: '현재 회로', en: 'Current circuit' },
  'lighting.noneSelected': { ko: '선택되지 않음', en: 'None selected' },
  'lighting.selectLevelFirst': {
    ko: '전기 요소를 배치하려면 먼저 레벨을 선택하세요.',
    en: 'Select a level before placing electrical elements.',
  },

  'lighting.circuits.heading': { ko: '회로', en: 'Circuits' },
  'lighting.circuits.add': { ko: '추가', en: 'Add' },
  'lighting.circuits.empty': {
    ko: '아직 회로가 없습니다. 여러 조명을 함께 제어하려면 회로를 추가하세요.',
    en: 'No circuits yet. Add one to control several lights together.',
  },
  'lighting.circuits.use': { ko: '{name} 사용', en: 'Use {name}' },
  'lighting.circuits.defaultName': { ko: '회로 {n}', en: 'Circuit {n}' },
  'lighting.circuits.turnOff': { ko: '끄기', en: 'Turn off' },
  'lighting.circuits.turnOn': { ko: '켜기', en: 'Turn on' },
  'lighting.circuits.summary': {
    ko: '조명 {lights}개 · 스위치 {switches}개 · {state}',
    en: '{lights} lights · {switches} switches · {state}',
  },

  'lighting.placeLights.heading': { ko: '조명 배치', en: 'Place lights' },
  'lighting.lightType.point.label': { ko: '포인트', en: 'Point' },
  'lighting.lightType.point.desc': { ko: '전체 공간', en: 'Whole room' },
  'lighting.lightType.spot.label': { ko: '스팟', en: 'Spot' },
  'lighting.lightType.spot.desc': { ko: '한 방향 집중', en: 'Focused beam' },
  'lighting.lightType.area.label': { ko: '에어리어', en: 'Area' },
  'lighting.lightType.area.desc': { ko: '넓고 부드럽게', en: 'Soft and wide' },
  'lighting.lightType.linear.label': { ko: '라인', en: 'Linear' },
  'lighting.lightType.linear.desc': { ko: 'T5·라인 조명', en: 'T5 line light' },
  'lighting.mountHeight': { ko: '설치 높이', en: 'Mount height' },

  'lighting.placement.single': { ko: '한 개씩', en: 'One by one' },
  'lighting.placement.array': { ko: '구간 등분', en: 'Divide a run' },
  'lighting.placement.count': { ko: '개수', en: 'Count' },
  'lighting.placement.arrayHint': {
    ko: '시작점과 끝점을 클릭하면 사이를 개수만큼 등분해 배치합니다',
    en: 'Click a start and an end point to fill the run evenly',
  },

  'lighting.item.heading': { ko: '조명 아이템 (선택)', en: 'Fixture model (optional)' },
  'lighting.item.none': { ko: '없음', en: 'None' },

  'lighting.placeSwitch.heading': { ko: '스위치 배치', en: 'Place switch' },
  'lighting.placeSwitch.wallSwitch': { ko: '벽 스위치', en: 'Wall switch' },
  'lighting.placeSwitch.desc': {
    ko: '선택된 회로를 클릭으로 ON/OFF',
    en: 'Click to turn the selected circuit ON/OFF',
  },
} as const satisfies Dictionary

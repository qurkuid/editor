/**
 * Guided task flows for the AI panel: each flow is a sequence of steps the
 * user walks through with buttons, and every step drops an editable canned
 * instruction into the chat input — the user can adjust the text (or ignore
 * the flow entirely and type free-form) before sending.
 */

type LocalizedText = { readonly ko: string; readonly en: string }

export type AiTaskFlowStep = {
  readonly id: string
  readonly label: LocalizedText
  readonly prompt: LocalizedText
  /** Step that attaches a reference image instead of sending an instruction. */
  readonly needsImage?: boolean
}

export type AiTaskFlow = {
  readonly id: string
  readonly title: LocalizedText
  readonly steps: readonly AiTaskFlowStep[]
}

export const AI_TASK_FLOWS: readonly AiTaskFlow[] = [
  {
    id: 'floorplan',
    title: { ko: '도면 인식으로 만들기', en: 'Build from a floor plan' },
    steps: [
      {
        id: 'upload',
        label: { ko: '이미지 업로드', en: 'Upload image' },
        prompt: { ko: '', en: '' },
        needsImage: true,
      },
      {
        id: 'walls',
        label: { ko: '벽 세우기', en: 'Build walls' },
        prompt: {
          ko: '첨부한 도면 이미지를 단순화해서(외곽 → 내벽 → 개구부 순서, 가구·치수 텍스트는 무시) 벽을 세워줘.',
          en: 'Simplify the attached floor plan (exterior boundary → interior walls → openings, ignoring furniture and dimension text) and build the walls.',
        },
      },
      {
        id: 'zones',
        label: { ko: '존 설정', en: 'Set up zones' },
        prompt: {
          ko: '벽으로 닫힌 공간마다 존을 만들고, 용도에 맞는 방 이름을 붙여줘.',
          en: 'Create a zone for every enclosed space and name each room by its likely use.',
        },
      },
      {
        id: 'openings',
        label: { ko: '문·창문 세우기', en: 'Doors and windows' },
        prompt: {
          ko: '동선에 맞게 문을 달고, 외벽에는 채광·환기 규정에 맞게 창문을 배치해줘.',
          en: 'Add doors that fit the circulation and place windows on the exterior walls per daylight and ventilation rules.',
        },
      },
    ],
  },
  {
    id: 'example-structure',
    title: { ko: '예시 구조 생성', en: 'Generate an example structure' },
    steps: [
      {
        id: 'brief',
        label: { ko: '조건 입력', en: 'Describe it' },
        prompt: {
          ko: '방 3개, 화장실 2개인 26평 아파트 예시 구조의 벽을 만들어줘. 현관은 좌측이야. (평형·방 개수·현관 방향을 원하는 대로 고쳐 쓰세요)',
          en: 'Build the walls of an example 3-bedroom, 2-bath 86㎡ apartment with the entrance on the left. (Edit the size, room count, and entrance side as you like.)',
        },
      },
      {
        id: 'floors',
        label: { ko: '바닥·천장', en: 'Floor and ceiling' },
        prompt: {
          ko: '지금 구조에 바닥 슬래브와 천장을 만들어줘.',
          en: 'Add the floor slab and ceiling to the current structure.',
        },
      },
      {
        id: 'openings',
        label: { ko: '문·창문', en: 'Doors and windows' },
        prompt: {
          ko: '동선에 맞게 문을 달고, 외벽에는 규정에 맞게 창문을 배치해줘.',
          en: 'Add doors that fit the circulation and place code-compliant windows on the exterior walls.',
        },
      },
      {
        id: 'furnish',
        label: { ko: '가구 배치', en: 'Furnish' },
        prompt: {
          ko: '주방에 상부장·하부장을, 안방에는 침대와 붙박이장을 가장 긴 벽에 배치해줘.',
          en: 'Place upper and lower cabinets in the kitchen, and a bed plus a built-in wardrobe along the longest wall of the master bedroom.',
        },
      },
    ],
  },
  {
    id: 'finishes',
    title: { ko: '마감·재질 지정', en: 'Assign finishes' },
    steps: [
      {
        id: 'floor',
        label: { ko: '바닥 마감', en: 'Floor finish' },
        prompt: {
          ko: '방별 바닥 마감을 지정해줘. 거실·주방은 강마루, 침실은 원목마루, 화장실은 포세린 타일. (방·자재를 원하는 대로 고쳐 쓰세요)',
          en: 'Assign floor finishes per room: engineered wood in the living room and kitchen, hardwood in the bedrooms, porcelain tile in the bathrooms. (Edit rooms and materials as you like.)',
        },
      },
      {
        id: 'walls',
        label: { ko: '벽 마감', en: 'Wall finish' },
        prompt: {
          ko: '방별 벽 마감을 지정해줘. 전체는 도배지 - 회벽 화이트, 화장실은 벽타일. (방·자재를 원하는 대로 고쳐 쓰세요)',
          en: 'Assign wall finishes per room: plaster-white wallpaper throughout, wall tile in the bathrooms. (Edit rooms and materials as you like.)',
        },
      },
      {
        id: 'ceiling',
        label: { ko: '천장 마감', en: 'Ceiling finish' },
        prompt: {
          ko: '방별 천장 마감을 지정해줘. 전체는 도배지 화이트, 화장실은 SMC 천장재. (방·자재를 원하는 대로 고쳐 쓰세요)',
          en: 'Assign ceiling finishes per room: white wallpaper throughout, SMC panels in the bathrooms. (Edit rooms and materials as you like.)',
        },
      },
      {
        id: 'accents',
        label: { ko: '포인트 조정', en: 'Accents' },
        prompt: {
          ko: '포인트로 바꿀 곳을 지정해줘. 예: 거실 아트월은 톤 다운된 그레이, 안방 한쪽 벽은 포인트 벽지. (원하는 방·면·자재로 고쳐 쓰세요)',
          en: 'Pick accent spots: for example a muted grey feature wall in the living room and an accent wallpaper on one master-bedroom wall. (Edit to taste.)',
        },
      },
    ],
  },
]

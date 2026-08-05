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
          ko: '첨부한 도면대로 벽을 세워줘. 치수선이 있으면 기재된 치수값에서 좌표를 추출하고(눈대중 금지), 외곽 → 내벽 순서로. 도면에 없는 벽은 추가하지 마.',
          en: 'Build the walls exactly as the attached drawing shows. If it has dimension lines, extract coordinates from the stated values (no eyeballing), exterior boundary first, then interior walls. Do not add walls the drawing does not show.',
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
          ko: '도면의 창호 기호대로 문·창문을 달아줘. 위치·폭은 기호와 치수 기준, 문은 개폐 방향(호)까지 반영해서. 도면에 없는 개구부는 추가하지 마.',
          en: "Add the doors and windows exactly as the drawing's opening symbols show — positions and widths from the symbols and dimensions, door swings from the drawn arcs. Do not invent openings.",
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
  {
    id: 'auto-zones',
    title: { ko: '자동 존 설정', en: 'Auto zones' },
    steps: [
      {
        id: 'zones',
        label: { ko: '존 설정', en: 'Zones' },
        prompt: {
          ko: '벽으로 닫힌 공간마다 존을 만들고, 용도에 맞는 방 이름을 붙여줘.',
          en: 'Create a zone for every wall-enclosed space and name each room by its likely use.',
        },
      },
    ],
  },
  {
    id: 'circulation-doors',
    title: { ko: '동선 도어', en: 'Doors by circulation' },
    steps: [
      {
        id: 'doors',
        label: { ko: '문 달기', en: 'Doors' },
        prompt: {
          ko: '동선에 맞게 각 방 출입문을 달아줘. 현관에서 거실을 거쳐 각 방으로 자연스럽게 이동할 수 있게. (문 폭·위치를 원하는 대로 고쳐 쓰세요)',
          en: "Add each room's door to fit the circulation, so movement flows naturally from the entrance through the living room to every room. (Edit widths and positions.)",
        },
      },
    ],
  },
  {
    id: 'exterior-windows',
    title: { ko: '외벽 창문', en: 'Exterior windows' },
    steps: [
      {
        id: 'windows',
        label: { ko: '창문 배치', en: 'Windows' },
        prompt: {
          ko: '외벽마다 채광·환기 규정에 맞게 창문을 배치해줘. 거실은 큰 창, 침실은 중간 창, 화장실은 작은 창이나 생략. (크기·개수를 원하는 대로 고쳐 쓰세요)',
          en: 'Place windows on every exterior wall per daylight and ventilation rules: large in the living room, medium in bedrooms, small or none in bathrooms. (Edit sizes and counts.)',
        },
      },
    ],
  },
  {
    id: 'lighting',
    title: { ko: '조명 배치', en: 'Lighting' },
    steps: [
      {
        id: 'main',
        label: { ko: '방별 메인 조명', en: 'Main lights' },
        prompt: {
          ko: '방마다 메인 조명을 배치해줘. 거실은 중앙 매입등 배열, 침실은 중앙 등 1개, 주방은 작업대 위주로. (방·형태를 원하는 대로 고쳐 쓰세요)',
          en: 'Place a main light per room: a recessed grid in the living room, one center fixture per bedroom, task-oriented lights over the kitchen counters. (Edit as you like.)',
        },
      },
      {
        id: 'accent',
        label: { ko: '간접·포인트 조명', en: 'Accent lights' },
        prompt: {
          ko: '간접·포인트 조명을 더해줘. 거실 커튼박스 간접등, 복도 다운라이트, 식탁 위 펜던트. (원하는 위치로 고쳐 쓰세요)',
          en: 'Add indirect and accent lighting: cove lighting at the living-room curtain box, hallway downlights, a pendant over the dining table. (Edit as you like.)',
        },
      },
      {
        id: 'circuits',
        label: { ko: '스위치·회로', en: 'Switches' },
        prompt: {
          ko: '조명을 회로별로 묶고 동선에 맞는 위치에 스위치를 배치해줘. 방 입구마다 1개, 거실은 복도·소파 양쪽.',
          en: 'Group the lights into circuits and place switches where the circulation needs them: one at each room entrance, both hallway and sofa side for the living room.',
        },
      },
    ],
  },
  {
    id: 'kitchen',
    title: { ko: '주방 구성', en: 'Kitchen' },
    steps: [
      {
        id: 'base',
        label: { ko: '하부장 라인', en: 'Base run' },
        prompt: {
          ko: '주방 벽면을 따라 하부장 라인을 배치해줘. 싱크 구간을 포함해서. (길이·벽면을 원하는 대로 고쳐 쓰세요)',
          en: 'Place the base-cabinet run along the kitchen wall, including the sink section. (Edit the length and wall as you like.)',
        },
      },
      {
        id: 'upper',
        label: { ko: '상부장', en: 'Upper run' },
        prompt: {
          ko: '하부장 위로 상부장을 배치해줘. 창문 구간은 비우고.',
          en: 'Hang the upper cabinets above the base run, leaving the window section open.',
        },
      },
      {
        id: 'island',
        label: { ko: '아일랜드·키큰장', en: 'Island and tall' },
        prompt: {
          ko: '주방 중앙에 아일랜드를, 라인 끝에는 키큰장(냉장고장)을 배치해줘. (크기·위치를 원하는 대로 고쳐 쓰세요)',
          en: 'Add an island in the middle of the kitchen and a tall (fridge) cabinet at the end of the run. (Edit sizes and positions.)',
        },
      },
    ],
  },
  {
    id: 'storage',
    title: { ko: '붙박이 수납', en: 'Built-in storage' },
    steps: [
      {
        id: 'place',
        label: { ko: '붙박이장 배치', en: 'Place wardrobes' },
        prompt: {
          ko: '안방 가장 긴 벽에 붙박이장을 배치해줘. 다른 침실에도 폭에 맞는 붙박이장을 하나씩. (방·크기를 원하는 대로 고쳐 쓰세요)',
          en: 'Place a built-in wardrobe along the longest master-bedroom wall, and one sized to fit in each other bedroom. (Edit rooms and sizes.)',
        },
      },
      {
        id: 'interior',
        label: { ko: '내부 구성', en: 'Interiors' },
        prompt: {
          ko: '붙박이장 내부를 구성해줘. 안방은 행거 구간 + 선반 구간 반반, 나머지는 선반 위주로.',
          en: 'Configure the wardrobe interiors: half hanger, half shelves in the master bedroom, shelf-heavy elsewhere.',
        },
      },
      {
        id: 'bays',
        label: { ko: '베이 폭 조정', en: 'Bay widths' },
        prompt: {
          ko: '붙박이장 베이 폭을 조정해줘. 예: 안방 행거 베이는 900mm, 선반 베이는 600mm. (원하는 폭으로 고쳐 쓰세요)',
          en: 'Adjust the wardrobe bay widths: for example 900mm hanger bays and 600mm shelf bays in the master bedroom. (Edit widths as you like.)',
        },
      },
    ],
  },
]

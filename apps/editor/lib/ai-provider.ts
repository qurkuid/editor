import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { AnyNode } from '@pascal-app/core/schema'
import { MODELING_AGENT_MANUAL } from '@pascal-app/mcp'
import { z } from 'zod'
import { AI_EFFORT_LEVELS, AI_MODEL_IDS } from './ai-model-options'

const AiChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8_000),
})

export const AI_CHAT_MAX_IMAGES = 4
export const AI_CHAT_MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const AI_CHAT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

const MAX_BASE64_IMAGE_BYTES = Math.ceil(AI_CHAT_MAX_IMAGE_BYTES / 3) * 4
const AI_CHAT_IMAGE_DATA_URL_PATTERN =
  /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/

type DecodedAiChatImage = {
  readonly mimeType: (typeof AI_CHAT_IMAGE_MIME_TYPES)[number]
  readonly bytes: Buffer
}

function decodeImageDataUrl(dataUrl: string): DecodedAiChatImage | null {
  const match = AI_CHAT_IMAGE_DATA_URL_PATTERN.exec(dataUrl)
  const mimeType = match?.[1]
  const encoded = match?.[2]
  if (!mimeType || !encoded || encoded.length > MAX_BASE64_IMAGE_BYTES) return null

  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.length === 0 || bytes.toString('base64') !== encoded) return null

  return {
    mimeType: mimeType as (typeof AI_CHAT_IMAGE_MIME_TYPES)[number],
    bytes,
  }
}

export const AiChatImageSchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    mimeType: z.enum(AI_CHAT_IMAGE_MIME_TYPES),
    dataUrl: z
      .string()
      .min(1)
      .max(MAX_BASE64_IMAGE_BYTES + 32),
  })
  .superRefine((image, context) => {
    const decoded = decodeImageDataUrl(image.dataUrl)
    if (!decoded) {
      context.addIssue({
        code: 'custom',
        path: ['dataUrl'],
        message: 'Image must be a valid base64 data URL.',
      })
      return
    }

    if (decoded.mimeType !== image.mimeType) {
      context.addIssue({
        code: 'custom',
        path: ['mimeType'],
        message: 'Image MIME type must match its data URL.',
      })
    }

    if (decoded.bytes.byteLength > AI_CHAT_MAX_IMAGE_BYTES) {
      context.addIssue({
        code: 'too_big',
        path: ['dataUrl'],
        maximum: AI_CHAT_MAX_IMAGE_BYTES,
        inclusive: true,
        origin: 'string',
        message: 'Image must be 5 MB or smaller.',
      })
    }
  })

export type AiChatImage = z.infer<typeof AiChatImageSchema>

export const AiProviderKindSchema = z.enum(['codex', 'claude'])
export type AiProviderKind = z.infer<typeof AiProviderKindSchema>

export const AiChatRequestSchema = z.object({
  messages: z.array(AiChatMessageSchema).min(1).max(40),
  images: z.array(AiChatImageSchema).max(AI_CHAT_MAX_IMAGES).optional().default([]),
  provider: AiProviderKindSchema.optional().default('codex'),
  model: z.enum(AI_MODEL_IDS).nullable().optional().default(null),
  effort: z.enum(AI_EFFORT_LEVELS).nullable().optional().default(null),
  scene: z.object({
    coordinateSystem: z.object({
      groundPlane: z.literal('XZ'),
      upAxis: z.literal('Y'),
      unit: z.literal('m'),
    }),
    nodeCount: z.number().int().nonnegative(),
    nodes: z.record(z.string(), z.unknown()),
    rootNodeIds: z.array(z.string()),
    materials: z.record(z.string(), z.unknown()),
    selection: z.object({
      buildingId: z.string().nullable(),
      levelId: z.string().nullable(),
      zoneId: z.string().nullable(),
      selectedIds: z.array(z.string()),
      selectedNodes: z.array(z.unknown()),
    }),
  }),
})

export type AiChatRequest = z.infer<typeof AiChatRequestSchema>

export function decodeAiChatImageDataUrl(image: AiChatImage): Buffer {
  const decoded = decodeImageDataUrl(image.dataUrl)
  if (!decoded || decoded.mimeType !== image.mimeType) {
    throw new Error('Invalid AI image attachment')
  }
  if (decoded.bytes.byteLength > AI_CHAT_MAX_IMAGE_BYTES) {
    throw new Error('AI image attachment exceeds the 5 MB limit')
  }
  return decoded.bytes
}

export type AiProviderConfig = {
  readonly command: string
  readonly model: string | null
  readonly effort?: string | null
}

export type CodexCliStatus =
  | { readonly connected: true; readonly authMethod: 'chatgpt' }
  | { readonly connected: false; readonly authMethod: null }

export type ClaudeCliStatus =
  | { readonly connected: true; readonly authMethod: string }
  | { readonly connected: false; readonly authMethod: null }

export const modelingPlanJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['message', 'patches'],
  properties: {
    message: { type: 'string' },
    patches: {
      type: 'array',
      maxItems: 100,
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'op',
          'id',
          'nodeJson',
          'dataJson',
          'parentId',
          'cascade',
          'faceId',
          'distance',
          'translation',
          'rotationY',
          'uniformScale',
          'pivot',
        ],
        properties: {
          op: {
            type: 'string',
            enum: [
              'create',
              'update',
              'delete',
              'pushPullBodyFace',
              'transformBody',
              'paintBodyFace',
              'makeMaterialSeamless',
              'createRoundedRectangularFrameBody',
              'createFurniture',
              'setFurnitureTierInterior',
              'insertFurnitureBay',
              'deleteFurnitureBay',
              'resizeFurnitureBay',
              'insertFurnitureTier',
              'deleteFurnitureTier',
              'resizeFurnitureTier',
            ],
          },
          id: { type: ['string', 'null'] },
          nodeJson: { type: ['string', 'null'] },
          dataJson: { type: ['string', 'null'] },
          parentId: { type: ['string', 'null'] },
          cascade: { type: ['boolean', 'null'] },
          faceId: { type: ['string', 'null'] },
          distance: { type: ['number', 'null'] },
          translation: {
            type: ['array', 'null'],
            items: { type: 'number' },
            minItems: 3,
            maxItems: 3,
          },
          rotationY: { type: ['number', 'null'] },
          uniformScale: { type: ['number', 'null'] },
          pivot: {
            type: ['array', 'null'],
            items: { type: 'number' },
            minItems: 3,
            maxItems: 3,
          },
        },
      },
    },
  },
} as const

/**
 * The CLI bin this app ships as an npm dependency. Checked from the app dir
 * and the workspace root — bun hoists workspace bins to the root
 * `node_modules/.bin`, and pm2 may start the server from either directory.
 */
function bundledCliCommand(binary: string): string | null {
  const cwd = process.cwd()
  for (const base of [cwd, join(cwd, '..', '..'), join(cwd, 'apps', 'editor')]) {
    const candidate = join(base, 'node_modules', '.bin', binary)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Claude's structured output honors optional fields, so its plan schema only
 * requires `op` per patch — omitting the ~10 inapplicable nulls per patch
 * meaningfully shortens what the model has to write. Codex strict output
 * requires every property listed, so it keeps the all-required variant.
 */
export const claudeModelingPlanJsonSchema = {
  ...modelingPlanJsonSchema,
  properties: {
    ...modelingPlanJsonSchema.properties,
    patches: {
      ...modelingPlanJsonSchema.properties.patches,
      items: {
        ...modelingPlanJsonSchema.properties.patches.items,
        required: ['op'],
      },
    },
  },
}

export function resolveAiProviderConfig(
  environment: Record<string, string | undefined>,
): AiProviderConfig {
  const pathCommand = environment.PATH?.split(delimiter)
    .map((directory) => join(directory, 'codex'))
    .find((candidate) => existsSync(candidate))
  const siblingCommand = environment.PASCAL_NODE_EXEC_PATH
    ? join(dirname(environment.PASCAL_NODE_EXEC_PATH), 'codex')
    : null
  return {
    command:
      environment.CODEX_CLI_PATH ??
      bundledCliCommand('codex') ??
      (siblingCommand && existsSync(siblingCommand) ? siblingCommand : null) ??
      pathCommand ??
      'codex',
    model: environment.PASCAL_CODEX_MODEL ?? null,
  }
}

export function resolveClaudeCliConfig(
  environment: Record<string, string | undefined>,
): AiProviderConfig {
  const pathCommand = environment.PATH?.split(delimiter)
    .map((directory) => join(directory, 'claude'))
    .find((candidate) => existsSync(candidate))
  return {
    command: environment.CLAUDE_CLI_PATH ?? bundledCliCommand('claude') ?? pathCommand ?? 'claude',
    model: environment.PASCAL_CLAUDE_MODEL ?? null,
  }
}

export function parseCodexLoginStatus(output: string): CodexCliStatus {
  if (output.includes('Logged in using ChatGPT')) {
    return { connected: true, authMethod: 'chatgpt' }
  }
  return { connected: false, authMethod: null }
}

const ClaudeAuthStatusSchema = z.object({
  loggedIn: z.boolean(),
  authMethod: z.string().optional(),
})

export function parseClaudeLoginStatus(output: string): ClaudeCliStatus {
  try {
    const status = ClaudeAuthStatusSchema.parse(JSON.parse(output))
    if (status.loggedIn) {
      return { connected: true, authMethod: status.authMethod ?? 'unknown' }
    }
  } catch {
    // Malformed or unexpected `claude auth status --json` output — treat as not connected.
  }
  return { connected: false, authMethod: null }
}

/**
 * The full AnyNode JSON schema is ~180KB across 44 node types — sent whole, it
 * dominated every request's prompt (~80k tokens) and with it the latency. A
 * request only ever touches a handful of types, so the prompt carries full
 * schemas for the relevant subset and just the names of the rest.
 */
const CORE_NODE_TYPES: readonly string[] = [
  'site',
  'building',
  'level',
  'zone',
  'wall',
  'door',
  'window',
  'slab',
  'ceiling',
  'cabinet',
  'item',
  'body',
]

const NODE_TYPE_KEYWORDS: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/계단|stair/i, ['stair']],
  [
    /지붕|박공|처마|천창|roof|dormer|skylight/i,
    [
      'roof',
      'roof-segment',
      'dormer',
      'skylight',
      'cupola',
      'ridge-vent',
      'eyebrow-vent',
      'box-vent',
    ],
  ],
  [/기둥|column/i, ['column']],
  [/펜스|울타리|fence/i, ['fence']],
  [/엘리베이터|승강기|elevator/i, ['elevator']],
  [/조명|램프|light/i, ['lighting-fixture', 'lighting-circuit', 'lighting-switch']],
  [
    /덕트|환기|공조|duct|hvac/i,
    ['duct-segment', 'duct-fitting', 'duct-terminal', 'hvac-equipment'],
  ],
  [
    /배관|파이프|pipe|lineset/i,
    ['pipe-segment', 'pipe-fitting', 'pipe-trap', 'lineset', 'liquid-line'],
  ],
  [/태양광|solar/i, ['solar-panel']],
  [/홈통|물받이|낙수|gutter|downspout/i, ['gutter', 'downspout']],
  [/치수|측정|가이드|dimension|measure|guide/i, ['measurement', 'construction-dimension', 'guide']],
  [/굴뚝|chimney/i, ['chimney']],
  [
    /붙박이|수납장|상부장|하부장|캐비닛|가구|cabinet|wardrobe|furniture/i,
    ['cabinet', 'cabinet-module'],
  ],
]

type NodeSchemaParts = {
  variants: Map<string, Record<string, unknown>>
  defs: Record<string, unknown>
}

let cachedNodeSchemaParts: NodeSchemaParts | null = null

function nodeSchemaParts(): NodeSchemaParts {
  if (!cachedNodeSchemaParts) {
    const full = z.toJSONSchema(AnyNode, { unrepresentable: 'any' }) as {
      anyOf?: Array<Record<string, unknown>>
      oneOf?: Array<Record<string, unknown>>
      $defs?: Record<string, unknown>
    }
    const variants = new Map<string, Record<string, unknown>>()
    for (const variant of full.oneOf ?? full.anyOf ?? []) {
      const typeProperty = (variant.properties as Record<string, { const?: unknown }> | undefined)
        ?.type
      const name = typeProperty?.const
      if (typeof name === 'string') variants.set(name, variant)
    }
    cachedNodeSchemaParts = { variants, defs: full.$defs ?? {} }
  }
  return cachedNodeSchemaParts
}

function nodeSchemaVariants(): Map<string, Record<string, unknown>> {
  return nodeSchemaParts().variants
}

export function listNodeTypeNames(): string[] {
  return [...nodeSchemaVariants().keys()]
}

export function selectRelevantNodeTypes(input: AiChatRequest): Set<string> {
  const known = nodeSchemaVariants()
  const selected = new Set<string>()
  for (const type of CORE_NODE_TYPES) {
    if (known.has(type)) selected.add(type)
  }
  for (const node of Object.values(input.scene.nodes)) {
    const type = (node as { type?: unknown } | null)?.type
    if (typeof type === 'string' && known.has(type)) selected.add(type)
  }
  const text = input.messages.map((message) => message.content).join('\n')
  for (const [pattern, types] of NODE_TYPE_KEYWORDS) {
    if (pattern.test(text)) {
      for (const type of types) {
        if (known.has(type)) selected.add(type)
      }
    }
  }
  return selected
}

export function buildAiSceneNodeSchema(
  relevantTypes?: ReadonlySet<string>,
): Record<string, unknown> {
  const { variants, defs } = nodeSchemaParts()
  const chosen = relevantTypes
    ? [...variants.entries()].filter(([type]) => relevantTypes.has(type)).map(([, v]) => v)
    : [...variants.values()]
  // The shared $defs are a few hundred bytes — always carried so the
  // variants' $ref pointers stay resolvable.
  return { oneOf: chosen, $defs: defs }
}

export function buildAiModelingPrompt(input: AiChatRequest): string {
  const conversation = input.messages
    .map((message) => `${message.role}: ${message.content}`)
    .join('\n')
  const images = input.images ?? []
  const imageManifest =
    images.length > 0
      ? [
          `Attached reference images:\n${images
            .map((image, index) => `${index + 1}. ${image.name} (${image.mimeType})`)
            .join('\n')}`,
          'These exact files are attached as image inputs to this request. Inspect each one before proposing a plan.',
        ]
      : []
  return [
    'You are the modeling agent inside Pascal Editor. Your job, in this order: understand the instruction precisely; think through the build in structural stages (site → building → level → walls and openings → zones → floors and ceilings → finishes → furniture); infer what the user is actually trying to achieve, not just what the words say; when more than one direction fits that intent, propose the alternatives with a recommendation; and carry the work through until what the user wanted exists in the scene.',
    MODELING_AGENT_MANUAL,
    'When reference images are attached, inspect each one explicitly and use it to infer the outcome the user wants: shapes, proportions, layout, style, and colors. Read the current scene state only from the structured scene graph provided with this request; never guess it from screenshots or image pixels.',
    ...imageManifest,
    'When an attached image is a floor plan and the user asks to build from it, reproduce the drawing exactly — never add walls or openings the drawing does not show, and never redesign or beautify the layout. Work in two passes. First simplify the drawing internally: trace the exterior boundary, then interior walls, then door and window openings — ignore furniture, appliances, hatching, and decoration; dimension text is not geometry to trace but is your measurement source. Then build: return create patches for wall nodes along the traced segments on the target level, closing each room outline so zones can form.',
    'When the drawing carries dimension chains (치수선), extract every coordinate from the stated dimension values in millimetres instead of estimating proportions by eye. Locate each wall by its two face lines and emit it as a centreline: start/end on the midline between the faces, thickness equal to the face-to-face distance. Extend wall endpoints to the centreline of the orthogonal wall they meet so corners close without half-thickness gaps. Convert millimetres to metres and centre the plan bounding box on the origin.',
    "Take doors and windows only from the drawing's opening symbols and schedule marks (PD, PW, WD, FSD and similar), with widths from the stated dimensions and door swing from the drawn arc. Use the wall height stated in a section or annotation; otherwise assume a wall height of 2.42 metres and state that assumption in message. Before returning, verify every opening lies within its wall span and is narrower than its wall, and report the overall dimensions you checked in message.",
    "Derive the floor plan's real-world scale from dimensions stated in the image or by the user. If no scale is available, do not build at a guessed size — ask for one overall measurement (for example the total width) as a numbered question, then build on the reply.",
    'When a plan creates a site node, give it a polygon that comfortably contains the building footprint with a few metres of margin — the editor draws the ground plane from it.',
    'Coordinates use X/Z as the ground plane, Y as up, metres as the canonical unit, and radians for rotations.',
    'Return the smallest valid create/update/delete patch set that satisfies the user.',
    'For create, nodeJson is the complete node JSON string. For update, dataJson is a JSON string holding only the changed fields — never echo the whole node and never use nodeJson for an update. For delete, use id plus optional cascade.',
    'Room finish metadata such as floorFinish, wallFinish, and ceilingFinish lives on the zone node. Set it with an update patch on the zone, for example dataJson {"wallFinish":"도배지 - 회벽 화이트"}.',
    'A wall\'s kind (유리벽, 조적벽, 유리벽돌 벽) is not a stored property — it is derived from the materials the wall is composed of. For an unbanded wall, set both face slots to the kind\'s library material with an update patch, for example dataJson {"slots":{"interior":"library:preset-glass","exterior":"library:preset-glass"}}. For a wall with face bands enabled, set both sides of the band that is built from that material instead — for example a glass-block lower band is dataJson {"slots":{"lowerInterior":"library:preset-glass-block","lowerExterior":"library:preset-glass-block"}} — and leave the other bands as authored. Use library:preset-glass for glass, library:flooring-rusticbrick for masonry, and library:preset-glass-block for glass block. This applies when creating the wall too — include the slots field in nodeJson. To return the wall to a standard finish, remove the refs you set from slots.',
    'For exact Body face extrusion, return op pushPullBodyFace with the body id, faceId, and signed distance in metres. Prefer this deterministic command over rewriting Body topology arrays.',
    'For Body move, Y-axis rotation, or uniform scale, return op transformBody with translation in metres, rotationY in radians, a positive uniformScale, and an explicit pivot. Prefer this deterministic command over rewriting Body vertices.',
    'For Body face finishes, return op paintBodyFace with the body id, faceId, and dataJson containing a complete SceneMaterial JSON string such as {"id":"mat_red","name":"Matte red paint","material":{"preset":"custom","properties":{"color":"#b91c1c","roughness":0.85,"metalness":0}}}. Its id must begin with mat_. Prefer this deterministic command over rewriting Body faces or topology.',
    'For a textured scene material that should tile without visible image borders, return op makeMaterialSeamless and dataJson as {"materialId":"mat_existing"}. Use an existing material id from scene.materials. The editor hashes the original image, reuses a local cached result, and updates the material texture when the user applies the plan.',
    'For a hollow rectangular frame wall with rounded outer upper corners, return op createRoundedRectangularFrameBody. Put the optional body id in id, the target level id in parentId, and dataJson as {"name":"Rounded frame wall","origin":[0,0,0],"width":2,"height":2.4,"depth":0.1,"openingWidth":1,"openingHeight":0.8,"topCornerRadius":0.2}. Dimensions are metres. The rectangular opening is centered in the outer frame and topCornerRadius applies only to the two outer upper corners.',
    'For a deterministic parametric furniture carcass, return op createFurniture. Put the optional cabinet id in id, the target level id in parentId, and dataJson as {"name":"Wardrobe","position":[0,0,0],"rotationY":0,"furnitureKind":"wardrobe","dimensions":{"width":2.4,"height":2.4,"depth":0.6},"bayCount":2}. Dimensions are metres. This operation creates the same normalized FurnitureAssembly used by the direct cabinet panel.',
    'furnitureKind is one of wardrobe, base-run, upper-run, tall, island, set, sink, and each has its own real-world proportions. Omit dimensions to get the correct per-kind defaults, and only pass dimensions when the user asked for a specific size. Reference sizes in metres (width/height/depth): wardrobe 2.4/2.4/0.6, base-run 1.8/0.85/0.6, upper-run 1.8/0.72/0.35, tall 0.6/2.1/0.6, island 1.8/0.85/0.9, set 1.8/2.4/0.6, sink 0.9/0.85/0.6.',
    'upper-run is a wall-hung cabinet: it has no plinth and must not sit on the floor. Give it a position Y of about 1.5 metres (or the height the user asked for) instead of 0. Every other furnitureKind is floor-standing, so its position Y is 0. An island stands in the middle of the room rather than against a wall.',
    'For a furniture tier interior edit, return op setFurnitureTierInterior. Put the required cabinet node id in id and dataJson as {"bayId":"bay-0","tierId":"bay-0-tier-0","shelfCount":3,"hanger":true}. Use stable bayId and tierId values from the cabinet furniture assembly, shelfCount must be an integer from 0 to 8, and use the same operation for shelves and the hanger rod instead of rewriting the assembly.',
    'For furniture structure edits, use insertFurnitureBay/deleteFurnitureBay/resizeFurnitureBay or insertFurnitureTier/deleteFurnitureTier/resizeFurnitureTier with the cabinet node id in id. Bay dataJson examples are {"afterBayId":"bay-0","newWidth":0.4}, {"bayId":"bay-0-copy"}, and {"bayId":"bay-0","width":0.7}. Tier examples are {"bayId":"bay-0","afterTierId":"bay-0-tier-0","newHeight":0.8}, {"bayId":"bay-0","tierId":"bay-0-tier-0-copy"}, and {"bayId":"bay-0","tierId":"bay-0-tier-0","height":1.2}. Dimensions are metres; omit optional newWidth/newHeight to split the anchor equally. These operations preserve total furniture dimensions and compensate the adjacent bay or tier.',
    'Include only the fields that apply to each operation; when the output schema still requires a field that does not apply, set it to null.',
    'When the user refers to selected or current elements, use scene.selection as the exact target and hierarchy context.',
    'Use parentId only when that id exists in scene.nodes or is created earlier in the same plan. A stale selection levelId is not a valid parent. For createRoundedRectangularFrameBody, prefer a valid level parent; if none exists, omit parentId and the editor will attach the Body to the nearest existing structural container.',
    'Preserve node ids and semantic parent relationships. Do not change id or type in update patches.',
    'Do not run tools or modify files. Only return the requested structured modeling plan.',
    'If no scene mutation is needed, return an empty patches array and explain in message.',
    `nodeSchema below carries full schemas only for the node types relevant to this request and scene. Every node type that exists: ${listNodeTypeNames().join(', ')}. If the request needs a type whose schema is missing, build what the included types cover and name the missing type in message so the user can re-ask.`,
    'Open message with one sentence restating exactly what you are about to change — the target element, its location, and the key values — so the user can confirm the interpretation before applying the plan. Write message in the language the user wrote in.',
    'If the request is ambiguous, or it names an item, room, or material you cannot find in the scene, do not guess blindly and do not give up: return an empty patches array, say what you understood, list the closest matching elements that do exist in the scene, and ask the one concrete question you need answered to proceed.',
    'When several concrete interpretations exist, offer them as a short numbered list — "혹시 요청하신 것이 다음 중 하나인가요? 1. … 2. …" — so the user can answer with just the number. When the conversation shows you asked such a question and the user replied with a bare number or a short pick, resolve it against those exact options and return the plan; do not ask again.',
    'A request to design an example or typical layout from stated constraints (평형/㎡, room counts, orientation, entrance side) is fully actionable — never answer it with only a question. Pick sensible Korean apartment defaults for everything unstated, open message with the assumptions you chose, and build.',
    'A whole apartment or floor does not fit one plan comfortably. Deliver big builds in stages of roughly 30 patches or fewer: return the first coherent stage (for example exterior and interior walls), and end message by saying what the next stage is (바닥/천장/문 등) so the user applies this stage and replies to continue. Keep each nodeJson compact — only fields the schema requires or that differ from their defaults.',
    'The same staging applies when one request bundles several distinct jobs (for example 문 + 창문 + 가구 배치): complete the first job now, list the remaining jobs as numbered next stages in message, and continue as the user replies. A fast, correct first stage beats one slow answer that attempts everything.',
    'Never reply that you cannot produce a plan. Either return patches, or return empty patches with a specific clarifying question that lets the user re-issue an actionable instruction.',
    JSON.stringify({
      conversation,
      scene: input.scene,
      nodeSchema: buildAiSceneNodeSchema(selectRelevantNodeTypes(input)),
    }),
  ].join('\n')
}

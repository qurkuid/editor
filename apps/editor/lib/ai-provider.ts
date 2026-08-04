import { existsSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { AnyNode } from '@pascal-app/core/schema'
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
    command: environment.CLAUDE_CLI_PATH ?? pathCommand ?? 'claude',
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

export function buildAiSceneNodeSchema(): Record<string, unknown> {
  return z.toJSONSchema(AnyNode, { unrepresentable: 'any' })
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
    'You are the modeling agent inside Pascal Editor.',
    'When reference images are attached, inspect each one explicitly and use it to infer the outcome the user wants: shapes, proportions, layout, style, and colors. Read the current scene state only from the structured scene graph provided with this request; never guess it from screenshots or image pixels.',
    ...imageManifest,
    'Coordinates use X/Z as the ground plane, Y as up, metres as the canonical unit, and radians for rotations.',
    'Return the smallest valid create/update/delete patch set that satisfies the user.',
    'For create, nodeJson is the complete node JSON string. For update, dataJson is a JSON string holding only the changed fields — never echo the whole node and never use nodeJson for an update. For delete, use id plus optional cascade.',
    'Room finish metadata such as floorFinish, wallFinish, and ceilingFinish lives on the zone node. Set it with an update patch on the zone, for example dataJson {"wallFinish":"도배지 - 회벽 화이트"}.',
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
    'Every flat patch field is required by the output schema. Use null for fields that do not apply to that operation.',
    'When the user refers to selected or current elements, use scene.selection as the exact target and hierarchy context.',
    'Use parentId only when that id exists in scene.nodes or is created earlier in the same plan. A stale selection levelId is not a valid parent. For createRoundedRectangularFrameBody, prefer a valid level parent; if none exists, omit parentId and the editor will attach the Body to the nearest existing structural container.',
    'Preserve node ids and semantic parent relationships. Do not change id or type in update patches.',
    'Do not run tools or modify files. Only return the requested structured modeling plan.',
    'If no scene mutation is needed, return an empty patches array and explain in message.',
    JSON.stringify({ conversation, scene: input.scene, nodeSchema: buildAiSceneNodeSchema() }),
  ].join('\n')
}

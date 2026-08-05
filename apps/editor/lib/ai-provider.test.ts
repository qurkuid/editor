import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  AI_CHAT_MAX_IMAGE_BYTES,
  AI_CHAT_MAX_IMAGES,
  AiChatRequestSchema,
  buildAiModelingPrompt,
  buildAiSceneNodeSchema,
  parseClaudeLoginStatus,
  parseCodexLoginStatus,
  resolveAiProviderConfig,
  resolveClaudeCliConfig,
  selectRelevantNodeTypes,
} from './ai-provider'

describe('AI provider boundary', () => {
  test('uses the authenticated Codex CLI when no API key is configured', () => {
    expect(
      resolveAiProviderConfig({
        CODEX_CLI_PATH: '/opt/codex',
        PASCAL_CODEX_MODEL: 'configured-model',
      }),
    ).toEqual({
      command: '/opt/codex',
      model: 'configured-model',
    })
  })

  // This repo ships `@openai/codex` and `@anthropic-ai/claude-code` as app
  // dependencies, so without an explicit env override the bundled bin under
  // `node_modules/.bin` wins over PATH and runtime-sibling candidates.
  test('prefers the bundled Codex bin over PATH and the Node sibling', async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), 'pascal-codex-path-'))
    const command = join(directory, 'codex')
    await writeFile(command, '#!/bin/sh\n')

    try {
      // When
      const config = resolveAiProviderConfig({
        PATH: directory,
        PASCAL_NODE_EXEC_PATH: join(directory, 'node'),
      })

      // Then
      expect(config.command).toContain(join('node_modules', '.bin', 'codex'))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('recognizes a ChatGPT OAuth CLI session', () => {
    expect(parseCodexLoginStatus('Logged in using ChatGPT')).toEqual({
      connected: true,
      authMethod: 'chatgpt',
    })
  })

  test('prefers the bundled Claude bin over the server PATH', async () => {
    // Given
    const directory = await mkdtemp(join(tmpdir(), 'pascal-claude-path-'))
    const command = join(directory, 'claude')
    await writeFile(command, '#!/bin/sh\n')

    try {
      // When
      const config = resolveClaudeCliConfig({ PATH: directory })

      // Then
      expect(config.command).toContain(join('node_modules', '.bin', 'claude'))
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('prefers an explicit CLAUDE_CLI_PATH override', () => {
    expect(
      resolveClaudeCliConfig({ CLAUDE_CLI_PATH: '/opt/claude', PASCAL_CLAUDE_MODEL: 'sonnet' }),
    ).toEqual({
      command: '/opt/claude',
      model: 'sonnet',
    })
  })

  test('recognizes an authenticated Claude CLI session from `claude auth status --json`', () => {
    expect(
      parseClaudeLoginStatus(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai' })),
    ).toEqual({
      connected: true,
      authMethod: 'claude.ai',
    })
  })

  test('does not report a Claude CLI session as connected unless loggedIn is true', () => {
    expect(parseClaudeLoginStatus(JSON.stringify({ loggedIn: false }))).toEqual({
      connected: false,
      authMethod: null,
    })
    expect(parseClaudeLoginStatus('not json')).toEqual({ connected: false, authMethod: null })
  })

  test('validates supported image data URLs, count, and decoded byte size', () => {
    const image = {
      name: 'room.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,aGVsbG8=',
    }
    const request = {
      messages: [{ role: 'user' as const, content: 'Use these references' }],
      images: [image],
      scene: {
        coordinateSystem: { groundPlane: 'XZ' as const, upAxis: 'Y' as const, unit: 'm' as const },
        nodeCount: 0,
        nodes: {},
        rootNodeIds: [],
        materials: {},
        selection: {
          buildingId: null,
          levelId: null,
          zoneId: null,
          selectedIds: [],
          selectedNodes: [],
        },
      },
    }

    expect(AiChatRequestSchema.parse(request).images).toEqual([image])
    expect(() =>
      AiChatRequestSchema.parse({
        ...request,
        images: [{ ...image, mimeType: 'image/jpeg' }],
      }),
    ).toThrow()
    expect(() =>
      AiChatRequestSchema.parse({
        ...request,
        images: [
          {
            ...image,
            dataUrl: `data:image/png;base64,${Buffer.alloc(AI_CHAT_MAX_IMAGE_BYTES + 1).toString('base64')}`,
          },
        ],
      }),
    ).toThrow()
    expect(() =>
      AiChatRequestSchema.parse({
        ...request,
        images: Array.from({ length: AI_CHAT_MAX_IMAGES + 1 }, (_, index) => ({
          ...image,
          name: `room-${index}.png`,
        })),
      }),
    ).toThrow()
  })

  test('serializes transformed node schemas for the model context', () => {
    expect(() => buildAiSceneNodeSchema()).not.toThrow()
  })

  test('scopes the node schema to core types, scene types, and keyword matches', () => {
    const baseRequest = AiChatRequestSchema.parse({
      messages: [{ role: 'user', content: '벽 색 바꿔줘' }],
      scene: {
        coordinateSystem: { groundPlane: 'XZ', upAxis: 'Y', unit: 'm' },
        nodeCount: 1,
        nodes: { stair_1: { id: 'stair_1', type: 'stair' } },
        rootNodeIds: [],
        materials: {},
        selection: {
          buildingId: null,
          levelId: null,
          zoneId: null,
          selectedIds: [],
          selectedNodes: [],
        },
      },
    })

    const selected = selectRelevantNodeTypes(baseRequest)
    expect(selected.has('wall')).toBe(true)
    expect(selected.has('zone')).toBe(true)
    expect(selected.has('stair')).toBe(true) // present in the scene
    expect(selected.has('roof')).toBe(false) // no roof anywhere in the request

    const keyworded = selectRelevantNodeTypes(
      AiChatRequestSchema.parse({
        ...baseRequest,
        messages: [{ role: 'user', content: '지붕 올려줘' }],
      }),
    )
    expect(keyworded.has('roof')).toBe(true)

    const scoped = JSON.stringify(buildAiSceneNodeSchema(selected))
    const full = JSON.stringify(buildAiSceneNodeSchema())
    expect(scoped.length).toBeLessThan(full.length / 2)
  })

  test('the prompt names every node type even when its schema is scoped out', () => {
    const request = AiChatRequestSchema.parse({
      messages: [{ role: 'user', content: '벽 만들어' }],
      scene: {
        coordinateSystem: { groundPlane: 'XZ', upAxis: 'Y', unit: 'm' },
        nodeCount: 0,
        nodes: {},
        rootNodeIds: [],
        materials: {},
        selection: {
          buildingId: null,
          levelId: null,
          zoneId: null,
          selectedIds: [],
          selectedNodes: [],
        },
      },
    })
    const prompt = buildAiModelingPrompt(request)
    expect(prompt).toContain('Every node type that exists:')
    expect(prompt).toContain('stair')
  })

  test('defaults the request provider to codex and accepts an explicit claude selection', () => {
    const baseRequest = {
      messages: [{ role: 'user' as const, content: 'Create a wall' }],
      scene: {
        coordinateSystem: { groundPlane: 'XZ' as const, upAxis: 'Y' as const, unit: 'm' as const },
        nodeCount: 0,
        nodes: {},
        rootNodeIds: [],
        materials: {},
        selection: {
          buildingId: null,
          levelId: null,
          zoneId: null,
          selectedIds: [],
          selectedNodes: [],
        },
      },
    }

    expect(AiChatRequestSchema.parse(baseRequest).provider).toBe('codex')
    expect(AiChatRequestSchema.parse({ ...baseRequest, provider: 'claude' }).provider).toBe(
      'claude',
    )
    expect(() => AiChatRequestSchema.parse({ ...baseRequest, provider: 'gemini' })).toThrow()
  })

  test('gives the CLI structured scene data instead of viewport pixels', () => {
    const request = AiChatRequestSchema.parse({
      messages: [{ role: 'user', content: 'Create a wall' }],
      images: [
        {
          name: 'reference.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,aGVsbG8=',
        },
      ],
      scene: {
        coordinateSystem: { groundPlane: 'XZ', upAxis: 'Y', unit: 'm' },
        nodeCount: 1,
        nodes: { level_1: { id: 'level_1', type: 'level' } },
        rootNodeIds: ['level_1'],
        materials: {},
        selection: {
          buildingId: null,
          levelId: 'level_1',
          zoneId: null,
          selectedIds: ['wall_1'],
          selectedNodes: [{ id: 'wall_1', type: 'wall' }],
        },
      },
    })
    const prompt = buildAiModelingPrompt(request)

    expect(prompt).toContain('never guess it from screenshots or image pixels')
    expect(prompt).toContain('createRoundedRectangularFrameBody')
    expect(prompt).toContain('createFurniture')
    expect(prompt).toContain('setFurnitureTierInterior')
    expect(prompt).toContain('insertFurnitureBay')
    expect(prompt).toContain('resizeFurnitureTier')
    expect(prompt).toContain('stable bayId and tierId')
    expect(prompt).toContain('structural stages')
    expect(prompt).toContain('propose the alternatives with a recommendation')
    expect(prompt).toContain('fully actionable')
    expect(prompt).toContain('bundles several distinct jobs')
    expect(prompt).toContain('stages of roughly 30 patches')
    expect(prompt).toContain('answer with just the number')
    expect(prompt).toContain('trace the exterior boundary')
    expect(prompt).toContain('Never reply that you cannot produce a plan')
    expect(prompt).toContain('restating exactly what you are about to change')
    expect(prompt).toContain('A stale selection levelId is not a valid parent')
    expect(prompt).toContain('"nodeCount":1')
    expect(prompt).toContain('"selectedIds":["wall_1"]')
    expect(prompt).toContain('Create a wall')
    expect(prompt).toContain('Attached reference images:\n1. reference.png (image/png)')
    expect(prompt).toContain('Inspect each one before proposing a plan')
    expect(prompt).not.toContain('aGVsbG8=')
  })

  test('instructs dimension-driven floor-plan extraction instead of eyeballing', () => {
    const request = AiChatRequestSchema.parse({
      messages: [{ role: 'user', content: '도면대로 벽 세워줘' }],
      images: [
        {
          name: 'plan.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,aGVsbG8=',
        },
      ],
      scene: {
        coordinateSystem: { groundPlane: 'XZ', upAxis: 'Y', unit: 'm' },
        nodeCount: 0,
        nodes: {},
        rootNodeIds: [],
        materials: {},
        selection: {
          buildingId: null,
          levelId: null,
          zoneId: null,
          selectedIds: [],
          selectedNodes: [],
        },
      },
    })
    const prompt = buildAiModelingPrompt(request)

    expect(prompt).toContain('trace the exterior boundary')
    expect(prompt).toContain('dimension chains')
    expect(prompt).toContain('centreline')
    expect(prompt).toContain('half-thickness gaps')
    expect(prompt).toContain('never add walls or openings the drawing does not show')
    expect(prompt).toContain('assume a wall height of 2.42')
  })

  test('numbers every attached reference image with its filename and MIME type', () => {
    const request = AiChatRequestSchema.parse({
      messages: [{ role: 'user', content: 'Match these references' }],
      images: [
        {
          name: 'kitchen-sketch.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,aGVsbG8=',
        },
        {
          name: 'mood-board.jpg',
          mimeType: 'image/jpeg',
          dataUrl: 'data:image/jpeg;base64,d29ybGQ=',
        },
      ],
      scene: {
        coordinateSystem: { groundPlane: 'XZ', upAxis: 'Y', unit: 'm' },
        nodeCount: 0,
        nodes: {},
        rootNodeIds: [],
        materials: {},
        selection: {
          buildingId: null,
          levelId: null,
          zoneId: null,
          selectedIds: [],
          selectedNodes: [],
        },
      },
    })
    const prompt = buildAiModelingPrompt(request)

    expect(prompt).toContain('1. kitchen-sketch.png (image/png)')
    expect(prompt).toContain('2. mood-board.jpg (image/jpeg)')
    expect(prompt).not.toContain('aGVsbG8=')
    expect(prompt).not.toContain('d29ybGQ=')
  })

  test('omits the reference image manifest when no images are attached', () => {
    const request = AiChatRequestSchema.parse({
      messages: [{ role: 'user', content: 'Create a wall' }],
      scene: {
        coordinateSystem: { groundPlane: 'XZ', upAxis: 'Y', unit: 'm' },
        nodeCount: 0,
        nodes: {},
        rootNodeIds: [],
        materials: {},
        selection: {
          buildingId: null,
          levelId: null,
          zoneId: null,
          selectedIds: [],
          selectedNodes: [],
        },
      },
    })
    const prompt = buildAiModelingPrompt(request)

    expect(prompt).toContain('never guess it from screenshots or image pixels')
    expect(prompt).not.toContain('Attached reference images:')
    expect(prompt).not.toContain('Inspect each one before proposing a plan')
  })
})

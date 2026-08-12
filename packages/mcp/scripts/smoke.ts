/**
 * End-to-end smoke test for @pascal-app/mcp.
 *
 * Spawns the compiled stdio binary as a child process, connects as an MCP
 * client, and exercises a handful of representative tools. This test requires
 * the package to be built first (`bun run build`) — the compiled bin is what
 * `package.json`'s `bin` entry ships to users.
 *
 * Run with: bun run scripts/smoke.ts
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { createRectangleBody, getBodySemanticHash } from '@pascal-app/core'
import {
  executeImprintBodyFace,
  executeOffsetBodyFace,
  executePaintBodyFace,
  executePushPullBodyFace,
  executeSweepBodyFace,
  executeTransformBody,
  MODELING_OPERATION_IDS,
} from '@pascal-app/core/modeling-operations'
import { BodyNode, SceneMaterial, WallNode, WindowNode } from '@pascal-app/core/schema'
import { z } from 'zod'
import { SqliteSceneStore } from '../src/storage/sqlite-scene-store'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const BIN_PATH = resolve(__dirname, '../dist/bin/pascal-mcp.js')

async function main(): Promise<void> {
  if (!existsSync(BIN_PATH)) {
    console.error(`[smoke] bin not found at ${BIN_PATH}`)
    console.error('[smoke] run `bun run build` first')
    process.exit(1)
  }

  const smokeDataDir = mkdtempSync(join(tmpdir(), 'pascal-mcp-smoke-'))
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN_PATH, '--stdio'],
    env: { ...getDefaultEnvironment(), PASCAL_DATA_DIR: smokeDataDir },
    stderr: 'inherit',
  })
  const client = new Client({ name: 'pascal-mcp-smoke', version: '0.0.0' })

  try {
    await client.connect(transport)

    const tools = await client.listTools()
    console.log(`[smoke] tools registered: ${tools.tools.length}`)
    if (tools.tools.length === 0) {
      throw new Error('no tools registered')
    }
    const toolNames = new Set(tools.tools.map((tool) => tool.name))
    for (const toolName of ['preflight_modeling_operation', 'commit_modeling_operation']) {
      if (!toolNames.has(toolName))
        throw new Error(`required modeling tool is missing: ${toolName}`)
    }

    const getScene = await client.callTool({ name: 'get_scene', arguments: {} })
    if (getScene.isError) {
      throw new Error(`get_scene failed: ${JSON.stringify(getScene)}`)
    }
    console.log('[smoke] get_scene: OK')

    const modelingOperations = await client.readResource({
      uri: 'pascal://modeling/operations',
    })
    const modelingOperationsContent = modelingOperations.contents[0]
    if (!modelingOperationsContent || !('text' in modelingOperationsContent)) {
      throw new TypeError('modeling operation manifest did not return text content')
    }
    const manifestJson: unknown = JSON.parse(modelingOperationsContent.text)
    const manifest = z
      .object({
        operations: z.array(
          z.object({
            id: z.string(),
            input: z.object({ fields: z.record(z.string(), z.unknown()) }).optional(),
          }),
        ),
      })
      .parse(manifestJson)
    if (!manifest.operations.some(({ id }) => id === MODELING_OPERATION_IDS.pushPullBodyFace)) {
      throw new RangeError('pushPullBodyFace is missing from the modeling operation manifest')
    }
    if (!manifest.operations.some(({ id }) => id === MODELING_OPERATION_IDS.offsetBodyFace)) {
      throw new RangeError('offsetBodyFace is missing from the modeling operation manifest')
    }
    if (!manifest.operations.some(({ id }) => id === MODELING_OPERATION_IDS.sweepBodyFace)) {
      throw new RangeError('sweepBodyFace is missing from the modeling operation manifest')
    }
    const transformManifest = manifest.operations.find(
      ({ id }) => id === MODELING_OPERATION_IDS.transformBody,
    )
    const transformFields = Object.keys(
      (transformManifest as { input?: { fields?: Record<string, unknown> } } | undefined)?.input
        ?.fields ?? {},
    )
    if (
      !transformManifest ||
      !['translation', 'rotationAxis', 'rotationAngle', 'scale', 'pivot'].every((field) =>
        transformFields.includes(field),
      ) ||
      transformFields.some((field) => field === 'rotationY' || field === 'uniformScale')
    ) {
      throw new RangeError('transformBody manifest does not expose the canonical affine fields')
    }
    console.log('[smoke] modeling operation manifest: OK')

    const createProject = await client.callTool({
      name: 'create_project',
      arguments: { name: 'MCP modeling smoke', id: 'mcp-modeling-smoke' },
    })
    if (createProject.isError) {
      throw new Error(`failed to create modeling smoke project: ${JSON.stringify(createProject)}`)
    }

    const sourceBody = BodyNode.parse({
      ...createRectangleBody({ width: 1.2, depth: 0.8 }),
      id: 'body_smoke_modeling',
    })
    const createBody = await client.callTool({
      name: 'apply_patch',
      arguments: { patches: [{ op: 'create', node: sourceBody }] },
    })
    if (createBody.isError) {
      throw new Error(`failed to seed modeling smoke body: ${JSON.stringify(createBody)}`)
    }

    const imprintSourceBody = BodyNode.parse({
      ...executePushPullBodyFace(sourceBody, { faceId: 'face:0', distance: 1 }).body,
      id: 'body_smoke_imprint',
    })
    const createImprintBody = await client.callTool({
      name: 'apply_patch',
      arguments: { patches: [{ op: 'create', node: imprintSourceBody }] },
    })
    if (createImprintBody.isError) {
      throw new Error(`failed to seed imprint smoke body: ${JSON.stringify(createImprintBody)}`)
    }

    const offsetSourceBody = BodyNode.parse({
      ...executePushPullBodyFace(sourceBody, { faceId: 'face:0', distance: 1 }).body,
      id: 'body_smoke_offset',
    })
    const createOffsetBody = await client.callTool({
      name: 'apply_patch',
      arguments: { patches: [{ op: 'create', node: offsetSourceBody }] },
    })
    if (createOffsetBody.isError) {
      throw new Error(`failed to seed offset smoke body: ${JSON.stringify(createOffsetBody)}`)
    }
    const nestedSourceBody = BodyNode.parse({
      ...executeOffsetBodyFace(offsetSourceBody, { faceId: 'face:0', distance: -0.3 }).body,
      id: 'body_smoke_nested',
    })
    const createNestedBody = await client.callTool({
      name: 'apply_patch',
      arguments: { patches: [{ op: 'create', node: nestedSourceBody }] },
    })
    if (createNestedBody.isError) {
      throw new Error(
        `failed to seed nested offset smoke body: ${JSON.stringify(createNestedBody)}`,
      )
    }

    const operationInput = { faceId: 'face:0', distance: 1 }
    const expected = executePushPullBodyFace(sourceBody, operationInput)
    const preflight = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.pushPullBodyFace,
        nodeId: sourceBody.id,
        input: operationInput,
      },
    })
    const preflightContent = preflight.content[0]
    if (preflight.isError || preflightContent?.type !== 'text') {
      throw new TypeError('preflight_modeling_operation did not return structured text content')
    }
    const preflightJson: unknown = JSON.parse(preflightContent.text)
    const preflightPayload = z
      .object({
        valid: z.literal(true),
        preview: z.object({ body: z.record(z.string(), z.unknown()) }),
      })
      .parse(preflightJson)
    const previewBody = BodyNode.parse(preflightPayload.preview.body)
    if (getBodySemanticHash(previewBody) !== getBodySemanticHash(expected.body)) {
      throw new RangeError('preflight_modeling_operation diverged from the canonical executor')
    }
    console.log('[smoke] Push/Pull preflight: OK')

    const commit = await client.callTool({
      name: 'commit_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.pushPullBodyFace,
        nodeId: sourceBody.id,
        input: operationInput,
      },
    })
    const commitContent = commit.content[0]
    if (commit.isError || commitContent?.type !== 'text') {
      throw new TypeError('commit_modeling_operation did not return structured text content')
    }
    const commitPayload = z
      .object({
        success: z.literal(true),
        historySteps: z.literal(1),
        result: z.object({ body: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(commitContent.text))
    const committedBody = BodyNode.parse(commitPayload.result.body)
    if (getBodySemanticHash(committedBody) !== getBodySemanticHash(expected.body)) {
      throw new RangeError('commit_modeling_operation diverged from the canonical executor')
    }
    console.log('[smoke] Push/Pull commit: OK')

    const undoCommit = await client.callTool({ name: 'undo', arguments: {} })
    if (undoCommit.isError) throw new Error(`Push/Pull undo failed: ${JSON.stringify(undoCommit)}`)
    const restored = await client.callTool({
      name: 'get_node',
      arguments: { id: sourceBody.id },
    })
    const restoredContent = restored.content[0]
    if (restored.isError || restoredContent?.type !== 'text') {
      throw new TypeError('get_node did not return the restored Body')
    }
    const restoredPayload = z
      .object({ node: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(restoredContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(restoredPayload.node)) !== getBodySemanticHash(sourceBody)
    ) {
      throw new RangeError('Push/Pull undo did not restore the source Body')
    }
    console.log('[smoke] Push/Pull undo: OK')

    const offsetInput = { faceId: 'face:0', distance: -0.25 }
    const expectedOffset = executeOffsetBodyFace(offsetSourceBody, offsetInput)
    const offsetPreflight = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.offsetBodyFace,
        nodeId: offsetSourceBody.id,
        input: offsetInput,
      },
    })
    const offsetPreflightContent = offsetPreflight.content[0]
    if (offsetPreflight.isError || offsetPreflightContent?.type !== 'text') {
      throw new TypeError('offsetBodyFace preflight did not return structured text content')
    }
    const offsetPreview = z
      .object({
        valid: z.literal(true),
        preview: z.object({ body: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(offsetPreflightContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(offsetPreview.preview.body)) !==
      getBodySemanticHash(expectedOffset.body)
    ) {
      throw new RangeError('offsetBodyFace preflight diverged from the canonical executor')
    }
    console.log('[smoke] Offset preflight: OK')

    const offsetCommit = await client.callTool({
      name: 'commit_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.offsetBodyFace,
        nodeId: offsetSourceBody.id,
        input: offsetInput,
      },
    })
    const offsetCommitContent = offsetCommit.content[0]
    if (offsetCommit.isError || offsetCommitContent?.type !== 'text') {
      throw new TypeError('offsetBodyFace commit did not return structured text content')
    }
    const offsetResult = z
      .object({
        success: z.literal(true),
        historySteps: z.literal(1),
        result: z.object({ body: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(offsetCommitContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(offsetResult.result.body)) !==
      getBodySemanticHash(expectedOffset.body)
    ) {
      throw new RangeError('offsetBodyFace commit diverged from the canonical executor')
    }
    console.log('[smoke] Offset commit: OK')

    const committedOffsetNode = await client.callTool({
      name: 'get_node',
      arguments: { id: offsetSourceBody.id },
    })
    const committedOffsetContent = committedOffsetNode.content[0]
    if (committedOffsetNode.isError || committedOffsetContent?.type !== 'text') {
      throw new TypeError('get_node did not return the committed Offset Body')
    }
    const committedOffsetPayload = z
      .object({ node: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(committedOffsetContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(committedOffsetPayload.node)) !==
      getBodySemanticHash(expectedOffset.body)
    ) {
      throw new RangeError('get_node returned a divergent committed Offset Body')
    }
    console.log('[smoke] Offset get node/hash: OK')

    const validateOffset = await client.callTool({ name: 'validate_scene', arguments: {} })
    const validateOffsetContent = validateOffset.content[0]
    if (validateOffset.isError || validateOffsetContent?.type !== 'text') {
      throw new TypeError('validate_scene failed after Offset commit')
    }
    const validateOffsetPayload = z
      .object({ valid: z.literal(true), errors: z.array(z.unknown()) })
      .parse(JSON.parse(validateOffsetContent.text))
    if (validateOffsetPayload.errors.length !== 0) {
      throw new RangeError('validate_scene reported errors after Offset commit')
    }
    console.log('[smoke] Offset validate: OK')

    const offsetStore = new SqliteSceneStore({ databasePath: join(smokeDataDir, 'pascal.db') })
    try {
      const persisted = await offsetStore.load('mcp-modeling-smoke')
      const events = await offsetStore.listSceneEvents('mcp-modeling-smoke')
      const offsetEvent = events.filter(({ kind }) => kind === 'commit_modeling_operation').at(-1)
      if (!persisted || !offsetEvent) {
        throw new RangeError('Offset commit did not reach SQLite and the scene event stream')
      }
      if (
        getBodySemanticHash(BodyNode.parse(persisted.graph.nodes[offsetSourceBody.id])) !==
          getBodySemanticHash(expectedOffset.body) ||
        getBodySemanticHash(BodyNode.parse(offsetEvent.graph.nodes[offsetSourceBody.id])) !==
          getBodySemanticHash(expectedOffset.body)
      ) {
        throw new RangeError('persisted Offset graph or scene event diverged from the commit')
      }
    } finally {
      offsetStore.close()
    }
    console.log('[smoke] Offset SQLite persistence/event: OK')

    const undoOffset = await client.callTool({ name: 'undo', arguments: {} })
    if (undoOffset.isError)
      throw new Error(`offsetBodyFace undo failed: ${JSON.stringify(undoOffset)}`)
    const restoredOffset = await client.callTool({
      name: 'get_node',
      arguments: { id: offsetSourceBody.id },
    })
    const restoredOffsetContent = restoredOffset.content[0]
    if (restoredOffset.isError || restoredOffsetContent?.type !== 'text') {
      throw new TypeError('get_node did not return the Body after offset undo')
    }
    const restoredOffsetPayload = z
      .object({ node: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(restoredOffsetContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(restoredOffsetPayload.node)) !==
      getBodySemanticHash(offsetSourceBody)
    ) {
      throw new RangeError('offsetBodyFace undo did not restore the source Body')
    }
    console.log('[smoke] Offset undo: OK')

    const nestedOffsetInput = { faceId: 'face:0:offset:2', distance: 0.1 }
    const expectedNestedOffset = executeOffsetBodyFace(nestedSourceBody, nestedOffsetInput)
    const nestedPreflight = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.offsetBodyFace,
        nodeId: nestedSourceBody.id,
        input: nestedOffsetInput,
      },
    })
    const nestedPreflightContent = nestedPreflight.content[0]
    if (nestedPreflight.isError || nestedPreflightContent?.type !== 'text') {
      throw new TypeError('nested offsetBodyFace preflight did not return structured text content')
    }
    const nestedPreview = z
      .object({
        valid: z.literal(true),
        preview: z.object({ body: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(nestedPreflightContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(nestedPreview.preview.body)) !==
      getBodySemanticHash(expectedNestedOffset.body)
    ) {
      throw new RangeError('nested offsetBodyFace preflight diverged from the canonical executor')
    }
    console.log('[smoke] Nested outward preflight: OK')

    const nestedCommit = await client.callTool({
      name: 'commit_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.offsetBodyFace,
        nodeId: nestedSourceBody.id,
        input: nestedOffsetInput,
      },
    })
    const nestedCommitContent = nestedCommit.content[0]
    if (nestedCommit.isError || nestedCommitContent?.type !== 'text') {
      throw new TypeError('nested offsetBodyFace commit did not return structured text content')
    }
    const nestedResult = z
      .object({
        success: z.literal(true),
        historySteps: z.literal(1),
        result: z.object({ body: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(nestedCommitContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(nestedResult.result.body)) !==
      getBodySemanticHash(expectedNestedOffset.body)
    ) {
      throw new RangeError('nested offsetBodyFace commit diverged from the canonical executor')
    }
    console.log('[smoke] Nested outward commit: OK')

    const committedNestedNode = await client.callTool({
      name: 'get_node',
      arguments: { id: nestedSourceBody.id },
    })
    const committedNestedContent = committedNestedNode.content[0]
    if (committedNestedNode.isError || committedNestedContent?.type !== 'text') {
      throw new TypeError('get_node did not return the committed nested outward Body')
    }
    const committedNestedPayload = z
      .object({ node: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(committedNestedContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(committedNestedPayload.node)) !==
      getBodySemanticHash(expectedNestedOffset.body)
    ) {
      throw new RangeError('get_node returned a divergent nested outward Body')
    }
    console.log('[smoke] Nested outward get node/hash: OK')

    const validateNested = await client.callTool({ name: 'validate_scene', arguments: {} })
    const validateNestedContent = validateNested.content[0]
    if (validateNested.isError || validateNestedContent?.type !== 'text') {
      throw new TypeError('validate_scene failed after nested outward commit')
    }
    z.object({ valid: z.literal(true), errors: z.array(z.unknown()).length(0) }).parse(
      JSON.parse(validateNestedContent.text),
    )
    console.log('[smoke] Nested outward validate: OK')

    const nestedStore = new SqliteSceneStore({ databasePath: join(smokeDataDir, 'pascal.db') })
    try {
      const persisted = await nestedStore.load('mcp-modeling-smoke')
      const events = await nestedStore.listSceneEvents('mcp-modeling-smoke')
      const nestedEvent = events.filter(({ kind }) => kind === 'commit_modeling_operation').at(-1)
      if (!persisted || !nestedEvent) {
        throw new RangeError('nested outward commit did not reach SQLite and the event stream')
      }
      if (
        getBodySemanticHash(BodyNode.parse(persisted.graph.nodes[nestedSourceBody.id])) !==
          getBodySemanticHash(expectedNestedOffset.body) ||
        getBodySemanticHash(BodyNode.parse(nestedEvent.graph.nodes[nestedSourceBody.id])) !==
          getBodySemanticHash(expectedNestedOffset.body)
      ) {
        throw new RangeError('persisted nested outward graph or event diverged from the commit')
      }
    } finally {
      nestedStore.close()
    }
    console.log('[smoke] Nested outward SQLite persistence/event: OK')

    const undoNested = await client.callTool({ name: 'undo', arguments: {} })
    if (undoNested.isError)
      throw new Error(`nested offsetBodyFace undo failed: ${JSON.stringify(undoNested)}`)
    const restoredNested = await client.callTool({
      name: 'get_node',
      arguments: { id: nestedSourceBody.id },
    })
    const restoredNestedContent = restoredNested.content[0]
    if (restoredNested.isError || restoredNestedContent?.type !== 'text') {
      throw new TypeError('get_node did not return the Body after nested offset undo')
    }
    const restoredNestedPayload = z
      .object({ node: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(restoredNestedContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(restoredNestedPayload.node)) !==
      getBodySemanticHash(nestedSourceBody)
    ) {
      throw new RangeError('nested offsetBodyFace undo did not restore the source Body')
    }
    console.log('[smoke] Nested outward undo: OK')

    const transformInput = {
      translation: [0.2, 0.3, -0.1] as const,
      rotationAxis: [1, 2, 3] as const,
      rotationAngle: 0.25,
      scale: [1.1, 0.9, 1.2] as const,
      pivot: [0.1, 0.2, 0.3] as const,
    }
    const expectedTransform = executeTransformBody(sourceBody, transformInput)
    const transformPreflight = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.transformBody,
        nodeId: sourceBody.id,
        input: transformInput,
      },
    })
    const transformPreflightContent = transformPreflight.content[0]
    if (transformPreflight.isError || transformPreflightContent?.type !== 'text') {
      throw new TypeError('transformBody preflight did not return structured text content')
    }
    const transformPreview = z
      .object({
        valid: z.literal(true),
        preview: z.object({ body: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(transformPreflightContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(transformPreview.preview.body)) !==
      getBodySemanticHash(expectedTransform.body)
    ) {
      throw new RangeError('transformBody preflight diverged from the canonical executor')
    }
    console.log('[smoke] transformBody preflight: OK')

    const transformCommit = await client.callTool({
      name: 'commit_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.transformBody,
        nodeId: sourceBody.id,
        input: transformInput,
      },
    })
    const transformCommitContent = transformCommit.content[0]
    if (transformCommit.isError || transformCommitContent?.type !== 'text') {
      throw new TypeError('transformBody commit did not return structured text content')
    }
    const transformResult = z
      .object({
        success: z.literal(true),
        historySteps: z.literal(1),
        result: z.object({ body: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(transformCommitContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(transformResult.result.body)) !==
      getBodySemanticHash(expectedTransform.body)
    ) {
      throw new RangeError('transformBody commit diverged from the canonical executor')
    }
    console.log('[smoke] transformBody commit: OK')

    const undoTransform = await client.callTool({ name: 'undo', arguments: {} })
    if (undoTransform.isError)
      throw new Error(`transformBody undo failed: ${JSON.stringify(undoTransform)}`)
    const restoredTransform = await client.callTool({
      name: 'get_node',
      arguments: { id: sourceBody.id },
    })
    const restoredTransformContent = restoredTransform.content[0]
    if (restoredTransform.isError || restoredTransformContent?.type !== 'text') {
      throw new TypeError('get_node did not return the Body after transform undo')
    }
    const restoredTransformPayload = z
      .object({ node: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(restoredTransformContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(restoredTransformPayload.node)) !==
      getBodySemanticHash(sourceBody)
    ) {
      throw new RangeError('transformBody undo did not restore the source Body')
    }
    console.log('[smoke] transformBody undo: OK')

    const imprintInput = {
      faceId: 'face:0',
      profilePoints: [
        [0.3, 1, 0.3],
        [0.9, 1, 0.3],
        [0.9, 1, 0.7],
        [0.3, 1, 0.7],
      ] as const,
      distance: 0.15,
    }
    const expectedImprint = executeImprintBodyFace(imprintSourceBody, imprintInput)
    const imprintPreflight = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.imprintBodyFace,
        nodeId: imprintSourceBody.id,
        input: imprintInput,
      },
    })
    const imprintPreflightContent = imprintPreflight.content[0]
    if (imprintPreflight.isError || imprintPreflightContent?.type !== 'text') {
      throw new TypeError('imprintBodyFace preflight did not return structured text content')
    }
    const imprintPreview = z
      .object({
        valid: z.literal(true),
        preview: z.object({ body: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(imprintPreflightContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(imprintPreview.preview.body)) !==
      getBodySemanticHash(expectedImprint.body)
    ) {
      throw new RangeError('imprintBodyFace preflight diverged from the canonical executor')
    }
    const imprintCommit = await client.callTool({
      name: 'commit_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.imprintBodyFace,
        nodeId: imprintSourceBody.id,
        input: imprintInput,
      },
    })
    const imprintCommitContent = imprintCommit.content[0]
    if (imprintCommit.isError || imprintCommitContent?.type !== 'text') {
      throw new TypeError('imprintBodyFace commit did not return structured text content')
    }
    const imprintResult = z
      .object({
        success: z.literal(true),
        historySteps: z.literal(1),
        result: z.object({ body: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(imprintCommitContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(imprintResult.result.body)) !==
      getBodySemanticHash(expectedImprint.body)
    ) {
      throw new RangeError('imprintBodyFace commit diverged from the canonical executor')
    }
    const undoImprint = await client.callTool({ name: 'undo', arguments: {} })
    if (undoImprint.isError)
      throw new Error(`imprintBodyFace undo failed: ${JSON.stringify(undoImprint)}`)
    console.log('[smoke] Imprint preflight/commit/undo: OK')

    const paintMaterial = SceneMaterial.parse({
      id: 'mat_smoke_paint',
      name: 'Smoke red',
      material: { preset: 'custom', properties: { color: '#b91c1c', roughness: 0.85 } },
    })
    const paintInput = { faceId: 'face:0', material: paintMaterial }
    const expectedPaint = executePaintBodyFace(sourceBody, paintInput)
    const paintPreflight = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.paintBodyFace,
        nodeId: sourceBody.id,
        input: paintInput,
      },
    })
    const paintPreflightContent = paintPreflight.content[0]
    if (paintPreflight.isError || paintPreflightContent?.type !== 'text') {
      throw new TypeError('paintBodyFace preflight did not return structured text content')
    }
    const paintPreview = z
      .object({
        valid: z.literal(true),
        preview: z.object({ body: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(paintPreflightContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(paintPreview.preview.body)) !==
      getBodySemanticHash(expectedPaint.body)
    ) {
      throw new RangeError('paintBodyFace preflight diverged from the canonical executor')
    }
    const paintCommit = await client.callTool({
      name: 'commit_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.paintBodyFace,
        nodeId: sourceBody.id,
        input: paintInput,
      },
    })
    const paintCommitContent = paintCommit.content[0]
    if (paintCommit.isError || paintCommitContent?.type !== 'text') {
      throw new TypeError('paintBodyFace commit did not return structured text content')
    }
    const paintResult = z
      .object({
        success: z.literal(true),
        historySteps: z.literal(1),
        result: z.object({ body: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(paintCommitContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(paintResult.result.body)) !==
      getBodySemanticHash(expectedPaint.body)
    ) {
      throw new RangeError('paintBodyFace commit diverged from the canonical executor')
    }
    const undoPaint = await client.callTool({ name: 'undo', arguments: {} })
    if (undoPaint.isError)
      throw new Error(`paintBodyFace undo failed: ${JSON.stringify(undoPaint)}`)
    console.log('[smoke] Paint preflight/commit/undo: OK')

    const sweepInput = {
      faceId: 'face:0',
      pathPoints: [
        [0, 0, 0],
        [0, 1, 0],
        [0, 1, 1],
      ] as const,
    }
    const expectedSweep = executeSweepBodyFace(sourceBody, sweepInput)
    const sweepPreflight = await client.callTool({
      name: 'preflight_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.sweepBodyFace,
        nodeId: sourceBody.id,
        input: sweepInput,
      },
    })
    const sweepPreflightContent = sweepPreflight.content[0]
    if (sweepPreflight.isError || sweepPreflightContent?.type !== 'text') {
      throw new TypeError('sweepBodyFace preflight did not return structured text content')
    }
    const sweepPreview = z
      .object({
        valid: z.literal(true),
        preview: z.object({ body: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(sweepPreflightContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(sweepPreview.preview.body)) !==
      getBodySemanticHash(expectedSweep.body)
    ) {
      throw new RangeError('sweepBodyFace preflight diverged from the canonical executor')
    }
    const sweepCommit = await client.callTool({
      name: 'commit_modeling_operation',
      arguments: {
        operationId: MODELING_OPERATION_IDS.sweepBodyFace,
        nodeId: sourceBody.id,
        input: sweepInput,
      },
    })
    const sweepCommitContent = sweepCommit.content[0]
    if (sweepCommit.isError || sweepCommitContent?.type !== 'text') {
      throw new TypeError('sweepBodyFace commit did not return structured text content')
    }
    const sweepResult = z
      .object({
        success: z.literal(true),
        historySteps: z.literal(1),
        result: z.object({ body: z.record(z.string(), z.unknown()) }),
      })
      .parse(JSON.parse(sweepCommitContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(sweepResult.result.body)) !==
      getBodySemanticHash(expectedSweep.body)
    ) {
      throw new RangeError('sweepBodyFace commit diverged from the canonical executor')
    }
    const undoSweep = await client.callTool({ name: 'undo', arguments: {} })
    if (undoSweep.isError)
      throw new Error(`sweepBodyFace undo failed: ${JSON.stringify(undoSweep)}`)
    console.log('[smoke] Follow Path sweep preflight/commit/undo: OK')

    const save = await client.callTool({
      name: 'save_scene',
      arguments: { name: 'MCP modeling smoke checkpoint', saveMode: 'checkpoint' },
    })
    if (save.isError) throw new Error(`save_scene failed: ${JSON.stringify(save)}`)
    const reopen = await client.callTool({
      name: 'open_project',
      arguments: { id: 'mcp-modeling-smoke' },
    })
    if (reopen.isError) throw new Error(`open_project failed: ${JSON.stringify(reopen)}`)
    const reopenedNode = await client.callTool({
      name: 'get_node',
      arguments: { id: sourceBody.id },
    })
    const reopenedNodeContent = reopenedNode.content[0]
    if (reopenedNode.isError || reopenedNodeContent?.type !== 'text') {
      throw new TypeError('get_node did not return the Body after save/reopen')
    }
    const reopenedPayload = z
      .object({ node: z.record(z.string(), z.unknown()) })
      .parse(JSON.parse(reopenedNodeContent.text))
    if (
      getBodySemanticHash(BodyNode.parse(reopenedPayload.node)) !== getBodySemanticHash(sourceBody)
    ) {
      throw new RangeError('save_scene/open_project did not preserve the committed Body state')
    }
    console.log('[smoke] SQLite save/reopen: OK')

    const wall = WallNode.parse({
      id: 'wall_smoke_host',
      start: [0, 0],
      end: [4, 0],
      thickness: 0.2,
    })
    const window = WindowNode.parse({
      id: 'window_smoke_hosted',
      wallId: wall.id,
      parentId: wall.id,
    })
    const createHost = await client.callTool({
      name: 'apply_patch',
      arguments: {
        patches: [
          { op: 'create', node: wall },
          { op: 'create', node: window, parentId: wall.id },
        ],
      },
    })
    if (createHost.isError)
      throw new Error(`failed to seed ontology host: ${JSON.stringify(createHost)}`)
    const hostQuery = await client.callTool({
      name: 'query_design_ontology',
      arguments: { nodeId: window.id, maxNodes: 5 },
    })
    const hostQueryContent = hostQuery.content[0]
    if (hostQuery.isError || hostQueryContent?.type !== 'text') {
      throw new TypeError('query_design_ontology did not return the window host result')
    }
    const hostPayload = z
      .object({
        status: z.literal('available'),
        scene: z.object({
          hostWall: z.object({ nodeId: z.literal(wall.id) }),
        }),
      })
      .parse(JSON.parse(hostQueryContent.text))
    if (hostPayload.scene.hostWall.nodeId !== wall.id) throw new RangeError('window host mismatch')
    console.log('[smoke] Window host ontology query: OK')

    const unavailableTransport = new StdioClientTransport({
      command: process.execPath,
      args: [BIN_PATH, '--stdio'],
      env: {
        ...getDefaultEnvironment(),
        PASCAL_DATA_DIR: smokeDataDir,
        PASCAL_ONTOLOGY_PACK_PATH: join(smokeDataDir, 'missing-ontology-pack'),
      },
      stderr: 'inherit',
    })
    const unavailableClient = new Client({ name: 'pascal-mcp-smoke-unavailable', version: '0.0.0' })
    try {
      await unavailableClient.connect(unavailableTransport)
      const unavailable = await unavailableClient.callTool({
        name: 'query_design_ontology',
        arguments: { query: 'wall' },
      })
      const unavailableContent = unavailable.content[0]
      if (unavailable.isError || unavailableContent?.type !== 'text') {
        throw new TypeError('unavailable ontology lookup did not return structured text')
      }
      const unavailablePayload = z
        .object({
          status: z.literal('unavailable'),
          code: z.literal('not_found'),
          message: z.string().startsWith('Ontology pack not found:'),
        })
        .parse(JSON.parse(unavailableContent.text))
      if (!unavailablePayload.message.endsWith('/missing-ontology-pack')) {
        throw new RangeError('unavailable ontology path was not reported exactly')
      }
      console.log('[smoke] Unavailable ontology fallback: OK')
    } finally {
      await unavailableClient.close()
    }

    const createLevel = await client.callTool({
      name: 'create_level',
      arguments: { buildingId: 'tbd', elevation: 1, height: 3 },
    })
    const createLevelContent = createLevel.content[0]
    if (
      !createLevel.isError ||
      createLevelContent?.type !== 'text' ||
      createLevelContent.text !== 'MCP error -32602: Building not found: tbd'
    ) {
      throw new Error(`create_level returned an unexpected result: ${JSON.stringify(createLevel)}`)
    }
    console.log('[smoke] create_level: expected structured error asserted')

    const validate = await client.callTool({
      name: 'validate_scene',
      arguments: {},
    })
    const validateContent = validate.content[0]
    if (validate.isError || validateContent?.type !== 'text') {
      throw new TypeError('validate_scene did not return structured text content')
    }
    const validatePayload = z
      .object({ valid: z.boolean(), errors: z.array(z.unknown()) })
      .parse(JSON.parse(validateContent.text))
    if (validatePayload.valid !== true) {
      throw new RangeError(`validate_scene returned valid=${String(validatePayload.valid)}`)
    }
    if (validatePayload.errors.length !== 0) {
      throw new RangeError(
        `validate_scene reported errors: ${JSON.stringify(validatePayload.errors)}`,
      )
    }
    console.log('[smoke] validate_scene: valid === true asserted')

    const undone = await client.callTool({ name: 'undo', arguments: {} })
    const undoContent = undone.content[0]
    if (undone.isError || undoContent?.type !== 'text') {
      throw new TypeError('undo did not return structured text content')
    }
    const undoPayload = z.object({ undone: z.number().int() }).parse(JSON.parse(undoContent.text))
    if (undoPayload.undone <= 0) {
      throw new RangeError(`undo did not undo a history step: ${undoPayload.undone}`)
    }
    console.log('[smoke] undo: undone > 0 asserted')

    console.log('[smoke] passed')
  } finally {
    try {
      await client.close()
    } catch {
      // client may already be closed; ignore.
    }
    rmSync(smokeDataDir, { recursive: true, force: true })
  }
}

main().catch((err) => {
  console.error('[smoke] failed:', err)
  process.exit(1)
})

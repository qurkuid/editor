import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ClaudeCliExecutionError,
  getClaudeCliStatus,
  requestAiModelingPlanViaClaude,
} from './ai-claude-provider'
import { AiChatRequestSchema } from './ai-provider'

const baseRequest = {
  messages: [{ role: 'user' as const, content: 'Inspect the scene' }],
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

describe('Claude CLI provider boundary', () => {
  test('falls back to another installed CLI when the first binary is broken', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pascal-claude-fallback-'))
    const brokenCommand = join(directory, 'broken-claude')
    const connectedCommand = join(directory, 'connected-claude')
    await writeFile(brokenCommand, '#!/bin/sh\nexit 1\n')
    await writeFile(
      connectedCommand,
      `#!/bin/sh\nprintf '%s' '{"loggedIn":true,"authMethod":"claude.ai"}'\n`,
    )
    await chmod(brokenCommand, 0o755)
    await chmod(connectedCommand, 0o755)

    try {
      const status = await getClaudeCliStatus({ command: brokenCommand, model: null }, [
        connectedCommand,
      ])

      expect(status).toEqual({
        connected: true,
        authMethod: 'claude.ai',
        command: connectedCommand,
      })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('reports not connected when `claude auth status --json` says loggedIn is false', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pascal-claude-status-'))
    const command = join(directory, 'claude-fixture')
    await writeFile(command, `#!/bin/sh\nprintf '%s' '{"loggedIn":false}'\n`)
    await chmod(command, 0o755)

    try {
      const status = await getClaudeCliStatus({ command, model: null })

      expect(status).toEqual({ connected: false, authMethod: null })
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('returns a structured plan parsed from the CLI --json-schema structured_output', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pascal-claude-plan-'))
    const command = join(directory, 'claude-fixture')
    const promptPath = join(directory, 'prompt.txt')
    await writeFile(
      command,
      `#!/bin/sh
cat > ${JSON.stringify(promptPath)}
printf '%s' '{"is_error":false,"structured_output":{"message":"Claude CLI plan ready.","patches":[]}}'
`,
    )
    await chmod(command, 0o755)

    try {
      const plan = await requestAiModelingPlanViaClaude(AiChatRequestSchema.parse(baseRequest), {
        command,
        model: null,
      })

      expect(plan).toEqual({ message: 'Claude CLI plan ready.', patches: [] })
      expect(await readFile(promptPath, 'utf8')).toContain('Inspect the scene')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('retries once when the structured output fails the zod contract, without loosening it', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pascal-claude-retry-'))
    const command = join(directory, 'claude-fixture')
    const counterPath = join(directory, 'count')
    await writeFile(
      command,
      `#!/bin/sh
cat > /dev/null
count=0
[ -f ${JSON.stringify(counterPath)} ] && count=$(cat ${JSON.stringify(counterPath)})
count=$((count + 1))
printf '%s' "$count" > ${JSON.stringify(counterPath)}
if [ "$count" = "1" ]; then
  printf '%s' '{"is_error":false,"structured_output":{"message":"first try","patches":[{"op":"pushPullBodyFace","id":null,"nodeJson":null,"dataJson":null,"parentId":null,"cascade":null,"faceId":"face:0","distance":1,"translation":null,"rotationY":null,"uniformScale":null,"pivot":null}]}}'
else
  printf '%s' '{"is_error":false,"structured_output":{"message":"second try ready.","patches":[]}}'
fi
`,
    )
    await chmod(command, 0o755)

    try {
      const plan = await requestAiModelingPlanViaClaude(AiChatRequestSchema.parse(baseRequest), {
        command,
        model: null,
      })

      expect(plan).toEqual({ message: 'second try ready.', patches: [] })
      expect(await readFile(counterPath, 'utf8')).toBe('2')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('does not retry a CLI-level failure — it surfaces immediately', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pascal-claude-error-'))
    const command = join(directory, 'claude-fixture')
    const counterPath = join(directory, 'count')
    await writeFile(
      command,
      `#!/bin/sh
cat > /dev/null
count=0
[ -f ${JSON.stringify(counterPath)} ] && count=$(cat ${JSON.stringify(counterPath)})
count=$((count + 1))
printf '%s' "$count" > ${JSON.stringify(counterPath)}
printf '%s' '{"is_error":true,"result":"model unavailable"}'
`,
    )
    await chmod(command, 0o755)

    try {
      await expect(
        requestAiModelingPlanViaClaude(AiChatRequestSchema.parse(baseRequest), {
          command,
          model: null,
        }),
      ).rejects.toBeInstanceOf(ClaudeCliExecutionError)
      expect(await readFile(counterPath, 'utf8')).toBe('1')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('reads attached images through the Read tool instead of a CLI image flag, without leaking base64 into the prompt', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pascal-claude-image-test-'))
    const command = join(directory, 'claude-fixture')
    const promptPath = join(directory, 'prompt.txt')
    const argsPath = join(directory, 'args.txt')
    await writeFile(
      command,
      `#!/bin/sh
cat > ${JSON.stringify(promptPath)}
for arg in "$@"; do printf '%s\\n' "$arg" >> ${JSON.stringify(argsPath)}; done
printf '%s' '{"is_error":false,"structured_output":{"message":"CLI plan ready.","patches":[]}}'
`,
    )
    await chmod(command, 0o755)

    try {
      const request = AiChatRequestSchema.parse({
        ...baseRequest,
        images: [
          {
            name: 'reference.png',
            mimeType: 'image/png',
            dataUrl: 'data:image/png;base64,aGVsbG8=',
          },
        ],
      })

      const plan = await requestAiModelingPlanViaClaude(request, { command, model: null })

      expect(plan).toEqual({ message: 'CLI plan ready.', patches: [] })

      const prompt = await readFile(promptPath, 'utf8')
      expect(prompt).not.toContain('aGVsbG8=')
      expect(prompt).toContain('reference-0.png')
      expect(prompt).toContain('Use the Read tool')

      const args = (await readFile(argsPath, 'utf8')).split('\n')
      expect(args).toContain('Read')
      expect(args).toContain('--allowedTools')
      expect(args).toContain('--add-dir')
      expect(args).toContain('--permission-mode')
      expect(args).toContain('dontAsk')

      // The materialized image file is cleaned up with the temp directory
      // once the request completes.
      const imagePathLine = prompt
        .split('\n')
        .find((line) => line.trim().endsWith('reference-0.png'))
      const imagePath = imagePathLine?.replace(/^\d+\.\s*/, '').trim()
      expect(imagePath).toBeDefined()
      if (imagePath) expect(existsSync(imagePath)).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('omits Read-tool access entirely when no images are attached', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pascal-claude-no-image-test-'))
    const command = join(directory, 'claude-fixture')
    const argsPath = join(directory, 'args.txt')
    await writeFile(
      command,
      `#!/bin/sh
cat > /dev/null
for arg in "$@"; do printf '%s\\n' "$arg" >> ${JSON.stringify(argsPath)}; done
printf '%s' '{"is_error":false,"structured_output":{"message":"CLI plan ready.","patches":[]}}'
`,
    )
    await chmod(command, 0o755)

    try {
      await requestAiModelingPlanViaClaude(AiChatRequestSchema.parse(baseRequest), {
        command,
        model: null,
      })

      const args = (await readFile(argsPath, 'utf8')).split('\n')
      expect(args).not.toContain('--allowedTools')
      expect(args).not.toContain('--add-dir')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

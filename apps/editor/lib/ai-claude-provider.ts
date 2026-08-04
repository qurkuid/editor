import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { parseCodexCliPlan } from './ai-cli-plan'
import type { AiModelingPlan } from './ai-contract'
import {
  type AiChatImage,
  type AiChatRequest,
  type AiProviderConfig,
  buildAiModelingPrompt,
  type ClaudeCliStatus,
  decodeAiChatImageDataUrl,
  modelingPlanJsonSchema,
  parseClaudeLoginStatus,
} from './ai-provider'

const CLI_TIMEOUT_MS = 180_000
const MAX_DIAGNOSTIC_LENGTH = 64_000

type CliResult = {
  readonly stdout: string
  readonly stderr: string
}

export type ClaudeCliRuntimeStatus =
  | { readonly connected: true; readonly authMethod: string; readonly command: string }
  | { readonly connected: false; readonly authMethod: null }

export class ClaudeCliExecutionError extends Error {
  readonly exitCode: number | null

  constructor(message: string, exitCode: number | null, cause?: Error) {
    super(message, cause ? { cause } : undefined)
    this.name = 'ClaudeCliExecutionError'
    this.exitCode = exitCode
  }
}

function runClaudeCli(
  config: AiProviderConfig,
  args: readonly string[],
  input: string,
): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(config.command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish(new ClaudeCliExecutionError('Claude CLI request timed out', null))
    }, CLI_TIMEOUT_MS)

    function finish(error?: ClaudeCliExecutionError, exitCode = 0) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        reject(error)
        return
      }
      if (exitCode !== 0) {
        reject(new ClaudeCliExecutionError(stderr.trim() || 'Claude CLI failed', exitCode))
        return
      }
      resolve({ stdout, stderr })
    }

    child.stdout.on('data', (chunk) => {
      stdout = `${stdout}${String(chunk)}`.slice(-MAX_DIAGNOSTIC_LENGTH)
    })
    child.stderr.on('data', (chunk) => {
      stderr = `${stderr}${String(chunk)}`.slice(-MAX_DIAGNOSTIC_LENGTH)
    })
    child.once('error', (error) =>
      finish(new ClaudeCliExecutionError('Could not start Claude CLI', null, error)),
    )
    child.once('close', (code) => finish(undefined, code ?? 1))
    child.stdin.on('error', () => undefined)
    child.stdin.end(input)
  })
}

export async function getClaudeCliStatus(
  config: AiProviderConfig,
  fallbackCommands: readonly string[] = [],
): Promise<ClaudeCliRuntimeStatus> {
  for (const command of new Set([config.command, ...fallbackCommands])) {
    try {
      const result = await runClaudeCli({ ...config, command }, ['auth', 'status', '--json'], '')
      const status: ClaudeCliStatus = parseClaudeLoginStatus(result.stdout)
      if (status.connected) return { ...status, command }
    } catch (error) {
      if (!(error instanceof ClaudeCliExecutionError)) throw error
    }
  }
  return { connected: false, authMethod: null }
}

const IMAGE_FILE_EXTENSIONS: Record<AiChatImage['mimeType'], string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

async function materializeAiChatImages(
  directory: string,
  images: readonly AiChatImage[],
): Promise<string[]> {
  return Promise.all(
    images.map(async (image, index) => {
      const filePath = join(
        directory,
        `reference-${index}.${IMAGE_FILE_EXTENSIONS[image.mimeType]}`,
      )
      await writeFile(filePath, decodeAiChatImageDataUrl(image))
      return filePath
    }),
  )
}

// Claude CLI has no `--image` flag. Instead we point it at the same
// materialized reference files via the Read tool: buildAiModelingPrompt's
// image manifest only lists the original attachment names (shared with
// Codex, which resolves images through its own --image flag), so Claude
// additionally needs the absolute on-disk paths to Read.
function appendClaudeImagePaths(prompt: string, imagePaths: readonly string[]): string {
  if (imagePaths.length === 0) return prompt
  const manifest = imagePaths.map((path, index) => `${index + 1}. ${path}`).join('\n')
  return `${prompt}\n\nUse the Read tool to open each attached reference image before answering. Absolute file paths for the Read tool, in the same order as the attached reference images listed above:\n${manifest}`
}

const ClaudeCliOutputSchema = z.object({
  is_error: z.boolean().optional(),
  result: z.string().optional(),
  structured_output: z.unknown().optional(),
})

// `--output-format json` returns a single result object on some CLI versions
// and the whole stream of events as an array on others (2.1.212 does the
// latter). Accept both rather than pinning a version — the last `result` event
// carries the plan either way.
function claudeResultEnvelope(decoded: unknown): unknown {
  if (!Array.isArray(decoded)) return decoded
  for (let index = decoded.length - 1; index >= 0; index -= 1) {
    const entry = decoded[index]
    if (entry && typeof entry === 'object' && (entry as { type?: unknown }).type === 'result') {
      return entry
    }
  }
  return decoded[decoded.length - 1] ?? {}
}

export function parseClaudeCliOutput(stdout: string): unknown {
  let decoded: unknown
  try {
    decoded = JSON.parse(stdout)
  } catch (cause) {
    throw new ClaudeCliExecutionError(
      'Claude CLI returned invalid JSON',
      null,
      cause instanceof Error ? cause : undefined,
    )
  }
  const output = ClaudeCliOutputSchema.parse(claudeResultEnvelope(decoded))
  if (output.is_error || output.structured_output === undefined) {
    throw new ClaudeCliExecutionError(
      output.result || 'Claude CLI did not return a structured plan',
      null,
    )
  }
  return output.structured_output
}

export async function requestAiModelingPlanViaClaude(
  input: AiChatRequest,
  config: AiProviderConfig,
): Promise<AiModelingPlan> {
  const directory = await mkdtemp(join(tmpdir(), 'pascal-claude-'))

  try {
    const imagePaths = await materializeAiChatImages(directory, input.images ?? [])
    const prompt = appendClaudeImagePaths(buildAiModelingPrompt(input), imagePaths)
    const hasImages = imagePaths.length > 0
    const args = [
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(modelingPlanJsonSchema),
      ...(config.model ? ['--model', config.model] : []),
      // Isolate this call from this machine's own CLAUDE.md, skills, and
      // configured MCP servers — the modeling agent must only see the
      // structured scene/prompt payload, not the host operator's tooling.
      '--strict-mcp-config',
      '--setting-sources',
      '',
      '--tools',
      hasImages ? 'Read' : '',
      ...(hasImages
        ? ['--allowedTools', 'Read', '--add-dir', directory, '--permission-mode', 'dontAsk']
        : []),
    ]

    let lastRawPlan: unknown
    async function runOnce(): Promise<unknown> {
      const result = await runClaudeCli(config, args, prompt)
      lastRawPlan = parseClaudeCliOutput(result.stdout)
      return lastRawPlan
    }

    try {
      return parseCodexCliPlan(await runOnce())
    } catch (error) {
      if (error instanceof ClaudeCliExecutionError) throw error
      // The CLI honored --json-schema but the plan still failed our
      // stricter zod contract (e.g. a material id not starting with
      // `mat_`) — retry once before giving up. Log what the model actually
      // sent: a bare ZodError with an empty path says a field was null
      // without saying in which patch, which made this class of failure
      // undiagnosable from the server side.
      console.error(
        '[AI] Claude plan failed validation, retrying. Offending plan:',
        JSON.stringify(await Promise.resolve(lastRawPlan)).slice(0, 4000),
      )
      return parseCodexCliPlan(await runOnce())
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

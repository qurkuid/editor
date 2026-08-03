import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCodexCliPlan } from './ai-cli-plan'
import type { AiModelingPlan } from './ai-contract'
import {
  type AiChatImage,
  type AiChatRequest,
  type AiProviderConfig,
  buildAiModelingPrompt,
  type CodexCliStatus,
  decodeAiChatImageDataUrl,
  modelingPlanJsonSchema,
  parseCodexLoginStatus,
} from './ai-provider'

const CLI_TIMEOUT_MS = 180_000
const MAX_DIAGNOSTIC_LENGTH = 64_000
const DEFAULT_CODEX_CLI_FALLBACKS: readonly string[] =
  process.platform === 'darwin' ? ['/Applications/ChatGPT.app/Contents/Resources/codex'] : []

type CliResult = {
  readonly stdout: string
  readonly stderr: string
}

export type CodexCliRuntimeStatus =
  | { readonly connected: true; readonly authMethod: 'chatgpt'; readonly command: string }
  | { readonly connected: false; readonly authMethod: null }

export class CodexCliExecutionError extends Error {
  readonly exitCode: number | null

  constructor(message: string, exitCode: number | null, cause?: Error) {
    super(message, cause ? { cause } : undefined)
    this.name = 'CodexCliExecutionError'
    this.exitCode = exitCode
  }
}

function runCodexCli(
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
      finish(new CodexCliExecutionError('Codex CLI request timed out', null))
    }, CLI_TIMEOUT_MS)

    function finish(error?: CodexCliExecutionError, exitCode = 0) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) {
        reject(error)
        return
      }
      if (exitCode !== 0) {
        reject(new CodexCliExecutionError(stderr.trim() || 'Codex CLI failed', exitCode))
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
      finish(new CodexCliExecutionError('Could not start Codex CLI', null, error)),
    )
    child.once('close', (code) => finish(undefined, code ?? 1))
    child.stdin.on('error', () => undefined)
    child.stdin.end(input)
  })
}

export async function getCodexCliStatus(
  config: AiProviderConfig,
  fallbackCommands: readonly string[] = DEFAULT_CODEX_CLI_FALLBACKS,
): Promise<CodexCliRuntimeStatus> {
  for (const command of new Set([config.command, ...fallbackCommands])) {
    try {
      const result = await runCodexCli({ ...config, command }, ['login', 'status'], '')
      const status: CodexCliStatus = parseCodexLoginStatus(`${result.stdout}\n${result.stderr}`)
      if (status.connected) return { ...status, command }
    } catch (error) {
      if (!(error instanceof CodexCliExecutionError)) throw error
    }
  }
  return { connected: false, authMethod: null }
}

export { parseCodexCliPlan } from './ai-cli-plan'

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

export async function requestAiModelingPlan(
  input: AiChatRequest,
  config: AiProviderConfig,
): Promise<AiModelingPlan> {
  const directory = await mkdtemp(join(tmpdir(), 'pascal-codex-'))
  const schemaPath = join(directory, 'modeling-plan.schema.json')
  const outputPath = join(directory, 'modeling-plan.json')
  const modelArgs = config.model ? ['--model', config.model] : []

  try {
    await writeFile(schemaPath, JSON.stringify(modelingPlanJsonSchema))
    const imagePaths = await materializeAiChatImages(directory, input.images ?? [])
    await runCodexCli(
      config,
      [
        'exec',
        '--ephemeral',
        '--sandbox',
        'read-only',
        '--ignore-user-config',
        '--skip-git-repo-check',
        '--color',
        'never',
        ...modelArgs,
        ...imagePaths.flatMap((filePath) => ['--image', filePath]),
        '--output-schema',
        schemaPath,
        '-o',
        outputPath,
        '-',
      ],
      buildAiModelingPrompt(input),
    )
    const decoded: unknown = JSON.parse(await readFile(outputPath, 'utf8'))
    return parseCodexCliPlan(decoded)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

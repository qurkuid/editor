import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { materializeClaudeImages, parseClaudeCliOutput, runClaudeCli } from './ai-claude-provider'
import { CodexCliExecutionError, materializeAiChatImages, runCodexCli } from './ai-cli-provider'
import type { AiProviderConfig } from './ai-provider'
import {
  type Img3dRequest,
  type Img3dSculpt,
  Img3dSculptSchema,
  img3dCodexSculptJsonSchema,
  img3dSculptJsonSchema,
} from './img3d-contract'

function buildImg3dPrompt(input: Img3dRequest, imagePath?: string): string {
  return [
    'Inspect the single reference image and return only the requested bounded sculpt JSON.',
    'Use Y-up metres. Keep geometry centered in X/Z and grounded at y=0.',
    'Approximate visible form using only the schema primitives and simple PBR materials.',
    'Do not return code, scripts, URLs, textures, arbitrary glTF, or additional properties.',
    `Target dimensions in metres: ${JSON.stringify(input.dimensions)}.`,
    imagePath ? `Read the reference image at this absolute path: ${imagePath}` : '',
  ]
    .filter(Boolean)
    .join('\n')
}

function retryFeedback(error: unknown, raw: unknown): string {
  const issue = error instanceof Error ? error.message.slice(0, 2000) : 'schema mismatch'
  return `Your previous output failed schema validation. Fix these issues: ${issue}\nInvalid output: ${JSON.stringify(raw).slice(0, 4000)}`
}

export function parseImg3dClaudeOutput(stdout: string): Img3dSculpt {
  const raw = parseClaudeCliOutput(stdout)
  return Img3dSculptSchema.parse(raw)
}

export async function requestImg3dSculptViaCodex(
  input: Img3dRequest,
  config: AiProviderConfig,
): Promise<Img3dSculpt> {
  const directory = await mkdtemp(join(tmpdir(), 'pascal-img3d-codex-'))
  const schemaPath = join(directory, 'img3d.schema.json')
  const outputPath = join(directory, 'img3d.json')
  try {
    await writeFile(schemaPath, JSON.stringify(img3dCodexSculptJsonSchema))
    const [imagePath] = await materializeAiChatImages(directory, [input.image])
    if (!imagePath) throw new RangeError('img3d reference image was not materialized')
    const args = [
      'exec',
      '--ephemeral',
      '--sandbox',
      'read-only',
      '--ignore-user-config',
      '--skip-git-repo-check',
      '--color',
      'never',
      ...(config.model ? ['--model', config.model] : []),
      ...(config.effort ? ['-c', `model_reasoning_effort=${JSON.stringify(config.effort)}`] : []),
      '--image',
      imagePath,
      '--output-schema',
      schemaPath,
      '-o',
      outputPath,
      '-',
    ]
    let raw: unknown
    const run = async (feedback?: string): Promise<Img3dSculpt> => {
      await runCodexCli(
        config,
        args,
        `${buildImg3dPrompt(input)}${feedback ? `\n${feedback}` : ''}`,
      )
      raw = JSON.parse(await readFile(outputPath, 'utf8'))
      return Img3dSculptSchema.parse(raw)
    }
    try {
      return await run()
    } catch (error) {
      if (error instanceof CodexCliExecutionError) throw error
      return await run(retryFeedback(error, raw))
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function requestImg3dSculptViaClaude(
  input: Img3dRequest,
  config: AiProviderConfig,
): Promise<Img3dSculpt> {
  const directory = await mkdtemp(join(tmpdir(), 'pascal-img3d-claude-'))
  try {
    const [imagePath] = await materializeClaudeImages(directory, [input.image])
    if (!imagePath) throw new RangeError('img3d reference image was not materialized')
    const args = [
      '-p',
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(img3dSculptJsonSchema),
      ...(config.model ? ['--model', config.model] : []),
      ...(config.effort ? ['--effort', config.effort] : []),
      '--strict-mcp-config',
      '--setting-sources',
      '',
      '--tools',
      'Read',
      '--allowedTools',
      'Read',
      '--add-dir',
      directory,
      '--permission-mode',
      'dontAsk',
    ]
    let raw: unknown
    const run = async (feedback?: string): Promise<Img3dSculpt> => {
      const prompt = `${buildImg3dPrompt(input, imagePath)}${feedback ? `\n${feedback}` : ''}`
      const result = await runClaudeCli(config, args, prompt)
      raw = parseClaudeCliOutput(result.stdout)
      return Img3dSculptSchema.parse(raw)
    }
    try {
      return await run()
    } catch (error) {
      if (error instanceof z.ZodError) return await run(retryFeedback(error, raw))
      throw error
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

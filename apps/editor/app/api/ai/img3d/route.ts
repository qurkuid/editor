import { NextResponse } from 'next/server'
import { getClaudeCliStatus } from '@/lib/ai-claude-provider'
import { getCodexCliStatus } from '@/lib/ai-cli-provider'
import { describeAiFailure } from '@/lib/ai-failure'
import { DEFAULT_CLAUDE_MODEL } from '@/lib/ai-model-options'
import {
  type AiProviderConfig,
  resolveAiProviderConfig,
  resolveClaudeCliConfig,
} from '@/lib/ai-provider'
import { type Img3dRequest, Img3dRequestSchema, type Img3dSculpt } from '@/lib/img3d-contract'
import { requestImg3dSculptViaClaude, requestImg3dSculptViaCodex } from '@/lib/img3d-provider'

export const runtime = 'nodejs'

type CodexStatus = Awaited<ReturnType<typeof getCodexCliStatus>>
type ClaudeStatus = Awaited<ReturnType<typeof getClaudeCliStatus>>

export type Img3dRouteDependencies = {
  readonly codexStatus: (config: AiProviderConfig) => Promise<CodexStatus>
  readonly claudeStatus: (config: AiProviderConfig) => Promise<ClaudeStatus>
  readonly codexRequest: (input: Img3dRequest, config: AiProviderConfig) => Promise<Img3dSculpt>
  readonly claudeRequest: (input: Img3dRequest, config: AiProviderConfig) => Promise<Img3dSculpt>
}

const dependencies: Img3dRouteDependencies = {
  codexStatus: getCodexCliStatus,
  claudeStatus: getClaudeCliStatus,
  codexRequest: requestImg3dSculptViaCodex,
  claudeRequest: requestImg3dSculptViaClaude,
}

function codexConfig(): AiProviderConfig {
  return resolveAiProviderConfig({
    CODEX_CLI_PATH: process.env.CODEX_CLI_PATH,
    PATH: process.env.PATH,
    PASCAL_CODEX_MODEL: process.env.PASCAL_CODEX_MODEL,
    PASCAL_NODE_EXEC_PATH: process.execPath,
  })
}

function claudeConfig(): AiProviderConfig {
  return resolveClaudeCliConfig({
    CLAUDE_CLI_PATH: process.env.CLAUDE_CLI_PATH,
    PATH: process.env.PATH,
    PASCAL_CLAUDE_MODEL: process.env.PASCAL_CLAUDE_MODEL,
  })
}

function notConfigured(provider: 'codex' | 'claude'): NextResponse {
  return NextResponse.json(
    {
      error: 'ai_not_configured',
      message: `Run ${provider} login before using img3d.`,
    },
    { status: 503 },
  )
}

function failureResponse(error: unknown): NextResponse {
  const failure = describeAiFailure(error)
  return NextResponse.json(
    { error: failure.error, message: failure.message },
    { status: failure.status },
  )
}

export async function handleImg3dPost(
  request: Request,
  routeDependencies: Img3dRouteDependencies,
): Promise<NextResponse> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = Img3dRequestSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_img3d_request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  if (parsed.data.provider === 'claude') {
    const config = claudeConfig()
    const status = await routeDependencies.claudeStatus(config)
    if (!status.connected) return notConfigured('claude')
    try {
      return NextResponse.json(
        await routeDependencies.claudeRequest(parsed.data, {
          ...config,
          command: status.command,
          model: parsed.data.model ?? config.model ?? DEFAULT_CLAUDE_MODEL,
          effort: parsed.data.effort,
        }),
      )
    } catch (error) {
      return failureResponse(error)
    }
  }

  const config = codexConfig()
  const status = await routeDependencies.codexStatus(config)
  if (!status.connected) return notConfigured('codex')
  try {
    return NextResponse.json(
      await routeDependencies.codexRequest(parsed.data, {
        ...config,
        command: status.command,
        model: parsed.data.model ?? config.model,
        effort: parsed.data.effort,
      }),
    )
  } catch (error) {
    const failure = describeAiFailure(error)
    if (failure.error !== 'ai_usage_limit') return failureResponse(error)
    const fallbackConfig = claudeConfig()
    const fallbackStatus = await routeDependencies.claudeStatus(fallbackConfig)
    if (!fallbackStatus.connected) return failureResponse(error)
    try {
      return NextResponse.json(
        await routeDependencies.claudeRequest(parsed.data, {
          ...fallbackConfig,
          command: fallbackStatus.command,
          model: fallbackConfig.model ?? DEFAULT_CLAUDE_MODEL,
          effort: parsed.data.effort === 'minimal' ? 'low' : parsed.data.effort,
        }),
      )
    } catch {
      return failureResponse(error)
    }
  }
}

export function POST(request: Request): Promise<NextResponse> {
  return handleImg3dPost(request, dependencies)
}

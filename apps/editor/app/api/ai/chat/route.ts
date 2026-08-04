import { NextResponse } from 'next/server'
import { describeAiFailure } from '@/lib/ai-failure'
import { getClaudeCliStatus, requestAiModelingPlanViaClaude } from '@/lib/ai-claude-provider'
import { getCodexCliStatus, requestAiModelingPlan } from '@/lib/ai-cli-provider'
import {
  AiChatRequestSchema,
  resolveAiProviderConfig,
  resolveClaudeCliConfig,
} from '@/lib/ai-provider'

export const runtime = 'nodejs'

function codexProviderConfig() {
  return resolveAiProviderConfig({
    CODEX_CLI_PATH: process.env.CODEX_CLI_PATH,
    PATH: process.env.PATH,
    PASCAL_CODEX_MODEL: process.env.PASCAL_CODEX_MODEL,
    PASCAL_NODE_EXEC_PATH: process.execPath,
  })
}

function claudeProviderConfig() {
  return resolveClaudeCliConfig({
    CLAUDE_CLI_PATH: process.env.CLAUDE_CLI_PATH,
    PATH: process.env.PATH,
    PASCAL_CLAUDE_MODEL: process.env.PASCAL_CLAUDE_MODEL,
  })
}

export async function GET() {
  const codexConfig = codexProviderConfig()
  const claudeConfig = claudeProviderConfig()
  const [codexStatus, claudeStatus] = await Promise.all([
    getCodexCliStatus(codexConfig),
    getClaudeCliStatus(claudeConfig),
  ])
  return NextResponse.json({
    codex: {
      configured: codexStatus.connected,
      model: codexStatus.connected ? (codexConfig.model ?? 'Codex CLI OAuth') : null,
    },
    claude: {
      configured: claudeStatus.connected,
      model: claudeStatus.connected ? (claudeConfig.model ?? 'Claude CLI OAuth') : null,
    },
  })
}

export async function POST(request: Request) {
  let input: unknown
  try {
    input = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const parsed = AiChatRequestSchema.safeParse(input)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_ai_request', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  if (parsed.data.provider === 'claude') {
    const config = claudeProviderConfig()
    const status = await getClaudeCliStatus(config)
    if (!status.connected) {
      return NextResponse.json(
        {
          error: 'ai_not_configured',
          message: 'Run claude auth login and sign in before using the modeling agent.',
        },
        { status: 503 },
      )
    }

    try {
      const plan = await requestAiModelingPlanViaClaude(parsed.data, {
        ...config,
        command: status.command,
      })
      return NextResponse.json(plan)
    } catch (error) {
      if (error instanceof Error) {
        console.error('[AI] Claude modeling request failed', error)
      } else {
        console.error('[AI] Claude modeling request failed with a non-error value')
      }
      const failure = describeAiFailure(error)
      return NextResponse.json(
        { error: failure.error, message: failure.message },
        { status: failure.status },
      )
    }
  }

  const config = codexProviderConfig()
  const status = await getCodexCliStatus(config)
  if (!status.connected) {
    return NextResponse.json(
      {
        error: 'ai_not_configured',
        message: 'Run codex login and sign in with ChatGPT before using the modeling agent.',
      },
      { status: 503 },
    )
  }

  try {
    const plan = await requestAiModelingPlan(parsed.data, { ...config, command: status.command })
    return NextResponse.json(plan)
  } catch (error) {
    if (error instanceof Error) {
      console.error('[AI] Modeling request failed', error)
    } else {
      console.error('[AI] Modeling request failed with a non-error value')
    }
    const failure = describeAiFailure(error)

    // Codex out of usage is not a dead end while Claude is signed in on this
    // server — answer with the other provider instead of bouncing the user to
    // a settings toggle they may not know exists. The note in the reply keeps
    // it honest about who did the work.
    if (failure.error === 'ai_usage_limit') {
      const claudeConfig = claudeProviderConfig()
      const claudeStatus = await getClaudeCliStatus(claudeConfig)
      if (claudeStatus.connected) {
        try {
          const plan = await requestAiModelingPlanViaClaude(parsed.data, {
            ...claudeConfig,
            command: claudeStatus.command,
          })
          return NextResponse.json({
            ...plan,
            message: `(Codex 사용 한도 초과 — Claude가 대신 처리했습니다)\n\n${plan.message}`,
          })
        } catch (fallbackError) {
          console.error('[AI] Claude fallback after Codex usage limit failed', fallbackError)
        }
      }
    }

    return NextResponse.json(
      { error: failure.error, message: failure.message },
      { status: failure.status },
    )
  }
}

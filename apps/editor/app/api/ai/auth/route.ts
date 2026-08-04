import { NextResponse } from 'next/server'
import { z } from 'zod'
import {
  cancelLoginSession,
  getLoginSessionView,
  type LoginSessionView,
  startLoginSession,
  submitLoginCode,
} from '@/lib/ai-auth-login'
import { getClaudeCliStatus } from '@/lib/ai-claude-provider'
import { getCodexCliStatus } from '@/lib/ai-cli-provider'
import {
  type AiProviderKind,
  AiProviderKindSchema,
  resolveAiProviderConfig,
  resolveClaudeCliConfig,
} from '@/lib/ai-provider'

export const runtime = 'nodejs'

/**
 * Drive a CLI sign-in from the settings panel. The whole app sits behind the
 * INTM login middleware, so only an authenticated operator can reach this.
 */

const AuthRequestSchema = z.object({
  provider: AiProviderKindSchema,
  action: z.enum(['start', 'submit', 'cancel']),
  code: z.string().max(600).optional(),
})

function cliCommand(provider: AiProviderKind): string {
  return provider === 'claude'
    ? resolveClaudeCliConfig({
        CLAUDE_CLI_PATH: process.env.CLAUDE_CLI_PATH,
        PATH: process.env.PATH,
      }).command
    : resolveAiProviderConfig({
        CODEX_CLI_PATH: process.env.CODEX_CLI_PATH,
        PATH: process.env.PATH,
        PASCAL_NODE_EXEC_PATH: process.execPath,
      }).command
}

async function isConnected(provider: AiProviderKind): Promise<boolean> {
  const command = cliCommand(provider)
  const status =
    provider === 'claude'
      ? await getClaudeCliStatus({ command, model: null })
      : await getCodexCliStatus({ command, model: null }, [])
  return status.connected
}

/**
 * An exited login process is only a success if the CLI now reports a live
 * login — claude exits 0 on a plain EOF too.
 */
async function describeSession(
  provider: AiProviderKind,
): Promise<LoginSessionView | { status: 'succeeded' }> {
  const view = getLoginSessionView(provider)
  if (view.status !== 'exited') return view
  if (await isConnected(provider)) {
    cancelLoginSession(provider)
    return { status: 'succeeded' }
  }
  return { ...view, status: 'failed' }
}

export async function GET(request: Request) {
  const provider = AiProviderKindSchema.safeParse(new URL(request.url).searchParams.get('provider'))
  if (!provider.success) {
    return NextResponse.json({ error: 'invalid_provider' }, { status: 400 })
  }
  return NextResponse.json(await describeSession(provider.data))
}

export async function POST(request: Request) {
  let input: unknown
  try {
    input = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }
  const parsed = AuthRequestSchema.safeParse(input)
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_auth_request' }, { status: 400 })
  }
  const { provider, action, code } = parsed.data

  if (action === 'cancel') {
    cancelLoginSession(provider)
    return NextResponse.json({ status: 'idle' })
  }

  if (action === 'submit') {
    if (!(code && submitLoginCode(provider, code))) {
      return NextResponse.json({ error: 'invalid_login_code' }, { status: 400 })
    }
    return NextResponse.json(await describeSession(provider))
  }

  startLoginSession(provider, cliCommand(provider))
  // Give the CLI a moment to print its URL (and device code) so the panel can
  // render the whole flow from this one response instead of a blank pending
  // state; the client still polls GET for later transitions.
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const view = getLoginSessionView(provider)
    if (view.url || view.status === 'failed') break
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  return NextResponse.json(await describeSession(provider))
}

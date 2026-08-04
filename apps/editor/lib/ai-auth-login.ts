import { type ChildProcess, spawn } from 'node:child_process'
import type { AiProviderKind } from './ai-provider'

/**
 * Server-side CLI login sessions for the modeling agent.
 *
 * Both CLIs support a headless sign-in the web UI can drive end to end:
 * - `claude auth login` prints an OAuth URL whose hosted callback page shows
 *   the user a code, then waits on stdin for that code to be pasted back.
 * - `codex login --device-auth` prints a verification URL plus a one-time
 *   device code and polls OpenAI until the user approves it in a browser.
 *
 * One session per provider, held in module state — the editor server is a
 * single long-lived process, and a second concurrent login for the same
 * provider would race on the same credentials file anyway.
 */

const LOGIN_TIMEOUT_MS = 15 * 60 * 1000
const MAX_OUTPUT_LENGTH = 32_000

// The pasted Claude authorization code is `code#state`, base64url on both
// sides. Reject anything else before it reaches the CLI's stdin.
const LOGIN_CODE_PATTERN = /^[A-Za-z0-9#_-]{8,512}$/

type LoginSession = {
  readonly provider: AiProviderKind
  readonly child: ChildProcess
  output: string
  exitCode: number | null
  exited: boolean
  timedOut: boolean
  timer: NodeJS.Timeout
}

export type LoginSessionView = {
  readonly status: 'idle' | 'starting' | 'awaiting' | 'exited' | 'failed'
  readonly url: string | null
  readonly userCode: string | null
  readonly needsCode: boolean
  readonly detail: string | null
}

const sessions = new Map<AiProviderKind, LoginSession>()

/** Remove CSI color/style sequences and OSC hyperlink wrappers. */
export function stripCliDecorations(text: string): string {
  return (
    text
      // OSC sequences (`ESC ] ... BEL` or `ESC ] ... ESC \`) — includes the
      // OSC-8 hyperlink wrapper claude prints around its login URL.
      // biome-ignore lint/suspicious/noControlCharactersInRegex: this regex exists to strip terminal control sequences
      .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
      // CSI sequences (colors, cursor movement).
      // biome-ignore lint/suspicious/noControlCharactersInRegex: this regex exists to strip terminal control sequences
      .replace(/\u001b\[[0-9;]*[A-Za-z]/g, '')
  )
}

/**
 * The login URL from `claude auth login` output. The CLI prints the URL as an
 * OSC-8 hyperlink whose target and text are the same URL, so after stripping
 * decorations the two copies sit back to back — the lookahead keeps the first.
 */
export function parseClaudeLoginUrl(output: string): string | null {
  const stripped = stripCliDecorations(output)
  const match = stripped.match(/https:\/\/\S*?\/oauth\/\S*?(?=https:\/\/|\s|$)/)
  return match?.[0] ?? null
}

/** The verification URL and one-time code from `codex login --device-auth`. */
export function parseCodexDeviceAuth(output: string): {
  url: string | null
  userCode: string | null
} {
  const stripped = stripCliDecorations(output)
  return {
    url: stripped.match(/https:\/\/auth\.openai\.com\/\S+/)?.[0] ?? null,
    userCode: stripped.match(/\b([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/)?.[1] ?? null,
  }
}

export function startLoginSession(provider: AiProviderKind, command: string): void {
  cancelLoginSession(provider)

  const args = provider === 'claude' ? ['auth', 'login'] : ['login', '--device-auth']
  const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })
  const session: LoginSession = {
    provider,
    child,
    output: '',
    exitCode: null,
    exited: false,
    timedOut: false,
    timer: setTimeout(() => {
      session.timedOut = true
      child.kill('SIGTERM')
    }, LOGIN_TIMEOUT_MS),
  }

  const collect = (chunk: unknown) => {
    if (session.output.length < MAX_OUTPUT_LENGTH) session.output += String(chunk)
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  child.once('error', (error) => {
    session.exited = true
    session.exitCode = null
    session.output += `\n${error.message}`
    clearTimeout(session.timer)
  })
  child.once('close', (code) => {
    session.exited = true
    session.exitCode = code
    clearTimeout(session.timer)
  })
  child.stdin?.on('error', () => undefined)

  sessions.set(provider, session)
}

/** Paste the user's authorization code into the waiting Claude login. */
export function submitLoginCode(provider: AiProviderKind, code: string): boolean {
  const session = sessions.get(provider)
  const trimmed = code.trim()
  if (!session || session.exited || !LOGIN_CODE_PATTERN.test(trimmed)) return false
  session.child.stdin?.write(`${trimmed}\n`)
  return true
}

export function cancelLoginSession(provider: AiProviderKind): void {
  const session = sessions.get(provider)
  if (session) {
    clearTimeout(session.timer)
    if (!session.exited) session.child.kill('SIGTERM')
    sessions.delete(provider)
  }
}

/**
 * What the settings UI needs to render the flow. An exited process is not
 * proof of a completed login (EOF on stdin also exits 0), so the route pairs
 * `exited` with a real connectivity check before calling it a success.
 */
export function getLoginSessionView(provider: AiProviderKind): LoginSessionView {
  const session = sessions.get(provider)
  if (!session) return { status: 'idle', url: null, userCode: null, needsCode: false, detail: null }

  const url =
    provider === 'claude'
      ? parseClaudeLoginUrl(session.output)
      : parseCodexDeviceAuth(session.output).url
  const userCode = provider === 'codex' ? parseCodexDeviceAuth(session.output).userCode : null
  const detailTail = stripCliDecorations(session.output).trim().slice(-300) || null

  if (session.exited) {
    const failed = session.exitCode !== 0 || session.timedOut
    return {
      status: failed ? 'failed' : 'exited',
      url,
      userCode,
      needsCode: false,
      detail: session.timedOut ? 'Login timed out' : detailTail,
    }
  }
  return {
    status: url ? 'awaiting' : 'starting',
    url,
    userCode,
    needsCode: provider === 'claude' && url !== null,
    detail: null,
  }
}

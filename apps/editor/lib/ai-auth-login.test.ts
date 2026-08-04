import { describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  cancelLoginSession,
  getLoginSessionView,
  parseClaudeLoginUrl,
  parseCodexDeviceAuth,
  startLoginSession,
  submitLoginCode,
} from './ai-auth-login'

const URL_SAMPLE =
  'https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a&state=Fky71ls'

// Shaped like `claude auth login` 2.1.220 output: the URL is an OSC-8
// hyperlink whose target and visible text are the same URL.
const CLAUDE_LOGIN_OUTPUT = [
  'Opening browser to sign in…',
  `If the browser didn't open, visit: ]8;;${URL_SAMPLE}${URL_SAMPLE}]8;;`,
  'Paste code here if prompted > ',
].join('\n')

// Shaped like `codex login --device-auth` 0.145.0 output (CSI-colored).
const CODEX_DEVICE_OUTPUT = [
  'Welcome to Codex [v[90m0.145.0[0m]',
  'Follow these steps to sign in with ChatGPT using device code authorization:',
  '1. Open this link in your browser and sign in to your account',
  '   [94mhttps://auth.openai.com/codex/device[0m',
  '2. Enter this one-time code [90m(expires in 15 minutes)[0m',
  '   [94m8SHR-NEZ7T[0m',
].join('\n')

describe('CLI login output parsing', () => {
  test('extracts a single copy of the claude OAuth URL from OSC-8 output', () => {
    expect(parseClaudeLoginUrl(CLAUDE_LOGIN_OUTPUT)).toBe(URL_SAMPLE)
  })

  test('still yields one URL when the terminal dropped the OSC escapes', () => {
    expect(parseClaudeLoginUrl(`visit: ${URL_SAMPLE}${URL_SAMPLE}`)).toBe(URL_SAMPLE)
  })

  test('extracts the codex device URL and one-time code from colored output', () => {
    expect(parseCodexDeviceAuth(CODEX_DEVICE_OUTPUT)).toEqual({
      url: 'https://auth.openai.com/codex/device',
      userCode: '8SHR-NEZ7T',
    })
  })

  test('yields nulls before the CLI has printed anything useful', () => {
    expect(parseClaudeLoginUrl('Opening browser…')).toBeNull()
    expect(parseCodexDeviceAuth('Welcome to Codex')).toEqual({ url: null, userCode: null })
  })
})

async function waitForStatus(
  provider: 'claude' | 'codex',
  done: (status: string) => boolean,
): Promise<void> {
  for (let i = 0; i < 40; i += 1) {
    if (done(getLoginSessionView(provider).status)) return
    await Bun.sleep(100)
  }
}

describe('login session lifecycle', () => {
  test('claude flow: URL appears, pasted code reaches stdin, session exits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pascal-login-claude-'))
    const command = join(directory, 'claude-fixture')
    const codePath = join(directory, 'pasted-code')
    await writeFile(
      command,
      `#!/bin/sh
printf 'If the browser did not open, visit: https://claude.com/cai/oauth/authorize?code=true&state=abc\\n'
printf 'Paste code here if prompted > '
read code
printf '%s' "$code" > ${JSON.stringify(codePath)}
`,
    )
    await chmod(command, 0o755)

    try {
      startLoginSession('claude', command)
      await waitForStatus('claude', (status) => status !== 'starting')

      const pending = getLoginSessionView('claude')
      expect(pending.status).toBe('awaiting')
      expect(pending.url).toBe('https://claude.com/cai/oauth/authorize?code=true&state=abc')
      expect(pending.needsCode).toBe(true)

      expect(submitLoginCode('claude', 'not a valid code!!')).toBe(false)
      expect(submitLoginCode('claude', 'AbC123#state-token')).toBe(true)
      await waitForStatus('claude', (status) => status === 'exited' || status === 'failed')

      expect(getLoginSessionView('claude').status).toBe('exited')
      expect(await Bun.file(codePath).text()).toBe('AbC123#state-token')
    } finally {
      cancelLoginSession('claude')
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('codex flow: device URL and code are exposed while the CLI polls', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pascal-login-codex-'))
    const command = join(directory, 'codex-fixture')
    await writeFile(
      command,
      `#!/bin/sh
printf '1. Open this link in your browser\\n   https://auth.openai.com/codex/device\\n'
printf '2. Enter this one-time code\\n   AAAA-BBBB\\n'
sleep 30
`,
    )
    await chmod(command, 0o755)

    try {
      startLoginSession('codex', command)
      await waitForStatus('codex', (status) => status !== 'starting')

      const pending = getLoginSessionView('codex')
      expect(pending.status).toBe('awaiting')
      expect(pending.url).toBe('https://auth.openai.com/codex/device')
      expect(pending.userCode).toBe('AAAA-BBBB')
      expect(pending.needsCode).toBe(false)

      cancelLoginSession('codex')
      expect(getLoginSessionView('codex').status).toBe('idle')
    } finally {
      cancelLoginSession('codex')
      await rm(directory, { recursive: true, force: true })
    }
  })

  test('a failing CLI surfaces as failed with its output tail', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pascal-login-fail-'))
    const command = join(directory, 'broken-fixture')
    await writeFile(command, '#!/bin/sh\necho "no browser available" >&2\nexit 1\n')
    await chmod(command, 0o755)

    try {
      startLoginSession('claude', command)
      await waitForStatus('claude', (status) => status === 'failed' || status === 'exited')

      const view = getLoginSessionView('claude')
      expect(view.status).toBe('failed')
      expect(view.detail).toContain('no browser available')
    } finally {
      cancelLoginSession('claude')
      await rm(directory, { recursive: true, force: true })
    }
  })
})

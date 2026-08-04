import { describe, expect, test } from 'bun:test'
import { describeAiFailure } from './ai-failure'

describe('what a failed modeling request tells the user', () => {
  // The failure the generic sentence was hiding: not a planning problem at
  // all, and the CLI even names the reset time.
  test('a spent usage limit says so, with the reset time', () => {
    const failure = describeAiFailure(
      new Error(
        "ERROR: You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Aug 8th, 2026 12:35 PM.",
      ),
    )
    expect(failure.status).toBe(429)
    expect(failure.error).toBe('ai_usage_limit')
    expect(failure.message).toContain('한도')
    expect(failure.message).toContain('Aug 8th, 2026 12:35 PM')
  })

  test('a usage limit with no stated reset still says what to do', () => {
    const failure = describeAiFailure(new Error('rate limit exceeded'))
    expect(failure.status).toBe(429)
    expect(failure.message).not.toContain('한도 리셋')
  })

  // Two failed schema attempts mean the instruction did not survive the trip
  // into a plan — ask the user to make it concrete instead of dead-ending.
  test('a plan that failed validation asks for a more concrete instruction', () => {
    const zodError = new Error('expected string, received null')
    zodError.name = 'ZodError'
    const failure = describeAiFailure(zodError)
    expect(failure.status).toBe(502)
    expect(failure.error).toBe('ai_invalid_plan')
    expect(failure.message).toContain('구체적으로')
  })

  test('anything else stays the generic sentence', () => {
    const failure = describeAiFailure(new Error('spawn failure'))
    expect(failure.status).toBe(502)
    expect(failure.message).toBe('The modeling agent could not produce a valid plan.')
  })

  test('a non-error value is handled', () => {
    expect(describeAiFailure(undefined).status).toBe(502)
  })
})

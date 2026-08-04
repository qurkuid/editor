/**
 * Turn a provider failure into what the user should actually be told.
 *
 * "The modeling agent could not produce a valid plan" was the answer to every
 * failure — including a Codex account that had simply run out of usage, which
 * is not a planning problem and has a different remedy (switch provider, or
 * wait for the reset the CLI even names). Recognise the failures a user can
 * act on; everything else stays the generic sentence.
 */

export type AiFailure = {
  status: number
  error: string
  message: string
}

export function describeAiFailure(raw: unknown): AiFailure {
  const text = raw instanceof Error ? raw.message : typeof raw === 'string' ? raw : ''

  if (/usage limit|rate limit/i.test(text)) {
    const reset = text.match(/try again at ([^.]+)/i)?.[1]
    return {
      status: 429,
      error: 'ai_usage_limit',
      message: `AI 사용 한도를 초과했습니다. 설정에서 다른 프로바이더로 전환하거나 잠시 후 다시 시도하세요.${
        reset ? ` (한도 리셋: ${reset.trim()})` : ''
      }`,
    }
  }

  if (/not logged in|login|auth/i.test(text) && /codex|claude/i.test(text)) {
    return {
      status: 503,
      error: 'ai_not_configured',
      message: 'AI 프로바이더 로그인이 풀렸습니다. 서버에서 다시 로그인해야 합니다.',
    }
  }

  // Both plan attempts came back but failed the schema contract — the model
  // understood something, just not precisely enough. Asking the user for a
  // more concrete instruction beats a dead-end sentence.
  if (raw instanceof Error && raw.name === 'ZodError') {
    return {
      status: 502,
      error: 'ai_invalid_plan',
      message:
        '요청을 실행 계획으로 옮기지 못했습니다. 대상(어떤 요소인지)·위치·치수를 조금 더 구체적으로 적어 다시 요청해 주세요.',
    }
  }

  return {
    status: 502,
    error: 'ai_request_failed',
    message: 'The modeling agent could not produce a valid plan.',
  }
}

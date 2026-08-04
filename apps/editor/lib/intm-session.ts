/**
 * INTM login as this app's credential.
 *
 * The floorplan app is served from a sub-path of the same origin as INTM
 * (`intm.kr/floorplan`), so INTM's HttpOnly `session_token` cookie already
 * arrives on every request here. Verification therefore forwards that cookie
 * back to INTM's own session endpoint rather than validating the JWT locally.
 *
 * That choice is deliberate: this repository is public, so it must never hold
 * INTM's signing secret. Asking INTM "is this session valid?" needs no secret
 * at all, and keeps INTM the single authority on session lifetime, refresh and
 * revocation.
 */

export const INTM_SESSION_COOKIE = 'session_token'

export type IntmUser = {
  id?: string
  email?: string
  role?: string
  companyId?: string
  name?: string
}

/** Base URL of the INTM instance backing this deployment. */
export function intmBaseUrl(): string | null {
  const raw = process.env.INTM_BASE_URL?.trim()
  return raw ? raw.replace(/\/+$/, '') : null
}

/**
 * Whether requests must carry a valid INTM session.
 *
 * Gating keys off `INTM_BASE_URL` being configured: production sets it and is
 * protected, local dev leaves it unset and stays open. Without this the dev
 * server — which has no INTM cookie and no INTM to ask — would lock itself out.
 */
export function intmAuthEnabled(): boolean {
  if (process.env.INTM_AUTH_DISABLED === 'true') return false
  return intmBaseUrl() !== null
}

/**
 * INTM's login form accepts a `redirect` only when it is a bare path — its
 * guard against being used as an open redirect. We are mounted on INTM's own
 * origin, so hand it the path; an absolute URL was silently discarded and the
 * user landed on INTM's portal instead of back here.
 */
export function intmLoginUrl(returnTo: string): string {
  const base = intmBaseUrl() ?? ''
  let target = returnTo
  try {
    const url = new URL(returnTo)
    if (base && url.origin === new URL(base).origin) target = `${url.pathname}${url.search}`
  } catch {
    // Already relative — pass it through untouched.
  }
  return `${base}/login?redirect=${encodeURIComponent(target)}`
}

type SessionResponse = { user?: IntmUser | null }

/**
 * Resolve the caller's INTM user, or null when unauthenticated.
 *
 * `cookieHeader` is the raw inbound `Cookie` header — forwarded verbatim so
 * the HttpOnly session cookie reaches INTM untouched. Network failures resolve
 * to null (fail closed): an unreachable INTM must not become an open door.
 */
export async function fetchIntmUser(
  cookieHeader: string | null | undefined,
  fetcher: typeof fetch = fetch,
): Promise<IntmUser | null> {
  const base = intmBaseUrl()
  if (!base || !cookieHeader?.includes(`${INTM_SESSION_COOKIE}=`)) return null

  try {
    const response = await fetcher(`${base}/api/auth/session`, {
      headers: { cookie: cookieHeader },
      // Never let a CDN or the Next data cache answer an auth question.
      cache: 'no-store',
      redirect: 'manual',
    })
    if (!response.ok) return null
    const body = (await response.json()) as SessionResponse
    return body.user ?? null
  } catch {
    return null
  }
}

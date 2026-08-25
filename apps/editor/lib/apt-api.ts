import { NextResponse } from 'next/server'

/**
 * Guard rails for the PUBLIC, unauthenticated `/api/apartments/*` routes.
 *
 * These endpoints sit outside the INTM login gate, so without a per-IP
 * limiter anyone could enumerate 20k apartment ids and turn this host into
 * a K-apt scraping cannon. Same fixed-window design as the scene API's
 * limiter (`scene-api-security.ts`), keyed per route class so an expensive
 * upstream scrape gets a much smaller budget than an in-memory lookup.
 */

const WINDOW_MS = 60_000

type RateBucket = { resetAt: number; count: number }

const rateBuckets = new Map<string, RateBucket>()

export function aptRateLimit(
  request: Request,
  route: string,
  limitPerMinute: number,
): NextResponse | null {
  const now = Date.now()
  const key = `${route}:${clientIp(request)}`
  const bucket = rateBuckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + WINDOW_MS })
    return null
  }
  bucket.count++
  if (bucket.count <= limitPerMinute) return null

  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
  const response = aptJson(request, { code: 'RATE_LIMITED' }, 429)
  response.headers.set('Retry-After', String(retryAfter))
  return response
}

export function aptJson(
  _request: Request,
  body: unknown,
  status = 200,
  cacheControl = 'no-store',
): NextResponse {
  const response = NextResponse.json(body, { status })
  response.headers.set('Cache-Control', cacheControl)
  response.headers.set('X-Content-Type-Options', 'nosniff')
  return response
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  if (forwarded) return forwarded
  return request.headers.get('x-real-ip') ?? 'unknown'
}

import { type NextRequest, NextResponse } from 'next/server'
import { isAppRootPath, isPublicAssetPath, isPublicRoutePath } from '@/lib/auth-gate'
import { withBasePath } from '@/lib/base-path'
import { fetchIntmUser, intmAuthEnabled, intmLoginUrl } from '@/lib/intm-session'

/**
 * Gate the whole app behind an INTM login (see `lib/intm-session.ts`).
 *
 * Off entirely when `INTM_BASE_URL` is unset, so local dev is unaffected.
 */
export async function middleware(request: NextRequest) {
  if (!intmAuthEnabled()) return NextResponse.next()
  // Files are exempt, and must be — a chunk answered with a login page stops
  // the app booting. Checked here rather than in `matcher` because the matcher
  // does not see the basePath the request actually carries.
  if (isPublicAssetPath(request.nextUrl.pathname)) return NextResponse.next()
  // The apartment map (page + data APIs) is deliberately public.
  if (isPublicRoutePath(request.nextUrl.pathname)) return NextResponse.next()

  const user = await fetchIntmUser(request.headers.get('cookie'))
  if (user) return NextResponse.next()

  // Behind a reverse proxy `request.url` is the INTERNAL address
  // (localhost:3022), so sending that as the return URL lands the user
  // somewhere unreachable after login. Rebuild it from the forwarded headers,
  // which carry the address the browser actually used.
  const target = intmLoginUrl(publicUrl(request))

  // An unauthenticated API call gets a 401 rather than a login page — an HTML
  // redirect would surface to the client as an unparseable JSON response.
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'INTM authentication required', login: target },
      { status: 401 },
    )
  }

  // The public front door: an anonymous visit to the app ROOT lands on the
  // apartment map (the old apt.intm.kr behavior), not a login wall. Members
  // hitting `/` never reach this branch and keep the editor.
  if (isAppRootPath(request.nextUrl.pathname)) {
    const mapUrl = new URL(publicUrl(request))
    mapUrl.pathname = withBasePath('/apt')
    mapUrl.search = ''
    return NextResponse.redirect(mapUrl)
  }

  return NextResponse.redirect(target)
}

/** The URL the browser asked for, as opposed to the proxy's internal one. */
function publicUrl(request: NextRequest): string {
  const url = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const proto = request.headers.get('x-forwarded-proto')
  if (host) {
    // Assigning `host` keeps any existing port, so the internal 3022 survived
    // and the return URL still pointed somewhere the browser can't reach.
    url.host = host
    if (!host.includes(':')) url.port = ''
  }
  if (proto) url.protocol = `${proto}:`
  return url.toString()
}

export const config = {
  // Everything reaches the middleware; `isPublicAssetPath` decides. Excluding
  // assets here instead looked right and silently failed under the basePath.
  matcher: ['/:path*'],
}

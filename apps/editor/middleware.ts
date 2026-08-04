import { type NextRequest, NextResponse } from 'next/server'
import { fetchIntmUser, intmAuthEnabled, intmLoginUrl } from '@/lib/intm-session'

/**
 * Gate the whole app behind an INTM login (see `lib/intm-session.ts`).
 *
 * Off entirely when `INTM_BASE_URL` is unset, so local dev is unaffected.
 */
export async function middleware(request: NextRequest) {
  if (!intmAuthEnabled()) return NextResponse.next()

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

  return NextResponse.redirect(target)
}

/** The URL the browser asked for, as opposed to the proxy's internal one. */
function publicUrl(request: NextRequest): string {
  const url = new URL(request.url)
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  const proto = request.headers.get('x-forwarded-proto')
  if (host) url.host = host
  if (proto) url.protocol = `${proto}:`
  return url.toString()
}

export const config = {
  // Static assets and Next internals stay public; everything else is gated.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|fonts/|hdri/|demos/).*)'],
}

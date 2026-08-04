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

  // `request.url` already carries the deployment's basePath, so INTM sends the
  // user back to the exact floorplan page they asked for.
  const target = intmLoginUrl(request.url)

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

export const config = {
  // Static assets and Next internals stay public; everything else is gated.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|fonts/|hdri/|demos/).*)'],
}

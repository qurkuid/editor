/**
 * Which requests the INTM login gate should let through untouched.
 *
 * Gating a static file is not merely wasteful, it is broken: a JS chunk
 * answered with a login page is not a JS chunk, so the app never boots. It is
 * also pointless — everything under `_next/` and `public/` is served to any
 * browser that loads the app at all.
 */

const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

/**
 * True for files, false for pages and API routes.
 *
 * The basePath has to come off first. Middleware matchers are tested against
 * the full request path, so a matcher written as `_next/static` never matched
 * `/floorplan/_next/static/...` and every chunk went through the gate.
 *
 * Pages and API routes carry no file extension; assets do. That is a surer
 * test than listing the directories under `public/`, which drift.
 */
export function isPublicAssetPath(pathname: string, basePath = BASE_PATH): boolean {
  const path = stripBasePath(pathname, basePath)

  if (path.startsWith('/_next/')) return true
  return path.slice(path.lastIndexOf('/') + 1).includes('.')
}

/**
 * The apartment map is the public front door of the app; its page and data
 * APIs bypass the login gate. `/apt` matches exactly (not as a prefix) so
 * that `/apt/trace` — the map→editor bridge page — still goes through the
 * gate and can answer with a login redirect.
 */
export function isPublicRoutePath(pathname: string, basePath = BASE_PATH): boolean {
  const path = stripBasePath(pathname, basePath)

  if (path === '/apt' || path === '/apt/') return true
  return path === '/api/apartments' || path.startsWith('/api/apartments/')
}

/** The app root — where an anonymous visitor is sent to the map, not a login wall. */
export function isAppRootPath(pathname: string, basePath = BASE_PATH): boolean {
  const path = stripBasePath(pathname, basePath)
  return path === '/' || path === ''
}

function stripBasePath(pathname: string, basePath: string): string {
  return basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))
    ? pathname.slice(basePath.length) || '/'
    : pathname
}

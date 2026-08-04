import { headers } from 'next/headers'
import { BASE_PATH, withBasePath } from './base-path'

/**
 * Absolute URL for one of this app's own routes, as seen from the server.
 *
 * A server component cannot fetch a relative path, so it has to rebuild its own
 * address from the forwarded headers. Under a sub-path deployment that address
 * must carry the basePath: `https://intm.kr` + `/api/scenes/x` resolves against
 * the ORIGIN and lands on INTM, which knows nothing about scenes and answers
 * 404 — so every scene reported itself missing and the editor never mounted.
 */

/** Assemble the URL. Split out from the header lookup so it can be tested. */
export function appUrl(origin: string, path: string, basePath = BASE_PATH): string {
  // `.origin` drops any path or trailing slash on a configured APP_URL, so the
  // basePath is added exactly once however that variable happens to be written.
  return `${new URL(origin).origin}${withBasePath(path, basePath)}`
}

export async function selfUrl(path: string): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return appUrl(configured, path)

  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  return appUrl(host ? `${proto}://${host}` : 'http://localhost:3000', path)
}

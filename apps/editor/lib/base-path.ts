// Next rewrites `next/image` and `<Link>` for `basePath`, but not raw `fetch`
// or URLs handed to three.js loaders. Serving under `intm.kr/floorplan` means an
// app-absolute `/api/...` resolves against the ORIGIN, hitting the unrelated app
// mounted at `/` instead of ours — so every such path has to be prefixed here.
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export function withBasePath(path: string, basePath = BASE_PATH): string {
  if (!basePath) return path
  if (!path.startsWith('/')) return path
  if (path.startsWith(`${basePath}/`) || path === basePath) return path
  return `${basePath}${path}`
}

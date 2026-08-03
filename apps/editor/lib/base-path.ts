// Next rewrites `next/image` and `<Link>` for `basePath`, but not raw `fetch`
// or URLs handed to three.js loaders. Serving under `intm.kr/floorplan` means an
// app-absolute `/api/...` resolves against the ORIGIN, hitting the unrelated app
// mounted at `/` instead of ours — so every such path has to be prefixed here.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export function withBasePath(path: string): string {
  if (!BASE_PATH) return path
  if (!path.startsWith('/')) return path
  if (path.startsWith(`${BASE_PATH}/`) || path === BASE_PATH) return path
  return `${BASE_PATH}${path}`
}

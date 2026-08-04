// Mirrors `apps/editor/lib/base-path.ts` (`withBasePath`) and
// `apps/editor/image-loader.ts`. `next/image` call sites already get the
// basePath prefix from the app's custom image loader — this helper covers
// everything else that reaches the browser as a raw URL (plain `<img src>`,
// CSS `url()`, cursor images, Howler SFX sources, …) from `packages/editor`,
// `packages/nodes`, and `apps/editor` alike. Lives here (not the app) for the
// same reason `useLocale` does: all three layers need it. See
// `packages/editor/src/i18n/locale-store.ts`.
export function assetPath(path: string): string {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? ''
  if (!basePath) return path
  if (/^(?:https?:)?\/\//.test(path) || path.startsWith('data:') || path.startsWith('blob:')) {
    return path
  }
  if (!path.startsWith('/')) return path
  if (path === basePath || path.startsWith(`${basePath}/`)) return path
  return `${basePath}${path}`
}

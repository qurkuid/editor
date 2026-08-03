// Next prefixes `basePath` onto the /_next/image route but not onto the `src`
// it hands the loader, and with `unoptimized` it emits that raw `src` straight
// into the DOM. Either way an app-absolute `/icons/x.webp` resolves against the
// origin root — under intm.kr/floorplan that is a different app entirely, so
// every local image 404s. Prefixing here fixes all call sites at once.
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? ''

export default function imageLoader({ src }: { src: string }): string {
  if (!BASE_PATH) return src
  if (/^(?:https?:)?\/\//.test(src) || src.startsWith('data:') || src.startsWith('blob:')) {
    return src
  }
  if (!src.startsWith('/')) return src
  if (src === BASE_PATH || src.startsWith(`${BASE_PATH}/`)) return src
  return `${BASE_PATH}${src}`
}

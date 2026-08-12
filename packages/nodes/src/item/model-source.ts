import { resolveCdnUrl } from '@pascal-app/viewer'

export function resolveItemModelSource(source: string): string {
  if (source.startsWith('asset://')) return source
  return resolveCdnUrl(source) ?? ''
}

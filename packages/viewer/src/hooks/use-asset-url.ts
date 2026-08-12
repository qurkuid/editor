import { loadAssetUrl } from '@pascal-app/core'
import { useEffect, useState } from 'react'

export type AssetUrlState =
  | { readonly status: 'loading' }
  | { readonly status: 'missing' }
  | { readonly status: 'resolved'; readonly url: string }

export function useAssetUrlState(url: string): AssetUrlState {
  const [state, setState] = useState<AssetUrlState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    void loadAssetUrl(url).then((result) => {
      if (cancelled) return
      setState(result ? { status: 'resolved', url: result } : { status: 'missing' })
    })
    return () => {
      cancelled = true
    }
  }, [url])

  return state
}

/**
 * Resolves an asset:// URL to a blob URL for use with Three.js loaders.
 * Returns null while loading or if resolution fails.
 */
export function useAssetUrl(url: string): string | null {
  const state = useAssetUrlState(url)
  return state.status === 'resolved' ? state.url : null
}

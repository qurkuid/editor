'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { RawPainterProduct } from './rawpainter-contract'

/**
 * A starred material. Library and scene entries resolve live against the
 * material registry / scene store at render time; RawPainter entries carry the
 * full product so a favorite survives reloads without refetching the catalog.
 */
export type MaterialFavorite =
  | {
      readonly kind: 'library'
      readonly id: string
      readonly label: string
      readonly thumbnailUrl?: string
      readonly color?: string
    }
  | { readonly kind: 'scene'; readonly id: string }
  | { readonly kind: 'rawpainter'; readonly product: RawPainterProduct }

export function materialFavoriteKey(favorite: MaterialFavorite): string {
  if (favorite.kind === 'rawpainter') return `rawpainter:${String(favorite.product.id)}`
  return `${favorite.kind}:${favorite.id}`
}

type MaterialFavoritesState = {
  favorites: Record<string, MaterialFavorite>
  toggleFavorite: (favorite: MaterialFavorite) => void
}

function isFavorite(value: unknown): value is MaterialFavorite {
  const favorite = value as Partial<MaterialFavorite> | null
  if (favorite?.kind === 'rawpainter') {
    return typeof (favorite as { product?: { id?: unknown } }).product?.id !== 'undefined'
  }
  return (
    (favorite?.kind === 'library' || favorite?.kind === 'scene') &&
    typeof (favorite as { id?: unknown }).id === 'string'
  )
}

const useMaterialFavorites = create<MaterialFavoritesState>()(
  persist(
    (set) => ({
      favorites: {},
      toggleFavorite: (favorite) =>
        set((state) => {
          const key = materialFavoriteKey(favorite)
          const next = { ...state.favorites }
          if (next[key]) delete next[key]
          else next[key] = favorite
          return { favorites: next }
        }),
    }),
    {
      name: 'pascal-material-favorites',
      merge: (persistedState, currentState) => {
        const persisted =
          (persistedState as Partial<MaterialFavoritesState> | undefined)?.favorites ?? {}
        return {
          ...currentState,
          favorites: Object.fromEntries(
            Object.entries(persisted).filter(([, value]) => isFavorite(value)),
          ),
        }
      },
      partialize: (state) => ({ favorites: state.favorites }),
    },
  ),
)

export default useMaterialFavorites

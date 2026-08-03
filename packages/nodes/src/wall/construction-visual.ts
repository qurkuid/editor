import {
  buildWallConstructionLayerSpans,
  type WallBandConstruction,
  type WallConstructionLayer,
} from '@pascal-app/core'
import type { WallConstructionDisplayMode } from '@pascal-app/editor'

export const WALL_LAYER_COLORS: Record<WallConstructionLayer['kind'], string> = {
  'gypsum-board': '#ece9df',
  mdf: '#b98a58',
  'timber-stud': '#d39a55',
  cavity: '#8bc9e8',
  finish: '#8fb8d8',
  custom: '#8f93a2',
}

export type WallStudPlacement = {
  center: number
  ratio: number
}

export function resolveWallConstructionDisplay(
  mode: WallConstructionDisplayMode,
  selected: boolean,
) {
  if (!selected || mode === 'finish') {
    return { baseOpacity: 1, fullPreview: null, showTopSection: true } as const
  }
  return { baseOpacity: 0, fullPreview: mode, showTopSection: true } as const
}

export function buildWallTopSectionSpans(construction: WallBandConstruction) {
  return buildWallConstructionLayerSpans(construction).filter((span) => span.kind !== 'cavity')
}

export function buildWallStudPlacements(
  length: number,
  spacing = 0.3,
  memberWidth = 0.033,
): WallStudPlacement[] {
  if (!Number.isFinite(length) || length <= 0) return []

  const safeMemberWidth = Math.min(length, Math.max(0.001, memberWidth))
  const safeSpacing = Math.max(safeMemberWidth, spacing)
  const centers: number[] = []

  for (let center = safeMemberWidth / 2; center < length; center += safeSpacing) {
    centers.push(center)
  }

  const endCenter = Math.max(safeMemberWidth / 2, length - safeMemberWidth / 2)
  if (centers.length === 0 || centers.at(-1)! < endCenter) centers.push(endCenter)

  return centers.map((center) => ({ center, ratio: center / length }))
}

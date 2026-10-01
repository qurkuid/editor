import type { WallConstructionLayer } from '@pascal-app/core'

export const WALL_LAYER_COLORS: Record<WallConstructionLayer['kind'], string> = {
  concrete: '#a3a3a3',
  'gypsum-board': '#ece9df',
  mdf: '#b98a58',
  'timber-stud': '#d39a55',
  cavity: '#8bc9e8',
  finish: '#8fb8d8',
  custom: '#8f93a2',
  glass: '#bfe3f2',
  masonry: '#c96f4a',
  'glass-block': '#9fd8d2',
}

export type WallStudPlacement = {
  center: number
  ratio: number
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
  const endCenter = Math.max(safeMemberWidth / 2, length - safeMemberWidth / 2)

  for (let center = safeMemberWidth / 2; center <= endCenter; center += safeSpacing) {
    centers.push(center)
  }

  if (centers.length === 0 || centers.at(-1)! < endCenter) centers.push(endCenter)

  return centers.map((center) => ({ center, ratio: center / length }))
}

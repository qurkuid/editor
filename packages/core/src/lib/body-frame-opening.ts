export type RoundedFrameOpeningGeometry = {
  readonly width: number
  readonly height: number
  readonly openingWidth: number
  readonly openingHeight: number
  readonly openingOffsetX: number
  readonly openingOffsetY: number
  readonly topCornerRadius: number
}

export type RoundedFrameOpeningPlacement = {
  readonly centerOffsetX: number
  readonly centerOffsetY: number
  readonly minCenterOffsetX: number
  readonly maxCenterOffsetX: number
  readonly minCenterOffsetY: number
  readonly maxCenterOffsetY: number
  readonly maxTopCornerRadius: number
}

export class RoundedFrameOpeningBoundsError extends RangeError {
  readonly centerOffsetX: number
  readonly centerOffsetY: number

  constructor(centerOffsetX: number, centerOffsetY: number) {
    super('Opening must remain inside the rounded frame wall')
    this.name = 'RoundedFrameOpeningBoundsError'
    this.centerOffsetX = centerOffsetX
    this.centerOffsetY = centerOffsetY
  }
}

function topBoundaryAtX(geometry: RoundedFrameOpeningGeometry, x: number): number {
  const radius = geometry.topCornerRadius
  if (radius === 0 || (x >= radius && x <= geometry.width - radius)) return geometry.height
  const centerX = x < radius ? radius : geometry.width - radius
  const distanceX = x - centerX
  return geometry.height - radius + Math.sqrt(Math.max(0, radius ** 2 - distanceX ** 2))
}

function horizontalInsetAtY(geometry: RoundedFrameOpeningGeometry, y: number): number {
  const radius = geometry.topCornerRadius
  if (radius === 0 || y <= geometry.height - radius) return 0
  const distanceY = y - (geometry.height - radius)
  return radius - Math.sqrt(Math.max(0, radius ** 2 - distanceY ** 2))
}

type OpeningLimits = Omit<RoundedFrameOpeningPlacement, 'maxTopCornerRadius'>

function calculateOpeningLimits(geometry: RoundedFrameOpeningGeometry): OpeningLimits {
  const centeredX = (geometry.width - geometry.openingWidth) / 2
  const centeredY = (geometry.height - geometry.openingHeight) / 2
  const openingTop = geometry.openingOffsetY + geometry.openingHeight
  const horizontalInset = horizontalInsetAtY(geometry, openingTop)
  const topBoundary = Math.min(
    topBoundaryAtX(geometry, geometry.openingOffsetX),
    topBoundaryAtX(geometry, geometry.openingOffsetX + geometry.openingWidth),
  )
  return {
    centerOffsetX: geometry.openingOffsetX - centeredX,
    centerOffsetY: geometry.openingOffsetY - centeredY,
    minCenterOffsetX: horizontalInset - centeredX,
    maxCenterOffsetX: geometry.width - horizontalInset - geometry.openingWidth - centeredX,
    minCenterOffsetY: -centeredY,
    maxCenterOffsetY: topBoundary - geometry.openingHeight - centeredY,
  }
}

function openingFits(geometry: RoundedFrameOpeningGeometry): boolean {
  const limits = calculateOpeningLimits(geometry)
  return (
    limits.centerOffsetX >= limits.minCenterOffsetX &&
    limits.centerOffsetX <= limits.maxCenterOffsetX &&
    limits.centerOffsetY >= limits.minCenterOffsetY &&
    limits.centerOffsetY <= limits.maxCenterOffsetY
  )
}

function calculateMaximumTopCornerRadius(geometry: RoundedFrameOpeningGeometry): number {
  let minimum = 0
  let maximum = Math.min(geometry.width / 2, geometry.height)
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const candidate = (minimum + maximum) / 2
    if (openingFits({ ...geometry, topCornerRadius: candidate })) minimum = candidate
    else maximum = candidate
  }
  return minimum
}

export function calculateRoundedFrameOpeningPlacement(
  geometry: RoundedFrameOpeningGeometry,
): RoundedFrameOpeningPlacement {
  return {
    ...calculateOpeningLimits(geometry),
    maxTopCornerRadius: calculateMaximumTopCornerRadius(geometry),
  }
}

export function assertRoundedFrameOpeningPlacement(
  geometry: RoundedFrameOpeningGeometry,
  centerOffsetX: number,
  centerOffsetY: number,
): void {
  const centeredX = (geometry.width - geometry.openingWidth) / 2
  const centeredY = (geometry.height - geometry.openingHeight) / 2
  const placement = calculateOpeningLimits({
    ...geometry,
    openingOffsetX: centeredX + centerOffsetX,
    openingOffsetY: centeredY + centerOffsetY,
  })
  const inside =
    Number.isFinite(centerOffsetX) &&
    Number.isFinite(centerOffsetY) &&
    centerOffsetX >= placement.minCenterOffsetX &&
    centerOffsetX <= placement.maxCenterOffsetX &&
    centerOffsetY >= placement.minCenterOffsetY &&
    centerOffsetY <= placement.maxCenterOffsetY
  if (!inside) throw new RoundedFrameOpeningBoundsError(centerOffsetX, centerOffsetY)
}

import type {
  FurnitureAssembly,
  FurnitureBay,
  FurnitureFront,
  FurnitureKind,
  FurnitureTier,
} from '../../schema/nodes/furniture'
import { FurnitureAssemblySchema, FurnitureFrontSchema } from '../../schema/nodes/furniture'
import { normalizeFurnitureAssembly } from './normalize'

export interface CreateDefaultFurnitureAssemblyOptions {
  furnitureKind?: FurnitureKind
  dimensions?: Partial<FurnitureAssembly['dimensions']>
  bayCount?: number
}

export interface SetFurnitureTierInteriorOptions {
  bayId: string
  tierId: string
  shelfCount: number
  hanger: boolean
}

export interface SetFurnitureTierFrontOptions {
  bayId: string
  tierId: string
  front: FurnitureFront
}

export interface InsertFurnitureBayOptions {
  afterBayId: string
  newWidth?: number
}

export interface DeleteFurnitureBayOptions {
  bayId: string
}

export interface ResizeFurnitureBayOptions {
  bayId: string
  width: number
}

export interface InsertFurnitureTierOptions {
  bayId: string
  afterTierId: string
  newHeight?: number
}

export interface DeleteFurnitureTierOptions {
  bayId: string
  tierId: string
}

export interface ResizeFurnitureTierOptions {
  bayId: string
  tierId: string
  height: number
}

function assertPositiveFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${label} must be a finite positive number.`)
  }
}

function nextAvailableId(base: string, usedIds: Set<string>): string {
  if (!usedIds.has(base)) {
    usedIds.add(base)
    return base
  }

  let suffix = 2
  while (usedIds.has(`${base}-${suffix}`)) suffix += 1
  const id = `${base}-${suffix}`
  usedIds.add(id)
  return id
}

function allFurnitureBays(assembly: FurnitureAssembly): FurnitureBay[] {
  return [...assembly.bays, ...(assembly.backBays ?? []), ...(assembly.upperBays ?? [])]
}

function usedTierIds(assembly: FurnitureAssembly): Set<string> {
  return new Set(allFurnitureBays(assembly).flatMap((bay) => bay.tiers.map((tier) => tier.id)))
}

function usedFixtureIds(assembly: FurnitureAssembly): Set<string> {
  return new Set([
    ...assembly.fixtures.map((fixture) => fixture.id),
    ...allFurnitureBays(assembly).flatMap((bay) =>
      bay.tiers.flatMap((tier) => tier.fixtures.map((fixture) => fixture.id)),
    ),
  ])
}

function resizeTierContents(tier: FurnitureTier, height: number): FurnitureTier {
  if (tier.height === height) return tier
  const scale = height / tier.height
  return {
    ...tier,
    height,
    shelves: {
      ...tier.shelves,
      heights: tier.shelves.heights.map((shelfHeight) => shelfHeight * scale),
    },
    internalDrawers: {
      ...tier.internalDrawers,
      heights: tier.internalDrawers.heights.map((drawerHeight) => drawerHeight * scale),
    },
  }
}

function validateAssembly(candidate: FurnitureAssembly): FurnitureAssembly {
  FurnitureAssemblySchema.parse(candidate)
  return candidate
}

function findBay(assembly: FurnitureAssembly, bayId: string): [FurnitureBay, number] {
  const index = assembly.bays.findIndex((bay) => bay.id === bayId)
  if (index < 0) throw new RangeError(`Furniture bay "${bayId}" was not found.`)
  return [assembly.bays[index]!, index]
}

function findTier(bay: FurnitureBay, tierId: string): [FurnitureTier, number] {
  const index = bay.tiers.findIndex((tier) => tier.id === tierId)
  if (index < 0) {
    throw new RangeError(`Furniture tier "${tierId}" was not found in bay "${bay.id}".`)
  }
  return [bay.tiers[index]!, index]
}

export function createDefaultFurnitureAssembly(
  options: CreateDefaultFurnitureAssemblyOptions = {},
): FurnitureAssembly {
  const dimensions = {
    width: options.dimensions?.width ?? 1.2,
    height: options.dimensions?.height ?? 2.4,
    depth: options.dimensions?.depth ?? 0.6,
  }
  const bayCount = options.bayCount ?? 1
  if (!Number.isInteger(bayCount) || bayCount < 1 || bayCount > 100) {
    throw new RangeError('bayCount must be an integer from 1 to 100.')
  }
  const baseHeight = Math.min(0.05, dimensions.height / 4)
  const tierHeight = dimensions.height - baseHeight

  return normalizeFurnitureAssembly({
    furnitureKind: options.furnitureKind ?? 'wardrobe',
    dimensions,
    bays: Array.from({ length: bayCount }, (_, index) => ({
      id: `bay-${index}`,
      width: dimensions.width / bayCount,
      base: { type: 'plinth', height: baseHeight },
      kickplate: true,
      endPanels: { left: false, right: false },
      tiers: [{ id: `bay-${index}-tier-0`, height: tierHeight }],
    })),
  })
}

export function resizeFurnitureAssembly(
  assembly: FurnitureAssembly,
  dimensions: Partial<FurnitureAssembly['dimensions']>,
): FurnitureAssembly {
  const nextDimensions = FurnitureAssemblySchema.shape.dimensions.parse({
    ...assembly.dimensions,
    ...dimensions,
  })
  const widthScale = nextDimensions.width / assembly.dimensions.width
  return FurnitureAssemblySchema.parse({
    ...assembly,
    dimensions: nextDimensions,
    bays: assembly.bays.map((bay) => ({ ...bay, width: bay.width * widthScale })),
  })
}

export function setFurnitureKind(
  assembly: FurnitureAssembly,
  furnitureKind: FurnitureKind,
): FurnitureAssembly {
  return FurnitureAssemblySchema.parse({ ...assembly, furnitureKind })
}

export function setFurnitureTierInterior(
  assembly: FurnitureAssembly,
  options: SetFurnitureTierInteriorOptions,
): FurnitureAssembly {
  if (!Number.isInteger(options.shelfCount) || options.shelfCount < 0 || options.shelfCount > 8) {
    throw new RangeError('shelfCount must be an integer from 0 to 8.')
  }
  if (typeof options.hanger !== 'boolean') {
    throw new TypeError('hanger must be a boolean.')
  }

  const bay = assembly.bays.find((candidate) => candidate.id === options.bayId)
  if (!bay) throw new RangeError(`Furniture bay "${options.bayId}" was not found.`)

  const tier = bay.tiers.find((candidate) => candidate.id === options.tierId)
  if (!tier) {
    throw new RangeError(
      `Furniture tier "${options.tierId}" was not found in bay "${options.bayId}".`,
    )
  }

  const heights = Array.from(
    { length: options.shelfCount },
    (_, index) => (tier.height * (index + 1)) / (options.shelfCount + 1),
  )
  const shelvesMatch =
    tier.shelves.count === options.shelfCount &&
    tier.shelves.heights.length === heights.length &&
    tier.shelves.heights.every((height, index) => height === heights[index])

  if (shelvesMatch && tier.hanger === options.hanger) return assembly

  return {
    ...assembly,
    bays: assembly.bays.map((candidateBay) =>
      candidateBay.id !== options.bayId
        ? candidateBay
        : {
            ...candidateBay,
            tiers: candidateBay.tiers.map((candidateTier) =>
              candidateTier.id !== options.tierId
                ? candidateTier
                : {
                    ...candidateTier,
                    shelves: { count: options.shelfCount, heights },
                    hanger: options.hanger,
                  },
            ),
          },
    ),
  }
}

export function setFurnitureTierFront(
  assembly: FurnitureAssembly,
  options: SetFurnitureTierFrontOptions,
): FurnitureAssembly {
  const bay = assembly.bays.find((candidate) => candidate.id === options.bayId)
  if (!bay) throw new RangeError(`Furniture bay "${options.bayId}" was not found.`)

  const tier = bay.tiers.find((candidate) => candidate.id === options.tierId)
  if (!tier) {
    throw new RangeError(
      `Furniture tier "${options.tierId}" was not found in bay "${options.bayId}".`,
    )
  }

  const front = FurnitureFrontSchema.parse(options.front)
  if (JSON.stringify(tier.front) === JSON.stringify(front)) return assembly

  return {
    ...assembly,
    bays: assembly.bays.map((candidateBay) =>
      candidateBay.id !== options.bayId
        ? candidateBay
        : {
            ...candidateBay,
            tiers: candidateBay.tiers.map((candidateTier) =>
              candidateTier.id !== options.tierId ? candidateTier : { ...candidateTier, front },
            ),
          },
    ),
  }
}

export function insertFurnitureBay(
  assembly: FurnitureAssembly,
  options: InsertFurnitureBayOptions,
): FurnitureAssembly {
  const [anchor, anchorIndex] = findBay(assembly, options.afterBayId)
  const width = options.newWidth ?? anchor.width / 2
  assertPositiveFinite(width, 'newWidth')
  const anchorWidth = anchor.width - width
  assertPositiveFinite(anchorWidth, 'remaining bay width')

  const bayIds = new Set(allFurnitureBays(assembly).map((bay) => bay.id))
  const tierIds = usedTierIds(assembly)
  const fixtureIds = usedFixtureIds(assembly)
  const newBayId = nextAvailableId(`${anchor.id}-copy`, bayIds)
  const newBay: FurnitureBay = {
    ...anchor,
    id: newBayId,
    width,
    tiers: anchor.tiers.map((tier, tierIndex) => {
      const id = nextAvailableId(`${newBayId}-tier-${tierIndex}`, tierIds)
      return {
        ...tier,
        id,
        fixtures: tier.fixtures.map((fixture, fixtureIndex) => ({
          ...fixture,
          id: nextAvailableId(`${id}-fixture-${fixtureIndex}`, fixtureIds),
        })),
      }
    }),
  }
  const bays = assembly.bays.map((bay, index) =>
    index === anchorIndex ? { ...bay, width: anchorWidth } : bay,
  )
  bays.splice(anchorIndex + 1, 0, newBay)
  return validateAssembly({ ...assembly, bays })
}

export function deleteFurnitureBay(
  assembly: FurnitureAssembly,
  options: DeleteFurnitureBayOptions,
): FurnitureAssembly {
  const [target, targetIndex] = findBay(assembly, options.bayId)
  if (assembly.bays.length === 1) {
    throw new RangeError('The final furniture bay cannot be deleted.')
  }
  const compensationIndex = targetIndex > 0 ? targetIndex - 1 : targetIndex + 1
  const compensationId = assembly.bays[compensationIndex]!.id
  const bays = assembly.bays
    .filter((bay) => bay.id !== target.id)
    .map((bay) => (bay.id === compensationId ? { ...bay, width: bay.width + target.width } : bay))
  return validateAssembly({ ...assembly, bays })
}

export function resizeFurnitureBay(
  assembly: FurnitureAssembly,
  options: ResizeFurnitureBayOptions,
): FurnitureAssembly {
  assertPositiveFinite(options.width, 'width')
  const [target, targetIndex] = findBay(assembly, options.bayId)
  if (target.width === options.width) return assembly
  if (assembly.bays.length === 1) {
    throw new RangeError('A single bay cannot be resized while total width is fixed.')
  }
  const compensationIndex =
    targetIndex < assembly.bays.length - 1 ? targetIndex + 1 : targetIndex - 1
  const compensation = assembly.bays[compensationIndex]!
  const compensationWidth = compensation.width - (options.width - target.width)
  assertPositiveFinite(compensationWidth, 'compensating bay width')
  const bays = assembly.bays.map((bay) => {
    if (bay.id === target.id) return { ...bay, width: options.width }
    if (bay.id === compensation.id) return { ...bay, width: compensationWidth }
    return bay
  })
  return validateAssembly({ ...assembly, bays })
}

export function insertFurnitureTier(
  assembly: FurnitureAssembly,
  options: InsertFurnitureTierOptions,
): FurnitureAssembly {
  const [bay, bayIndex] = findBay(assembly, options.bayId)
  const [anchor, anchorIndex] = findTier(bay, options.afterTierId)
  const height = options.newHeight ?? anchor.height / 2
  assertPositiveFinite(height, 'newHeight')
  const anchorHeight = anchor.height - height
  assertPositiveFinite(anchorHeight, 'remaining tier height')

  const tierIds = usedTierIds(assembly)
  const fixtureIds = usedFixtureIds(assembly)
  const id = nextAvailableId(`${anchor.id}-copy`, tierIds)
  const newTier: FurnitureTier = {
    ...resizeTierContents(anchor, height),
    id,
    fixtures: anchor.fixtures.map((fixture, fixtureIndex) => ({
      ...fixture,
      id: nextAvailableId(`${id}-fixture-${fixtureIndex}`, fixtureIds),
    })),
  }
  const tiers = bay.tiers.map((tier, index) =>
    index === anchorIndex ? resizeTierContents(tier, anchorHeight) : tier,
  )
  tiers.splice(anchorIndex + 1, 0, newTier)
  const bays = assembly.bays.map((candidate, index) =>
    index === bayIndex ? { ...candidate, tiers } : candidate,
  )
  return validateAssembly({ ...assembly, bays })
}

export function deleteFurnitureTier(
  assembly: FurnitureAssembly,
  options: DeleteFurnitureTierOptions,
): FurnitureAssembly {
  const [bay, bayIndex] = findBay(assembly, options.bayId)
  const [target, targetIndex] = findTier(bay, options.tierId)
  if (bay.tiers.length === 1) {
    throw new RangeError('The final furniture tier cannot be deleted.')
  }
  const compensationIndex = targetIndex > 0 ? targetIndex - 1 : targetIndex + 1
  const compensationId = bay.tiers[compensationIndex]!.id
  const tiers = bay.tiers
    .filter((tier) => tier.id !== target.id)
    .map((tier) =>
      tier.id === compensationId ? resizeTierContents(tier, tier.height + target.height) : tier,
    )
  const bays = assembly.bays.map((candidate, index) =>
    index === bayIndex ? { ...candidate, tiers } : candidate,
  )
  return validateAssembly({ ...assembly, bays })
}

export function resizeFurnitureTier(
  assembly: FurnitureAssembly,
  options: ResizeFurnitureTierOptions,
): FurnitureAssembly {
  assertPositiveFinite(options.height, 'height')
  const [bay, bayIndex] = findBay(assembly, options.bayId)
  const [target, targetIndex] = findTier(bay, options.tierId)
  if (target.height === options.height) return assembly
  if (bay.tiers.length === 1) {
    throw new RangeError('A single tier cannot be resized while total height is fixed.')
  }
  const compensationIndex = targetIndex < bay.tiers.length - 1 ? targetIndex + 1 : targetIndex - 1
  const compensation = bay.tiers[compensationIndex]!
  const compensationHeight = compensation.height - (options.height - target.height)
  assertPositiveFinite(compensationHeight, 'compensating tier height')
  const tiers = bay.tiers.map((tier) => {
    if (tier.id === target.id) return resizeTierContents(tier, options.height)
    if (tier.id === compensation.id) return resizeTierContents(tier, compensationHeight)
    return tier
  })
  const bays = assembly.bays.map((candidate, index) =>
    index === bayIndex ? { ...candidate, tiers } : candidate,
  )
  return validateAssembly({ ...assembly, bays })
}

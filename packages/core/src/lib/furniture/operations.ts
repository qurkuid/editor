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

// Korean interior/kitchen standards — the starting size and carcass a fresh
// assembly gets when the caller doesn't pin a dimension explicitly.
export const FURNITURE_KIND_DEFAULT_DIMENSIONS: Record<
  FurnitureKind,
  FurnitureAssembly['dimensions']
> = {
  wardrobe: { width: 2.4, height: 2.4, depth: 0.6 },
  'base-run': { width: 1.8, height: 0.85, depth: 0.6 },
  'upper-run': { width: 1.8, height: 0.72, depth: 0.35 },
  tall: { width: 0.6, height: 2.1, depth: 0.6 },
  island: { width: 1.8, height: 0.85, depth: 0.9 },
  set: { width: 1.8, height: 2.4, depth: 0.6 },
  sink: { width: 0.9, height: 0.85, depth: 0.6 },
}

const FURNITURE_KIND_BASE: Record<
  FurnitureKind,
  { type: 'plinth' | 'floating'; height: number; kickplate: boolean }
> = {
  wardrobe: { type: 'plinth', height: 0.05, kickplate: true },
  'base-run': { type: 'plinth', height: 0.1, kickplate: true },
  'upper-run': { type: 'floating', height: 0, kickplate: false },
  tall: { type: 'plinth', height: 0.1, kickplate: true },
  island: { type: 'plinth', height: 0.1, kickplate: true },
  set: { type: 'plinth', height: 0.1, kickplate: true },
  sink: { type: 'plinth', height: 0.1, kickplate: true },
}

// An island's back row is addressed by the same operations as its front row
// — AI and direct UI share one operation set rather than a parallel
// back-bay-only API. `face` defaults to 'front' so every existing call site
// (which never passes it) keeps targeting `assembly.bays` unchanged.
export type FurnitureFace = 'front' | 'back'

export interface SetFurnitureTierInteriorOptions {
  bayId: string
  tierId: string
  shelfCount: number
  hanger: boolean
  face?: FurnitureFace
}

export interface SetFurnitureTierFrontOptions {
  bayId: string
  tierId: string
  front: FurnitureFront
  face?: FurnitureFace
}

export interface InsertFurnitureBayOptions {
  afterBayId: string
  newWidth?: number
  face?: FurnitureFace
}

export interface DeleteFurnitureBayOptions {
  bayId: string
  face?: FurnitureFace
}

export interface ResizeFurnitureBayOptions {
  bayId: string
  width: number
  face?: FurnitureFace
}

export interface InsertFurnitureTierOptions {
  bayId: string
  afterTierId: string
  newHeight?: number
  face?: FurnitureFace
}

export interface DeleteFurnitureTierOptions {
  bayId: string
  tierId: string
  face?: FurnitureFace
}

export interface ResizeFurnitureTierOptions {
  bayId: string
  tierId: string
  height: number
  face?: FurnitureFace
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

function evenShelfHeights(tierHeight: number, count: number): number[] {
  return Array.from({ length: count }, (_, index) => (tierHeight * (index + 1)) / (count + 1))
}

function shelvesFor(tierHeight: number, count: number) {
  return { count, heights: evenShelfHeights(tierHeight, count) }
}

// Per-kind tier layout for a freshly created assembly — the distinguishing
// interior structure (shelves, hanger, open front, the counter-to-upper gap)
// that makes each furniture kind look and behave like its real counterpart
// instead of an identical box wearing a different label.
function buildKindTiers(furnitureKind: FurnitureKind, bayId: string, interiorHeight: number) {
  const tierId = (suffix: number) => `${bayId}-tier-${suffix}`

  switch (furnitureKind) {
    case 'upper-run':
      return [{ id: tierId(0), height: interiorHeight, shelves: shelvesFor(interiorHeight, 2) }]
    case 'base-run':
    case 'island':
      return [{ id: tierId(0), height: interiorHeight, shelves: shelvesFor(interiorHeight, 1) }]
    case 'sink':
      return [{ id: tierId(0), height: interiorHeight, front: { kind: 'open', color: '' } }]
    case 'tall': {
      const lowerHeight = interiorHeight * 0.3
      const upperHeight = interiorHeight - lowerHeight
      return [
        { id: tierId(0), height: lowerHeight, shelves: shelvesFor(lowerHeight, 1) },
        { id: tierId(1), height: upperHeight, shelves: shelvesFor(upperHeight, 3) },
      ]
    }
    case 'set': {
      const lowerHeight = 0.85
      const upperHeight = 0.72
      // The physical gap between the counter run and the wall cabinets above
      // it — clamped so an aggressively shortened override can't drive it
      // negative.
      const gapHeight = Math.max(interiorHeight - lowerHeight - upperHeight, 0.01)
      return [
        { id: tierId(0), height: lowerHeight, shelves: shelvesFor(lowerHeight, 1) },
        { id: tierId(1), height: gapHeight, visible: false },
        { id: tierId(2), height: upperHeight, shelves: shelvesFor(upperHeight, 2) },
      ]
    }
    default:
      return [
        {
          id: tierId(0),
          height: interiorHeight,
          shelves: shelvesFor(interiorHeight, 1),
          hanger: true,
        },
      ]
  }
}

function faceBayArray(assembly: FurnitureAssembly, face: FurnitureFace): FurnitureBay[] {
  return face === 'back' ? (assembly.backBays ?? []) : assembly.bays
}

function withFaceBayArray(
  assembly: FurnitureAssembly,
  face: FurnitureFace,
  bays: FurnitureBay[],
): FurnitureAssembly {
  return face === 'back' ? { ...assembly, backBays: bays } : { ...assembly, bays }
}

function findBay(
  assembly: FurnitureAssembly,
  bayId: string,
  face: FurnitureFace = 'front',
): [FurnitureBay, number] {
  const bays = faceBayArray(assembly, face)
  const index = bays.findIndex((bay) => bay.id === bayId)
  if (index < 0) throw new RangeError(`Furniture bay "${bayId}" was not found.`)
  return [bays[index]!, index]
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
  const furnitureKind = options.furnitureKind ?? 'wardrobe'
  const kindDimensions = FURNITURE_KIND_DEFAULT_DIMENSIONS[furnitureKind]
  const dimensions = {
    width: options.dimensions?.width ?? kindDimensions.width,
    height: options.dimensions?.height ?? kindDimensions.height,
    depth: options.dimensions?.depth ?? kindDimensions.depth,
  }
  const bayCount = options.bayCount ?? 1
  if (!Number.isInteger(bayCount) || bayCount < 1 || bayCount > 100) {
    throw new RangeError('bayCount must be an integer from 1 to 100.')
  }
  const kindBase = FURNITURE_KIND_BASE[furnitureKind]
  const baseHeight =
    kindBase.type === 'floating' ? 0 : Math.min(kindBase.height, dimensions.height / 4)
  const interiorHeight = dimensions.height - baseHeight

  const buildBays = (idPrefix: string) =>
    Array.from({ length: bayCount }, (_, index) => {
      const bayId = `${idPrefix}-${index}`
      return {
        id: bayId,
        width: dimensions.width / bayCount,
        base: { type: kindBase.type, height: baseHeight },
        kickplate: kindBase.kickplate,
        endPanels: { left: false, right: false },
        tiers: buildKindTiers(furnitureKind, bayId, interiorHeight),
      }
    })

  // An island is free-standing with cabinetry on both faces — a faithful
  // port of the SketchUp source's front row + mirror-generated back row — so
  // a fresh one also seeds a back row and the depth split between them. The
  // split is proportional (30/70) rather than SU's literal 300/700mm so it
  // still sums exactly to Pascal's own default island depth (0.9 m, not SU's
  // 1 m); the ratio otherwise matches SU's shallower show face / deeper work
  // face convention.
  const isIsland = furnitureKind === 'island'

  return normalizeFurnitureAssembly({
    furnitureKind,
    dimensions,
    bays: buildBays('bay'),
    ...(isIsland
      ? {
          backBays: buildBays('back-bay'),
          depthSplit: { front: dimensions.depth * 0.3, back: dimensions.depth * 0.7 },
        }
      : {}),
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
    // An island's back row spans the same overall width as its front row, so
    // it scales the same way — otherwise a width resize would leave the two
    // faces summing to different totals.
    ...(assembly.backBays
      ? { backBays: assembly.backBays.map((bay) => ({ ...bay, width: bay.width * widthScale })) }
      : {}),
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

  const face = options.face ?? 'front'
  const bays = faceBayArray(assembly, face)
  const bay = bays.find((candidate) => candidate.id === options.bayId)
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

  return withFaceBayArray(
    assembly,
    face,
    bays.map((candidateBay) =>
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
  )
}

export function setFurnitureTierFront(
  assembly: FurnitureAssembly,
  options: SetFurnitureTierFrontOptions,
): FurnitureAssembly {
  const face = options.face ?? 'front'
  const bays = faceBayArray(assembly, face)
  const bay = bays.find((candidate) => candidate.id === options.bayId)
  if (!bay) throw new RangeError(`Furniture bay "${options.bayId}" was not found.`)

  const tier = bay.tiers.find((candidate) => candidate.id === options.tierId)
  if (!tier) {
    throw new RangeError(
      `Furniture tier "${options.tierId}" was not found in bay "${options.bayId}".`,
    )
  }

  const front = FurnitureFrontSchema.parse(options.front)
  if (JSON.stringify(tier.front) === JSON.stringify(front)) return assembly

  return withFaceBayArray(
    assembly,
    face,
    bays.map((candidateBay) =>
      candidateBay.id !== options.bayId
        ? candidateBay
        : {
            ...candidateBay,
            tiers: candidateBay.tiers.map((candidateTier) =>
              candidateTier.id !== options.tierId ? candidateTier : { ...candidateTier, front },
            ),
          },
    ),
  )
}

export function insertFurnitureBay(
  assembly: FurnitureAssembly,
  options: InsertFurnitureBayOptions,
): FurnitureAssembly {
  const face = options.face ?? 'front'
  const [anchor, anchorIndex] = findBay(assembly, options.afterBayId, face)
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
  const bays = faceBayArray(assembly, face).map((bay, index) =>
    index === anchorIndex ? { ...bay, width: anchorWidth } : bay,
  )
  bays.splice(anchorIndex + 1, 0, newBay)
  return validateAssembly(withFaceBayArray(assembly, face, bays))
}

export function deleteFurnitureBay(
  assembly: FurnitureAssembly,
  options: DeleteFurnitureBayOptions,
): FurnitureAssembly {
  const face = options.face ?? 'front'
  const faceBays = faceBayArray(assembly, face)
  const [target, targetIndex] = findBay(assembly, options.bayId, face)
  if (faceBays.length === 1) {
    throw new RangeError('The final furniture bay cannot be deleted.')
  }
  const compensationIndex = targetIndex > 0 ? targetIndex - 1 : targetIndex + 1
  const compensationId = faceBays[compensationIndex]!.id
  const bays = faceBays
    .filter((bay) => bay.id !== target.id)
    .map((bay) => (bay.id === compensationId ? { ...bay, width: bay.width + target.width } : bay))
  return validateAssembly(withFaceBayArray(assembly, face, bays))
}

export function resizeFurnitureBay(
  assembly: FurnitureAssembly,
  options: ResizeFurnitureBayOptions,
): FurnitureAssembly {
  assertPositiveFinite(options.width, 'width')
  const face = options.face ?? 'front'
  const faceBays = faceBayArray(assembly, face)
  const [target, targetIndex] = findBay(assembly, options.bayId, face)
  if (target.width === options.width) return assembly
  if (faceBays.length === 1) {
    throw new RangeError('A single bay cannot be resized while total width is fixed.')
  }
  const compensationIndex = targetIndex < faceBays.length - 1 ? targetIndex + 1 : targetIndex - 1
  const compensation = faceBays[compensationIndex]!
  const compensationWidth = compensation.width - (options.width - target.width)
  assertPositiveFinite(compensationWidth, 'compensating bay width')
  const bays = faceBays.map((bay) => {
    if (bay.id === target.id) return { ...bay, width: options.width }
    if (bay.id === compensation.id) return { ...bay, width: compensationWidth }
    return bay
  })
  return validateAssembly(withFaceBayArray(assembly, face, bays))
}

export function insertFurnitureTier(
  assembly: FurnitureAssembly,
  options: InsertFurnitureTierOptions,
): FurnitureAssembly {
  const face = options.face ?? 'front'
  const [bay, bayIndex] = findBay(assembly, options.bayId, face)
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
  const bays = faceBayArray(assembly, face).map((candidate, index) =>
    index === bayIndex ? { ...candidate, tiers } : candidate,
  )
  return validateAssembly(withFaceBayArray(assembly, face, bays))
}

export function deleteFurnitureTier(
  assembly: FurnitureAssembly,
  options: DeleteFurnitureTierOptions,
): FurnitureAssembly {
  const face = options.face ?? 'front'
  const [bay, bayIndex] = findBay(assembly, options.bayId, face)
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
  const bays = faceBayArray(assembly, face).map((candidate, index) =>
    index === bayIndex ? { ...candidate, tiers } : candidate,
  )
  return validateAssembly(withFaceBayArray(assembly, face, bays))
}

export function resizeFurnitureTier(
  assembly: FurnitureAssembly,
  options: ResizeFurnitureTierOptions,
): FurnitureAssembly {
  assertPositiveFinite(options.height, 'height')
  const face = options.face ?? 'front'
  const [bay, bayIndex] = findBay(assembly, options.bayId, face)
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
  const bays = faceBayArray(assembly, face).map((candidate, index) =>
    index === bayIndex ? { ...candidate, tiers } : candidate,
  )
  return validateAssembly(withFaceBayArray(assembly, face, bays))
}

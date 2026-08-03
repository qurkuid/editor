import type { FurnitureAssembly, FurnitureBay } from '../../schema/nodes/furniture'

export type FurnitureAssemblyPartKind =
  | 'side-left'
  | 'side-right'
  | 'end-panel'
  | 'divider'
  | 'top'
  | 'bottom'
  | 'back'
  | 'shelf'
  | 'hanger'
  | 'front'
  | 'plinth'
  | 'leg'
  | 'kickplate'

export type FurnitureAssemblyPartShape = 'box' | 'cylinder'

export interface FurnitureAssemblyPart {
  id: string
  kind: FurnitureAssemblyPartKind
  shape: FurnitureAssemblyPartShape
  position: [number, number, number]
  size: [number, number, number]
  materialId?: string
  bayId?: string
  tierId?: string
  face?: 'front' | 'back'
}

export interface FurnitureAssemblyBounds {
  min: [number, number, number]
  max: [number, number, number]
}

export type FurnitureAssemblyWarningCode =
  | 'bay-width-mismatch'
  | 'tier-height-overflow'
  | 'invalid-part-dimensions'

export interface FurnitureAssemblyWarning {
  code: FurnitureAssemblyWarningCode
  path: string
  message: string
}

export interface FurnitureAssemblyOptions {
  carcassThickness?: number
  backThickness?: number
  rodDiameter?: number
  frontThickness?: number
  frontGap?: number
}

export interface FurnitureAssemblyResult {
  parts: FurnitureAssemblyPart[]
  bounds: FurnitureAssemblyBounds
  warnings: FurnitureAssemblyWarning[]
}

const DEFAULT_CARCASS_THICKNESS = 0.018
const DEFAULT_BACK_THICKNESS = 0.006
const DEFAULT_ROD_DIAMETER = 0.025
const DEFAULT_FRONT_THICKNESS = 0.018
const DEFAULT_FRONT_GAP = 0.003
const HANGER_SIDE_INSET = 0.03
const HANGER_TOP_CLEARANCE = 0.06
const KICKPLATE_INSET = 0.05
const LEG_SIZE = 0.03
const LEG_INSET = 0.04
const DIMENSION_TOLERANCE = 1e-6

export function buildFurnitureAssembly(
  assembly: FurnitureAssembly,
  options: FurnitureAssemblyOptions = {},
): FurnitureAssemblyResult {
  const carcassThickness = positiveOption(
    options.carcassThickness,
    DEFAULT_CARCASS_THICKNESS,
    'carcassThickness',
  )
  const backThickness = positiveOption(
    options.backThickness,
    DEFAULT_BACK_THICKNESS,
    'backThickness',
  )
  const rodDiameter = positiveOption(options.rodDiameter, DEFAULT_ROD_DIAMETER, 'rodDiameter')
  const frontThickness = positiveOption(
    options.frontThickness,
    DEFAULT_FRONT_THICKNESS,
    'frontThickness',
  )
  const frontGap = nonNegativeOption(options.frontGap, DEFAULT_FRONT_GAP, 'frontGap')
  const { width, height, depth } = assembly.dimensions
  const bounds: FurnitureAssemblyBounds = {
    min: [-width / 2, 0, -depth / 2],
    max: [width / 2, height, depth / 2],
  }
  const parts: FurnitureAssemblyPart[] = []
  const warnings: FurnitureAssemblyWarning[] = []

  const checkBayWidthTotal = (bays: FurnitureBay[], path: string) => {
    const total = bays.reduce((sum, bay) => sum + bay.width, 0)
    if (Math.abs(total - width) > DIMENSION_TOLERANCE) {
      warnings.push({
        code: 'bay-width-mismatch',
        path,
        message: `Bay widths total ${total} m but assembly width is ${width} m.`,
      })
    }
  }
  checkBayWidthTotal(assembly.bays, 'bays')

  const backBays = assembly.backBays ?? []
  const hasBackBays = backBays.length > 0
  if (hasBackBays) checkBayWidthTotal(backBays, 'backBays')

  // An island is one carcass envelope shared by two independently configured
  // faces: front bays occupy the +Z portion, back bays the -Z portion, split
  // at depthSplit. Bays that never declare backBays keep the single-face
  // depth centered on the assembly exactly as before.
  const split =
    assembly.depthSplit ?? (hasBackBays ? { front: depth / 2, back: depth / 2 } : undefined)

  const addPart = (part: FurnitureAssemblyPart, path: string) => {
    if (part.size.every((dimension) => Number.isFinite(dimension) && dimension > 0)) {
      parts.push(part)
      return
    }

    warnings.push({
      code: 'invalid-part-dimensions',
      path,
      message: `Part "${part.id}" has invalid dimensions.`,
    })
  }

  const leftmostBay = assembly.bays[0]
  const rightmostBay = assembly.bays[assembly.bays.length - 1]
  const leftmostBackBay = backBays[0]
  const rightmostBackBay = backBays[backBays.length - 1]

  // EP (노출 측판) is a finish panel over an exposed end, not the carcass side
  // itself — it defaults off. Width is the wall-to-wall opening, so an end
  // panel takes the outermost slice and the carcass side steps inboard of it
  // rather than the assembly growing past its declared bounds. Either face's
  // outer bay can request one; the sides already span the full depth, so a
  // single shared panel covers both.
  const leftEndPanel =
    leftmostBay?.endPanels.left === true || leftmostBackBay?.endPanels.left === true
  const rightEndPanel =
    rightmostBay?.endPanels.right === true || rightmostBackBay?.endPanels.right === true
  const leftSideOffset = leftEndPanel ? carcassThickness : 0
  const rightSideOffset = rightEndPanel ? carcassThickness : 0

  if (leftEndPanel) {
    addPart(
      {
        id: 'end-panel:left',
        kind: 'end-panel',
        shape: 'box',
        position: [-width / 2 + carcassThickness / 2, height / 2, 0],
        size: [carcassThickness, height, depth],
        materialId: assembly.materialDefaults.front ?? assembly.materialDefaults.carcass,
      },
      'bays[0].endPanels.left',
    )
  }
  if (rightEndPanel) {
    addPart(
      {
        id: 'end-panel:right',
        kind: 'end-panel',
        shape: 'box',
        position: [width / 2 - carcassThickness / 2, height / 2, 0],
        size: [carcassThickness, height, depth],
        materialId: assembly.materialDefaults.front ?? assembly.materialDefaults.carcass,
      },
      `bays[${assembly.bays.length - 1}].endPanels.right`,
    )
  }

  addPart(
    {
      id: 'side:left',
      kind: 'side-left',
      shape: 'box',
      position: [-width / 2 + leftSideOffset + carcassThickness / 2, height / 2, 0],
      size: [carcassThickness, height, depth],
      materialId: assembly.materialDefaults.carcass,
    },
    'dimensions',
  )
  addPart(
    {
      id: 'side:right',
      kind: 'side-right',
      shape: 'box',
      position: [width / 2 - rightSideOffset - carcassThickness / 2, height / 2, 0],
      size: [carcassThickness, height, depth],
      materialId: assembly.materialDefaults.carcass,
    },
    'dimensions',
  )

  // Renders one face's bay row (front or back). `zBack`/`zFront` are the
  // compartment's spine-side and door-side z boundaries; for the back face
  // these are mirrored (zFront < zBack), which `dirSign` captures so every
  // "inset from the door" and "clear of the back panel" offset still points
  // the right way. `includeBackPanel` is only true for the front face — the
  // island's two compartments meet at one shared spine, so only one side
  // builds the panel that sits there instead of each face emitting its own.
  const emitFaceBays = (
    bays: FurnitureBay[],
    face: 'front' | 'back',
    zBack: number,
    zFront: number,
    includeBackPanel: boolean,
  ) => {
    const pathPrefix = face === 'back' ? 'backBays' : 'bays'
    const idInfix = face === 'back' ? 'back:' : ''
    const faceStamp = hasBackBays ? { face } : {}
    const compartmentDepth = Math.abs(zFront - zBack)
    const compartmentCenterZ = (zBack + zFront) / 2
    const dirSign = Math.sign(zFront - zBack) || 1

    const totalBayWidth = bays.reduce((sum, bay) => sum + bay.width, 0)
    let bayLeft = -totalBayWidth / 2
    for (const [bayIndex, bay] of bays.entries()) {
      const bayRight = bayLeft + bay.width
      const bayCenter = (bayLeft + bayRight) / 2
      const innerWidth = bay.width - carcassThickness * 2
      const baseHeight = bay.base.height

      if (bayIndex > 0) {
        const previousBay = bays[bayIndex - 1]
        addPart(
          {
            id: `divider:${idInfix}${previousBay?.id}:${bay.id}`,
            kind: 'divider',
            shape: 'box',
            position: [bayLeft, height / 2, compartmentCenterZ],
            size: [carcassThickness, height, compartmentDepth],
            materialId: assembly.materialDefaults.carcass,
            bayId: bay.id,
            ...faceStamp,
          },
          `${pathPrefix}[${bayIndex}]`,
        )
      }

      if (bay.visible) {
        addPart(
          {
            id: `bay:${idInfix}${bay.id}:top`,
            kind: 'top',
            shape: 'box',
            position: [bayCenter, height - carcassThickness / 2, compartmentCenterZ],
            size: [innerWidth, carcassThickness, compartmentDepth],
            materialId: assembly.materialDefaults.carcass,
            bayId: bay.id,
            ...faceStamp,
          },
          `${pathPrefix}[${bayIndex}].width`,
        )
        addPart(
          {
            id: `bay:${idInfix}${bay.id}:bottom`,
            kind: 'bottom',
            shape: 'box',
            position: [bayCenter, baseHeight + carcassThickness / 2, compartmentCenterZ],
            size: [innerWidth, carcassThickness, compartmentDepth],
            materialId: assembly.materialDefaults.carcass,
            bayId: bay.id,
            ...faceStamp,
          },
          `${pathPrefix}[${bayIndex}].width`,
        )
        if (includeBackPanel) {
          addPart(
            {
              id: `bay:${idInfix}${bay.id}:back`,
              kind: 'back',
              shape: 'box',
              position: [
                bayCenter,
                (baseHeight + height) / 2,
                zBack + (dirSign * backThickness) / 2,
              ],
              size: [innerWidth, height - baseHeight, backThickness],
              materialId: assembly.materialDefaults.back,
              bayId: bay.id,
              ...faceStamp,
            },
            `${pathPrefix}[${bayIndex}]`,
          )
        }

        if (bay.base.type === 'plinth') {
          addPart(
            {
              id: `bay:${idInfix}${bay.id}:plinth`,
              kind: 'plinth',
              shape: 'box',
              position: [bayCenter, baseHeight / 2, compartmentCenterZ],
              size: [innerWidth, baseHeight, compartmentDepth],
              materialId: assembly.materialDefaults.carcass,
              bayId: bay.id,
              ...faceStamp,
            },
            `${pathPrefix}[${bayIndex}].base`,
          )
        } else if (bay.base.type === 'legs') {
          const legOffsetX = innerWidth / 2 - LEG_INSET
          const legOffsetZ = compartmentDepth / 2 - LEG_INSET
          const legCorners: Array<[number, number]> = [
            [-legOffsetX, -legOffsetZ],
            [legOffsetX, -legOffsetZ],
            [-legOffsetX, legOffsetZ],
            [legOffsetX, legOffsetZ],
          ]
          for (const [legIndex, [offsetX, offsetZ]] of legCorners.entries()) {
            addPart(
              {
                id: `bay:${idInfix}${bay.id}:leg:${legIndex}`,
                kind: 'leg',
                shape: 'box',
                position: [bayCenter + offsetX, baseHeight / 2, compartmentCenterZ + offsetZ],
                size: [LEG_SIZE, baseHeight, LEG_SIZE],
                materialId: assembly.materialDefaults.hardware,
                bayId: bay.id,
                ...faceStamp,
              },
              `${pathPrefix}[${bayIndex}].base`,
            )
          }
        }

        if (bay.kickplate) {
          addPart(
            {
              id: `bay:${idInfix}${bay.id}:kickplate`,
              kind: 'kickplate',
              shape: 'box',
              position: [
                bayCenter,
                baseHeight / 2,
                zFront - dirSign * (KICKPLATE_INSET + carcassThickness / 2),
              ],
              size: [innerWidth, baseHeight, carcassThickness],
              materialId: assembly.materialDefaults.carcass,
              bayId: bay.id,
              ...faceStamp,
            },
            `${pathPrefix}[${bayIndex}].kickplate`,
          )
        }
      }

      let tierBottom = baseHeight
      for (const [tierIndex, tier] of bay.tiers.entries()) {
        const tierTop = tierBottom + tier.height
        if (tierTop > height + DIMENSION_TOLERANCE) {
          warnings.push({
            code: 'tier-height-overflow',
            path: `${pathPrefix}[${bayIndex}].tiers[${tierIndex}]`,
            message: `Tier "${tier.id}" extends above the assembly height.`,
          })
        }

        if (bay.visible && tier.visible) {
          const shelfHeights = tier.shelves.heights.slice(0, tier.shelves.count)
          for (const [shelfIndex, shelfHeight] of shelfHeights.entries()) {
            addPart(
              {
                id: `bay:${idInfix}${bay.id}:tier:${tier.id}:shelf:${shelfIndex}`,
                kind: 'shelf',
                shape: 'box',
                position: [bayCenter, tierBottom + shelfHeight, compartmentCenterZ],
                size: [
                  innerWidth,
                  carcassThickness,
                  includeBackPanel ? compartmentDepth - backThickness : compartmentDepth,
                ],
                materialId: assembly.materialDefaults.carcass,
                bayId: bay.id,
                tierId: tier.id,
                ...faceStamp,
              },
              `${pathPrefix}[${bayIndex}].tiers[${tierIndex}].shelves.heights[${shelfIndex}]`,
            )
          }

          if (tier.hanger) {
            addPart(
              {
                id: `bay:${idInfix}${bay.id}:tier:${tier.id}:hanger`,
                kind: 'hanger',
                shape: 'cylinder',
                position: [
                  bayCenter,
                  tierTop - HANGER_TOP_CLEARANCE - rodDiameter / 2,
                  compartmentCenterZ,
                ],
                size: [innerWidth - HANGER_SIDE_INSET * 2, rodDiameter, rodDiameter],
                materialId: assembly.materialDefaults.hardware,
                bayId: bay.id,
                tierId: tier.id,
                ...faceStamp,
              },
              `${pathPrefix}[${bayIndex}].tiers[${tierIndex}]`,
            )
          }

          if (tier.front.kind !== 'open') {
            const frontWidth = innerWidth - frontGap * 2
            const frontHeight = tier.height - frontGap * 2
            const frontZ = zFront - (dirSign * frontThickness) / 2
            const frontY = tierBottom + tier.height / 2
            const frontMaterialId =
              assembly.materialDefaults.front ?? assembly.materialDefaults.carcass
            const frontPath = `${pathPrefix}[${bayIndex}].tiers[${tierIndex}].front`
            const addFrontPart = (
              index: number,
              position: [number, number, number],
              size: [number, number, number],
            ) => {
              addPart(
                {
                  id: `bay:${idInfix}${bay.id}:tier:${tier.id}:front:${index}`,
                  kind: 'front',
                  shape: 'box',
                  position,
                  size,
                  materialId: frontMaterialId,
                  bayId: bay.id,
                  tierId: tier.id,
                  ...faceStamp,
                },
                frontPath,
              )
            }

            if (
              tier.front.kind === 'hinged' ||
              tier.front.kind === 'flap' ||
              tier.front.kind === 'pull-out'
            ) {
              const leaves = tier.front.kind === 'hinged' ? tier.front.leaves : 1
              if (leaves === 1) {
                addFrontPart(
                  0,
                  [bayCenter, frontY, frontZ],
                  [frontWidth, frontHeight, frontThickness],
                )
              } else {
                const leafWidth = (frontWidth - frontGap) / 2
                const offset = leafWidth / 2 + frontGap / 2
                addFrontPart(
                  0,
                  [bayCenter - offset, frontY, frontZ],
                  [leafWidth, frontHeight, frontThickness],
                )
                addFrontPart(
                  1,
                  [bayCenter + offset, frontY, frontZ],
                  [leafWidth, frontHeight, frontThickness],
                )
              }
            } else if (tier.front.kind === 'drawer') {
              const count = tier.front.count
              const drawerHeight = (frontHeight - frontGap * (count - 1)) / count
              let drawerBottom = tierBottom + frontGap
              for (let index = 0; index < count; index += 1) {
                addFrontPart(
                  index,
                  [bayCenter, drawerBottom + drawerHeight / 2, frontZ],
                  [frontWidth, drawerHeight, frontThickness],
                )
                drawerBottom += drawerHeight + frontGap
              }
            } else if (tier.front.kind === 'sliding') {
              const leaves = tier.front.leaves
              const leafWidth = frontWidth / leaves
              const leftEdge = bayCenter - frontWidth / 2
              for (let index = 0; index < leaves; index += 1) {
                addFrontPart(
                  index,
                  [
                    leftEdge + leafWidth * (index + 0.5),
                    frontY,
                    frontZ - dirSign * (index % 2) * frontThickness,
                  ],
                  [leafWidth, frontHeight, frontThickness],
                )
              }
            }
          }
        }

        tierBottom = tierTop
      }

      bayLeft = bayRight
    }
  }

  const frontZBack = split ? 0 : -depth / 2
  const frontZFront = split ? split.front : depth / 2
  emitFaceBays(assembly.bays, 'front', frontZBack, frontZFront, true)

  if (hasBackBays && split) {
    emitFaceBays(backBays, 'back', 0, -split.back, false)
  }

  return { parts, bounds, warnings }
}

function positiveOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved <= 0) {
    throw new RangeError(`${name} must be a positive finite number.`)
  }
  return resolved
}

function nonNegativeOption(value: number | undefined, fallback: number, name: string): number {
  const resolved = value ?? fallback
  if (!Number.isFinite(resolved) || resolved < 0) {
    throw new RangeError(`${name} must be a non-negative finite number.`)
  }
  return resolved
}

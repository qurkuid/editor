import {
  type AnyNode,
  type CabinetModuleNode,
  type CabinetNode,
  DEFAULT_WALL_HEIGHT,
  getWallCurveLength,
  resolveLightingFixtureCount,
  type WallNode,
} from '@pascal-app/core'
import {
  surfaceAssemblyLines,
  type WallConstructionLayerLike,
  wallAssemblyLines,
} from './wall-assembly-takeoff'

/**
 * Scene → quantities, for pricing an estimate.
 *
 * Deliberately holds no prices, rates or vendor data: it answers "how much of
 * what is in this scene", and INTM answers "what does that cost". Keeping the
 * split here means the takeoff can be read, tested and shown to the user
 * without touching anything commercial.
 *
 * Units are SI throughout — metres, square metres, cubic metres, and whole
 * counts. Formatting to mm belongs to the UI layer.
 */

export type TakeoffCategory =
  | 'board' // 목자재
  | 'furniture' // 가구
  | 'lighting' // 조명
  | 'finish' // 마감재
  | 'floor' // 바닥재
  | 'ceiling' // 천장재
  | 'wall' // 벽체 (면적)
  | 'item' // 배치 모델

export type TakeoffUnit = 'm2' | 'm3' | 'm' | 'ea'

/**
 * `material` lines go on a purchase order. `measure` lines — face area, run
 * length, bay count — are the numbers an order is derived from, and would be
 * nonsense as order lines themselves.
 */
export type TakeoffRole = 'material' | 'measure'

export type TakeoffLine = {
  category: TakeoffCategory
  /** Stable grouping key — the material ref when known, else the kind. */
  key: string
  label: string
  unit: TakeoffUnit
  quantity: number
  /** Node ids behind this line, so the UI can select them in the scene. */
  nodeIds: string[]
  /** Material reference (`library:…` / `scene:…`) when the surface is painted. */
  materialRef?: string
  /**
   * The build-up layer this line came from, when it came from one. Lets the
   * panel write a chosen product back onto every wall that fed the line.
   */
  layerKind?: string
  role: TakeoffRole
}

/** A line before `push` fills in its role — most lines are materials. */
export type TakeoffLineInput = Omit<TakeoffLine, 'role'> & { role?: TakeoffRole }

export type TakeoffReport = {
  lines: TakeoffLine[]
  totals: Record<TakeoffCategory, number>
}

const LIGHT_TYPE_LABEL: Record<string, string> = {
  point: '포인트 조명',
  spot: '스팟 조명',
  area: '에어리어 조명',
  linear: '라인 조명',
}

const EMPTY_TOTALS: Record<TakeoffCategory, number> = {
  board: 0,
  furniture: 0,
  lighting: 0,
  finish: 0,
  floor: 0,
  ceiling: 0,
  wall: 0,
  item: 0,
}

function polygonArea(points: readonly (readonly [number, number])[]): number {
  let twiceArea = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    if (!a || !b) continue
    twiceArea += a[0] * b[1] - b[0] * a[1]
  }
  return Math.abs(twiceArea) / 2
}

/**
 * Board area for one cabinet/furniture module: two sides, top, bottom, back,
 * plus its shelves. Fronts are counted separately as `front` boards because
 * they are usually a different (and dearer) sheet than the carcass.
 */
function moduleBoardArea(module: CabinetModuleNode): { carcass: number; front: number } {
  const width = module.width ?? 0
  const depth = module.depth ?? 0
  const height = module.carcassHeight ?? 0
  if (width <= 0 || depth <= 0 || height <= 0) return { carcass: 0, front: 0 }

  const sides = 2 * depth * height
  const topBottom = 2 * width * depth
  const back = width * height
  const stack = Array.isArray(module.stack) ? module.stack : []
  const shelves = stack.reduce((total, compartment) => {
    const count = (compartment as { shelfCount?: number }).shelfCount ?? 0
    return total + count * width * depth
  }, 0)

  // Fronts cover the opening; drawers stack several across the same face, so
  // the covered area is the face either way.
  const hasFront = stack.some((compartment) => {
    const type = (compartment as { type?: string }).type
    return type === 'door' || type === 'drawer'
  })

  return {
    carcass: sides + topBottom + back + shelves,
    front: hasFront ? width * height : 0,
  }
}

function push(lines: Map<string, TakeoffLine>, line: TakeoffLineInput) {
  if (line.quantity <= 0) return
  const id = `${line.category}:${line.key}`
  const existing = lines.get(id)
  if (existing) {
    existing.quantity += line.quantity
    existing.nodeIds.push(...line.nodeIds)
    return
  }
  lines.set(id, { ...line, role: line.role ?? 'material', nodeIds: [...line.nodeIds] })
}

/**
 * Build the takeoff for a scene (optionally limited to one level).
 */
export function deriveTakeoff(
  nodes: Readonly<Record<string, AnyNode>>,
  options: { levelId?: string | null } = {},
): TakeoffReport {
  const all = Object.values(nodes)
  const inScope = (node: AnyNode) =>
    !options.levelId || node.parentId === options.levelId || node.type === 'cabinet-module'
  const lines = new Map<string, TakeoffLine>()

  for (const node of all) {
    if (!inScope(node)) continue

    if (node.type === 'cabinet-module') {
      const module = node as CabinetModuleNode
      const { carcass, front } = moduleBoardArea(module)
      const thickness = module.boardThickness ?? 0.018
      push(lines, {
        category: 'board',
        key: `carcass-${thickness}`,
        label: `카르카스 판재 ${Math.round(thickness * 1000)}mm`,
        unit: 'm2',
        quantity: carcass,
        nodeIds: [module.id],
      })
      push(lines, {
        category: 'board',
        key: `front-${module.frontThickness ?? thickness}`,
        label: `도어/서랍 판재 ${Math.round((module.frontThickness ?? thickness) * 1000)}mm`,
        unit: 'm2',
        quantity: front,
        nodeIds: [module.id],
      })
      continue
    }

    if (node.type === 'cabinet') {
      const run = node as CabinetNode
      const bays = (run.children ?? []).length
      push(lines, {
        category: 'furniture',
        key: run.runTier ?? 'base',
        label: `${run.name || '가구'} (${run.runTier ?? 'base'})`,
        unit: 'ea',
        quantity: 1,
        nodeIds: [run.id],
      })
      if (run.withCountertop) {
        const span = (run.children ?? []).reduce((total, childId) => {
          const child = nodes[childId] as CabinetModuleNode | undefined
          return total + (child?.width ?? 0)
        }, 0)
        push(lines, {
          category: 'board',
          key: 'countertop',
          label: '상판',
          unit: 'm2',
          quantity: span * (run.depth ?? 0),
          nodeIds: [run.id],
        })
      }
      // Bay count rides along so the estimate can price per-bay hardware.
      if (bays > 0) {
        push(lines, {
          category: 'furniture',
          key: 'bay',
          label: '가구 통',
          unit: 'ea',
          quantity: bays,
          nodeIds: [run.id],
          role: 'measure',
        })
      }

      // Run length and the bay make-up behind it. A quote is written against
      // "3.6 m of wardrobe, 600×4 + 450×2", not against a bare unit count —
      // and hardware, edging and worktop all price off one or the other.
      const widths = (run.children ?? [])
        .map((childId) => (nodes[childId] as CabinetModuleNode | undefined)?.width ?? 0)
        .filter((width) => width > 0)

      if (widths.length > 0) {
        push(lines, {
          category: 'furniture',
          key: 'run-length',
          label: '가구 총 길이',
          unit: 'm',
          quantity: widths.reduce((total, width) => total + width, 0),
          nodeIds: [run.id],
          role: 'measure',
        })

        // Bays group by width, since that is what a shop cuts and prices.
        for (const width of widths) {
          const mm = Math.round(width * 1000)
          push(lines, {
            category: 'furniture',
            key: `bay-${mm}`,
            label: `통 ${mm}mm`,
            unit: 'ea',
            quantity: 1,
            nodeIds: [run.id],
          })
        }
      }
      continue
    }

    if (node.type === 'lighting-fixture') {
      const fixture = node as {
        lightType?: string
        metadata?: Record<string, unknown>
        asset?: { id?: string; name?: string }
        start?: readonly [number, number]
        end?: readonly [number, number]
        count?: number
      }
      const lightType = fixture.lightType ?? 'point'
      // A point/spot node with drafted endpoints is a divided run — one node,
      // `count` purchasable lights.
      const quantity = resolveLightingFixtureCount({
        lightType,
        start: fixture.start,
        end: fixture.end,
        count: fixture.count,
      })
      // `metadata.productRef` is the INTM product the user linked in the stats
      // panel — the same `intm:<id>` shape painted surfaces carry, so
      // `matchMaterial` resolves it the same way. Grouped by ref so lights
      // linked to different products stay separate order lines. A combined
      // catalog model groups (and labels) by its asset instead of the bare
      // light type — that is the thing being bought.
      const productRef =
        typeof fixture.metadata?.productRef === 'string' ? fixture.metadata.productRef : undefined
      push(lines, {
        category: 'lighting',
        key: productRef ?? (fixture.asset?.id ? `asset:${fixture.asset.id}` : lightType),
        label: fixture.asset?.name ?? LIGHT_TYPE_LABEL[lightType] ?? `조명 ${lightType}`,
        unit: 'ea',
        quantity,
        nodeIds: [node.id],
        materialRef: productRef,
      })
      // Linear fixtures (T5 / LED strip) are bought by the metre — the run
      // length is the number that order is derived from.
      if (lightType === 'linear' && fixture.start && fixture.end) {
        push(lines, {
          category: 'lighting',
          key: 'linear-length',
          label: '라인 조명 길이',
          unit: 'm',
          quantity: Math.hypot(
            fixture.end[0] - fixture.start[0],
            fixture.end[1] - fixture.start[1],
          ),
          nodeIds: [node.id],
          role: 'measure',
        })
      }
      continue
    }

    if (node.type === 'slab' || node.type === 'ceiling') {
      // The field is `polygon`, not `points` — reading the wrong name made
      // every floor and ceiling measure zero. `holes` are real openings
      // (stairwells, voids) and come off the area.
      const surface = node as {
        polygon?: readonly (readonly [number, number])[]
        holes?: readonly (readonly (readonly [number, number])[])[]
        construction?: readonly WallConstructionLayerLike[]
      }
      const grossArea = polygonArea(surface.polygon ?? [])
      const holeArea = (surface.holes ?? []).reduce((total, hole) => total + polygonArea(hole), 0)
      const area = Math.max(0, grossArea - holeArea)
      const slots = (node as { slots?: Record<string, string> }).slots ?? {}
      const materialRef = slots.top ?? slots.surface ?? slots.bottom
      push(lines, {
        category: node.type === 'slab' ? 'floor' : 'ceiling',
        key: materialRef ?? node.type,
        label: materialRef ? `마감 ${materialRef}` : node.type === 'slab' ? '바닥' : '천장',
        unit: 'm2',
        quantity: area,
        nodeIds: [node.id],
        materialRef,
      })

      // The surface's own build-up: joists/furring by the metre, boards by the
      // sheet, screed by volume. Same expansion walls use.
      const category = node.type === 'slab' ? 'floor' : 'ceiling'
      for (const assemblyLine of surfaceAssemblyLines(
        surface.construction,
        { area, length: Math.sqrt(Math.max(area, 0)), height: Math.sqrt(Math.max(area, 0)) },
        node.id,
        category,
      )) {
        push(lines, assemblyLine)
      }
      continue
    }

    // Placed models (item catalogue / SketchUp components) — counted per
    // product, since that is how they are bought.
    if (node.type === 'item') {
      const asset = (node as { asset?: { name?: string; category?: string } }).asset
      const name = asset?.name ?? '배치 모델'
      push(lines, {
        category: 'item',
        key: asset?.category ? `${asset.category}:${name}` : name,
        label: name,
        unit: 'ea',
        quantity: 1,
        nodeIds: [node.id],
      })
      continue
    }

    if (node.type === 'wall') {
      const wall = node as WallNode
      if (!wall.start || !wall.end) continue
      // Curved walls measure along the arc, not across the chord. A wall drawn
      // without an explicit height stands at the same default the store and the
      // build-up use — measuring it as zero made whole walls disappear.
      const length = getWallCurveLength(wall)
      const faceArea = length * (wall.height ?? DEFAULT_WALL_HEIGHT)

      // A wall is a quantity in its own right — plaster, board and labour are
      // priced off it whether or not anyone has chosen a finish yet. Reporting
      // it only once painted made unfinished walls look like nothing at all.
      push(lines, {
        category: 'wall',
        key: 'face',
        label: '벽면 (양면)',
        unit: 'm2',
        quantity: faceArea * 2,
        nodeIds: [node.id],
        role: 'measure',
      })
      push(lines, {
        category: 'wall',
        key: 'length',
        label: '벽 길이',
        unit: 'm',
        quantity: length,
        nodeIds: [node.id],
        role: 'measure',
      })

      // The wall's own build-up: 각재 by the metre at its spacing, 석고보드 by
      // the sheet. A face area is not something anyone orders — this is.
      for (const assemblyLine of wallAssemblyLines(wall)) push(lines, assemblyLine)

      // Painted faces additionally group by material, so the estimate can
      // order by finish rather than by wall.
      for (const [slot, ref] of Object.entries(wall.slots ?? {})) {
        if (!ref || (slot !== 'interior' && slot !== 'exterior')) continue
        push(lines, {
          category: 'finish',
          key: ref,
          label: `벽 마감 ${ref}`,
          unit: 'm2',
          quantity: faceArea,
          nodeIds: [node.id],
          materialRef: ref,
        })
      }
    }
  }

  const totals = { ...EMPTY_TOTALS }
  for (const line of lines.values()) totals[line.category] += line.quantity

  return {
    lines: [...lines.values()].sort(
      (a, b) => a.category.localeCompare(b.category) || b.quantity - a.quantity,
    ),
    totals,
  }
}

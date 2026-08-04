import type { AnyNode, CabinetModuleNode, CabinetNode } from '@pascal-app/core'

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

export type TakeoffUnit = 'm2' | 'm3' | 'm' | 'ea'

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
}

export type TakeoffReport = {
  lines: TakeoffLine[]
  totals: Record<TakeoffCategory, number>
}

const EMPTY_TOTALS: Record<TakeoffCategory, number> = {
  board: 0,
  furniture: 0,
  lighting: 0,
  finish: 0,
  floor: 0,
  ceiling: 0,
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

function push(lines: Map<string, TakeoffLine>, line: TakeoffLine) {
  if (line.quantity <= 0) return
  const id = `${line.category}:${line.key}`
  const existing = lines.get(id)
  if (existing) {
    existing.quantity += line.quantity
    existing.nodeIds.push(...line.nodeIds)
    return
  }
  lines.set(id, { ...line, nodeIds: [...line.nodeIds] })
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
        })
      }
      continue
    }

    if (node.type === 'lighting-fixture') {
      const kind = (node as { fixtureKind?: string }).fixtureKind ?? node.type
      push(lines, {
        category: 'lighting',
        key: kind,
        label: `조명 ${kind}`,
        unit: 'ea',
        quantity: 1,
        nodeIds: [node.id],
      })
      continue
    }

    if (node.type === 'slab' || node.type === 'ceiling') {
      const points = (node as { points?: readonly (readonly [number, number])[] }).points ?? []
      const area = polygonArea(points)
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
      continue
    }

    // Painted wall faces — one line per material so the estimate can order by
    // finish rather than by wall.
    if (node.type === 'wall') {
      const wall = node as {
        start?: readonly [number, number]
        end?: readonly [number, number]
        height?: number
        slots?: Record<string, string>
      }
      const start = wall.start
      const end = wall.end
      if (!start || !end) continue
      const length = Math.hypot(end[0] - start[0], end[1] - start[1])
      const faceArea = length * (wall.height ?? 0)
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

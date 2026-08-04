import { describe, expect, test } from 'bun:test'
import type { FurnitureAssembly } from '../../schema/nodes/furniture'
import { buildFurnitureAssembly, type FurnitureAssemblyPartKind } from './assembly'
import { importFurnitureBuilder } from './import-furniture-builder'
import { normalizeFurnitureAssembly } from './normalize'

function furnitureAssembly(overrides: Record<string, unknown> = {}): FurnitureAssembly {
  return normalizeFurnitureAssembly({
    schema_version: 0.5,
    type: 'wardrobe',
    W: 1200,
    H: 2400,
    D: 600,
    bays: [
      {
        width: 1200,
        base: { type: 'none' },
        kickplate: false,
        ep: { left: true, right: true },
        tiers: [{ height: 2400, door: 'open' }],
      },
    ],
    ...overrides,
  })
}

async function assemblyFixture(name: string): Promise<FurnitureAssembly> {
  const source = await Bun.file(new URL(`./fixtures/${name}.json`, import.meta.url)).json()
  const result = importFurnitureBuilder(source)
  if (!result.assembly) throw new Error(`Fixture "${name}" did not import.`)
  return result.assembly
}

describe('furniture assembly Gate 2 contract', () => {
  test('builds the wardrobe carcass with exact counts and bounds', async () => {
    const result = buildFurnitureAssembly(await assemblyFixture('wardrobe'))
    const counts = result.parts.reduce<Partial<Record<FurnitureAssemblyPartKind, number>>>(
      (total, part) => {
        total[part.kind] = (total[part.kind] ?? 0) + 1
        return total
      },
      {},
    )

    expect(counts).toEqual({
      'side-left': 1,
      'side-right': 1,
      'end-panel': 2,
      top: 2,
      bottom: 2,
      back: 2,
      shelf: 5,
      hanger: 1,
      divider: 1,
      plinth: 2,
      kickplate: 2,
      front: 2,
    })
    expect(result.bounds).toEqual({ min: [-1.2, 0, -0.3], max: [1.2, 2.4, 0.3] })
    expect(result.warnings).toEqual([])
  })

  test('builds all six normalized fixtures deterministically without duplicate IDs', async () => {
    const names = [
      'wardrobe',
      'island',
      'set',
      'sink',
      'drawer-cabinet',
      'furniture-sample',
    ] as const

    for (const name of names) {
      const assembly = await assemblyFixture(name)
      const first = buildFurnitureAssembly(assembly)
      const second = buildFurnitureAssembly(assembly)
      const ids = first.parts.map((part) => part.id)

      expect(first).toEqual(second)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  test('keeps semantic part IDs stable when dimensions change', async () => {
    const assembly = await assemblyFixture('wardrobe')
    const resized: FurnitureAssembly = {
      ...assembly,
      dimensions: { width: 2.8, height: 2.6, depth: 0.7 },
    }

    expect(buildFurnitureAssembly(resized).parts.map((part) => part.id)).toEqual(
      buildFurnitureAssembly(assembly).parts.map((part) => part.id),
    )
  })

  test('places hanger rods at 25mm diameter, 30mm side inset, and 60mm top clearance', async () => {
    const assembly = await assemblyFixture('wardrobe')
    const hanger = buildFurnitureAssembly(assembly).parts.find((part) => part.kind === 'hanger')

    expect(hanger).toBeDefined()
    expect(hanger?.size[0]).toBeCloseTo(1.104)
    expect(hanger?.size[1]).toBeCloseTo(0.025)
    expect(hanger?.size[2]).toBeCloseTo(0.025)
    expect(hanger?.position[0]).toBeCloseTo(-0.6)
    expect(hanger?.position[1]).toBeCloseTo(2.1775)
    expect(hanger?.position[2]).toBeCloseTo(0)
    expect(hanger?.materialId).toBe(assembly.materialDefaults.hardware)
  })

  test('reports width mismatch and tier overflow in deterministic order', async () => {
    const assembly = await assemblyFixture('drawer-cabinet')
    const mismatched: FurnitureAssembly = {
      ...assembly,
      dimensions: { ...assembly.dimensions, width: 1.2 },
    }

    expect(buildFurnitureAssembly(mismatched).warnings.map((warning) => warning.code)).toEqual([
      'bay-width-mismatch',
      'tier-height-overflow',
    ])
  })

  test('skips invalid solids and reports their paths', async () => {
    const assembly = await assemblyFixture('drawer-cabinet')
    const result = buildFurnitureAssembly(assembly, { carcassThickness: 0.5 })

    expect(result.parts.some((part) => part.kind === 'top')).toBe(false)
    expect(result.warnings.some((warning) => warning.code === 'invalid-part-dimensions')).toBe(true)
  })

  test('rejects invalid construction options', async () => {
    const assembly = await assemblyFixture('wardrobe')

    expect(() => buildFurnitureAssembly(assembly, { carcassThickness: 0 })).toThrow(RangeError)
    expect(() => buildFurnitureAssembly(assembly, { backThickness: Number.NaN })).toThrow(
      RangeError,
    )
    expect(() => buildFurnitureAssembly(assembly, { rodDiameter: -0.01 })).toThrow(RangeError)
    expect(() => buildFurnitureAssembly(assembly, { frontThickness: 0 })).toThrow(RangeError)
    expect(() => buildFurnitureAssembly(assembly, { frontGap: -0.001 })).toThrow(RangeError)
  })

  test('renders every front kind with the documented part count', () => {
    const cases: Array<{ front: Record<string, unknown>; count: number }> = [
      { front: { kind: 'open' }, count: 0 },
      { front: { kind: 'hinged', leaves: 2 }, count: 2 },
      { front: { kind: 'drawer', count: 3 }, count: 3 },
      { front: { kind: 'flap', direction: 'up' }, count: 1 },
      { front: { kind: 'sliding', leaves: 3 }, count: 3 },
      { front: { kind: 'pull-out', style: 'standard' }, count: 1 },
    ]

    for (const { front, count } of cases) {
      const assembly = furnitureAssembly({
        bays: [
          {
            width: 1200,
            base: { type: 'none' },
            kickplate: false,
            tiers: [{ height: 2400, front }],
          },
        ],
      })
      const fronts = buildFurnitureAssembly(assembly).parts.filter((part) => part.kind === 'front')
      expect(fronts).toHaveLength(count)
    }
  })

  test('positions fronts flush with the front face reveal', () => {
    const assembly = furnitureAssembly({
      bays: [
        {
          width: 1200,
          base: { type: 'none' },
          kickplate: false,
          tiers: [{ height: 2400, front: { kind: 'hinged', leaves: 1 } }],
        },
      ],
    })
    const front = buildFurnitureAssembly(assembly).parts.find((part) => part.kind === 'front')

    expect(front?.position[2]).toBeCloseTo(0.6 / 2 - 0.018 / 2)
  })

  test('offsets alternating sliding leaves so they read as overlapping panels', () => {
    const assembly = furnitureAssembly({
      bays: [
        {
          width: 1200,
          base: { type: 'none' },
          kickplate: false,
          tiers: [{ height: 2400, front: { kind: 'sliding', leaves: 3 } }],
        },
      ],
    })
    const fronts = buildFurnitureAssembly(assembly).parts.filter((part) => part.kind === 'front')
    const frontZ = 0.6 / 2 - 0.018 / 2

    expect(fronts.map((part) => part.position[2])).toEqual([frontZ, frontZ - 0.018, frontZ])
  })

  test('suppresses front parts for hidden bays and tiers', () => {
    const hiddenBay = furnitureAssembly({
      bays: [
        {
          width: 1200,
          base: { type: 'none' },
          kickplate: false,
          hidden: true,
          tiers: [{ height: 2400, front: { kind: 'hinged', leaves: 2 } }],
        },
      ],
    })
    expect(buildFurnitureAssembly(hiddenBay).parts.some((part) => part.kind === 'front')).toBe(
      false,
    )

    const hiddenTier = furnitureAssembly({
      bays: [
        {
          width: 1200,
          base: { type: 'none' },
          kickplate: false,
          tiers: [{ height: 2400, front: { kind: 'hinged', leaves: 2 }, hidden: true }],
        },
      ],
    })
    expect(buildFurnitureAssembly(hiddenTier).parts.some((part) => part.kind === 'front')).toBe(
      false,
    )
  })

  test('adds exposed end panels from the outer bays endPanels flags', () => {
    const bothSuppressed = furnitureAssembly({
      bays: [
        {
          width: 600,
          base: { type: 'none' },
          kickplate: false,
          ep: { left: false, right: false },
          tiers: [{ height: 2400, door: 'open' }],
        },
        {
          width: 600,
          base: { type: 'none' },
          kickplate: false,
          ep: { left: false, right: false },
          tiers: [{ height: 2400, door: 'open' }],
        },
      ],
    })
    // EP is a finish panel over an exposed end, so it defaults off — but the
    // structural carcass sides must be there either way.
    const suppressedKinds = buildFurnitureAssembly(bothSuppressed).parts.map((part) => part.kind)
    expect(suppressedKinds).toContain('side-left')
    expect(suppressedKinds).toContain('side-right')
    expect(suppressedKinds).not.toContain('end-panel')

    const bothVisible = furnitureAssembly({
      bays: [
        {
          width: 600,
          base: { type: 'none' },
          kickplate: false,
          ep: { left: true, right: false },
          tiers: [{ height: 2400, door: 'open' }],
        },
        {
          width: 600,
          base: { type: 'none' },
          kickplate: false,
          ep: { left: false, right: true },
          tiers: [{ height: 2400, door: 'open' }],
        },
      ],
    })
    const visibleParts = buildFurnitureAssembly(bothVisible).parts
    const visibleKinds = visibleParts.map((part) => part.kind)
    expect(visibleKinds).toContain('side-left')
    expect(visibleKinds).toContain('side-right')
    expect(visibleParts.filter((part) => part.kind === 'end-panel').map((part) => part.id)).toEqual(
      ['end-panel:left', 'end-panel:right'],
    )
  })

  test('renders distinct geometry for each bay base type', () => {
    const baseTypes = ['plinth', 'legs', 'floating', 'none'] as const
    const partsByType = new Map<string, string[]>()

    for (const type of baseTypes) {
      const assembly = furnitureAssembly({
        bays: [
          {
            width: 1200,
            base: { type, height: type === 'none' ? 0 : 100 },
            kickplate: false,
            tiers: [{ height: 2400, door: 'open' }],
          },
        ],
      })
      const baseParts = buildFurnitureAssembly(assembly)
        .parts.filter((part) => part.kind === 'plinth' || part.kind === 'leg')
        .map((part) => part.kind)
      partsByType.set(type, baseParts)
    }

    expect(partsByType.get('plinth')).toEqual(['plinth'])
    expect(partsByType.get('legs')).toEqual(['leg', 'leg', 'leg', 'leg'])
    expect(partsByType.get('floating')).toEqual([])
    expect(partsByType.get('none')).toEqual([])
  })
})

describe('two-sided island (backBays + depthSplit)', () => {
  test('renders parts for both faces with no duplicate IDs', async () => {
    const assembly = await assemblyFixture('island')
    const result = buildFurnitureAssembly(assembly)
    const ids = result.parts.map((part) => part.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(result.parts.some((part) => part.face === 'front')).toBe(true)
    expect(result.parts.some((part) => part.face === 'back')).toBe(true)
    expect(result.warnings).toEqual([])
  })

  test('back-face fronts sit on the -Z side, front-face fronts on +Z', async () => {
    const assembly = await assemblyFixture('island')
    const fronts = buildFurnitureAssembly(assembly).parts.filter((part) => part.kind === 'front')
    const frontFaceFronts = fronts.filter((part) => part.face === 'front')
    const backFaceFronts = fronts.filter((part) => part.face === 'back')

    expect(frontFaceFronts.length).toBeGreaterThan(0)
    expect(backFaceFronts.length).toBeGreaterThan(0)
    expect(frontFaceFronts.every((part) => part.position[2] > 0)).toBe(true)
    expect(backFaceFronts.every((part) => part.position[2] < 0)).toBe(true)
  })

  test('honors an asymmetric depthSplit for front vs back carcass depth', async () => {
    // The island fixture splits 1200mm total as frontD 400 / backD 800.
    // Measured on the bay bottoms: an island is a worktop kind, so its
    // countertop replaces the per-face carcass tops entirely.
    const assembly = await assemblyFixture('island')
    const bottoms = buildFurnitureAssembly(assembly).parts.filter((part) => part.kind === 'bottom')
    const frontBottom = bottoms.find((part) => part.face === 'front')
    const backBottom = bottoms.find((part) => part.face === 'back')

    expect(frontBottom?.size[2]).toBeCloseTo(assembly.depthSplit?.front ?? 0)
    expect(backBottom?.size[2]).toBeCloseTo(assembly.depthSplit?.back ?? 0)
    expect(frontBottom?.size[2]).not.toBeCloseTo(backBottom?.size[2] ?? 0)
  })

  test('emits exactly one shared spine panel per bay, not one per face', async () => {
    const assembly = await assemblyFixture('island')
    const backPanels = buildFurnitureAssembly(assembly).parts.filter((part) => part.kind === 'back')

    expect(backPanels).toHaveLength(assembly.bays.length)
    expect(backPanels.every((part) => part.face === 'front')).toBe(true)
  })

  test('front-only assemblies never stamp a face onto parts', async () => {
    const assembly = await assemblyFixture('wardrobe')
    const result = buildFurnitureAssembly(assembly)

    expect(result.parts.every((part) => part.face === undefined)).toBe(true)
  })
})

describe('front open/close pose', () => {
  function frontPoseFor(front: Record<string, unknown>) {
    const assembly = furnitureAssembly({
      bays: [
        {
          width: 1200,
          base: { type: 'none' },
          kickplate: false,
          tiers: [{ height: 2400, front }],
        },
      ],
    })
    return buildFurnitureAssembly(assembly).parts.filter((part) => part.kind === 'front')
  }

  test('a single hinged leaf defaults to a left hinge, swinging toward +Z', () => {
    const [front] = frontPoseFor({ kind: 'hinged', leaves: 1 })
    expect(front?.frontPose).toEqual({
      kind: 'hinge',
      axis: 'y',
      hingeOffset: -(front!.size[0] / 2),
      angle: -(Math.PI / 2),
    })
  })

  test('a 2-leaf hinged front hinges left/right and opens symmetrically', () => {
    const [left, right] = frontPoseFor({ kind: 'hinged', leaves: 2 })
    if (left?.frontPose?.kind !== 'hinge' || right?.frontPose?.kind !== 'hinge') {
      throw new Error('expected hinge poses')
    }
    expect(left.frontPose.hingeOffset).toBeCloseTo(-left.size[0] / 2)
    expect(right.frontPose.hingeOffset).toBeCloseTo(right.size[0] / 2)
    expect(left.frontPose.angle).toBeCloseTo(-right.frontPose.angle)
    expect(left.frontPose.angle).toBeLessThan(0)
    expect(right.frontPose.angle).toBeGreaterThan(0)
  })

  test('flap direction picks which edge hinges', () => {
    const [up] = frontPoseFor({ kind: 'flap', direction: 'up' })
    const [down] = frontPoseFor({ kind: 'flap', direction: 'down' })
    if (up?.frontPose?.kind !== 'hinge' || down?.frontPose?.kind !== 'hinge') {
      throw new Error('expected hinge poses')
    }
    expect(up.frontPose.axis).toBe('x')
    expect(up.frontPose.hingeOffset).toBeCloseTo(up.size[1] / 2)
    expect(down.frontPose.hingeOffset).toBeCloseTo(-(down.size[1] / 2))
    expect(up.frontPose.angle).toBeCloseTo(-down.frontPose.angle)
  })

  test('sliding leaves alternate open direction so same-track leaves keep their spacing', () => {
    const fronts = frontPoseFor({ kind: 'sliding', leaves: 4 })
    const distances = fronts.map((part) =>
      part.frontPose?.kind === 'slide' ? part.frontPose.distance : null,
    )

    expect(distances[0]).toBeCloseTo(distances[2]!)
    expect(distances[1]).toBeCloseTo(distances[3]!)
    expect(Math.sign(distances[0]!)).toBe(-Math.sign(distances[1]!))
  })

  test('stacked drawer fronts cascade open, the bottom drawer opening furthest', () => {
    const fronts = frontPoseFor({ kind: 'drawer', count: 3 })
    // Emitted bottom-to-top (index 0 = bottom drawer).
    const distances = fronts.map((part) =>
      part.frontPose?.kind === 'slide' ? part.frontPose.distance : 0,
    )

    expect(distances[0]).toBeGreaterThan(distances[1]!)
    expect(distances[1]).toBeGreaterThan(distances[2]!)
    expect(distances.every((distance) => distance > 0)).toBe(true)
  })

  test('a pull-out front slides out like a single drawer', () => {
    const [front] = frontPoseFor({ kind: 'pull-out', style: 'standard' })
    expect(front?.frontPose?.kind).toBe('slide')
    if (front?.frontPose?.kind === 'slide') {
      expect(front.frontPose.axis).toBe('z')
      expect(front.frontPose.distance).toBeGreaterThan(0)
    }
  })

  test('back-face fronts hinge toward their own outward -Z direction', async () => {
    const assembly = await assemblyFixture('island')
    const fronts = buildFurnitureAssembly(assembly).parts.filter((part) => part.kind === 'front')
    const frontFace = fronts.find(
      (part) => part.face === 'front' && part.frontPose?.kind === 'hinge',
    )
    const backFace = fronts.find((part) => part.face === 'back' && part.frontPose?.kind === 'hinge')
    if (frontFace?.frontPose?.kind !== 'hinge' || backFace?.frontPose?.kind !== 'hinge') {
      throw new Error('expected hinge poses on both faces')
    }

    // Same hinge side (matching bay position), mirrored open direction.
    expect(Math.sign(frontFace.frontPose.hingeOffset)).toBe(
      Math.sign(backFace.frontPose.hingeOffset),
    )
    expect(Math.sign(frontFace.frontPose.angle)).toBe(-Math.sign(backFace.frontPose.angle))
  })
})

describe('countertop', () => {
  const worktopKinds = ['base-run', 'island', 'sink'] as const
  const carcassKinds = ['wardrobe', 'upper-run', 'tall', 'set'] as const

  function ofKind(kind: FurnitureAssembly['furnitureKind'], height = 0.85): FurnitureAssembly {
    return { ...furnitureAssembly({ H: height * 1000 }), furnitureKind: kind }
  }

  test.each(worktopKinds)('%s gets one worktop spanning the full footprint', (kind) => {
    const assembly = ofKind(kind)
    const { parts, bounds } = buildFurnitureAssembly(assembly)
    const countertops = parts.filter((part) => part.kind === 'countertop')

    expect(countertops).toHaveLength(1)
    const [slab] = countertops
    expect(slab!.size[0]).toBeCloseTo(assembly.dimensions.width)
    expect(slab!.size[2]).toBeCloseTo(assembly.dimensions.depth)
    // Sits inside the declared envelope — a slab poking out would split the
    // rendered extent from the node's own width/depth/height.
    expect(slab!.position[1] + slab!.size[1] / 2).toBeCloseTo(bounds.max[1])
  })

  test.each(worktopKinds)('%s drops the carcass top — the slab is the top', (kind) => {
    const parts = buildFurnitureAssembly(ofKind(kind)).parts
    expect(parts.filter((part) => part.kind === 'top')).toHaveLength(0)
  })

  test.each(carcassKinds)('%s keeps its carcass top and gets no worktop', (kind) => {
    const parts = buildFurnitureAssembly(ofKind(kind, 2.4)).parts
    expect(parts.filter((part) => part.kind === 'countertop')).toHaveLength(0)
    expect(parts.filter((part) => part.kind === 'top').length).toBeGreaterThan(0)
  })

  test('the worktop takes the countertop material slot', () => {
    const base = ofKind('base-run')
    const assembly: FurnitureAssembly = {
      ...base,
      materialDefaults: { ...base.materialDefaults, countertop: 'library:stone-marble' },
    }
    const slab = buildFurnitureAssembly(assembly).parts.find((part) => part.kind === 'countertop')
    expect(slab?.materialId).toBe('library:stone-marble')
  })

  test('a worktop thicker than half the piece is clamped, not degenerate', () => {
    const { parts, warnings } = buildFurnitureAssembly(ofKind('base-run', 0.1), {
      countertopThickness: 0.4,
    })
    const slab = parts.find((part) => part.kind === 'countertop')

    expect(slab?.size[1]).toBeCloseTo(0.05)
    expect(warnings.filter((warning) => warning.code === 'invalid-part-dimensions')).toHaveLength(0)
  })
})

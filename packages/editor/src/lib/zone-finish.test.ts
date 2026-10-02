import { describe, expect, it } from 'bun:test'
import type {
  AnyNode,
  CeilingNode,
  SceneMaterial,
  SlabNode,
  Space,
  WallNode,
} from '@pascal-app/core'
import { LevelNode, useScene, WallNode as WallSchema, ZoneNode } from '@pascal-app/core'
import {
  applyHomeFinishTemplate,
  applyMaterialToCapturedZoneTarget,
  applyZoneFinishTemplate,
  captureZoneFinishTemplate,
  commitZoneFinishApply,
  createHomeFinishTemplate,
  inspectZoneFinishTarget,
  planZoneFinishApply,
  type ZoneFinishContext,
  type ZoneFinishTemplateSnapshot,
  type ZoneFinishWallKey,
} from './zone-finish'

if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
}

const LEVEL_ID = 'level_test'
const DETACHED_LEVEL_ID = ''
const MATERIALS: Record<string, SceneMaterial> = {
  wall: { id: 'mat_wall', name: 'Wall', material: { preset: 'white' } },
}
const WALL_REFS = {
  interior: 'library:wood-finewood27',
  exterior: 'library:flooring-rusticbrick',
}

const square = (x = 0, z = 0, size = 4): Array<[number, number]> => [
  [x, z],
  [x + size, z],
  [x + size, z + size],
  [x, z + size],
]

function makeWall(
  id: string,
  start: [number, number],
  end: [number, number],
  sides: Pick<WallNode, 'frontSide' | 'backSide'> = {
    frontSide: 'interior',
    backSide: 'exterior',
  },
): WallNode {
  return {
    id,
    type: 'wall',
    parentId: LEVEL_ID,
    start,
    end,
    thickness: 0.2,
    height: 2.7,
    ...sides,
    slots: {
      interior: WALL_REFS.interior,
      exterior: WALL_REFS.exterior,
      lowerInterior: WALL_REFS.interior,
      upperInterior: WALL_REFS.interior,
      lowerExterior: WALL_REFS.exterior,
      upperExterior: WALL_REFS.exterior,
    },
    faceBands: {
      enabled: true,
      count: 2,
      lowerHeight: 0.8,
      middleHeight: 0.6,
      upperHeight: 0.6,
    },
  } as unknown as WallNode
}

function makeZone(id = 'zone_room', polygon = square()): AnyNode {
  return {
    id,
    type: 'zone',
    name: id,
    parentId: LEVEL_ID,
    polygon,
    boundaryWallIds: ['wall_bottom', 'wall_right', 'wall_top', 'wall_left'],
    autoFromWalls: true,
    spaceRole: 'room',
  } as unknown as AnyNode
}

function makeSpace(zoneId = 'space_room', polygon = square()): Space {
  const boundary = [
    {
      wallId: 'wall_bottom',
      face: 'front' as const,
      points: [
        [0, 0],
        [4, 0],
      ] as Array<[number, number]>,
    },
    {
      wallId: 'wall_right',
      face: 'front' as const,
      points: [
        [4, 0],
        [4, 4],
      ] as Array<[number, number]>,
    },
    {
      wallId: 'wall_top',
      face: 'front' as const,
      points: [
        [4, 4],
        [0, 4],
      ] as Array<[number, number]>,
    },
    {
      wallId: 'wall_left',
      face: 'front' as const,
      points: [
        [0, 4],
        [0, 0],
      ] as Array<[number, number]>,
    },
  ]
  return {
    id: zoneId,
    levelId: LEVEL_ID,
    polygon,
    wallIds: boundary.map((entry) => entry.wallId),
    boundaryFaces: boundary,
    isExterior: false,
  } as unknown as Space
}

function makeSlab(
  id: string,
  polygon: Array<[number, number]>,
  overrides: Partial<SlabNode> = {},
): SlabNode {
  return {
    id,
    type: 'slab',
    parentId: LEVEL_ID,
    polygon,
    holes: [],
    construction: [],
    elevation: 0.05,
    thickness: 0.05,
    recessed: false,
    autoFromWalls: false,
    slots: { surface: WALL_REFS.interior },
    ...overrides,
  } as unknown as SlabNode
}

function makeCeiling(
  id: string,
  polygon: Array<[number, number]>,
  overrides: Partial<CeilingNode> = {},
): CeilingNode {
  return {
    id,
    type: 'ceiling',
    parentId: LEVEL_ID,
    polygon,
    holes: [],
    holeMetadata: [],
    construction: [],
    autoFromWalls: false,
    features: [],
    slots: { surface: WALL_REFS.interior },
    ...overrides,
  } as unknown as CeilingNode
}

function context(overrides: Partial<ZoneFinishContext> = {}): ZoneFinishContext {
  const walls = [
    makeWall('wall_bottom', [0, 0], [4, 0]),
    makeWall('wall_right', [4, 0], [4, 4]),
    makeWall('wall_top', [4, 4], [0, 4]),
    makeWall('wall_left', [0, 4], [0, 0]),
  ]
  const zone = makeZone()
  return {
    nodes: Object.fromEntries([zone, ...walls].map((node) => [node.id, node])),
    materials: MATERIALS,
    spaces: { space_room: makeSpace() },
    ...overrides,
  }
}

describe('zone finish resolver', () => {
  it('resolves each inward face and reports a missing floor for a zero-Slab Zone', () => {
    const result = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'walls',
      ...context(),
    })

    expect(result.wallFaces.map((face) => face.key)).toEqual([
      'wall_bottom:front',
      'wall_right:front',
      'wall_top:front',
      'wall_left:front',
    ])
    expect(result.wallFaces[0]?.roles).toEqual(['interior', 'lowerInterior', 'upperInterior'])
    expect(result.floor).toEqual({ status: 'creatable' })
    expect(result.completion.total).toBe(12)
    expect(result.completion.missing).toEqual([])
  })

  it('reports unique regional material refs before direct wall-slot fallback', () => {
    const current = context()
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'wall',
      wallKey: 'wall_bottom:front',
      ...current,
    })
    expect(target.materialRefs).toEqual([WALL_REFS.interior])
    expect(target.materialCount).toBe(1)

    const regionalWall = {
      ...(current.nodes.wall_bottom as WallNode),
      finishRegions: [
        {
          id: 'zone-finish:region-display',
          side: 'interior' as const,
          start: 0,
          end: 1,
          slots: {
            interior: WALL_REFS.exterior,
            lowerInterior: WALL_REFS.exterior,
            upperInterior: WALL_REFS.exterior,
          },
        },
      ],
    } as WallNode
    const regional = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'wall',
      wallKey: 'wall_bottom:front',
      nodes: { ...current.nodes, wall_bottom: regionalWall },
      materials: current.materials,
      spaces: current.spaces,
    })

    expect(regional.materialRefs).toEqual([WALL_REFS.exterior])
    expect(regional.materialCount).toBe(1)
  })

  it('uses the selected wall face target without including the floor in completion', () => {
    const all = inspectZoneFinishTarget({ zoneId: 'zone_room', kind: 'walls', ...context() })
    const one = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'wall',
      wallKey: 'wall_right:front',
      ...context(),
    })

    expect(one.wallFaces).toHaveLength(4)
    expect(one.target.fingerprint).not.toBe(all.target.fingerprint)
    expect(one.completion.total).toBe(3)
    expect(one.completion.missing.some((entry) => entry.role === 'floor')).toBe(false)

    const staleWall = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'wall',
      wallKey: 'wall_missing:front',
      ...context(),
    })
    expect(staleWall.completion.missing).toContainEqual({
      nodeId: 'zone_room',
      role: 'wall_missing:front',
    })

    const floor = inspectZoneFinishTarget({ zoneId: 'zone_room', kind: 'floor', ...context() })
    expect(floor.completion).toMatchObject({ explicit: 0, total: 1 })
    expect(floor.completion.missing).toContainEqual({ nodeId: 'zone_room', role: 'floor' })
  })

  it('patches only the selected face while preserving opposite and inactive slots', () => {
    const current = context()
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'wall',
      wallKey: 'wall_bottom:front',
      ...current,
    }).target
    const result = planZoneFinishApply({
      target,
      materialPreset: WALL_REFS.exterior,
      ...current,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const patch = result.plan.nodePatches.find((entry) => entry.id === 'wall_bottom')
    expect(patch?.data).toMatchObject({
      slots: {
        interior: WALL_REFS.exterior,
        lowerInterior: WALL_REFS.exterior,
        upperInterior: WALL_REFS.exterior,
        exterior: WALL_REFS.exterior,
        lowerExterior: WALL_REFS.exterior,
        upperExterior: WALL_REFS.exterior,
      },
    })
  })

  it('creates one ground Slab at the Zone footprint when the level has no Slabs', () => {
    const current = context()
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'floor',
      ...current,
    }).target
    const result = applyMaterialToCapturedZoneTarget({
      target,
      materialPreset: 'library:wood-finewood27',
      ...current,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const slab = result.plan.createNodes[0]?.node as SlabNode | undefined
    expect(slab?.type).toBe('slab')
    expect(slab?.polygon).toEqual(square())
    expect(slab?.elevation).toBe(0.05)
    expect(slab?.slots?.surface).toBe('library:wood-finewood27')
    expect(slab?.metadata).toEqual({ zoneFinish: { version: 1, zoneId: 'zone_room' } })
  })

  it('inspects and creates one Zone-footprint Ceiling without inventing a height', () => {
    const current = context()
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'ceiling',
      ...current,
    })
    expect(target.ceiling).toEqual({ status: 'creatable', explicit: false })
    expect(target.completion).toMatchObject({ explicit: 0, total: 1 })
    expect(target.completion.missing).toContainEqual({ nodeId: 'zone_room', role: 'ceiling' })

    const result = applyMaterialToCapturedZoneTarget({
      target: target.target,
      materialPreset: WALL_REFS.interior,
      ...current,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.nodePatches).toHaveLength(0)
    expect(result.plan.createNodes).toHaveLength(1)
    const ceiling = result.plan.createNodes[0]?.node as CeilingNode | undefined
    expect(ceiling?.type).toBe('ceiling')
    expect(ceiling?.polygon).toEqual(square())
    expect(ceiling?.height).toBeUndefined()
    expect(ceiling?.autoFromWalls).toBe(false)
    expect(ceiling?.slots?.surface).toBe(WALL_REFS.interior)
  })

  it('patches one exact Ceiling surface while preserving its authored fields', () => {
    const ceiling = makeCeiling('ceiling_exact', square(), {
      height: 2.35,
      holes: [square(10, 10, 1)],
      features: [
        {
          kind: 'drop',
          edgeIndex: 0,
          profile: [
            [0, 0],
            [0.1, 0],
            [0.1, -0.1],
          ],
        },
      ],
    })
    const current = context({ nodes: { ...context().nodes, [ceiling.id]: ceiling } })
    const inspected = inspectZoneFinishTarget({ zoneId: 'zone_room', kind: 'ceiling', ...current })
    expect(inspected.ceiling).toMatchObject({
      status: 'existing',
      ceilingId: ceiling.id,
      explicit: true,
    })
    const result = planZoneFinishApply({
      target: inspected.target,
      materialPreset: WALL_REFS.exterior,
      ...current,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.createNodes).toHaveLength(0)
    expect(result.plan.nodePatches).toEqual([
      {
        id: ceiling.id,
        data: { slots: { surface: WALL_REFS.exterior } },
      },
    ])
  })

  it('commits a created Ceiling and its material in one undo step', () => {
    const current = context()
    const level = LevelNode.parse({ id: LEVEL_ID, level: 0 })
    const nodes: Record<string, AnyNode> = { ...current.nodes, [LEVEL_ID]: level }
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'ceiling',
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    }).target
    const planned = planZoneFinishApply({
      target,
      material: {
        preset: 'custom',
        texture: { url: 'https://example.test/ceiling.png', repeat: [1, 1] },
      },
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    const saved = useScene.getState()
    try {
      useScene.setState({
        nodes,
        rootNodeIds: [LEVEL_ID],
        collections: {},
        materials: current.materials,
        dirtyNodes: new Set(),
        readOnly: false,
      } as never)
      useScene.temporal.getState().clear()
      const committed = commitZoneFinishApply(planned.plan)
      expect(committed.ok).toBe(true)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      const created = Object.values(useScene.getState().nodes).find(
        (node) => node.type === 'ceiling' && node.parentId === LEVEL_ID,
      ) as CeilingNode | undefined
      expect(created?.height).toBeUndefined()
      useScene.temporal.getState().undo()
      expect(Object.values(useScene.getState().nodes).some((node) => node.type === 'ceiling')).toBe(
        false,
      )
    } finally {
      useScene.setState({
        nodes: saved.nodes,
        rootNodeIds: saved.rootNodeIds,
        collections: saved.collections,
        materials: saved.materials,
        dirtyNodes: saved.dirtyNodes,
        readOnly: saved.readOnly,
      } as never)
      useScene.temporal.getState().clear()
    }
  })

  it('blocks containing, partial, duplicate, and hole Ceiling conflicts before mutation', () => {
    const cases: Array<{ id: string; ceilings: CeilingNode[]; expected: string[] }> = [
      {
        id: 'ceiling_containing',
        ceilings: [makeCeiling('ceiling_containing', square(-1, -1, 6))],
        expected: ['ceiling_containing'],
      },
      {
        id: 'ceiling_partial',
        ceilings: [makeCeiling('ceiling_partial', square(3, 1, 3))],
        expected: ['ceiling_partial'],
      },
      {
        id: 'ceiling_duplicate',
        ceilings: [
          makeCeiling('ceiling_duplicate_a', square()),
          makeCeiling('ceiling_duplicate_b', square()),
        ],
        expected: ['ceiling_duplicate_a', 'ceiling_duplicate_b'],
      },
      {
        id: 'ceiling_hole',
        ceilings: [
          makeCeiling('ceiling_hole', square(), {
            holes: [
              [
                [1, 0],
                [3, 0],
                [3, 4],
                [1, 4],
              ],
            ],
          }),
        ],
        expected: ['ceiling_hole'],
      },
    ]
    for (const testCase of cases) {
      const base = context()
      const nodes = {
        ...base.nodes,
        ...Object.fromEntries(testCase.ceilings.map((ceiling) => [ceiling.id, ceiling])),
      }
      const target = inspectZoneFinishTarget({
        zoneId: 'zone_room',
        kind: 'ceiling',
        nodes,
        materials: base.materials,
        spaces: base.spaces,
      })
      expect(target.ceiling.status).toBe('blocked')
      if (target.ceiling.status !== 'blocked') continue
      expect(target.ceiling.conflictIds).toEqual(testCase.expected)
      const result = planZoneFinishApply({
        target: target.target,
        materialPreset: WALL_REFS.exterior,
        nodes,
        materials: base.materials,
        spaces: base.spaces,
      })
      expect(result).toMatchObject({ ok: false, code: 'ceiling-blocked' })
    }
  })

  it('blocks a Slab with a positive aligned overlap even when every vertex is on the boundary', () => {
    const current = context()
    const alignedZone = makeZone('zone_aligned', [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ])
    const alignedSlab = makeSlab('slab_aligned', [
      [1, 0],
      [3, 0],
      [3, 2],
      [1, 2],
    ])
    const target = inspectZoneFinishTarget({
      zoneId: alignedZone.id,
      kind: 'floor',
      nodes: { ...current.nodes, [alignedZone.id]: alignedZone, [alignedSlab.id]: alignedSlab },
      materials: current.materials,
      spaces: current.spaces,
    }).target
    const result = planZoneFinishApply({
      target,
      materialPreset: WALL_REFS.interior,
      nodes: { ...current.nodes, [alignedZone.id]: alignedZone, [alignedSlab.id]: alignedSlab },
      materials: current.materials,
      spaces: current.spaces,
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'floor-blocked',
      conflictIds: ['slab_aligned'],
    })
  })

  it('allows adjacent Slabs that only share an edge with the Zone', () => {
    const current = context()
    const alignedZone = makeZone('zone_touching', [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ])
    const touchingSlab = makeSlab('slab_touching', [
      [2, 0],
      [4, 0],
      [4, 2],
      [2, 2],
    ])
    const nodes = {
      ...current.nodes,
      [alignedZone.id]: alignedZone,
      [touchingSlab.id]: touchingSlab,
    }
    const target = inspectZoneFinishTarget({
      zoneId: alignedZone.id,
      kind: 'floor',
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    }).target
    const result = planZoneFinishApply({
      target,
      materialPreset: WALL_REFS.interior,
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    })

    expect(result.ok).toBe(true)
  })

  it('blocks an aligned hole when a containing Slab would otherwise support the Zone', () => {
    const current = context()
    const alignedZone = makeZone('zone_hole', [
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
    ])
    const containingSlab = makeSlab('slab_hole_base', square(-1, -1, 6), {
      holes: [
        [
          [1, 0],
          [3, 0],
          [3, 2],
          [1, 2],
        ],
      ],
    })
    const nodes = {
      ...current.nodes,
      [alignedZone.id]: alignedZone,
      [containingSlab.id]: containingSlab,
    }
    const target = inspectZoneFinishTarget({
      zoneId: alignedZone.id,
      kind: 'floor',
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    }).target
    const result = planZoneFinishApply({
      target,
      materialPreset: WALL_REFS.interior,
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'floor-blocked',
      conflictIds: ['slab_hole_base'],
    })
  })

  it('checks holes after selecting a marked Slab among exact footprint matches', () => {
    const current = context()
    const marked = makeSlab('slab_marked_hole', square(), {
      holes: [
        [
          [1, 0],
          [3, 0],
          [3, 4],
          [1, 4],
        ],
      ],
      metadata: { zoneFinish: { version: 1, zoneId: 'zone_room' } },
    })
    const duplicate = makeSlab('slab_duplicate', square())
    const nodes = { ...current.nodes, [marked.id]: marked, [duplicate.id]: duplicate }
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'floor',
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    }).target
    const result = planZoneFinishApply({
      target,
      materialPreset: WALL_REFS.interior,
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'floor-blocked',
      conflictIds: ['slab_marked_hole'],
    })
  })

  it('does not let a marked exact Slab bypass another partial overlap', () => {
    const current = context()
    const marked = makeSlab('slab_marked', square(), {
      metadata: { zoneFinish: { version: 1, zoneId: 'zone_room' } },
    })
    const duplicate = makeSlab('slab_duplicate_clean', square())
    const partial = makeSlab('slab_partial', [
      [1, -1],
      [3, -1],
      [3, 1],
      [1, 1],
    ])
    const nodes = {
      ...current.nodes,
      [marked.id]: marked,
      [duplicate.id]: duplicate,
      [partial.id]: partial,
    }
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'floor',
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    }).target
    const result = planZoneFinishApply({
      target,
      materialPreset: WALL_REFS.interior,
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'floor-blocked',
      conflictIds: ['slab_partial'],
    })
  })

  it('rejects a floor plan when its level context changes before commit', () => {
    const current = context()
    const level = LevelNode.parse({ id: LEVEL_ID, level: 0 })
    const nodes: Record<string, AnyNode> = { ...current.nodes, [LEVEL_ID]: level }
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'floor',
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    }).target
    const planned = planZoneFinishApply({
      target,
      materialPreset: WALL_REFS.interior,
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.expectedContextFingerprint).toBeString()

    const saved = useScene.getState()
    try {
      useScene.setState({
        nodes,
        rootNodeIds: [LEVEL_ID],
        collections: {},
        materials: current.materials,
        dirtyNodes: new Set(),
        readOnly: false,
      } as never)
      useScene.temporal.getState().clear()
      useScene.getState().updateNode(LEVEL_ID, { level: 1 } as Partial<AnyNode>)
      const committed = commitZoneFinishApply(planned.plan)
      expect(committed).toMatchObject({ ok: false, code: 'stale-target' })
      expect(useScene.getState().nodes.zone_room).toEqual(nodes.zone_room)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    } finally {
      useScene.setState({
        nodes: saved.nodes,
        rootNodeIds: saved.rootNodeIds,
        collections: saved.collections,
        materials: saved.materials,
        dirtyNodes: saved.dirtyNodes,
        readOnly: saved.readOnly,
      } as never)
      useScene.temporal.getState().clear()
    }
  })

  it('rejects a ceiling plan when its level context changes before commit', () => {
    const current = context()
    const level = LevelNode.parse({ id: LEVEL_ID, level: 0 })
    const nodes: Record<string, AnyNode> = { ...current.nodes, [LEVEL_ID]: level }
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'ceiling',
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    }).target
    const planned = planZoneFinishApply({
      target,
      materialPreset: WALL_REFS.interior,
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.expectedContextFingerprint).toBeString()

    const saved = useScene.getState()
    try {
      useScene.setState({
        nodes,
        rootNodeIds: [LEVEL_ID],
        collections: {},
        materials: current.materials,
        dirtyNodes: new Set(),
        readOnly: false,
      } as never)
      useScene.temporal.getState().clear()
      useScene.getState().updateNode(LEVEL_ID, { level: 1 } as Partial<AnyNode>)
      const committed = commitZoneFinishApply(planned.plan)
      expect(committed).toMatchObject({ ok: false, code: 'stale-target' })
      expect(useScene.getState().nodes.zone_room).toEqual(nodes.zone_room)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    } finally {
      useScene.setState({
        nodes: saved.nodes,
        rootNodeIds: saved.rootNodeIds,
        collections: saved.collections,
        materials: saved.materials,
        dirtyNodes: saved.dirtyNodes,
        readOnly: saved.readOnly,
      } as never)
      useScene.temporal.getState().clear()
    }
  })

  it('applies every inward wall band in one undo step and preserves opposite slots', () => {
    const current = context()
    const level = LevelNode.parse({ id: LEVEL_ID, level: 0 })
    const nodes: Record<string, AnyNode> = { ...current.nodes, [LEVEL_ID]: level }
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'walls',
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    }).target
    const planned = planZoneFinishApply({
      target,
      material: {
        preset: 'custom',
        texture: { url: 'https://example.test/one-click-wall.png', repeat: [1, 1] },
      },
      nodes,
      materials: current.materials,
      spaces: current.spaces,
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return

    const saved = useScene.getState()
    try {
      useScene.setState({
        nodes,
        rootNodeIds: [LEVEL_ID],
        collections: {},
        materials: current.materials,
        dirtyNodes: new Set(),
        readOnly: false,
      } as never)
      useScene.temporal.getState().clear()
      const committed = commitZoneFinishApply(planned.plan)
      expect(committed.ok).toBe(true)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      if (!committed.ok) return
      const paintedRef = committed.plan.materialRef
      const committedNodes = useScene.getState().nodes as Record<string, AnyNode>
      for (const wallId of ['wall_bottom', 'wall_right', 'wall_top', 'wall_left']) {
        const wall = committedNodes[wallId] as WallNode
        expect(wall.slots).toMatchObject({
          interior: paintedRef,
          lowerInterior: paintedRef,
          upperInterior: paintedRef,
          exterior: WALL_REFS.exterior,
          lowerExterior: WALL_REFS.exterior,
          upperExterior: WALL_REFS.exterior,
        })
      }
      useScene.temporal.getState().undo()
      const undoneNodes = useScene.getState().nodes as Record<string, AnyNode>
      for (const wallId of ['wall_bottom', 'wall_right', 'wall_top', 'wall_left']) {
        expect(undoneNodes[wallId]).toEqual(nodes[wallId])
      }
    } finally {
      useScene.setState({
        nodes: saved.nodes,
        rootNodeIds: saved.rootNodeIds,
        collections: saved.collections,
        materials: saved.materials,
        dirtyNodes: saved.dirtyNodes,
        readOnly: saved.readOnly,
      } as never)
      useScene.temporal.getState().clear()
    }
  })

  it('ignores disjoint existing Slabs and overlays one containing structural base', () => {
    const base = makeSlab('slab_base', square(-1, -1, 6), { elevation: 0.35 })
    const disjoint = makeSlab('slab_other', square(10, 10, 2))
    const current = context({
      nodes: { ...context().nodes, slab_base: base, slab_other: disjoint },
    })
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'floor',
      ...current,
    }).target
    const result = planZoneFinishApply({
      target,
      materialPreset: 'library:wood-finewood27',
      ...current,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.nodePatches).toHaveLength(0)
    const finish = result.plan.createNodes[0]?.node as SlabNode | undefined
    expect(finish?.elevation).toBeCloseTo(0.37)
    expect(finish?.polygon).toEqual(square())
  })

  it('blocks an overlapping Slab before any wall or floor mutation', () => {
    const overlap = makeSlab('slab_overlap', square(3, 1, 3))
    const current = context({ nodes: { ...context().nodes, slab_overlap: overlap } })
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'floor',
      ...current,
    }).target
    const result = planZoneFinishApply({
      target,
      materialPreset: 'library:wood-finewood27',
      ...current,
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'floor-blocked',
      conflictIds: ['slab_overlap'],
    })
  })

  it('keeps a wall-only target independent from an unsafe floor', () => {
    const overlap = makeSlab('slab_overlap', square(3, 1, 3))
    const current = context({ nodes: { ...context().nodes, slab_overlap: overlap } })
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'walls',
      ...current,
    }).target
    const result = planZoneFinishApply({
      target,
      materialPreset: WALL_REFS.exterior,
      ...current,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.nodePatches).toHaveLength(4)
    expect(result.plan.createNodes).toHaveLength(0)
  })

  it('does not silently accept an unavailable library material', () => {
    const current = context()
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'floor',
      ...current,
    }).target
    const result = planZoneFinishApply({
      target,
      materialPreset: 'library:missing-library-id',
      ...current,
    })

    expect(result).toMatchObject({ ok: false, code: 'library-material-missing' })
  })

  it('freezes a provided snapshot even when its library reference is still known', () => {
    const current = context()
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'floor',
      ...current,
    }).target
    const result = planZoneFinishApply({
      target,
      materialPreset: WALL_REFS.interior,
      material: {
        preset: 'custom',
        texture: { url: 'https://example.test/frozen-floor.png', repeat: [1, 1] },
      },
      ...current,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.materials).toHaveLength(1)
    expect(result.plan.createNodes[0]?.node).toMatchObject({
      slots: { surface: expect.stringMatching(/^scene:/) },
    })
  })

  it('uses a frozen material snapshot when a library ref is no longer registered', () => {
    const current = context()
    const target = inspectZoneFinishTarget({
      zoneId: 'zone_room',
      kind: 'floor',
      ...current,
    }).target
    const result = planZoneFinishApply({
      target,
      materialPreset: 'library:missing-library-id',
      material: {
        preset: 'custom',
        texture: { url: 'https://example.test/floor.png', repeat: [2, 3] },
      },
      ...current,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.materials).toHaveLength(1)
    expect(result.plan.createNodes[0]?.node).toMatchObject({
      slots: { surface: expect.stringMatching(/^scene:/) },
    })
  })

  it('accepts a manual Zone when every boundary wall face is a whole face', () => {
    const zone = {
      ...makeZone('zone_manual'),
      boundaryWallIds: [],
      autoFromWalls: false,
      polygon: square(),
    } as unknown as AnyNode
    const walls = [
      makeWall('manual_bottom', [0, 0], [3.9, 0]),
      makeWall('manual_right', [4, 0.1], [4, 4]),
      makeWall('manual_top', [4, 4.1], [0, 4.1]),
      makeWall('manual_left', [0, 4], [0, 0.1]),
    ]
    const current: ZoneFinishContext = {
      nodes: Object.fromEntries([zone, ...walls].map((node) => [node.id, node])),
      materials: MATERIALS,
      spaces: {},
    }
    const inspection = inspectZoneFinishTarget({
      zoneId: 'zone_manual',
      kind: 'walls',
      ...current,
    })

    expect(inspection.boundaryError).toBeUndefined()
    expect(inspection.wallFaces.map((face) => face.key)).toEqual([
      'manual_bottom:front',
      'manual_right:front',
      'manual_top:front',
      'manual_left:front',
    ])
  })

  it('uses an inward edge witness for concave whole-face Zones and preserves opposite slots', () => {
    const polygon: Array<[number, number]> = [
      [0, 0],
      [4, 0],
      [4, 1],
      [1, 1],
      [1, 4],
      [0, 4],
    ]
    const zone = {
      ...makeZone('zone_manual_concave', polygon),
      boundaryWallIds: [],
      autoFromWalls: false,
      polygon,
    } as unknown as AnyNode
    const edges: Array<[[number, number], [number, number]]> = [
      [
        [0, 0],
        [4, 0],
      ],
      [
        [4, 0],
        [4, 1],
      ],
      [
        [4, 1],
        [1, 1],
      ],
      [
        [1, 1],
        [1, 4],
      ],
      [
        [1, 4],
        [0, 4],
      ],
      [
        [0, 4],
        [0, 0],
      ],
    ]
    const walls = edges.map(([start, end], index) => makeWall(`concave_wall_${index}`, start, end))
    const current: ZoneFinishContext = {
      nodes: Object.fromEntries([zone, ...walls].map((node) => [node.id, node])),
      materials: MATERIALS,
      spaces: {},
    }
    const inspection = inspectZoneFinishTarget({
      zoneId: 'zone_manual_concave',
      kind: 'walls',
      ...current,
    })

    expect(inspection.boundaryError).toBeUndefined()
    const expectedKeys: ZoneFinishWallKey[] = edges.map(
      (_, index) => `concave_wall_${index}:front` as ZoneFinishWallKey,
    )
    expect(inspection.wallFaces.map((face) => face.key)).toEqual(expectedKeys)
    const result = planZoneFinishApply({
      target: inspection.target,
      material: {
        preset: 'custom',
        texture: { url: 'https://example.test/concave-wall.png', repeat: [1, 1] },
      },
      ...current,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const paintedRef = result.plan.materialRef
    for (const wall of walls) {
      const patch = result.plan.nodePatches.find((entry) => entry.id === wall.id)
      expect(patch?.data).toMatchObject({
        slots: {
          interior: paintedRef,
          lowerInterior: paintedRef,
          upperInterior: paintedRef,
          exterior: WALL_REFS.exterior,
          lowerExterior: WALL_REFS.exterior,
          upperExterior: WALL_REFS.exterior,
        },
      })
    }
  })

  it('accepts straight manual subsegments while leaving the floor target available', () => {
    const zone = {
      ...makeZone('zone_manual_partial'),
      boundaryWallIds: [],
      autoFromWalls: false,
      polygon: square(),
    } as unknown as AnyNode
    const walls = [
      makeWall('partial_bottom', [0, 0], [5, 0]),
      makeWall('partial_right', [4, 0.1], [4, 4]),
      makeWall('partial_top', [4, 4.1], [0, 4.1]),
      makeWall('partial_left', [0, 4], [0, 0.1]),
    ]
    const current: ZoneFinishContext = {
      nodes: Object.fromEntries([zone, ...walls].map((node) => [node.id, node])),
      materials: MATERIALS,
      spaces: {},
    }
    const wallsInspection = inspectZoneFinishTarget({
      zoneId: 'zone_manual_partial',
      kind: 'walls',
      ...current,
    })
    expect(wallsInspection.boundaryError).toBeUndefined()
    const partialFace = wallsInspection.wallFaces.find((face) => face.wallId === 'partial_bottom')
    expect(partialFace).toMatchObject({
      side: 'interior',
      start: 0,
      end: 0.8,
    })
    expect(partialFace?.key).toBe('partial_bottom:0.000000:0.800000:front')

    const floorTarget = inspectZoneFinishTarget({
      zoneId: 'zone_manual_partial',
      kind: 'floor',
      ...current,
    }).target
    const floorPlan = planZoneFinishApply({
      target: floorTarget,
      materialPreset: WALL_REFS.interior,
      ...current,
    })
    expect(floorPlan.ok).toBe(true)
    const wallPlan = planZoneFinishApply({
      target: wallsInspection.target,
      materialPreset: WALL_REFS.interior,
      ...current,
    })
    expect(wallPlan.ok).toBe(true)
    if (!wallPlan.ok) return
    const partialPatch = wallPlan.plan.nodePatches.find(
      (entry) => String(entry.id) === 'partial_bottom',
    )
    expect(partialPatch?.data).toMatchObject({
      finishRegions: [
        {
          side: 'interior',
          start: 0,
          end: 0.8,
          slots: {
            interior: WALL_REFS.interior,
            lowerInterior: WALL_REFS.interior,
            upperInterior: WALL_REFS.interior,
          },
        },
      ],
    })
    expect((partialPatch?.data as { slots?: Record<string, string> }).slots).toBeUndefined()
  })

  it('keeps disjoint manual subsegments on one physical wall face', () => {
    const zone = {
      ...makeZone('zone_manual_claim'),
      boundaryWallIds: [],
      autoFromWalls: false,
      polygon: [
        [0, 0],
        [2, 0],
        [4, 0],
        [4, 4],
        [0, 4],
      ],
    } as unknown as AnyNode
    const walls = [
      makeWall('claimed_bottom', [0, 0], [4, 0]),
      makeWall('claimed_right', [4, 0.1], [4, 4]),
      makeWall('claimed_top', [4, 4.1], [0, 4.1]),
      makeWall('claimed_left', [0, 4], [0, 0.1]),
    ]
    const current: ZoneFinishContext = {
      nodes: Object.fromEntries([zone, ...walls].map((node) => [node.id, node])),
      materials: MATERIALS,
      spaces: {},
    }
    const inspection = inspectZoneFinishTarget({
      zoneId: 'zone_manual_claim',
      kind: 'walls',
      ...current,
    })
    expect(inspection.boundaryError).toBeUndefined()
    const bottomFaces = inspection.wallFaces.filter((face) => face.wallId === 'claimed_bottom')
    expect(bottomFaces).toHaveLength(2)
    expect(bottomFaces[0]?.start).toBeCloseTo(0)
    expect(bottomFaces[0]?.end).toBeCloseTo(0.5)
    expect(bottomFaces[1]?.start).toBeCloseTo(0.5)
    expect(bottomFaces[1]?.end).toBeCloseTo(1)

    const result = planZoneFinishApply({
      target: inspection.target,
      materialPreset: WALL_REFS.exterior,
      ...current,
    })
    expect(result.ok).toBe(true)
  })

  it('blocks canonical curved partial claims before mutation, including modest curves', () => {
    for (const curveOffset of [0.01, 0.1]) {
      const zone = {
        ...makeZone(`zone_curved_${curveOffset}`, square(0, 0, 1)),
        parentId: null,
        boundaryWallIds: [],
        autoFromWalls: false,
        polygon: square(0, 0, 1),
      } as unknown as AnyNode
      const walls = [
        {
          ...makeWall(`curved_bottom_${curveOffset}`, [0, 0], [1, 0]),
          curveOffset,
          parentId: null,
        },
        { ...makeWall(`curved_right_${curveOffset}`, [1, 0], [1, 1]), parentId: null },
        { ...makeWall(`curved_top_${curveOffset}`, [1, 1], [0, 1]), parentId: null },
        { ...makeWall(`curved_left_${curveOffset}`, [0, 1], [0, 0]), parentId: null },
      ]
      const current: ZoneFinishContext = {
        nodes: Object.fromEntries([zone, ...walls].map((node) => [node.id, node])),
        materials: MATERIALS,
        spaces: {},
      }
      const inspection = inspectZoneFinishTarget({
        zoneId: zone.id,
        kind: 'walls',
        ...current,
      })
      expect(inspection.boundaryError).toMatchObject({
        code: 'curved-wall-partial-finish-unsupported',
        conflictIds: expect.arrayContaining([`curved_bottom_${curveOffset}`]),
      })
      const before = JSON.stringify(current.nodes)
      const result = planZoneFinishApply({
        target: inspection.target,
        materialPreset: WALL_REFS.interior,
        ...current,
      })
      expect(result).toMatchObject({
        ok: false,
        code: 'curved-wall-partial-finish-unsupported',
      })
      expect(JSON.stringify(current.nodes)).toBe(before)
    }
  })

  it('fails closed for a partial curved auto boundary but accepts authored endpoints', () => {
    const zone = {
      ...makeZone('zone_curved_auto'),
      parentId: null,
    } as unknown as AnyNode
    const curvedBottom = {
      ...makeWall('wall_bottom', [0, 0], [4, 0]),
      curveOffset: 0.1,
      parentId: null,
    } as WallNode
    const walls = [
      curvedBottom,
      { ...makeWall('wall_right', [4, 0], [4, 4]), parentId: null },
      { ...makeWall('wall_top', [4, 4], [0, 4]), parentId: null },
      { ...makeWall('wall_left', [0, 4], [0, 0]), parentId: null },
    ]
    const baseSpace = { ...makeSpace('space_curved_auto'), levelId: null } as unknown as Space
    const partialSpace = {
      ...baseSpace,
      boundaryFaces: baseSpace.boundaryFaces.map((boundary) =>
        boundary.wallId === curvedBottom.id
          ? {
              ...boundary,
              points: [
                [0.5, 0],
                [4, 0],
              ] as Array<[number, number]>,
            }
          : boundary,
      ),
    }
    const partialContext: ZoneFinishContext = {
      nodes: Object.fromEntries([zone, ...walls].map((node) => [node.id, node])),
      materials: MATERIALS,
      spaces: { [partialSpace.id]: partialSpace },
    }
    const partial = inspectZoneFinishTarget({
      zoneId: zone.id,
      kind: 'walls',
      ...partialContext,
    })
    expect(partial).toMatchObject({
      boundaryError: {
        code: 'curved-wall-partial-finish-unsupported',
        conflictIds: expect.arrayContaining([curvedBottom.id]),
      },
      wallFaces: [],
    })
    const before = JSON.stringify(partialContext.nodes)
    const blocked = planZoneFinishApply({
      target: partial.target,
      materialPreset: WALL_REFS.interior,
      ...partialContext,
    })
    expect(blocked).toMatchObject({ ok: false, code: 'curved-wall-partial-finish-unsupported' })
    expect(JSON.stringify(partialContext.nodes)).toBe(before)

    const fullSpace = {
      ...baseSpace,
      boundaryFaces: baseSpace.boundaryFaces.map((boundary) =>
        boundary.wallId === curvedBottom.id
          ? {
              ...boundary,
              points: [
                [0, 0],
                [4, 0],
              ] as Array<[number, number]>,
            }
          : boundary,
      ),
    }
    const full = inspectZoneFinishTarget({
      zoneId: zone.id,
      kind: 'walls',
      nodes: partialContext.nodes,
      materials: partialContext.materials,
      spaces: { [fullSpace.id]: fullSpace },
    })
    expect(full.boundaryError).toBeUndefined()
    expect(full.wallFaces.find((face) => face.wallId === curvedBottom.id)).toMatchObject({
      start: 0,
      end: 1,
      key: 'wall_bottom:front',
    })
  })

  it('coalesces touching auto boundary segments on one wall face', () => {
    const zone = ZoneNode.parse({
      ...makeZone('zone_auto_coalesce'),
      parentId: DETACHED_LEVEL_ID,
    })
    const walls = [
      { ...makeWall('wall_bottom', [0, 0], [4, 0]), parentId: DETACHED_LEVEL_ID },
      { ...makeWall('wall_right', [4, 0], [4, 4]), parentId: DETACHED_LEVEL_ID },
      { ...makeWall('wall_top', [4, 4], [0, 4]), parentId: DETACHED_LEVEL_ID },
      { ...makeWall('wall_left', [0, 4], [0, 0]), parentId: DETACHED_LEVEL_ID },
    ]
    const baseSpace: Space = { ...makeSpace('space_auto_coalesce'), levelId: DETACHED_LEVEL_ID }
    const splitSpace: Space = {
      ...baseSpace,
      boundaryFaces: [
        {
          wallId: 'wall_bottom',
          face: 'front' as const,
          points: [
            [0, 0],
            [2, 0],
          ] as Array<[number, number]>,
        },
        {
          wallId: 'wall_bottom',
          face: 'front' as const,
          points: [
            [2, 0],
            [4, 0],
          ] as Array<[number, number]>,
        },
        ...baseSpace.boundaryFaces.slice(1),
      ],
    }
    const current: ZoneFinishContext = {
      nodes: Object.fromEntries([zone, ...walls].map((node) => [node.id, node])),
      materials: MATERIALS,
      spaces: { [splitSpace.id]: splitSpace },
    }
    const inspection = inspectZoneFinishTarget({
      zoneId: zone.id,
      kind: 'walls',
      ...current,
    })
    const bottomFaces = inspection.wallFaces.filter((face) => face.wallId === 'wall_bottom')
    expect(bottomFaces).toHaveLength(1)
    expect(bottomFaces[0]).toMatchObject({
      key: 'wall_bottom:front',
      start: 0,
      end: 1,
      length: 4,
    })
    expect(inspection.wallFaces).toHaveLength(4)
  })

  it('reuses a stable partial finish-region identity and rejects a foreign overlap before mutation', () => {
    const zone = {
      ...makeZone('zone_region_identity'),
      boundaryWallIds: [],
      autoFromWalls: false,
      polygon: square(),
    } as unknown as AnyNode
    const baseWalls = [
      makeWall('region_bottom', [0, 0], [5, 0]),
      makeWall('region_right', [4, 0.1], [4, 4]),
      makeWall('region_top', [4, 4.1], [0, 4.1]),
      makeWall('region_left', [0, 4], [0, 0.1]),
    ]
    const base: ZoneFinishContext = {
      nodes: Object.fromEntries([zone, ...baseWalls].map((node) => [node.id, node])),
      materials: MATERIALS,
      spaces: {},
    }
    const firstInspection = inspectZoneFinishTarget({
      zoneId: zone.id,
      kind: 'wall',
      wallKey: 'region_bottom:front',
      ...base,
    })
    const target = inspectZoneFinishTarget({
      zoneId: zone.id,
      kind: 'wall',
      wallKey: firstInspection.wallFaces.find((face) => face.wallId === 'region_bottom')?.key,
      ...base,
    }).target
    const first = planZoneFinishApply({
      target,
      materialPreset: WALL_REFS.interior,
      ...base,
    })
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const firstPatch = first.plan.nodePatches.find((entry) => String(entry.id) === 'region_bottom')
    const firstRegions = (firstPatch?.data as { finishRegions?: unknown } | undefined)
      ?.finishRegions
    expect(firstRegions).toHaveLength(1)
    const firstId = (firstRegions as Array<{ id: string }>)[0]?.id
    expect(firstId).toBeString()
    if (!firstId) return
    expect(firstId).toBe('zone-finish:zone_region_identity:region_bottom:front:0.000000:0.800000')

    const paintedWall = {
      ...(base.nodes.region_bottom as WallNode),
      finishRegions: firstRegions,
    } as WallNode
    const reapplied = planZoneFinishApply({
      target: inspectZoneFinishTarget({
        zoneId: zone.id,
        kind: 'wall',
        wallKey: firstInspection.wallFaces.find((face) => face.wallId === 'region_bottom')?.key,
        nodes: { ...base.nodes, region_bottom: paintedWall },
        materials: base.materials,
        spaces: base.spaces,
      }).target,
      materialPreset: WALL_REFS.interior,
      nodes: { ...base.nodes, region_bottom: paintedWall },
      materials: base.materials,
      spaces: base.spaces,
    })
    expect(reapplied.ok).toBe(true)
    if (!reapplied.ok) return
    const reappliedRegions = (
      reapplied.plan.nodePatches.find((entry) => String(entry.id) === 'region_bottom')?.data as {
        finishRegions?: Array<{ id: string }>
      }
    )?.finishRegions
    expect(reappliedRegions?.map((region) => region.id)).toEqual([firstId])

    const foreignWall = {
      ...(base.nodes.region_bottom as WallNode),
      finishRegions: [
        {
          id: 'zone-finish:other-zone:region_bottom:front:0.100000:0.700000',
          side: 'interior' as const,
          start: 0.1,
          end: 0.7,
          slots: { interior: WALL_REFS.exterior },
        },
      ],
    } as WallNode
    const blocked = planZoneFinishApply({
      target: inspectZoneFinishTarget({
        zoneId: zone.id,
        kind: 'wall',
        wallKey: firstInspection.wallFaces.find((face) => face.wallId === 'region_bottom')?.key,
        nodes: { ...base.nodes, region_bottom: foreignWall },
        materials: base.materials,
        spaces: base.spaces,
      }).target,
      materialPreset: WALL_REFS.interior,
      nodes: { ...base.nodes, region_bottom: foreignWall },
      materials: base.materials,
      spaces: base.spaces,
    })
    expect(blocked).toMatchObject({
      ok: false,
      code: 'finish-region-conflict',
      conflictIds: expect.arrayContaining([
        'zone-finish:other-zone:region_bottom:front:0.100000:0.700000',
      ]),
    })
    expect(foreignWall.finishRegions).toHaveLength(1)
  })
})

describe('zone finish templates', () => {
  function completedContext(): ZoneFinishContext {
    const base = context()
    const floor = makeSlab('slab_floor', square(), { slots: { surface: WALL_REFS.interior } })
    return {
      ...base,
      nodes: { ...base.nodes, slab_floor: floor },
      sceneId: 'scene_test',
    }
  }

  function completedContextWithCeiling(): ZoneFinishContext {
    const base = completedContext()
    const ceiling = makeCeiling('ceiling_finish', square(), {
      height: 2.35,
      slots: { surface: WALL_REFS.interior },
    })
    return { ...base, nodes: { ...base.nodes, [ceiling.id]: ceiling } }
  }

  function manualHomeContext(secondPolygon: Array<[number, number]>): ZoneFinishContext {
    const base = context()
    const walls = ['bottom', 'right', 'top', 'left'].map((side) => ({
      ...(base.nodes[`wall_${side}`] as WallNode),
      parentId: null,
    })) as WallNode[]
    const firstZone = {
      ...makeZone('home_manual_a'),
      parentId: null,
      boundaryWallIds: [],
      autoFromWalls: false,
    } as unknown as AnyNode
    const secondZone = {
      ...makeZone('home_manual_b', secondPolygon),
      parentId: null,
      boundaryWallIds: [],
      autoFromWalls: false,
    } as unknown as AnyNode
    const floors = [
      makeSlab('home_floor_a', square(), {
        parentId: null,
        metadata: { zoneFinish: { version: 1, zoneId: firstZone.id } },
      }),
      makeSlab('home_floor_b', square(), {
        parentId: null,
        metadata: { zoneFinish: { version: 1, zoneId: secondZone.id } },
      }),
    ]
    return {
      nodes: Object.fromEntries(
        [firstZone, secondZone, ...walls, ...floors].map((node) => [node.id, node]),
      ),
      materials: base.materials,
      spaces: {},
    }
  }

  function oppositeSideHomeContext(): ZoneFinishContext {
    const abovePolygon: Array<[number, number]> = [
      [0, 0],
      [4, 0],
      [4, 2],
      [0, 2],
    ]
    const belowPolygon: Array<[number, number]> = [
      [0, 0],
      [0, -2],
      [4, -2],
      [4, 0],
    ]
    const aboveZone = {
      ...makeZone('home_opposite_above', abovePolygon),
      parentId: null,
      boundaryWallIds: [],
      autoFromWalls: false,
    } as unknown as AnyNode
    const belowZone = {
      ...makeZone('home_opposite_below', belowPolygon),
      parentId: null,
      boundaryWallIds: [],
      autoFromWalls: false,
    } as unknown as AnyNode
    const walls = [
      { ...makeWall('shared_wall', [0, 0], [4, 0]), parentId: null },
      { ...makeWall('above_right', [4, 0], [4, 2]), parentId: null },
      { ...makeWall('above_top', [4, 2], [0, 2]), parentId: null },
      { ...makeWall('above_left', [0, 2], [0, 0]), parentId: null },
      { ...makeWall('below_left', [0, 0], [0, -2]), parentId: null },
      { ...makeWall('below_bottom', [0, -2], [4, -2]), parentId: null },
      { ...makeWall('below_right', [4, -2], [4, 0]), parentId: null },
    ] as WallNode[]
    const floors = [
      makeSlab('home_opposite_floor_above', abovePolygon, {
        parentId: null,
        metadata: { zoneFinish: { version: 1, zoneId: aboveZone.id } },
      }),
      makeSlab('home_opposite_floor_below', belowPolygon, {
        parentId: null,
        metadata: { zoneFinish: { version: 1, zoneId: belowZone.id } },
      }),
    ]
    return {
      nodes: Object.fromEntries(
        [aboveZone, belowZone, ...walls, ...floors].map((node) => [node.id, node]),
      ),
      materials: MATERIALS,
      spaces: {},
    }
  }

  function twoZoneHomeTemplate(template: ZoneFinishTemplateSnapshot) {
    return createHomeFinishTemplate({
      name: 'Two manual Zones',
      templates: [
        { sourceZoneId: 'source_a', sourceZoneName: 'A', template },
        { sourceZoneId: 'source_b', sourceZoneName: 'B', template },
      ],
    })
  }

  function sourceTemplate(): ZoneFinishTemplateSnapshot | null {
    const captured = captureZoneFinishTemplate({
      zoneId: 'zone_room',
      name: 'Source',
      ...completedContext(),
    })
    return 'ok' in captured ? null : captured
  }

  function sourceTemplateWithCeiling(): ZoneFinishTemplateSnapshot | null {
    const captured = captureZoneFinishTemplate({
      zoneId: 'zone_room',
      name: 'Source with ceiling',
      ...completedContextWithCeiling(),
    })
    return 'ok' in captured ? null : captured
  }

  it('captures and restores a mixed wall template by exact fingerprint', () => {
    const current = completedContext()
    const template = captureZoneFinishTemplate({
      zoneId: 'zone_room',
      name: 'Room finish',
      ...current,
    })
    expect('ok' in template && template.ok === false).toBe(false)
    if ('ok' in template) return

    const changedNodes = { ...current.nodes }
    const wall = changedNodes.wall_right as WallNode
    changedNodes.wall_right = {
      ...wall,
      slots: {
        ...wall.slots,
        interior: WALL_REFS.exterior,
        lowerInterior: WALL_REFS.exterior,
        upperInterior: WALL_REFS.exterior,
      },
    } as WallNode
    const result = applyMaterialToCapturedZoneTarget({
      target: inspectZoneFinishTarget({
        zoneId: 'zone_room',
        kind: 'wall',
        wallKey: 'wall_right:front',
        ...{ ...current, nodes: changedNodes },
      }).target,
      materialPreset: WALL_REFS.interior,
      ...{ ...current, nodes: changedNodes },
    })
    expect(result.ok).toBe(true)

    const restored = applyHomeFinishTemplate({
      template: {
        version: 1,
        id: 'home-template_test',
        name: 'Home',
        createdAt: new Date().toISOString(),
        sourceSceneId: current.sceneId,
        zones: [
          {
            sourceZoneId: 'zone_room',
            sourceZoneName: 'Room',
            template: template as ZoneFinishTemplateSnapshot,
          },
        ],
      },
      zoneMapping: { zone_room: 'zone_room' },
      ...current,
    })
    expect(restored.ok).toBe(true)
  })

  it('requires a matching scene identity before using an exact Zone template', () => {
    const source = completedContext()
    const captured = captureZoneFinishTemplate({
      zoneId: 'zone_room',
      name: 'Scene-bound finish',
      ...source,
    })
    expect('ok' in captured && captured.ok === false).toBe(false)
    if ('ok' in captured) return

    const cloned = { ...source, sceneId: 'scene_clone' }
    const differentScene = applyZoneFinishTemplate({
      template: captured,
      targetZoneId: 'zone_room',
      nodes: cloned.nodes,
      materials: cloned.materials,
      spaces: cloned.spaces,
      sceneId: cloned.sceneId,
    })
    expect(differentScene).toMatchObject({ ok: false, code: 'mapping-required' })

    const sameScene = applyZoneFinishTemplate({
      template: captured,
      targetZoneId: 'zone_room',
      nodes: source.nodes,
      materials: source.materials,
      spaces: source.spaces,
      sceneId: source.sceneId,
    })
    expect(sameScene.ok).toBe(true)
  })

  it('requires a matching Home source scene before child templates may use exact faces', () => {
    const source = sourceTemplate()
    if (!source) return
    const child = {
      ...source,
      source: { ...source.source, sceneId: 'scene_clone' },
    }
    const mismatchedHome = createHomeFinishTemplate({
      name: 'Mismatched source scene',
      sourceSceneId: 'scene_source',
      templates: [{ sourceZoneId: 'zone_room', sourceZoneName: 'Room', template: child }],
    })
    expect('ok' in mismatchedHome && mismatchedHome.ok === false).toBe(false)
    if ('ok' in mismatchedHome) return

    const target = { ...completedContext(), sceneId: 'scene_clone' }
    const blocked = applyHomeFinishTemplate({
      template: mismatchedHome,
      zoneMapping: { zone_room: 'zone_room' },
      nodes: target.nodes,
      materials: target.materials,
      spaces: target.spaces,
      sceneId: target.sceneId,
    })
    expect(blocked).toMatchObject({ ok: false, code: 'mapping-required' })

    const matchingHome = createHomeFinishTemplate({
      name: 'Matching source scene',
      sourceSceneId: 'scene_clone',
      templates: [{ sourceZoneId: 'zone_room', sourceZoneName: 'Room', template: child }],
    })
    expect('ok' in matchingHome && matchingHome.ok === false).toBe(false)
    if ('ok' in matchingHome) return
    const restored = applyHomeFinishTemplate({
      template: matchingHome,
      zoneMapping: { zone_room: 'zone_room' },
      nodes: target.nodes,
      materials: target.materials,
      spaces: target.spaces,
      sceneId: target.sceneId,
    })
    expect(restored.ok).toBe(true)
  })

  it('captures an explicit ceiling snapshot and reapplies only its surface slot', () => {
    const current = completedContextWithCeiling()
    const captured = captureZoneFinishTemplate({
      zoneId: 'zone_room',
      name: 'Room finish with ceiling',
      ...current,
    })
    expect('ok' in captured && captured.ok === false).toBe(false)
    if ('ok' in captured) return
    expect(captured.ceiling).toMatchObject({ preferredRef: WALL_REFS.interior })
    expect(captured.source.fingerprint.ceiling).toMatchObject({
      ceilingId: 'ceiling_finish',
    })

    const changedCeiling = {
      ...(current.nodes.ceiling_finish as CeilingNode),
      height: 2.45,
      slots: { surface: WALL_REFS.exterior },
    }
    const result = applyZoneFinishTemplate({
      template: captured,
      targetZoneId: 'zone_room',
      nodes: { ...current.nodes, ceiling_finish: changedCeiling },
      materials: current.materials,
      spaces: current.spaces,
      sceneId: current.sceneId,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const patch = result.plan.nodePatches.find((entry) => entry.id === 'ceiling_finish')
    expect(patch?.data).toEqual({ slots: { surface: result.plan.materialRef } })
    expect(result.plan.nodePatches).toHaveLength(6)
  })

  it('omits an absent ceiling snapshot and preserves an existing target ceiling', () => {
    const source = completedContext()
    const captured = captureZoneFinishTemplate({
      zoneId: 'zone_room',
      name: 'Room finish without ceiling',
      ...source,
    })
    expect('ok' in captured && captured.ok === false).toBe(false)
    if ('ok' in captured) return
    expect(captured.ceiling).toBeUndefined()
    const target = completedContextWithCeiling()
    const result = applyZoneFinishTemplate({
      template: captured,
      targetZoneId: 'zone_room',
      nodes: target.nodes,
      materials: target.materials,
      spaces: target.spaces,
      sceneId: target.sceneId,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.nodePatches.some((entry) => entry.id === 'ceiling_finish')).toBe(false)
    expect(result.plan.nodePatches).toHaveLength(5)
  })

  it('rejects two manual Zones that claim the same physical wall face', () => {
    const template = sourceTemplate()
    if (!template) return
    const home = twoZoneHomeTemplate(template)
    expect('ok' in home && home.ok === false).toBe(false)
    if ('ok' in home) return
    const current = manualHomeContext(square())
    const wallMaterial = template.walls[0]!.slots[0]!.material
    const result = applyHomeFinishTemplate({
      template: home,
      zoneMapping: { source_a: 'home_manual_a', source_b: 'home_manual_b' },
      uniformWallMaterials: { source_a: wallMaterial, source_b: wallMaterial },
      ...current,
    })

    expect(result).toMatchObject({ ok: false, code: 'slot-collision' })
    if (result.ok) return
    expect(result.conflictIds).toContain('wall_bottom:interior')
  })

  it('does not treat reversed polygon winding as an opposite wall face', () => {
    const template = sourceTemplate()
    if (!template) return
    const home = twoZoneHomeTemplate(template)
    expect('ok' in home && home.ok === false).toBe(false)
    if ('ok' in home) return
    const current = manualHomeContext([...square()].reverse())
    const wallMaterial = template.walls[0]!.slots[0]!.material
    const result = applyHomeFinishTemplate({
      template: home,
      zoneMapping: { source_a: 'home_manual_a', source_b: 'home_manual_b' },
      uniformWallMaterials: { source_a: wallMaterial, source_b: wallMaterial },
      ...current,
    })

    expect(result).toMatchObject({
      ok: false,
      code: 'slot-collision',
      conflictIds: expect.arrayContaining(['home_manual_a', 'home_manual_b']),
    })
  })

  it('allows opposite semantic faces of a shared wall in a home apply', () => {
    const template = sourceTemplate()
    if (!template) return
    const home = twoZoneHomeTemplate(template)
    expect('ok' in home && home.ok === false).toBe(false)
    if ('ok' in home) return
    const current = oppositeSideHomeContext()
    const wallMaterial = template.walls[0]!.slots[0]!.material
    const result = applyHomeFinishTemplate({
      template: home,
      zoneMapping: {
        source_a: 'home_opposite_above',
        source_b: 'home_opposite_below',
      },
      uniformWallMaterials: { source_a: wallMaterial, source_b: wallMaterial },
      ...current,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const sharedPatch = result.plan.nodePatches.find((entry) => String(entry.id) === 'shared_wall')
    expect(sharedPatch?.data).toMatchObject({
      slots: {
        interior: expect.any(String),
        exterior: expect.any(String),
      },
    })
  })

  it('commits a home template with a created Ceiling in one undo step', () => {
    const template = sourceTemplateWithCeiling()
    if (!template) return
    const home = createHomeFinishTemplate({
      name: 'One room with ceiling',
      templates: [{ sourceZoneId: 'source_a', sourceZoneName: 'A', template }],
    })
    expect('ok' in home && home.ok === false).toBe(false)
    if ('ok' in home) return

    const current = completedContext()
    const targetNodes = { ...current.nodes }
    delete targetNodes.slab_floor
    const level = LevelNode.parse({ id: LEVEL_ID, level: 0 })
    targetNodes[LEVEL_ID] = level
    const planned = applyHomeFinishTemplate({
      template: home,
      zoneMapping: { source_a: 'zone_room' },
      uniformWallMaterials: { source_a: template.walls[0]!.slots[0]!.material },
      nodes: targetNodes,
      materials: current.materials,
      spaces: current.spaces,
    })
    expect(planned.ok).toBe(true)
    if (!planned.ok) return
    expect(planned.plan.createNodes.map((entry) => entry.node.type)).toEqual(['slab', 'ceiling'])

    const saved = useScene.getState()
    try {
      useScene.setState({
        nodes: targetNodes,
        rootNodeIds: [LEVEL_ID],
        collections: {},
        materials: current.materials,
        dirtyNodes: new Set(),
        readOnly: false,
      } as never)
      useScene.temporal.getState().clear()
      const committed = commitZoneFinishApply(planned.plan)
      expect(committed.ok).toBe(true)
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      expect(Object.values(useScene.getState().nodes).some((node) => node.type === 'ceiling')).toBe(
        true,
      )
      useScene.temporal.getState().undo()
      expect(Object.values(useScene.getState().nodes).some((node) => node.type === 'ceiling')).toBe(
        false,
      )
    } finally {
      useScene.setState({
        nodes: saved.nodes,
        rootNodeIds: saved.rootNodeIds,
        collections: saved.collections,
        materials: saved.materials,
        dirtyNodes: saved.dirtyNodes,
        readOnly: saved.readOnly,
      } as never)
      useScene.temporal.getState().clear()
    }
  })

  it('allows same-footprint home floors on different levels', () => {
    const first = completedContext()
    const secondZone = {
      ...(first.nodes.zone_room as AnyNode),
      id: 'zone_room_second',
      parentId: 'level_second',
    } as AnyNode
    const secondWalls = ['bottom', 'right', 'top', 'left'].map((side) => {
      const wall = first.nodes[`wall_${side}`] as WallNode
      return { ...wall, id: `wall_second_${side}`, parentId: 'level_second' } as WallNode
    })
    const secondSpace = {
      ...makeSpace('space_second'),
      id: 'space_second',
      levelId: 'level_second',
      wallIds: secondWalls.map((wall) => wall.id),
      boundaryFaces: secondWalls.map((wall, index) => {
        const points = makeSpace().boundaryFaces[index]!.points
        return { ...makeSpace().boundaryFaces[index]!, wallId: wall.id, points }
      }),
    } as Space
    const secondFloor = {
      ...makeSlab('slab_floor_second', square()),
      parentId: 'level_second',
    } as SlabNode
    const completed = {
      ...first,
      nodes: {
        ...first.nodes,
        [secondZone.id]: secondZone,
        ...Object.fromEntries(secondWalls.map((wall) => [wall.id, wall])),
        [secondFloor.id]: secondFloor,
      },
      spaces: { ...first.spaces, [secondSpace.id]: secondSpace },
    }
    const firstTemplate = captureZoneFinishTemplate({
      zoneId: 'zone_room',
      name: 'First room',
      ...completed,
    })
    const secondTemplate = captureZoneFinishTemplate({
      zoneId: 'zone_room_second',
      name: 'Second room',
      ...completed,
    })
    expect('ok' in firstTemplate && firstTemplate.ok === false).toBe(false)
    expect('ok' in secondTemplate && secondTemplate.ok === false).toBe(false)
    if ('ok' in firstTemplate || 'ok' in secondTemplate) return

    const home = createHomeFinishTemplate({
      name: 'Two levels',
      templates: [
        { sourceZoneId: 'zone_room', sourceZoneName: 'First', template: firstTemplate },
        {
          sourceZoneId: 'zone_room_second',
          sourceZoneName: 'Second',
          template: secondTemplate,
        },
      ],
    })
    expect('ok' in home && home.ok === false).toBe(false)
    if ('ok' in home) return

    const targetNodes = { ...completed.nodes }
    delete targetNodes.slab_floor
    delete targetNodes.slab_floor_second
    const result = applyHomeFinishTemplate({
      template: home,
      zoneMapping: {
        zone_room: 'zone_room',
        zone_room_second: 'zone_room_second',
      },
      uniformWallMaterials: {
        zone_room: firstTemplate.floor,
        zone_room_second: secondTemplate.floor,
      },
      nodes: targetNodes,
      materials: completed.materials,
      spaces: completed.spaces,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.createNodes.map((entry) => (entry.node as SlabNode).parentId)).toEqual([
      LEVEL_ID,
      'level_second',
    ])
  })

  it('maps a mixed template across a changed Zone one-to-one', () => {
    const source = completedContext()
    const targetZone = {
      ...(source.nodes.zone_room as AnyNode),
      id: 'zone_cross_target',
      parentId: 'level_cross',
      boundaryWallIds: ['cross_bottom', 'cross_right', 'cross_top', 'cross_left'],
    } as unknown as AnyNode
    const sourceNodes = source.nodes as Record<string, AnyNode>
    const targetWalls = ['bottom', 'right', 'top', 'left'].map((side) => {
      const wall = sourceNodes[`wall_${side}`] as WallNode
      return {
        ...wall,
        id: `cross_${side}`,
        parentId: 'level_cross',
      } as unknown as WallNode
    })
    const targetFloor = {
      ...source.nodes.slab_floor,
      id: 'slab_cross_target',
      parentId: 'level_cross',
    } as SlabNode
    const targetSpace = {
      ...makeSpace('space_cross_target'),
      id: 'space_cross_target',
      levelId: 'level_cross',
      wallIds: targetWalls.map((wall) => wall.id),
      boundaryFaces: targetWalls.map((wall, index) => ({
        ...makeSpace().boundaryFaces[index]!,
        wallId: wall.id,
      })),
    } as Space
    const current: ZoneFinishContext = {
      ...source,
      nodes: {
        ...source.nodes,
        [targetZone.id]: targetZone,
        ...Object.fromEntries(targetWalls.map((wall) => [wall.id, wall])),
        [targetFloor.id]: targetFloor,
      },
      spaces: { ...source.spaces, [targetSpace.id]: targetSpace },
    }
    const template = captureZoneFinishTemplate({
      zoneId: 'zone_room',
      name: 'Source finish',
      ...source,
    })
    expect('ok' in template && template.ok === false).toBe(false)
    if ('ok' in template) return
    const result = applyZoneFinishTemplate({
      template,
      targetZoneId: 'zone_cross_target',
      wallMapping: {
        'wall_bottom:front': 'cross_bottom:front',
        'wall_right:front': 'cross_right:front',
        'wall_top:front': 'cross_top:front',
        'wall_left:front': 'cross_left:front',
      },
      nodes: current.nodes,
      materials: current.materials,
      spaces: current.spaces,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.nodePatches).toHaveLength(5)
    expect(result.plan.createNodes).toHaveLength(0)
  })

  it('maps a partial template by its interval key', () => {
    const source = completedContext()
    const sourceZone = source.nodes.zone_room as AnyNode
    const targetZone = ZoneNode.parse({
      ...sourceZone,
      id: 'zone_partial_target',
      parentId: 'level_cross',
      boundaryWallIds: [
        'wall_partial_cross_bottom',
        'wall_cross_right',
        'wall_cross_top',
        'wall_cross_left',
      ],
    })
    const sourceBottom = source.nodes.wall_bottom as WallNode
    const targetBottom = WallSchema.parse({
      ...sourceBottom,
      id: 'wall_partial_cross_bottom',
      parentId: 'level_cross',
      end: [5, 0],
    })
    const targetWalls = ['right', 'top', 'left'].map((side) =>
      WallSchema.parse({
        ...(source.nodes[`wall_${side}`] as WallNode),
        id: `wall_cross_${side}`,
        parentId: 'level_cross',
      }),
    )
    const targetSpace = {
      ...makeSpace('space_partial_target'),
      id: 'space_partial_target',
      levelId: 'level_cross',
      wallIds: [targetBottom, ...targetWalls].map((wall) => wall.id),
      boundaryFaces: [targetBottom, ...targetWalls].map((wall, index) => ({
        ...makeSpace().boundaryFaces[index]!,
        wallId: wall.id,
      })),
    } as Space
    const current: ZoneFinishContext = {
      ...source,
      nodes: {
        ...source.nodes,
        [targetZone.id]: targetZone,
        [targetBottom.id]: targetBottom,
        ...Object.fromEntries(targetWalls.map((wall) => [wall.id, wall])),
      },
      spaces: { ...source.spaces, [targetSpace.id]: targetSpace },
    }
    const partialTemplate = captureZoneFinishTemplate({
      zoneId: 'zone_room',
      name: 'Partial source',
      ...source,
    })
    expect('ok' in partialTemplate).toBe(false)
    if ('ok' in partialTemplate) return
    const template: ZoneFinishTemplateSnapshot = {
      ...partialTemplate,
      walls: partialTemplate.walls.map((wall) =>
        wall.sourceFace.wallId === 'wall_bottom'
          ? {
              ...wall,
              sourceFace: {
                ...wall.sourceFace,
                start: 0,
                end: 0.8,
                key: 'wall_bottom:0.000000:0.800000:front',
              },
            }
          : wall,
      ),
      source: {
        ...partialTemplate.source,
        fingerprint: {
          ...partialTemplate.source.fingerprint,
          inwardWalls: partialTemplate.source.fingerprint.inwardWalls.map((wall) =>
            wall.wallId === 'wall_bottom'
              ? { ...wall, start: 0, end: 0.8, key: 'wall_bottom:0.000000:0.800000:front' }
              : wall,
          ),
        },
      },
    }
    const result = applyZoneFinishTemplate({
      template,
      targetZoneId: 'zone_partial_target',
      wallMapping: {
        'wall_bottom:0.000000:0.800000:front': 'wall_partial_cross_bottom:0.000000:0.800000:front',
        'wall_right:front': 'wall_cross_right:front',
        'wall_top:front': 'wall_cross_top:front',
        'wall_left:front': 'wall_cross_left:front',
      },
      nodes: current.nodes,
      materials: current.materials,
      spaces: current.spaces,
    })
    expect(result.ok).toBe(true)
  })

  it('rejects a template capture when the Zone has no resolved wall boundary', () => {
    const current = completedContext()
    const result = captureZoneFinishTemplate({
      zoneId: 'zone_room',
      name: 'Open room',
      nodes: {
        zone_room: current.nodes.zone_room!,
        slab_floor: current.nodes.slab_floor!,
      },
      materials: current.materials,
      spaces: {},
    })
    expect(result).toMatchObject({ ok: false, code: 'wall-boundary-missing' })
  })
})

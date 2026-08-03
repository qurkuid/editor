import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  type GeometryContext,
  LevelNode,
  type SceneApi,
  WallNode,
} from '@pascal-app/core'
import { loadPlugin, nodeRegistry } from '../../../../core/src/registry'
import { createSceneApi } from '../../../../core/src/registry/scene-api'
import useScene from '../../../../core/src/store/use-scene'
import { builtinPlugin } from '../../index'
import { getRunSpanEnds, getRunSpans } from '../run-layout'
import {
  addIslandBackRun,
  addWallSetRun,
  findSetLinkWallRuns,
  syncSetLinkWallRun,
  wallBottomHeightForSetLink,
  wallBottomHeightForTallAlignment,
} from '../run-ops'
import { CabinetModuleNode, CabinetNode } from '../schema'
import { resolveCabinetModuleWallSnapLocal, resolveCabinetRunWallSnap } from '../wall-snap'

type RafFn = (cb: (t: number) => void) => number
;(globalThis as unknown as { requestAnimationFrame?: RafFn }).requestAnimationFrame ??= ((
  cb: (t: number) => void,
) => {
  cb(0)
  return 0
}) as RafFn
;(globalThis as unknown as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame ??=
  () => {}

// Lightweight in-memory SceneApi — same shape as run-ops.test.ts — for
// exercising the pure creation/sync logic without the full store + registry.
function sceneApiFixture(seed: AnyNode[]): SceneApi {
  const nodes = Object.fromEntries(seed.map((node) => [node.id, node])) as Record<
    AnyNodeId,
    AnyNode
  >

  return {
    get: (id) => nodes[id],
    nodes: () => nodes,
    update: (id, patch) => {
      const current = nodes[id]
      if (!current) return
      nodes[id] = { ...current, ...patch } as AnyNode
    },
    upsert: (node, parentId) => {
      nodes[node.id as AnyNodeId] = node
      if (parentId) {
        const parent = nodes[parentId]
        if (parent && Array.isArray((parent as { children?: unknown }).children)) {
          const children = new Set(((parent as { children?: AnyNodeId[] }).children ?? []).slice())
          children.add(node.id as AnyNodeId)
          nodes[parentId] = { ...parent, children: [...children] } as AnyNode
        }
      }
      return node.id as AnyNodeId
    },
    delete: (id) => {
      delete nodes[id]
    },
    restore: () => {},
    restoreAll: () => {},
    markDirty: () => {},
    pauseHistory: () => {},
    resumeHistory: () => {},
    getSubtree: () => null,
    cloneNodesInto: () => null,
  }
}

function seedStraightRun(prefix: string) {
  const levelId = `level_${prefix}` as AnyNodeId
  const runId = `cabinet_${prefix}` as AnyNodeId
  const moduleId = `cabinet-module_${prefix}` as AnyNodeId
  const run = CabinetNode.parse({
    id: runId,
    parentId: levelId,
    position: [0, 0, 0],
    rotation: 0,
    depth: 0.6,
    showPlinth: true,
    withCountertop: true,
    children: [moduleId],
  })
  const module = CabinetModuleNode.parse({
    id: moduleId,
    parentId: runId,
    position: [0, run.plinthHeight, 0],
    width: 0.9,
    depth: run.depth,
    carcassHeight: run.carcassHeight,
  })
  return { levelId, runId, moduleId, run, module }
}

describe('CabinetNode islandLink / setLink schema', () => {
  test('islandLink round-trips and defaults to undefined', () => {
    const linked = CabinetNode.parse({
      id: 'cabinet_island-schema-linked',
      islandLink: { role: 'front', pairedRunId: 'cabinet_island-schema-back' },
    })
    expect(linked.islandLink).toEqual({ role: 'front', pairedRunId: 'cabinet_island-schema-back' })

    const bare = CabinetNode.parse({ id: 'cabinet_island-schema-bare' })
    expect(bare.islandLink).toBeUndefined()
  })

  test('setLink round-trips with its gap/anchor defaults', () => {
    const linked = CabinetNode.parse({
      id: 'cabinet_set-schema-linked',
      setLink: { baseRunId: 'cabinet_set-schema-base' },
    })
    expect(linked.setLink).toEqual({
      baseRunId: 'cabinet_set-schema-base',
      gap: 0.6,
      anchor: 'lower',
    })

    const bare = CabinetNode.parse({ id: 'cabinet_set-schema-bare' })
    expect(bare.setLink).toBeUndefined()
  })
})

describe('addIslandBackRun', () => {
  test('creates a linked back row with symmetric islandLink and pi-apart rotation', () => {
    const { runId, moduleId, run, module } = seedStraightRun('island-basic')
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])

    const backRunId = addIslandBackRun({ run, sceneApi })
    expect(backRunId).toBeTruthy()

    const front = sceneApi.get<CabinetNode>(runId)!
    const back = sceneApi.get<CabinetNode>(backRunId!)!

    expect(front.islandLink).toEqual({ role: 'front', pairedRunId: backRunId })
    expect(back.islandLink).toEqual({ role: 'back', pairedRunId: runId })
    expect(back.runTier).toBe('base')
    expect(back.parentId).toBe(moduleId)
    expect(Math.abs(back.rotation - Math.PI)).toBeLessThan(1e-6)
    // The touching backs are internal now — neither side keeps the old
    // one-sided island's seating overhang / finished-back panel.
    expect(front.countertopBackOverhang).toBe(0)
    expect(front.withFinishedBack).toBe(false)
    expect(back.countertopBackOverhang).toBe(0)
    expect(back.withFinishedBack).toBe(false)

    const runs = Object.values(sceneApi.nodes()).filter(
      (node): node is CabinetNode => node.type === 'cabinet',
    )
    expect(runs).toHaveLength(2)
  })

  test('does not pair a run that already has an islandLink', () => {
    const { run, module } = seedStraightRun('island-double')
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])
    const firstBackId = addIslandBackRun({ run, sceneApi })!
    const liveRun = sceneApi.get<CabinetNode>(run.id as AnyNodeId)!

    const secondBackId = addIslandBackRun({ run: liveRun, sceneApi })

    expect(secondBackId).toBeNull()
    const runs = Object.values(sceneApi.nodes()).filter((node) => node.type === 'cabinet')
    expect(runs).toHaveLength(2)
    expect(firstBackId).toBeTruthy()
  })

  test('the paired run is treated as adjacent, suppressing the touching back overhang', () => {
    const { run, module } = seedStraightRun('island-adjacency')
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])
    const backRunId = addIslandBackRun({ run, sceneApi })!
    const backRun = sceneApi.get<CabinetNode>(backRunId)!
    const backModuleId = backRun.children[0]!

    // A user could still dial up seating overhang on either side after
    // pairing — without adjacency suppression BOTH would render the full
    // overhang into the shared spine (the "double overhang" trap).
    sceneApi.update(run.id as AnyNodeId, { countertopBackOverhang: 0.3 })
    sceneApi.update(backRunId, { countertopBackOverhang: 0.3 })

    const liveFront = sceneApi.get<CabinetNode>(run.id as AnyNodeId)!
    const liveFrontModule = sceneApi.get<CabinetModuleNode>(module.id as AnyNodeId)!
    const liveBack = sceneApi.get<CabinetNode>(backRunId)!
    const liveBackModule = sceneApi.get<CabinetModuleNode>(backModuleId)!
    const allNodes = sceneApi.nodes()
    const resolve = ((id: AnyNodeId) => allNodes[id]) as GeometryContext['resolve']

    const frontSpans = getRunSpans([liveFrontModule], { runTier: liveFront.runTier })
    const frontEnds = getRunSpanEnds(
      liveFront,
      { children: [liveFrontModule], parent: null, resolve, siblings: [] },
      frontSpans,
    )
    expect(frontEnds[0]!.backOverhangSuppressed).toBe(true)

    const backSpans = getRunSpans([liveBackModule], { runTier: liveBack.runTier })
    const backEnds = getRunSpanEnds(
      liveBack,
      { children: [liveBackModule], parent: null, resolve, siblings: [] },
      backSpans,
    )
    expect(backEnds[0]!.backOverhangSuppressed).toBe(true)
  })
})

describe('resolveCabinetRunWallSnap / resolveCabinetModuleWallSnapLocal skip islandLink runs', () => {
  test('resolveCabinetRunWallSnap returns null for a run carrying islandLink', () => {
    const level = LevelNode.parse({
      id: 'level_island-wall-snap',
      children: ['wall_island-wall-snap' as AnyNodeId],
    })
    const wall = WallNode.parse({
      id: 'wall_island-wall-snap',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
      thickness: 0.2,
    })
    const cabinet = CabinetNode.parse({
      id: 'cabinet_island-wall-snap',
      parentId: level.id,
      position: [1.2, 0, 0.82],
      rotation: 0,
      depth: 0.58,
      children: ['cabinet-module_island-wall-snap'],
      islandLink: { role: 'front', pairedRunId: 'cabinet_island-wall-snap-back' },
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_island-wall-snap',
      parentId: cabinet.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
    })
    const nodes = {
      [level.id]: level,
      [wall.id]: wall,
      [cabinet.id]: cabinet,
      [module.id]: module,
    } as Record<AnyNodeId, AnyNode>

    const snapped = resolveCabinetRunWallSnap({
      cabinet,
      candidatePosition: [1.2, 0, 0.32],
      nodes,
      parentLevelId: level.id,
    })

    expect(snapped).toBeNull()
  })

  test('resolveCabinetModuleWallSnapLocal returns null when the run carries islandLink', () => {
    const level = LevelNode.parse({
      id: 'level_island-module-wall-snap',
      children: ['wall_island-module-wall-snap' as AnyNodeId],
    })
    const wall = WallNode.parse({
      id: 'wall_island-module-wall-snap',
      parentId: level.id,
      start: [0, 0],
      end: [4, 0],
      thickness: 0.2,
    })
    const run = CabinetNode.parse({
      id: 'cabinet_island-module-wall-snap',
      parentId: level.id,
      position: [1, 0, 0.39],
      rotation: 0,
      depth: 0.58,
      children: ['cabinet-module_island-module-wall-snap'],
      islandLink: { role: 'front', pairedRunId: 'cabinet_island-module-wall-snap-back' },
    })
    const module = CabinetModuleNode.parse({
      id: 'cabinet-module_island-module-wall-snap',
      parentId: run.id,
      position: [0, 0.1, 0],
      width: 0.9,
      depth: 0.58,
    })
    const nodes = {
      [level.id]: level,
      [wall.id]: wall,
      [run.id]: run,
      [module.id]: module,
    } as Record<AnyNodeId, AnyNode>

    const snapped = resolveCabinetModuleWallSnapLocal({
      candidateLocal: [0, 0.1, 0],
      module,
      nodes,
      parentLevelId: level.id,
      run,
    })

    expect(snapped).toBeNull()
  })
})

describe('island back row deletion cascades via the parametrics onDelete hook', () => {
  beforeEach(async () => {
    if (!nodeRegistry.get('cabinet') || !nodeRegistry.get('cabinet-module')) {
      await loadPlugin(builtinPlugin)
    }
    useScene.setState({ nodes: {}, rootNodeIds: [] } as never)
    useScene.temporal.getState().clear()
  })

  function seedSceneRun(prefix: string) {
    const levelId = `level_${prefix}` as AnyNodeId
    const runId = `cabinet_${prefix}` as AnyNodeId
    const moduleId = `cabinet-module_${prefix}` as AnyNodeId
    const level = {
      id: levelId,
      type: 'level',
      object: 'node',
      visible: true,
      name: '',
      metadata: {},
      position: [0, 0, 0],
      rotation: 0,
      level: 0,
      parentId: null,
      children: [runId],
    } as unknown as AnyNode
    const run = CabinetNode.parse({
      id: runId,
      parentId: levelId,
      position: [0, 0, 0],
      rotation: 0,
      depth: 0.6,
      children: [moduleId],
    })
    const module = CabinetModuleNode.parse({
      id: moduleId,
      parentId: runId,
      position: [0, run.plinthHeight, 0],
      width: 0.9,
      depth: run.depth,
      carcassHeight: run.carcassHeight,
    })
    const nodes: Record<string, AnyNode> = {
      [level.id]: level,
      [run.id]: run as AnyNode,
      [module.id]: module as AnyNode,
    }
    useScene.setState({ nodes, rootNodeIds: [level.id] } as never)
    return { levelId, runId, moduleId, run, module }
  }

  test('deleting the back row alone clears the front runs islandLink', () => {
    const { runId, run } = seedSceneRun('island-del-back')
    const sceneApi = createSceneApi(useScene)
    const backRunId = addIslandBackRun({ run, sceneApi })!

    useScene.getState().deleteNode(backRunId)

    const nodes = useScene.getState().nodes
    expect(nodes[backRunId]).toBeUndefined()
    expect((nodes[runId] as CabinetNode).islandLink).toBeUndefined()
  })

  test('deleting the front run cascades away the whole linked pair', () => {
    const { runId, run } = seedSceneRun('island-del-front')
    const sceneApi = createSceneApi(useScene)
    const backRunId = addIslandBackRun({ run, sceneApi })!

    useScene.getState().deleteNode(runId)

    const nodes = useScene.getState().nodes
    expect(nodes[runId]).toBeUndefined()
    expect(nodes[backRunId]).toBeUndefined()
  })
})

describe('wallBottomHeightForSetLink', () => {
  test('tracks a customized base run real height + gap, unlike the fixed tall-alignment constant', () => {
    const customBase = {
      showPlinth: true,
      plinthHeight: 0.15,
      carcassHeight: 0.9,
      withCountertop: true,
      countertopThickness: 0.03,
    }

    const height = wallBottomHeightForSetLink(customBase, 0.6)

    expect(height).toBeCloseTo(0.15 + 0.9 + 0.03 + 0.6)
    expect(height).not.toBeCloseTo(wallBottomHeightForTallAlignment())
  })
})

describe('addWallSetRun', () => {
  test('creates a wall-tier run nested under the base run first module with setLink', () => {
    const { runId, moduleId, run, module } = seedStraightRun('set-basic')
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])

    const wallRunId = addWallSetRun({ run, sceneApi })
    expect(wallRunId).toBeTruthy()

    const wallRun = sceneApi.get<CabinetNode>(wallRunId!)!
    expect(wallRun.runTier).toBe('wall')
    expect(wallRun.parentId).toBe(moduleId)
    expect(wallRun.setLink).toEqual({ baseRunId: runId, gap: 0.6, anchor: 'lower' })

    const liveRun = sceneApi.get<CabinetNode>(runId)!
    expect(findSetLinkWallRuns(liveRun, sceneApi.nodes())).toHaveLength(1)
  })

  test('refuses a second wall set run on the same base run', () => {
    const { run, module } = seedStraightRun('set-double')
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])
    addWallSetRun({ run, sceneApi })
    const liveRun = sceneApi.get<CabinetNode>(run.id as AnyNodeId)!

    const secondId = addWallSetRun({ run: liveRun, sceneApi })

    expect(secondId).toBeNull()
  })
})

describe('syncSetLinkWallRun', () => {
  test('repositions the linked wall run when the base run carcassHeight/plinth changes', () => {
    const { runId, run, module } = seedStraightRun('set-sync')
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])
    const wallRunId = addWallSetRun({ run, sceneApi })!
    const yBefore = sceneApi.get<CabinetNode>(wallRunId)!.position[1]

    sceneApi.update(runId, { carcassHeight: 1.1, plinthHeight: 0.15 })
    const updatedBase = sceneApi.get<CabinetNode>(runId)!
    syncSetLinkWallRun({ baseRun: updatedBase, sceneApi })

    const yAfter = sceneApi.get<CabinetNode>(wallRunId)!.position[1]
    expect(yAfter).not.toBeCloseTo(yBefore)
    expect(yAfter - yBefore).toBeCloseTo(1.1 - run.carcassHeight + (0.15 - run.plinthHeight))
  })

  test('anchor "upper" keeps the wall run position fixed against a base height change', () => {
    const { runId, run, module } = seedStraightRun('set-sync-upper')
    const sceneApi = sceneApiFixture([run as AnyNode, module as AnyNode])
    const wallRunId = addWallSetRun({ run, sceneApi })!
    sceneApi.update(wallRunId, {
      setLink: { ...sceneApi.get<CabinetNode>(wallRunId)!.setLink!, anchor: 'upper' },
    })
    const yBefore = sceneApi.get<CabinetNode>(wallRunId)!.position[1]

    sceneApi.update(runId, { carcassHeight: 1.3 })
    const updatedBase = sceneApi.get<CabinetNode>(runId)!
    syncSetLinkWallRun({ baseRun: updatedBase, sceneApi })

    const yAfter = sceneApi.get<CabinetNode>(wallRunId)!.position[1]
    expect(yAfter).toBeCloseTo(yBefore)
  })
})

import { beforeEach, describe, expect, test } from 'bun:test'
import {
  createDefaultFurnitureAssembly,
  createRectangleBody,
  getBodyLoopVertices,
  insertFurnitureBay,
  insertFurnitureTier,
  pushPullBodyFace,
  setFurnitureTierInterior,
} from '@pascal-app/core'
import { type AnyNodeId, BodyNode, CabinetNode, LevelNode, WallNode } from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'
import { useViewer } from '@pascal-app/viewer'
import { AiModelingPlanSchema, applyAiModelingPlan, buildAiSceneContext } from './ai-control'
import { applyAiModelingPlanWithAssets } from './ai-control-assets'

const levelId = 'level_ai_test' as AnyNodeId

function resetScene(): void {
  const level = LevelNode.parse({ id: levelId, level: 0 })
  useScene.setState({
    nodes: { [levelId]: level },
    rootNodeIds: [levelId],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    installedPlugins: [],
    readOnly: false,
  })
  useScene.temporal.getState().clear()
  useViewer.getState().resetSelection()
}

describe('AI modeling control plane', () => {
  beforeEach(resetScene)

  test('validates a structured modeling plan at the API boundary', () => {
    const wall = WallNode.parse({
      id: 'wall_ai_test',
      start: [0, 0],
      end: [1.2, 0],
      thickness: 0.2,
    })

    const plan = AiModelingPlanSchema.parse({
      message: '1200 mm wall ready to apply.',
      patches: [{ op: 'create', node: wall, parentId: levelId }],
    })

    expect(plan.patches).toHaveLength(1)
    expect(plan.patches[0]?.op).toBe('create')
  })

  test('applies detailed patches as one undo step', () => {
    const firstWall = WallNode.parse({
      id: 'wall_ai_first',
      start: [0, 0],
      end: [1.2, 0],
      thickness: 0.2,
    })
    const secondWall = WallNode.parse({
      id: 'wall_ai_second',
      start: [1.2, 0],
      end: [1.2, 2.4],
      thickness: 0.2,
    })

    const result = applyAiModelingPlan({
      message: 'Created two connected walls.',
      patches: [
        { op: 'create', node: firstWall, parentId: levelId },
        { op: 'create', node: secondWall, parentId: levelId },
      ],
    })

    expect(result.appliedOps).toBe(2)
    expect(result.createdIds).toEqual(['wall_ai_first', 'wall_ai_second'])
    expect(useScene.getState().nodes.wall_ai_first?.type).toBe('wall')
    expect(useScene.getState().nodes.wall_ai_second?.type).toBe('wall')
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes.wall_ai_first).toBeUndefined()
    expect(useScene.getState().nodes.wall_ai_second).toBeUndefined()
  })

  test('adds the standard physical assembly to AI-created walls', () => {
    applyAiModelingPlan({
      message: 'Created one standard wall.',
      patches: [
        {
          op: 'create',
          parentId: levelId,
          node: {
            object: 'node',
            type: 'wall',
            id: 'wall_ai_default_assembly',
            start: [0, 0],
            end: [2, 0],
          },
        },
      ],
    })

    const wall = WallNode.parse(useScene.getState().nodes.wall_ai_default_assembly)
    expect(wall.thickness).toBe(0.1)
    expect(wall.faceBands?.construction?.upper?.layers.map((layer) => layer.kind)).toEqual([
      'timber-stud',
      'cavity',
      'gypsum-board',
      'finish',
    ])
  })

  test('rejects the whole plan before mutation when a parent is missing', () => {
    const wall = WallNode.parse({
      id: 'wall_ai_invalid',
      start: [0, 0],
      end: [1.2, 0],
    })

    expect(() =>
      applyAiModelingPlan({
        message: 'Invalid wall.',
        patches: [{ op: 'create', node: wall, parentId: 'missing_level' }],
      }),
    ).toThrow('parentId')

    expect(useScene.getState().nodes.wall_ai_invalid).toBeUndefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('builds a structural context without viewport pixels', () => {
    const context = buildAiSceneContext()

    expect(context.coordinateSystem).toEqual({ groundPlane: 'XZ', upAxis: 'Y', unit: 'm' })
    expect(context.rootNodeIds).toEqual([levelId])
    expect(context.nodes[levelId]?.type).toBe('level')
    expect(context.nodeCount).toBe(1)
    expect(context).not.toHaveProperty('screenshot')
  })

  test('includes the current hierarchy and selected nodes for precise chat control', () => {
    const wall = WallNode.parse({
      id: 'wall_ai_selected',
      parentId: levelId,
      start: [0, 0],
      end: [1.2, 0],
      thickness: 0.2,
    })
    useScene.setState((state) => ({ nodes: { ...state.nodes, [wall.id]: wall } }))
    useViewer.getState().setSelection({ selectedIds: [wall.id] })

    const context = buildAiSceneContext()

    expect(context.selection.selectedIds).toEqual([wall.id])
    expect(context.selection.selectedNodes).toEqual([wall])
    expect(context.selection.levelId).toBeNull()
    expect(context).not.toHaveProperty('viewport')
  })

  test('pushes a body face by an exact metric distance as one undo step', () => {
    // Given
    const body = BodyNode.parse({
      ...createRectangleBody({ width: 1.2, depth: 0.8 }),
      id: 'body_ai_push_pull',
      parentId: levelId,
    })
    useScene.setState((state) => ({ nodes: { ...state.nodes, [body.id]: body } }))
    useScene.temporal.getState().clear()

    // When
    const result = applyAiModelingPlan({
      message: 'Pushed the selected face by 1200 mm.',
      patches: [
        {
          op: 'pushPullBodyFace',
          id: body.id,
          faceId: 'face:0',
          distance: 1.2,
        },
      ],
    })

    // Then
    const updated = BodyNode.parse(useScene.getState().nodes[body.id])
    expect(result.appliedOps).toBe(1)
    expect(updated.revision).toBe(1)
    expect(getBodyLoopVertices(updated, 'loop:0').every((point) => point[1] === 1.2)).toBe(true)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(BodyNode.parse(useScene.getState().nodes[body.id]).revision).toBe(0)
  })

  test('imprints and raises a closed body face without guessing the inset face id', () => {
    const body = BodyNode.parse({
      ...pushPullBodyFace(createRectangleBody({ width: 1.2, depth: 0.8 }), 'face:0', 1.2).body,
      id: 'body_ai_imprint',
      parentId: levelId,
    })
    useScene.setState((state) => ({ nodes: { ...state.nodes, [body.id]: body } }))
    useScene.temporal.getState().clear()

    const result = applyAiModelingPlan({
      message: 'Imprinted and raised a rectangular boss.',
      patches: [
        {
          op: 'imprintBodyFace',
          id: body.id,
          faceId: 'face:0',
          profilePoints: [
            [0.2, 1.2, 0.1],
            [1, 1.2, 0.1],
            [1, 1.2, 0.7],
            [0.2, 1.2, 0.7],
          ],
          distance: 0.15,
        },
      ],
    })

    const updated = BodyNode.parse(useScene.getState().nodes[body.id])
    expect(result.appliedOps).toBe(1)
    expect(updated.faces.some((face) => face.id === 'face:0:imprint:2')).toBe(true)
    expect(
      getBodyLoopVertices(updated, 'face:0:imprint:2:outer:2').every(
        (point) => Math.abs(point[1] - 1.35) < 1e-9,
      ),
    ).toBe(true)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(BodyNode.parse(useScene.getState().nodes[body.id]).revision).toBe(1)
    expect(
      BodyNode.parse(useScene.getState().nodes[body.id]).faces.some(
        (face) => face.id === 'face:0:imprint:2',
      ),
    ).toBe(false)
  })

  test('creates a rounded hollow frame as one structured operation and one undo step', () => {
    const result = applyAiModelingPlan({
      message: 'Created one rounded hollow frame wall.',
      patches: [
        {
          op: 'createRoundedRectangularFrameBody',
          id: 'body_ai_rounded_frame',
          parentId: levelId,
          name: 'Rounded frame wall',
          origin: [0, 0, 0],
          width: 2,
          height: 2.4,
          depth: 0.1,
          openingWidth: 1,
          openingHeight: 0.8,
          topCornerRadius: 0.2,
        },
      ],
    })

    const body = BodyNode.parse(useScene.getState().nodes.body_ai_rounded_frame)
    expect(result.appliedOps).toBe(1)
    expect(body.metadata).toMatchObject({
      primitive: 'rounded-rectangular-frame',
      width: 2,
      height: 2.4,
      depth: 0.1,
      openingWidth: 1,
      openingHeight: 0.8,
      topCornerRadius: 0.2,
    })
    expect(body.faces.find((face) => face.id === 'face:front')?.innerLoopIds).toHaveLength(1)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes.body_ai_rounded_frame).toBeUndefined()
  })

  test('creates normalized furniture through the shared operation in one undo step', () => {
    const result = applyAiModelingPlan({
      message: 'Created a two-bay wardrobe.',
      patches: [
        {
          op: 'createFurniture',
          id: 'cabinet_ai_wardrobe',
          parentId: levelId,
          name: 'AI Wardrobe',
          position: [1, 0, 2],
          rotationY: 0,
          furnitureKind: 'wardrobe',
          dimensions: { width: 2.4, height: 2.4, depth: 0.6 },
          bayCount: 2,
        },
      ],
    })

    const cabinet = CabinetNode.parse(useScene.getState().nodes.cabinet_ai_wardrobe)
    expect(result.appliedOps).toBe(1)
    expect(cabinet.parentId).toBe(levelId)
    expect(cabinet.position).toEqual([1, 0, 2])
    expect(cabinet.furniture?.dimensions).toEqual({ width: 2.4, height: 2.4, depth: 0.6 })
    expect(cabinet.furniture?.bays.map((bay) => bay.width)).toEqual([1.2, 1.2])
    expect(cabinet.width).toBe(2.4)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes.cabinet_ai_wardrobe).toBeUndefined()
  })

  test('keeps direct and AI tier interior edits structurally identical', () => {
    applyAiModelingPlan({
      message: 'Created a two-bay wardrobe.',
      patches: [
        {
          op: 'createFurniture',
          id: 'cabinet_ai_tier_interior',
          parentId: levelId,
          name: 'AI Wardrobe',
          position: [0, 0, 0],
          rotationY: 0,
          furnitureKind: 'wardrobe',
          dimensions: { width: 2.4, height: 2.4, depth: 0.6 },
          bayCount: 2,
        },
      ],
    })
    const before = CabinetNode.parse(useScene.getState().nodes.cabinet_ai_tier_interior)
    const assembly = before.furniture
    if (!assembly) throw new Error('Expected the created cabinet to have furniture.')
    const bay = assembly.bays[1]
    const tier = bay.tiers[0]
    const expectedFurniture = setFurnitureTierInterior(assembly, {
      bayId: bay.id,
      tierId: tier.id,
      shelfCount: 3,
      hanger: true,
    })
    useScene.temporal.getState().clear()

    const result = applyAiModelingPlan({
      message: 'Configured the second bay interior.',
      patches: [
        {
          op: 'setFurnitureTierInterior',
          id: before.id,
          bayId: bay.id,
          tierId: tier.id,
          shelfCount: 3,
          hanger: true,
        },
      ],
    })

    const updated = CabinetNode.parse(useScene.getState().nodes[before.id])
    expect(result.appliedOps).toBe(1)
    expect(updated.furniture).toEqual(expectedFurniture)
    expect(updated.id).toBe(before.id)
    expect(updated.name).toBe(before.name)
    expect(updated.position).toEqual(before.position)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(CabinetNode.parse(useScene.getState().nodes[before.id]).furniture).toEqual(assembly)
  })

  test('does not create history for an identical tier interior operation', () => {
    const assembly = createDefaultFurnitureAssembly()
    const cabinet = CabinetNode.parse({
      id: 'cabinet_ai_tier_noop',
      parentId: levelId,
      width: assembly.dimensions.width,
      depth: assembly.dimensions.depth,
      carcassHeight: assembly.dimensions.height,
      furniture: assembly,
    })
    useScene.setState((state) => ({ nodes: { ...state.nodes, [cabinet.id]: cabinet } }))
    useScene.temporal.getState().clear()

    const result = applyAiModelingPlan({
      message: 'No interior change needed.',
      patches: [
        {
          op: 'setFurnitureTierInterior',
          id: cabinet.id,
          bayId: assembly.bays[0].id,
          tierId: assembly.bays[0].tiers[0].id,
          shelfCount: assembly.bays[0].tiers[0].shelves.count,
          hanger: assembly.bays[0].tiers[0].hanger,
        },
      ],
    })

    expect(result.appliedOps).toBe(0)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('keeps direct and AI structural furniture edits identical in one undo step', () => {
    const assembly = createDefaultFurnitureAssembly({ bayCount: 2 })
    const cabinet = CabinetNode.parse({
      id: 'cabinet_ai_structure',
      parentId: levelId,
      width: assembly.dimensions.width,
      depth: assembly.dimensions.depth,
      carcassHeight: assembly.dimensions.height,
      furniture: assembly,
    })
    useScene.setState((state) => ({ nodes: { ...state.nodes, [cabinet.id]: cabinet } }))
    useScene.temporal.getState().clear()
    const withBay = insertFurnitureBay(assembly, { afterBayId: 'bay-0', newWidth: 0.2 })
    const expected = insertFurnitureTier(withBay, {
      bayId: 'bay-0-copy',
      afterTierId: 'bay-0-copy-tier-0',
      newHeight: 0.8,
    })

    const result = applyAiModelingPlan({
      message: 'Added a bay and a tier.',
      patches: [
        {
          op: 'insertFurnitureBay',
          id: cabinet.id,
          afterBayId: 'bay-0',
          newWidth: 0.2,
        },
        {
          op: 'insertFurnitureTier',
          id: cabinet.id,
          bayId: 'bay-0-copy',
          afterTierId: 'bay-0-copy-tier-0',
          newHeight: 0.8,
        },
      ],
    })

    expect(result.appliedOps).toBe(2)
    expect(CabinetNode.parse(useScene.getState().nodes[cabinet.id]).furniture).toEqual(expected)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(CabinetNode.parse(useScene.getState().nodes[cabinet.id]).furniture).toEqual(assembly)
  })

  test('rolls back a tier interior plan when a later target is invalid', () => {
    const assembly = createDefaultFurnitureAssembly()
    const cabinet = CabinetNode.parse({
      id: 'cabinet_ai_tier_rollback',
      parentId: levelId,
      width: assembly.dimensions.width,
      depth: assembly.dimensions.depth,
      carcassHeight: assembly.dimensions.height,
      furniture: assembly,
    })
    useScene.setState((state) => ({ nodes: { ...state.nodes, [cabinet.id]: cabinet } }))
    useScene.temporal.getState().clear()

    expect(() =>
      applyAiModelingPlan({
        message: 'Invalid interior plan.',
        patches: [
          {
            op: 'setFurnitureTierInterior',
            id: cabinet.id,
            bayId: assembly.bays[0].id,
            tierId: assembly.bays[0].tiers[0].id,
            shelfCount: 2,
            hanger: true,
          },
          {
            op: 'setFurnitureTierInterior',
            id: cabinet.id,
            bayId: 'missing-bay',
            tierId: assembly.bays[0].tiers[0].id,
            shelfCount: 1,
            hanger: false,
          },
        ],
      }),
    ).toThrow(RangeError)

    expect(CabinetNode.parse(useScene.getState().nodes[cabinet.id]).furniture).toEqual(assembly)
    expect(useScene.temporal.getState().pastStates).toHaveLength(0)
  })

  test('applies repeated body face pushes in one plan and one undo step', () => {
    // Given
    const body = BodyNode.parse({
      ...createRectangleBody({ width: 1.2, depth: 0.8 }),
      id: 'body_ai_repeated_push_pull',
      parentId: levelId,
    })
    useScene.setState((state) => ({ nodes: { ...state.nodes, [body.id]: body } }))
    useScene.temporal.getState().clear()

    // When
    applyAiModelingPlan({
      message: 'Pushed the same face twice.',
      patches: [
        { op: 'pushPullBodyFace', id: body.id, faceId: 'face:0', distance: 1.2 },
        { op: 'pushPullBodyFace', id: body.id, faceId: 'face:0', distance: 0.3 },
      ],
    })

    // Then
    const updated = BodyNode.parse(useScene.getState().nodes[body.id])
    expect(updated.revision).toBe(2)
    expect(getBodyLoopVertices(updated, 'loop:0').every((point) => point[1] === 1.5)).toBe(true)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(BodyNode.parse(useScene.getState().nodes[body.id]).revision).toBe(0)
  })

  test('paints one body face and restores the body and material with one undo', () => {
    // Given
    const body = BodyNode.parse({
      ...createRectangleBody({ width: 1.2, depth: 0.8 }),
      id: 'body_ai_paint',
      parentId: levelId,
    })
    useScene.setState((state) => ({ nodes: { ...state.nodes, [body.id]: body } }))
    useScene.temporal.getState().clear()

    // When
    const result = applyAiModelingPlan({
      message: 'Painted the top face matte red.',
      patches: [
        {
          op: 'paintBodyFace',
          id: body.id,
          faceId: 'face:0',
          material: {
            id: 'mat_body_red',
            name: 'Matte red paint',
            material: {
              preset: 'custom',
              properties: { color: '#b91c1c', roughness: 0.85, metalness: 0 },
            },
          },
        },
      ],
    })

    // Then
    const painted = BodyNode.parse(useScene.getState().nodes[body.id])
    expect(result.appliedOps).toBe(1)
    expect(painted.faces[0]?.surface.materialRef).toBe('scene:mat_body_red')
    expect(useScene.getState().materials.mat_body_red?.material.properties?.color).toBe('#b91c1c')
    expect(painted.vertices).toEqual(body.vertices)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(BodyNode.parse(useScene.getState().nodes[body.id]).faces[0]?.surface.materialRef).toBe(
      undefined,
    )
    expect(useScene.getState().materials.mat_body_red).toBeUndefined()
  })

  test('replaces a scene material texture with the locally cached seamless asset', async () => {
    // Given: one textured scene material selected by its stable id.
    useScene.getState().addSceneMaterial({
      id: 'mat_rawpainter_70225',
      name: 'RawPainter stone',
      material: {
        preset: 'custom',
        texture: { url: '/api/materials/rawpainter/asset/70225', repeat: [1, 1] },
      },
    })
    useScene.temporal.getState().clear()

    // When: the AI seamless operation resolves the image through the local asset cache.
    const result = await applyAiModelingPlanWithAssets(
      {
        message: 'Converted the selected material to a seamless texture.',
        patches: [{ op: 'makeMaterialSeamless', materialId: 'mat_rawpainter_70225' }],
      },
      async () => 'asset://seamless-digest',
    )

    // Then: the material keeps its settings and changes texture in one undo step.
    expect(result.appliedOps).toBe(1)
    expect(useScene.getState().materials.mat_rawpainter_70225?.material.texture).toEqual({
      url: 'asset://seamless-digest',
      repeat: [1, 1],
    })
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })
})

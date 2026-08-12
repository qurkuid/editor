import { beforeEach, describe, expect, test } from 'bun:test'
import { createRectangleBody, inspectBodySolid, pushPullBodyFace } from '@pascal-app/core'
import {
  type AnyNodeId,
  BodyNode,
  ConstructionDimensionNode,
  LevelNode,
  MeasurementNode,
} from '@pascal-app/core/schema'
import useScene from '@pascal-app/core/store'
import { commitBodyBoolean, commitBodyIntersection, commitBodySolidTool } from './body-boolean'

if (typeof globalThis.requestAnimationFrame !== 'function') {
  globalThis.requestAnimationFrame = (callback) => {
    callback(0)
    return 0
  }
  globalThis.cancelAnimationFrame = () => {}
}

const levelId = 'level_body_boolean_editor' as AnyNodeId

function resetScene() {
  const level = LevelNode.parse({ id: levelId, level: 0 })
  useScene.setState({
    nodes: { [level.id]: level },
    rootNodeIds: [level.id],
    dirtyNodes: new Set<AnyNodeId>(),
    collections: {},
    materials: {},
    installedPlugins: [],
    readOnly: false,
  })
  useScene.temporal.getState().clear()
}

function box(id: AnyNodeId, origin: [number, number, number]) {
  return BodyNode.parse({
    ...pushPullBodyFace(createRectangleBody({ width: 2, depth: 2, origin }), 'face:0', 2).body,
    id,
    parentId: levelId,
  })
}

describe('direct Body intersection service', () => {
  beforeEach(resetScene)

  test('commits target update and tool deletion as one undoable scene step', () => {
    const target = box('body_editor_target', [0, 0, 0])
    const tool = box('body_editor_tool', [1, 0, 1])
    useScene.setState((state) => ({
      nodes: { ...state.nodes, [target.id]: target, [tool.id]: tool },
    }))
    useScene.temporal.getState().clear()

    const result = commitBodyIntersection(target, tool)

    expect(inspectBodySolid(result).validSolid).toBe(true)
    expect(useScene.getState().nodes[target.id]).toEqual(result)
    expect(useScene.getState().nodes[tool.id]).toBeUndefined()
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[target.id]).toEqual(target)
    expect(useScene.getState().nodes[tool.id]).toEqual(tool)
  })

  test('commits union and subtraction target-first with one undoable step', () => {
    for (const operation of ['union', 'subtract'] as const) {
      resetScene()
      const target = box(`body_editor_${operation}_target`, [0, 0, 0])
      const tool = box(`body_editor_${operation}_tool`, [1, 0, 1])
      useScene.setState((state) => ({
        nodes: { ...state.nodes, [target.id]: target, [tool.id]: tool },
      }))
      useScene.temporal.getState().clear()

      const result = commitBodyBoolean(target, tool, operation)

      expect(inspectBodySolid(result).validSolid).toBe(true)
      expect(useScene.getState().nodes[target.id]).toEqual(result)
      expect(useScene.getState().nodes[tool.id]).toBeUndefined()
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes[target.id]).toEqual(target)
      expect(useScene.getState().nodes[tool.id]).toEqual(tool)
    }
  })

  test('commits outer shell, trim, and split with their tool lifetime contracts', () => {
    for (const operation of ['outer-shell', 'trim', 'split'] as const) {
      resetScene()
      const target = box(`body_editor_${operation}_target`, [0, 0, 0])
      const tool = box(`body_editor_${operation}_tool`, [1, 0, 1])
      useScene.setState((state) => ({
        nodes: { ...state.nodes, [target.id]: target, [tool.id]: tool },
      }))
      useScene.temporal.getState().clear()

      const bodies = commitBodySolidTool(target, tool, operation)

      expect(bodies).toHaveLength(operation === 'split' ? 3 : operation === 'trim' ? 2 : 1)
      expect(useScene.getState().nodes[tool.id] === undefined).toBe(operation === 'outer-shell')
      expect(useScene.temporal.getState().pastStates).toHaveLength(1)
      useScene.temporal.getState().undo()
      expect(useScene.getState().nodes[target.id]).toEqual(target)
      expect(useScene.getState().nodes[tool.id]).toEqual(tool)
    }
  })

  test('remaps Body measurement and dimension anchors through split and restores them on undo', () => {
    const target = box('body_editor_annotation_target', [0, 0, 0])
    const tool = box('body_editor_annotation_tool', [1, 0, 1])
    const anchor = {
      kind: 'feature' as const,
      reference: { nodeId: target.id, featureId: 'face:0' },
      fallback: [0, 0, 0] as [number, number, number],
    }
    const measurement = MeasurementNode.parse({
      id: 'measurement_body_boolean',
      parentId: levelId,
      measurement: { kind: 'distance', points: [anchor, [2, 0, 0]] },
    })
    const dimension = ConstructionDimensionNode.parse({
      id: 'construction-dimension_body_boolean',
      parentId: levelId,
      anchors: [anchor, [2, 0, 0]],
    })
    useScene.setState((state) => ({
      nodes: {
        ...state.nodes,
        [target.id]: target,
        [tool.id]: tool,
        [measurement.id]: measurement,
        [dimension.id]: dimension,
      },
    }))
    useScene.temporal.getState().clear()

    const pieces = commitBodySolidTool(target, tool, 'split')
    const updatedMeasurement = useScene.getState().nodes[measurement.id]
    const updatedDimension = useScene.getState().nodes[dimension.id]
    const targetBody = useScene.getState().nodes[target.id]
    if (updatedMeasurement?.type !== 'measurement') throw new Error('Expected measurement update')
    if (updatedDimension?.type !== 'construction-dimension') {
      throw new Error('Expected construction dimension update')
    }
    if (targetBody?.type !== 'body') throw new Error('Expected target body update')
    if (updatedMeasurement.measurement.kind !== 'distance') {
      throw new Error('Expected distance measurement update')
    }
    const measurementAnchor = updatedMeasurement.measurement.points[0]
    const dimensionAnchor = updatedDimension.anchors[0]
    if (!dimensionAnchor || Array.isArray(dimensionAnchor)) {
      throw new Error('Expected construction dimension feature anchor')
    }
    expect(Array.isArray(measurementAnchor) ? null : measurementAnchor.reference.nodeId).toBe(
      target.id,
    )
    expect(dimensionAnchor.reference.nodeId).toBe(target.id)
    expect(
      Array.isArray(measurementAnchor) ? null : measurementAnchor.reference.featureId,
    ).not.toBe('face:0')
    expect(
      targetBody.faces.some((face) =>
        Array.isArray(measurementAnchor)
          ? false
          : face.id === measurementAnchor.reference.featureId,
      ),
    ).toBe(true)
    expect(pieces).toHaveLength(3)
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    useScene.temporal.getState().undo()
    expect(useScene.getState().nodes[measurement.id]).toEqual(measurement)
    expect(useScene.getState().nodes[dimension.id]).toEqual(dimension)
  })
})

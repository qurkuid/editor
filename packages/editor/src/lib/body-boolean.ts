import {
  type AnyNodeId,
  type BodyNode,
  intersectBodies,
  outerShellBodies,
  remapBodyFeatureAnnotations,
  runAsSingleSceneHistoryStep,
  splitBodies,
  subtractBodies,
  trimBodies,
  unionBodies,
  useScene,
} from '@pascal-app/core'

type TopologyRemap = Parameters<typeof remapBodyFeatureAnnotations>[3]

function annotationUpdates(
  nodes: ReturnType<typeof useScene.getState>['nodes'],
  specs: readonly {
    bodyId: AnyNodeId
    body: BodyNode | null
    topologyRemap: Parameters<typeof remapBodyFeatureAnnotations>[3]
  }[],
) {
  const simulated = { ...nodes }
  const updates: ReturnType<typeof remapBodyFeatureAnnotations> = []
  for (const spec of specs) {
    for (const update of remapBodyFeatureAnnotations(
      simulated,
      spec.bodyId,
      spec.body,
      spec.topologyRemap,
    )) {
      updates.push(update)
      const current = simulated[update.id]
      if (current) simulated[update.id] = { ...current, ...update.data } as typeof current
    }
  }
  return updates
}

const EMPTY_REMAP: TopologyRemap = {
  preserved: [],
  created: [],
  deleted: [],
  split: {},
  merged: {},
}

export type BodyBooleanOperation = 'union' | 'subtract' | 'intersect'
export type BodySolidToolOperation = 'outer-shell' | 'trim' | 'split'

export function commitBodyBoolean(
  target: BodyNode,
  tool: BodyNode,
  operation: BodyBooleanOperation,
): BodyNode {
  const result =
    operation === 'union'
      ? unionBodies(target, tool)
      : operation === 'subtract'
        ? subtractBodies(target, tool)
        : intersectBodies(target, tool)
  runAsSingleSceneHistoryStep(useScene, () => {
    const scene = useScene.getState()
    const updates = annotationUpdates(scene.nodes, [
      { bodyId: target.id, body: result.body, topologyRemap: result.topologyRemap },
      { bodyId: tool.id, body: null, topologyRemap: EMPTY_REMAP },
    ])
    scene.updateNodes([{ id: target.id, data: result.body }, ...updates])
    scene.deleteNode(tool.id)
  })
  return result.body
}

export function commitBodyIntersection(target: BodyNode, tool: BodyNode): BodyNode {
  return commitBodyBoolean(target, tool, 'intersect')
}

export function commitBodyUnion(target: BodyNode, tool: BodyNode): BodyNode {
  return commitBodyBoolean(target, tool, 'union')
}

export function commitBodySubtract(target: BodyNode, tool: BodyNode): BodyNode {
  return commitBodyBoolean(target, tool, 'subtract')
}

export function commitBodySolidTool(
  target: BodyNode,
  tool: BodyNode,
  operation: BodySolidToolOperation,
): readonly BodyNode[] {
  let bodies: BodyNode[]
  let remap: TopologyRemap | undefined
  let toolRemap: TopologyRemap | undefined
  if (operation === 'outer-shell') {
    const result = outerShellBodies(target, tool)
    bodies = [result.body]
    remap = result.topologyRemap
  } else if (operation === 'trim') {
    const result = trimBodies(target, tool)
    bodies = [result.body, tool]
    remap = result.topologyRemap
  } else {
    const result = splitBodies(target, tool)
    bodies = result.pieces.map((piece) => piece.body)
    remap = result.pieces.find((piece) => piece.body.id === target.id)?.topologyRemap
    toolRemap = result.pieces.find((piece) => piece.body.id === tool.id)?.topologyRemap
  }
  runAsSingleSceneHistoryStep(useScene, () => {
    const state = useScene.getState()
    const annotationSpecs: {
      bodyId: AnyNodeId
      body: BodyNode | null
      topologyRemap: TopologyRemap
    }[] = [
      ...(remap
        ? [
            {
              bodyId: target.id,
              body: bodies.find((body) => body.id === target.id) ?? null,
              topologyRemap: remap,
            },
          ]
        : []),
      ...(operation === 'trim'
        ? []
        : [
            {
              bodyId: tool.id,
              body: bodies.find((body) => body.id === tool.id) ?? null,
              topologyRemap: toolRemap ?? EMPTY_REMAP,
            },
          ]),
    ]
    const updates = annotationUpdates(state.nodes, annotationSpecs)
    const existingBodies = bodies.filter(
      (body) => !(operation === 'trim' && body.id === tool.id) && state.nodes[body.id],
    )
    const newBodies = bodies.filter(
      (body) => !(operation === 'trim' && body.id === tool.id) && !state.nodes[body.id],
    )
    state.updateNodes([...existingBodies.map((body) => ({ id: body.id, data: body })), ...updates])
    for (const body of newBodies) {
      state.createNode(body, body.parentId ? (body.parentId as AnyNodeId) : undefined)
    }
    if (
      operation === 'outer-shell' ||
      (operation === 'split' && !bodies.some((body) => body.id === tool.id))
    ) {
      state.deleteNode(tool.id)
    }
  })
  return bodies
}

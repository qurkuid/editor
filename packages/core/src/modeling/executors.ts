import { createBodyCircularArray, createBodyLinearArray } from '../lib/body-array'
import {
  cloneComponentInstance,
  createBodyGroupFromBodies,
  createComponentFromBodies,
  explodeComponent,
  makeComponentUnique,
} from '../lib/body-containers'
import {
  intersectBodies,
  outerShellBodies,
  splitBodies,
  subtractBodies,
  trimBodies,
  unionBodies,
} from '../lib/body-csg'
import { splitBodyFace } from '../lib/body-face-split'
import { imprintBodyFace } from '../lib/body-imprint'
import { bodyFeatureIds } from '../lib/body-imprint-helpers'
import { offsetBodyFace } from '../lib/body-offset'
import { pushPullBodyFace } from '../lib/body-push-pull'
import { type SweepBodyFaceResult, sweepBodyFace } from '../lib/body-sweep'
import type { TopologyRemap } from '../lib/body-topology'
import { transformBody } from '../lib/body-transform'
import { toSceneMaterialRef } from '../material-library'
import type { BodyNode } from '../schema/nodes/body'
import type { BodyGroupNode } from '../schema/nodes/body-group'
import type { ComponentNode } from '../schema/nodes/component'
import type { SceneMaterial } from '../schema/scene-material'
import type { AnyNode, AnyNodeId } from '../schema/types'
import {
  type ArrayBodyCircularInput,
  type ArrayBodyLinearInput,
  type ImprintBodyFaceInput,
  type IntersectBodiesInput,
  MODELING_OPERATION_IDS,
  type ModelingOperationRequest,
  type OffsetBodyFaceInput,
  type OuterShellBodiesInput,
  type PaintBodyFaceExecutionInput,
  type PushPullBodyFaceInput,
  type SplitBodiesInput,
  type SplitBodyFaceInput,
  type SubtractBodiesInput,
  type SweepBodyFaceInput,
  type TransformBodyInput,
  type TrimBodiesInput,
  type UnionBodiesInput,
} from './operations'

export type PushPullBodyFaceOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.pushPullBodyFace
  readonly version: 1
  readonly body: BodyNode
  readonly movedFaceId: string
  readonly createdFaceIds: readonly string[]
  readonly topologyRemap: TopologyRemap
  readonly throughCut?: true
  readonly blockingDistance?: number
}

export type ImprintBodyFaceOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.imprintBodyFace
  readonly version: 1
  readonly body: BodyNode
  readonly insetFaceId: string
  readonly extrusion: {
    readonly movedFaceId: string | null
    readonly createdFaceIds: readonly string[]
    readonly topologyRemap: TopologyRemap
    readonly throughCut?: true
    readonly blockingDistance?: number
  } | null
  readonly topologyRemap: TopologyRemap
}

export type SplitBodyFaceOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.splitBodyFace
  readonly version: 1
  readonly body: BodyNode
  readonly splitFaceId: string
  readonly topologyRemap: TopologyRemap
}

export type TransformBodyOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.transformBody
  readonly version: 1
  readonly body: BodyNode
  readonly topologyRemap: TopologyRemap
}

export type PaintBodyFaceOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.paintBodyFace
  readonly version: 1
  readonly body: BodyNode
  readonly faceId: string
  readonly material: SceneMaterial | null
  readonly materialRef: string | undefined
  readonly topologyRemap: TopologyRemap
}

export type OffsetBodyFaceOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.offsetBodyFace
  readonly version: 1
  readonly body: BodyNode
  readonly sourceFaceId: string
  readonly createdFaceId: string
  readonly topologyRemap: TopologyRemap
}

export type SweepBodyFaceOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.sweepBodyFace
  readonly version: 1
  readonly body: BodyNode
  readonly sourceFaceId: string
  readonly closed: boolean
  readonly movedFaceId: string | null
  readonly createdFaceIds: readonly string[]
  readonly topologyRemap: TopologyRemap
}

export type ArrayBodyLinearOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.arrayBodyLinear
  readonly version: 1
  readonly body: BodyNode
  readonly clones: readonly BodyNode[]
  readonly topologyRemap: TopologyRemap
}

export type ArrayBodyCircularOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.arrayBodyCircular
  readonly version: 1
  readonly body: BodyNode
  readonly clones: readonly BodyNode[]
  readonly topologyRemap: TopologyRemap
}

export type IntersectBodiesOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.intersectBodies
  readonly version: 1
  readonly body: BodyNode
  readonly toolBodyId: string
  readonly topologyRemap: TopologyRemap
}

export type UnionBodiesOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.unionBodies
  readonly version: 1
  readonly body: BodyNode
  readonly toolBodyId: string
  readonly topologyRemap: TopologyRemap
}

export type SubtractBodiesOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.subtractBodies
  readonly version: 1
  readonly body: BodyNode
  readonly toolBodyId: string
  readonly topologyRemap: TopologyRemap
}

export type OuterShellBodiesOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.outerShellBodies
  readonly version: 1
  readonly body: BodyNode
  readonly toolBodyId: string
  readonly topologyRemap: TopologyRemap
}

export type TrimBodiesOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.trimBodies
  readonly version: 1
  readonly body: BodyNode
  readonly toolBodyId: string
  readonly topologyRemap: TopologyRemap
}

export type SplitBodiesOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.splitBodies
  readonly version: 1
  readonly pieces: ReturnType<typeof splitBodies>['pieces']
  readonly toolBodyId: string
  readonly topologyRemap: TopologyRemap
}

export type GroupBodiesOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.groupBodies
  readonly version: 1
  readonly container: BodyGroupNode
  readonly bodyUpdates: ReturnType<typeof createBodyGroupFromBodies>['bodyUpdates']
}

export type CreateComponentOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.createComponent
  readonly version: 1
  readonly container: ComponentNode
  readonly bodyUpdates: ReturnType<typeof createComponentFromBodies>['bodyUpdates']
  readonly createdNodes?: readonly AnyNode[]
}

export type MakeComponentUniqueOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.makeComponentUnique
  readonly version: 1
  readonly id: string
  readonly data: ReturnType<typeof makeComponentUnique>['data']
}

export type ExplodeComponentOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.explodeComponent
  readonly version: 1
  readonly componentId: string
  readonly bodyUpdates: ReturnType<typeof explodeComponent>['bodyUpdates']
}

export type ModelingOperationResult =
  | PushPullBodyFaceOperationResult
  | ImprintBodyFaceOperationResult
  | SplitBodyFaceOperationResult
  | TransformBodyOperationResult
  | PaintBodyFaceOperationResult
  | OffsetBodyFaceOperationResult
  | SweepBodyFaceOperationResult
  | ArrayBodyLinearOperationResult
  | ArrayBodyCircularOperationResult
  | IntersectBodiesOperationResult
  | UnionBodiesOperationResult
  | SubtractBodiesOperationResult
  | OuterShellBodiesOperationResult
  | TrimBodiesOperationResult
  | SplitBodiesOperationResult
  | GroupBodiesOperationResult
  | CreateComponentOperationResult
  | MakeComponentUniqueOperationResult
  | ExplodeComponentOperationResult

function preservedTopologyRemap(body: BodyNode): TopologyRemap {
  return {
    preserved: bodyFeatureIds(body),
    created: [],
    deleted: [],
    split: {},
    merged: {},
  }
}

function topologyRemapBetweenBodies(before: BodyNode, after: BodyNode): TopologyRemap {
  const beforeIds = new Set(bodyFeatureIds(before))
  const afterIds = new Set(bodyFeatureIds(after))
  return {
    preserved: [...afterIds].filter((id) => beforeIds.has(id)),
    created: [...afterIds].filter((id) => !beforeIds.has(id)),
    deleted: [...beforeIds].filter((id) => !afterIds.has(id)),
    split: {},
    merged: {},
  }
}

function mergeTopologyRemaps(first: TopologyRemap, second: TopologyRemap): TopologyRemap {
  const created = [...new Set([...first.created, ...second.created])]
  const deleted = [...new Set([...first.deleted, ...second.deleted])]
  const preserved = [...new Set([...first.preserved, ...second.preserved])].filter(
    (id) => !deleted.includes(id),
  )
  return {
    preserved,
    created,
    deleted,
    split: { ...first.split, ...second.split },
    merged: { ...first.merged, ...second.merged },
  }
}

export function executePushPullBodyFace(
  body: BodyNode,
  input: PushPullBodyFaceInput,
): PushPullBodyFaceOperationResult {
  const result = pushPullBodyFace(body, input.faceId, input.distance)
  return {
    operation: MODELING_OPERATION_IDS.pushPullBodyFace,
    version: 1,
    body: result.body,
    movedFaceId: result.movedFaceId,
    createdFaceIds: result.createdFaceIds,
    topologyRemap: result.remap,
    throughCut: result.throughCut,
    blockingDistance: result.blockingDistance,
  }
}

export function executeImprintBodyFace(
  body: BodyNode,
  input: ImprintBodyFaceInput,
): ImprintBodyFaceOperationResult {
  const imprint = imprintBodyFace(body, input.faceId, input.profilePoints)
  if (input.distance === undefined) {
    return {
      operation: MODELING_OPERATION_IDS.imprintBodyFace,
      version: 1,
      body: imprint.body,
      insetFaceId: imprint.insetFaceId,
      extrusion: null,
      topologyRemap: imprint.remap,
    }
  }

  const extrusion = executePushPullBodyFace(imprint.body, {
    faceId: imprint.insetFaceId,
    distance: input.distance,
  })
  if (extrusion.throughCut) {
    return {
      operation: MODELING_OPERATION_IDS.imprintBodyFace,
      version: 1,
      body: extrusion.body,
      insetFaceId: imprint.insetFaceId,
      extrusion: {
        movedFaceId: null,
        createdFaceIds: extrusion.createdFaceIds,
        topologyRemap: extrusion.topologyRemap,
        throughCut: true,
        blockingDistance: extrusion.blockingDistance,
      },
      topologyRemap: extrusion.topologyRemap,
    }
  }
  return {
    operation: MODELING_OPERATION_IDS.imprintBodyFace,
    version: 1,
    body: extrusion.body,
    insetFaceId: imprint.insetFaceId,
    extrusion: {
      movedFaceId: extrusion.movedFaceId,
      createdFaceIds: extrusion.createdFaceIds,
      topologyRemap: extrusion.topologyRemap,
    },
    topologyRemap: mergeTopologyRemaps(imprint.remap, extrusion.topologyRemap),
  }
}

export function executeSplitBodyFace(
  body: BodyNode,
  input: SplitBodyFaceInput,
): SplitBodyFaceOperationResult {
  const split = splitBodyFace(body, input.faceId, input.pathPoints)
  return {
    operation: MODELING_OPERATION_IDS.splitBodyFace,
    version: 1,
    body: split.body,
    splitFaceId: split.splitFaceId,
    topologyRemap: split.remap,
  }
}

export function executeTransformBody(
  body: BodyNode,
  input: TransformBodyInput,
): TransformBodyOperationResult {
  const transformed = transformBody(body, input)
  return {
    operation: MODELING_OPERATION_IDS.transformBody,
    version: 1,
    body: transformed,
    topologyRemap: topologyRemapBetweenBodies(body, transformed),
  }
}

export function executePaintBodyFace(
  body: BodyNode,
  input: PaintBodyFaceExecutionInput,
): PaintBodyFaceOperationResult {
  if (!body.faces.some((face) => face.id === input.faceId)) {
    throw new RangeError(`Paint face not found: ${input.faceId}`)
  }

  const material =
    typeof input.material === 'string' || input.material === undefined ? null : input.material
  const materialRef =
    typeof input.material === 'string'
      ? input.material
      : input.material
        ? toSceneMaterialRef(input.material.id)
        : undefined
  const painted = {
    ...body,
    faces: body.faces.map((face) =>
      face.id === input.faceId ? { ...face, surface: { ...face.surface, materialRef } } : face,
    ),
  }
  return {
    operation: MODELING_OPERATION_IDS.paintBodyFace,
    version: 1,
    body: painted,
    faceId: input.faceId,
    material,
    materialRef,
    topologyRemap: preservedTopologyRemap(body),
  }
}

export function executeOffsetBodyFace(
  body: BodyNode,
  input: OffsetBodyFaceInput,
): OffsetBodyFaceOperationResult {
  const result = offsetBodyFace(body, input.faceId, input.distance)
  return {
    operation: MODELING_OPERATION_IDS.offsetBodyFace,
    version: 1,
    body: result.body,
    sourceFaceId: result.sourceFaceId,
    createdFaceId: result.createdFaceId,
    topologyRemap: result.topologyRemap,
  }
}

export function executeSweepBodyFace(
  body: BodyNode,
  input: SweepBodyFaceInput,
): SweepBodyFaceOperationResult {
  const result: SweepBodyFaceResult = sweepBodyFace(body, input.faceId, input.pathPoints)
  return {
    operation: MODELING_OPERATION_IDS.sweepBodyFace,
    version: 1,
    body: result.body,
    sourceFaceId: result.sourceFaceId,
    closed: result.closed,
    movedFaceId: result.movedFaceId,
    createdFaceIds: result.createdFaceIds,
    topologyRemap: result.remap,
  }
}

export function executeArrayBodyLinear(
  body: BodyNode,
  input: ArrayBodyLinearInput,
): ArrayBodyLinearOperationResult {
  return {
    operation: MODELING_OPERATION_IDS.arrayBodyLinear,
    version: 1,
    body,
    clones: createBodyLinearArray(body, input),
    topologyRemap: preservedTopologyRemap(body),
  }
}

export function executeArrayBodyCircular(
  body: BodyNode,
  input: ArrayBodyCircularInput,
): ArrayBodyCircularOperationResult {
  return {
    operation: MODELING_OPERATION_IDS.arrayBodyCircular,
    version: 1,
    body,
    clones: createBodyCircularArray(body, input),
    topologyRemap: preservedTopologyRemap(body),
  }
}

export function executeIntersectBodies(
  body: BodyNode,
  tool: BodyNode,
  input: IntersectBodiesInput,
): IntersectBodiesOperationResult {
  if (tool.id !== input.toolBodyId) {
    throw new RangeError(`Boolean tool id does not match the resolved Body: ${input.toolBodyId}`)
  }
  const result = intersectBodies(body, tool)
  return {
    operation: MODELING_OPERATION_IDS.intersectBodies,
    version: 1,
    body: result.body,
    toolBodyId: input.toolBodyId,
    topologyRemap: result.topologyRemap,
  }
}

export function executeUnionBodies(
  body: BodyNode,
  tool: BodyNode,
  input: UnionBodiesInput,
): UnionBodiesOperationResult {
  if (tool.id !== input.toolBodyId) {
    throw new RangeError(`Boolean tool id does not match the resolved Body: ${input.toolBodyId}`)
  }
  const result = unionBodies(body, tool)
  return {
    operation: MODELING_OPERATION_IDS.unionBodies,
    version: 1,
    body: result.body,
    toolBodyId: input.toolBodyId,
    topologyRemap: result.topologyRemap,
  }
}

export function executeSubtractBodies(
  body: BodyNode,
  tool: BodyNode,
  input: SubtractBodiesInput,
): SubtractBodiesOperationResult {
  if (tool.id !== input.toolBodyId) {
    throw new RangeError(`Boolean tool id does not match the resolved Body: ${input.toolBodyId}`)
  }
  const result = subtractBodies(body, tool)
  return {
    operation: MODELING_OPERATION_IDS.subtractBodies,
    version: 1,
    body: result.body,
    toolBodyId: input.toolBodyId,
    topologyRemap: result.topologyRemap,
  }
}

export function executeOuterShellBodies(
  body: BodyNode,
  tool: BodyNode,
  input: OuterShellBodiesInput,
): OuterShellBodiesOperationResult {
  if (tool.id !== input.toolBodyId) {
    throw new RangeError(
      `Outer Shell tool id does not match the resolved Body: ${input.toolBodyId}`,
    )
  }
  const result = outerShellBodies(body, tool)
  return {
    operation: MODELING_OPERATION_IDS.outerShellBodies,
    version: 1,
    body: result.body,
    toolBodyId: input.toolBodyId,
    topologyRemap: result.topologyRemap,
  }
}

export function executeTrimBodies(
  body: BodyNode,
  tool: BodyNode,
  input: TrimBodiesInput,
): TrimBodiesOperationResult {
  if (tool.id !== input.toolBodyId) {
    throw new RangeError(`Trim tool id does not match the resolved Body: ${input.toolBodyId}`)
  }
  const result = trimBodies(body, tool)
  return {
    operation: MODELING_OPERATION_IDS.trimBodies,
    version: 1,
    body: result.body,
    toolBodyId: input.toolBodyId,
    topologyRemap: result.topologyRemap,
  }
}

export function executeSplitBodies(
  body: BodyNode,
  tool: BodyNode,
  input: SplitBodiesInput,
): SplitBodiesOperationResult {
  if (tool.id !== input.toolBodyId) {
    throw new RangeError(`Split tool id does not match the resolved Body: ${input.toolBodyId}`)
  }
  const split = splitBodies(body, tool)
  const targetPiece = split.pieces.find((piece) => piece.body.id === body.id)
  if (!targetPiece) throw new RangeError('CSG split did not retain the target Body id')
  return {
    operation: MODELING_OPERATION_IDS.splitBodies,
    version: 1,
    pieces: split.pieces,
    toolBodyId: input.toolBodyId,
    topologyRemap: targetPiece.topologyRemap,
  }
}

export function executeBodyContainerOperation(
  nodes: Readonly<Record<AnyNodeId, AnyNode>>,
  node: AnyNode,
  request: ModelingOperationRequest,
):
  | GroupBodiesOperationResult
  | CreateComponentOperationResult
  | MakeComponentUniqueOperationResult
  | ExplodeComponentOperationResult {
  switch (request.operationId) {
    case MODELING_OPERATION_IDS.groupBodies: {
      const result = createBodyGroupFromBodies(nodes, request.input.bodyIds as AnyNode['id'][])
      return {
        operation: MODELING_OPERATION_IDS.groupBodies,
        version: 1,
        container: result.container as BodyGroupNode,
        bodyUpdates: result.bodyUpdates,
      }
    }
    case MODELING_OPERATION_IDS.createComponent: {
      if (request.input.sourceComponentId) {
        const result = cloneComponentInstance(
          nodes,
          request.input.sourceComponentId as AnyNode['id'],
        )
        const container = result.nodes[0]
        if (container?.type !== 'component') throw new TypeError('Cloned component is invalid')
        return {
          operation: MODELING_OPERATION_IDS.createComponent,
          version: 1,
          container,
          bodyUpdates: [],
          createdNodes: result.nodes,
        }
      }
      const result = createComponentFromBodies(nodes, request.input.bodyIds as AnyNode['id'][])
      return {
        operation: MODELING_OPERATION_IDS.createComponent,
        version: 1,
        container: result.container as ComponentNode,
        bodyUpdates: result.bodyUpdates,
        createdNodes: [],
      }
    }
    case MODELING_OPERATION_IDS.makeComponentUnique: {
      const result = makeComponentUnique(nodes, node.id)
      return {
        operation: MODELING_OPERATION_IDS.makeComponentUnique,
        version: 1,
        id: result.id,
        data: result.data,
      }
    }
    case MODELING_OPERATION_IDS.explodeComponent: {
      const result = explodeComponent(nodes, node.id)
      return {
        operation: MODELING_OPERATION_IDS.explodeComponent,
        version: 1,
        componentId: result.componentId,
        bodyUpdates: result.bodyUpdates,
      }
    }
    default:
      throw new RangeError(`Unsupported Body container operation: ${request.operationId}`)
  }
}

export function executeModelingOperation(
  body: AnyNode,
  request: ModelingOperationRequest,
  resolveBody?: (id: string) => AnyNode | null | undefined,
): ModelingOperationResult {
  if (
    request.operationId === MODELING_OPERATION_IDS.groupBodies ||
    request.operationId === MODELING_OPERATION_IDS.createComponent ||
    request.operationId === MODELING_OPERATION_IDS.makeComponentUnique ||
    request.operationId === MODELING_OPERATION_IDS.explodeComponent
  ) {
    const containerNodes: Record<AnyNodeId, AnyNode> = { [body.id]: body }
    for (const id of request.operationId === MODELING_OPERATION_IDS.groupBodies
      ? request.input.bodyIds
      : request.operationId === MODELING_OPERATION_IDS.createComponent
        ? (request.input.bodyIds ??
          (request.input.sourceComponentId ? [request.input.sourceComponentId] : []))
        : []) {
      const resolved = resolveBody?.(id)
      if (resolved) containerNodes[id as AnyNodeId] = resolved
    }
    return executeBodyContainerOperation(containerNodes, body, request)
  }
  if (body.type !== 'body') throw new TypeError('Body modeling operation requires a Body node')
  switch (request.operationId) {
    case MODELING_OPERATION_IDS.pushPullBodyFace:
      return executePushPullBodyFace(body, request.input)
    case MODELING_OPERATION_IDS.imprintBodyFace:
      return executeImprintBodyFace(body, request.input)
    case MODELING_OPERATION_IDS.splitBodyFace:
      return executeSplitBodyFace(body, request.input)
    case MODELING_OPERATION_IDS.transformBody:
      return executeTransformBody(body, request.input)
    case MODELING_OPERATION_IDS.paintBodyFace:
      return executePaintBodyFace(body, request.input)
    case MODELING_OPERATION_IDS.offsetBodyFace:
      return executeOffsetBodyFace(body, request.input)
    case MODELING_OPERATION_IDS.sweepBodyFace:
      return executeSweepBodyFace(body, request.input)
    case MODELING_OPERATION_IDS.arrayBodyLinear:
      return executeArrayBodyLinear(body, request.input)
    case MODELING_OPERATION_IDS.arrayBodyCircular:
      return executeArrayBodyCircular(body, request.input)
    case MODELING_OPERATION_IDS.intersectBodies: {
      const tool = resolveBody?.(request.input.toolBodyId)
      if (tool?.type !== 'body')
        throw new RangeError(`Boolean tool Body not found: ${request.input.toolBodyId}`)
      return executeIntersectBodies(body, tool, request.input)
    }
    case MODELING_OPERATION_IDS.unionBodies: {
      const tool = resolveBody?.(request.input.toolBodyId)
      if (tool?.type !== 'body')
        throw new RangeError(`Boolean tool Body not found: ${request.input.toolBodyId}`)
      return executeUnionBodies(body, tool, request.input)
    }
    case MODELING_OPERATION_IDS.subtractBodies: {
      const tool = resolveBody?.(request.input.toolBodyId)
      if (tool?.type !== 'body')
        throw new RangeError(`Boolean tool Body not found: ${request.input.toolBodyId}`)
      return executeSubtractBodies(body, tool, request.input)
    }
    case MODELING_OPERATION_IDS.outerShellBodies: {
      const tool = resolveBody?.(request.input.toolBodyId)
      if (tool?.type !== 'body')
        throw new RangeError(`Outer Shell tool Body not found: ${request.input.toolBodyId}`)
      return executeOuterShellBodies(body, tool, request.input)
    }
    case MODELING_OPERATION_IDS.trimBodies: {
      const tool = resolveBody?.(request.input.toolBodyId)
      if (tool?.type !== 'body')
        throw new RangeError(`Trim tool Body not found: ${request.input.toolBodyId}`)
      return executeTrimBodies(body, tool, request.input)
    }
    case MODELING_OPERATION_IDS.splitBodies: {
      const tool = resolveBody?.(request.input.toolBodyId)
      if (tool?.type !== 'body')
        throw new RangeError(`Split tool Body not found: ${request.input.toolBodyId}`)
      return executeSplitBodies(body, tool, request.input)
    }
    default: {
      throw new RangeError('Unsupported modeling operation')
    }
  }
}

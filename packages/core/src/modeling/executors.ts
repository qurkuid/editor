import { imprintBodyFace } from '../lib/body-imprint'
import { bodyFeatureIds } from '../lib/body-imprint-helpers'
import { offsetBodyFace } from '../lib/body-offset'
import { pushPullBodyFace } from '../lib/body-push-pull'
import { type SweepBodyFaceResult, sweepBodyFace } from '../lib/body-sweep'
import type { TopologyRemap } from '../lib/body-topology'
import { transformBody } from '../lib/body-transform'
import { toSceneMaterialRef } from '../material-library'
import type { BodyNode } from '../schema/nodes/body'
import type { SceneMaterial } from '../schema/scene-material'
import {
  type ImprintBodyFaceInput,
  MODELING_OPERATION_IDS,
  type ModelingOperationRequest,
  type OffsetBodyFaceInput,
  type PaintBodyFaceExecutionInput,
  type PushPullBodyFaceInput,
  type SweepBodyFaceInput,
  type TransformBodyInput,
} from './operations'

export type PushPullBodyFaceOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.pushPullBodyFace
  readonly version: 1
  readonly body: BodyNode
  readonly movedFaceId: string
  readonly createdFaceIds: readonly string[]
  readonly topologyRemap: TopologyRemap
}

export type ImprintBodyFaceOperationResult = {
  readonly operation: typeof MODELING_OPERATION_IDS.imprintBodyFace
  readonly version: 1
  readonly body: BodyNode
  readonly insetFaceId: string
  readonly extrusion: {
    readonly movedFaceId: string
    readonly createdFaceIds: readonly string[]
    readonly topologyRemap: TopologyRemap
  } | null
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

export type ModelingOperationResult =
  | PushPullBodyFaceOperationResult
  | ImprintBodyFaceOperationResult
  | TransformBodyOperationResult
  | PaintBodyFaceOperationResult
  | OffsetBodyFaceOperationResult
  | SweepBodyFaceOperationResult

function preservedTopologyRemap(body: BodyNode): TopologyRemap {
  return {
    preserved: bodyFeatureIds(body),
    created: [],
    deleted: [],
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

export function executeTransformBody(
  body: BodyNode,
  input: TransformBodyInput,
): TransformBodyOperationResult {
  const transformed = transformBody(body, input)
  return {
    operation: MODELING_OPERATION_IDS.transformBody,
    version: 1,
    body: transformed,
    topologyRemap: preservedTopologyRemap(body),
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

export function executeModelingOperation(
  body: BodyNode,
  request: ModelingOperationRequest,
): ModelingOperationResult {
  switch (request.operationId) {
    case MODELING_OPERATION_IDS.pushPullBodyFace:
      return executePushPullBodyFace(body, request.input)
    case MODELING_OPERATION_IDS.imprintBodyFace:
      return executeImprintBodyFace(body, request.input)
    case MODELING_OPERATION_IDS.transformBody:
      return executeTransformBody(body, request.input)
    case MODELING_OPERATION_IDS.paintBodyFace:
      return executePaintBodyFace(body, request.input)
    case MODELING_OPERATION_IDS.offsetBodyFace:
      return executeOffsetBodyFace(body, request.input)
    case MODELING_OPERATION_IDS.sweepBodyFace:
      return executeSweepBodyFace(body, request.input)
    default: {
      const unreachable: never = request
      throw new RangeError(`Unsupported modeling operation: ${String(unreachable)}`)
    }
  }
}

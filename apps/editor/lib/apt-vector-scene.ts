import {
  type CeilingNode as CeilingNodeType,
  createDefaultWallFaceBands,
  DEFAULT_WALL_THICKNESS,
  DoorNode,
  detectSpacesForLevel,
  type GuideNode as GuideNodeType,
  getWallConstructionEnvelopeThickness,
  planAutoCeilingsForLevel,
  planAutoSlabsForLevel,
  planAutoZonesForLevel,
  type SlabNode as SlabNodeType,
  WallNode,
  WindowNode,
  ZoneNode,
} from '@pascal-app/core'
import { getAptGuideTransformError } from './apt-import-frame'

/** JSON document produced by the floorplan-vectorizer CLI (`--stdout`). */
export type AptVectorDoc = {
  unit: 'mm' | 'px'
  docVersion?: number
  imageSize: [number, number]
  mmPerPx: number | null
  walls: {
    id: string
    kind: 'exterior' | 'interior'
    start: [number, number]
    end: [number, number]
    thickness: number
  }[]
  openings: {
    id: string
    type: 'door' | 'window' | 'opening'
    a: [number, number]
    b: [number, number]
    wallThickness: number
    src?: 'pair' | 'ray' | 'boundary' | 'fixture-split' | 'frame'
    hinge?: [number, number]
    radius?: number
    /** Wider source barriers are room-extraction evidence, never render geometry. */
    barrierA?: [number, number]
    barrierB?: [number, number]
    barrierThickness?: number | null
  }[]
  rooms: {
    id: string
    name: string | null
    cls: string
    areaM2: number | null
    polygon?: [number, number][]
  }[]
  metrics?: { style?: string; wallIoU?: number }
}

export type VectorDiagnostics = {
  /** doc opening ids that never got hosted on a wall (no flank, too small). */
  unhostedOpeningIds: string[]
  /** doc opening ids suppressed as duplicate detections of a kept opening. */
  dedupedOpeningIds: string[]
  /** doc wall ids filtered out for being shorter than the minimum length. */
  droppedWallIds: string[]
}

export type VectorSceneNodes = {
  /** Parsed wall nodes; children/parentId linking is the caller's job. */
  walls: WallNode[]
  /** Wall-hosted doors/windows/openings; `wallId` names the host wall. */
  openings: (DoorNode | WindowNode)[]
  /** Room zones (OCR label + polygon) for space documentation. */
  zones: ZoneNode[]
  /** Initial closed-room floor surfaces derived from the final wall frame. */
  slabs: SlabNodeType[]
  /** Initial closed-room ceiling surfaces derived from the final wall frame. */
  ceilings: CeilingNodeType[]
  /** guide.scale that makes the 10 m guide plane match the plan's real size. */
  guideScale: number
  /** What the conversion left out — the debug viewer's defect layer. */
  diagnostics: VectorDiagnostics
}

/** Optional image orientation and guide pose applied after vector extraction. */
export type AptPlanImportFrame = {
  readonly flipX?: boolean
  readonly flipY?: boolean
  readonly position?: readonly [number, number, number]
  readonly rotationY?: number
  /** World guide scale. The extracted scene's derived guide scale is the base. */
  readonly scale?: number
}

export type AptVectorGuideContext = {
  guide: GuideNodeType
  levelId: string
  apartmentId: string
  planId: string
}

/**
 * Selects a strict same-plan guide without guessing when duplicate references
 * are present. An explicit current selection wins; otherwise exactly one
 * candidate is required for the calibration recovery path.
 */
export function selectAptGuideForCalibration(
  guides: readonly GuideNodeType[],
  selectedReferenceId: string | null,
): GuideNodeType | null {
  if (selectedReferenceId) {
    const selected = guides.find((guide) => guide.id === selectedReferenceId)
    if (selected) return selected
  }
  return guides.length === 1 ? guides[0]! : null
}

/**
 * Keeps the established guide lookup for millimetre imports; strict same-plan
 * identity is required only for pixel recovery.
 */
export function selectAptGuideForImport(
  candidateGuide: GuideNodeType | null,
  strictGuide: GuideNodeType | null,
  isPixelVector: boolean,
): GuideNodeType | null {
  return isPixelVector ? strictGuide : candidateGuide
}

export type AptVectorScaleCalibration = {
  source: 'guide-reference'
  guideId: string
  levelId: string
  apartmentId: string
  planId: string
  guideScale: number
  mmPerPx: number
  reference: {
    start: [number, number]
    end: [number, number]
    realLengthMeters: number
    measuredLengthUnits: number
    metersPerUnit: number
    label: string
  }
}

export type AptVectorNormalizationFailureCode =
  | 'invalid-mm-scale'
  | 'ambiguous-units'
  | 'guide-required'
  | 'guide-identity-mismatch'
  | 'missing-scale-reference'
  | 'invalid-guide-transform'
  | 'invalid-scale-reference'
  | 'inconsistent-scale-reference'
  | 'invalid-pixel-document'

export type AptVectorNormalizationResult =
  | { ok: true; doc: AptVectorDoc; calibration: AptVectorScaleCalibration | null }
  | {
      ok: false
      code: AptVectorNormalizationFailureCode
      message: string
    }

export const APT_GUIDE_SCALE_RECOVERY_MESSAGE =
  '도면 배율을 확인할 수 없습니다. 현재 씬에 깔기 → 밑그림 선택 → Set Scale → 자동 모델링 재시도'
export const APT_VECTOR_DOCUMENT_ERROR_MESSAGE =
  '도면 분석 결과가 유효하지 않습니다. 원본 도면을 확인한 뒤 다시 시도해 주세요.'

const CALIBRATION_EPSILON = 1e-6

/**
 * Converts a pixel vector document only when the active, same-plan guide
 * carries a physically consistent Set Scale reference. Automatic OCR scale
 * calibration remains the source of truth for documents that already carry
 * `mmPerPx`; this helper is an explicit user-calibration recovery path.
 */
export function normalizeAptVectorDocForGuide(
  doc: AptVectorDoc,
  context: AptVectorGuideContext | null = null,
): AptVectorNormalizationResult {
  if (doc.unit === 'mm') {
    const mmPerPx = doc.mmPerPx
    if (typeof mmPerPx !== 'number' || !Number.isFinite(mmPerPx) || mmPerPx <= 0) {
      return normalizationFailure('invalid-mm-scale')
    }
    return { ok: true, doc, calibration: null }
  }
  if (doc.unit !== 'px') return normalizationFailure('ambiguous-units')
  if (doc.mmPerPx !== null) return normalizationFailure('ambiguous-units')
  if (
    !Array.isArray(doc.imageSize) ||
    !isPositiveFinite(doc.imageSize[0]) ||
    !isPositiveFinite(doc.imageSize[1])
  ) {
    return normalizationFailure('invalid-pixel-document')
  }
  if (!context) return normalizationFailure('guide-required')

  const metadata = metadataRecord(context.guide.metadata)
  if (
    context.guide.parentId !== context.levelId ||
    metadata.apartmentId !== context.apartmentId ||
    metadata.planId !== context.planId
  ) {
    return normalizationFailure('guide-identity-mismatch')
  }
  const transformError = getAptGuideTransformError(context.guide)
  if (transformError || context.guide.position.some((component) => !Number.isFinite(component))) {
    return normalizationFailure('invalid-guide-transform')
  }
  if (!context.guide.scaleReference) return normalizationFailure('missing-scale-reference')
  const reference = context.guide.scaleReference
  if (
    !isFiniteVec2(reference.start) ||
    !isFiniteVec2(reference.end) ||
    !isPositiveFinite(context.guide.scale) ||
    !isPositiveFinite(reference.realLengthMeters) ||
    !isPositiveFinite(reference.measuredLengthUnits) ||
    !isPositiveFinite(reference.metersPerUnit) ||
    typeof reference.label !== 'string'
  ) {
    return normalizationFailure('invalid-scale-reference')
  }
  const measuredDistance = Math.hypot(
    reference.end[0] - reference.start[0],
    reference.end[1] - reference.start[1],
  )
  if (
    !approximatelyEqual(measuredDistance, reference.measuredLengthUnits) ||
    !approximatelyEqual(
      reference.realLengthMeters / reference.measuredLengthUnits,
      reference.metersPerUnit,
    ) ||
    !approximatelyEqual(reference.realLengthMeters, reference.measuredLengthUnits) ||
    !approximatelyEqual(reference.metersPerUnit, 1)
  ) {
    return normalizationFailure('inconsistent-scale-reference')
  }

  const mmPerPx = (context.guide.scale * 10000) / doc.imageSize[0]
  if (!isPositiveFinite(mmPerPx)) return normalizationFailure('invalid-scale-reference')
  const scaledPoint = (point: readonly number[]): Vec2 | null => {
    if (!isFiniteVec2(point)) return null
    const scaled: Vec2 = [point[0] * mmPerPx, point[1] * mmPerPx]
    return scaled.every(Number.isFinite) ? scaled : null
  }
  const scaleNumber = (value: number): number | null =>
    Number.isFinite(value) && Number.isFinite(value * mmPerPx) ? value * mmPerPx : null
  const walls = doc.walls.map((wall) => {
    const start = scaledPoint(wall.start)
    const end = scaledPoint(wall.end)
    const thickness = scaleNumber(wall.thickness)
    if (!start || !end || thickness === null) return null
    return { ...wall, start, end, thickness }
  })
  const openings = doc.openings.map((opening) => {
    const a = scaledPoint(opening.a)
    const b = scaledPoint(opening.b)
    const wallThickness = scaleNumber(opening.wallThickness)
    if (!a || !b || wallThickness === null) return null
    const hinge = opening.hinge ? scaledPoint(opening.hinge) : undefined
    const barrierA = opening.barrierA ? scaledPoint(opening.barrierA) : undefined
    const barrierB = opening.barrierB ? scaledPoint(opening.barrierB) : undefined
    const radius = opening.radius === undefined ? undefined : scaleNumber(opening.radius)
    const barrierThickness =
      opening.barrierThickness === undefined || opening.barrierThickness === null
        ? opening.barrierThickness
        : scaleNumber(opening.barrierThickness)
    if (
      (opening.hinge && !hinge) ||
      (opening.barrierA && !barrierA) ||
      (opening.barrierB && !barrierB) ||
      (opening.radius !== undefined && radius === null) ||
      (opening.barrierThickness !== undefined &&
        opening.barrierThickness !== null &&
        barrierThickness === null)
    )
      return null
    return {
      ...opening,
      a,
      b,
      wallThickness,
      ...(opening.hinge ? { hinge } : {}),
      ...(opening.radius !== undefined ? { radius } : {}),
      ...(opening.barrierA ? { barrierA } : {}),
      ...(opening.barrierB ? { barrierB } : {}),
      ...(opening.barrierThickness !== undefined ? { barrierThickness } : {}),
    }
  })
  const rooms = doc.rooms.map((room) => {
    if (!room.polygon) return room
    const polygon = room.polygon.map(scaledPoint)
    return polygon.every((point): point is Vec2 => point !== null) ? { ...room, polygon } : null
  })
  if (walls.some((wall) => wall === null) || openings.some((opening) => opening === null)) {
    return normalizationFailure('invalid-pixel-document')
  }
  if (rooms.some((room) => room === null)) return normalizationFailure('invalid-pixel-document')

  const normalized: AptVectorDoc = {
    ...doc,
    unit: 'mm',
    mmPerPx,
    walls: walls as AptVectorDoc['walls'],
    openings: openings as AptVectorDoc['openings'],
    rooms: rooms as AptVectorDoc['rooms'],
  }
  return {
    ok: true,
    doc: normalized,
    calibration: {
      source: 'guide-reference',
      guideId: context.guide.id,
      levelId: context.levelId,
      apartmentId: context.apartmentId,
      planId: context.planId,
      guideScale: context.guide.scale,
      mmPerPx,
      reference: {
        start: [...reference.start],
        end: [...reference.end],
        realLengthMeters: reference.realLengthMeters,
        measuredLengthUnits: reference.measuredLengthUnits,
        metersPerUnit: reference.metersPerUnit,
        label: reference.label,
      },
    },
  }
}

function normalizationFailure(code: AptVectorNormalizationFailureCode) {
  const calibrationFailure =
    code === 'guide-required' ||
    code === 'guide-identity-mismatch' ||
    code === 'missing-scale-reference' ||
    code === 'invalid-guide-transform' ||
    code === 'invalid-scale-reference' ||
    code === 'inconsistent-scale-reference'
  return {
    ok: false as const,
    code,
    message: calibrationFailure
      ? APT_GUIDE_SCALE_RECOVERY_MESSAGE
      : APT_VECTOR_DOCUMENT_ERROR_MESSAGE,
  }
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function isPositiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0
}

function approximatelyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= CALIBRATION_EPSILON * Math.max(1, Math.abs(a), Math.abs(b))
}

const MIN_WALL_LENGTH_M = 0.12
const FLANK_LATERAL_M = 0.25
const FLANK_ALONG_M = 0.45
const SNAP_CORNER_M = 0.3
const SNAP_TEE_LATERAL_M = 0.35
const SNAP_COLLINEAR_M = 0.6
const SNAP_MAX_MOVE_M = 0.6
const MERGE_THICKNESS_TOL_M = 0.08
const MERGE_RUN_GAP_M = 0.35
const SOURCE_ENDPOINT_EPS_M = 1e-6
const OPENING_OVERLAP_FRAC = 0.3
const DOOR_HEIGHT_M = 2.1
const WINDOW_HEIGHT_M = 1.5
const WINDOW_SILL_M = 0.9

const ROOM_NAME_KO: Record<string, string> = {
  bedroom: '방',
  living: '거실',
  kitchen: '주방',
  bath: '욕실',
  balcony: '발코니',
  entrance: '현관',
  dress: '드레스룸',
  storage: '창고',
  utility: '다용도실',
  study: '서재',
  hall: '복도',
  shelter: '대피공간',
  elevator: '코어',
}

const ROOM_COLOR: Record<string, string> = {
  bedroom: '#c98f4e',
  living: '#8f8878',
  kitchen: '#a09a8b',
  bath: '#6fa7c7',
  balcony: '#b0a468',
  entrance: '#9b8f7f',
  dress: '#b08d55',
  storage: '#8d8577',
  utility: '#8d8577',
}

type Vec2 = [number, number]
type SourceEndpointName = 'start' | 'end'
type SourceEndpointRef = { index: number; endpoint: SourceEndpointName }
type RetainedSourceChain = {
  outerA: SourceEndpointRef
  bridgeA: SourceEndpointRef
  bridgeC: SourceEndpointRef
  outerC: SourceEndpointRef
  outerAPoint: Vec2
  outerCPoint: Vec2
}
type HeldSourceEndpoint = {
  relationId: number
  relation: RetainedSourceChain
  relationKey: string
  side: 'outer-a' | 'outer-c'
  point: Vec2
  owners: number[]
}
type SourceChainRelationSide = {
  relationId: number
  relation: RetainedSourceChain
  relationKey: string
  side: 'outer-a' | 'outer-c'
  point: Vec2
  owners: number[]
}
type Seg = {
  start: Vec2
  end: Vec2
  th: number
  sourceIndices?: number[]
  heldEndpoints?: { start: HeldSourceEndpoint[]; end: HeldSourceEndpoint[] }
  /** A source-backed opening host is materialized after source unions and
   * remains fixed while the ordinary junction passes run. */
  openingHostOnly?: boolean
}
type CrossingExtension = { index: number; end: 'start' | 'end'; point: Vec2 }
type CrossingExtensionPlan = { start: Vec2; end: Vec2; extensions: CrossingExtension[] }
type OpeningDocument = AptVectorDoc['openings'][number]
type OpeningPlacement = { doc: OpeningDocument; group: number; width: number; exactSpan?: boolean }
type DualJambOpeningCluster = {
  winner: OpeningDocument
  losers: OpeningDocument[]
  start: Vec2
  end: Vec2
  thickness: number
}

/**
 * Maps a vectorizer document (mm, image-origin top-left) into scene nodes
 * (metres, level origin at the plan center — matching a guide node placed at
 * [0,0,0] with the returned `guideScale`).
 *
 * The vectorizer emits openings as GAPS between wall segments; the editor
 * hosts doors/windows INSIDE a continuous wall (`cut-opening` model). So the
 * collinear walls flanking each gap are merged into one wall spanning the
 * opening, and the opening is then hosted wall-locally on the merged wall.
 * A junction-snap pass then closes the remaining corner/tee gaps (extending
 * each wall along its own axis, so directions are preserved and enclosed
 * spaces actually close), and the vectorizer's labeled room polygons become
 * room zones.
 *
 * Returns null when the document is not trustworthy enough to auto-model
 * (no scale, degraded render variant, or too few walls) so callers can fall
 * back to the plain guide flow.
 */
export function buildVectorNodes(
  doc: AptVectorDoc,
  frame: AptPlanImportFrame = {},
  surfaceContext: {
    existingSlabs?: SlabNodeType[]
    existingCeilings?: CeilingNodeType[]
  } = {},
): VectorSceneNodes | null {
  if (!isValidAptPlanImportFrame(frame)) return null
  if (doc.unit !== 'mm' || !doc.mmPerPx || doc.mmPerPx <= 0) return null
  if (
    doc.metrics?.style === 'wood-dense' &&
    !(
      (doc.metrics.wallIoU ?? 0) >= 0.7 &&
      doc.rooms.length > 0 &&
      doc.rooms.filter((room) => room.name && room.polygon && room.polygon.length >= 3).length /
        doc.rooms.length >=
        0.8
    )
  )
    return null

  const [imageW, imageH] = doc.imageSize
  const sourceGuideScale = (imageW * doc.mmPerPx) / 10000
  const frameScale = frame.scale === undefined ? 1 : frame.scale / sourceGuideScale
  const generatedWallThickness = DEFAULT_WALL_THICKNESS / frameScale
  const cx = (imageW * doc.mmPerPx) / 2
  const cy = (imageH * doc.mmPerPx) / 2
  const toLevel = ([x, y]: Vec2): Vec2 => [(x - cx) / 1000, (y - cy) / 1000]

  const droppedWallIds: string[] = []
  // Keep a separate immutable footprint array for the source-backed opening
  // finder. The ordinary importer clamps wall thickness and drops short
  // fragments for output, but those derived values must not invent jamb
  // support or hide a raw passage pier from the source proof.
  const originalSourceSegs: Seg[] = []
  const segs: Seg[] = []
  for (const wall of doc.walls) {
    if (
      isFiniteVec2(wall.start) &&
      isFiniteVec2(wall.end) &&
      Number.isFinite(wall.thickness) &&
      wall.thickness > 0
    ) {
      const rawStart = toLevel(wall.start)
      const rawEnd = toLevel(wall.end)
      const rawLength = Math.hypot(rawEnd[0] - rawStart[0], rawEnd[1] - rawStart[1])
      if (rawLength > SOURCE_ENDPOINT_EPS_M) {
        originalSourceSegs.push({
          start: rawStart,
          end: rawEnd,
          th: wall.thickness / 1000,
        })
      }
    }
    if (!isFiniteVec2(wall.start) || !isFiniteVec2(wall.end) || !Number.isFinite(wall.thickness)) {
      droppedWallIds.push(wall.id)
      continue
    }
    const start = toLevel(wall.start)
    const end = toLevel(wall.end)
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) < MIN_WALL_LENGTH_M) {
      droppedWallIds.push(wall.id)
      continue
    }
    const sourceIndex = segs.length
    segs.push({
      start,
      end,
      th: clamp(wall.thickness / 1000, 0.05, 0.6),
      sourceIndices: [sourceIndex],
    })
  }
  if (segs.length < 3) return null

  // Opening placement is allowed to union or extend ordinary segments, so the
  // finder always reads the raw source footprint array above.
  const dualJambCluster = findDualJambSupportedFullSpan(doc.openings, originalSourceSegs, toLevel)
  const dualJambOpeningIds = new Set(
    dualJambCluster
      ? [dualJambCluster.winner.id, ...dualJambCluster.losers.map((opening) => opening.id)]
      : [],
  )

  // Union-find over wall segments; every opening unions its two collinear
  // flanks (or extends its single flank across the gap for corner doors).
  const parent = segs.map((_, i) => i)
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]!]!
      i = parent[i]!
    }
    return i
  }
  const groupMembers = new Map<number, Set<number>>()
  segs.forEach((_, index) => {
    groupMembers.set(index, new Set([index]))
  })
  // The vectorizer splits one physical wall run into several segments (and
  // occasionally traces a thick wall twice, slightly offset). Merge same-run
  // segments up front so one wall face comes out as ONE wall node instead of
  // seam-touching fragments. Different-thickness continuations stay separate
  // walls and are only end-snapped later.
  const sourceEndpointPairs = buildSourceEndpointPairIndex(segs)
  const sourceChainRelations: RetainedSourceChain[] = []
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (!isSameWallRun(segs[i]!, segs[j]!)) continue
      const chain = findRetainedSourceChain(i, j, segs, sourceEndpointPairs)
      if (chain) sourceChainRelations.push(...chain.relations)
    }
  }

  // Keep the relation block keyed by current DSU roots. Re-key only the
  // relation ids attached to the root that moves during a successful union;
  // this avoids scanning every relation for every candidate pair.
  const relationIdsByRoot = new Map<number, Set<number>>()
  const blockedSourceChainRootPairs = new Set<string>()
  const supersededSourceChainRelationIds = new Set<number>()
  const relationSidesBySourceIndex = new Map<number, SourceChainRelationSide[]>()
  for (let relationId = 0; relationId < sourceChainRelations.length; relationId++) {
    const relation = sourceChainRelations[relationId]!
    const relationKey = sourceChainRelationKey(relation)
    const sides: SourceChainRelationSide[] = [
      {
        relationId,
        relation,
        relationKey,
        side: 'outer-a',
        point: [...relation.outerAPoint],
        owners: [relation.outerA.index, relation.bridgeA.index],
      },
      {
        relationId,
        relation,
        relationKey,
        side: 'outer-c',
        point: [...relation.outerCPoint],
        owners: [relation.outerC.index, relation.bridgeC.index],
      },
    ]
    for (const side of sides) {
      for (const owner of side.owners) {
        const indexed = relationSidesBySourceIndex.get(owner) ?? []
        indexed.push(side)
        relationSidesBySourceIndex.set(owner, indexed)
      }
    }
    const outerARoot = find(relation.outerA.index)
    const outerCRoot = find(relation.outerC.index)
    const firstRelations = relationIdsByRoot.get(outerARoot) ?? new Set<number>()
    firstRelations.add(relationId)
    relationIdsByRoot.set(outerARoot, firstRelations)
    const secondRelations = relationIdsByRoot.get(outerCRoot) ?? new Set<number>()
    secondRelations.add(relationId)
    relationIdsByRoot.set(outerCRoot, secondRelations)
    if (outerARoot !== outerCRoot)
      blockedSourceChainRootPairs.add(sourceChainRootPairKey(outerARoot, outerCRoot))
  }

  type UnionReason = 'same-run-normalization' | 'opening-host'
  type UnionResult =
    | { ok: true }
    | { ok: false; reason: 'retained-chain' | 'held-contact-unrepresentable' }

  const projectedGroup = (
    members: readonly number[],
    extra: readonly Vec2[] = [],
    segmentOverrides?: ReadonlyMap<number, Seg>,
  ) => {
    const segmentAt = (index: number): Seg => segmentOverrides?.get(index) ?? segs[index]!
    const longest = members.reduce((best, index) =>
      segLen(segmentAt(index)) > segLen(segmentAt(best)) ? index : best,
    )
    const reference = segmentAt(longest)
    const length = segLen(reference)
    const direction: Vec2 = [
      (reference.end[0] - reference.start[0]) / length,
      (reference.end[1] - reference.start[1]) / length,
    ]
    const points = members.flatMap((index) => {
      const segment = segmentAt(index)
      return [segment.start, segment.end]
    })
    points.push(...extra)
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const point of points) {
      const at = along(point, reference.start, direction)
      lo = Math.min(lo, at)
      hi = Math.max(hi, at)
    }
    return { anchor: reference.start, direction, lo, hi }
  }

  const heldContactsForMembers = (
    members: readonly number[],
    extra: readonly Vec2[] = [],
    excludedRelationIds: ReadonlySet<number> = supersededSourceChainRelationIds,
    segmentOverrides?: ReadonlyMap<number, Seg>,
  ):
    | { ok: true; contacts: HeldSourceEndpoint[]; projection: ReturnType<typeof projectedGroup> }
    | { ok: false } => {
    if (members.length === 0) return { ok: false }
    const projection = projectedGroup(members, extra, segmentOverrides)
    const owned = new Set(members)
    const contacts = new Map<string, HeldSourceEndpoint>()
    for (const member of members) {
      for (const side of relationSidesBySourceIndex.get(member) ?? []) {
        if (excludedRelationIds.has(side.relationId)) continue
        const markerKey = `${side.relationId}:${side.side}`
        if (contacts.has(markerKey)) continue
        const at = along(side.point, projection.anchor, projection.direction)
        const atStart = Math.abs(at - projection.lo) <= SOURCE_ENDPOINT_EPS_M
        const atEnd = Math.abs(at - projection.hi) <= SOURCE_ENDPOINT_EPS_M
        if (atStart === atEnd) return { ok: false }
        if (!side.owners.some((owner) => owned.has(owner))) continue
        contacts.set(markerKey, {
          relationId: side.relationId,
          relation: side.relation,
          relationKey: side.relationKey,
          side: side.side,
          point: [...side.point],
          owners: [...side.owners],
        })
      }
    }
    const byEnd = { start: [] as HeldSourceEndpoint[], end: [] as HeldSourceEndpoint[] }
    for (const contact of contacts.values()) {
      const at = along(contact.point, projection.anchor, projection.direction)
      const end = Math.abs(at - projection.lo) <= SOURCE_ENDPOINT_EPS_M ? 'start' : 'end'
      byEnd[end].push(contact)
    }
    for (const candidates of [byEnd.start, byEnd.end]) {
      for (let i = 0; i < candidates.length; i++) {
        for (let j = i + 1; j < candidates.length; j++) {
          if (!sourcePointsMatch(candidates[i]!.point, candidates[j]!.point)) return { ok: false }
        }
      }
    }
    return { ok: true, contacts: [...contacts.values()], projection }
  }

  const crossingExtensionRepresentable = (plan: CrossingExtensionPlan): boolean => {
    if (plan.extensions.length === 0) return true
    const overrides = new Map<number, Seg>()
    const extensionsByRoot = new Map<number, CrossingExtension[]>()
    for (const extension of plan.extensions) {
      const root = find(extension.index)
      const existing = overrides.get(extension.index) ?? segs[extension.index]!
      const copy: Seg = overrides.get(extension.index) ?? {
        ...existing,
        start: [...existing.start],
        end: [...existing.end],
      }
      copy[extension.end] = [...extension.point]
      overrides.set(extension.index, copy)
      const rootExtensions = extensionsByRoot.get(root) ?? []
      rootExtensions.push(extension)
      extensionsByRoot.set(root, rootExtensions)
    }
    for (const [root, rootExtensions] of extensionsByRoot) {
      const members = groupMembers.get(root)
      if (!members) return false
      const heldCheck = heldContactsForMembers(
        [...members],
        rootExtensions.map((extension) => extension.point),
        supersededSourceChainRelationIds,
        overrides,
      )
      if (!heldCheck.ok) return false
    }
    return true
  }

  const relationIdsForRootPair = (firstRoot: number, secondRoot: number): number[] => {
    const firstRelations = relationIdsByRoot.get(firstRoot)
    const secondRelations = relationIdsByRoot.get(secondRoot)
    if (!firstRelations || !secondRelations) return []
    const smaller = firstRelations.size <= secondRelations.size ? firstRelations : secondRelations
    const larger = smaller === firstRelations ? secondRelations : firstRelations
    const pair = sourceChainRootPairKey(firstRoot, secondRoot)
    return [...smaller].filter((relationId) => {
      if (!larger.has(relationId) || supersededSourceChainRelationIds.has(relationId)) return false
      const relation = sourceChainRelations[relationId]!
      return (
        sourceChainRootPairKey(find(relation.outerA.index), find(relation.outerC.index)) === pair
      )
    })
  }

  const union = (i: number, j: number, reason: UnionReason): UnionResult => {
    const firstRoot = find(i)
    const secondRoot = find(j)
    if (firstRoot === secondRoot) return { ok: true }
    const rootPair = sourceChainRootPairKey(firstRoot, secondRoot)
    const openingConflicts =
      reason === 'opening-host' ? relationIdsForRootPair(firstRoot, secondRoot) : []
    const blocked = blockedSourceChainRootPairs.has(rootPair)
    if (reason === 'opening-host' && openingConflicts.length > 1) {
      return { ok: false, reason: 'retained-chain' }
    }
    if (blocked && (reason !== 'opening-host' || openingConflicts.length !== 1)) {
      return { ok: false, reason: 'retained-chain' }
    }
    let movingRoot = firstRoot
    let retainedRoot = secondRoot
    const firstRelations = relationIdsByRoot.get(firstRoot)
    const secondRelations = relationIdsByRoot.get(secondRoot)
    if ((firstRelations?.size ?? 0) > (secondRelations?.size ?? 0)) {
      movingRoot = secondRoot
      retainedRoot = firstRoot
    }
    const firstMembers = groupMembers.get(firstRoot)
    const secondMembers = groupMembers.get(secondRoot)
    if (!firstMembers || !secondMembers)
      return { ok: false, reason: 'held-contact-unrepresentable' }
    const candidateMembers = [...new Set([...firstMembers, ...secondMembers])]
    if (openingConflicts.length === 1) supersededSourceChainRelationIds.add(openingConflicts[0]!)
    const heldCheck = heldContactsForMembers(candidateMembers)
    if (!heldCheck.ok) {
      if (openingConflicts.length === 1)
        supersededSourceChainRelationIds.delete(openingConflicts[0]!)
      return { ok: false, reason: 'held-contact-unrepresentable' }
    }
    const movingRelations = [...(relationIdsByRoot.get(movingRoot) ?? [])]
    const affectedRelations = new Set([
      ...movingRelations,
      ...(relationIdsByRoot.get(retainedRoot) ?? []),
    ])
    for (const relationId of affectedRelations) {
      const relation = sourceChainRelations[relationId]!
      const outerARoot = find(relation.outerA.index)
      const outerCRoot = find(relation.outerC.index)
      if (outerARoot !== outerCRoot)
        blockedSourceChainRootPairs.delete(sourceChainRootPairKey(outerARoot, outerCRoot))
    }
    parent[movingRoot] = retainedRoot
    const retainedMembers = groupMembers.get(retainedRoot) ?? new Set<number>()
    for (const member of candidateMembers) retainedMembers.add(member)
    groupMembers.set(retainedRoot, retainedMembers)
    groupMembers.delete(movingRoot)
    const retainedRelations = relationIdsByRoot.get(retainedRoot) ?? new Set<number>()
    for (const relationId of movingRelations) retainedRelations.add(relationId)
    relationIdsByRoot.set(retainedRoot, retainedRelations)
    relationIdsByRoot.delete(movingRoot)
    for (const relationId of affectedRelations) {
      if (supersededSourceChainRelationIds.has(relationId)) continue
      const relation = sourceChainRelations[relationId]!
      const outerARoot = find(relation.outerA.index)
      const outerCRoot = find(relation.outerC.index)
      if (outerARoot !== outerCRoot)
        blockedSourceChainRootPairs.add(sourceChainRootPairKey(outerARoot, outerCRoot))
    }
    return { ok: true }
  }

  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (!isSameWallRun(segs[i]!, segs[j]!)) continue
      const result = union(i, j, 'same-run-normalization')
      if (!result.ok) continue
    }
  }
  // Extra coverage points a group must span (far gap ends of single-flank
  // openings), keyed by any member index.
  const extraPoints: { member: number; point: Vec2 }[] = []

  const placements: OpeningPlacement[] = []
  const unresolvedFixtureDoors: {
    doc: AptVectorDoc['openings'][number]
    width: number
    a: Vec2
    b: Vec2
  }[] = []
  for (const opening of doc.openings) {
    // A validated full-span ray cluster gets one source-backed host below.
    // Suppress every member before any ordinary opening can union or extend
    // its source walls, while retaining loser provenance in diagnostics.
    if (dualJambOpeningIds.has(opening.id)) continue
    if (!isFiniteVec2(opening.a) || !isFiniteVec2(opening.b)) continue
    const a = toLevel(opening.a)
    const b = toLevel(opening.b)
    const gapLen = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (!Number.isFinite(gapLen) || gapLen < 0.05) continue
    const dir: Vec2 = [(b[0] - a[0]) / gapLen, (b[1] - a[1]) / gapLen]
    const width = clampOpeningWidth(opening.type, gapLen)
    if (!width) continue

    let left: number | null = null
    let right: number | null = null
    let covered: number | null = null
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i]!
      if (!isCollinearWith(seg, a, dir)) continue
      const p0 = along(seg.start, a, dir)
      const p1 = along(seg.end, a, dir)
      const lo = Math.min(p0, p1)
      const hi = Math.max(p0, p1)
      if (lo <= 0.05 && hi >= gapLen - 0.05) covered = i
      if (
        hi >= -FLANK_ALONG_M &&
        lo <= 0.05 &&
        hi <= gapLen &&
        (left === null || hi > alongHi(segs[left]!, a, dir))
      )
        left = i
      if (
        hi >= gapLen - 0.05 &&
        lo >= 0 &&
        lo <= gapLen + FLANK_ALONG_M &&
        (right === null || lo < alongLo(segs[right]!, a, dir))
      )
        right = i
    }

    if (covered !== null) {
      placements.push({ doc: opening, group: covered, width })
    } else if (left !== null && right !== null && left !== right) {
      const result = union(left, right, 'opening-host')
      if (!result.ok) return null
      placements.push({ doc: opening, group: left, width })
    } else if ((left !== null || right !== null) && opening.src !== 'boundary') {
      // Extending a single flank across the gap is right for corner doors,
      // but a boundary glazing span next to one stray collinear stub would
      // stretch that stub metres across to a glazed corner with nothing to
      // weld the far end to — boundary spans go through the both-ends
      // synthesis below instead.
      const member = (left ?? right)!
      extraPoints.push({ member, point: left !== null ? b : a })
      placements.push({ doc: opening, group: member, width })
    } else if (gapLen >= MIN_WALL_LENGTH_M) {
      // No collinear flank at all — silhouette-boundary glazing whose corner
      // piers merged into the perpendicular walls. Materialize the host wall
      // the vectorizer asserted, but only when BOTH ends reach a crossing
      // wall to weld onto — a floating span would just trade an unhosted
      // opening for two dangling wall ends.
      const th = clamp(opening.wallThickness / 1000, 0.05, 0.6)
      const synthIndex = segs.length
      const synth: Seg = {
        start: [...a] as Vec2,
        end: [...b] as Vec2,
        th,
        sourceIndices: [synthIndex],
      }
      const extensionPlan = extendToCrossingWalls(synth, segs)
      if (extensionPlan && crossingExtensionRepresentable(extensionPlan)) {
        synth.start = [...extensionPlan.start]
        synth.end = [...extensionPlan.end]
        for (const extension of extensionPlan.extensions) {
          const target = segs[extension.index]!
          target[extension.end] = [...extension.point]
        }
        const index = segs.push(synth) - 1
        parent.push(index)
        groupMembers.set(index, new Set([index]))
        placements.push({ doc: opening, group: index, width })
      } else if (!extensionPlan && opening.src === 'fixture-split' && opening.type === 'door') {
        unresolvedFixtureDoors.push({ doc: opening, width, a, b })
      }
    }
  }

  // Materialize the validated ray span as its own source-backed host.  It is
  // intentionally not unioned with either jamb group: those source walls must
  // keep their original contributors and endpoint contacts.  The host is
  // marked so the generic snap/weld passes cannot move its exact raw interval.
  if (dualJambCluster) {
    const synthIndex = segs.length
    segs.push({
      start: [...dualJambCluster.start],
      end: [...dualJambCluster.end],
      th: dualJambCluster.thickness,
      sourceIndices: [synthIndex],
      openingHostOnly: true,
    })
    parent.push(synthIndex)
    groupMembers.set(synthIndex, new Set([synthIndex]))
    const winnerRawWidth = Math.hypot(
      toLevel(dualJambCluster.winner.b)[0] - toLevel(dualJambCluster.winner.a)[0],
      toLevel(dualJambCluster.winner.b)[1] - toLevel(dualJambCluster.winner.a)[1],
    )
    const winnerWidth = clampOpeningWidth(dualJambCluster.winner.type, winnerRawWidth)
    if (
      winnerWidth !== null &&
      Math.abs(winnerWidth - winnerRawWidth) <= DUAL_JAMB_INTERVAL_EPS_M
    ) {
      placements.push({
        doc: dualJambCluster.winner,
        group: synthIndex,
        width: winnerWidth,
        exactSpan: true,
      })
    }
  }

  // A fixture split can describe two halves of one real door host. If the
  // first half was emitted before the second half, adopt the unresolved half
  // onto the already anchored sibling group. Keep this narrow: the halves
  // need a shared endpoint, opposite collinear rays, matching thickness, and
  // a plausible combined door span. Two unanchored halves never synthesize a
  // wall.
  const anchoredFixtureDoors = placements.filter(
    (placement) => placement.doc.src === 'fixture-split' && placement.doc.type === 'door',
  )
  for (const unresolved of unresolvedFixtureDoors) {
    const unresolvedLen = Math.hypot(
      unresolved.b[0] - unresolved.a[0],
      unresolved.b[1] - unresolved.a[1],
    )
    if (!Number.isFinite(unresolvedLen)) continue
    const unresolvedThickness = clamp(unresolved.doc.wallThickness / 1000, 0.05, 0.6)
    for (const sibling of anchoredFixtureDoors) {
      const siblingA = toLevel(sibling.doc.a)
      const siblingB = toLevel(sibling.doc.b)
      if (!isFiniteVec2(siblingA) || !isFiniteVec2(siblingB)) continue
      const siblingLen = Math.hypot(siblingB[0] - siblingA[0], siblingB[1] - siblingA[1])
      if (!Number.isFinite(siblingLen)) continue
      const siblingThickness = clamp(sibling.doc.wallThickness / 1000, 0.05, 0.6)
      if (Math.abs(unresolvedThickness - siblingThickness) > MERGE_THICKNESS_TOL_M) continue
      const endpointPairs: [Vec2, Vec2, Vec2, Vec2][] = [
        [unresolved.a, siblingA, unresolved.b, siblingB],
        [unresolved.a, siblingB, unresolved.b, siblingA],
        [unresolved.b, siblingA, unresolved.a, siblingB],
        [unresolved.b, siblingB, unresolved.a, siblingA],
      ]
      const shared = endpointPairs.find(
        ([unresolvedShared, siblingShared, unresolvedOuter, siblingOuter]) => {
          if (
            Math.hypot(
              unresolvedShared[0] - siblingShared[0],
              unresolvedShared[1] - siblingShared[1],
            ) > 0.001
          )
            return false
          const unresolvedRay: Vec2 = [
            unresolvedOuter[0] - unresolvedShared[0],
            unresolvedOuter[1] - unresolvedShared[1],
          ]
          const siblingRay: Vec2 = [
            siblingOuter[0] - siblingShared[0],
            siblingOuter[1] - siblingShared[1],
          ]
          const unresolvedRayLen = Math.hypot(unresolvedRay[0], unresolvedRay[1])
          const siblingRayLen = Math.hypot(siblingRay[0], siblingRay[1])
          if (unresolvedRayLen === 0 || siblingRayLen === 0) return false
          const dot =
            (unresolvedRay[0] * siblingRay[0] + unresolvedRay[1] * siblingRay[1]) /
            (unresolvedRayLen * siblingRayLen)
          if (dot > -Math.cos((10 * Math.PI) / 180)) return false
          return unresolvedLen + siblingLen >= 1.2 && unresolvedLen + siblingLen <= 1.8
        },
      )
      if (!shared) continue
      const unresolvedWidth = clampOpeningWidth('door', unresolvedLen)
      const siblingWidth = clampOpeningWidth('door', siblingLen)
      if (!unresolvedWidth || !siblingWidth) continue
      extraPoints.push({ member: sibling.group, point: shared[2] })
      placements.push({ doc: unresolved.doc, group: sibling.group, width: unresolvedWidth })
      break
    }
  }

  // Build one merged segment per group: project member endpoints (plus
  // coverage points) onto the longest member's line and keep the extremes.
  const merged: Seg[] = []
  const mergedIndexByRoot = new Map<number, number>()
  const orderedGroups = [...groupMembers.entries()]
    .map(([root, memberSet]) => ({ root, members: [...memberSet].sort((a, b) => a - b) }))
    .sort((a, b) => a.members[0]! - b.members[0]!)
  for (const { root, members } of orderedGroups) {
    const longest = members.reduce((best, i) => (segLen(segs[i]!) > segLen(segs[best]!) ? i : best))
    const ref = segs[longest]!
    const len0 = segLen(ref)
    const dir: Vec2 = [(ref.end[0] - ref.start[0]) / len0, (ref.end[1] - ref.start[1]) / len0]
    const anchor = ref.start
    const groupExtras = extraPoints.filter((extra) => find(extra.member) === root)
    const points: Vec2[] = members.flatMap((i) => [segs[i]!.start, segs[i]!.end])
    points.push(...groupExtras.map((extra) => extra.point))
    let lo = Number.POSITIVE_INFINITY
    let hi = Number.NEGATIVE_INFINITY
    for (const point of points) {
      const t = along(point, anchor, dir)
      lo = Math.min(lo, t)
      hi = Math.max(hi, t)
    }
    if (hi - lo < MIN_WALL_LENGTH_M) continue
    const thickness = Math.max(...members.map((i) => segs[i]!.th))
    const heldCheck = heldContactsForMembers(
      members,
      groupExtras.map((extra) => extra.point),
    )
    if (!heldCheck.ok) return null
    const heldEndpoints: { start: HeldSourceEndpoint[]; end: HeldSourceEndpoint[] } = {
      start: [],
      end: [],
    }
    for (const held of heldCheck.contacts) {
      const at = along(held.point, anchor, dir)
      const endKey = Math.abs(at - lo) <= SOURCE_ENDPOINT_EPS_M ? 'start' : 'end'
      heldEndpoints[endKey].push(held)
    }
    const start = [anchor[0] + dir[0] * lo, anchor[1] + dir[1] * lo] as Vec2
    const end = [anchor[0] + dir[0] * hi, anchor[1] + dir[1] * hi] as Vec2
    // Restore relation-owned authored contacts before the junction passes.
    // The marker stays attached to this merged endpoint so only a candidate
    // belonging to the same retained relation can move it away again.
    if (heldEndpoints.start[0]) {
      start[0] = heldEndpoints.start[0].point[0]
      start[1] = heldEndpoints.start[0].point[1]
    }
    if (heldEndpoints.end[0]) {
      end[0] = heldEndpoints.end[0].point[0]
      end[1] = heldEndpoints.end[0].point[1]
    }
    mergedIndexByRoot.set(root, merged.length)
    merged.push({
      start,
      end,
      th: thickness,
      sourceIndices: [...members],
      heldEndpoints,
      openingHostOnly: members.some((member) => segs[member]!.openingHostOnly),
    })
  }

  snapJunctions(merged)
  weldDanglingEnds(merged)

  const walls: WallNode[] = []
  const hostByMerged: ({ node: WallNode; anchor: Vec2; dir: Vec2; len: number } | null)[] = []
  for (const seg of merged) {
    const len = segLen(seg)
    if (len < 0.05) {
      hostByMerged.push(null)
      continue
    }
    const node = WallNode.parse({
      start: seg.start,
      end: seg.end,
      thickness: generatedWallThickness,
      faceBands: createDefaultWallFaceBands(generatedWallThickness),
      slots: {
        interior: 'library:concrete-plate',
        exterior: 'library:concrete-plate',
      },
    })
    walls.push(node)
    hostByMerged.push({
      node,
      anchor: seg.start,
      dir: [(seg.end[0] - seg.start[0]) / len, (seg.end[1] - seg.start[1]) / len],
      len,
    })
  }

  // Host every placement first, then resolve overlaps per wall: duplicate
  // detections of the same physical opening (a pair gap plus an overshooting
  // ray gap) would otherwise stack two windows on one wall. Doors outrank
  // windows outrank bare openings; among equals the tighter span wins.
  type Hosted = {
    doc: AptVectorDoc['openings'][number]
    docId: string
    mergedIndex: number
    at: number
    width: number
    type: 'door' | 'window' | 'opening'
  }
  const hosted: Hosted[] = []
  for (const placement of placements) {
    const mergedIndex = mergedIndexByRoot.get(find(placement.group))
    if (mergedIndex === undefined) continue
    const host = hostByMerged[mergedIndex]
    if (!host || host.len < placement.width) continue
    const a = toLevel(placement.doc.a)
    const b = toLevel(placement.doc.b)
    const center: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    const projectedCenter = along(center, host.anchor, host.dir)
    if (
      placement.exactSpan &&
      (projectedCenter < placement.width / 2 - DUAL_JAMB_INTERVAL_EPS_M ||
        projectedCenter > host.len - placement.width / 2 + DUAL_JAMB_INTERVAL_EPS_M)
    )
      continue
    const at = placement.exactSpan
      ? projectedCenter
      : clamp(projectedCenter, placement.width / 2, host.len - placement.width / 2)
    hosted.push({
      doc: placement.doc,
      docId: placement.doc.id,
      mergedIndex,
      at,
      width: placement.width,
      type: placement.doc.type,
    })
  }
  const typeRank = { door: 0, window: 1, opening: 2 } as const
  hosted.sort(
    (p, q) =>
      p.mergedIndex - q.mergedIndex || typeRank[p.type] - typeRank[q.type] || p.width - q.width,
  )
  const kept: Hosted[] = []
  const dedupedOpeningIds: string[] = dualJambCluster
    ? dualJambCluster.losers.map((opening) => opening.id)
    : []
  for (const candidate of hosted) {
    const clash = kept.some((other) => {
      if (other.mergedIndex !== candidate.mergedIndex) return false
      const overlap =
        Math.min(candidate.at + candidate.width / 2, other.at + other.width / 2) -
        Math.max(candidate.at - candidate.width / 2, other.at - other.width / 2)
      return overlap > OPENING_OVERLAP_FRAC * Math.min(candidate.width, other.width)
    })
    if (clash) dedupedOpeningIds.push(candidate.docId)
    else kept.push(candidate)
  }
  const placedIds = new Set([...kept.map((item) => item.docId), ...dedupedOpeningIds])
  const unhostedOpeningIds = doc.openings
    .filter((opening) => !placedIds.has(opening.id))
    .map((opening) => opening.id)

  const openings: (DoorNode | WindowNode)[] = []
  for (const item of kept) {
    const host = hostByMerged[item.mergedIndex]!
    const metadata = openingMetadata(item.doc, item.width)
    if (item.type === 'door') {
      openings.push(
        DoorNode.parse({
          wallId: host.node.id,
          width: item.width,
          height: DOOR_HEIGHT_M,
          metadata,
          position: [item.at, DOOR_HEIGHT_M / 2, 0],
        }),
      )
    } else {
      const isOpening = item.type === 'opening'
      const height = isOpening ? DOOR_HEIGHT_M : WINDOW_HEIGHT_M
      const sill = isOpening ? 0 : WINDOW_SILL_M
      openings.push(
        WindowNode.parse({
          wallId: host.node.id,
          width: item.width,
          height,
          ...(isOpening ? { openingKind: 'opening' } : {}),
          metadata,
          position: [item.at, sill + height / 2, 0],
        }),
      )
    }
  }

  const zones: ZoneNode[] = []
  for (const room of doc.rooms) {
    if (!room.polygon || room.polygon.length < 3) continue
    // white-tile rooms without an OCR label are utility/service spaces as
    // often as bathrooms — only small ones get the 욕실 guess
    const fallback =
      room.cls === 'bath' && (room.areaM2 == null || room.areaM2 > 5)
        ? '공간'
        : (ROOM_NAME_KO[room.cls] ?? '공간')
    zones.push(
      ZoneNode.parse({
        name: room.name ?? fallback,
        polygon: room.polygon.map(toLevel),
        spaceRole: 'room',
        clearDimensionPolicy: 'finish-faces',
        ...(ROOM_COLOR[room.cls] ? { color: ROOM_COLOR[room.cls] } : {}),
        metadata: {
          source: 'apt-vector',
          sourceRoomId: room.id,
          cls: room.cls,
          areaM2: room.areaM2,
        },
      }),
    )
  }

  const connected = connectWallJunctions(walls, openings)
  const detection = detectSpacesForLevel('apt-vector-import', connected.walls)
  const wallUpdates = new Map(detection.wallUpdates.map((update) => [update.wallId, update]))
  const classifiedWalls = connected.walls.map((wall) => {
    const update = wallUpdates.get(wall.id)
    if (!update) return wall
    return WallNode.parse({ ...wall, frontSide: update.frontSide, backSide: update.backSide })
  })
  const detectedSpaces = detection.spaces
  const zonePlan = planAutoZonesForLevel(detectedSpaces, zones, {
    adoptContainedApartmentZones: true,
    createMissingZones: { source: 'apt-vector', generatedFrom: 'detected-space' },
  })
  const zoneUpdates = new Map(zonePlan.update.map((entry) => [entry.id, entry.data]))
  const reconciledZones = zones.map((zone) => {
    const update = zoneUpdates.get(zone.id)
    return update ? ZoneNode.parse({ ...zone, ...update }) : zone
  })
  const scene = {
    ...connected,
    walls: classifiedWalls,
    zones: [...reconciledZones, ...zonePlan.create],
    slabs: [],
    ceilings: [],
    guideScale: sourceGuideScale,
    diagnostics: { unhostedOpeningIds, dedupedOpeningIds, droppedWallIds },
  }
  const framed = applyAptPlanImportFrame(scene, frame)
  const finalSpaces = detectSpacesForLevel('apt-vector-import', framed.walls).spaces
  const finalRoomPolygons = finalSpaces.map((space) => space.polygon.map(([x, y]) => ({ x, y })))
  return {
    ...framed,
    slabs: planAutoSlabsForLevel(finalRoomPolygons, surfaceContext.existingSlabs ?? []).create,
    ceilings: planAutoCeilingsForLevel(finalRoomPolygons, surfaceContext.existingCeilings ?? [])
      .create,
  }
}

function applyAptPlanImportFrame(
  scene: VectorSceneNodes,
  frame: AptPlanImportFrame,
): VectorSceneNodes {
  const guideScale = scene.guideScale
  const scale = frame.scale === undefined ? 1 : frame.scale / guideScale
  const [offsetX, _offsetY, offsetZ] = frame.position ?? [0, 0, 0]
  const yaw = frame.rotationY ?? 0
  const cos = Math.cos(yaw)
  const sin = Math.sin(yaw)
  const reflectX = frame.flipX ? -1 : 1
  const reflectZ = frame.flipY ? -1 : 1
  const transformPoint = ([x, z]: Vec2): Vec2 => {
    const reflectedX = reflectX * x
    const reflectedZ = reflectZ * z
    return [
      offsetX + scale * (cos * reflectedX + sin * reflectedZ),
      offsetZ + scale * (-sin * reflectedX + cos * reflectedZ),
    ]
  }
  const oddReflection = Boolean(frame.flipX) !== Boolean(frame.flipY)

  const walls = scene.walls.map((wall) => {
    return WallNode.parse({
      ...wall,
      start: transformPoint(wall.start),
      end: transformPoint(wall.end),
      thickness: DEFAULT_WALL_THICKNESS,
      faceBands: createDefaultWallFaceBands(DEFAULT_WALL_THICKNESS),
    })
  })
  const openings = scene.openings.map((opening) => {
    const patch = {
      ...opening,
      width: opening.width * scale,
      position: [opening.position[0] * scale, opening.position[1], opening.position[2] * scale] as [
        number,
        number,
        number,
      ],
      ...(opening.type === 'door' && oddReflection
        ? { swingDirection: opening.swingDirection === 'inward' ? 'outward' : 'inward' }
        : {}),
    }
    return opening.type === 'door' ? DoorNode.parse(patch) : WindowNode.parse(patch)
  })
  const zones = scene.zones.map((zone) =>
    ZoneNode.parse({ ...zone, polygon: zone.polygon.map(transformPoint) }),
  )
  return { ...scene, walls, openings, zones, guideScale: frame.scale ?? scene.guideScale }
}

export function connectWallJunctions(walls: WallNode[], openings: (DoorNode | WindowNode)[]) {
  const segments = walls.map((wall) => ({ ...wall, th: wall.thickness ?? 0.1 }))
  type JunctionCut = {
    at: number
    point: Vec2
    band: number
    order: number
  }
  const candidates = segments.map(() => [] as JunctionCut[])
  let cutOrder = 0
  for (let i = 0; i < segments.length; i++) {
    const a = segments[i]!
    for (let j = i + 1; j < segments.length; j++) {
      const b = segments[j]!
      const point = lineIntersection(a, b)
      if (!point) continue
      const ta = along(point, a.start, segDir(a))
      const tb = along(point, b.start, segDir(b))
      if (ta < -1e-6 || ta > segLen(a) + 1e-6 || tb < -1e-6 || tb > segLen(b) + 1e-6) continue
      for (const [index, at] of [
        [i, ta],
        [j, tb],
      ] as const) {
        const wall = segments[index]!
        const hostDir = segDir(wall)
        const otherDir = segDir(index === i ? b : a)
        const cross = Math.abs(hostDir[0] * otherDir[1] - hostDir[1] * otherDir[0])
        if (cross <= 1e-6) continue
        const constructionThickness = getWallConstructionEnvelopeThickness(index === i ? b : a)
        if (
          openings.some(
            (opening) =>
              opening.wallId === wall.id &&
              Math.abs(opening.position[0] - at) <
                (opening.width + constructionThickness) / 2 + 0.001,
          )
        ) {
          continue
        }
        candidates[index]!.push({
          at,
          point,
          band: constructionThickness / (2 * cross),
          order: cutOrder++,
        })
      }
    }
  }

  const cuts = segments.map(() => [] as { at: number; point: Vec2 }[])
  const endpointBounds = segments.map((segment) => ({
    start: { at: 0, point: segment.start },
    end: { at: segLen(segment), point: segment.end },
  }))
  for (let index = 0; index < segments.length; index += 1) {
    const wall = segments[index]!
    const length = segLen(wall)
    const sorted = [...candidates[index]!].sort(
      (a, b) => a.at - a.band - (b.at - b.band) || a.at - b.at || a.order - b.order,
    )
    let cluster: JunctionCut[] = []
    let clusterEnd = Number.NEGATIVE_INFINITY
    let startTrim: JunctionCut | undefined
    let endTrim: JunctionCut | undefined
    const flush = () => {
      if (cluster.length === 0) return
      const clusterStart = Math.min(...cluster.map((cut) => cut.at - cut.band))
      const end = Math.max(...cluster.map((cut) => cut.at + cut.band))
      const touchesStart = clusterStart <= 1e-6
      const touchesEnd = end >= length - 1e-6
      if (touchesStart || touchesEnd) {
        if (touchesStart && touchesEnd) {
          cluster = []
          return
        }
        if (touchesStart) {
          startTrim = cluster.reduce(
            (best, cut) => {
              if (!best || cut.at < best.at || (cut.at === best.at && cut.order < best.order)) {
                return cut
              }
              return best
            },
            undefined as JunctionCut | undefined,
          )
        }
        if (touchesEnd) {
          endTrim = cluster.reduce(
            (best, cut) => {
              if (!best || cut.at > best.at || (cut.at === best.at && cut.order < best.order)) {
                return cut
              }
              return best
            },
            undefined as JunctionCut | undefined,
          )
        }
        cluster = []
        return
      }
      const center = (clusterStart + end) / 2
      const chosen = cluster.reduce((best, cut) => {
        const distance = Math.abs(cut.at - center)
        const bestDistance = Math.abs(best.at - center)
        return distance < bestDistance || (distance === bestDistance && cut.order < best.order)
          ? cut
          : best
      })
      cuts[index]!.push({ at: chosen.at, point: chosen.point })
      cluster = []
    }
    for (const candidate of sorted) {
      const start = candidate.at - candidate.band
      if (cluster.length > 0 && start > clusterEnd + 1e-9) flush()
      cluster.push(candidate)
      clusterEnd = Math.max(clusterEnd, candidate.at + candidate.band)
    }
    flush()

    const openingSpansTrimmed = (from: number, to: number) =>
      openings.some((opening) => {
        if (opening.wallId !== wall.id) return false
        const openingStart = opening.position[0] - opening.width / 2
        const openingEnd = opening.position[0] + opening.width / 2
        return openingStart < to + 0.001 && openingEnd > from - 0.001
      })
    const proposedStart = startTrim?.at ?? 0
    const proposedEnd = endTrim?.at ?? length
    const canTrimStart =
      startTrim !== undefined && proposedStart > 1e-6 && !openingSpansTrimmed(0, proposedStart)
    const canTrimEnd =
      endTrim !== undefined &&
      proposedEnd < length - 1e-6 &&
      !openingSpansTrimmed(proposedEnd, length)
    const nextStart = canTrimStart ? startTrim!.at : 0
    const nextEnd = canTrimEnd ? endTrim!.at : length
    if (nextEnd - nextStart >= MIN_WALL_LENGTH_M) {
      if (canTrimStart)
        endpointBounds[index]!.start =
          startTrim!.at < length
            ? { at: startTrim!.at, point: startTrim!.point }
            : endpointBounds[index]!.start
      if (canTrimEnd)
        endpointBounds[index]!.end =
          endTrim!.at > 0 ? { at: endTrim!.at, point: endTrim!.point } : endpointBounds[index]!.end
    }
  }

  const connectedWalls: WallNode[] = []
  const hostedOpenings: (DoorNode | WindowNode)[] = []
  for (let i = 0; i < walls.length; i++) {
    const wall = walls[i]!
    const bounds = endpointBounds[i]!
    const endpoints = [bounds.start, ...cuts[i]!.sort((a, b) => a.at - b.at), bounds.end]
    for (let k = 0; k < endpoints.length - 1; k++) {
      const start = endpoints[k]!
      const end = endpoints[k + 1]!
      const children = openings.filter(
        (opening) =>
          opening.wallId === wall.id &&
          opening.position[0] >= start.at &&
          opening.position[0] < end.at,
      )
      const segment = WallNode.parse({
        ...wall,
        id: k === 0 ? wall.id : undefined,
        start: start.point,
        end: end.point,
        children: children.map((opening) => opening.id),
      })
      connectedWalls.push(segment)
      for (const opening of children) {
        hostedOpenings.push({
          ...opening,
          wallId: segment.id,
          parentId: segment.id,
          position: [opening.position[0] - start.at, opening.position[1], opening.position[2]],
        })
      }
    }
  }
  return { walls: connectedWalls, openings: hostedOpenings }
}

/**
 * Closes corner and tee gaps by moving endpoints ALONG each wall's own axis:
 * an L-corner pair meets at the intersection of the two wall lines, and a
 * tee endpoint extends to the crossed wall's centerline. Directions never
 * change, so hosted opening projections stay valid.
 */
function snapJunctions(segs: Seg[]): void {
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < segs.length; i++) {
      const a = segs[i]!
      if (a.openingHostOnly) continue
      for (const endKey of ['start', 'end'] as const) {
        const p = a[endKey]
        let bestCorner: { q: Vec2; d: number; otherIndex: number } | null = null
        let bestTee: { q: Vec2; d: number; otherIndex: number } | null = null
        for (let j = 0; j < segs.length; j++) {
          if (j === i) continue
          const b = segs[j]!
          if (b.openingHostOnly) continue
          const cross = lineIntersection(a, b)
          if (!cross) {
            if (distToSegment(p, b) <= SOURCE_ENDPOINT_EPS_M) continue
            // near-parallel: bridge an end-to-end split in the same wall run
            // (hosted openings sit INSIDE walls, so this cannot seal a door)
            // An exact centerline contact already joins this endpoint to the
            // other source segment. Never extend it to that segment's distant
            // endpoint; footprint proximity is intentionally not considered.
            const da = segDir(a)
            for (const otherKey of ['start', 'end'] as const) {
              const q = b[otherKey]
              const gap = Math.hypot(p[0] - q[0], p[1] - q[1])
              if (gap < 1e-9 || gap > SNAP_COLLINEAR_M) continue
              const lateral = Math.abs((q[0] - p[0]) * da[1] - (q[1] - p[1]) * da[0])
              if (lateral > 0.15) continue
              const forward = along(q, p, da)
              const intoOwn = along(q, a[endKey === 'start' ? 'end' : 'start'], da)
              const ownSpan = along(p, a[endKey === 'start' ? 'end' : 'start'], da)
              // only extend outward past this end, never fold back inside
              if (
                Math.sign(intoOwn) !== Math.sign(ownSpan) ||
                Math.abs(intoOwn) < Math.abs(ownSpan)
              )
                continue
              const target: Vec2 = [p[0] + da[0] * forward, p[1] + da[1] * forward]
              if (relationMoveRejected(a, endKey, target, b)) continue
              if (!bestTee || gap < bestTee.d) bestTee = { q: target, d: gap, otherIndex: j }
            }
            continue
          }
          for (const otherKey of ['start', 'end'] as const) {
            const q = b[otherKey]
            const d = Math.hypot(p[0] - q[0], p[1] - q[1])
            if (d < 1e-9 || d > SNAP_CORNER_M) continue
            const move = Math.hypot(p[0] - cross[0], p[1] - cross[1])
            const moveOther = Math.hypot(q[0] - cross[0], q[1] - cross[1])
            if (move > SNAP_MAX_MOVE_M || moveOther > SNAP_MAX_MOVE_M) continue
            const direction = segDir(a)
            const outward = endKey === 'start' ? -1 : 1
            if (along(cross, p, direction) * outward < -a.th / 2) continue
            if (relationMoveRejected(a, endKey, cross, b)) continue
            if (!bestCorner || d < bestCorner.d) bestCorner = { q: cross, d, otherIndex: j }
          }
          if (!bestCorner) {
            const lat = distToSegment(p, b)
            if (lat <= b.th / 2 + SNAP_TEE_LATERAL_M) {
              const move = Math.hypot(p[0] - cross[0], p[1] - cross[1])
              const t = along(cross, b.start, segDir(b))
              if (move <= SNAP_MAX_MOVE_M && t >= -0.15 && t <= segLen(b) + 0.15) {
                if (relationMoveRejected(a, endKey, cross, b)) continue
                if (!bestTee || move < bestTee.d) bestTee = { q: cross, d: move, otherIndex: j }
              }
            }
          }
        }
        const target = bestCorner ?? bestTee
        if (target && Math.hypot(p[0] - target.q[0], p[1] - target.q[1]) > 1e-6) {
          const otherEnd = a[endKey === 'start' ? 'end' : 'start']
          if (Math.hypot(target.q[0] - otherEnd[0], target.q[1] - otherEnd[1]) >= 0.1) {
            a[endKey] = [target.q[0], target.q[1]]
          }
        }
      }
    }
  }
}

/**
 * Last-resort closure: endpoints that STILL touch nothing after the normal
 * snap get a bigger 1 m budget — first bridging a facing collinear end (an
 * undetected opening left a hole in one wall run), then extending onto a
 * crossing wall line. Ordinary endpoints are never moved, which keeps the
 * larger budget from welding across real narrow spaces.
 */
function weldDanglingEnds(segs: Seg[]): void {
  const original = segs.map((seg) => {
    const start: Vec2 = [seg.start[0], seg.start[1]]
    const end: Vec2 = [seg.end[0], seg.end[1]]
    const length = Math.hypot(end[0] - start[0], end[1] - start[1])
    return {
      start,
      end,
      dir: [(end[0] - start[0]) / length, (end[1] - start[1]) / length] as Vec2,
      length,
      th: seg.th,
    }
  })
  const originalSegs: Seg[] = original.map((seg) => ({
    start: seg.start,
    end: seg.end,
    th: seg.th,
  }))
  const touches = (point: Vec2, self: Seg) =>
    segs.some(
      (other) =>
        other !== self &&
        !other.openingHostOnly &&
        distToSegment(point, other) <= other.th / 2 + 0.02,
    )
  for (let pass = 0; pass < 2; pass++) {
    const dangling = new Set<string>()
    for (const seg of segs) {
      if (seg.openingHostOnly) continue
      for (const endKey of ['start', 'end'] as const) {
        if (!touches(seg[endKey], seg)) dangling.add(endId(segs, seg, endKey))
      }
    }
    for (const seg of segs) {
      if (seg.openingHostOnly) continue
      for (const endKey of ['start', 'end'] as const) {
        if (!dangling.has(endId(segs, seg, endKey))) continue
        const p = seg[endKey]
        if (touches(p, seg)) continue
        const index = segs.indexOf(seg)
        const baseline = original[index]!
        const originalPoint = endKey === 'start' ? baseline.start : baseline.end
        const outward: Vec2 =
          endKey === 'start' ? [-baseline.dir[0], -baseline.dir[1]] : baseline.dir
        const ownBudget = Math.min(1, baseline.length)
        let target: Vec2 | null = null
        let bestMove = Number.POSITIVE_INFINITY
        for (let otherIndex = 0; otherIndex < segs.length; otherIndex++) {
          const other = segs[otherIndex]!
          if (other === seg || other.openingHostOnly) continue
          const originalOther = original[otherIndex]!
          const cross = lineIntersection(originalSegs[index]!, originalSegs[otherIndex]!)
          if (cross) {
            const t = along(cross, originalOther.start, originalOther.dir)
            const otherLen = originalOther.length
            let reachable = t >= -0.15 && t <= otherLen + 0.15
            if (!reachable) {
              // a mutually-dangling L-corner: both short legs point at the
              // same line intersection — let each extend to it in turn
              const nearKey = t < 0 ? 'start' : 'end'
              const overrun = t < 0 ? -t : t - otherLen
              reachable =
                overrun <= Math.min(1, otherLen) && dangling.has(endId(segs, other, nearKey))
            }
            if (!reachable) continue
            if (Math.hypot(cross[0] - originalPoint[0], cross[1] - originalPoint[1]) > ownBudget)
              continue
            if (relationMoveRejected(seg, endKey, cross, other)) continue
            const move = (cross[0] - p[0]) * outward[0] + (cross[1] - p[1]) * outward[1]
            if (move > 0.01 && move <= bestMove) {
              bestMove = move
              target = cross
            }
          } else {
            for (const otherKey of ['start', 'end'] as const) {
              const q = originalOther[otherKey]
              const lateral = Math.abs(
                (q[0] - p[0]) * baseline.dir[1] - (q[1] - p[1]) * baseline.dir[0],
              )
              const forward = (q[0] - p[0]) * outward[0] + (q[1] - p[1]) * outward[1]
              const candidate: Vec2 = [p[0] + outward[0] * forward, p[1] + outward[1] * forward]
              if (
                lateral > 0.15 ||
                forward <= 0.01 ||
                forward > bestMove ||
                Math.hypot(candidate[0] - originalPoint[0], candidate[1] - originalPoint[1]) >
                  ownBudget
              )
                continue
              if (relationMoveRejected(seg, endKey, candidate, other)) continue
              bestMove = forward
              target = candidate
            }
          }
        }
        if (target) {
          const otherEnd = seg[endKey === 'start' ? 'end' : 'start']
          if (Math.hypot(target[0] - otherEnd[0], target[1] - otherEnd[1]) >= 0.1) {
            seg[endKey] = target
          }
        }
      }
    }
  }
}

function endId(segs: Seg[], seg: Seg, endKey: 'start' | 'end'): string {
  return `${segs.indexOf(seg)}:${endKey}`
}

function lineIntersection(a: Seg, b: Seg): Vec2 | null {
  const da = segDir(a)
  const db = segDir(b)
  const det = da[0] * db[1] - da[1] * db[0]
  if (Math.abs(det) < Math.sin((15 * Math.PI) / 180)) return null
  const dx = b.start[0] - a.start[0]
  const dz = b.start[1] - a.start[1]
  const t = (dx * db[1] - dz * db[0]) / det
  return [a.start[0] + da[0] * t, a.start[1] + da[1] * t]
}

function segDir(seg: Seg): Vec2 {
  const len = segLen(seg)
  return [(seg.end[0] - seg.start[0]) / len, (seg.end[1] - seg.start[1]) / len]
}

function distToSegment(p: Vec2, seg: Seg): number {
  const dir = segDir(seg)
  const t = clamp(along(p, seg.start, dir), 0, segLen(seg))
  const q: Vec2 = [seg.start[0] + dir[0] * t, seg.start[1] + dir[1] * t]
  return Math.hypot(p[0] - q[0], p[1] - q[1])
}

function segLen(seg: Seg): number {
  return Math.hypot(seg.end[0] - seg.start[0], seg.end[1] - seg.start[1])
}

function along(point: Vec2, anchor: Vec2, dir: Vec2): number {
  return (point[0] - anchor[0]) * dir[0] + (point[1] - anchor[1]) * dir[1]
}

function alongLo(seg: Seg, anchor: Vec2, dir: Vec2): number {
  return Math.min(along(seg.start, anchor, dir), along(seg.end, anchor, dir))
}

function alongHi(seg: Seg, anchor: Vec2, dir: Vec2): number {
  return Math.max(along(seg.start, anchor, dir), along(seg.end, anchor, dir))
}

const DUAL_JAMB_INTERVAL_EPS_M = 1e-6

type SourceRectangle = {
  origin: Vec2
  direction: Vec2
  normal: Vec2
  length: number
  halfWidth: number
}

type SourceOpeningTrace = {
  index: number
  opening: OpeningDocument
  a: Vec2
  b: Vec2
  direction: Vec2
  thickness: number
  rectangle: SourceRectangle
}

type DualJambSupport = {
  index: number
  distance: number
  contact: Vec2
}

function sourceRectangleFromSegment(
  start: Vec2,
  end: Vec2,
  halfWidth: number,
): SourceRectangle | null {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  if (!Number.isFinite(length) || length <= SOURCE_ENDPOINT_EPS_M) return null
  if (!Number.isFinite(halfWidth) || halfWidth <= 0) return null
  const direction: Vec2 = [(end[0] - start[0]) / length, (end[1] - start[1]) / length]
  return {
    origin: [...start],
    direction,
    normal: [-direction[1], direction[0]],
    length,
    halfWidth,
  }
}

function sourceRectangleCorners(rectangle: SourceRectangle): Vec2[] {
  const along = [
    rectangle.direction[0] * rectangle.length,
    rectangle.direction[1] * rectangle.length,
  ] as Vec2
  const lateral = [
    rectangle.normal[0] * rectangle.halfWidth,
    rectangle.normal[1] * rectangle.halfWidth,
  ] as Vec2
  return [
    [rectangle.origin[0] + lateral[0], rectangle.origin[1] + lateral[1]],
    [rectangle.origin[0] + along[0] + lateral[0], rectangle.origin[1] + along[1] + lateral[1]],
    [rectangle.origin[0] + along[0] - lateral[0], rectangle.origin[1] + along[1] - lateral[1]],
    [rectangle.origin[0] - lateral[0], rectangle.origin[1] - lateral[1]],
  ]
}

function sourceRectangleProjection(rectangle: SourceRectangle, axis: Vec2): [number, number] {
  const corners = sourceRectangleCorners(rectangle)
  const projections = corners.map((point) => point[0] * axis[0] + point[1] * axis[1])
  return [Math.min(...projections), Math.max(...projections)]
}

function sourceRectangleOverlapDepths(first: SourceRectangle, second: SourceRectangle): number[] {
  const axes = [first.direction, first.normal, second.direction, second.normal]
  return axes.map((axis) => {
    const [firstLo, firstHi] = sourceRectangleProjection(first, axis)
    const [secondLo, secondHi] = sourceRectangleProjection(second, axis)
    return Math.min(firstHi, secondHi) - Math.max(firstLo, secondLo)
  })
}

function sourceRectanglesOverlap(first: SourceRectangle, second: SourceRectangle): boolean {
  return sourceRectangleOverlapDepths(first, second).every((depth) => depth > SOURCE_ENDPOINT_EPS_M)
}

function sourceRectanglesBoundaryContact(first: SourceRectangle, second: SourceRectangle): boolean {
  const depths = sourceRectangleOverlapDepths(first, second)
  return (
    depths.every((depth) => depth >= -SOURCE_ENDPOINT_EPS_M) &&
    depths.some((depth) => depth <= SOURCE_ENDPOINT_EPS_M)
  )
}

function sourceSegmentRectangleInterval(
  start: Vec2,
  end: Vec2,
  rectangle: SourceRectangle,
): [number, number] | null {
  const delta: Vec2 = [end[0] - start[0], end[1] - start[1]]
  let lo = 0
  let hi = 1
  const startFromOrigin: Vec2 = [start[0] - rectangle.origin[0], start[1] - rectangle.origin[1]]
  const constraints: [Vec2, number, number][] = [
    [rectangle.direction, 0, rectangle.length],
    [rectangle.normal, -rectangle.halfWidth, rectangle.halfWidth],
  ]
  for (const [axis, min, max] of constraints) {
    const p0 = startFromOrigin[0] * axis[0] + startFromOrigin[1] * axis[1]
    const rate = delta[0] * axis[0] + delta[1] * axis[1]
    if (Math.abs(rate) <= SOURCE_ENDPOINT_EPS_M) {
      if (p0 < min - SOURCE_ENDPOINT_EPS_M || p0 > max + SOURCE_ENDPOINT_EPS_M) return null
      continue
    }
    let first = (min - p0) / rate
    let second = (max - p0) / rate
    if (first > second) [first, second] = [second, first]
    lo = Math.max(lo, first)
    hi = Math.min(hi, second)
    if (hi < lo - SOURCE_ENDPOINT_EPS_M) return null
  }
  return [Math.max(0, lo), Math.min(1, hi)]
}

function sourceTraceCenterlinesIntersect(
  first: SourceOpeningTrace,
  second: SourceOpeningTrace,
): boolean {
  const r: Vec2 = [first.b[0] - first.a[0], first.b[1] - first.a[1]]
  const s: Vec2 = [second.b[0] - second.a[0], second.b[1] - second.a[1]]
  const qMinusP: Vec2 = [second.a[0] - first.a[0], second.a[1] - first.a[1]]
  const crossRS = r[0] * s[1] - r[1] * s[0]
  if (Math.abs(crossRS) <= SOURCE_ENDPOINT_EPS_M) {
    // Parallel and collinear centerlines have no unique intersection point.
    // Parallel frame relations are admitted only by the exact translated-frame
    // family predicate below, which also proves positive source-trace overlap.
    return false
  }
  const t = (qMinusP[0] * s[1] - qMinusP[1] * s[0]) / crossRS
  const u = (qMinusP[0] * r[1] - qMinusP[1] * r[0]) / crossRS
  return (
    t >= -SOURCE_ENDPOINT_EPS_M &&
    t <= 1 + SOURCE_ENDPOINT_EPS_M &&
    u >= -SOURCE_ENDPOINT_EPS_M &&
    u <= 1 + SOURCE_ENDPOINT_EPS_M
  )
}

function normalizedSourceDisplacement(trace: SourceOpeningTrace): Vec2 {
  const firstBeforeSecond =
    trace.a[0] < trace.b[0] || (trace.a[0] === trace.b[0] && trace.a[1] <= trace.b[1])
  return firstBeforeSecond
    ? [trace.b[0] - trace.a[0], trace.b[1] - trace.a[1]]
    : [trace.a[0] - trace.b[0], trace.a[1] - trace.b[1]]
}

function isExactTranslatedFrameFamily(
  first: SourceOpeningTrace,
  second: SourceOpeningTrace,
): boolean {
  if (first.opening.src !== 'frame' || second.opening.src !== 'frame') return false
  const firstDisplacement = normalizedSourceDisplacement(first)
  const secondDisplacement = normalizedSourceDisplacement(second)
  if (
    Math.abs(firstDisplacement[0] - secondDisplacement[0]) > SOURCE_ENDPOINT_EPS_M ||
    Math.abs(firstDisplacement[1] - secondDisplacement[1]) > SOURCE_ENDPOINT_EPS_M ||
    Math.abs(first.thickness - second.thickness) > SOURCE_ENDPOINT_EPS_M
  )
    return false
  const displacementLength = Math.hypot(firstDisplacement[0], firstDisplacement[1])
  if (displacementLength <= SOURCE_ENDPOINT_EPS_M) return false
  const translation: Vec2 = [second.a[0] - first.a[0], second.a[1] - first.a[1]]
  const lateralTranslation = Math.abs(
    (translation[0] * firstDisplacement[1] - translation[1] * firstDisplacement[0]) /
      displacementLength,
  )
  return (
    lateralTranslation > SOURCE_ENDPOINT_EPS_M &&
    sourceRectanglesOverlap(first.rectangle, second.rectangle)
  )
}

function sourceTraceFromOpening(
  opening: OpeningDocument,
  index: number,
  toLevel: (point: Vec2) => Vec2,
): SourceOpeningTrace | null {
  if (
    !isFiniteVec2(opening.a) ||
    !isFiniteVec2(opening.b) ||
    !Number.isFinite(opening.wallThickness) ||
    opening.wallThickness <= 0
  )
    return null
  const a = toLevel(opening.a)
  const b = toLevel(opening.b)
  const rectangle = sourceRectangleFromSegment(a, b, opening.wallThickness / 2000)
  if (!rectangle) return null
  return {
    index,
    opening,
    a,
    b,
    direction: rectangle.direction,
    thickness: opening.wallThickness / 1000,
    rectangle,
  }
}

function sourceOpeningSegmentTouchesTrace(
  opening: OpeningDocument,
  toLevel: (point: Vec2) => Vec2,
  trace: SourceOpeningTrace,
): boolean {
  if (!isFiniteVec2(opening.a) || !isFiniteVec2(opening.b)) return false
  const a = toLevel(opening.a)
  const b = toLevel(opening.b)
  return sourceSegmentRectangleInterval(a, b, trace.rectangle) !== null
}

function sourceFootprintPassageContact(
  start: Vec2,
  end: Vec2,
  segment: Seg,
): 'pier' | 'ambiguous' | 'none' {
  const rectangle = sourceRectangleFromSegment(segment.start, segment.end, segment.th / 2)
  if (!rectangle) return 'none'
  const interval = sourceSegmentRectangleInterval(start, end, rectangle)
  if (!interval) return 'none'
  const passageLength = Math.hypot(end[0] - start[0], end[1] - start[1])
  const contactStart = interval[0] * passageLength
  const contactEnd = interval[1] * passageLength
  const interiorStart = Math.max(contactStart, SOURCE_ENDPOINT_EPS_M)
  const interiorEnd = Math.min(contactEnd, passageLength - SOURCE_ENDPOINT_EPS_M)
  if (interiorEnd - interiorStart > SOURCE_ENDPOINT_EPS_M) return 'pier'
  return interiorEnd >= interiorStart - SOURCE_ENDPOINT_EPS_M ? 'ambiguous' : 'none'
}

/**
 * Finds one source-backed full-span ray opening before opening placement can
 * union its shorter frame/pair detections. The source walls are deliberately
 * passed in as their pre-placement copies: a later opening must not change
 * which jambs support this decision.
 */
function findDualJambSupportedFullSpan(
  openings: readonly OpeningDocument[],
  sourceSegs: readonly Seg[],
  toLevel: (point: Vec2) => Vec2,
): DualJambOpeningCluster | null {
  const sourceSupportCandidates = (point: Vec2): DualJambSupport[] =>
    sourceSegs
      .flatMap((seg, index) => {
        const length = segLen(seg)
        if (length < MIN_WALL_LENGTH_M) return []
        const direction = segDir(seg)
        const rawAt = along(point, seg.start, direction)
        if (rawAt < -SOURCE_ENDPOINT_EPS_M || rawAt > length + SOURCE_ENDPOINT_EPS_M) return []
        const at = clamp(rawAt, 0, length)
        const contact: Vec2 = [seg.start[0] + direction[0] * at, seg.start[1] + direction[1] * at]
        const distance = Math.abs(
          (point[0] - contact[0]) * direction[1] - (point[1] - contact[1]) * direction[0],
        )
        if (distance > seg.th / 2 + SOURCE_ENDPOINT_EPS_M) return []
        return [
          {
            index,
            distance,
            contact,
          },
        ]
      })
      .sort((a, b) => a.distance - b.distance || a.index - b.index)

  const uniqueSupport = (candidates: DualJambSupport[]): DualJambSupport | null => {
    const best = candidates[0]
    if (!best) return null
    const tied = candidates.filter(
      (candidate) => Math.abs(candidate.distance - best.distance) <= DUAL_JAMB_INTERVAL_EPS_M,
    )
    return tied.every((candidate) => sourcePointsMatch(candidate.contact, best.contact))
      ? best
      : null
  }

  const sourceTraces = openings.map((opening, index) =>
    sourceTraceFromOpening(opening, index, toLevel),
  )
  const allowedSourceKinds = new Set(['ray', 'pair', 'frame'])
  const candidates: DualJambOpeningCluster[] = []
  for (const candidate of openings) {
    const barrierThickness = candidate.barrierThickness
    if (
      candidate.type !== 'door' ||
      candidate.src !== 'ray' ||
      !isFiniteVec2(candidate.a) ||
      !isFiniteVec2(candidate.b) ||
      !isFiniteVec2(candidate.barrierA ?? []) ||
      !isFiniteVec2(candidate.barrierB ?? []) ||
      typeof barrierThickness !== 'number' ||
      !Number.isFinite(barrierThickness) ||
      barrierThickness <= 0
    )
      continue
    const candidateIndex = openings.indexOf(candidate)
    const candidateTrace = sourceTraces[candidateIndex]
    if (!candidateTrace || candidate.src !== 'ray') continue
    const rawA = toLevel(candidate.a)
    const rawB = toLevel(candidate.b)
    const rawLength = Math.hypot(rawB[0] - rawA[0], rawB[1] - rawA[1])
    if (!isExistingOpeningWidthPolicyIdentity(candidate.type, rawLength)) continue
    const expectedThickness = barrierThickness / 1000
    if (!isExistingWallThicknessPolicyIdentity(expectedThickness)) continue

    const sameTypeTraces = sourceTraces.filter(
      (trace): trace is SourceOpeningTrace =>
        trace !== null && trace.opening.type === candidate.type,
    )
    const graphTraces = sameTypeTraces.filter((trace) =>
      allowedSourceKinds.has(trace.opening.src ?? ''),
    )
    const component = new Map<number, SourceOpeningTrace>()
    const pending = [candidateTrace]
    while (pending.length > 0) {
      const current = pending.pop()!
      if (component.has(current.index)) continue
      component.set(current.index, current)
      for (const other of graphTraces) {
        if (
          other.index !== current.index &&
          !component.has(other.index) &&
          sourceRectanglesOverlap(current.rectangle, other.rectangle)
        )
          pending.push(other)
      }
    }
    const componentTraces = [...component.values()]
    const componentRays = componentTraces.filter((trace) => trace.opening.src === 'ray')
    const componentNonRays = componentTraces.filter(
      (trace) => trace.opening.src === 'pair' || trace.opening.src === 'frame',
    )
    if (componentRays.length !== 1 || componentRays[0]!.index !== candidateIndex) continue
    if (componentNonRays.length === 0) continue

    let invalidConnectedSource = false
    for (const other of openings) {
      if (other === candidate || other.type !== candidate.type) continue
      const otherIndex = openings.indexOf(other)
      if (component.has(otherIndex)) continue
      const otherTrace = sourceTraces[otherIndex]
      if (otherTrace) {
        if (
          componentTraces.some((member) =>
            sourceRectanglesBoundaryContact(otherTrace.rectangle, member.rectangle),
          )
        ) {
          invalidConnectedSource = true
          break
        }
        if (
          !allowedSourceKinds.has(other.src ?? '') &&
          componentTraces.some((member) =>
            sourceRectanglesOverlap(otherTrace.rectangle, member.rectangle),
          )
        ) {
          invalidConnectedSource = true
          break
        }
      } else if (
        componentTraces.some((member) => sourceOpeningSegmentTouchesTrace(other, toLevel, member))
      ) {
        invalidConnectedSource = true
        break
      }
    }
    if (invalidConnectedSource) continue

    const barrierA = toLevel(candidate.barrierA!)
    const barrierB = toLevel(candidate.barrierB!)
    const direction: Vec2 = [(rawB[0] - rawA[0]) / rawLength, (rawB[1] - rawA[1]) / rawLength]
    const barrierAAt = along(barrierA, rawA, direction)
    const barrierBAt = along(barrierB, rawA, direction)
    const supportCandidatesA = sourceSupportCandidates(barrierA)
    const supportCandidatesB = sourceSupportCandidates(barrierB)
    const supportA = uniqueSupport(supportCandidatesA)
    const supportB = uniqueSupport(supportCandidatesB)
    if (!supportA || !supportB || supportA.index === supportB.index) continue
    if (supportCandidatesA.some((a) => supportCandidatesB.some((b) => a.index === b.index)))
      continue
    if (
      !(
        (barrierAAt < -DUAL_JAMB_INTERVAL_EPS_M &&
          barrierBAt > rawLength + DUAL_JAMB_INTERVAL_EPS_M) ||
        (barrierBAt < -DUAL_JAMB_INTERVAL_EPS_M &&
          barrierAAt > rawLength + DUAL_JAMB_INTERVAL_EPS_M)
      )
    )
      continue

    const containedCompetitors = componentNonRays.map((trace) => trace.opening)
    const hasOutOfSpanMember = componentNonRays.some((trace) => {
      const memberAAt = along(trace.a, rawA, direction)
      const memberBAt = along(trace.b, rawA, direction)
      return (
        Math.min(memberAAt, memberBAt) < -DUAL_JAMB_INTERVAL_EPS_M ||
        Math.max(memberAAt, memberBAt) > rawLength + DUAL_JAMB_INTERVAL_EPS_M
      )
    })
    if (hasOutOfSpanMember) continue
    const everyMemberHasWitness = componentNonRays.every((member) =>
      componentNonRays.some(
        (other) =>
          other.index !== member.index &&
          (sourceTraceCenterlinesIntersect(member, other) ||
            isExactTranslatedFrameFamily(member, other)),
      ),
    )
    if (!everyMemberHasWitness) continue

    const supportIndices = new Set([
      ...supportCandidatesA.map((support) => support.index),
      ...supportCandidatesB.map((support) => support.index),
    ])
    const hasIntermediatePier = sourceSegs.some((seg, index) => {
      if (supportIndices.has(index)) return false
      return sourceFootprintPassageContact(rawA, rawB, seg) !== 'none'
    })
    if (hasIntermediatePier) continue

    const hostStart = barrierAAt < barrierBAt ? supportA.contact : supportB.contact
    const hostEnd = barrierAAt < barrierBAt ? supportB.contact : supportA.contact
    const hostDirection: Vec2 = [
      (hostEnd[0] - hostStart[0]) /
        segLen({ start: hostStart, end: hostEnd, th: expectedThickness }),
      (hostEnd[1] - hostStart[1]) /
        segLen({ start: hostStart, end: hostEnd, th: expectedThickness }),
    ]
    const hostLength = Math.hypot(hostEnd[0] - hostStart[0], hostEnd[1] - hostStart[1])
    if (hostLength < MIN_WALL_LENGTH_M) continue
    const rawHostA = along(rawA, hostStart, hostDirection)
    const rawHostB = along(rawB, hostStart, hostDirection)
    const rawLateralA = Math.abs(
      (rawA[0] - hostStart[0]) * hostDirection[1] - (rawA[1] - hostStart[1]) * hostDirection[0],
    )
    const rawLateralB = Math.abs(
      (rawB[0] - hostStart[0]) * hostDirection[1] - (rawB[1] - hostStart[1]) * hostDirection[0],
    )
    if (
      Math.min(rawHostA, rawHostB) < -DUAL_JAMB_INTERVAL_EPS_M ||
      Math.max(rawHostA, rawHostB) > hostLength + DUAL_JAMB_INTERVAL_EPS_M ||
      rawLateralA > DUAL_JAMB_INTERVAL_EPS_M ||
      rawLateralB > DUAL_JAMB_INTERVAL_EPS_M
    )
      continue

    candidates.push({
      winner: candidate,
      losers: containedCompetitors,
      start: hostStart,
      end: hostEnd,
      thickness: expectedThickness,
    })
  }

  return candidates.length === 1 ? candidates[0]! : null
}

/** Plan a synthesized host wall's endpoint crossings without mutating source
 * segments. The caller validates all proposed source extensions before commit. */
function extendToCrossingWalls(synth: Seg, segs: Seg[]): CrossingExtensionPlan | null {
  const dir = segDir(synth)
  const planned: Seg = {
    ...synth,
    start: [...synth.start],
    end: [...synth.end],
  }
  const extensions: CrossingExtension[] = []
  for (const endKey of ['start', 'end'] as const) {
    const outward: Vec2 = endKey === 'start' ? [-dir[0], -dir[1]] : dir
    const p = planned[endKey]
    let best: { point: Vec2; move: number; index: number; t: number } | null = null
    for (let index = 0; index < segs.length; index++) {
      const other = segs[index]!
      const cross = lineIntersection(planned, other)
      if (!cross) continue
      const t = along(cross, other.start, segDir(other))
      const reach = SNAP_MAX_MOVE_M
      if (t < -reach || t > segLen(other) + reach) continue
      const move = (cross[0] - p[0]) * outward[0] + (cross[1] - p[1]) * outward[1]
      if (move < -planned.th / 2 - 0.05 || move > 0.7) continue
      if (!best || move < best.move) best = { point: cross, move, index, t }
    }
    if (!best) return null
    planned[endKey] = [best.point[0], best.point[1]]
    const other = segs[best.index]!
    if (best.t < 0 || best.t > segLen(other)) {
      extensions.push({
        index: best.index,
        end: best.t < 0 ? 'start' : 'end',
        point: [...best.point],
      })
    }
  }
  return { start: planned.start, end: planned.end, extensions }
}

function sourceEndpointBucketKey(point: Vec2, offsetX = 0, offsetY = 0): string {
  return `${String(Math.floor(point[0] / SOURCE_ENDPOINT_EPS_M) + offsetX)},${String(Math.floor(point[1] / SOURCE_ENDPOINT_EPS_M) + offsetY)}`
}

function sourceEndpointPairKeys(a: Vec2, b: Vec2): string[] {
  const keys = new Set<string>()
  for (let firstOffsetX = -1; firstOffsetX <= 1; firstOffsetX++) {
    for (let firstOffsetY = -1; firstOffsetY <= 1; firstOffsetY++) {
      const first = sourceEndpointBucketKey(a, firstOffsetX, firstOffsetY)
      for (let secondOffsetX = -1; secondOffsetX <= 1; secondOffsetX++) {
        for (let secondOffsetY = -1; secondOffsetY <= 1; secondOffsetY++) {
          const second = sourceEndpointBucketKey(b, secondOffsetX, secondOffsetY)
          keys.add(first < second ? `${first}|${second}` : `${second}|${first}`)
        }
      }
    }
  }
  return [...keys]
}

function buildSourceEndpointPairIndex(segs: Seg[]): Map<string, number[]> {
  const index = new Map<string, number[]>()
  for (let i = 0; i < segs.length; i++) {
    for (const key of sourceEndpointPairKeys(segs[i]!.start, segs[i]!.end)) {
      const entries = index.get(key) ?? []
      entries.push(i)
      index.set(key, entries)
    }
  }
  return index
}

function sourcePointsMatch(a: Vec2, b: Vec2): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) <= SOURCE_ENDPOINT_EPS_M
}

function sourceChainRootPairKey(firstRoot: number, secondRoot: number): string {
  return firstRoot < secondRoot ? `${firstRoot}:${secondRoot}` : `${secondRoot}:${firstRoot}`
}

function sourceChainRelationKey(relation: RetainedSourceChain): string {
  return [relation.outerA, relation.bridgeA, relation.bridgeC, relation.outerC]
    .map(({ index, endpoint }) => `${index}:${endpoint}`)
    .join('|')
}

function sourceEndpointPoint(seg: Seg, endpoint: SourceEndpointName): Vec2 {
  return endpoint === 'start' ? seg.start : seg.end
}

function findFacingSourceEndpoints(
  firstIndex: number,
  secondIndex: number,
  segs: Seg[],
): { first: SourceEndpointRef; second: SourceEndpointRef } | null {
  const first = segs[firstIndex]!
  const second = segs[secondIndex]!
  const reference = segLen(first) >= segLen(second) ? first : second
  const anchor = reference.start
  const direction = segDir(reference)
  const firstStart = along(first.start, anchor, direction)
  const firstEnd = along(first.end, anchor, direction)
  const secondStart = along(second.start, anchor, direction)
  const secondEnd = along(second.end, anchor, direction)
  const firstLo = Math.min(firstStart, firstEnd)
  const firstHi = Math.max(firstStart, firstEnd)
  const secondLo = Math.min(secondStart, secondEnd)
  const secondHi = Math.max(secondStart, secondEnd)
  if (firstHi < secondLo - SOURCE_ENDPOINT_EPS_M) {
    return {
      first: { index: firstIndex, endpoint: firstEnd >= firstStart ? 'end' : 'start' },
      second: { index: secondIndex, endpoint: secondEnd <= secondStart ? 'end' : 'start' },
    }
  }
  if (secondHi < firstLo - SOURCE_ENDPOINT_EPS_M) {
    return {
      first: { index: firstIndex, endpoint: firstStart <= firstEnd ? 'start' : 'end' },
      second: { index: secondIndex, endpoint: secondStart >= secondEnd ? 'start' : 'end' },
    }
  }
  return null
}

function findRetainedSourceChain(
  firstIndex: number,
  secondIndex: number,
  segs: Seg[],
  endpointPairs: Map<string, number[]>,
): { relations: RetainedSourceChain[]; ambiguous: boolean } | null {
  const facing = findFacingSourceEndpoints(firstIndex, secondIndex, segs)
  if (!facing) return null
  const first = segs[firstIndex]!
  const second = segs[secondIndex]!
  const firstPoint = sourceEndpointPoint(first, facing.first.endpoint)
  const secondPoint = sourceEndpointPoint(second, facing.second.endpoint)
  if (sourcePointsMatch(firstPoint, secondPoint)) return null
  const candidates = new Set<number>()
  for (const key of sourceEndpointPairKeys(firstPoint, secondPoint)) {
    for (const candidateIndex of endpointPairs.get(key) ?? []) {
      if (candidateIndex === firstIndex || candidateIndex === secondIndex) continue
      const candidate = segs[candidateIndex]!
      const bridgeAEndpoint = sourcePointsMatch(candidate.start, firstPoint)
        ? 'start'
        : sourcePointsMatch(candidate.end, firstPoint)
          ? 'end'
          : null
      const bridgeCEndpoint = sourcePointsMatch(candidate.start, secondPoint)
        ? 'start'
        : sourcePointsMatch(candidate.end, secondPoint)
          ? 'end'
          : null
      if (!bridgeAEndpoint || !bridgeCEndpoint || bridgeAEndpoint === bridgeCEndpoint) continue
      if (isSameWallRun(first, candidate) || isSameWallRun(candidate, second)) continue
      candidates.add(candidateIndex)
    }
  }
  const relations = [...candidates].map<RetainedSourceChain>((bridgeIndex) => {
    const bridge = segs[bridgeIndex]!
    const bridgeAEndpoint: SourceEndpointName = sourcePointsMatch(bridge.start, firstPoint)
      ? 'start'
      : 'end'
    const bridgeCEndpoint: SourceEndpointName = sourcePointsMatch(bridge.start, secondPoint)
      ? 'start'
      : 'end'
    return {
      outerA: facing.first,
      bridgeA: { index: bridgeIndex, endpoint: bridgeAEndpoint },
      bridgeC: { index: bridgeIndex, endpoint: bridgeCEndpoint },
      outerC: facing.second,
      outerAPoint: [firstPoint[0], firstPoint[1]],
      outerCPoint: [secondPoint[0], secondPoint[1]],
    }
  })
  return {
    relations,
    ambiguous: candidates.size > 1,
  }
}

function relationMoveRejected(
  segment: Seg,
  endpoint: SourceEndpointName,
  target: Vec2,
  candidate: Seg,
): boolean {
  const held = segment.heldEndpoints?.[endpoint] ?? []
  const candidateSources = candidate.sourceIndices ?? []
  if (held.length === 0 || candidateSources.length === 0) return false
  return held.some((marker) => {
    const relation = marker.relation
    const oppositeOuter = marker.side === 'outer-a' ? relation.outerC : relation.outerA
    const candidateBelongsToRelation =
      candidateSources.includes(relation.bridgeA.index) ||
      candidateSources.includes(oppositeOuter.index)
    return candidateBelongsToRelation && !sourcePointsMatch(target, marker.point)
  })
}

function isSameWallRun(a: Seg, b: Seg): boolean {
  if (Math.abs(a.th - b.th) > MERGE_THICKNESS_TOL_M) return false
  if (segLen(a) < segLen(b)) [a, b] = [b, a]
  const da = segDir(a)
  const db = segDir(b)
  const alignment = Math.abs(da[0] * db[0] + da[1] * db[1])
  const latTol = Math.max(a.th, b.th) / 2
  const lateral = (p: Vec2) => Math.abs((p[0] - a.start[0]) * da[1] - (p[1] - a.start[1]) * da[0])
  if (lateral(b.start) > latTol || lateral(b.end) > latTol) return false
  if (
    alignment >= Math.cos((15 * Math.PI) / 180) &&
    [b.start, b.end].every((point) => {
      const t = along(point, a.start, da)
      return t >= 0 && t <= segLen(a)
    })
  )
    return true
  if (alignment < Math.cos((10 * Math.PI) / 180)) return false
  const t1a = along(a.start, a.start, da)
  const t1b = along(a.end, a.start, da)
  const t2a = along(b.start, a.start, da)
  const t2b = along(b.end, a.start, da)
  const gap =
    Math.max(Math.min(t1a, t1b), Math.min(t2a, t2b)) -
    Math.min(Math.max(t1a, t1b), Math.max(t2a, t2b))
  return gap <= MERGE_RUN_GAP_M
}

function isCollinearWith(seg: Seg, anchor: Vec2, dir: Vec2): boolean {
  const len = segLen(seg)
  if (len < 1e-6) return false
  const sdir: Vec2 = [(seg.end[0] - seg.start[0]) / len, (seg.end[1] - seg.start[1]) / len]
  if (Math.abs(sdir[0] * dir[0] + sdir[1] * dir[1]) < Math.cos((10 * Math.PI) / 180)) return false
  const lateral = (a: Vec2) => Math.abs((a[0] - anchor[0]) * dir[1] - (a[1] - anchor[1]) * dir[0])
  return (
    lateral(seg.start) <= seg.th / 2 + FLANK_LATERAL_M &&
    lateral(seg.end) <= seg.th / 2 + FLANK_LATERAL_M
  )
}

function isFiniteVec2(value: readonly number[]): value is Vec2 {
  return value.length === 2 && value.every((component) => Number.isFinite(component))
}

function isValidAptPlanImportFrame(frame: AptPlanImportFrame): boolean {
  if (
    frame.position &&
    (frame.position.length !== 3 || frame.position.some((component) => !Number.isFinite(component)))
  )
    return false
  if (frame.rotationY !== undefined && !Number.isFinite(frame.rotationY)) return false
  if (frame.scale !== undefined && (!Number.isFinite(frame.scale) || frame.scale <= 0)) return false
  return true
}

function openingMetadata(
  opening: AptVectorDoc['openings'][number],
  width: number,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    source: 'apt-vector',
    sourceOpeningId: opening.id,
    sourceOpeningType: opening.type,
    sourceWidthMm:
      isFiniteVec2(opening.a) && isFiniteVec2(opening.b)
        ? Math.hypot(opening.b[0] - opening.a[0], opening.b[1] - opening.a[1])
        : width * 1000,
  }
  if (opening.src) metadata.sourceOpeningSource = opening.src
  if (opening.hinge && isFiniteVec2(opening.hinge)) metadata.sourceHinge = opening.hinge
  if (Number.isFinite(opening.radius)) metadata.sourceRadius = opening.radius
  return metadata
}

function clampOpeningWidth(type: 'door' | 'window' | 'opening', width: number): number | null {
  const [min, max] =
    type === 'door'
      ? ([0.4, 1.6] as const)
      : type === 'window'
        ? ([0.3, 6] as const)
        : ([0.4, 4] as const)
  const lowerBound = type === 'opening' ? 0.05 : min
  if (!Number.isFinite(width) || width < lowerBound) return null
  return clamp(width, lowerBound, max)
}

function isExistingOpeningWidthPolicyIdentity(
  type: 'door' | 'window' | 'opening',
  width: number,
): boolean {
  const admitted = clampOpeningWidth(type, width)
  return admitted !== null && Math.abs(admitted - width) <= DUAL_JAMB_INTERVAL_EPS_M
}

function isExistingWallThicknessPolicyIdentity(thickness: number): boolean {
  if (!Number.isFinite(thickness) || thickness <= 0) return false
  return Math.abs(clamp(thickness, 0.05, 0.6) - thickness) <= DUAL_JAMB_INTERVAL_EPS_M
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

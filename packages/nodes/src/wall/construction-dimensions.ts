import {
  type AnyNode,
  type AnyNodeId,
  type ColumnNode,
  type DoorNode,
  detectSpacesForLevel,
  type FloorplanDimensionEditDescriptor,
  type FloorplanDimensionEditLeaf,
  type FloorplanGeometry,
  type FloorplanPoint,
  type GeometryContext,
  getWallArcData,
  getWallChordFrame,
  getWallMidpointHandlePoint,
  getWallThickness,
  isCurvedWall,
  type WallNode,
  type WindowNode,
} from '@pascal-app/core'
import { getColumnFloorplanFootprint } from '../column/floorplan'
import {
  type ConstructionDimensionDrawingStandard,
  DEFAULT_CONSTRUCTION_DIMENSION_STANDARD,
} from '../shared/construction-dimension-standards'
import {
  type ConstructionLengthProfile,
  type ConstructionLinearUnit,
  formatConstructionLength,
} from '../shared/construction-length'
import { buildDimensionStringGeometry } from '../shared/dimension-string'
import { resolveOpeningDimensionDocumentation } from '../shared/opening-documentation'
import { buildRoomClearDimensions } from '../zone/room-clear-dimensions'

export { formatConstructionLength } from '../shared/construction-length'

const MIN_SEGMENT_LENGTH = 0.02
const FACADE_LINE_TOLERANCE = 0.03
const FACADE_DIRECTION_TOLERANCE = 0.001
const COLUMN_ROW_TOLERANCE = 0.05
const EXTERIOR_CORNER_DATUM_POLICY = 'structural-face' as const

type OpeningNode = DoorNode | WindowNode

export type ConstructionDimensionTier =
  | 'opening-widths'
  | 'openings'
  | 'partitions'
  | 'structure'
  | 'jogs'
  | 'overall'
  | 'structural-overall'
  | 'interior'
  | 'interior-overall'

const TIER_ORDER: readonly ConstructionDimensionTier[] = [
  'opening-widths',
  'openings',
  'partitions',
  'structure',
  'jogs',
  'overall',
  'structural-overall',
]

export type PlannedConstructionDimension = {
  tier: ConstructionDimensionTier
  start: FloorplanPoint
  end: FloorplanPoint
  dimensionStart?: FloorplanPoint
  dimensionEnd?: FloorplanPoint
  offsetNormal: FloorplanPoint
  offsetDistance: number
  textPrefix?: string
  editDescriptor?: FloorplanDimensionEditDescriptor
}

export type WallConstructionDimensionPlan = ReadonlyMap<
  string,
  readonly PlannedConstructionDimension[]
>

type FacadeMember = {
  wall: WallNode
  normal: FloorplanPoint
  tangent: FloorplanPoint
}

type PendingConstructionDimension = {
  tier: ConstructionDimensionTier
  start: FloorplanPoint
  end: FloorplanPoint
  startProjection: number
  endProjection: number
  textPrefix?: string
  wallIds?: readonly AnyNodeId[]
  opening?: {
    openingId: AnyNodeId
    reference: 'nominal' | 'rough-opening' | 'masonry-opening' | 'finish-opening'
    displayedField: 'width' | 'roughOpeningWidth' | 'masonryOpeningWidth' | 'finishOpeningWidth'
    documentedOffset?: number
  }
  openingLength?: number
  openingFullyContained?: boolean
}

type PhysicalOpeningSpan = {
  start: number
  end: number
  opening: OpeningNode
  fullyContained: boolean
}

const CHAIN_PROJECTION_EPSILON = 1e-8
const CANONICAL_CHAIN_TIER_ORDER: readonly ConstructionDimensionTier[] = [
  'openings',
  'partitions',
  'jogs',
  'structure',
  'opening-widths',
]

export function buildLevelWallConstructionDimensionPlan(
  walls: ReadonlyArray<WallNode>,
  nodes: Record<string, AnyNode>,
  standard: ConstructionDimensionDrawingStandard = DEFAULT_CONSTRUCTION_DIMENSION_STANDARD,
): WallConstructionDimensionPlan {
  const effectiveWalls = effectiveWallSides(walls)
  const dimensionsByWallId = new Map<string, PlannedConstructionDimension[]>()
  const wallNetworkById = buildWallNetworkIndex(effectiveWalls)
  const interiorWallIds = new Set(
    effectiveWalls.flatMap((wall) => {
      if (isCurvedWall(wall)) return []
      const network = wallNetworkById.get(wall.id) ?? [wall]
      return shouldDimensionInteriorWall(wall, effectiveWalls, network) ? [wall.id] : []
    }),
  )
  const exteriorMembers = effectiveWalls.flatMap((wall): FacadeMember[] => {
    if (isCurvedWall(wall) || interiorWallIds.has(wall.id)) return []
    const normal = exteriorNormal(wall)
    if (!normal) return []
    const network = wallNetworkById.get(wall.id) ?? [wall]
    if (isFacadeOccluded(wall, normal, network)) return []
    return [{ wall, normal, tangent: [cleanZero(normal[1]), cleanZero(-normal[0])] }]
  })
  const columns = Object.values(nodes).filter(
    (node): node is ColumnNode => node.type === 'column' && node.visible !== false,
  )

  const components = splitConnectedFacadeComponents(exteriorMembers, wallNetworkById)
  for (const component of components) {
    const directionGroups = groupFacadeMembersByDirection(component)
    const componentColumns = columns.filter(
      (column) =>
        column.parentId === component[0]?.wall.parentId &&
        nearestFacadeComponent(column, components) === component,
    )

    for (const directionMembers of directionGroups.values()) {
      const representative = [...directionMembers].sort((left, right) =>
        String(left.wall.id).localeCompare(String(right.wall.id)),
      )[0]
      if (!representative) continue
      const { normal, tangent } = representative
      const wallProjections = directionMembers.flatMap(({ wall }) => [
        dot(wall.start, tangent),
        dot(wall.end, tangent),
      ])
      const network =
        wallNetworkById.get(representative.wall.id) ?? directionMembers.map(({ wall }) => wall)
      const [extentStart, extentEnd] = facadeStructuralExtents(
        directionMembers,
        isAxisAlignedDirection(tangent) ? network : effectiveWalls,
        tangent,
        isAxisAlignedDirection(tangent) ? network : undefined,
      )
      if (extentEnd - extentStart < MIN_SEGMENT_LENGTH) continue

      const outerFaceCoordinate = Math.max(
        ...directionMembers.map(({ wall }) =>
          exteriorFaceCoordinate(wall, normal, EXTERIOR_CORNER_DATUM_POLICY),
        ),
        ...curvedFacadeOuterFaceCoordinates(
          effectiveWalls,
          directionMembers,
          normal,
          EXTERIOR_CORNER_DATUM_POLICY,
        ),
      )
      const pending: PendingConstructionDimension[] = []
      const lineGroups = groupFacadeMembersByLine(directionMembers, normal)
      const continuityOriginAt = (projection: number): FloorplanPoint =>
        pointFromCoordinates(projection, outerFaceCoordinate, tangent, normal)
      let facadeRunCount = 0

      for (const groupedMembers of lineGroups.values()) {
        const runs = splitFacadeRuns(groupedMembers)
        facadeRunCount += runs.length
        for (const run of runs) {
          appendFacadeRunDimensions(
            pending,
            run,
            effectiveWalls,
            nodes,
            interiorWallIds,
            normal,
            tangent,
            standard,
          )
        }
      }

      for (const tier of ['openings', 'partitions'] as const) {
        ensureProjectedTierContinuity(pending, tier, extentStart, extentEnd, continuityOriginAt)
      }

      if (lineGroups.size > 1 || facadeRunCount > lineGroups.size) {
        const jogProjections = uniqueSorted(wallProjections)
        appendProjectedChain(
          pending,
          jogProjections,
          'jogs',
          (projection) =>
            exteriorOriginAtProjection(
              directionMembers,
              projection,
              tangent,
              normal,
              EXTERIOR_CORNER_DATUM_POLICY,
            ),
          directionMembers.map(({ wall }) => wall.id),
        )
      }
      ensureProjectedTierContinuity(pending, 'jogs', extentStart, extentEnd, continuityOriginAt)

      const exteriorColumns = componentColumns.filter(
        (column) =>
          dot(columnPlanPoint(column), normal) + columnNormalHalfExtent(column, normal) >=
          outerFaceCoordinate - FACADE_LINE_TOLERANCE,
      )
      const structureRow = outermostColumnRow(exteriorColumns, component, normal, tangent)
      if (structureRow.length >= 2) {
        const projections = uniqueSorted(
          structureRow.map((column) => dot(columnPlanPoint(column), tangent)),
        )
        appendProjectedChain(
          pending,
          projections,
          'structure',
          (projection) => columnOriginAtProjection(structureRow, projection, tangent),
          [],
        )
      }

      pending.push({
        tier: 'overall',
        start: exteriorOriginAtProjection(
          directionMembers,
          extentStart,
          tangent,
          normal,
          EXTERIOR_CORNER_DATUM_POLICY,
        ),
        end: exteriorOriginAtProjection(
          directionMembers,
          extentEnd,
          tangent,
          normal,
          EXTERIOR_CORNER_DATUM_POLICY,
        ),
        startProjection: extentStart,
        endProjection: extentEnd,
        wallIds: directionMembers.map(({ wall }) => wall.id),
      })

      const structuralProjections = structureRow.map((column) =>
        dot(columnPlanPoint(column), tangent),
      )
      const structuralStart = Math.min(extentStart, ...structuralProjections)
      const structuralEnd = Math.max(extentEnd, ...structuralProjections)
      if (
        structureRow.length >= 2 &&
        (structuralStart < extentStart - MIN_SEGMENT_LENGTH ||
          structuralEnd > extentEnd + MIN_SEGMENT_LENGTH)
      ) {
        pending.push({
          tier: 'structural-overall',
          start:
            structuralStart < extentStart - MIN_SEGMENT_LENGTH
              ? columnOriginAtProjection(structureRow, structuralStart, tangent)
              : exteriorOriginAtProjection(
                  directionMembers,
                  extentStart,
                  tangent,
                  normal,
                  EXTERIOR_CORNER_DATUM_POLICY,
                ),
          end:
            structuralEnd > extentEnd + MIN_SEGMENT_LENGTH
              ? columnOriginAtProjection(structureRow, structuralEnd, tangent)
              : exteriorOriginAtProjection(
                  directionMembers,
                  extentEnd,
                  tangent,
                  normal,
                  EXTERIOR_CORNER_DATUM_POLICY,
                ),
          startProjection: structuralStart,
          endProjection: structuralEnd,
          wallIds: [],
        })
      }

      const structuralFaceCoordinate = Math.max(
        outerFaceCoordinate,
        ...structureRow.map(
          (column) => dot(columnPlanPoint(column), normal) + columnNormalHalfExtent(column, normal),
        ),
      )
      const directionWallIds = directionMembers
        .map(({ wall }) => wall.id)
        .sort((left, right) => String(left).localeCompare(String(right)))
      dimensionsByWallId.set(
        representative.wall.id,
        finalizeDimensionTiers(
          pending,
          tangent,
          normal,
          structuralFaceCoordinate,
          standard,
          (representative.wall.parentId ?? representative.wall.id) as AnyNodeId,
          directionWallIds,
          constructionGeneratorKey(standard, 'facade'),
        ),
      )
    }
  }

  const roomClearCoverageWallIds = findRoomClearCoverageWallIds(effectiveWalls, nodes)
  for (const wall of effectiveWalls) {
    if (isCurvedWall(wall)) continue
    const openings = hostedOpeningsForWall(wall, nodes)
    const roomSideNormal = interiorWallIds.has(wall.id)
      ? undefined
      : enclosedRoomSideNormal(wall, walls)
    if (!interiorWallIds.has(wall.id) && (openings.length === 0 || roomSideNormal === null)) {
      continue
    }
    if (
      interiorWallIds.has(wall.id) &&
      openings.length === 0 &&
      roomClearCoverageWallIds.has(wall.id)
    ) {
      continue
    }
    const planned = buildInteriorWallDimensions(
      wall,
      effectiveWalls,
      openings,
      standard,
      roomSideNormal,
    )
    if (planned.length === 0) continue
    dimensionsByWallId.set(wall.id, [...(dimensionsByWallId.get(wall.id) ?? []), ...planned])
  }

  return dimensionsByWallId
}

function effectiveWallSides(walls: ReadonlyArray<WallNode>): WallNode[] {
  const byLevel = new Map<string, WallNode[]>()
  for (const wall of walls) {
    const levelId = String(wall.parentId ?? '')
    const levelWalls = byLevel.get(levelId)
    if (levelWalls) levelWalls.push(wall)
    else byLevel.set(levelId, [wall])
  }

  const updates = new Map<
    string,
    { frontSide: WallNode['frontSide']; backSide: WallNode['backSide'] }
  >()
  for (const [levelId, levelWalls] of byLevel) {
    for (const update of detectSpacesForLevel(levelId, levelWalls).wallUpdates) {
      updates.set(update.wallId, update)
    }
  }

  return walls.map((wall) => {
    const update = updates.get(wall.id)
    if (!update) return wall
    const frontSide = update.frontSide === 'unknown' ? wall.frontSide : update.frontSide
    const backSide = update.backSide === 'unknown' ? wall.backSide : update.backSide
    if (frontSide === wall.frontSide && backSide === wall.backSide) return wall
    return { ...wall, frontSide, backSide }
  })
}

function findRoomClearCoverageWallIds(
  walls: ReadonlyArray<WallNode>,
  nodes: Record<string, AnyNode>,
): Set<string> {
  const coveredWallIds = new Set<string>()
  const effectiveNodes = {
    ...nodes,
    ...Object.fromEntries(walls.map((wall) => [wall.id, wall])),
  } as Record<string, AnyNode>
  const context: GeometryContext = {
    resolve: <N = AnyNode>(id: AnyNodeId) => effectiveNodes[String(id)] as N | undefined,
    children: [],
    siblings: [],
    parent: null,
  }

  for (const node of Object.values(effectiveNodes)) {
    if (node.type !== 'zone' || !node.parentId) continue
    for (const geometry of buildRoomClearDimensions(node, context)) {
      if (!('editDescriptor' in geometry) || !geometry.editDescriptor) continue
      for (const leaf of geometry.editDescriptor.leaves) {
        for (const wallId of leaf.wallIds) coveredWallIds.add(String(wallId))
      }
    }
  }

  return coveredWallIds
}

function buildInteriorWallDimensions(
  wall: WallNode,
  walls: ReadonlyArray<WallNode>,
  openings: readonly OpeningNode[],
  standard: ConstructionDimensionDrawingStandard,
  normalOverride?: FloorplanPoint | null,
): PlannedConstructionDimension[] {
  const levelId = (wall.parentId ?? wall.id) as AnyNodeId
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const wallLength = Math.hypot(dx, dz)
  if (wallLength < MIN_SEGMENT_LENGTH) return []

  const tangent: FloorplanPoint = [dx / wallLength, dz / wallLength]
  const [spanStart, spanEnd] = interiorWallClearSpan(
    wall,
    walls,
    tangent,
    wallLength,
    standard.datumPolicy,
  )
  if (spanEnd - spanStart < MIN_SEGMENT_LENGTH) return []
  const normal = normalOverride ?? resolveInteriorDimensionNormal(wall, walls, tangent)
  const datumDistance = wallDatumDistanceToward(wall, standard.datumPolicy, normal)
  const pointAt = (along: number): FloorplanPoint => [
    wall.start[0] + tangent[0] * along + normal[0] * datumDistance,
    wall.start[1] + tangent[1] * along + normal[1] * datumDistance,
  ]
  const openingSpans: PhysicalOpeningSpan[] = openings.flatMap((opening) => {
    const halfWidth = Math.max(0, opening.width) / 2
    const rawStart = opening.position[0] - halfWidth
    const rawEnd = opening.position[0] + halfWidth
    const start = clamp(rawStart, spanStart, spanEnd)
    const end = clamp(rawEnd, spanStart, spanEnd)
    return end - start >= MIN_SEGMENT_LENGTH
      ? [
          {
            start,
            end,
            opening,
            fullyContained:
              rawStart >= spanStart - CHAIN_PROJECTION_EPSILON &&
              rawEnd <= spanEnd + CHAIN_PROJECTION_EPSILON,
          },
        ]
      : []
  })

  const planned: PlannedConstructionDimension[] = []
  if (openingSpans.length > 0) {
    const breakpoints = uniqueSorted([
      spanStart,
      spanEnd,
      ...openingSpans.flatMap(({ start, end }) => [start, end]),
    ])
    for (let index = 0; index < breakpoints.length - 1; index++) {
      const start = breakpoints[index]
      const end = breakpoints[index + 1]
      if (start === undefined || end === undefined || end - start < MIN_SEGMENT_LENGTH) continue
      const openingSpan = openingSpans.find(
        (span) => Math.abs(span.start - start) <= 1e-6 && Math.abs(span.end - end) <= 1e-6,
      )
      const measuredStart = pointAt(start)
      const measuredEnd = pointAt(end)
      const openingProvenance = openingSpan?.fullyContained
        ? nominalOpeningProvenance(openingSpan.opening)
        : undefined
      const leaf = makeDimensionLeaf(
        `${levelId}:wall:${wall.id}:interior:${start}:${end}`,
        measuredStart,
        measuredEnd,
        [wall.id],
        openingProvenance,
        openingProvenance
          ? `${levelId}:wall:${wall.id}:interior:opening:${openingProvenance.openingId}`
          : `${levelId}:wall:${wall.id}:interior:leaf:${index}`,
      )
      planned.push({
        tier: 'interior',
        start: measuredStart,
        end: measuredEnd,
        offsetNormal: normal,
        offsetDistance: standard.openingChainOffset,
        editDescriptor: makeDimensionDescriptor({
          id: leaf.id,
          sourceNodeId: wall.id,
          chainId: `${levelId}:wall:${wall.id}:interior`,
          semanticKey: openingProvenance
            ? `${levelId}:wall:${wall.id}:interior:opening:${openingProvenance.openingId}`
            : `${levelId}:wall:${wall.id}:interior:leaf:${index}`,
          generatorKey: constructionGeneratorKey(standard, 'interior-wall'),
          levelId,
          kind: openingProvenance ? 'opening-width' : 'leaf',
          measuredStart,
          measuredEnd,
          leaves: [leaf],
          wallIds: [wall.id],
          opening: openingProvenance,
        }),
      })
    }
  }

  const overallStart = pointAt(spanStart)
  const overallEnd = pointAt(spanEnd)
  const overallLeaves = buildPhysicalTotalLeaves(
    levelId,
    wall.id,
    spanStart,
    spanEnd,
    pointAt,
    openingSpans,
    `${levelId}:wall:${wall.id}:interior`,
  )
  planned.push({
    tier: 'interior-overall',
    start: overallStart,
    end: overallEnd,
    offsetNormal: normal,
    offsetDistance: openingSpans.length > 0 ? standard.wallSpanOffset : standard.openingChainOffset,
    editDescriptor: makeDimensionDescriptor({
      id: `${levelId}:wall:${wall.id}:interior-overall:${spanStart}:${spanEnd}`,
      sourceNodeId: wall.id,
      chainId: `${levelId}:wall:${wall.id}:interior`,
      semanticKey: `${levelId}:wall:${wall.id}:interior:total`,
      generatorKey: constructionGeneratorKey(standard, 'interior-wall'),
      levelId,
      kind: 'total',
      measuredStart: overallStart,
      measuredEnd: overallEnd,
      leaves:
        overallLeaves.length > 0
          ? overallLeaves
          : [
              makeDimensionLeaf(
                `${levelId}:wall:${wall.id}:interior-overall:leaf`,
                overallStart,
                overallEnd,
                [wall.id],
                undefined,
                `${levelId}:wall:${wall.id}:interior:leaf:0`,
              ),
            ],
      wallIds: [wall.id],
    }),
  })
  return planned
}

function buildPhysicalTotalLeaves(
  levelId: AnyNodeId,
  wallId: AnyNodeId,
  spanStart: number,
  spanEnd: number,
  pointAt: (along: number) => FloorplanPoint,
  openingSpans: readonly PhysicalOpeningSpan[],
  chainId: string,
): FloorplanDimensionEditLeaf[] {
  const breakpoints = uniqueSorted([
    spanStart,
    spanEnd,
    ...openingSpans.flatMap(({ start, end }) => [start, end]),
  ])
  const leaves: FloorplanDimensionEditLeaf[] = []
  for (let index = 0; index < breakpoints.length - 1; index += 1) {
    const start = breakpoints[index]
    const end = breakpoints[index + 1]
    if (start === undefined || end === undefined || end - start <= CHAIN_PROJECTION_EPSILON) {
      continue
    }
    const openingSpan = openingSpans.find(
      (span) =>
        Math.abs(span.start - start) <= CHAIN_PROJECTION_EPSILON &&
        Math.abs(span.end - end) <= CHAIN_PROJECTION_EPSILON,
    )
    const opening = openingSpan?.fullyContained
      ? nominalOpeningProvenance(openingSpan.opening)
      : undefined
    const measuredStart = pointAt(start)
    const measuredEnd = pointAt(end)
    leaves.push(
      makeDimensionLeaf(
        `${levelId}:wall:${wallId}:${chainId.endsWith(':exterior') ? 'exterior' : 'interior'}-overall:${start}:${end}`,
        measuredStart,
        measuredEnd,
        [wallId],
        opening,
        opening ? `${chainId}:opening:${opening.openingId}` : `${chainId}:leaf:${index}`,
      ),
    )
  }
  return leaves
}

function interiorWallClearSpan(
  wall: WallNode,
  walls: ReadonlyArray<WallNode>,
  tangent: FloorplanPoint,
  wallLength: number,
  datumPolicy: ConstructionDimensionDrawingStandard['datumPolicy'],
): readonly [number, number] {
  const insetAt = (endpoint: FloorplanPoint, inward: FloorplanPoint): number => {
    let inset = 0
    for (const candidate of walls) {
      if (
        candidate.id === wall.id ||
        isCurvedWall(candidate) ||
        pointSegmentDistance(endpoint, candidate.start, candidate.end) > FACADE_LINE_TOLERANCE
      ) {
        continue
      }
      const candidateDirection = subtract(candidate.end, candidate.start)
      const candidateLength = Math.hypot(candidateDirection[0], candidateDirection[1])
      if (candidateLength < MIN_SEGMENT_LENGTH) continue
      const candidateNormal: FloorplanPoint = [
        -candidateDirection[1] / candidateLength,
        candidateDirection[0] / candidateLength,
      ]
      const crossing = Math.abs(dot(inward, candidateNormal))
      if (crossing < FACADE_DIRECTION_TOLERANCE) continue
      inset = Math.max(inset, maximumWallDatumDistance(candidate, datumPolicy) / crossing)
    }
    return inset
  }

  const spanStart = clamp(insetAt(wall.start, tangent), 0, wallLength)
  const spanEnd = clamp(wallLength - insetAt(wall.end, negate(tangent)), spanStart, wallLength)
  return [spanStart, spanEnd]
}

export function renderPlannedConstructionDimensions(
  planned: readonly PlannedConstructionDimension[],
  unit: ConstructionLinearUnit,
  stroke?: string,
  profile: ConstructionLengthProfile = 'editor',
  standard: ConstructionDimensionDrawingStandard = DEFAULT_CONSTRUCTION_DIMENSION_STANDARD,
): FloorplanGeometry[] {
  return groupContiguousPlannedDimensions(planned).map((entries) => {
    const first = entries[0]!
    return buildDimensionStringGeometry({
      segments: entries.map((entry) => ({
        witnessStart: entry.start,
        witnessEnd: entry.end,
        dimensionStart: entry.dimensionStart,
        dimensionEnd: entry.dimensionEnd,
        editDescriptor: entry.editDescriptor,
        text: constructionDimensionText(
          entry.dimensionStart ?? entry.start,
          entry.dimensionEnd ?? entry.end,
          unit,
          profile,
          standard,
          entry.textPrefix,
        ),
      })),
      offsetNormal: first.offsetNormal,
      offsetDistance: first.offsetDistance,
      extensionStartGap: standard.extensionStartGap,
      extensionOvershoot: standard.extensionOvershoot,
      terminator: standard.terminator,
      textPosition: standard.textPosition,
      stroke,
    })
  })
}

function groupContiguousPlannedDimensions(
  planned: readonly PlannedConstructionDimension[],
): PlannedConstructionDimension[][] {
  const groups: PlannedConstructionDimension[][] = []
  for (const entry of planned) {
    const group = groups.at(-1)
    const previous = group?.at(-1)
    if (group && previous && plannedDimensionsAreContiguous(previous, entry)) group.push(entry)
    else groups.push([entry])
  }
  return groups
}

function plannedDimensionsAreContiguous(
  previous: PlannedConstructionDimension,
  next: PlannedConstructionDimension,
): boolean {
  return (
    previous.tier === next.tier &&
    distance(previous.offsetNormal, next.offsetNormal) <= 1e-6 &&
    distance(plannedDimensionEnd(previous), plannedDimensionStart(next)) <= 1e-6
  )
}

function plannedDimensionStart(entry: PlannedConstructionDimension): FloorplanPoint {
  return entry.dimensionStart ?? addScaled(entry.start, entry.offsetNormal, entry.offsetDistance)
}

function plannedDimensionEnd(entry: PlannedConstructionDimension): FloorplanPoint {
  return entry.dimensionEnd ?? addScaled(entry.end, entry.offsetNormal, entry.offsetDistance)
}

export function buildCurvedWallConstructionDimensions(
  wall: WallNode,
  {
    unit,
    stroke,
    profile = 'editor',
    standard = DEFAULT_CONSTRUCTION_DIMENSION_STANDARD,
    siblings = [],
  }: {
    unit: ConstructionLinearUnit
    stroke?: string
    profile?: ConstructionLengthProfile
    standard?: ConstructionDimensionDrawingStandard
    siblings?: ReadonlyArray<WallNode>
  },
): FloorplanGeometry[] {
  const levelId = (wall.parentId ?? wall.id) as AnyNodeId
  const chord = getWallChordFrame(wall)
  const midpoint = getWallMidpointHandlePoint(wall)
  const curveVector: FloorplanPoint = [midpoint.x - chord.midpoint.x, midpoint.y - chord.midpoint.y]
  const curveDepth = Math.hypot(curveVector[0], curveVector[1])
  if (chord.length < MIN_SEGMENT_LENGTH || curveDepth < MIN_SEGMENT_LENGTH) return []

  const curveDirection: FloorplanPoint = [curveVector[0] / curveDepth, curveVector[1] / curveDepth]
  const tangent: FloorplanPoint = [chord.tangent.x, chord.tangent.y]
  const datumDistance = wallDatumDistanceToward(wall, standard.datumPolicy, curveDirection)
  const curveWitness = addScaled([midpoint.x, midpoint.y], curveDirection, datumDistance)
  const chordWitness = addScaled(wall.end, curveDirection, datumDistance)
  const connectedWalls = connectedWallComponent(wall, [wall, ...siblings])
  const forwardExtent = Math.max(
    ...connectedWalls.flatMap((candidate) => [
      dot(candidate.start, tangent),
      dot(candidate.end, tangent),
    ]),
  )
  const baselineProjection = forwardExtent + standard.firstGeneralTierOffset
  const dimensionStart = pointFromCoordinates(
    baselineProjection,
    dot(curveWitness, curveDirection),
    tangent,
    curveDirection,
  )
  const dimensionEnd = pointFromCoordinates(
    baselineProjection,
    dot(chordWitness, curveDirection),
    tangent,
    curveDirection,
  )

  return [
    dimension(
      curveWitness,
      chordWitness,
      tangent,
      Math.max(0, dot(subtract(dimensionStart, curveWitness), tangent)),
      unit,
      stroke,
      dimensionStart,
      dimensionEnd,
      profile,
      standard,
      undefined,
      makeDimensionDescriptor({
        id: `${levelId}:wall:${wall.id}:curved-depth`,
        sourceNodeId: wall.id,
        chainId: `${levelId}:wall:${wall.id}:curved-depth`,
        generatorKey: 'curved-wall-depth',
        levelId,
        kind: 'leaf',
        measuredStart: curveWitness,
        measuredEnd: chordWitness,
        leaves: [
          makeDimensionLeaf(
            `${levelId}:wall:${wall.id}:curved-depth:leaf`,
            curveWitness,
            chordWitness,
            [wall.id],
          ),
        ],
        wallIds: [wall.id],
        readOnlyReason: '곡선 벽의 호 깊이는 직접 수정할 수 없습니다.',
        readOnlyReasonCode: 'curved-wall',
      }),
    ),
  ]
}

export function buildWallConstructionDimensions(
  wall: WallNode,
  ctx: GeometryContext,
  {
    unit,
    stroke,
    profile = 'editor',
    standard = DEFAULT_CONSTRUCTION_DIMENSION_STANDARD,
  }: {
    unit: ConstructionLinearUnit
    stroke?: string
    profile?: ConstructionLengthProfile
    standard?: ConstructionDimensionDrawingStandard
  },
): FloorplanGeometry[] {
  const levelId = (wall.parentId ?? wall.id) as AnyNodeId
  if (isCurvedWall(wall)) return []

  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const wallLength = Math.hypot(dx, dz)
  if (wallLength < MIN_SEGMENT_LENGTH) return []

  const sideIsClassified = wall.frontSide !== 'unknown' || wall.backSide !== 'unknown'
  const isExterior = wall.frontSide === 'exterior' || wall.backSide === 'exterior'
  if (sideIsClassified && !isExterior) return []

  const dirX = dx / wallLength
  const dirZ = dz / wallLength
  const outwardNormal = resolveOutwardNormal(wall, ctx, dirX, dirZ)
  const datumDistance = wallDatumDistanceToward(wall, standard.datumPolicy, outwardNormal)
  const pointAt = (along: number): FloorplanPoint => [
    wall.start[0] + dirX * along + outwardNormal[0] * datumDistance,
    wall.start[1] + dirZ * along + outwardNormal[1] * datumDistance,
  ]

  const openings: PhysicalOpeningSpan[] = ctx.children
    .filter((child): child is OpeningNode => child.type === 'door' || child.type === 'window')
    .flatMap((opening) => {
      const halfWidth = Math.max(0, opening.width) / 2
      const rawStart = opening.position[0] - halfWidth
      const rawEnd = opening.position[0] + halfWidth
      const start = clamp(rawStart, 0, wallLength)
      const end = clamp(rawEnd, 0, wallLength)
      return end - start >= MIN_SEGMENT_LENGTH
        ? [
            {
              start,
              end,
              opening,
              fullyContained:
                rawStart >= -CHAIN_PROJECTION_EPSILON &&
                rawEnd <= wallLength + CHAIN_PROJECTION_EPSILON,
            },
          ]
        : []
    })

  const dimensions: FloorplanGeometry[] = []
  if (openings.length > 0) {
    const breakpoints = uniqueSorted([
      0,
      wallLength,
      ...openings.flatMap(({ start, end }) => [start, end]),
    ])
    for (let index = 0; index < breakpoints.length - 1; index++) {
      const start = breakpoints[index]!
      const end = breakpoints[index + 1]!
      if (end - start < MIN_SEGMENT_LENGTH) continue
      const measuredStart = pointAt(start)
      const measuredEnd = pointAt(end)
      const openingSpan = openings.find(
        (span) => Math.abs(span.start - start) <= 1e-6 && Math.abs(span.end - end) <= 1e-6,
      )
      const openingProvenance = openingSpan?.fullyContained
        ? nominalOpeningProvenance(openingSpan.opening)
        : undefined
      const leaf = makeDimensionLeaf(
        `${levelId}:wall:${wall.id}:exterior:${start}:${end}`,
        measuredStart,
        measuredEnd,
        [wall.id],
        openingProvenance,
        openingProvenance
          ? `${levelId}:wall:${wall.id}:exterior:opening:${openingProvenance.openingId}`
          : `${levelId}:wall:${wall.id}:exterior:leaf:${index}`,
      )
      dimensions.push(
        dimension(
          measuredStart,
          measuredEnd,
          outwardNormal,
          standard.openingChainOffset,
          unit,
          stroke,
          undefined,
          undefined,
          profile,
          standard,
          undefined,
          makeDimensionDescriptor({
            id: leaf.id,
            sourceNodeId: wall.id,
            chainId: `${levelId}:wall:${wall.id}:exterior`,
            generatorKey: constructionGeneratorKey(standard, 'exterior-wall'),
            semanticKey: leaf.semanticKey,
            levelId,
            kind: openingProvenance ? 'opening-width' : 'leaf',
            measuredStart,
            measuredEnd,
            leaves: [leaf],
            wallIds: [wall.id],
            opening: openingProvenance,
          }),
        ),
      )
    }
  }

  const totalStart = pointAt(0)
  const totalEnd = pointAt(wallLength)
  const totalLeaves = buildPhysicalTotalLeaves(
    levelId,
    wall.id,
    0,
    wallLength,
    pointAt,
    openings,
    `${levelId}:wall:${wall.id}:exterior`,
  )
  dimensions.push(
    dimension(
      totalStart,
      totalEnd,
      outwardNormal,
      openings.length > 0 ? standard.wallSpanOffset : standard.openingChainOffset,
      unit,
      stroke,
      undefined,
      undefined,
      profile,
      standard,
      undefined,
      makeDimensionDescriptor({
        id: `${levelId}:wall:${wall.id}:exterior-total:0:${wallLength}`,
        sourceNodeId: wall.id,
        chainId: `${levelId}:wall:${wall.id}:exterior`,
        semanticKey: `${levelId}:wall:${wall.id}:exterior:total`,
        generatorKey: constructionGeneratorKey(standard, 'exterior-wall'),
        levelId,
        kind: 'total',
        measuredStart: totalStart,
        measuredEnd: totalEnd,
        leaves:
          totalLeaves.length > 0
            ? totalLeaves
            : [
                makeDimensionLeaf(
                  `${levelId}:wall:${wall.id}:exterior-total:leaf`,
                  totalStart,
                  totalEnd,
                  [wall.id],
                  undefined,
                  `${levelId}:wall:${wall.id}:exterior:leaf:0`,
                ),
              ],
        wallIds: [wall.id],
      }),
    ),
  )

  return dimensions
}

function dimension(
  start: FloorplanPoint,
  end: FloorplanPoint,
  offsetNormal: FloorplanPoint,
  offsetDistance: number,
  unit: ConstructionLinearUnit,
  stroke?: string,
  dimensionStart?: FloorplanPoint,
  dimensionEnd?: FloorplanPoint,
  profile: ConstructionLengthProfile = 'editor',
  standard: ConstructionDimensionDrawingStandard = DEFAULT_CONSTRUCTION_DIMENSION_STANDARD,
  textPrefix?: string,
  editDescriptor?: FloorplanDimensionEditDescriptor,
): FloorplanGeometry {
  const measurementStart = dimensionStart ?? start
  const measurementEnd = dimensionEnd ?? end
  return buildDimensionStringGeometry({
    segments: [
      {
        witnessStart: start,
        witnessEnd: end,
        dimensionStart,
        dimensionEnd,
        text: constructionDimensionText(
          measurementStart,
          measurementEnd,
          unit,
          profile,
          standard,
          textPrefix,
        ),
        editDescriptor,
      },
    ],
    offsetNormal,
    offsetDistance,
    extensionStartGap: standard.extensionStartGap,
    extensionOvershoot: standard.extensionOvershoot,
    terminator: standard.terminator,
    textPosition: standard.textPosition,
    stroke,
  })
}

function constructionDimensionText(
  start: FloorplanPoint,
  end: FloorplanPoint,
  unit: ConstructionLinearUnit,
  profile: ConstructionLengthProfile,
  standard: ConstructionDimensionDrawingStandard,
  prefix?: string,
): string {
  const lengthText = formatConstructionLength(
    Math.hypot(end[0] - start[0], end[1] - start[1]),
    unit,
    profile,
    {
      imperialPrecision: standard.imperialPrecision,
      metricNotation: standard.metricNotation,
    },
  )
  return prefix ? `${prefix} ${lengthText}` : lengthText
}

function resolveOutwardNormal(
  wall: WallNode,
  ctx: GeometryContext,
  dirX: number,
  dirZ: number,
): FloorplanPoint {
  const front: FloorplanPoint = [cleanZero(-dirZ), cleanZero(dirX)]
  if (wall.frontSide === 'exterior' && wall.backSide !== 'exterior') return front
  if (wall.backSide === 'exterior' && wall.frontSide !== 'exterior') return negate(front)

  const walls = [
    wall,
    ...ctx.siblings.filter((sibling): sibling is WallNode => sibling.type === 'wall'),
  ]
  let sumX = 0
  let sumZ = 0
  for (const candidate of walls) {
    sumX += candidate.start[0] + candidate.end[0]
    sumZ += candidate.start[1] + candidate.end[1]
  }
  const centroidX = sumX / (walls.length * 2)
  const centroidZ = sumZ / (walls.length * 2)
  const midX = (wall.start[0] + wall.end[0]) / 2
  const midZ = (wall.start[1] + wall.end[1]) / 2
  return (midX - centroidX) * front[0] + (midZ - centroidZ) * front[1] >= 0 ? front : negate(front)
}

function exteriorNormal(wall: WallNode): FloorplanPoint | null {
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length < MIN_SEGMENT_LENGTH) return null
  const front: FloorplanPoint = [cleanZero(-dz / length), cleanZero(dx / length)]
  if (wall.frontSide === 'exterior' && wall.backSide !== 'exterior') return front
  if (wall.backSide === 'exterior' && wall.frontSide !== 'exterior') return negate(front)
  return null
}

function isClassifiedInteriorWall(wall: WallNode): boolean {
  return wall.frontSide === 'interior' && wall.backSide === 'interior'
}

function hostedOpeningsForWall(wall: WallNode, nodes: Record<string, AnyNode>): OpeningNode[] {
  return Object.values(nodes).filter(
    (node): node is OpeningNode =>
      (node.type === 'door' || node.type === 'window') &&
      node.visible !== false &&
      (node.wallId ?? node.parentId) === wall.id,
  )
}

function shouldDimensionInteriorWall(
  wall: WallNode,
  walls: ReadonlyArray<WallNode>,
  network: ReadonlyArray<WallNode>,
): boolean {
  if (isClassifiedInteriorWall(wall)) return true
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length < MIN_SEGMENT_LENGTH) return false
  const tangent: FloorplanPoint = [dx / length, dz / length]
  const { frontClearance, backClearance } = interiorDimensionClearances(wall, walls, tangent)
  if (frontClearance === null || backClearance === null) return false

  const claimedExteriorNormal = exteriorNormal(wall)
  return claimedExteriorNormal === null || isFacadeOccluded(wall, claimedExteriorNormal, network)
}

function enclosedRoomSideNormal(
  wall: WallNode,
  walls: ReadonlyArray<WallNode>,
): FloorplanPoint | null {
  const outward = exteriorNormal(wall)
  if (!outward) return null
  const dx = wall.end[0] - wall.start[0]
  const dz = wall.end[1] - wall.start[1]
  const length = Math.hypot(dx, dz)
  if (length < MIN_SEGMENT_LENGTH) return null
  const tangent: FloorplanPoint = [dx / length, dz / length]
  const front: FloorplanPoint = [cleanZero(-tangent[1]), cleanZero(tangent[0])]
  const { frontClearance, backClearance } = interiorDimensionClearances(wall, walls, tangent)
  const inward = negate(outward)
  const inwardClearance = dot(inward, front) >= 0 ? frontClearance : backClearance
  return inwardClearance === null ? null : inward
}

function resolveInteriorDimensionNormal(
  wall: WallNode,
  walls: ReadonlyArray<WallNode>,
  tangent: FloorplanPoint,
): FloorplanPoint {
  const front: FloorplanPoint = [cleanZero(-tangent[1]), cleanZero(tangent[0])]
  const back = negate(front)
  const { frontClearance, backClearance } = interiorDimensionClearances(wall, walls, tangent)

  if (frontClearance !== null && backClearance === null) return front
  if (backClearance !== null && frontClearance === null) return back
  if (frontClearance !== null && backClearance !== null) {
    if (Math.abs(frontClearance - backClearance) > FACADE_LINE_TOLERANCE) {
      return frontClearance > backClearance ? front : back
    }
  }

  const midpoint: FloorplanPoint = [
    (wall.start[0] + wall.end[0]) / 2,
    (wall.start[1] + wall.end[1]) / 2,
  ]
  const centroid = wallNetworkCentroid(walls)
  return dot(subtract(centroid, midpoint), front) >= 0 ? front : back
}

function interiorDimensionClearances(
  wall: WallNode,
  walls: ReadonlyArray<WallNode>,
  tangent: FloorplanPoint,
): { frontClearance: number | null; backClearance: number | null } {
  const front: FloorplanPoint = [cleanZero(-tangent[1]), cleanZero(tangent[0])]
  const back = negate(front)
  const midpoint: FloorplanPoint = [
    (wall.start[0] + wall.end[0]) / 2,
    (wall.start[1] + wall.end[1]) / 2,
  ]
  const clearance = (normal: FloorplanPoint): number | null => {
    let nearest = Number.POSITIVE_INFINITY
    for (const candidate of walls) {
      if (candidate.id === wall.id) continue
      const hit = isCurvedWall(candidate)
        ? rayArcDistance(midpoint, normal, candidate)
        : raySegmentDistance(midpoint, normal, candidate.start, candidate.end)
      if (hit !== null) nearest = Math.min(nearest, hit)
    }
    return Number.isFinite(nearest) ? nearest : null
  }
  const frontClearance = clearance(front)
  const backClearance = clearance(back)
  return { frontClearance, backClearance }
}

function wallNetworkCentroid(walls: ReadonlyArray<WallNode>): FloorplanPoint {
  if (walls.length === 0) return [0, 0]
  let sumX = 0
  let sumY = 0
  for (const wall of walls) {
    sumX += wall.start[0] + wall.end[0]
    sumY += wall.start[1] + wall.end[1]
  }
  return [sumX / (walls.length * 2), sumY / (walls.length * 2)]
}

function buildWallNetworkIndex(
  walls: ReadonlyArray<WallNode>,
): Map<string, ReadonlyArray<WallNode>> {
  const straightWalls = walls.filter((wall) => !isCurvedWall(wall))
  const unvisited = new Set(straightWalls)
  const networkById = new Map<string, ReadonlyArray<WallNode>>()

  while (unvisited.size > 0) {
    const seed = unvisited.values().next().value
    if (!seed) break
    unvisited.delete(seed)
    const network = [seed]
    const queue = [seed]
    while (queue.length > 0) {
      const current = queue.shift()
      if (!current) continue
      for (const candidate of unvisited) {
        if (!wallSegmentsTouch(current, candidate)) continue
        unvisited.delete(candidate)
        network.push(candidate)
        queue.push(candidate)
      }
    }
    for (const wall of network) networkById.set(wall.id, network)
  }

  return networkById
}

function wallSegmentsTouch(left: WallNode, right: WallNode): boolean {
  if (left.parentId !== right.parentId) return false
  return (
    pointSegmentDistance(left.start, right.start, right.end) <= FACADE_LINE_TOLERANCE ||
    pointSegmentDistance(left.end, right.start, right.end) <= FACADE_LINE_TOLERANCE ||
    pointSegmentDistance(right.start, left.start, left.end) <= FACADE_LINE_TOLERANCE ||
    pointSegmentDistance(right.end, left.start, left.end) <= FACADE_LINE_TOLERANCE ||
    segmentIntersection(left.start, left.end, right.start, right.end) !== null
  )
}

function isFacadeOccluded(
  wall: WallNode,
  outwardNormal: FloorplanPoint,
  network: ReadonlyArray<WallNode>,
): boolean {
  const halfThickness = (wall.thickness ?? 0.1) / 2
  const origin = addScaled(
    [(wall.start[0] + wall.end[0]) / 2, (wall.start[1] + wall.end[1]) / 2],
    outwardNormal,
    halfThickness + FACADE_LINE_TOLERANCE,
  )
  return network.some(
    (candidate) =>
      candidate.id !== wall.id &&
      raySegmentDistance(origin, outwardNormal, candidate.start, candidate.end) !== null,
  )
}

function raySegmentDistance(
  rayOrigin: FloorplanPoint,
  rayDirection: FloorplanPoint,
  segmentStart: FloorplanPoint,
  segmentEnd: FloorplanPoint,
): number | null {
  const segmentDirection = subtract(segmentEnd, segmentStart)
  const denominator = cross(rayDirection, segmentDirection)
  if (Math.abs(denominator) < 1e-8) return null
  const fromRay = subtract(segmentStart, rayOrigin)
  const alongRay = cross(fromRay, segmentDirection) / denominator
  const alongSegment = cross(fromRay, rayDirection) / denominator
  if (alongRay <= FACADE_LINE_TOLERANCE || alongSegment < -1e-6 || alongSegment > 1 + 1e-6) {
    return null
  }
  return alongRay
}

function rayArcDistance(
  rayOrigin: FloorplanPoint,
  rayDirection: FloorplanPoint,
  wall: WallNode,
): number | null {
  const arc = getWallArcData(wall)
  if (!arc) return null
  const fromCenter: FloorplanPoint = [rayOrigin[0] - arc.center.x, rayOrigin[1] - arc.center.y]
  const directionLengthSquared = dot(rayDirection, rayDirection)
  const linear = 2 * dot(fromCenter, rayDirection)
  const constant = dot(fromCenter, fromCenter) - arc.radius * arc.radius
  const discriminant = linear * linear - 4 * directionLengthSquared * constant
  if (discriminant < 0 || directionLengthSquared < 1e-12) return null

  const root = Math.sqrt(Math.max(0, discriminant))
  const denominator = 2 * directionLengthSquared
  const hits = [(-linear - root) / denominator, (-linear + root) / denominator]
    .filter((distance) => distance > FACADE_LINE_TOLERANCE)
    .sort((left, right) => left - right)
  for (const distance of hits) {
    const point: FloorplanPoint = [
      rayOrigin[0] + rayDirection[0] * distance,
      rayOrigin[1] + rayDirection[1] * distance,
    ]
    const angle = Math.atan2(point[1] - arc.center.y, point[0] - arc.center.x)
    if (angleFallsOnArc(angle, arc.startAngle, arc.delta)) return distance
  }
  return null
}

function angleFallsOnArc(angle: number, startAngle: number, delta: number): boolean {
  const fullTurn = Math.PI * 2
  const positiveTurn = (value: number) => ((value % fullTurn) + fullTurn) % fullTurn
  const swept = delta >= 0 ? positiveTurn(angle - startAngle) : positiveTurn(startAngle - angle)
  return swept <= Math.abs(delta) + 1e-8
}

function splitConnectedFacadeComponents(
  members: FacadeMember[],
  wallNetworkById: ReadonlyMap<string, ReadonlyArray<WallNode>>,
): FacadeMember[][] {
  const components = new Map<ReadonlyArray<WallNode>, FacadeMember[]>()
  for (const member of members) {
    const network = wallNetworkById.get(member.wall.id) ?? [member.wall]
    const component = components.get(network)
    if (component) component.push(member)
    else components.set(network, [member])
  }
  return [...components.values()]
}

function wallsTouch(left: WallNode, right: WallNode): boolean {
  if (left.parentId !== right.parentId) return false
  return [left.start, left.end].some((leftPoint) =>
    [right.start, right.end].some(
      (rightPoint) => distance(leftPoint, rightPoint) <= FACADE_LINE_TOLERANCE,
    ),
  )
}

function connectedWallComponent(wall: WallNode, candidates: ReadonlyArray<WallNode>): WallNode[] {
  const unvisited = new Set(
    candidates.filter(
      (candidate) => candidate.id !== wall.id && candidate.parentId === wall.parentId,
    ),
  )
  const component = [wall]
  const queue = [wall]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue
    for (const candidate of unvisited) {
      if (!wallsTouch(current, candidate)) continue
      unvisited.delete(candidate)
      component.push(candidate)
      queue.push(candidate)
    }
  }

  return component
}

function groupFacadeMembersByDirection(
  members: readonly FacadeMember[],
): Map<string, FacadeMember[]> {
  const groups = new Map<string, FacadeMember[]>()
  for (const member of members) {
    const key = `${Math.round(member.normal[0] / FACADE_DIRECTION_TOLERANCE)},${Math.round(member.normal[1] / FACADE_DIRECTION_TOLERANCE)}`
    const group = groups.get(key)
    if (group) group.push(member)
    else groups.set(key, [member])
  }
  return groups
}

function groupFacadeMembersByLine(
  members: readonly FacadeMember[],
  normal: FloorplanPoint,
): Map<number, FacadeMember[]> {
  const groups = new Map<number, FacadeMember[]>()
  for (const member of members) {
    const midpoint: FloorplanPoint = [
      (member.wall.start[0] + member.wall.end[0]) / 2,
      (member.wall.start[1] + member.wall.end[1]) / 2,
    ]
    const key = Math.round(dot(midpoint, normal) / FACADE_LINE_TOLERANCE)
    const group = groups.get(key)
    if (group) group.push(member)
    else groups.set(key, [member])
  }
  return groups
}

function appendFacadeRunDimensions(
  pending: PendingConstructionDimension[],
  members: readonly FacadeMember[],
  walls: ReadonlyArray<WallNode>,
  nodes: Record<string, AnyNode>,
  interiorWallIds: ReadonlySet<string>,
  normal: FloorplanPoint,
  tangent: FloorplanPoint,
  standard: ConstructionDimensionDrawingStandard,
): void {
  const [extentStart, extentEnd] = facadeStructuralExtents(members, walls, tangent)
  if (extentEnd - extentStart < MIN_SEGMENT_LENGTH) return

  const faceCoordinate = Math.max(
    ...members.map(({ wall }) =>
      exteriorFaceCoordinate(wall, normal, EXTERIOR_CORNER_DATUM_POLICY),
    ),
  )
  const pointAt = (projection: number): FloorplanPoint =>
    pointFromCoordinates(projection, faceCoordinate, tangent, normal)
  const openingCenters: number[] = []
  const openingSpans: Array<{
    start: number
    end: number
    textPrefix: string
    opening: OpeningNode
    fullyContained: boolean
    displayedLength: number
  }> = []

  for (const { wall } of members) {
    const dx = wall.end[0] - wall.start[0]
    const dz = wall.end[1] - wall.start[1]
    const length = Math.hypot(dx, dz)
    if (length < MIN_SEGMENT_LENGTH) continue
    for (const opening of Object.values(nodes)) {
      if (opening.type !== 'door' && opening.type !== 'window') continue
      if (opening.visible === false) continue
      if ((opening.wallId ?? opening.parentId) !== wall.id) continue
      const rawAlong = opening.position[0]
      const along = clamp(rawAlong, 0, length)
      const center: FloorplanPoint = [
        wall.start[0] + (dx / length) * along,
        wall.start[1] + (dz / length) * along,
      ]
      const documentation = resolveOpeningDimensionDocumentation(opening)
      if (documentation.locationPolicy === 'centerline') openingCenters.push(dot(center, tangent))
      if (documentation.width === null) continue
      const halfWidth = Math.max(0, documentation.width) / 2
      const rawStart = rawAlong - halfWidth
      const rawEnd = rawAlong + halfWidth
      const startProjection = dot(
        [
          wall.start[0] + (dx / length) * clamp(along - halfWidth, 0, length),
          wall.start[1] + (dz / length) * clamp(along - halfWidth, 0, length),
        ],
        tangent,
      )
      const endProjection = dot(
        [
          wall.start[0] + (dx / length) * clamp(along + halfWidth, 0, length),
          wall.start[1] + (dz / length) * clamp(along + halfWidth, 0, length),
        ],
        tangent,
      )
      if (Math.abs(endProjection - startProjection) >= MIN_SEGMENT_LENGTH) {
        openingSpans.push({
          start: Math.min(startProjection, endProjection),
          end: Math.max(startProjection, endProjection),
          textPrefix: documentation.prefix,
          opening,
          fullyContained:
            rawStart >= -CHAIN_PROJECTION_EPSILON && rawEnd <= length + CHAIN_PROJECTION_EPSILON,
          displayedLength: documentation.width,
        })
      }
    }
  }

  for (const {
    start: startProjection,
    end: endProjection,
    textPrefix,
    opening,
    fullyContained,
    displayedLength,
  } of openingSpans.sort((left, right) => left.start - right.start)) {
    const openingProvenance = openingDimensionProvenance(opening)
    pending.push({
      tier: 'opening-widths',
      start: pointAt(startProjection),
      end: pointAt(endProjection),
      startProjection,
      endProjection,
      textPrefix,
      wallIds: [(opening.wallId ?? opening.parentId ?? members[0]?.wall.id) as AnyNodeId],
      opening: openingProvenance
        ? {
            openingId: openingProvenance.openingId,
            reference: openingProvenance.reference,
            displayedField: openingProvenance.displayedField,
            documentedOffset: openingProvenance.documentedOffset,
          }
        : undefined,
      openingLength: displayedLength,
      openingFullyContained: fullyContained,
    })
  }
  appendReferenceTier(pending, openingCenters, extentStart, extentEnd, pointAt, 'openings')

  const memberIds = new Set(members.map(({ wall }) => wall.id))
  const partitionReferences: number[] = []
  for (const candidate of walls) {
    if (
      memberIds.has(candidate.id) ||
      isCurvedWall(candidate) ||
      !interiorWallIds.has(candidate.id)
    ) {
      continue
    }
    const intersections = members.flatMap(({ wall }) =>
      facadePartitionFaceIntersections(wall, candidate, normal, standard.datumPolicy),
    )
    const references = intersections.map((point) => dot(point, tangent))
    const canonicalStructuralFace = selectCanonicalWallFaceIntersection(intersections, candidate)
    const selectedReferences =
      standard.intersectionReferencePolicy === 'both-faces'
        ? uniqueSorted(references)
        : standard.datumPolicy === 'structural-face' && canonicalStructuralFace
          ? [dot(canonicalStructuralFace, tangent)]
          : [Math.min(...references)]
    for (const selectedReference of selectedReferences) {
      if (
        Number.isFinite(selectedReference) &&
        selectedReference > extentStart + MIN_SEGMENT_LENGTH &&
        selectedReference < extentEnd - MIN_SEGMENT_LENGTH
      ) {
        partitionReferences.push(selectedReference)
      }
    }
  }
  appendReferenceTier(pending, partitionReferences, extentStart, extentEnd, pointAt, 'partitions')
}

function selectCanonicalWallFaceIntersection(
  intersections: readonly FloorplanPoint[],
  wall: WallNode,
): FloorplanPoint | undefined {
  const direction = subtract(wall.end, wall.start)
  const length = Math.hypot(direction[0], direction[1])
  if (length < MIN_SEGMENT_LENGTH) return undefined

  let tangent: FloorplanPoint = [direction[0] / length, direction[1] / length]
  if (
    tangent[0] < -FACADE_DIRECTION_TOLERANCE ||
    (Math.abs(tangent[0]) <= FACADE_DIRECTION_TOLERANCE && tangent[1] < 0)
  ) {
    tangent = negate(tangent)
  }
  const canonicalFaceNormal: FloorplanPoint = [-tangent[1], tangent[0]]
  return intersections.reduce<FloorplanPoint | undefined>((selected, intersection) => {
    if (!selected) return intersection
    return dot(intersection, canonicalFaceNormal) > dot(selected, canonicalFaceNormal)
      ? intersection
      : selected
  }, undefined)
}

function appendReferenceTier(
  pending: PendingConstructionDimension[],
  references: number[],
  extentStart: number,
  extentEnd: number,
  pointAt: (projection: number) => FloorplanPoint,
  tier: 'openings' | 'partitions',
): void {
  const interiorReferences = uniqueSorted(references).filter(
    (value) => value > extentStart + MIN_SEGMENT_LENGTH && value < extentEnd - MIN_SEGMENT_LENGTH,
  )
  if (interiorReferences.length === 0) return
  appendProjectedChain(pending, [extentStart, ...interiorReferences, extentEnd], tier, pointAt)
}

function ensureProjectedTierContinuity(
  pending: PendingConstructionDimension[],
  tier: 'openings' | 'partitions' | 'jogs',
  extentStart: number,
  extentEnd: number,
  originAt: (projection: number) => FloorplanPoint,
): void {
  const spans = pending
    .filter((entry) => entry.tier === tier)
    .map(
      (entry) =>
        [
          Math.max(extentStart, Math.min(entry.startProjection, entry.endProjection)),
          Math.min(extentEnd, Math.max(entry.startProjection, entry.endProjection)),
        ] as const,
    )
    .filter(([start, end]) => end - start >= MIN_SEGMENT_LENGTH)
    .sort((left, right) => left[0] - right[0])
  if (spans.length === 0) return

  let cursor = extentStart
  for (const [start, end] of spans) {
    if (start > cursor + CHAIN_PROJECTION_EPSILON) {
      appendProjectedChain(pending, [cursor, start], tier, originAt, [], CHAIN_PROJECTION_EPSILON)
    }
    cursor = Math.max(cursor, end)
  }
  if (extentEnd > cursor + CHAIN_PROJECTION_EPSILON) {
    appendProjectedChain(pending, [cursor, extentEnd], tier, originAt, [], CHAIN_PROJECTION_EPSILON)
  }
}

function appendProjectedChain(
  pending: PendingConstructionDimension[],
  projections: number[],
  tier: ConstructionDimensionTier,
  originAt: (projection: number) => FloorplanPoint,
  wallIds: readonly AnyNodeId[] = [],
  minimumLength = MIN_SEGMENT_LENGTH,
): void {
  const breakpoints = uniqueSorted(projections)
  for (let index = 0; index < breakpoints.length - 1; index++) {
    const startProjection = breakpoints[index]
    const endProjection = breakpoints[index + 1]
    if (
      startProjection === undefined ||
      endProjection === undefined ||
      endProjection - startProjection < minimumLength
    ) {
      continue
    }
    pending.push({
      tier,
      start: originAt(startProjection),
      end: originAt(endProjection),
      startProjection,
      endProjection,
      wallIds,
    })
  }
}

function buildCanonicalTotalLeaves(
  pending: readonly PendingConstructionDimension[],
  overall: PendingConstructionDimension,
  levelId: AnyNodeId,
  componentWallIds: readonly AnyNodeId[],
  chainId: string,
): FloorplanDimensionEditLeaf[] {
  const lower = Math.min(overall.startProjection, overall.endProjection)
  const upper = Math.max(overall.startProjection, overall.endProjection)
  if (
    !Number.isFinite(lower) ||
    !Number.isFinite(upper) ||
    upper - lower <= CHAIN_PROJECTION_EPSILON
  ) {
    return []
  }

  const candidatesByTier = new Map<ConstructionDimensionTier, PendingConstructionDimension[]>()
  for (const entry of pending) {
    if (entry.tier === 'overall' || entry.tier === 'structural-overall') continue
    const list = candidatesByTier.get(entry.tier) ?? []
    list.push(entry)
    candidatesByTier.set(entry.tier, list)
  }

  const chainForTier = (tier: ConstructionDimensionTier): PendingConstructionDimension[] => {
    const entries = [...(candidatesByTier.get(tier) ?? [])].sort(
      (left, right) => left.startProjection - right.startProjection,
    )
    if (entries.length === 0) return []
    const first = entries[0]!
    const last = entries.at(-1)!
    if (
      first.startProjection > lower + CHAIN_PROJECTION_EPSILON ||
      last.endProjection < upper - CHAIN_PROJECTION_EPSILON
    ) {
      return []
    }
    let cursor = lower
    for (const entry of entries) {
      if (entry.endProjection <= lower + CHAIN_PROJECTION_EPSILON) continue
      if (entry.startProjection > cursor + CHAIN_PROJECTION_EPSILON) return []
      cursor = Math.max(cursor, entry.endProjection)
    }
    return cursor >= upper - CHAIN_PROJECTION_EPSILON ? entries : []
  }

  let baseChain: PendingConstructionDimension[] = []
  for (const tier of CANONICAL_CHAIN_TIER_ORDER) {
    const candidate = chainForTier(tier)
    if (candidate.length > 0) {
      baseChain = candidate
      break
    }
  }

  const openingEntries = candidatesByTier.get('opening-widths') ?? []
  const componentWallSet = new Set(componentWallIds)
  const baseWallSet = new Set(baseChain.flatMap((entry) => entry.wallIds ?? []))
  const containedOpeningRanges = openingEntries
    .filter(
      (entry) =>
        entry.openingFullyContained === true &&
        Number.isFinite(entry.openingLength) &&
        entry.endProjection - entry.startProjection > CHAIN_PROJECTION_EPSILON,
    )
    .map((entry) => [entry.startProjection, entry.endProjection] as const)
  // Centerline opening references can add a breakpoint through the middle of
  // an otherwise exact opening span. Keep those spans atomic so total leaves
  // retain the documented opening provenance and physical-width edit path.
  const baseBreakpoints = baseChain
    .flatMap((entry) => [entry.startProjection, entry.endProjection])
    .filter(
      (projection) =>
        !containedOpeningRanges.some(
          ([start, end]) =>
            projection > start + CHAIN_PROJECTION_EPSILON &&
            projection < end - CHAIN_PROJECTION_EPSILON,
        ),
    )
  const breakpoints = uniqueSorted([
    lower,
    upper,
    ...baseBreakpoints,
    ...openingEntries.flatMap((entry) => [entry.startProjection, entry.endProjection]),
  ]).filter(
    (value) =>
      value >= lower - CHAIN_PROJECTION_EPSILON && value <= upper + CHAIN_PROJECTION_EPSILON,
  )

  const pointAt = (projection: number): FloorplanPoint => {
    const fraction =
      (projection - overall.startProjection) / (overall.endProjection - overall.startProjection)
    return [
      overall.start[0] + (overall.end[0] - overall.start[0]) * fraction,
      overall.start[1] + (overall.end[1] - overall.start[1]) * fraction,
    ]
  }
  const entriesAt = (projection: number): PendingConstructionDimension[] =>
    baseChain.filter(
      (entry) =>
        projection >= entry.startProjection - CHAIN_PROJECTION_EPSILON &&
        projection <= entry.endProjection + CHAIN_PROJECTION_EPSILON,
    )
  const openingAt = (start: number, end: number): PendingConstructionDimension | undefined =>
    openingEntries.find((entry) => {
      if (
        Math.abs(entry.startProjection - start) > CHAIN_PROJECTION_EPSILON ||
        Math.abs(entry.endProjection - end) > CHAIN_PROJECTION_EPSILON ||
        entry.openingFullyContained !== true ||
        !Number.isFinite(entry.openingLength) ||
        Math.abs(end - start - (entry.openingLength ?? 0)) > CHAIN_PROJECTION_EPSILON
      ) {
        return false
      }
      const openingWallIds = entry.wallIds ?? []
      if (!openingWallIds.some((wallId) => componentWallSet.has(wallId))) return false
      return baseWallSet.size === 0 || openingWallIds.some((wallId) => baseWallSet.has(wallId))
    })

  const leaves: FloorplanDimensionEditLeaf[] = []
  for (let index = 0; index < breakpoints.length - 1; index += 1) {
    const startProjection = breakpoints[index]!
    const endProjection = breakpoints[index + 1]!
    if (endProjection - startProjection <= CHAIN_PROJECTION_EPSILON) continue
    const opening = openingAt(startProjection, endProjection)
    const coveringEntry = entriesAt((startProjection + endProjection) / 2)[0]
    const wallIds = opening?.wallIds?.length
      ? [...opening.wallIds].sort((left, right) => String(left).localeCompare(String(right)))
      : coveringEntry?.wallIds?.length
        ? [...coveringEntry.wallIds].sort((left, right) =>
            String(left).localeCompare(String(right)),
          )
        : [...componentWallIds]
    const start = pointAt(startProjection)
    const end = pointAt(endProjection)
    const orderedStart = overall.endProjection >= overall.startProjection ? start : end
    const orderedEnd = overall.endProjection >= overall.startProjection ? end : start
    const openingProvenance = opening?.opening
      ? {
          openingId: opening.opening.openingId,
          reference: opening.opening.reference,
          displayedField: opening.opening.displayedField,
          documentedOffset: opening.opening.documentedOffset,
        }
      : undefined
    leaves.push(
      makeDimensionLeaf(
        `${levelId}:construction:total:${wallIds.join(',')}:${startProjection}:${endProjection}`,
        orderedStart,
        orderedEnd,
        wallIds,
        openingProvenance,
        openingProvenance
          ? `${chainId}:opening:${openingProvenance.openingId}`
          : `${chainId}:leaf:${index}`,
      ),
    )
  }
  return leaves
}

function finalizeDimensionTiers(
  pending: PendingConstructionDimension[],
  tangent: FloorplanPoint,
  normal: FloorplanPoint,
  outerCoordinate: number,
  standard: ConstructionDimensionDrawingStandard,
  levelId: AnyNodeId,
  componentWallIds: readonly AnyNodeId[],
  generatorKey: string,
): PlannedConstructionDimension[] {
  const sortedComponentWallIds = [...componentWallIds].sort((left, right) =>
    String(left).localeCompare(String(right)),
  )
  const totalChainId = `${levelId}:construction:${sortedComponentWallIds.join(',')}:total`
  const activeTiers = TIER_ORDER.filter((tier) => pending.some((entry) => entry.tier === tier))
  const offsets = new Map<ConstructionDimensionTier, number>()
  activeTiers.forEach((tier, index) => {
    const firstOffset =
      activeTiers[0] === 'opening-widths'
        ? standard.firstOpeningWidthOffset
        : standard.firstGeneralTierOffset
    offsets.set(tier, firstOffset + index * standard.tierSpacing)
  })

  const overall = pending.find((entry) => entry.tier === 'overall')
  const leaves = overall
    ? buildCanonicalTotalLeaves(pending, overall, levelId, sortedComponentWallIds, totalChainId)
    : []

  const sortedPending = [...pending].sort((left, right) => {
    const tierDelta = TIER_ORDER.indexOf(left.tier) - TIER_ORDER.indexOf(right.tier)
    return tierDelta || left.startProjection - right.startProjection
  })
  const tierLeafIndexes = new Map<ConstructionDimensionTier, number>()

  return sortedPending.map((entry) => {
    const tierLeafIndex = tierLeafIndexes.get(entry.tier) ?? 0
    tierLeafIndexes.set(entry.tier, tierLeafIndex + 1)
    const offset = offsets.get(entry.tier) ?? standard.firstGeneralTierOffset
    const baselineCoordinate = outerCoordinate + offset
    const dimensionStart = pointFromCoordinates(
      entry.startProjection,
      baselineCoordinate,
      tangent,
      normal,
    )
    const dimensionEnd = pointFromCoordinates(
      entry.endProjection,
      baselineCoordinate,
      tangent,
      normal,
    )
    const entryWallIds = entry.wallIds?.length
      ? [...entry.wallIds].sort((left, right) => String(left).localeCompare(String(right)))
      : sortedComponentWallIds
    const opening = entry.opening
      ? {
          openingId: entry.opening.openingId,
          reference: entry.opening.reference,
          displayedField: entry.opening.displayedField,
          documentedOffset: entry.opening.documentedOffset,
        }
      : undefined
    const leaf = makeDimensionLeaf(
      `${levelId}:construction:${entry.tier}:${entryWallIds.join(',')}:${entry.startProjection}:${entry.endProjection}`,
      entry.start,
      entry.end,
      entryWallIds,
      opening,
      entry.opening
        ? `${levelId}:construction:${sortedComponentWallIds.join(',')}:${entry.tier}:opening:${entry.opening.openingId}`
        : `${levelId}:construction:${sortedComponentWallIds.join(',')}:${entry.tier}:leaf:${tierLeafIndex}`,
    )
    const isTotal = entry.tier === 'overall' || entry.tier === 'structural-overall'
    const descriptorLeaves = isTotal ? leaves : [leaf]
    const missingOpeningDocumentation =
      (entry.opening !== undefined && entry.opening.documentedOffset === undefined) ||
      (isTotal &&
        descriptorLeaves.some(
          (candidate) =>
            candidate.opening !== undefined && candidate.opening.documentedOffset === undefined,
        ))
    const readOnlyReason =
      entry.tier === 'structural-overall'
        ? '구조 기준선은 이동할 벽이 하나로 정해지지 않습니다.'
        : missingOpeningDocumentation
          ? '개구부 문서 치수 출처가 없어 수정할 수 없습니다.'
          : descriptorLeaves.length === 0
            ? '이 치수에는 편집 가능한 구간이 없습니다.'
            : undefined
    const descriptorChainId = isTotal
      ? totalChainId
      : `${levelId}:construction:${sortedComponentWallIds.join(',')}:${entry.tier}`
    const descriptor: FloorplanDimensionEditDescriptor = {
      id: `${levelId}:construction:${entry.tier}:${entry.wallIds?.join(',') ?? componentWallIds.join(',')}:${entry.startProjection}:${entry.endProjection}`,
      sourceNodeId: sortedComponentWallIds[0],
      chainId: descriptorChainId,
      generatorKey,
      semanticKey: entry.opening
        ? `${descriptorChainId}:opening:${entry.opening.openingId}`
        : `${descriptorChainId}:leaf:${entry.startProjection}:${entry.endProjection}`,
      status: readOnlyReason ? 'read-only' : 'editable',
      readOnlyReason,
      readOnlyReasonCode:
        entry.tier === 'structural-overall'
          ? 'structural-datum'
          : missingOpeningDocumentation
            ? 'missing-provenance'
            : descriptorLeaves.length === 0
              ? 'unsupported-dimension'
              : undefined,
      levelId: levelId as FloorplanDimensionEditDescriptor['levelId'],
      kind: entry.opening ? 'opening-width' : isTotal ? 'total' : 'leaf',
      measuredStart: entry.start,
      measuredEnd: entry.end,
      fixedEndOptions: ['start', 'end'],
      leaves: descriptorLeaves,
      defaultLeafId: descriptorLeaves.at(-1)?.id,
      opening,
    }
    descriptor.semanticKey = isTotal
      ? `${descriptorChainId}:descriptor`
      : entry.opening
        ? `${descriptorChainId}:opening:${entry.opening.openingId}`
        : `${descriptorChainId}:leaf:${tierLeafIndex}`
    return {
      tier: entry.tier,
      start: entry.start,
      end: entry.end,
      dimensionStart,
      dimensionEnd,
      offsetNormal: normal,
      offsetDistance: Math.max(0, dot(subtract(dimensionStart, entry.start), normal)),
      textPrefix: entry.textPrefix,
      editDescriptor: descriptor,
    }
  })
}

function facadeStructuralExtents(
  members: readonly FacadeMember[],
  walls: ReadonlyArray<WallNode>,
  tangent: FloorplanPoint,
  extentWalls?: ReadonlyArray<WallNode>,
): readonly [number, number] {
  const endpoints = (extentWalls ?? members.map(({ wall }) => wall)).flatMap((wall) => [
    wall.start,
    wall.end,
  ])
  const centerlineProjections = endpoints.map((point) => dot(point, tangent))
  const centerlineStart = Math.min(...centerlineProjections)
  const centerlineEnd = Math.max(...centerlineProjections)

  const structuralProjectionsAt = (targetProjection: number): number[] =>
    endpoints
      .filter(
        (endpoint) => Math.abs(dot(endpoint, tangent) - targetProjection) <= FACADE_LINE_TOLERANCE,
      )
      .flatMap((endpoint) =>
        walls.flatMap((candidate): number[] => {
          if (
            isCurvedWall(candidate) ||
            (distance(endpoint, candidate.start) > FACADE_LINE_TOLERANCE &&
              distance(endpoint, candidate.end) > FACADE_LINE_TOLERANCE)
          ) {
            return []
          }
          const direction = subtract(candidate.end, candidate.start)
          const length = Math.hypot(direction[0], direction[1])
          if (length < MIN_SEGMENT_LENGTH) return []
          const normal: FloorplanPoint = [-direction[1] / length, direction[0] / length]
          return wallDatumOffsets(candidate, EXTERIOR_CORNER_DATUM_POLICY).map((offset) =>
            dot(addScaled(endpoint, normal, offset), tangent),
          )
        }),
      )

  return [
    Math.min(centerlineStart, ...structuralProjectionsAt(centerlineStart)),
    Math.max(centerlineEnd, ...structuralProjectionsAt(centerlineEnd)),
  ]
}

function isAxisAlignedDirection(tangent: FloorplanPoint): boolean {
  return (
    Math.abs(tangent[0]) <= FACADE_DIRECTION_TOLERANCE ||
    Math.abs(tangent[1]) <= FACADE_DIRECTION_TOLERANCE
  )
}

function exteriorFaceCoordinate(
  wall: WallNode,
  normal: FloorplanPoint,
  datumPolicy: ConstructionDimensionDrawingStandard['datumPolicy'],
): number {
  const midpoint: FloorplanPoint = [
    (wall.start[0] + wall.end[0]) / 2,
    (wall.start[1] + wall.end[1]) / 2,
  ]
  return dot(midpoint, normal) + wallDatumDistanceToward(wall, datumPolicy, normal)
}

function curvedFacadeOuterFaceCoordinates(
  walls: ReadonlyArray<WallNode>,
  members: readonly FacadeMember[],
  normal: FloorplanPoint,
  datumPolicy: ConstructionDimensionDrawingStandard['datumPolicy'],
): number[] {
  const parentId = members[0]?.wall.parentId
  const memberEndpoints = members.flatMap(({ wall }) => [wall.start, wall.end])
  const touchesFacade = (point: FloorplanPoint) =>
    memberEndpoints.some((endpoint) => distance(point, endpoint) <= FACADE_LINE_TOLERANCE)

  return walls.flatMap((wall): number[] => {
    if (
      wall.parentId !== parentId ||
      !isCurvedWall(wall) ||
      !touchesFacade(wall.start) ||
      !touchesFacade(wall.end)
    ) {
      return []
    }

    const midpoint = getWallMidpointHandlePoint(wall)
    const outerCenterlineCoordinate = Math.max(
      dot(wall.start, normal),
      dot(wall.end, normal),
      dot([midpoint.x, midpoint.y], normal),
    )
    return [outerCenterlineCoordinate + wallDatumDistanceToward(wall, datumPolicy, normal)]
  })
}

function exteriorOriginAtProjection(
  members: readonly FacadeMember[],
  projection: number,
  tangent: FloorplanPoint,
  normal: FloorplanPoint,
  datumPolicy: ConstructionDimensionDrawingStandard['datumPolicy'],
): FloorplanPoint {
  const endpoint = members
    .flatMap(({ wall }) => [
      { point: wall.start, wall },
      { point: wall.end, wall },
    ])
    .sort((left, right) => {
      const projectionDelta =
        Math.abs(dot(left.point, tangent) - projection) -
        Math.abs(dot(right.point, tangent) - projection)
      return (
        projectionDelta ||
        exteriorFaceCoordinate(right.wall, normal, datumPolicy) -
          exteriorFaceCoordinate(left.wall, normal, datumPolicy)
      )
    })[0]
  if (!endpoint) return pointFromCoordinates(projection, 0, tangent, normal)
  return pointFromCoordinates(
    projection,
    exteriorFaceCoordinate(endpoint.wall, normal, datumPolicy),
    tangent,
    normal,
  )
}

function outermostColumnRow(
  columns: readonly ColumnNode[],
  component: readonly FacadeMember[],
  normal: FloorplanPoint,
  tangent: FloorplanPoint,
): ColumnNode[] {
  if (columns.length < 2) return []
  const centroid = facadeCentroid(component)
  const outwardColumns = columns.filter(
    (column) => dot(subtract(columnPlanPoint(column), centroid), normal) >= -COLUMN_ROW_TOLERANCE,
  )
  const sorted = [...outwardColumns].sort(
    (left, right) => dot(columnPlanPoint(right), normal) - dot(columnPlanPoint(left), normal),
  )
  const outerCoordinate = sorted[0] ? dot(columnPlanPoint(sorted[0]), normal) : 0
  return sorted
    .filter(
      (column) =>
        Math.abs(dot(columnPlanPoint(column), normal) - outerCoordinate) <= COLUMN_ROW_TOLERANCE,
    )
    .sort(
      (left, right) => dot(columnPlanPoint(left), tangent) - dot(columnPlanPoint(right), tangent),
    )
}

function columnOriginAtProjection(
  columns: readonly ColumnNode[],
  projection: number,
  tangent: FloorplanPoint,
): FloorplanPoint {
  return columnPlanPoint(
    [...columns].sort(
      (left, right) =>
        Math.abs(dot(columnPlanPoint(left), tangent) - projection) -
        Math.abs(dot(columnPlanPoint(right), tangent) - projection),
    )[0]!,
  )
}

function columnPlanPoint(column: ColumnNode): FloorplanPoint {
  return [column.position[0], column.position[2]]
}

function columnNormalHalfExtent(column: ColumnNode, normal: FloorplanPoint): number {
  const center = columnPlanPoint(column)
  return Math.max(
    ...getColumnFloorplanFootprint(column).map((point) => dot(subtract(point, center), normal)),
  )
}

function nearestFacadeComponent(
  column: ColumnNode,
  components: readonly FacadeMember[][],
): FacadeMember[] | undefined {
  const point = columnPlanPoint(column)
  return [...components]
    .filter((component) => component[0]?.wall.parentId === column.parentId)
    .sort(
      (left, right) =>
        distanceToFacadeComponent(point, left) - distanceToFacadeComponent(point, right),
    )[0]
}

function distanceToFacadeComponent(
  point: FloorplanPoint,
  component: readonly FacadeMember[],
): number {
  return Math.min(...component.map(({ wall }) => pointSegmentDistance(point, wall.start, wall.end)))
}

function facadeCentroid(component: readonly FacadeMember[]): FloorplanPoint {
  const points = component.flatMap(({ wall }) => [wall.start, wall.end])
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ]
}

function pointFromCoordinates(
  tangentCoordinate: number,
  normalCoordinate: number,
  tangent: FloorplanPoint,
  normal: FloorplanPoint,
): FloorplanPoint {
  return [
    tangent[0] * tangentCoordinate + normal[0] * normalCoordinate,
    tangent[1] * tangentCoordinate + normal[1] * normalCoordinate,
  ]
}

function splitFacadeRuns(members: FacadeMember[]): FacadeMember[][] {
  const tangent = members[0]?.tangent
  if (!tangent) return []
  const sorted = [...members].sort((left, right) => {
    const leftStart = Math.min(dot(left.wall.start, tangent), dot(left.wall.end, tangent))
    const rightStart = Math.min(dot(right.wall.start, tangent), dot(right.wall.end, tangent))
    return leftStart - rightStart
  })
  const runs: FacadeMember[][] = []
  let runEnd = Number.NEGATIVE_INFINITY
  for (const member of sorted) {
    const start = Math.min(dot(member.wall.start, tangent), dot(member.wall.end, tangent))
    const end = Math.max(dot(member.wall.start, tangent), dot(member.wall.end, tangent))
    const current = runs.at(-1)
    if (!current || start > runEnd + FACADE_LINE_TOLERANCE) {
      runs.push([member])
      runEnd = end
    } else {
      current.push(member)
      runEnd = Math.max(runEnd, end)
    }
  }
  return runs
}

function facadePartitionFaceIntersections(
  facade: WallNode,
  candidate: WallNode,
  outwardNormal: FloorplanPoint,
  datumPolicy: ConstructionDimensionDrawingStandard['datumPolicy'],
): FloorplanPoint[] {
  const halfThickness = wallDatumDistanceToward(facade, 'wall-face', outwardNormal)
  const insideStart: FloorplanPoint = [
    facade.start[0] - outwardNormal[0] * halfThickness,
    facade.start[1] - outwardNormal[1] * halfThickness,
  ]
  const insideEnd: FloorplanPoint = [
    facade.end[0] - outwardNormal[0] * halfThickness,
    facade.end[1] - outwardNormal[1] * halfThickness,
  ]
  const dx = candidate.end[0] - candidate.start[0]
  const dz = candidate.end[1] - candidate.start[1]
  const length = Math.hypot(dx, dz)
  if (length < MIN_SEGMENT_LENGTH) return []
  const candidateNormal: FloorplanPoint = [-dz / length, dx / length]
  const candidateOffsets = wallDatumOffsets(candidate, datumPolicy)

  return candidateOffsets.flatMap((offset): FloorplanPoint[] => {
    const faceStart = addScaled(candidate.start, candidateNormal, offset)
    const faceEnd = addScaled(candidate.end, candidateNormal, offset)
    const intersection = segmentIntersection(insideStart, insideEnd, faceStart, faceEnd)
    return intersection ? [intersection] : []
  })
}

function wallDatumOffsets(
  wall: WallNode,
  policy: ConstructionDimensionDrawingStandard['datumPolicy'],
): number[] {
  if (policy === 'centerline') return [0]
  return [wallDatumOffsetOnSide(wall, policy, -1), wallDatumOffsetOnSide(wall, policy, 1)]
}

function wallDatumOffsetOnSide(
  wall: WallNode,
  policy: ConstructionDimensionDrawingStandard['datumPolicy'],
  side: 1 | -1,
): number {
  if (policy === 'centerline') return 0
  return (getWallThickness(wall) / 2) * side
}

function wallDatumDistanceToward(
  wall: WallNode,
  policy: ConstructionDimensionDrawingStandard['datumPolicy'],
  direction: FloorplanPoint,
): number {
  if (policy === 'centerline') return 0
  const wallDirection = subtract(wall.end, wall.start)
  const length = Math.hypot(wallDirection[0], wallDirection[1])
  if (length < MIN_SEGMENT_LENGTH) return 0
  const positiveNormal: FloorplanPoint = [-wallDirection[1] / length, wallDirection[0] / length]
  const side: 1 | -1 = dot(positiveNormal, direction) >= 0 ? 1 : -1
  return Math.abs(wallDatumOffsetOnSide(wall, policy, side))
}

function maximumWallDatumDistance(
  wall: WallNode,
  policy: ConstructionDimensionDrawingStandard['datumPolicy'],
): number {
  return Math.max(...wallDatumOffsets(wall, policy).map(Math.abs))
}

function segmentIntersection(
  aStart: FloorplanPoint,
  aEnd: FloorplanPoint,
  bStart: FloorplanPoint,
  bEnd: FloorplanPoint,
): FloorplanPoint | null {
  const ax = aEnd[0] - aStart[0]
  const ay = aEnd[1] - aStart[1]
  const bx = bEnd[0] - bStart[0]
  const by = bEnd[1] - bStart[1]
  const denominator = ax * by - ay * bx
  if (Math.abs(denominator) < 1e-8) return null

  const qx = bStart[0] - aStart[0]
  const qy = bStart[1] - aStart[1]
  const alongA = (qx * by - qy * bx) / denominator
  const alongB = (qx * ay - qy * ax) / denominator
  if (alongA < -1e-6 || alongA > 1 + 1e-6 || alongB < -1e-6 || alongB > 1 + 1e-6) {
    return null
  }
  return [aStart[0] + ax * alongA, aStart[1] + ay * alongA]
}

function pointSegmentDistance(
  point: FloorplanPoint,
  start: FloorplanPoint,
  end: FloorplanPoint,
): number {
  const segment = subtract(end, start)
  const lengthSquared = dot(segment, segment)
  if (lengthSquared < 1e-12) return distance(point, start)
  const along = clamp(dot(subtract(point, start), segment) / lengthSquared, 0, 1)
  return distance(point, addScaled(start, segment, along))
}

function distance(left: FloorplanPoint, right: FloorplanPoint): number {
  return Math.hypot(left[0] - right[0], left[1] - right[1])
}

function makeDimensionLeaf(
  id: string,
  measuredStart: FloorplanPoint,
  measuredEnd: FloorplanPoint,
  wallIds: readonly AnyNodeId[],
  opening?: FloorplanDimensionEditLeaf['opening'],
  semanticKey?: string,
): FloorplanDimensionEditLeaf {
  return {
    id,
    semanticKey: semanticKey ?? id,
    measuredStart,
    measuredEnd,
    currentLength: distance(measuredStart, measuredEnd),
    wallIds: [...new Set(wallIds)],
    opening,
  }
}

function openingDimensionProvenance(
  opening: OpeningNode,
): NonNullable<FloorplanDimensionEditDescriptor['opening']> | undefined {
  const documentation = resolveOpeningDimensionDocumentation(opening)
  const displayedField =
    documentation.reference === 'rough-opening'
      ? 'roughOpeningWidth'
      : documentation.reference === 'masonry-opening'
        ? 'masonryOpeningWidth'
        : documentation.reference === 'finish-opening'
          ? 'finishOpeningWidth'
          : 'width'
  return {
    openingId: opening.id,
    reference: documentation.reference,
    displayedField,
    documentedOffset:
      documentation.width === null ? undefined : documentation.width - opening.width,
  }
}

function nominalOpeningProvenance(
  opening: OpeningNode,
): NonNullable<FloorplanDimensionEditDescriptor['opening']> {
  return {
    openingId: opening.id,
    reference: 'nominal',
    displayedField: 'width',
    documentedOffset: 0,
  }
}

function constructionGeneratorKey(
  standard: ConstructionDimensionDrawingStandard,
  family: string,
): string {
  return `${family}:datum=${standard.datumPolicy}:intersections=${standard.intersectionReferencePolicy}`
}

function makeDimensionDescriptor(args: {
  id: string
  sourceNodeId?: AnyNodeId
  chainId?: string
  generatorKey?: string
  semanticKey?: string
  levelId: AnyNodeId
  kind: FloorplanDimensionEditDescriptor['kind']
  measuredStart: FloorplanPoint
  measuredEnd: FloorplanPoint
  leaves: readonly FloorplanDimensionEditLeaf[]
  wallIds: readonly AnyNodeId[]
  opening?: NonNullable<FloorplanDimensionEditDescriptor['opening']>
  readOnlyReason?: string
  readOnlyReasonCode?: FloorplanDimensionEditDescriptor['readOnlyReasonCode']
}): FloorplanDimensionEditDescriptor {
  const missingOpeningDocumentation =
    args.opening !== undefined && args.opening.documentedOffset === undefined
  const readOnlyReason =
    args.readOnlyReason ??
    (missingOpeningDocumentation ? '개구부 문서 치수 출처가 없어 수정할 수 없습니다.' : undefined)
  const readOnlyReasonCode =
    args.readOnlyReasonCode ?? (missingOpeningDocumentation ? 'missing-provenance' : undefined)
  return {
    id: args.id,
    sourceNodeId: args.sourceNodeId,
    chainId: args.chainId,
    generatorKey: args.generatorKey,
    semanticKey: args.semanticKey ?? args.id,
    status: readOnlyReason ? 'read-only' : 'editable',
    readOnlyReason,
    readOnlyReasonCode,
    levelId: args.levelId,
    kind: args.kind,
    measuredStart: args.measuredStart,
    measuredEnd: args.measuredEnd,
    fixedEndOptions: ['start', 'end'],
    leaves: args.leaves,
    defaultLeafId: args.leaves.at(-1)?.id,
    opening: args.opening,
  }
}

function subtract(left: FloorplanPoint, right: FloorplanPoint): FloorplanPoint {
  return [left[0] - right[0], left[1] - right[1]]
}

function addScaled(
  point: FloorplanPoint,
  direction: FloorplanPoint,
  distance: number,
): FloorplanPoint {
  return [point[0] + direction[0] * distance, point[1] + direction[1] * distance]
}

function dot(left: FloorplanPoint, right: FloorplanPoint): number {
  return left[0] * right[0] + left[1] * right[1]
}

function cross(left: FloorplanPoint, right: FloorplanPoint): number {
  return left[0] * right[1] - left[1] * right[0]
}

function negate(point: FloorplanPoint): FloorplanPoint {
  return [cleanZero(-point[0]), cleanZero(-point[1])]
}

function cleanZero(value: number): number {
  return Object.is(value, -0) ? 0 : value
}

function uniqueSorted(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.filter((value, index) => index === 0 || Math.abs(value - sorted[index - 1]!) > 1e-6)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

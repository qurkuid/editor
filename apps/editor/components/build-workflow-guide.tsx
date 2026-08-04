import { type AnyNodeId, useScene } from '@pascal-app/core'
import {
  type MessageId,
  type PathDraftKind,
  type PathDraftPoint,
  useDraftLengthHud,
  useFloorplanDraftPreview,
  usePathDraftPreview,
  useT,
  type WallPlanPoint,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Check, MousePointer2, PaintBucket, Ruler } from 'lucide-react'

type WorkflowMode = 'build' | 'hidden' | 'material-paint'

type BuildWorkflowGuideProps = {
  readonly activeLabel: string | null
  /** Raw tool id (e.g. `'wall'`, `'duct-segment'`) — distinct from
   *  `activeLabel`'s display label. Used to match the active tool against
   *  the draft-progress stores this guide reads. `null` when no build tool
   *  is armed. */
  readonly activeTool: string | null
  readonly hasPaintMaterial: boolean
  readonly mode: WorkflowMode
}

type WorkflowStep = {
  readonly label: string
  readonly state: 'active' | 'complete' | 'upcoming'
}

// A click-anchor-then-direction draft tool publishes its start point and a
// live point that tracks the cursor (segment end / path cursor / newest
// polygon vertex) — the same shape for every kind, just under different
// store fields. `resolveChainDraftProgress` normalizes whichever fields
// match the active tool into the two booleans the guide's steps need.
const SEGMENT_DRAFT_TOOLS = new Set(['wall', 'fence', 'roof'])
const POLYGON_DRAFT_TOOLS = new Set(['ceiling', 'slab', 'zone'])
const PATH_DRAFT_TOOLS = new Set<PathDraftKind>([
  'duct-segment',
  'lineset',
  'liquid-line',
  'pipe-segment',
])
// Below this, two points read as "still at the anchor" rather than "a
// direction has been aimed" — matches the wall tool's own preview-visibility
// threshold (`updateWallPreview`'s `length < 0.01`).
const CHAIN_DIRECTION_EPSILON_M = 0.01

function movedPastAnchor(anchor: readonly number[] | null, end: readonly number[] | null): boolean {
  if (!anchor || !end) return false
  let sumOfSquares = 0
  for (let i = 0; i < Math.max(anchor.length, end.length); i++) {
    const delta = (anchor[i] ?? 0) - (end[i] ?? 0)
    sumOfSquares += delta * delta
  }
  return Math.sqrt(sumOfSquares) > CHAIN_DIRECTION_EPSILON_M
}

export type ChainDraftProgress = {
  /** True once the flow's first point (wall/fence/roof start corner, first
   *  polygon vertex, or a path's first point) has been placed. */
  readonly anchorPlaced: boolean
  /** True once the flow has a meaningful direction beyond the anchor — the
   *  tracked point has moved away from it, a second vertex exists, or a
   *  dimension is being typed. */
  readonly directionSet: boolean
}

export type ChainDraftInput = {
  readonly activeTool: string | null
  readonly dimensionRaw: string
  readonly wall: { readonly start: WallPlanPoint | null; readonly end: WallPlanPoint | null }
  readonly fence: { readonly start: WallPlanPoint | null; readonly end: WallPlanPoint | null }
  readonly roof: { readonly start: WallPlanPoint | null; readonly end: WallPlanPoint | null }
  readonly polygon: { readonly type: string | null; readonly points: readonly WallPlanPoint[] }
  readonly path: {
    readonly kind: PathDraftKind | null
    readonly points: readonly PathDraftPoint[]
    readonly cursor: PathDraftPoint | null
  }
}

/** `null` when the active tool isn't a chained-draft kind this guide can
 *  honestly track — the default branch then shows only the two steps
 *  (select / click to place) it can represent, instead of two decorative
 *  ones that can never light up. */
export function resolveChainDraftProgress(input: ChainDraftInput): ChainDraftProgress | null {
  const { activeTool } = input
  if (!activeTool) return null
  const hasTypedDimension = input.dimensionRaw !== ''

  if (SEGMENT_DRAFT_TOOLS.has(activeTool)) {
    const segment =
      activeTool === 'wall' ? input.wall : activeTool === 'fence' ? input.fence : input.roof
    return {
      anchorPlaced: segment.start !== null,
      directionSet: hasTypedDimension || movedPastAnchor(segment.start, segment.end),
    }
  }

  if (POLYGON_DRAFT_TOOLS.has(activeTool)) {
    // `polygonDraftType`/`polygonDraftPoints` are shared across slab / ceiling
    // / zone — a mismatched type means the store hasn't caught up to a just-
    // switched tool yet, not that this tool has no anchor concept.
    const points = input.polygon.type === activeTool ? input.polygon.points : []
    return {
      anchorPlaced: points.length > 0,
      directionSet: hasTypedDimension || points.length > 1,
    }
  }

  if (PATH_DRAFT_TOOLS.has(activeTool as PathDraftKind)) {
    const matchesActiveTool = input.path.kind === activeTool
    const anchor = matchesActiveTool ? (input.path.points[0] ?? null) : null
    const cursor = matchesActiveTool ? input.path.cursor : null
    return {
      anchorPlaced: anchor !== null,
      directionSet: hasTypedDimension || movedPastAnchor(anchor, cursor),
    }
  }

  return null
}

/** The door workflow's post-placement phase: `Type → Opening` and
 *  `Rounded → R value` are edited on the placed door's own properties, not
 *  through any draft-preview store — so this reads the door node itself.
 *  `null` when no single door node is selected. */
export type DoorConfigProgress = {
  readonly openingKind: 'door' | 'opening'
  readonly openingShape: 'arch' | 'rectangle' | 'rounded'
} | null

export type WorkflowStepsInput = {
  readonly activeLabel: string | null
  readonly hasPaintMaterial: boolean
  readonly mode: WorkflowMode
  readonly chainDraft: ChainDraftProgress | null
  readonly doorProgress: DoorConfigProgress
  readonly t: (key: MessageId) => string
}

export function resolveWorkflowSteps(input: WorkflowStepsInput): {
  readonly isPaint: boolean
  readonly isOpeningTool: boolean
  readonly steps: readonly WorkflowStep[]
} {
  const { activeLabel, hasPaintMaterial, mode, chainDraft, doorProgress, t } = input
  const step = (key: MessageId, state: WorkflowStep['state']): WorkflowStep => ({
    label: t(key),
    state,
  })

  const isPaint = mode === 'material-paint'
  if (isPaint) {
    return {
      isPaint,
      isOpeningTool: false,
      steps: [
        step(
          'buildWorkflowGuide.paintSteps.chooseMaterial',
          hasPaintMaterial ? 'complete' : 'active',
        ),
        step(
          'buildWorkflowGuide.paintSteps.clickSurface',
          hasPaintMaterial ? 'active' : 'upcoming',
        ),
        step('buildWorkflowGuide.paintSteps.adjustSize', 'upcoming'),
      ],
    }
  }

  // The door tool deactivates itself the instant a door is placed (single-
  // shot placement) and selects the new door instead — so "Type → Opening"
  // and "Rounded → R value" happen after `activeLabel` has already gone
  // back to `null`. Treat that selected-door window as still the door
  // workflow rather than falling back to the unrelated default branch.
  const isPlacingDoor = mode === 'build' && activeLabel === 'Door'
  const isConfiguringDoor = mode === 'build' && !activeLabel && doorProgress !== null
  const isOpeningTool = isPlacingDoor || isConfiguringDoor
  if (isOpeningTool) {
    const isOpening = isConfiguringDoor && doorProgress?.openingKind === 'opening'
    const isRounded = isOpening && doorProgress?.openingShape === 'rounded'
    return {
      isPaint,
      isOpeningTool,
      steps: [
        step('buildWorkflowGuide.doorSteps.selectDoor', 'complete'),
        step('buildWorkflowGuide.doorSteps.placeOnWall', isConfiguringDoor ? 'complete' : 'active'),
        step(
          'buildWorkflowGuide.doorSteps.typeOpening',
          !isConfiguringDoor ? 'upcoming' : isOpening ? 'complete' : 'active',
        ),
        step(
          'buildWorkflowGuide.doorSteps.adjustRounded',
          !isOpening ? 'upcoming' : isRounded ? 'complete' : 'active',
        ),
      ],
    }
  }

  const hasTool = activeLabel !== null
  const selectStep: WorkflowStep = {
    label: activeLabel ?? t('buildWorkflowGuide.defaultSteps.selectElement'),
    state: hasTool ? 'complete' : 'active',
  }

  if (!chainDraft) {
    // No store represents this tool's placement as an anchor-then-direction
    // flow (e.g. single-click placements like column / elevator) — showing
    // "set direction" / "final click" here would be decorative, so those
    // two steps are dropped rather than left permanently upcoming.
    return {
      isPaint,
      isOpeningTool,
      steps: [
        selectStep,
        step('buildWorkflowGuide.defaultSteps.clickAnchor', hasTool ? 'active' : 'upcoming'),
      ],
    }
  }

  return {
    isPaint,
    isOpeningTool,
    steps: [
      selectStep,
      step(
        'buildWorkflowGuide.defaultSteps.clickAnchor',
        chainDraft.anchorPlaced ? 'complete' : 'active',
      ),
      step(
        'buildWorkflowGuide.defaultSteps.setDirection',
        !chainDraft.anchorPlaced ? 'upcoming' : chainDraft.directionSet ? 'complete' : 'active',
      ),
      step(
        'buildWorkflowGuide.defaultSteps.finalClick',
        chainDraft.directionSet ? 'active' : 'upcoming',
      ),
    ],
  }
}

function StepMarker({
  index,
  state,
}: {
  readonly index: number
  readonly state: WorkflowStep['state']
}) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border font-semibold text-[10px] ${
        state === 'complete'
          ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300'
          : state === 'active'
            ? 'border-primary/60 bg-primary/15 text-primary'
            : 'border-border/70 bg-background/40 text-muted-foreground'
      }`}
    >
      {state === 'complete' ? <Check className="h-3 w-3" /> : index}
    </span>
  )
}

export function BuildWorkflowGuide({
  activeLabel,
  activeTool,
  hasPaintMaterial,
  mode,
}: BuildWorkflowGuideProps) {
  const t = useT()
  const wallDraftStart = useFloorplanDraftPreview((state) => state.wallDraftStart)
  const wallDraftEnd = useFloorplanDraftPreview((state) => state.wallDraftEnd)
  const fenceDraftStart = useFloorplanDraftPreview((state) => state.fenceDraftStart)
  const fenceDraftEnd = useFloorplanDraftPreview((state) => state.fenceDraftEnd)
  const roofDraftStart = useFloorplanDraftPreview((state) => state.roofDraftStart)
  const roofDraftEnd = useFloorplanDraftPreview((state) => state.roofDraftEnd)
  const polygonDraftType = useFloorplanDraftPreview((state) => state.polygonDraftType)
  const polygonDraftPoints = useFloorplanDraftPreview((state) => state.polygonDraftPoints)
  const dimensionRaw = useDraftLengthHud((state) => state.raw)
  const pathDraftKind = usePathDraftPreview((state) => state.kind)
  const pathDraftPoints = usePathDraftPreview((state) => state.points)
  const pathDraftCursor = usePathDraftPreview((state) => state.cursor)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const nodes = useScene((state) => state.nodes)

  if (mode === 'hidden') return null

  const selectedNode = selectedIds.length === 1 ? nodes[selectedIds[0] as AnyNodeId] : undefined
  const doorProgress: DoorConfigProgress =
    selectedNode?.type === 'door'
      ? { openingKind: selectedNode.openingKind, openingShape: selectedNode.openingShape }
      : null

  const chainDraft = resolveChainDraftProgress({
    activeTool,
    dimensionRaw,
    wall: { start: wallDraftStart, end: wallDraftEnd },
    fence: { start: fenceDraftStart, end: fenceDraftEnd },
    roof: { start: roofDraftStart, end: roofDraftEnd },
    polygon: { type: polygonDraftType, points: polygonDraftPoints },
    path: { kind: pathDraftKind, points: pathDraftPoints, cursor: pathDraftCursor },
  })

  const { isPaint, isOpeningTool, steps } = resolveWorkflowSteps({
    activeLabel,
    hasPaintMaterial,
    mode,
    chainDraft,
    doorProgress,
    t,
  })

  return (
    <section
      className="overflow-hidden rounded-xl border border-border/70 bg-background/60 shadow-sm"
      data-testid="build-workflow-guide"
    >
      <div className="flex items-center gap-2 border-border/60 border-b px-2.5 py-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          {isPaint ? <PaintBucket className="h-3.5 w-3.5" /> : <Ruler className="h-3.5 w-3.5" />}
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-xs">
            {isPaint ? t('buildWorkflowGuide.paint.title') : t('buildWorkflowGuide.model.title')}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {isPaint ? t('buildWorkflowGuide.paint.desc') : t('buildWorkflowGuide.model.desc')}
          </p>
        </div>
        <MousePointer2 className="ml-auto h-3.5 w-3.5 text-muted-foreground/60" />
      </div>
      <ol className="grid gap-1 px-2.5 py-2">
        {steps.map((currentStep, index) => (
          <li className="flex items-center gap-2" key={currentStep.label}>
            <StepMarker index={index + 1} state={currentStep.state} />
            <span
              className={`text-[11px] ${
                currentStep.state === 'active'
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground'
              }`}
            >
              {currentStep.label}
            </span>
          </li>
        ))}
      </ol>
      {!isPaint && !isOpeningTool ? (
        <p className="border-border/60 border-t px-2.5 py-2 text-[10px] text-muted-foreground">
          {t('buildWorkflowGuide.editHint')}
        </p>
      ) : null}
    </section>
  )
}

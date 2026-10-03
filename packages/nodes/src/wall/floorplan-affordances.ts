import {
  type AnyNode,
  type AnyNodeId,
  buildWallEndpointUpdates,
  type FloorplanAffordance,
  type FloorplanAffordanceSession,
  getMaxWallCurveOffset,
  getWallChordFrame,
  normalizeWallCurveOffset,
  roomBoundarySnapshot,
  runAsSingleSceneHistoryStep,
  useLiveNodeOverrides,
  useScene,
  type WallNode,
  WallOperationError,
} from '@pascal-app/core'
import {
  alignFloorplanDraftPoint,
  createWallDirectionLock,
  getSegmentGridStep,
  isAlignmentGuideActive,
  isAngleSnapActive,
  isMagneticSnapActive,
  isSegmentLongEnough,
  resolveWallEndpointPoint,
  snapBuildingLocalToWorldGrid,
  snapScalarToGrid,
  useAlignmentGuides,
  type WallJunctionReference,
  type WallPlanPoint,
} from '@pascal-app/editor'

import { buildWallEndpointEditPlan } from './endpoint-edit-plan'

/**
 * Floor-plan 2D drag affordances for wall.
 *
 * Sister file to `move-endpoint-tool.tsx` — the 3D component port. This
 * one drives the same legacy interaction from SVG pointer events instead
 * of R3F grid events. The mutation logic is identical:
 *
 *   1. Capture original positions of the dragged wall + every wall whose
 *      endpoint coincides with either of the dragged wall's endpoints
 *      ("linked walls").
 *   2. On each tick: snap the moving point (grid → linked-wall → angle),
 *      compute primary endpoints, and cascade matching corners onto the
 *      linked walls. Publish to `useLiveNodeOverrides` — `WallSystem`,
 *      the 2D floor-plan layer, and the sidebar panel all merge the
 *      overrides in when reading endpoints, so `useScene` never sees a
 *      mid-drag write.
 *   3. On pointer-up: the dispatcher invokes `commit()`, which writes
 *      the final state to scene in one tracked update and clears the
 *      overrides. `canCommit` still guards against collapsed walls.
 *
 * Alt-detach (drop linked walls) is wired via the standard modifier
 * flags on the session.
 */

type WallEndpointPayload = { wallId: AnyNodeId; endpoint: 'start' | 'end' }

type LinkedWallSnapshot = {
  id: AnyNodeId
  start: WallPlanPoint
  end: WallPlanPoint
  parentId: string | null
  curveOffset?: number
}

function pointsEqual(a: readonly number[], b: readonly number[]) {
  return a[0] === b[0] && a[1] === b[1]
}

function collectLevelWalls(
  nodes: Record<AnyNodeId, AnyNode>,
  excludeWallId?: AnyNodeId,
  parentId?: string | null,
): WallNode[] {
  const out: WallNode[] = []
  for (const node of Object.values(nodes)) {
    if (
      node?.type === 'wall' &&
      node.id !== excludeWallId &&
      (parentId === undefined || (node.parentId ?? null) === (parentId ?? null))
    )
      out.push(node as WallNode)
  }
  return out
}

function collectLinkedWalls(
  nodes: Record<AnyNodeId, AnyNode>,
  draggedWallId: AnyNodeId,
  originalStart: WallPlanPoint,
  originalEnd: WallPlanPoint,
  parentId?: string | null,
): LinkedWallSnapshot[] {
  const linked: LinkedWallSnapshot[] = []
  for (const node of Object.values(nodes)) {
    if (node?.type !== 'wall') continue
    if (node.id === draggedWallId) continue
    const wall = node as WallNode
    if (parentId !== undefined && (wall.parentId ?? null) !== (parentId ?? null)) continue
    if (
      pointsEqual(wall.start, originalStart) ||
      pointsEqual(wall.start, originalEnd) ||
      pointsEqual(wall.end, originalStart) ||
      pointsEqual(wall.end, originalEnd)
    ) {
      linked.push({
        id: wall.id,
        start: [...wall.start] as WallPlanPoint,
        end: [...wall.end] as WallPlanPoint,
        parentId: (wall.parentId ?? null) as string | null,
        curveOffset: wall.curveOffset,
      })
    }
  }
  return linked
}

function getLinkedJunctionReference(
  linkedWalls: LinkedWallSnapshot[],
  movingOriginal: WallPlanPoint,
  parentId: string | null | undefined,
): WallJunctionReference | undefined {
  const oppositeEndpoints: WallPlanPoint[] = []
  for (const wall of linkedWalls) {
    if ((wall.parentId ?? null) !== (parentId ?? null)) continue
    if (Math.abs(wall.curveOffset ?? 0) > 1e-6) continue
    const opposite = pointsEqual(wall.start, movingOriginal)
      ? wall.end
      : pointsEqual(wall.end, movingOriginal)
        ? wall.start
        : null
    if (opposite) oppositeEndpoints.push([...opposite] as WallPlanPoint)
  }
  if (oppositeEndpoints.length < 2) return undefined
  return {
    sharedPoint: [...movingOriginal] as WallPlanPoint,
    oppositeEndpoints,
  }
}

/**
 * Wall curve sagitta drag — 1:1 port of the legacy
 * `handleWallCurvePointerDown` + commit flow. Drag projects the pointer
 * onto the chord normal to compute a `curveOffset`, snapped to the
 * grid step, clamped to `getMaxWallCurveOffset`,
 * normalized via `normalizeWallCurveOffset`. Same single-undo dance as
 * the move-endpoint affordance — the dispatcher handles snapshot /
 * pause / resume around `apply`.
 */
export const wallCurveAffordance: FloorplanAffordance<WallNode> = {
  start({ node }): FloorplanAffordanceSession {
    // Chord frame is fixed for the duration of the drag — only the
    // pointer projection along its normal changes.
    const chord = getWallChordFrame(node)
    const maxOffset = getMaxWallCurveOffset(node)
    const wallId = node.id as AnyNodeId
    let lastCurveOffset = node.curveOffset ?? 0

    return {
      affectedIds: [node.id],
      apply({ planPoint }) {
        const snapStep = getSegmentGridStep()
        // World-grid snap so a rotated building doesn't drag the curve
        // handle off the visible grid.
        const [x, y] = snapBuildingLocalToWorldGrid([planPoint[0], planPoint[1]], snapStep)

        // Signed projection of (snappedPoint - chord midpoint) onto the
        // chord normal. Legacy negates because the SVG y-axis flips
        // relative to plan y; the registry layer doesn't apply that flip
        // so the projection runs against the same normal the 3D tool
        // uses (which also has no flip). The result matches the 3D port
        // in `nodes/src/wall/curve-tool.tsx`.
        const offsetFromMidpoint = -(
          (x - chord.midpoint.x) * chord.normal.x +
          (y - chord.midpoint.y) * chord.normal.y
        )
        const snappedOffset = snapScalarToGrid(offsetFromMidpoint, snapStep)
        const nextCurveOffset = normalizeWallCurveOffset(
          node,
          Math.max(-maxOffset, Math.min(maxOffset, snappedOffset)),
        )
        lastCurveOffset = nextCurveOffset

        // Publish the curve preview as a live override so renderers see
        // it without zustand churn. Mark the wall dirty so `WallSystem`
        // rebuilds the geometry next frame using the override-merged
        // node.
        useLiveNodeOverrides.getState().set(wallId, { curveOffset: nextCurveOffset })
        useScene.getState().markDirty(wallId)
      },
      canCommit() {
        // Curve drag is always commit-eligible — the offset is already
        // clamped + normalized so we never end up in an invalid state.
        return true
      },
      commit() {
        // Atomic, tracked write of the final curve offset, then drop
        // the override so the scene state is the single source of
        // truth again.
        useScene.getState().updateNodes([{ id: wallId, data: { curveOffset: lastCurveOffset } }])
        useLiveNodeOverrides.getState().clear(wallId)
      },
    }
  },
}

export const wallMoveEndpointAffordance: FloorplanAffordance<WallNode> = {
  start({ node, payload, nodes }): FloorplanAffordanceSession {
    const { endpoint } = payload as WallEndpointPayload
    const baseline = roomBoundarySnapshot(nodes, node.parentId)
    let detached = false
    let validPreview = false
    let previewIds: AnyNodeId[] = []
    const fixedPoint: WallPlanPoint =
      endpoint === 'start' ? ([...node.end] as WallPlanPoint) : ([...node.start] as WallPlanPoint)
    const originalStart: WallPlanPoint = [...node.start] as WallPlanPoint
    const originalEnd: WallPlanPoint = [...node.end] as WallPlanPoint
    const linkedWalls = collectLinkedWalls(
      nodes,
      node.id,
      originalStart,
      originalEnd,
      node.parentId ?? null,
    )
    const affectedIds: AnyNodeId[] = [node.id, ...linkedWalls.map((w) => w.id)]
    const movingOriginal: WallPlanPoint = endpoint === 'start' ? originalStart : originalEnd
    // Walls attached to the MOVING corner cascade with the drag, but the snap
    // pipeline reads the scene store, which keeps their pre-drag coordinates
    // until commit. Their stale corners would recreate the old junction as a
    // snap/alignment target: inside the connect radius the endpoint could
    // never land closer than ~5cm to where it started, making sub-5cm
    // corrections (e.g. squaring a scan-imported 91° corner) impossible.
    // Excluded while attached; under Alt-detach they stay put and remain
    // legitimate targets. Mirrors the 3D move-endpoint tool.
    const movingLinkedWallIds = linkedWalls
      .filter((w) => pointsEqual(w.start, movingOriginal) || pointsEqual(w.end, movingOriginal))
      .map((w) => w.id)

    // Remember the latest preview so `commit()` can write it tracked.
    let lastPrimaryStart: WallPlanPoint = originalStart
    let lastPrimaryEnd: WallPlanPoint = originalEnd
    const directionLock = createWallDirectionLock()
    let directionInferred = false

    return {
      affectedIds,
      keyDown(key) {
        return directionLock.toggleAxis(
          key,
          fixedPoint,
          endpoint === 'start' ? lastPrimaryStart : lastPrimaryEnd,
          collectLevelWalls(useScene.getState().nodes, node.id, node.parentId ?? null).filter(
            (w) => w.parentId === node.parentId && !movingLinkedWallIds.includes(w.id),
          ),
        )
      },
      apply({ planPoint, modifiers }) {
        detached = modifiers.altKey
        directionLock.set(
          modifiers.shiftKey,
          fixedPoint,
          endpoint === 'start' ? lastPrimaryStart : lastPrimaryEnd,
        )
        // Re-collect walls every tick so the snap pipeline sees fresh
        // positions (matters when the user releases + re-grabs without
        // unmounting the layer). Snap reads from scene — which holds
        // the pre-drag positions throughout — so walls that cascade with
        // the moving corner are excluded (stale coordinates); under
        // Alt-detach they stay put, so they rejoin the candidate pool.
        const sceneNodes = useScene.getState().nodes
        const walls = collectLevelWalls(sceneNodes, node.id, node.parentId ?? null)
        const staleWallIds = modifiers.altKey ? [node.id] : [node.id, ...movingLinkedWallIds]
        // The grid step follows the active snapping mode (`getSegmentGridStep()`
        // is 0 outside grid mode), so `'lines' / 'angles' / 'off'` no longer
        // force a grid snap the mode chip says is inactive. In `'angles'` mode
        // the endpoint angle-locks off the fixed corner (free length), matching
        // the draft tool — the angle path ignores the `gridSnap` override.
        const angleLocked = isAngleSnapActive()
        const lockedThrough = directionLock.active
          ? directionLock.project(planPoint as WallPlanPoint, getSegmentGridStep())
          : null
        const junctionReference = modifiers.altKey
          ? undefined
          : getLinkedJunctionReference(linkedWalls, movingOriginal, node.parentId)
        const snapResult = resolveWallEndpointPoint({
          point: planPoint as WallPlanPoint,
          walls,
          ignoreWallIds: staleWallIds,
          start: fixedPoint,
          inferDirection: !node.curveOffset,
          angleSnap: angleLocked,
          magnetic: isMagneticSnapActive(),
          gridSnap: (p) => snapBuildingLocalToWorldGrid(p, getSegmentGridStep()),
          constraintRay: lockedThrough ? { origin: fixedPoint, through: lockedThrough } : undefined,
          junctionReference,
        })
        const snapped = snapResult.point
        // Figma-style alignment on the dragged corner — snaps it onto another
        // object's edge / wall face and publishes a guide. The guide is
        // DISPLAYED in every mode except Off (isAlignmentGuideActive); the
        // magnetic pull onto it is applied only in 'lines' mode
        // (isMagneticSnapActive), like the draft tool does. Only the dragged
        // wall and the siblings cascading with the moving corner are excluded
        // from the candidate pool — walls linked at the FIXED corner don't
        // move, and their anchors are what let the dragged corner align back
        // onto a true axis. Alt is detach, NOT bypass.
        let aligned =
          snapResult.constraintOwned || snapResult.targetCaptured
            ? snapped
            : (alignFloorplanDraftPoint(snapped, {
                applySnap: isMagneticSnapActive(),
                bypass: !isAlignmentGuideActive(),
                excludeIds: staleWallIds,
              }) as WallPlanPoint)
        directionInferred =
          (Boolean(snapResult.directionInferred) || Boolean(snapResult.targetCaptured)) &&
          (Boolean(snapResult.constraintOwned) ||
            Boolean(snapResult.targetCaptured) ||
            pointsEqual(aligned, snapped))
        if (snapResult.constraintOwned) useAlignmentGuides.getState().clear()
        if (directionLock.active && !snapResult.targetCaptured && !snapResult.constraintOwned) {
          aligned = directionLock.project(planPoint, getSegmentGridStep())
          useAlignmentGuides.getState().clear()
        }

        const primaryStart: WallPlanPoint = endpoint === 'start' ? aligned : fixedPoint
        const primaryEnd: WallPlanPoint = endpoint === 'end' ? aligned : fixedPoint

        lastPrimaryStart = primaryStart
        lastPrimaryEnd = primaryEnd

        const overrides = useLiveNodeOverrides.getState()
        const scene = useScene.getState()
        for (const id of previewIds) {
          overrides.clear(id)
          scene.markDirty(id)
        }
        previewIds = []
        validPreview = false
        if (scene.readOnly || roomBoundarySnapshot(scene.nodes, node.parentId) !== baseline) return
        try {
          const updates = buildWallEndpointUpdates(scene.nodes, node.id, primaryStart, primaryEnd, {
            detachLinkedWalls: detached,
          })
          validPreview = true
          for (const update of updates) {
            overrides.set(update.id, update.data)
            scene.markDirty(update.id)
            if (!affectedIds.includes(update.id)) affectedIds.push(update.id)
          }
          previewIds = updates.map((update) => update.id)
        } catch (error) {
          if (!(error instanceof WallOperationError)) throw error
        }
      },
      canCommit() {
        // Pointer-up always runs canCommit — drop the alignment guide here
        // so it doesn't linger after a commit / reject.
        useAlignmentGuides.getState().clear()
        // The dragged wall must still be long enough at the preview
        // length — checked against `lastPrimary*`, not scene, because
        // scene holds baseline values until commit().
        const scene = useScene.getState()
        if (
          !validPreview ||
          scene.readOnly ||
          roomBoundarySnapshot(scene.nodes, node.parentId) !== baseline ||
          !isSegmentLongEnough(lastPrimaryStart, lastPrimaryEnd)
        )
          return false
        try {
          buildWallEndpointEditPlan(scene.nodes, {
            wall: node,
            endpoint,
            start: lastPrimaryStart,
            end: lastPrimaryEnd,
            detach: detached,
            radius: directionLock.active || directionInferred ? 1e-7 : undefined,
          })
          return true
        } catch (error) {
          if (error instanceof WallOperationError) return false
          throw error
        }
      },
      commit() {
        const scene = useScene.getState()
        try {
          if (
            scene.readOnly ||
            roomBoundarySnapshot(scene.nodes, node.parentId) !== baseline ||
            !validPreview
          )
            return
          if (
            pointsEqual(lastPrimaryStart, originalStart) &&
            pointsEqual(lastPrimaryEnd, originalEnd)
          )
            return
          const plan = buildWallEndpointEditPlan(scene.nodes, {
            wall: node,
            endpoint,
            start: lastPrimaryStart,
            end: lastPrimaryEnd,
            detach: detached,
            radius: directionLock.active || directionInferred ? 1e-7 : undefined,
          })
          runAsSingleSceneHistoryStep(useScene, () => scene.applyNodeChanges(plan.changes))
        } catch (error) {
          if (!(error instanceof WallOperationError)) throw error
        } finally {
          for (const id of previewIds) {
            useLiveNodeOverrides.getState().clear(id)
            scene.markDirty(id)
          }
        }
      },
    }
  },
}

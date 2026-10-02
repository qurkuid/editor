import {
  type AnyNode,
  type AnyNodeId,
  getEffectiveWallSurfaceMaterial,
  getWallBandSlotId,
  getWallFaceBandConfig,
  getWallFaceBandForHeight,
  getWallSurfaceSideFromBandSlot,
  type PaintCapability,
  type PaintPatchArgs,
  type PaintPreviewArgs,
  parseMaterialRef,
  type SceneMaterialId,
  sceneRegistry,
  useScene,
  WALL_SURFACE_SLOT_DEFAULTS,
  type WallFinishRegion,
  type WallNode,
  type WallSurfaceSide,
  type WallSurfaceSlotId,
} from '@pascal-app/core'
import { getWallRegionMaterialPlan } from '@pascal-app/viewer'
import { type Material, type Mesh, type Object3D, type Ray, Raycaster } from 'three'
import {
  buildSlotPreviewMaterial,
  createSlotPaintCapability,
  previewSlotByUserData,
  resolvePaintMaterialRef,
} from '../shared/slot-paint'
import { resolveWallOpeningCeiling } from '../shared/wall-opening-ceiling'

const WALL_SLOT_IDS = new Set<string>(Object.keys(WALL_SURFACE_SLOT_DEFAULTS))
const WALL_ARRAY_SLOT_INDEX: Partial<Record<WallSurfaceSlotId, number>> = {
  interior: 1,
  exterior: 2,
  lowerInterior: 3,
  middleInterior: 4,
  upperInterior: 5,
  topInterior: 6,
  lowerExterior: 7,
  middleExterior: 8,
  upperExterior: 9,
  topExterior: 10,
}
const WALL_INDEX_SLOT = new Map<number, WallSurfaceSlotId>(
  Object.entries(WALL_ARRAY_SLOT_INDEX).map(([slotId, index]) => [
    index,
    slotId as WallSurfaceSlotId,
  ]),
)
const wallSlotRaycaster = new Raycaster()

function resolveSideFromMaterialIndex(materialIndex: number | null): WallSurfaceSide | null {
  const slotId = materialIndex === null ? undefined : WALL_INDEX_SLOT.get(materialIndex)
  if (slotId) return getWallSurfaceSideFromBandSlot(slotId)
  return null
}

function resolveWallSlotByRay(node: WallNode, ray: Ray | undefined): WallSurfaceSlotId | null {
  if (!ray) return null
  const root = sceneRegistry.nodes.get(node.id as AnyNodeId)
  if (!root) return null

  wallSlotRaycaster.ray.copy(ray)
  const hits = wallSlotRaycaster.intersectObject(root, true)
  for (const hit of hits) {
    const slotId = (hit.object as Object3D).userData?.slotId
    if (typeof slotId === 'string' && WALL_SLOT_IDS.has(slotId)) {
      return slotId as WallSurfaceSlotId
    }
  }

  return null
}

function clearPaintedRegionRoles(
  regions: readonly WallFinishRegion[] | undefined,
  roles: readonly string[],
): WallFinishRegion[] | undefined {
  if (!regions || regions.length === 0 || roles.length === 0)
    return regions ? [...regions] : regions
  const sideRoles = new Map<WallSurfaceSide, Set<string>>()
  for (const role of roles) {
    const side = getWallSurfaceSideFromBandSlot(role)
    if (!side) continue
    const sideSet = sideRoles.get(side) ?? new Set<string>()
    sideSet.add(role)
    sideRoles.set(side, sideSet)
  }
  if (sideRoles.size === 0) return [...regions]

  return regions.flatMap((region) => {
    const matchingRoles = sideRoles.get(region.side)
    if (!matchingRoles) return [region]
    const slots = { ...region.slots }
    let changed = false
    for (const role of matchingRoles) {
      if (!Object.hasOwn(slots, role)) continue
      delete slots[role]
      changed = true
    }
    if (!changed) return [region]
    return Object.keys(slots).length > 0 ? [{ ...region, slots }] : []
  })
}

function buildWallPaintPatch(
  node: WallNode,
  roles: readonly string[],
  materialRef: string | undefined,
): Partial<WallNode> {
  const nextSlots = { ...(node.slots ?? {}) }
  for (const role of roles) {
    if (materialRef) nextSlots[role] = materialRef
    else delete nextSlots[role]
  }
  const patch: Partial<WallNode> = { slots: nextSlots }
  if (node.finishRegions !== undefined) {
    patch.finishRegions = clearPaintedRegionRoles(node.finishRegions, roles)
  }
  return patch
}

function commitWallPaintRoles(args: PaintPatchArgs & { roles: string[] }): void {
  const roles = [...new Set(args.roles)]
  if (roles.length === 0) return
  const nodeId = args.node.id as AnyNodeId
  const state = useScene.getState()
  const currentNode = (state.nodes[nodeId] as WallNode | undefined) ?? (args.node as WallNode)
  const resolution = resolvePaintMaterialRef(state.materials, args.material, args.materialPreset)
  if (!resolution) return
  const { ref, newSceneMaterial } = resolution
  const patch = buildWallPaintPatch(currentNode, roles, ref)

  if (newSceneMaterial) {
    useScene.setState((current) => {
      if (current.readOnly) return current
      const node2 = current.nodes[nodeId] as WallNode | undefined
      if (!node2) return current
      const nextPatch = buildWallPaintPatch(node2, roles, ref)
      return {
        materials: {
          ...current.materials,
          [newSceneMaterial.id as SceneMaterialId]: newSceneMaterial,
        },
        nodes: {
          ...current.nodes,
          [nodeId]: { ...node2, ...nextPatch },
        },
      }
    })
    useScene.getState().markDirty(nodeId)
    return
  }

  state.updateNode(nodeId, patch as Partial<AnyNode>)
}

function commitWallPaint(args: PaintPatchArgs): void {
  commitWallPaintRoles({ ...args, roles: [args.role] })
}

/**
 * Resolve which wall face band the user clicked. The side comes from:
 *   1. Material-slot index from the renderer's groups. Cheap reference path.
 *   2. Falls back to the hit-surface normal + local-Z when the
 *      groups aren't conclusive. Front/back of the wall maps to the
 *      node's `frontSide` / `backSide` semantic; absent that, front
 *      → interior, back → exterior.
 *
 * Returns null when the click is too oblique (or lands on the wall's
 * end-cap, etc.) to confidently assign a side.
 */
export function resolveWallRole(args: {
  node: WallNode
  hitObject?: { userData?: { slotId?: unknown } }
  materialIndex: number | null
  normal: readonly [number, number, number] | undefined
  localPosition: readonly [number, number, number] | undefined
  ray?: Ray
}): string | null {
  const { node, hitObject, materialIndex, normal, localPosition, ray } = args
  const directSlotId = hitObject?.userData?.slotId
  if (typeof directSlotId === 'string' && WALL_SLOT_IDS.has(directSlotId)) {
    return directSlotId
  }

  const raySlotId = resolveWallSlotByRay(node, ray)
  if (raySlotId) return raySlotId

  if (materialIndex !== null && materialIndex >= 11) {
    return (
      getWallRegionMaterialPlan(node).find((entry) => entry.index === materialIndex)?.slotId ?? null
    )
  }

  const indexedSlotId = materialIndex === null ? undefined : WALL_INDEX_SLOT.get(materialIndex)
  const indexedSide = resolveSideFromMaterialIndex(materialIndex)
  const sideFromIndex = indexedSide ?? null
  if (indexedSlotId && indexedSlotId !== 'interior' && indexedSlotId !== 'exterior') {
    return indexedSlotId
  }

  if (sideFromIndex && localPosition) {
    const effectiveWallHeight = resolveWallOpeningCeiling(node, useScene.getState().nodes)
    const bands = getWallFaceBandConfig(node, effectiveWallHeight)
    if (!bands.enabled) return sideFromIndex
    return getWallBandSlotId(
      sideFromIndex,
      getWallFaceBandForHeight(node, localPosition[1], effectiveWallHeight),
    )
  }
  if (sideFromIndex) return sideFromIndex

  const normalZ = normal?.[2]
  const localZ = localPosition?.[2]
  const thickness = node.thickness ?? 0.1

  if (
    normalZ === undefined ||
    localZ === undefined ||
    localPosition === undefined ||
    Math.abs(normalZ) < 0.65 ||
    Math.abs(localZ) < Math.max(thickness * 0.2, 0.01)
  ) {
    return null
  }

  const hitFace = localZ >= 0 ? 'front' : 'back'
  const semantic = hitFace === 'front' ? node.frontSide : node.backSide

  if (semantic === 'interior' || semantic === 'exterior') {
    const effectiveWallHeight = resolveWallOpeningCeiling(node, useScene.getState().nodes)
    const bands = getWallFaceBandConfig(node, effectiveWallHeight)
    if (!bands.enabled) return semantic
    return getWallBandSlotId(
      semantic,
      getWallFaceBandForHeight(node, localPosition[1], effectiveWallHeight),
    )
  }

  const side = hitFace === 'front' ? 'interior' : 'exterior'
  const effectiveWallHeight = resolveWallOpeningCeiling(node, useScene.getState().nodes)
  const bands = getWallFaceBandConfig(node, effectiveWallHeight)
  if (!bands.enabled) return side
  return getWallBandSlotId(
    side,
    getWallFaceBandForHeight(node, localPosition[1], effectiveWallHeight),
  )
}

/**
 * Preview a wall paint by swapping just the painted face's entry in the wall
 * mesh's material array. The array is the shared cached `WallMaterials.visible`,
 * so we clone it before swapping and restore the original reference on cleanup
 * (never mutate the cache).
 */
function applyWallPreview(args: PaintPreviewArgs): (() => void) | null {
  const { role, material, materialPreset } = args
  if (!(role in WALL_ARRAY_SLOT_INDEX)) {
    return previewSlotByUserData(args)
  }

  const index = WALL_ARRAY_SLOT_INDEX[role as WallSurfaceSlotId]
  if (!index) return previewSlotByUserData(args)

  const mesh = sceneRegistry.nodes.get(args.node.id as AnyNodeId)
  if (!(mesh && (mesh as Mesh).isMesh)) return null
  const wallMesh = mesh as Mesh

  const current = wallMesh.material
  if (!Array.isArray(current)) return null

  const preview = buildSlotPreviewMaterial(material, materialPreset)
  if (!preview) return () => {}

  const previous = current as Material[]
  const next = previous.slice()
  next[index] = preview
  const side = getWallSurfaceSideFromBandSlot(role)
  if (side) {
    for (const entry of getWallRegionMaterialPlan(args.node as WallNode)) {
      if (entry.side !== side || entry.slotId !== role || entry.index >= next.length) continue
      next[entry.index] = preview
    }
  }
  wallMesh.material = next

  return () => {
    wallMesh.material = previous
  }
}

/**
 * Capability binding for the wall kind on the unified slot model. Painting
 * writes `node.slots[bandSide]` (a `library:` ref or a minted `scene:`
 * material) exactly like every other kind; `legacyEffective` reads the
 * whole-side fallback so old scenes still show the current value.
 */
const slotPaint = createSlotPaintCapability({
  roomScope: true,
  resolveRole: ({ node, hitObject, materialIndex, normal, localPosition, ray }) =>
    resolveWallRole({
      node: node as WallNode,
      hitObject: hitObject as { userData?: { slotId?: unknown } } | undefined,
      materialIndex,
      normal,
      localPosition,
      ray,
    }),
  applyPreview: applyWallPreview,
  legacyEffective: (node: AnyNode, role: string) => {
    const side = getWallSurfaceSideFromBandSlot(role)
    if (!side && role in WALL_SURFACE_SLOT_DEFAULTS) {
      return {
        material: undefined,
        materialPreset: WALL_SURFACE_SLOT_DEFAULTS[role as WallSurfaceSlotId],
      }
    }
    if (!side) return null

    const sideRef = (node as WallNode).slots?.[side]
    const parsed = parseMaterialRef(sideRef)
    if (parsed?.kind === 'library') {
      return { material: undefined, materialPreset: sideRef }
    }
    if (parsed?.kind === 'scene') {
      const sceneMaterial = useScene.getState().materials[parsed.id as SceneMaterialId]
      if (sceneMaterial) return { material: sceneMaterial.material, materialPreset: undefined }
    }

    const spec = getEffectiveWallSurfaceMaterial(node as WallNode, side)
    if (spec.material === undefined && spec.materialPreset === undefined) return null
    return { material: spec.material, materialPreset: spec.materialPreset }
  },
})

export const wallPaint: PaintCapability = {
  ...slotPaint,
  commit: commitWallPaint,
  commitRoles: commitWallPaintRoles,
  applyPreview: applyWallPreview,
}

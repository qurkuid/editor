import {
  type AnyNode,
  type AnyNodeId,
  generateSceneMaterialId,
  type MaterialSchema,
  parseMaterialRef,
  type SceneMaterialId,
  toSceneMaterialRef,
  useScene,
} from '@pascal-app/core'

type SlotsNode = AnyNode & { slots?: Record<string, string> }

/**
 * SketchUp-style texture placement for a painted surface on the unified slot
 * model (wall bands, ceiling underside, slab top), expressed in physical
 * units: where the tile starts on the face (metres), how big one tile is
 * (metres), and its rotation (degrees). The world-scale UV convention
 * (1 UV unit = 1/repeat metres) makes the mapping exact:
 *   u = worldX · repeatX + offsetU  →  pattern shift of +x m ⇒ offsetU −= x·repeatX
 */
export type SurfaceTextureTransform = {
  offsetXM: number
  offsetYM: number
  tileWidthM: number
  tileHeightM: number
  rotationDeg: number
}

const MIN_TILE_M = 0.01

function resolveRepeat(
  texture: NonNullable<MaterialSchema['texture']>,
  physicalSize: MaterialSchema['physicalSize'],
): [number, number] {
  if (Array.isArray(texture.repeat)) return [texture.repeat[0] || 1, texture.repeat[1] || 1]
  if (physicalSize) return [1 / physicalSize.widthM, 1 / physicalSize.heightM]
  const scale = texture.scale || 1
  return [scale, scale]
}

export function readSurfaceTextureTransform(
  material: MaterialSchema,
): SurfaceTextureTransform | null {
  const texture = material.texture
  if (!texture?.url) return null
  const [repeatX, repeatY] = resolveRepeat(texture, material.physicalSize)
  const [offsetU, offsetV] = texture.offset ?? [0, 0]
  return {
    offsetXM: -offsetU / repeatX,
    offsetYM: -offsetV / repeatY,
    tileWidthM: 1 / repeatX,
    tileHeightM: 1 / repeatY,
    rotationDeg: texture.rotationDeg ?? 0,
  }
}

export function applySurfaceTextureTransform(
  material: MaterialSchema,
  transform: SurfaceTextureTransform,
): MaterialSchema {
  const texture = material.texture
  if (!texture?.url) return material
  const tileWidthM = Math.max(MIN_TILE_M, transform.tileWidthM)
  const tileHeightM = Math.max(MIN_TILE_M, transform.tileHeightM)
  const repeatX = 1 / tileWidthM
  const repeatY = 1 / tileHeightM
  const rotationDeg = ((transform.rotationDeg % 360) + 360) % 360
  return {
    ...material,
    physicalSize: { widthM: tileWidthM, heightM: tileHeightM },
    texture: {
      ...texture,
      repeat: [repeatX, repeatY],
      offset: [-transform.offsetXM * repeatX, -transform.offsetYM * repeatY],
      rotationDeg: rotationDeg === 0 ? undefined : rotationDeg,
    },
  }
}

/** How many node slots reference this scene material. */
export function countSceneMaterialSlotUses(
  nodes: Record<string, AnyNode>,
  materialId: SceneMaterialId,
): number {
  const ref = toSceneMaterialRef(materialId)
  let uses = 0
  for (const node of Object.values(nodes)) {
    const slots = (node as { slots?: Record<string, string> }).slots
    if (!slots) continue
    for (const value of Object.values(slots)) {
      if (value === ref) uses += 1
    }
  }
  return uses
}

/**
 * Commit a placement change for the material on `slotId`.
 *
 * SketchUp semantics: positioning is per-face. A scene material used only by
 * this slot is edited in place; a shared one (or a `library:` ref, via
 * `freezeLibraryMaterial`) is forked into a new scene material and the slot
 * repointed — material creation and slot write land as one undo entry.
 */
export function commitSurfaceTextureTransform(args: {
  node: AnyNode
  slotId: string
  transform: SurfaceTextureTransform
  freezeLibraryMaterial: (catalogId: string) => MaterialSchema | null
}): void {
  const { node, slotId, transform, freezeLibraryMaterial } = args
  const state = useScene.getState()
  if (state.readOnly) return

  const currentNode = state.nodes[node.id as AnyNodeId] as SlotsNode | undefined
  const ref = (currentNode ?? (node as SlotsNode)).slots?.[slotId]
  const parsed = parseMaterialRef(ref)

  if (parsed?.kind === 'scene') {
    const sceneId = parsed.id as SceneMaterialId
    const sceneMaterial = state.materials[sceneId]
    if (!sceneMaterial?.material.texture?.url) return
    const patched = applySurfaceTextureTransform(sceneMaterial.material, transform)
    if (countSceneMaterialSlotUses(state.nodes, sceneId) <= 1) {
      state.updateSceneMaterial(sceneId, { material: patched })
      return
    }
    forkSceneMaterialForSlot(node.id as AnyNodeId, slotId, sceneMaterial.name, patched)
    return
  }

  if (parsed?.kind === 'library') {
    const frozen = freezeLibraryMaterial(parsed.id)
    if (!frozen?.texture?.url) return
    const patched = applySurfaceTextureTransform(frozen, transform)
    forkSceneMaterialForSlot(node.id as AnyNodeId, slotId, null, patched)
  }
}

function forkSceneMaterialForSlot(
  nodeId: AnyNodeId,
  slotId: string,
  baseName: string | null,
  material: MaterialSchema,
): void {
  const id = generateSceneMaterialId()
  useScene.setState((state) => {
    if (state.readOnly) return state
    const node = state.nodes[nodeId] as (AnyNode & { slots?: Record<string, string> }) | undefined
    if (!node) return state
    const name = baseName ?? `Material ${Object.keys(state.materials).length + 1}`
    return {
      materials: { ...state.materials, [id]: { id, name, material } },
      nodes: {
        ...state.nodes,
        [nodeId]: {
          ...node,
          slots: { ...(node.slots ?? {}), [slotId]: toSceneMaterialRef(id) },
        } as AnyNode,
      },
    }
  })
  useScene.getState().markDirty(nodeId)
}

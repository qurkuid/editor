import dedent from 'dedent'
import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { MaterialSchema } from '../material'
import { ItemNode } from './item'
import { SurfaceConstruction } from './surface-construction'
import { SurfaceHoleMetadata } from './surface-hole-metadata'

/**
 * A profile-swept feature hanging under the ceiling plane — 커튼박스
 * (curtain box), 단내림 (bulkhead / dropped soffit), or a free-drawn
 * custom section. The section `profile` is the SSOT for the shape:
 * presets only seed it, and every profile stays freely editable
 * afterwards (hybrid model — no fixed parametric specs).
 */
export const CeilingFeature = z.object({
  kind: z.enum(['curtain-box', 'drop', 'custom']),
  // Index into the ceiling polygon's edge list (edge i runs polygon[i] →
  // polygon[i+1 mod n]). The feature sweeps its profile along that edge.
  edgeIndex: z.number().int().min(0).default(0),
  // Section polyline in meters, closed implicitly (last → first).
  // u = perpendicular distance from the edge toward the ceiling interior,
  // v = vertical offset from the ceiling plane (negative = down).
  profile: z.array(z.tuple([z.number(), z.number()])).min(3),
})

export type CeilingFeature = z.infer<typeof CeilingFeature>

export const CeilingNode = BaseNode.extend({
  id: objectId('ceiling'),
  type: nodeType('ceiling'),
  children: z.array(ItemNode.shape.id).default([]),
  material: MaterialSchema.optional(),
  materialPreset: z.string().optional(),
  // Per-slot material overrides on the unified slot model, mirroring
  // `ShelfNode.slots`. Key = slot id (`surface`), value = a `MaterialRef`
  // (`library:<id>` / `scene:<id>`). Absent = the declared slot default.
  slots: z.record(z.string(), z.string()).optional(),
  polygon: z.array(z.tuple([z.number(), z.number()])),
  holes: z.array(z.array(z.tuple([z.number(), z.number()]))).default([]),
  holeMetadata: z.array(SurfaceHoleMetadata).default([]),
  // Build-up of this surface (joists/furring, boards, screed). Empty means
  // none recorded — the takeoff then reports plain area.
  construction: SurfaceConstruction,
  // Height in meters. Absent = the ceiling follows the level top: its
  // effective height is the same bound its write-clamp uses —
  // min(storey plane, lowest covering-slab underside over the polygon)
  // − CEILING_CLAMP_MARGIN (see `resolveCeilingHeight`). Present = an
  // explicit custom height, still write-clamped under that bound.
  height: z.number().optional(),
  autoFromWalls: z.boolean().default(false),
  features: z.array(CeilingFeature).default([]),
}).describe(
  dedent`
  Ceiling node - used to represent a ceiling in the building
  - polygon: array of [x, z] points defining the ceiling boundary
  - holes: array of polygons representing holes in the ceiling
  - holeMetadata: metadata parallel to holes, used to preserve manual and auto-managed cutouts
  - height: explicit height in meters; absent = follows the level top automatically
  - autoFromWalls: whether the ceiling is automatically generated from a closed wall loop
  - features: profile-swept sections hung under the ceiling plane along a polygon edge (curtain box, bulkhead/단내림, custom free-drawn sections)
  `,
)

export type CeilingNode = z.infer<typeof CeilingNode>

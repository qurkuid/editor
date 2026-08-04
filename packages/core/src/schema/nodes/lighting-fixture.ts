import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'
import { assetSchema } from './item'

export const LightingFixtureNode = BaseNode.extend({
  id: objectId('lighting-fixture'),
  type: nodeType('lighting-fixture'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 2.4, 0]),
  rotation: z.tuple([z.number(), z.number(), z.number()]).default([0, 0, 0]),
  lightType: z.enum(['point', 'spot', 'area', 'linear']).default('point'),
  lumens: z.number().min(0).max(100_000).default(800),
  colorTemperature: z.number().min(1000).max(20_000).default(3000),
  range: z.number().min(0).max(1000).default(8),
  beamAngle: z.number().min(5).max(170).default(45),
  areaSize: z.tuple([z.number().min(0.05), z.number().min(0.05)]).default([0.6, 0.6]),
  // Drafted plan-space endpoints of a two-click segment. For `lightType:
  // 'linear'` (T5 / LED strip) this is the tube itself; for point/spot it is
  // an evenly divided run of `count` fixtures — ONE node carries the whole
  // run, so moving, rotating, property edits, and a count change apply to
  // every light at once. Absent for a single fixture. `position` still
  // carries the segment midpoint and `rotation` the segment's Y bearing —
  // the renderer derives only the scalar length from these, so a later move
  // of `position` doesn't need to keep `start`/`end` in lockstep.
  start: z.tuple([z.number(), z.number()]).optional(),
  end: z.tuple([z.number(), z.number()]).optional(),
  // Fixture count of a point/spot run (ignored for linear/area).
  count: z.number().int().min(2).max(50).optional(),
  linearWidth: z.number().min(0.01).max(0.5).default(0.05),
  enabled: z.boolean().default(true),
  circuitId: z.string().nullable().default(null),
  // Optional catalog model (a lighting GLB from the item catalog) rendered in
  // place of the primitive fixture body. The light source and the visible
  // luminaire live on ONE node so they move, rotate, undo, and price together
  // — a separate item node would double-count in the estimate takeoff.
  asset: assetSchema.optional(),
})

export type LightingFixtureNode = z.infer<typeof LightingFixtureNode>

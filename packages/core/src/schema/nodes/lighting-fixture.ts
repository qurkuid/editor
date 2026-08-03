import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

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
  // Drafted plan-space endpoints of a `lightType: 'linear'` (T5 / LED strip)
  // fixture, wall-style. Absent for point/spot/area. `position` still carries
  // the segment midpoint and `rotation` the segment's Y bearing — the
  // renderer derives only the scalar length from these, so a later move of
  // `position` doesn't need to keep `start`/`end` in lockstep.
  start: z.tuple([z.number(), z.number()]).optional(),
  end: z.tuple([z.number(), z.number()]).optional(),
  linearWidth: z.number().min(0.01).max(0.5).default(0.05),
  enabled: z.boolean().default(true),
  circuitId: z.string().nullable().default(null),
})

export type LightingFixtureNode = z.infer<typeof LightingFixtureNode>

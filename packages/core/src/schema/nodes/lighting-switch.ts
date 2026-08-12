import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const LightingSwitchNode = BaseNode.extend({
  id: objectId('lighting-switch'),
  type: nodeType('lighting-switch'),
  position: z.tuple([z.number(), z.number(), z.number()]).default([0, 1.2, 0]),
  rotation: z.number().default(0),
  circuitId: z.string().nullable().default(null),
  gangCount: z.number().int().min(1).max(4).default(1),
  switchShape: z.enum(['rectangle', 'round']).default('rectangle'),
})

export type LightingSwitchNode = z.infer<typeof LightingSwitchNode>

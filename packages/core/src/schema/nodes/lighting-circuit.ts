import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

export const LightingCircuitNode = BaseNode.extend({
  id: objectId('lighting-circuit'),
  type: nodeType('lighting-circuit'),
  enabled: z.boolean().default(true),
  circuitNumber: z.number().int().min(1).default(1),
})

export type LightingCircuitNode = z.infer<typeof LightingCircuitNode>

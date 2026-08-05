import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

const FiniteCoordinate = z.number().finite()

// Field-level refine (not node-level superRefine): AnyNode is a
// discriminatedUnion, whose members must stay plain ZodObjects.
const GuideDirection = z
  .tuple([FiniteCoordinate, FiniteCoordinate])
  .refine((direction) => Math.hypot(direction[0], direction[1]) > 1e-9, {
    message: 'Construction guide direction must be non-zero',
  })

/**
 * Infinite construction guide line on the floor plan — the SketchUp
 * tape-measure guide: an unbounded dashed reference line, parallel-offset
 * from a picked edge, that drafting aligns against. Pure reference
 * geometry: never baked, never rendered in 3D.
 */
export const ConstructionGuideNode = BaseNode.extend({
  id: objectId('cguide'),
  type: nodeType('construction-guide'),
  /** A point on the line, level-frame XZ meters. */
  origin: z.tuple([FiniteCoordinate, FiniteCoordinate]),
  /** Line direction (unnormalized ok, non-zero), level-frame XZ. */
  direction: GuideDirection,
})

export type ConstructionGuideNode = z.infer<typeof ConstructionGuideNode>

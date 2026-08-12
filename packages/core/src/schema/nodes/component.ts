import { z } from 'zod'
import { BaseNode, nodeType, objectId } from '../base'

const Point3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])

export const ComponentNode = BaseNode.extend({
  id: objectId('component'),
  type: nodeType('component'),
  position: Point3.default([0, 0, 0]),
  rotation: Point3.default([0, 0, 0]),
  scale: Point3.default([1, 1, 1]),
  children: z.array(objectId('body')).min(1),
  definitionId: z.string().nullable().default(null),
}).describe('Linked reusable Body component instance')

export type ComponentNode = z.infer<typeof ComponentNode>

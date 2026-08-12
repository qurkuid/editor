'use client'

import { type BodyGroupNode, useRegistry } from '@pascal-app/core'
import { NodeRenderer, useNodeEvents } from '@pascal-app/viewer'
import { useRef } from 'react'
import type { Group } from 'three'

export const BodyGroupRenderer = ({ node }: { node: BodyGroupNode }) => {
  const ref = useRef<Group>(null!)
  useRegistry(node.id, node.type, ref)
  const handlers = useNodeEvents(node, 'body-group')
  return (
    <group
      position={node.position}
      rotation={node.rotation}
      scale={node.scale}
      ref={ref}
      {...handlers}
    >
      {node.children.map((childId) => (
        <NodeRenderer key={childId} nodeId={childId} />
      ))}
    </group>
  )
}

export default BodyGroupRenderer

'use client'

import { type AnyNodeId, emitter, type LightingSwitchEvent, useScene } from '@pascal-app/core'
import { useEffect } from 'react'

export default function LightingSwitchSystem() {
  useEffect(() => {
    const toggle = (event: LightingSwitchEvent) => {
      const circuitId = event.node.circuitId
      if (!circuitId) return
      const circuit = useScene.getState().nodes[circuitId as AnyNodeId]
      if (circuit?.type !== 'lighting-circuit') return
      useScene.getState().updateNode(circuit.id, { enabled: !circuit.enabled })
    }
    emitter.on('lighting-switch:click', toggle)
    return () => emitter.off('lighting-switch:click', toggle)
  }, [])
  return null
}

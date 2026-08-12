'use client'

import { type AnyNodeId, emitter, type LightingSwitchEvent, useScene } from '@pascal-app/core'
import { useEffect } from 'react'
import { resolveLightingSwitchCircuitIds, resolveLightingSwitchGangIndex } from './circuits'

export default function LightingSwitchSystem() {
  useEffect(() => {
    const toggle = (event: LightingSwitchEvent) => {
      const gangIndex = resolveLightingSwitchGangIndex(event.object.name, event.node.gangCount)
      const circuitId = resolveLightingSwitchCircuitIds(event.node)[gangIndex]
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

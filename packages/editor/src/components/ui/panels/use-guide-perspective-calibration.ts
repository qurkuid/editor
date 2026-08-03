import {
  emitter,
  type GuideEvent,
  type GuideImagePoint,
  type GuideNode,
  GuidePerspectiveCorners,
} from '@pascal-app/core'
import { useCallback, useEffect, useState } from 'react'
import useEditor from '../../../store/use-editor'

const CORNER_LABELS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value))
}

export function useGuidePerspectiveCalibration(
  guide: GuideNode,
  onUpdate: (patch: Partial<GuideNode>) => void,
) {
  const [points, setPoints] = useState<readonly GuideImagePoint[] | null>(null)
  const cancel = useCallback(() => setPoints(null), [])

  useEffect(() => {
    if (!points) return

    const collectPoint = (event: GuideEvent) => {
      if (event.node.id !== guide.id || !event.nativeEvent.uv) return
      event.stopPropagation()
      const nextPoint: GuideImagePoint = [
        clamp01(event.nativeEvent.uv.x),
        clamp01(event.nativeEvent.uv.y),
      ]
      const nextPoints = [...points, nextPoint]
      if (nextPoints.length < 4) {
        setPoints(nextPoints)
        return
      }
      const parsed = GuidePerspectiveCorners.safeParse(nextPoints)
      if (parsed.success) onUpdate({ perspectiveCorners: parsed.data })
      setPoints(null)
    }

    emitter.on('guide:click', collectPoint)
    return () => emitter.off('guide:click', collectPoint)
  }, [guide.id, onUpdate, points])

  useEffect(() => {
    if (!points) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [cancel, points])

  const start = useCallback(() => {
    useEditor.getState().setMode('select')
    if (guide.perspectiveCorners) {
      onUpdate({ perspectiveCorners: null })
    }
    setPoints([])
  }, [guide.perspectiveCorners, onUpdate])

  return {
    cancel,
    isCalibrating: points !== null,
    nextCorner: points ? CORNER_LABELS[points.length] : null,
    pointsCollected: points?.length ?? 0,
    start,
  }
}

'use client'

import { DimensionPill } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'

type OffsetFaceActionsProps = {
  readonly distance: number
  readonly dragging: boolean
  readonly onBegin: () => void
  readonly previewValid: boolean
}

export function OffsetFaceActions({
  distance,
  dragging,
  onBegin,
  previewValid,
}: OffsetFaceActionsProps) {
  const unit = useViewer((state) => state.unit)
  if (dragging) {
    return (
      <div
        aria-invalid={!previewValid}
        className={`pointer-events-none ${
          previewValid ? '' : 'rounded-full bg-destructive/10 ring-2 ring-destructive/70'
        }`}
        data-offset-preview-state={previewValid ? 'valid' : 'invalid'}
      >
        <DimensionPill
          parts={[{ key: 'distance', prefix: 'Offset', value: distance, signed: true }]}
          primary="distance"
          unit={unit}
        />
      </div>
    )
  }

  return (
    <button
      className="whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-3 py-1.5 font-medium text-foreground text-xs shadow-md backdrop-blur hover:bg-accent"
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        onBegin()
      }}
      type="button"
    >
      Offset
    </button>
  )
}

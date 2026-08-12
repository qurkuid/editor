'use client'

import { DimensionPill } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'

type SweepFaceActionsProps = {
  readonly stationCount: number
  readonly dragging: boolean
  readonly closed: boolean
  readonly previewValid: boolean
  readonly onBegin: () => void
}

export function SweepFaceActions({
  stationCount,
  dragging,
  closed,
  previewValid,
  onBegin,
}: SweepFaceActionsProps) {
  const unit = useViewer((state) => state.unit)
  if (dragging) {
    return (
      <div
        aria-invalid={!previewValid}
        className={
          previewValid
            ? 'pointer-events-none'
            : 'pointer-events-none rounded-full bg-destructive/10 ring-2 ring-destructive/70'
        }
        data-sweep-preview-state={previewValid ? 'valid' : 'invalid'}
      >
        <DimensionPill
          parts={[
            {
              key: 'stations',
              prefix: closed ? 'Follow Path closed' : 'Follow Path',
              value: stationCount,
              signed: false,
            },
          ]}
          primary="stations"
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
      Follow Path
    </button>
  )
}

'use client'

import { DimensionPill, useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { useBodyToolOptions } from './options'

type PushPullFaceActionsProps = {
  readonly bodyId: string
  readonly faceId: string
  readonly distance: number
  readonly dragging: boolean
  readonly imprintEligible: boolean
  readonly onBegin: () => void
  readonly previewValid: boolean
}

export function PushPullFaceActions({
  bodyId,
  faceId,
  distance,
  dragging,
  imprintEligible,
  onBegin,
  previewValid,
}: PushPullFaceActionsProps) {
  const unit = useViewer((state) => state.unit)
  if (dragging) {
    return (
      <div
        aria-invalid={!previewValid}
        className={`pointer-events-none ${
          previewValid ? '' : 'rounded-full bg-destructive/10 ring-2 ring-destructive/70'
        }`}
        data-push-pull-preview-state={previewValid ? 'valid' : 'invalid'}
      >
        <DimensionPill
          parts={[{ key: 'distance', prefix: 'Push/Pull', value: distance, signed: true }]}
          primary="distance"
          unit={unit}
        />
      </div>
    )
  }
  return (
    <div className="flex gap-1.5">
      <button
        className="whitespace-nowrap rounded-full border border-border/60 bg-background/90 px-3 py-1.5 font-medium text-foreground text-xs shadow-md backdrop-blur hover:bg-accent"
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onBegin()
        }}
        type="button"
      >
        Push/Pull
      </button>
      {imprintEligible ? (
        <button
          className="whitespace-nowrap rounded-full border border-sky-400/50 bg-background/90 px-3 py-1.5 font-medium text-sky-300 text-xs shadow-md backdrop-blur hover:bg-sky-400/15"
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
            useBodyToolOptions.getState().setFaceDraft({ bodyId, faceId })
            const editor = useEditor.getState()
            editor.setPhase('structure')
            editor.setStructureLayer('elements')
            editor.setMode('build')
            editor.setTool('body')
          }}
          type="button"
        >
          Draw on face
        </button>
      ) : null}
    </div>
  )
}

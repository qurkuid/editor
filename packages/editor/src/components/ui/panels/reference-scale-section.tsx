'use client'

import type { GuideNode } from '@pascal-app/core'
import { Ruler } from 'lucide-react'
import { useCallback } from 'react'
import { guideEmitter } from '../../../lib/guide-events'
import { cn } from '../../../lib/utils'
import useEditor from '../../../store/use-editor'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { useT } from '../../../i18n/use-t'

function getScaleStatus(guide: GuideNode, referenceVisible: boolean) {
  const reference = guide.scaleReference
  if (!reference) {
    return 'Uncalibrated'
  }

  return `${referenceVisible ? 'Scaled' : 'Scaled (hidden)'} · ${reference.label}`
}

export function ReferenceScaleSection({
  guide,
  isActive,
  onUpdate,
  referenceVisible,
  setLocked,
  setReferenceVisible,
}: {
  readonly guide: GuideNode
  readonly isActive: boolean
  readonly onUpdate: (patch: Partial<GuideNode>) => void
  readonly referenceVisible: boolean
  readonly setLocked: (locked: boolean) => void
  readonly setReferenceVisible: (visible: boolean) => void
}) {
  const t = useT()
  const start = useCallback(() => {
    const editor = useEditor.getState()
    if (editor.viewMode === '3d') {
      editor.setViewMode('2d')
    }
    guideEmitter.emit('guide:set-reference-scale', { guideId: guide.id })
  }, [guide.id])

  const cancel = useCallback(() => {
    guideEmitter.emit('guide:cancel-reference-scale')
  }, [])

  return (
    <PanelSection title={t('panel.referenceScale')}>
      <div className="flex items-center gap-2 rounded-md border border-border/50 bg-background/40 px-2.5 py-2 text-sm">
        <Ruler
          className={cn(
            'h-4 w-4 shrink-0',
            guide.scaleReference ? 'text-primary' : 'text-amber-600 dark:text-amber-400',
          )}
        />
        <span className="truncate text-muted-foreground">
          {getScaleStatus(guide, referenceVisible)}
        </span>
      </div>

      {!guide.scaleReference && (
        <p className="px-0.5 text-muted-foreground text-xs leading-snug">
          {isActive
            ? 'Click both ends of a known distance on the plan, then type its real length.'
            : 'Draw a line over a known dimension on the plan, then type its real length to scale the image exactly.'}
        </p>
      )}

      <ActionGroup>
        <ActionButton
          className={cn(
            !(guide.scaleReference || isActive) &&
              'border-primary/50 bg-primary/15 text-primary hover:bg-primary/25 active:bg-primary/25',
          )}
          label={isActive ? 'Cancel' : guide.scaleReference ? 'Edit Scale' : 'Set Scale'}
          onClick={isActive ? cancel : start}
        />
      </ActionGroup>

      {guide.scaleReference && (
        <ActionGroup>
          <ActionButton
            label={referenceVisible ? 'Hide Scale' : 'Show Scale'}
            onClick={() => setReferenceVisible(!referenceVisible)}
          />
          <ActionButton
            label={t('panel.clearScale')}
            onClick={() => {
              onUpdate({ scaleReference: null })
              setLocked(false)
            }}
          />
        </ActionGroup>
      )}
    </PanelSection>
  )
}

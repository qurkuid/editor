'use client'

import { ActionMenuButton, type MessageId, useEditor, useT } from '@pascal-app/editor'
import { type BodyPrimitive, useBodyToolOptions } from '@pascal-app/nodes'
import { Circle, type LucideIcon, Minus, Pipette, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import { selectBodyPrimitive } from './body-modeling-tools'
import { activateBuildTool } from './build-tab'

const PRIMITIVES: ReadonlyArray<{
  id: BodyPrimitive
  labelKey: MessageId
  icon: LucideIcon
}> = [
  { id: 'line', labelKey: 'bodyModeling.primitive.line', icon: Minus },
  { id: 'rectangle', labelKey: 'bodyModeling.primitive.rectangle', icon: Square },
  { id: 'circle', labelKey: 'bodyModeling.primitive.circle', icon: Circle },
]

/**
 * Bottom action-rail additions, injected via `Editor`'s `actionMenuControls`
 * slot: the Build tab's Direct Modeling primitives (line / rectangle / circle)
 * plus the paint eyedropper. Lives in the app layer because the body-tool
 * option store comes from `@pascal-app/nodes`, which `@pascal-app/editor`
 * must not import.
 */
export function ModelingRailControls() {
  const t = useT()
  const mode = useEditor((s) => s.mode)
  const activeTool = useEditor((s) => s.tool)
  const paintSampling = useEditor((s) => s.paintSampling)
  const primitive = useBodyToolOptions((s) => s.primitive)
  const setPrimitive = useBodyToolOptions((s) => s.setPrimitive)

  const bodyActive = mode === 'build' && activeTool === 'body'
  const eyedropperActive = mode === 'material-paint' && paintSampling

  const armEyedropper = () => {
    const ed = useEditor.getState()
    if (eyedropperActive) {
      // Already armed — a second click stands down to plain painting.
      ed.setPaintSampling(false)
      return
    }
    ed.setPhase('structure')
    ed.setStructureLayer('elements')
    ed.setMode('material-paint')
    ed.setPaintSampling(true)
  }

  return (
    <>
      {PRIMITIVES.map(({ id, labelKey, icon: Icon }) => {
        const isActive = bodyActive && primitive === id
        return (
          <ActionMenuButton
            aria-label={t(labelKey)}
            aria-pressed={isActive}
            className={cn(
              'text-muted-foreground',
              isActive ? 'bg-sky-500/20 text-sky-400' : 'hover:bg-sky-500/20 hover:text-sky-400',
            )}
            key={id}
            label={t(labelKey)}
            onClick={() =>
              selectBodyPrimitive(id, {
                activateBodyTool: () => activateBuildTool('body'),
                setPrimitive,
              })
            }
            size="icon"
            variant="ghost"
          >
            <Icon className="h-5 w-5" />
          </ActionMenuButton>
        )
      })}
      <ActionMenuButton
        aria-label={t('actionMenu.eyedropper')}
        aria-pressed={eyedropperActive}
        className={cn(
          'text-muted-foreground',
          eyedropperActive
            ? 'bg-amber-500/20 text-amber-400'
            : 'hover:bg-amber-500/20 hover:text-amber-400',
        )}
        label={t('actionMenu.eyedropper')}
        onClick={armEyedropper}
        size="icon"
        variant="ghost"
      >
        <Pipette className="h-5 w-5" />
      </ActionMenuButton>
    </>
  )
}

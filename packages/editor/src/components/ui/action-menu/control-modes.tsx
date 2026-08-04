'use client'

import { useTLabel } from '../../../i18n/use-t-label'
import { Icon } from '@iconify/react'
import { useViewer } from '@pascal-app/viewer'
import { type LucideIcon, RotateCw, Trash2 } from 'lucide-react'
import Image from 'next/image'
import { Fragment } from 'react'
import {
  type RebindableShortcutId,
  resolveShortcutKey,
} from './../../../lib/keyboard-shortcuts'
import { cn } from './../../../lib/utils'
import useEditor from './../../../store/use-editor'
import usePivotRotate from './../../../store/use-pivot-rotate'
import { ActionButton } from './action-button'
import { MeasurementControl } from './measurement-control'

type ControlId = 'select' | 'rotate' | 'box-select' | 'zone' | 'delete'

// Badge keys resolve through the settings keyboard page's override map —
// the page stays the single source for every rebindable shortcut.
const CONTROL_SHORTCUT_IDS: Partial<Record<ControlId, RebindableShortcutId>> = {
  select: 'mode-select',
  rotate: 'pivot-rotate',
  zone: 'tool-zone',
  delete: 'mode-delete',
}

type ControlConfig = {
  id: ControlId
  icon?: LucideIcon
  iconifyIcon?: string
  imageSrc?: string
  label: string
  shortcut?: string
  color: string
  activeColor: string
}

// Fixed set of controls — always visible, never morphs
const controls: ControlConfig[] = [
  {
    id: 'select',
    imageSrc: '/icons/select.webp',
    label: 'Select',
    color: 'hover:bg-blue-500/20 hover:text-blue-400',
    activeColor: 'bg-blue-500/20 text-blue-400',
  },
  {
    id: 'rotate',
    icon: RotateCw,
    label: 'Rotate',
    color: 'hover:bg-violet-500/20 hover:text-violet-400',
    activeColor: 'bg-violet-500/20 text-violet-400',
  },
  {
    id: 'zone',
    imageSrc: '/icons/zone.webp',
    label: 'Zone',
    color: 'hover:bg-green-500/20 hover:text-green-400',
    activeColor: 'bg-green-500/20 text-green-400',
  },
  {
    id: 'delete',
    icon: Trash2,
    label: 'Delete',
    color: 'hover:bg-red-500/20 hover:text-red-400',
    activeColor: 'bg-red-500/20 text-red-400',
  },
]

export function ControlModes() {
  const tLabel = useTLabel()
  const mode = useEditor((state) => state.mode)
  const phase = useEditor((state) => state.phase)
  const selectionTool = useEditor((state) => state.floorplanSelectionTool)
  const setMode = useEditor((state) => state.setMode)
  const setPhase = useEditor((state) => state.setPhase)
  const setStructureLayer = useEditor((state) => state.setStructureLayer)
  const setSelectionTool = useEditor((state) => state.setFloorplanSelectionTool)

  const isSiteEditing = phase === 'site'

  const structureLayer = useEditor((state) => state.structureLayer)
  const isPivotRotating = usePivotRotate((state) => state.stage !== 'idle')
  const hasSelection = useViewer((state) => state.selection.selectedIds.length > 0)
  const shortcutOverrides = useEditor((state) => state.shortcutOverrides)

  const getIsActive = (id: ControlId): boolean => {
    if (id === 'select') return mode === 'select' && selectionTool === 'click'
    if (id === 'rotate') return isPivotRotating
    if (id === 'box-select') return mode === 'select' && selectionTool === 'marquee'
    if (id === 'zone')
      return mode === 'build' && phase === 'structure' && structureLayer === 'zones'
    return mode === id
  }

  const handleClick = (id: ControlId) => {
    // Rotate is a selection-scoped gesture, not a persistent mode — it needs
    // the selection that exists right now, so handle it before the generic
    // site-exit below (which clears it).
    if (id === 'rotate') {
      const pivotRotate = usePivotRotate.getState()
      if (pivotRotate.stage !== 'idle') pivotRotate.cancel()
      else pivotRotate.start(useViewer.getState().selection.selectedIds)
      return
    }

    // Exit site editing first if needed. Sculpting is a site-phase mode, so
    // leaving the phase is exactly the right way to leave the brush — but the
    // order matters: `setPhase` resets the mode, and setting the mode first
    // would have it overwritten below.
    if (isSiteEditing) {
      setPhase('structure')
      setStructureLayer('elements')
    }

    if (id === 'select') {
      setMode('select')
      setSelectionTool('click')
    } else if (id === 'box-select') {
      setMode('select')
      setSelectionTool('marquee')
    } else if (id === 'zone') {
      if (getIsActive('zone')) {
        setMode('select')
      } else {
        setPhase('structure')
        setStructureLayer('zones')
        setMode('build')
      }
    } else {
      setMode(id)
    }
  }

  return (
    <div className="flex items-center gap-1">
      {controls.map((c) => {
        const ModeIcon = c.icon
        const isImageMode = Boolean(c.imageSrc)
        const isActive = getIsActive(c.id)
        // Rotate acts on the current selection; without one it has nothing
        // to rotate, so it reads disabled (the click is already a no-op).
        const isInert = c.id === 'rotate' && !hasSelection && !isActive
        const shortcutId = CONTROL_SHORTCUT_IDS[c.id]

        return (
          <Fragment key={c.id}>
            {c.id === 'delete' ? <MeasurementControl /> : null}
            <ActionButton
              aria-label={tLabel(c.label)}
              className={cn(
                'group text-muted-foreground',
                !(isImageMode || isActive) && c.color,
                !isImageMode && isActive && c.activeColor,
                isImageMode && isActive && 'bg-white/10 hover:bg-white/10',
                isImageMode && !isActive && 'hover:bg-white/5',
                isInert && 'cursor-not-allowed opacity-40 hover:bg-transparent',
              )}
              label={tLabel(c.label)}
              onClick={() => handleClick(c.id)}
              shortcut={
                shortcutId
                  ? resolveShortcutKey(shortcutId, shortcutOverrides).toUpperCase()
                  : c.shortcut
              }
              size="icon"
              variant="ghost"
            >
              {c.imageSrc ? (
                <Image
                  alt={tLabel(c.label)}
                  className={cn(
                    'h-[28px] w-[28px] object-contain transition-[opacity,filter] duration-200',
                    isActive
                      ? 'opacity-100 grayscale-0'
                      : 'opacity-60 grayscale group-hover:opacity-100 group-hover:grayscale-0',
                  )}
                  height={28}
                  src={c.imageSrc}
                  width={28}
                />
              ) : c.iconifyIcon ? (
                <Icon color="currentColor" height={18} icon={c.iconifyIcon} width={18} />
              ) : (
                ModeIcon && <ModeIcon className="h-5 w-5" />
              )}
            </ActionButton>
          </Fragment>
        )
      })}
    </div>
  )
}

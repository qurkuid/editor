'use client'

import { Icon } from '@iconify/react'
import { Copy, Move, Search, Spline, Trash2 } from 'lucide-react'
import type { MouseEventHandler, PointerEventHandler } from 'react'
import { useT } from '../../i18n/use-t'
import type { WallConstructionDisplayMode } from '../../store/use-wall-construction-display'

type NodeActionMenuProps = {
  onFind?: MouseEventHandler<HTMLButtonElement>
  onAddHole?: MouseEventHandler<HTMLButtonElement>
  onDelete?: MouseEventHandler<HTMLButtonElement>
  onDuplicate?: MouseEventHandler<HTMLButtonElement>
  onMove?: MouseEventHandler<HTMLButtonElement>
  onCurve?: MouseEventHandler<HTMLButtonElement>
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onPointerUp?: PointerEventHandler<HTMLDivElement>
  onPointerEnter?: PointerEventHandler<HTMLDivElement>
  onPointerLeave?: PointerEventHandler<HTMLDivElement>
  wallDisplay?: {
    mode: WallConstructionDisplayMode
    onChange: (mode: WallConstructionDisplayMode) => void
  }
}

export function NodeActionMenu({
  onFind,
  onAddHole,
  onDelete,
  onDuplicate,
  onMove,
  onCurve,
  onPointerDown,
  onPointerUp,
  onPointerEnter,
  onPointerLeave,
  wallDisplay,
}: NodeActionMenuProps) {
  const t = useT()

  return (
    <div
      className="pointer-events-auto flex items-center gap-1 rounded-lg border border-border bg-background/95 p-1 shadow-xl backdrop-blur-md"
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerUp={onPointerUp}
    >
      {wallDisplay && (
        <div
          aria-label={t('actionMenu.wallDisplayMode')}
          className="mr-0.5 flex items-center rounded-md bg-muted/70 p-0.5"
          role="group"
        >
          {(
            [
              ['finish', t('actionMenu.wallDisplayFinish')],
              ['frame', t('actionMenu.wallDisplayFrame')],
              ['layers', t('actionMenu.wallDisplayLayers')],
            ] as const
          ).map(([mode, label]) => (
            <button
              aria-label={`${t('actionMenu.wallDisplayMode')}: ${label}`}
              aria-pressed={wallDisplay.mode === mode}
              className={`rounded px-2 py-1 text-[10px] transition-colors ${
                wallDisplay.mode === mode
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              key={mode}
              onClick={(event) => {
                event.stopPropagation()
                wallDisplay.onChange(mode)
              }}
              title={`${t('actionMenu.wallDisplayMode')}: ${label}`}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {onFind && (
        <button
          aria-label={t('actionMenu.findInCatalog')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onFind}
          title={t('actionMenu.findInCatalog')}
          type="button"
        >
          <Search className="h-4 w-4" />
        </button>
      )}
      {onMove && (
        <button
          aria-label={t('common.move')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onMove}
          title={t('common.move')}
          type="button"
        >
          <Move className="h-4 w-4" />
        </button>
      )}
      {onCurve && (
        <button
          aria-label={t('common.curve')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onCurve}
          title={t('common.curve')}
          type="button"
        >
          <Spline className="h-4 w-4" />
        </button>
      )}
      {onDuplicate && (
        <button
          aria-label={t('common.duplicate')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onDuplicate}
          title={t('common.duplicate')}
          type="button"
        >
          <Copy className="h-4 w-4" />
        </button>
      )}
      {onAddHole && (
        <button
          aria-label={t('actionMenu.cutOut')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onAddHole}
          title={t('actionMenu.cutOut')}
          type="button"
        >
          <Icon height={16} icon="carbon:cut-out" width={16} />
        </button>
      )}
      {onDelete && (
        <button
          aria-label={t('common.delete')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
          title={t('common.delete')}
          type="button"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

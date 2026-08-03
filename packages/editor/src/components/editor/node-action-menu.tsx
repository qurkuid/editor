'use client'

import { Icon } from '@iconify/react'
import { Copy, Move, Search, Spline, Trash2 } from 'lucide-react'
import type { MouseEventHandler, PointerEventHandler } from 'react'
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
          aria-label="Wall display mode"
          className="mr-0.5 flex items-center rounded-md bg-muted/70 p-0.5"
          role="group"
        >
          {(
            [
              ['finish', '마감'],
              ['frame', '골조'],
              ['layers', '레이어'],
            ] as const
          ).map(([mode, label]) => (
            <button
              aria-label={`Wall display: ${label}`}
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
              title={`벽 표시: ${label}`}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {onFind && (
        <button
          aria-label="Find in catalog"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onFind}
          title="Find in catalog"
          type="button"
        >
          <Search className="h-4 w-4" />
        </button>
      )}
      {onMove && (
        <button
          aria-label="Move"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onMove}
          title="Move"
          type="button"
        >
          <Move className="h-4 w-4" />
        </button>
      )}
      {onCurve && (
        <button
          aria-label="Curve"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onCurve}
          title="Curve"
          type="button"
        >
          <Spline className="h-4 w-4" />
        </button>
      )}
      {onDuplicate && (
        <button
          aria-label="Duplicate"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onDuplicate}
          title="Duplicate"
          type="button"
        >
          <Copy className="h-4 w-4" />
        </button>
      )}
      {onAddHole && (
        <button
          aria-label="Cut Out"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onAddHole}
          title="Cut Out"
          type="button"
        >
          <Icon height={16} icon="carbon:cut-out" width={16} />
        </button>
      )}
      {onDelete && (
        <button
          aria-label="Delete"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
          title="Delete"
          type="button"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}

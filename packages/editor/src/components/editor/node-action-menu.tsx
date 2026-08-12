'use client'

import { Icon } from '@iconify/react'
import {
  Box,
  BrickWall,
  Copy,
  Expand,
  GitBranch,
  Grid3X3,
  Lightbulb,
  Move,
  Replace,
  RotateCw,
  Scaling,
  Search,
  Spline,
  Trash2,
} from 'lucide-react'
import type { MouseEventHandler, PointerEventHandler } from 'react'
import { useT } from '../../i18n/use-t'
import type { WallConstructionDisplayMode } from '../../store/use-wall-construction-display'

type NodeActionMenuProps = {
  onFind?: MouseEventHandler<HTMLButtonElement>
  onReplace?: MouseEventHandler<HTMLButtonElement>
  onReplaceWall?: MouseEventHandler<HTMLButtonElement>
  onReplaceLight?: MouseEventHandler<HTMLButtonElement>
  onAddHole?: MouseEventHandler<HTMLButtonElement>
  onDelete?: MouseEventHandler<HTMLButtonElement>
  onDuplicate?: MouseEventHandler<HTMLButtonElement>
  onMove?: MouseEventHandler<HTMLButtonElement>
  onRotate?: MouseEventHandler<HTMLButtonElement>
  onScale?: MouseEventHandler<HTMLButtonElement>
  onPushPull?: MouseEventHandler<HTMLButtonElement>
  onOffset?: MouseEventHandler<HTMLButtonElement>
  onSweep?: MouseEventHandler<HTMLButtonElement>
  onArray?: MouseEventHandler<HTMLButtonElement>
  onUnion?: MouseEventHandler<HTMLButtonElement>
  onSubtract?: MouseEventHandler<HTMLButtonElement>
  onIntersect?: MouseEventHandler<HTMLButtonElement>
  onOuterShell?: MouseEventHandler<HTMLButtonElement>
  onTrim?: MouseEventHandler<HTMLButtonElement>
  onSplit?: MouseEventHandler<HTMLButtonElement>
  onGroupBodies?: MouseEventHandler<HTMLButtonElement>
  onCreateComponent?: MouseEventHandler<HTMLButtonElement>
  onMakeComponentUnique?: MouseEventHandler<HTMLButtonElement>
  onExplodeComponent?: MouseEventHandler<HTMLButtonElement>
  onEnterComponentEdit?: MouseEventHandler<HTMLButtonElement>
  onExitComponentEdit?: MouseEventHandler<HTMLButtonElement>
  onInspect?: MouseEventHandler<HTMLButtonElement>
  autofold?: boolean
  onAutofoldChange?: (enabled: boolean) => void
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
  onReplace,
  onReplaceWall,
  onReplaceLight,
  onAddHole,
  onDelete,
  onDuplicate,
  onMove,
  onRotate,
  onScale,
  onPushPull,
  onOffset,
  onSweep,
  onArray,
  onUnion,
  onSubtract,
  onIntersect,
  onOuterShell,
  onTrim,
  onSplit,
  onGroupBodies,
  onCreateComponent,
  onMakeComponentUnique,
  onExplodeComponent,
  onEnterComponentEdit,
  onExitComponentEdit,
  onInspect,
  autofold = false,
  onAutofoldChange,
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
      {onReplace && (
        <button
          aria-label={t('actionMenu.replaceWithCatalogItem')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onReplace}
          title={t('actionMenu.replaceWithCatalogItem')}
          type="button"
        >
          <Replace className="h-4 w-4" />
        </button>
      )}
      {onReplaceWall && (
        <button
          aria-label={t('actionMenu.replaceWithWall')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onReplaceWall}
          title={t('actionMenu.replaceWithWall')}
          type="button"
        >
          <BrickWall className="h-4 w-4" />
        </button>
      )}
      {onReplaceLight && (
        <button
          aria-label={t('actionMenu.replaceWithLight')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onReplaceLight}
          title={t('actionMenu.replaceWithLight')}
          type="button"
        >
          <Lightbulb className="h-4 w-4" />
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
      {onRotate && (
        <button
          aria-label={t('panel.hintRotate')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onRotate}
          title={t('panel.hintRotate')}
          type="button"
        >
          <RotateCw className="h-4 w-4" />
        </button>
      )}
      {onScale && (
        <button
          aria-label={t('panel.scale')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onScale}
          title={t('panel.scale')}
          type="button"
        >
          <Scaling className="h-4 w-4" />
        </button>
      )}
      {onPushPull && (
        <button
          aria-label={t('bodyModeling.steps.selectFacePushPull')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onPushPull}
          title={t('bodyModeling.steps.selectFacePushPull')}
          type="button"
        >
          <Box className="h-4 w-4" />
        </button>
      )}
      {onOffset && (
        <button
          aria-label={t('bodyModeling.offset')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onOffset}
          title={t('bodyModeling.offset')}
          type="button"
        >
          <Expand className="h-4 w-4" />
        </button>
      )}
      {onSweep && (
        <button
          aria-label={t('bodyModeling.followPath')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onSweep}
          title={t('bodyModeling.followPath')}
          type="button"
        >
          <Spline className="h-4 w-4" />
        </button>
      )}
      {onAutofoldChange && (
        <button
          aria-label={t('bodyModeling.autofold')}
          aria-pressed={autofold}
          className={`tooltip-trigger rounded-md p-1.5 transition-colors hover:bg-accent hover:text-foreground ${
            autofold ? 'bg-accent text-foreground' : 'text-muted-foreground'
          }`}
          onClick={() => onAutofoldChange(!autofold)}
          title={t('bodyModeling.autofold')}
          type="button"
        >
          <GitBranch className="h-4 w-4" />
        </button>
      )}
      {onArray && (
        <button
          aria-label={t('bodyModeling.array')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onArray}
          title={t('bodyModeling.array')}
          type="button"
        >
          <Grid3X3 className="h-4 w-4" />
        </button>
      )}
      {onIntersect && (
        <button
          aria-label={t('bodyModeling.intersection')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onIntersect}
          title={t('bodyModeling.intersection')}
          type="button"
        >
          <GitBranch className="h-4 w-4" />
        </button>
      )}
      {onUnion && (
        <button
          aria-label={t('bodyModeling.union')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onUnion}
          title={t('bodyModeling.union')}
          type="button"
        >
          <GitBranch className="h-4 w-4" />
        </button>
      )}
      {onSubtract && (
        <button
          aria-label={t('bodyModeling.subtract')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onSubtract}
          title={t('bodyModeling.subtract')}
          type="button"
        >
          <Box className="h-4 w-4" />
        </button>
      )}
      {onOuterShell && (
        <button
          aria-label={t('bodyModeling.outerShell')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onOuterShell}
          title={t('bodyModeling.outerShell')}
          type="button"
        >
          <Box className="h-4 w-4" />
        </button>
      )}
      {onTrim && (
        <button
          aria-label={t('bodyModeling.trim')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onTrim}
          title={t('bodyModeling.trim')}
          type="button"
        >
          <Expand className="h-4 w-4" />
        </button>
      )}
      {onSplit && (
        <button
          aria-label={t('bodyModeling.split')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onSplit}
          title={t('bodyModeling.split')}
          type="button"
        >
          <GitBranch className="h-4 w-4" />
        </button>
      )}
      {onInspect && (
        <button
          aria-label={t('bodyModeling.inspectSolid')}
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onInspect}
          title={t('bodyModeling.inspectSolid')}
          type="button"
        >
          <Search className="h-4 w-4" />
        </button>
      )}
      {onGroupBodies && (
        <button
          aria-label="Group bodies"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onGroupBodies}
          title="Group bodies"
          type="button"
        >
          <span className="text-[10px] font-medium">Group</span>
        </button>
      )}
      {onCreateComponent && (
        <button
          aria-label="Create component"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onCreateComponent}
          title="Create component"
          type="button"
        >
          <span className="text-[10px] font-medium">Component</span>
        </button>
      )}
      {onMakeComponentUnique && (
        <button
          aria-label="Make component unique"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onMakeComponentUnique}
          title="Make component unique"
          type="button"
        >
          <span className="text-[10px] font-medium">Unique</span>
        </button>
      )}
      {onExplodeComponent && (
        <button
          aria-label="Explode component"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onExplodeComponent}
          title="Explode component"
          type="button"
        >
          <span className="text-[10px] font-medium">Explode</span>
        </button>
      )}
      {onEnterComponentEdit && (
        <button
          aria-label="Edit component"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onEnterComponentEdit}
          title="Edit component"
          type="button"
        >
          <span className="text-[10px] font-medium">Edit</span>
        </button>
      )}
      {onExitComponentEdit && (
        <button
          aria-label="Exit component edit"
          className="tooltip-trigger rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          onClick={onExitComponentEdit}
          title="Exit component edit"
          type="button"
        >
          <span className="text-[10px] font-medium">Exit</span>
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

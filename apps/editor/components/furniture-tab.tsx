'use client'

import { type CabinetNode, useScene } from '@pascal-app/core'
import { FURNITURE_KIND_LABEL_KEYS, type MessageId, useEditor, useT } from '@pascal-app/editor'
import { type CabinetPlacementType, useCabinetPlacementType } from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import { Armchair } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'

// Each entry arms the cabinet tool with a placement type; the run it builds
// comes from `furniture-presets.ts`. 'cabinet' is the kitchen base run.
const FURNITURE_KINDS: readonly CabinetPlacementType[] = [
  'wardrobe',
  'cabinet',
  'upper-run',
  'tall',
  'island',
]

const KIND_LABEL_KEYS: Record<CabinetPlacementType, MessageId> = {
  wardrobe: FURNITURE_KIND_LABEL_KEYS.wardrobe,
  cabinet: FURNITURE_KIND_LABEL_KEYS['base-run'],
  'upper-run': FURNITURE_KIND_LABEL_KEYS['upper-run'],
  tall: FURNITURE_KIND_LABEL_KEYS.tall,
  island: FURNITURE_KIND_LABEL_KEYS.island,
}

const DIMENSION_LABEL_KEYS = {
  width: 'furniture.dimension.width',
  height: 'furniture.dimension.height',
  depth: 'furniture.dimension.depth',
} as const

// No photo library exists for these kinds — a small line-art silhouette per
// kind so the preset gallery visibly distinguishes them instead of shipping
// identical grey tiles.
function FurnitureKindThumb({ kind }: { kind: CabinetPlacementType }) {
  const stroke = {
    fill: 'none',
    stroke: 'currentColor',
    strokeLinecap: 'round' as const,
    strokeWidth: 1.75,
  }
  switch (kind) {
    case 'wardrobe':
      return (
        <svg viewBox="0 0 48 48">
          <rect {...stroke} height="36" rx="1.5" width="22" x="13" y="6" />
          <line {...stroke} x1="24" x2="24" y1="6" y2="42" />
          <circle cx="21" cy="24" fill="currentColor" r="1.2" stroke="none" />
          <circle cx="27" cy="24" fill="currentColor" r="1.2" stroke="none" />
        </svg>
      )
    case 'tall':
      return (
        <svg viewBox="0 0 48 48">
          <rect {...stroke} height="38" rx="1.5" width="16" x="16" y="4" />
          <circle cx="29" cy="23" fill="currentColor" r="1.2" stroke="none" />
        </svg>
      )
    case 'cabinet':
      return (
        <svg viewBox="0 0 48 48">
          <rect {...stroke} height="3" width="38" x="5" y="24" />
          <rect {...stroke} height="15" width="34" x="7" y="27" />
          <line {...stroke} x1="24" x2="24" y1="27" y2="42" />
        </svg>
      )
    case 'upper-run':
      return (
        <svg viewBox="0 0 48 48">
          <rect {...stroke} height="15" width="34" x="7" y="7" />
          <line {...stroke} x1="24" x2="24" y1="7" y2="22" />
          <line
            stroke="currentColor"
            strokeDasharray="2 2"
            strokeWidth="1.25"
            x1="7"
            x2="41"
            y1="30"
            y2="30"
          />
        </svg>
      )
    case 'island':
      return (
        <svg viewBox="0 0 48 48">
          <rect {...stroke} height="3" width="30" x="9" y="18" />
          <rect {...stroke} height="14" width="26" x="11" y="21" />
          <line {...stroke} x1="13" x2="13" y1="35" y2="39" />
          <line {...stroke} x1="35" x2="35" y1="35" y2="39" />
        </svg>
      )
    default:
      return null
  }
}

function activateFurnitureTool(type: CabinetPlacementType) {
  useCabinetPlacementType.getState().setType(type)
  const editor = useEditor.getState()
  // Furniture is drawn start-point → end-point, so the run mode has to be on;
  // the cabinet tool otherwise defaults to dropping one single cabinet.
  editor.setContinuation('cabinet', 'continuous')
  editor.setPhase('furnish')
  editor.setCatalogCategory(null)
  editor.setMode('build')
  editor.setTool('cabinet')
}

export function FurnitureTab() {
  const t = useT()
  const levelId = useViewer((state) => state.selection.levelId)
  const unit = useViewer((state) => state.unit)
  const nodes = useScene((state) => state.nodes)
  const activeTool = useEditor((state) => state.tool)
  const mode = useEditor((state) => state.mode)
  const kind = useCabinetPlacementType((s) => s.type)
  const bayCount = useCabinetPlacementType((s) => s.bayCount)
  const armed = mode === 'build' && activeTool === 'cabinet'
  // Every run this gallery places is a plain cabinet run, so listing can't key
  // off `node.furniture` any more — that field only exists on the legacy
  // assembly nodes, which still belong in the list until they're migrated.
  const furnitureNodes = useMemo(
    () =>
      Object.values(nodes).filter(
        (node): node is CabinetNode =>
          node.type === 'cabinet' && (!levelId || node.parentId === levelId),
      ),
    [levelId, nodes],
  )

  useEffect(() => {
    const editor = useEditor.getState()
    editor.setTool(null)
    editor.setMode('select')
  }, [])

  const pickPreset = (next: CabinetPlacementType) => {
    if (!levelId) return
    activateFurnitureTool(next)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3 text-sm">
      <section className="rounded-xl border border-border bg-background/40 p-3">
        <div className="mb-3 flex items-center gap-2">
          <Armchair className="h-4 w-4 text-orange-300" />
          <div>
            <h2 className="font-semibold text-xs">{t('furniture.header.title')}</h2>
            <p className="text-[10px] text-muted-foreground">{t('furniture.header.desc')}</p>
          </div>
        </div>

        {!levelId && (
          <p className="mb-3 rounded-md border border-border bg-muted/30 p-2 text-xs text-muted-foreground">
            {t('furniture.selectLevelFirst')}
          </p>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          {FURNITURE_KINDS.map((entry) => {
            const selected = armed && kind === entry
            return (
              <button
                aria-pressed={selected}
                className={cn(
                  'flex flex-col items-center gap-1 rounded-md border px-2 py-2 text-xs hover:bg-muted disabled:opacity-40',
                  selected && 'border-orange-400 bg-orange-500/10',
                )}
                disabled={!levelId}
                key={entry}
                onClick={() => pickPreset(entry)}
                type="button"
              >
                <span
                  className={cn('h-9 w-9', selected ? 'text-orange-300' : 'text-muted-foreground')}
                >
                  <FurnitureKindThumb kind={entry} />
                </span>
                {t(KIND_LABEL_KEYS[entry])}
              </button>
            )
          })}
        </div>

        <div className="mt-3 rounded-md border border-border bg-background/40 p-2">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">{t('furniture.bays.label')}</span>
            <span className="text-foreground">
              {bayCount == null ? t('furniture.bays.auto') : `${bayCount}`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              className={cn(
                'flex-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted',
                bayCount == null && 'border-orange-400 bg-orange-500/10 text-orange-200',
              )}
              onClick={() => useCabinetPlacementType.getState().setBayCount(null)}
              type="button"
            >
              {t('furniture.bays.auto')}
            </button>
            {[2, 3, 4, 5, 6].map((n) => (
              <button
                className={cn(
                  'w-7 rounded border border-border py-1 text-[11px] hover:bg-muted',
                  bayCount === n && 'border-orange-400 bg-orange-500/10 text-orange-200',
                )}
                key={n}
                onClick={() => useCabinetPlacementType.getState().setBayCount(n)}
                type="button"
              >
                {n}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">{t('furniture.bays.hint')}</p>
        </div>

        {armed && (
          <p className="mt-2 rounded-md border border-orange-400/40 bg-orange-500/10 p-2 text-[10px] text-orange-200">
            {t('furniture.armed.hint')}
          </p>
        )}
      </section>

      <section className="mt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('furniture.onThisLevel')}
        </h3>
        <div className="space-y-1.5">
          {furnitureNodes.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              {t('furniture.noneYet')}
            </p>
          ) : (
            furnitureNodes.map((node) => (
              <button
                className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left text-xs hover:bg-muted"
                key={node.id}
                onClick={() => useViewer.getState().setSelection({ selectedIds: [node.id] })}
                type="button"
              >
                <span>{node.name || t('furniture.kind.fallback')}</span>
                <span className="text-muted-foreground">
                  {t('furniture.bays.count').replace(
                    '{n}',
                    String(node.furniture?.bays.length ?? node.children.length),
                  )}
                </span>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  )
}

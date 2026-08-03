'use client'

import {
  type CabinetNode,
  FURNITURE_KIND_DEFAULT_DIMENSIONS,
  type FurnitureKind,
  useScene,
} from '@pascal-app/core'
import {
  FURNITURE_KIND_LABEL_KEYS,
  getLinearUnitLabel,
  linearControlValueToMeters,
  metersToLinearUnit,
  useEditor,
  useFurniturePlacementOptions,
  useT,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Armchair } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'

export { createFurnitureNode } from '@pascal-app/editor'

const FURNITURE_KINDS: readonly FurnitureKind[] = [
  'wardrobe',
  'base-run',
  'upper-run',
  'tall',
  'island',
  'set',
  'sink',
]

const DIMENSION_LABEL_KEYS = {
  width: 'furniture.dimension.width',
  height: 'furniture.dimension.height',
  depth: 'furniture.dimension.depth',
} as const

// No photo library exists for these kinds — a small line-art silhouette per
// kind so the preset gallery visibly distinguishes them instead of shipping
// identical grey tiles.
function FurnitureKindThumb({ kind }: { kind: FurnitureKind }) {
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
    case 'base-run':
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
    case 'set':
      return (
        <svg viewBox="0 0 48 48">
          <rect {...stroke} height="10" width="34" x="7" y="5" />
          <rect {...stroke} height="3" width="34" x="7" y="28" />
          <rect {...stroke} height="12" width="30" x="9" y="31" />
        </svg>
      )
    case 'sink':
      return (
        <svg viewBox="0 0 48 48">
          <rect {...stroke} height="3" width="38" x="5" y="24" />
          <rect {...stroke} height="15" width="34" x="7" y="27" />
          <rect {...stroke} height="4" rx="2" width="14" x="17" y="19" />
          <line {...stroke} x1="24" x2="24" y1="15" y2="19" />
        </svg>
      )
    default:
      return null
  }
}

function activateFurnitureTool() {
  const editor = useEditor.getState()
  editor.setPhase('furnish')
  editor.setCatalogCategory(null)
  editor.setMode('build')
  editor.setTool('furniture')
}

export function FurnitureTab() {
  const t = useT()
  const levelId = useViewer((state) => state.selection.levelId)
  const unit = useViewer((state) => state.unit)
  const nodes = useScene((state) => state.nodes)
  const activeTool = useEditor((state) => state.tool)
  const mode = useEditor((state) => state.mode)
  const kind = useFurniturePlacementOptions((s) => s.kind)
  const dimensions = useFurniturePlacementOptions((s) => s.dimensions)
  const bayCount = useFurniturePlacementOptions((s) => s.bayCount)
  const unitLabel = getLinearUnitLabel(unit)
  const armed = mode === 'build' && activeTool === 'furniture'
  const furnitureNodes = useMemo(
    () =>
      Object.values(nodes).filter(
        (node): node is CabinetNode =>
          node.type === 'cabinet' &&
          Boolean(node.furniture) &&
          (!levelId || node.parentId === levelId),
      ),
    [levelId, nodes],
  )

  useEffect(() => {
    const editor = useEditor.getState()
    editor.setTool(null)
    editor.setMode('select')
  }, [])

  const updateDimension = (key: keyof typeof dimensions, displayValue: number) => {
    const limits =
      key === 'width' ? { minMeters: 0.3, maxMeters: 10 } : { minMeters: 0.1, maxMeters: 4 }
    useFurniturePlacementOptions.getState().setDimensions({
      ...dimensions,
      [key]: linearControlValueToMeters(displayValue, unit, limits),
    })
  }

  const pickPreset = (nextKind: FurnitureKind) => {
    if (!levelId) return
    const options = useFurniturePlacementOptions.getState()
    options.setKind(nextKind)
    options.setDimensions(FURNITURE_KIND_DEFAULT_DIMENSIONS[nextKind])
    options.setBayCount(1)
    activateFurnitureTool()
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
                {t(FURNITURE_KIND_LABEL_KEYS[entry])}
              </button>
            )
          })}
        </div>

        {armed && (
          <p className="mt-2 rounded-md border border-orange-400/40 bg-orange-500/10 p-2 text-[10px] text-orange-200">
            {t('furniture.armed.hint')}
          </p>
        )}

        <div className="mt-3 space-y-2">
          {(['width', 'height', 'depth'] as const).map((key) => (
            <label className="flex items-center gap-2 text-xs" key={key}>
              <span className="w-14 text-muted-foreground">{t(DIMENSION_LABEL_KEYS[key])}</span>
              <input
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-right"
                min={metersToLinearUnit(key === 'width' ? 0.3 : 0.1, unit)}
                onChange={(event) => updateDimension(key, Number(event.target.value))}
                step={unit === 'imperial' ? 0.1 : 0.01}
                type="number"
                value={Number(metersToLinearUnit(dimensions[key], unit).toFixed(2))}
              />
              <span className="w-5 text-muted-foreground">{unitLabel}</span>
            </label>
          ))}
          <label className="flex items-center gap-2 text-xs">
            <span className="w-14 text-muted-foreground">{t('furniture.bays.label')}</span>
            <input
              className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-right"
              max={12}
              min={1}
              onChange={(event) =>
                useFurniturePlacementOptions
                  .getState()
                  .setBayCount(Math.max(1, Math.min(12, Number(event.target.value))))
              }
              step={1}
              type="number"
              value={bayCount}
            />
          </label>
        </div>
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
                    String(node.furniture?.bays.length ?? 0),
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

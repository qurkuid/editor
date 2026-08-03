'use client'

import {
  type AnyNode,
  type AnyNodeId,
  CabinetNode,
  createDefaultFurnitureAssembly,
  type FurnitureKind,
  useScene,
} from '@pascal-app/core'
import {
  getLinearUnitLabel,
  linearControlValueToMeters,
  type MessageId,
  metersToLinearUnit,
  translate,
  useEditor,
  useLocale,
  useT,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Armchair, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

const FURNITURE_KINDS: readonly FurnitureKind[] = [
  'wardrobe',
  'base-run',
  'upper-run',
  'tall',
  'island',
  'set',
  'sink',
]

const FURNITURE_KIND_LABEL_KEYS: Record<FurnitureKind, MessageId> = {
  wardrobe: 'furniture.kind.wardrobe',
  'base-run': 'furniture.kind.baseRun',
  'upper-run': 'furniture.kind.upperRun',
  tall: 'furniture.kind.tall',
  island: 'furniture.kind.island',
  set: 'furniture.kind.set',
  sink: 'furniture.kind.sink',
}

const DIMENSION_LABEL_KEYS = {
  width: 'furniture.dimension.width',
  height: 'furniture.dimension.height',
  depth: 'furniture.dimension.depth',
} as const satisfies Record<string, MessageId>

export function createFurnitureNode(options: {
  kind: FurnitureKind
  dimensions: { width: number; height: number; depth: number }
  bayCount: number
  parentId: AnyNodeId
}) {
  const furniture = createDefaultFurnitureAssembly({
    furnitureKind: options.kind,
    dimensions: options.dimensions,
    bayCount: options.bayCount,
  })
  const label = translate(FURNITURE_KIND_LABEL_KEYS[options.kind], useLocale.getState().locale)
  return CabinetNode.parse({
    name: label,
    parentId: options.parentId,
    position: [0, 0, 0],
    width: furniture.dimensions.width,
    depth: furniture.dimensions.depth,
    carcassHeight: furniture.dimensions.height,
    showPlinth: false,
    withCountertop: false,
    furniture,
  })
}

export function FurnitureTab() {
  const t = useT()
  const levelId = useViewer((state) => state.selection.levelId)
  const unit = useViewer((state) => state.unit)
  const nodes = useScene((state) => state.nodes)
  const [kind, setKind] = useState<FurnitureKind>('wardrobe')
  const [dimensions, setDimensions] = useState({ width: 2.4, height: 2.4, depth: 0.6 })
  const [bayCount, setBayCount] = useState(2)
  const unitLabel = getLinearUnitLabel(unit)
  const furnitureNodes = useMemo(
    () =>
      Object.values(nodes).filter(
        (node): node is ReturnType<typeof CabinetNode.parse> =>
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
    setDimensions((current) => ({
      ...current,
      [key]: linearControlValueToMeters(displayValue, unit, limits),
    }))
  }

  const addFurniture = () => {
    if (!levelId) return
    const node = createFurnitureNode({ kind, dimensions, bayCount, parentId: levelId as AnyNodeId })
    useScene.getState().createNode(node as AnyNode, levelId as AnyNodeId)
    useViewer.getState().setSelection({ selectedIds: [node.id] })
    useEditor.getState().setMode('select')
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
          {FURNITURE_KINDS.map((entry) => (
            <button
              aria-pressed={kind === entry}
              className={cn(
                'rounded-md border px-2 py-2 text-xs hover:bg-muted',
                kind === entry && 'border-orange-400 bg-orange-500/10',
              )}
              key={entry}
              onClick={() => setKind(entry)}
              type="button"
            >
              {t(FURNITURE_KIND_LABEL_KEYS[entry])}
            </button>
          ))}
        </div>

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
                setBayCount(Math.max(1, Math.min(12, Number(event.target.value))))
              }
              step={1}
              type="number"
              value={bayCount}
            />
          </label>
        </div>

        <button
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-orange-500 px-3 py-2 font-medium text-black text-xs disabled:opacity-40"
          disabled={!levelId}
          onClick={addFurniture}
          type="button"
        >
          <Plus className="h-4 w-4" /> {t('furniture.addAtLevelOrigin')}
        </button>
        <p className="mt-2 text-[10px] text-muted-foreground">{t('furniture.addDesc')}</p>
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

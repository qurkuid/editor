'use client'

import { type MessageId, useT } from '@pascal-app/editor'
import {
  type BodyPrimitive,
  MAX_ARC_SEGMENTS,
  MAX_POLYGON_SIDES,
  MIN_ARC_SEGMENTS,
  MIN_POLYGON_SIDES,
  useBodyToolOptions,
} from '@pascal-app/nodes'
import { Circle, Hexagon, Minus, MousePointer2, Move3d, Spline, Square } from 'lucide-react'
import { cn } from '@/lib/utils'

const PRIMITIVES: ReadonlyArray<{
  id: BodyPrimitive
  labelKey: MessageId
  icon: typeof Minus
}> = [
  { id: 'line', labelKey: 'bodyModeling.primitive.line', icon: Minus },
  { id: 'rectangle', labelKey: 'bodyModeling.primitive.rectangle', icon: Square },
  { id: 'circle', labelKey: 'bodyModeling.primitive.circle', icon: Circle },
  { id: 'arc', labelKey: 'bodyModeling.primitive.arc', icon: Spline },
  { id: 'polygon', labelKey: 'bodyModeling.primitive.polygon', icon: Hexagon },
]

export function selectBodyPrimitive(
  primitive: BodyPrimitive,
  actions: {
    setPrimitive: (primitive: BodyPrimitive) => void
    activateBodyTool: () => void
    setFaceDraft?: (draft: null) => void
  },
) {
  actions.setFaceDraft?.(null)
  actions.setPrimitive(primitive)
  actions.activateBodyTool()
}

export function ArcSegmentsControl({ compact = false }: { compact?: boolean }) {
  const t = useT()
  const arcSegments = useBodyToolOptions((state) => state.arcSegments)
  const setArcSegments = useBodyToolOptions((state) => state.setArcSegments)
  const label = t('bodyModeling.arcSegments')
  return (
    <label
      className={cn(
        'flex items-center gap-2 text-[10px] text-muted-foreground',
        compact ? 'px-1' : 'mx-3 mt-3 border-border/60 border-t pt-2.5',
      )}
    >
      <span className="shrink-0">{label}</span>
      <input
        aria-label={label}
        className="h-7 min-w-0 w-16 rounded border border-border/60 bg-background/70 px-1.5 text-right text-foreground"
        max={MAX_ARC_SEGMENTS}
        min={MIN_ARC_SEGMENTS}
        onChange={(event) => setArcSegments(event.currentTarget.valueAsNumber)}
        step={1}
        type="number"
        value={arcSegments}
      />
    </label>
  )
}

export function PolygonSidesControl({ compact = false }: { compact?: boolean }) {
  const t = useT()
  const polygonSides = useBodyToolOptions((state) => state.polygonSides)
  const setPolygonSides = useBodyToolOptions((state) => state.setPolygonSides)
  const label = t('bodyModeling.polygonSides')
  return (
    <label
      className={cn(
        'flex items-center gap-2 text-[10px] text-muted-foreground',
        compact ? 'px-1' : 'mx-3 mt-2',
      )}
    >
      <span className="shrink-0">{label}</span>
      <input
        aria-label={label}
        className="h-7 min-w-0 w-16 rounded border border-border/60 bg-background/70 px-1.5 text-right text-foreground"
        max={MAX_POLYGON_SIDES}
        min={MIN_POLYGON_SIDES}
        onChange={(event) => setPolygonSides(event.currentTarget.valueAsNumber)}
        step={1}
        type="number"
        value={polygonSides}
      />
    </label>
  )
}

export function BodyModelingTools({
  active = false,
  onActivate = () => {},
}: {
  active?: boolean
  onActivate?: () => void
}) {
  const t = useT()
  const primitive = useBodyToolOptions((state) => state.primitive)
  const setPrimitive = useBodyToolOptions((state) => state.setPrimitive)
  const setFaceDraft = useBodyToolOptions((state) => state.setFaceDraft)

  return (
    <section className="overflow-hidden rounded-xl border border-sky-400/20 bg-sky-400/5">
      <div className="mb-2 flex items-center justify-between">
        <div className="px-3 pt-3">
          <h3 className="font-semibold text-xs">{t('bodyModeling.title')}</h3>
          <p className="mt-0.5 text-[10px] text-muted-foreground">{t('bodyModeling.desc')}</p>
        </div>
        <span className="mr-3 mt-3 rounded-full bg-sky-400/10 px-2 py-1 text-[9px] text-sky-300">
          {t('bodyModeling.badge')}
        </span>
      </div>
      <div className="grid grid-cols-5 gap-1.5 px-3">
        {PRIMITIVES.map(({ id, labelKey, icon: Icon }) => {
          const selected = active && primitive === id
          const label = t(labelKey)
          return (
            <button
              aria-label={t('bodyModeling.primitive.startAriaLabel').replace('{label}', label)}
              aria-pressed={selected}
              className={cn(
                'flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border text-[10px] transition-colors',
                selected
                  ? 'border-primary/50 bg-primary/10 text-foreground'
                  : 'border-border/50 bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
              key={id}
              onClick={() =>
                selectBodyPrimitive(id, {
                  activateBodyTool: onActivate,
                  setFaceDraft,
                  setPrimitive,
                })
              }
              type="button"
            >
              <Icon aria-hidden className="h-4 w-4" />
              {label}
            </button>
          )
        })}
      </div>
      <ArcSegmentsControl />
      <PolygonSidesControl />
      <ol className="mt-3 grid gap-1 border-border/60 border-t bg-background/25 px-3 py-2.5 text-[10px] text-muted-foreground">
        <li className="flex items-center gap-2">
          <Square className="h-3 w-3 text-sky-300" />
          <span>1. {t('bodyModeling.steps.selectShape')}</span>
        </li>
        <li className="flex items-center gap-2">
          <MousePointer2 className="h-3 w-3 text-sky-300" />
          <span>2. {t('bodyModeling.steps.drawInViewport')}</span>
        </li>
        <li className="flex items-center gap-2">
          <Move3d className="h-3 w-3 text-sky-300" />
          <span>3. {t('bodyModeling.steps.selectFacePushPull')}</span>
        </li>
      </ol>
    </section>
  )
}

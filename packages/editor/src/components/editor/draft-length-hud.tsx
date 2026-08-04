'use client'

import { useViewer } from '@pascal-app/viewer'
import { Check, MousePointer2, MoveRight, Ruler, TriangleAlert } from 'lucide-react'
import { useT } from '../../i18n/use-t'
import { resolveDraftLengthPresentation } from '../../lib/draft-length-input'
import { useDraftLengthHud } from '../../store/use-draft-length-hud'
import { ShortcutToken } from '../ui/primitives/shortcut-token'

export function DraftLengthHud() {
  const t = useT()
  const raw = useDraftLengthHud((state) => state.raw)
  const unit = useViewer((state) => state.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const presentation = resolveDraftLengthPresentation(raw, unit, metricNotation)
  if (presentation.kind === 'empty') return null

  const isValid = presentation.kind === 'valid'

  return (
    <div
      aria-live="polite"
      className="pointer-events-none absolute inset-x-0 bottom-[5.5rem] z-40 flex justify-center px-3 sm:bottom-[6.5rem]"
      data-draft-length-hud
      role="status"
    >
      <div
        className={`flex max-w-full items-stretch overflow-hidden rounded-xl border bg-background/95 shadow-2xl backdrop-blur-md ${
          isValid ? 'border-emerald-500/35' : 'border-destructive/50'
        }`}
      >
        <div className={`w-1 shrink-0 ${isValid ? 'bg-emerald-400' : 'bg-destructive'}`} />
        <div className="flex min-w-[172px] items-center gap-3 px-3 py-2">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              isValid ? 'bg-emerald-500/15 text-emerald-400' : 'bg-destructive/15 text-destructive'
            }`}
          >
            <Ruler aria-hidden="true" className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[10px] text-muted-foreground uppercase tracking-[0.14em]">
              Precise length
            </div>
            <div className="flex items-center gap-2">
              <span className="truncate font-semibold font-mono text-sm tabular-nums">
                {presentation.display}
              </span>
              {isValid ? (
                <Check aria-label={t('chrome.validLength')} className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <TriangleAlert
                  aria-label={t('chrome.invalidLength')}
                  className="h-3.5 w-3.5 text-destructive"
                />
              )}
            </div>
          </div>
        </div>
        <div className="hidden items-center gap-4 border-border/60 border-l px-3 text-[11px] text-muted-foreground sm:flex">
          <span className="flex items-center gap-1.5">
            <MoveRight aria-hidden="true" className="h-3.5 w-3.5" />
            Aim direction
          </span>
          <span className="flex items-center gap-1.5">
            <MousePointer2 aria-hidden="true" className="h-3.5 w-3.5" />
            Click to place
          </span>
          <span className="flex items-center gap-1.5">
            <ShortcutToken className="h-5 px-1.5 text-[10px]" value="Esc" />
            Clear
          </span>
        </div>
      </div>
    </div>
  )
}

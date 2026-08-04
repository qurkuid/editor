'use client'

import { MaterialPaintPanel, useEditor, useT } from '@pascal-app/editor'
import { useEffect, useState } from 'react'
import { RawPainterCatalog } from './rawpainter-catalog'

type CatalogView = 'rawpainter' | 'library'

export function PaintingTab() {
  const t = useT()
  const paintScope = useEditor((state) => state.paintScope)
  const setPaintScope = useEditor((state) => state.setPaintScope)
  const [catalogView, setCatalogView] = useState<CatalogView>('rawpainter')

  useEffect(() => {
    const editor = useEditor.getState()
    editor.setPhase('structure')
    editor.setStructureLayer('elements')
    editor.setMode('material-paint')
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mx-3 mt-3 mb-2 rounded-xl border border-border/70 bg-background/35 p-2.5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-semibold text-xs">{t('painting.scope.heading')}</span>
          <span className="text-[9px] text-muted-foreground">{t('painting.scope.shiftHint')}</span>
        </div>
        <div
          aria-label={t('painting.scope.ariaLabel')}
          className="grid grid-cols-2 gap-1"
          role="group"
        >
          <button
            aria-pressed={paintScope === 'single'}
            className={`rounded-lg px-2 py-1.5 text-xs ${paintScope === 'single' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            onClick={() => setPaintScope('single')}
            type="button"
          >
            {t('painting.scope.single')}
          </button>
          <button
            aria-pressed={paintScope === 'object'}
            className={`rounded-lg px-2 py-1.5 text-xs ${paintScope === 'object' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
            onClick={() => setPaintScope('object')}
            type="button"
          >
            {t('painting.scope.object')}
          </button>
        </div>
      </div>
      <div className="flex shrink-0 gap-1 px-3 pb-2">
        <button
          className={`flex-1 rounded-lg px-2 py-1.5 font-semibold text-xs ${catalogView === 'rawpainter' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}
          onClick={() => setCatalogView('rawpainter')}
          type="button"
        >
          {t('painting.catalog.rawpainter')}
        </button>
        <button
          className={`flex-1 rounded-lg px-2 py-1.5 font-semibold text-xs ${catalogView === 'library' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}
          onClick={() => setCatalogView('library')}
          type="button"
        >
          {t('painting.catalog.library')}
        </button>
      </div>
      <div className="min-h-0 flex-1 px-3 pb-3">
        {catalogView === 'rawpainter' ? (
          <RawPainterCatalog onApplied={() => setCatalogView('library')} />
        ) : (
          <MaterialPaintPanel />
        )}
      </div>
    </div>
  )
}

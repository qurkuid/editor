'use client'

import type { AnyNodeId } from '@pascal-app/core'
import {
  buildResetSurfaceMaterialUpdates,
  resolvePaintTargetFromSelection,
  useEditor,
  useScene,
  useT,
  useViewer,
} from '@pascal-app/editor'
import { Eraser, House, RotateCcw, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FavoriteMaterialsGrid, MergedMaterialCatalog } from './paint-catalog'

type CatalogView = 'materials' | 'favorites' | 'scene'

export function PaintingTab() {
  const t = useT()
  const paintScope = useEditor((state) => state.paintScope)
  const setPaintScope = useEditor((state) => state.setPaintScope)
  const paintEraser = useEditor((state) => state.paintEraser)
  const setPaintEraser = useEditor((state) => state.setPaintEraser)
  const setActivePaintTarget = useEditor((state) => state.setActivePaintTarget)
  const [catalogView, setCatalogView] = useState<CatalogView>('materials')

  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const nodes = useScene((state) => state.nodes)
  const selectedId = selectedIds.length === 1 ? (selectedIds[0] ?? null) : null
  const selectedNode = selectedId ? nodes[selectedId as AnyNodeId] : null
  const canResetSelection =
    selectedNode != null && resolvePaintTargetFromSelection({ nodes, selectedId }) != null

  useEffect(() => {
    const editor = useEditor.getState()
    editor.setPhase('structure')
    editor.setStructureLayer('elements')
    editor.setMode('material-paint')
  }, [])

  // Keep the brush target in step with the selection (mirrors MaterialPaintPanel).
  useEffect(() => {
    const selectedPaintTarget = resolvePaintTargetFromSelection({ nodes, selectedId })
    if (selectedPaintTarget) {
      setActivePaintTarget(selectedPaintTarget)
    }
  }, [nodes, selectedId, setActivePaintTarget])

  const resetSelection = () => {
    if (!selectedNode) return
    useScene.getState().updateNodes(buildResetSurfaceMaterialUpdates(nodes, selectedNode))
  }

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
          aria-pressed={paintEraser}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 font-semibold text-xs ${paintEraser ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
          onClick={() => setPaintEraser(!paintEraser)}
          type="button"
        >
          <Eraser className="h-3.5 w-3.5" />
          {t('painting.erase')}
        </button>
        <button
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-muted px-2 py-1.5 font-semibold text-muted-foreground text-xs disabled:opacity-40"
          disabled={!canResetSelection}
          onClick={resetSelection}
          type="button"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t('painting.resetAll')}
        </button>
      </div>
      <div className="flex shrink-0 gap-1 px-3 pb-2">
        <button
          className={`flex-1 rounded-lg px-2 py-1.5 font-semibold text-xs ${catalogView === 'materials' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}
          onClick={() => setCatalogView('materials')}
          type="button"
        >
          {t('painting.catalog.materials')}
        </button>
        <button
          className={`flex flex-1 items-center justify-center gap-1 rounded-lg px-2 py-1.5 font-semibold text-xs ${catalogView === 'favorites' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}
          onClick={() => setCatalogView('favorites')}
          type="button"
        >
          <Star className={`h-3 w-3 ${catalogView === 'favorites' ? 'fill-current' : ''}`} />
          {t('painting.catalog.favorites')}
        </button>
        <button
          aria-label={t('painting.section.myMaterials')}
          aria-pressed={catalogView === 'scene'}
          className={`flex w-8 items-center justify-center rounded-lg ${catalogView === 'scene' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'}`}
          onClick={() => setCatalogView('scene')}
          title={t('painting.section.myMaterials')}
          type="button"
        >
          <House className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 px-3 pb-3">
        {catalogView === 'materials' ? (
          <MergedMaterialCatalog />
        ) : catalogView === 'favorites' ? (
          <FavoriteMaterialsGrid />
        ) : (
          <MergedMaterialCatalog sceneOnly />
        )}
      </div>
    </div>
  )
}

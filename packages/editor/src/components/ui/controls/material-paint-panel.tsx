'use client'

import {
  type AnyNodeId,
  generateSceneMaterialId,
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getSceneMaterialIdFromRef,
  type SceneMaterialId,
  type SceneMaterial,
  toLibraryMaterialRef,
  toSceneMaterialRef,
  useScene,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { Eraser, Plus, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  type ActivePaintMaterial,
  buildResetSurfaceMaterialUpdates,
  resolvePaintTargetFromSelection,
} from './../../../lib/material-paint'
import { freezeHostMaterialCatalogItem } from './../../../lib/host-integration'
import useEditor from './../../../store/use-editor'
import { Button } from '../primitives/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '../primitives/tooltip'
import { MaterialPicker } from './material-picker'
import { SceneMaterialList } from './scene-material-list'
import { useT } from '../../../i18n/use-t'

/**
 * Material picker for paint mode. Embedders render this wherever paint controls
 * belong (the community editor places it in the Build sidebar while paint mode
 * is active). It fills its container's height and lays out as three bands: a
 * fixed control/category header, a single scrolling catalog grid, and a fixed
 * scene-material footer (always visible, with a `+` to add a custom material).
 */
export type MaterialPaintPanelProps = {
  /** When provided, the catalog grid leads with a "New material" tile that invokes it. */
  onCreateMaterialRequest?: () => void
}

export function resolveCurrentBrush(
  activePaintMaterial: ActivePaintMaterial | null,
  materials: Record<string, SceneMaterial>,
) {
  const activeSceneMaterialId = getSceneMaterialIdFromRef(activePaintMaterial?.materialPreset)
  const activeSceneMaterial = activeSceneMaterialId ? materials[activeSceneMaterialId] : undefined
  const activeCatalogId =
    getLibraryMaterialIdFromRef(activePaintMaterial?.materialPreset) ?? activePaintMaterial?.material?.id
  const activeCatalogMaterial = getCatalogMaterialById(activeCatalogId)

  return {
    name:
      activeSceneMaterial?.name ??
      activeCatalogMaterial?.label ??
      activePaintMaterial?.material?.id ??
      null,
    color:
      activeSceneMaterial?.material.properties?.color ??
      activePaintMaterial?.material?.properties?.color ??
      activeCatalogMaterial?.previewColor ??
      activeCatalogMaterial?.preset.mapProperties.color ??
      '#ffffff',
  }
}

export function MaterialPaintPanel({ onCreateMaterialRequest }: MaterialPaintPanelProps) {
  const t = useT()
  const activePaintMaterial = useEditor((state) => state.activePaintMaterial)
  const activePaintTarget = useEditor((state) => state.activePaintTarget)
  const setActivePaintMaterial = useEditor((state) => state.setActivePaintMaterial)
  const setActivePaintTarget = useEditor((state) => state.setActivePaintTarget)
  const paintEraser = useEditor((state) => state.paintEraser)
  const setPaintEraser = useEditor((state) => state.setPaintEraser)
  // Id of a just-created scene material whose inline editor should open on mount.
  const [autoEditMaterialId, setAutoEditMaterialId] = useState<SceneMaterialId | null>(null)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const nodes = useScene((state) => state.nodes)
  const materials = useScene((state) => state.materials)
  const materialCount = Object.keys(materials).length
  const selectedId = selectedIds.length === 1 ? (selectedIds[0] ?? null) : null
  const selectedNode = selectedId ? nodes[selectedId as AnyNodeId] : null
  const canResetSelection =
    selectedNode != null && resolvePaintTargetFromSelection({ nodes, selectedId }) != null
  const currentBrush = resolveCurrentBrush(activePaintMaterial, materials)

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

  // Create a blank custom scene material, select it as the brush (`scene:` ref so
  // edits propagate), and open its inline editor. Available from any category.
  const createCustomMaterial = () => {
    const id = generateSceneMaterialId()
    const count = Object.keys(useScene.getState().materials).length
    useScene.getState().addSceneMaterial({
      id,
      name: `Material ${count + 1}`,
      material: {
        preset: 'custom',
        properties: {
          color: '#ffffff',
          roughness: 0.5,
          metalness: 0,
          opacity: 1,
          transparent: false,
          side: 'front',
        },
      },
    })
    setActivePaintMaterial({ materialPreset: toSceneMaterialRef(id), sourceTarget: activePaintTarget })
    setAutoEditMaterialId(id)
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      {/* Fixed: eraser / reset. */}
      <div className="flex shrink-0 items-center gap-2 pb-2">
        <Button
          aria-pressed={paintEraser}
          className="flex-1"
          onClick={() => setPaintEraser(!paintEraser)}
          size="sm"
          variant={paintEraser ? 'default' : 'outline'}
        >
          <Eraser />
          Erase
        </Button>
        <Button
          className="flex-1"
          disabled={!canResetSelection}
          onClick={resetSelection}
          size="sm"
          variant="outline"
        >
          <RotateCcw />
          Reset all
        </Button>
      </div>

      <div className="mb-2 flex shrink-0 items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-2">
        <span
          className="h-8 w-8 shrink-0 rounded-md border border-border/70"
          style={{ backgroundColor: currentBrush.color }}
        />
        <div className="min-w-0">
          <p className="font-medium text-[10px] text-primary uppercase tracking-[0.12em]">
            Current brush
          </p>
          <p className="truncate font-medium text-sm">
            {currentBrush.name ?? 'Select a material below'}
          </p>
        </div>
      </div>

      {/* Scrolls: category tabs (fixed inside) + catalog grid (the scroll). */}
      <div className="min-h-0 flex-1">
        <MaterialPicker
          onCreateMaterialRequest={onCreateMaterialRequest}
          onSelectMaterialPreset={(materialPreset) => {
            const catalogId = getLibraryMaterialIdFromRef(materialPreset)
            const catalogItem = getCatalogMaterialById(catalogId ?? undefined)
            setActivePaintMaterial(
              catalogItem?.sourceRef
                ? {
                    material: freezeHostMaterialCatalogItem(catalogItem),
                    sourceTarget: activePaintTarget,
                  }
                : { materialPreset, sourceTarget: activePaintTarget },
            )
          }}
          selectedMaterialPreset={
            activePaintMaterial?.materialPreset ??
            (activePaintMaterial?.material?.id
              ? toLibraryMaterialRef(activePaintMaterial.material.id)
              : undefined)
          }
        />
      </div>

      {/* Fixed footer: scene materials, always visible, with a `+` to add one. */}
      <div className="mt-2 shrink-0 space-y-1.5 border-border/60 border-t pt-2">
        <div className="flex items-center justify-between">
          <span className="font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
            Scene materials
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('panel.addMaterial')}
                onClick={createCustomMaterial}
                size="icon-sm"
                type="button"
                variant="outline"
              >
                <Plus />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('panel.addMaterial')}</TooltipContent>
          </Tooltip>
        </div>
        <div className="subtle-scrollbar max-h-56 overflow-y-auto">
          {materialCount > 0 ? (
            <SceneMaterialList autoEditId={autoEditMaterialId} />
          ) : (
            <p className="px-0.5 py-1 text-muted-foreground text-xs">
              No custom materials yet — add one with +.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

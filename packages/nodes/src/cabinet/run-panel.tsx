'use client'

import type {
  AnyNodeId,
  CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode as CabinetNodeType,
  SceneMaterial,
} from '@pascal-app/core'
import {
  createSceneApi,
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getSceneMaterialIdFromRef,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  ToggleControl,
  useEditor,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Plus, Trash } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import {
  COUNTERTOP_CUTOUT_KINDS,
  type CountertopCutout,
  type CountertopCutoutKind,
  newCountertopCutout,
  patchCountertopCutout,
} from './countertop-cutouts'
import { divideRunIntoBays, resizeRunToWidth, runSpanWidth, sortRunModules } from './run-layout'
import {
  addCabinetModuleSide,
  backAlignZ,
  bumpCabinetRunLayoutRevision,
  cabinetMetadataRecord,
  cornerLinkedSourceModuleForRun,
  runModuleBaseY,
  syncCornerRunsFromSourceModule,
  syncCornerStyleGroupFromRun,
  syncSetLinkWallRun,
  wallChildOf,
} from './run-ops'
import {
  backAnchoredModuleZ,
  minCabinetCarcassHeightForStack,
  reflowCabinetRunModules,
  stackForCabinet,
} from './stack'

export type CabinetEditableNode = CabinetNodeType | CabinetModuleNodeType
const RUN_POSITION_PATCH_KEYS = new Set<keyof CabinetNodeType>(['showPlinth', 'plinthHeight'])
const RUN_MODULE_SYNC_PATCH_KEYS = new Set<keyof CabinetNodeType>([
  'frontStyle',
  'frontOverlay',
  'handleStyle',
  'handlePosition',
])
const RUN_DEPTH_PATCH_KEY = 'depth'
const PRESET_WIDTH_DEBT_KEY = 'cabinetPresetWidthDebtBySource'

const FRONT_STYLE_OPTIONS = [
  { value: 'slab', label: 'Slab' },
  { value: 'shaker', label: 'Shaker' },
  { value: 'raised-arch', label: 'Raised Arch' },
] as const

const FRONT_OVERLAY_OPTIONS = [
  { value: 'full', label: 'Overlay' },
  { value: 'inset', label: 'Inset' },
] as const

const HANDLE_STYLE_OPTIONS = [
  { value: 'bar', label: 'Bar' },
  { value: 'knob', label: 'Knob' },
  { value: 'cutout', label: 'Cutout' },
  { value: 'hole', label: 'Hole' },
  { value: 'none', label: 'None' },
] as const

const HANDLE_POSITION_OPTIONS = [
  { value: 'auto', label: 'Auto' },
  { value: 'top', label: 'Top' },
  { value: 'center', label: 'Center' },
] as const

function moduleSummary(module: CabinetModuleNodeType) {
  if ((module.cabinetType ?? 'base') === 'tall') return 'Tall cabinet'
  const stack = stackForCabinet(module)
  if (stack.length === 0) return 'Empty'
  if (stack.length === 1) return stack[0]!.type
  return `${stack.length} compartments`
}

// Mirrors `resolveCurrentBrush` in material-paint-panel.tsx — same ref shape
// (`node.slots.countertop`), same fallback chain to a display name/color.
function countertopMaterialSwatch(
  node: CabinetNodeType,
  materials: Record<string, SceneMaterial>,
): { name: string; color: string } {
  const ref = node.slots?.countertop
  const sceneMaterialId = getSceneMaterialIdFromRef(ref)
  const sceneMaterial = sceneMaterialId ? materials[sceneMaterialId] : undefined
  const catalogMaterial = getCatalogMaterialById(getLibraryMaterialIdFromRef(ref) ?? undefined)
  return {
    name: sceneMaterial?.name ?? catalogMaterial?.label ?? 'Default',
    color:
      sceneMaterial?.material.properties?.color ??
      catalogMaterial?.previewColor ??
      catalogMaterial?.preset.mapProperties.color ??
      '#ffffff',
  }
}

const COUNTERTOP_CUTOUT_KIND_OPTIONS = COUNTERTOP_CUTOUT_KINDS.map((kind) => ({
  value: kind,
  label: kind[0]!.toUpperCase() + kind.slice(1),
}))

function cutoutLabel(cutout: CountertopCutout): { primary: string; secondary: string } {
  return {
    primary: cutout.kind[0]!.toUpperCase() + cutout.kind.slice(1),
    secondary: cutout.shape === 'circle' ? 'Circle' : 'Rectangle',
  }
}

export function bumpRunLayoutRevisionViaStore(
  scene: ReturnType<typeof useScene.getState>,
  run: CabinetNodeType,
) {
  bumpCabinetRunLayoutRevision(createSceneApi(useScene), run)
  scene.markDirty(run.id as AnyNodeId)
}

function presetWidthDebt(
  module: CabinetModuleNodeType,
  sourceId: CabinetModuleNodeType['id'],
): number {
  const value = cabinetMetadataRecord(module.metadata)[PRESET_WIDTH_DEBT_KEY]
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
  const debt = (value as Record<string, unknown>)[sourceId]
  return typeof debt === 'number' && debt > 0 ? debt : 0
}

function metadataWithPresetWidthDebt(
  module: CabinetModuleNodeType,
  sourceId: CabinetModuleNodeType['id'],
  widthDelta: number,
): CabinetModuleNodeType['metadata'] {
  const metadata = cabinetMetadataRecord(module.metadata)
  const value = metadata[PRESET_WIDTH_DEBT_KEY]
  const debts =
    value && typeof value === 'object' && !Array.isArray(value)
      ? { ...(value as Record<string, unknown>) }
      : {}
  const nextDebt = Math.max(0, presetWidthDebt(module, sourceId) - widthDelta)
  if (nextDebt > 1e-4) debts[sourceId] = nextDebt
  else delete debts[sourceId]

  if (Object.keys(debts).length > 0) {
    return { ...metadata, [PRESET_WIDTH_DEBT_KEY]: debts } as CabinetModuleNodeType['metadata']
  }
  const { [PRESET_WIDTH_DEBT_KEY]: _removed, ...rest } = metadata
  return rest as CabinetModuleNodeType['metadata']
}

export function reflowRunModules({
  modules,
  parentRun,
  patch,
  preserveExtent = false,
  scene,
  selected,
}: {
  modules: CabinetModuleNodeType[]
  parentRun: CabinetNodeType
  patch: Partial<CabinetModuleNodeType>
  preserveExtent?: boolean
  scene: ReturnType<typeof useScene.getState>
  selected: CabinetModuleNodeType
}) {
  const reflowed = reflowCabinetRunModules(modules, selected.id, patch.width ?? selected.width, {
    preserveExtent,
    restorableWidthById: new Map(
      modules.map((module) => [module.id, presetWidthDebt(module, selected.id)]),
    ),
  })
  if (reflowed.length === 0) return

  const reflowById = new Map(reflowed.map((entry) => [entry.id, entry]))
  for (const module of [...modules].sort((a, b) => a.position[0] - b.position[0])) {
    const reflow = reflowById.get(module.id)
    if (!reflow) continue
    const isSelected = module.id === selected.id
    const nextPatch: Partial<CabinetModuleNodeType> = isSelected
      ? { ...patch, width: reflow.width }
      : { width: reflow.width }
    const widthDelta = reflow.width - module.width
    if (!isSelected && preserveExtent && Math.abs(widthDelta) > 1e-4) {
      nextPatch.metadata = metadataWithPresetWidthDebt(module, selected.id, widthDelta)
    }
    const nextPosition: CabinetModuleNodeType['position'] = [
      reflow.position[0],
      isSelected && patch.position ? patch.position[1] : reflow.position[1],
      isSelected && typeof patch.depth === 'number'
        ? backAnchoredModuleZ(module.position[2], module.depth, patch.depth)
        : reflow.position[2],
    ]

    if (isSelected) {
      const cabinetType = patch.cabinetType ?? module.cabinetType
      if (cabinetType === 'base') {
        nextPatch.depth = patch.depth ?? parentRun.depth
        nextPatch.carcassHeight = patch.carcassHeight ?? parentRun.carcassHeight
        nextPatch.plinthHeight = patch.plinthHeight ?? parentRun.plinthHeight
        nextPatch.toeKickDepth = patch.toeKickDepth ?? parentRun.toeKickDepth
        nextPatch.countertopThickness = patch.countertopThickness ?? 0
        nextPatch.countertopOverhang = patch.countertopOverhang ?? parentRun.countertopOverhang
      }
    }

    nextPatch.position = nextPosition
    scene.updateNode(module.id as AnyNodeId, nextPatch)

    const wallChild = wallChildOf(
      module,
      scene.nodes as Record<string, CabinetEditableNode | undefined>,
    )
    if (wallChild) {
      scene.updateNode(wallChild.id as AnyNodeId, {
        position: [
          0,
          wallChild.position[1],
          backAlignZ(nextPatch.depth ?? module.depth, wallChild.depth),
        ],
        width: reflow.width,
      })
      scene.markDirty(module.id as AnyNodeId)
    }
  }

  bumpRunLayoutRevisionViaStore(scene, parentRun)
}

export function CabinetRunPanel({
  node,
  modules,
  onClose,
}: {
  node: CabinetNodeType
  modules: CabinetModuleNodeType[]
  onClose: () => void
}) {
  const setSelection = useViewer((s) => s.setSelection)
  const sortedModules = useMemo(
    () => [...modules].sort((a, b) => a.position[0] - b.position[0]),
    [modules],
  )
  // An upper/lower set's wall run never carries a countertop — its slab,
  // seating overhang, and waterfall controls are geometrically inert.
  const isWallSetRun = node.runTier === 'wall' && Boolean(node.setLink)

  const updateRun = useCallback(
    (patch: Partial<CabinetNodeType>) => {
      const scene = useScene.getState()
      const sceneApi = createSceneApi(useScene)
      const nextPatch = { ...patch }
      if (typeof nextPatch.carcassHeight === 'number') {
        const minModuleHeight = Math.max(
          0.4,
          ...modules.map((module) => minCabinetCarcassHeightForStack(module)),
        )
        nextPatch.carcassHeight = Math.max(nextPatch.carcassHeight, minModuleHeight)
      }
      const nextNode = { ...node, ...nextPatch }
      scene.updateNode(node.id, nextPatch)

      const shouldSyncDepth = RUN_DEPTH_PATCH_KEY in nextPatch
      const shouldSyncHeight = 'carcassHeight' in nextPatch
      const shouldSyncPosition = Object.keys(nextPatch).some((key) =>
        RUN_POSITION_PATCH_KEYS.has(key as keyof CabinetNodeType),
      )
      const shouldSyncModules = Object.keys(nextPatch).some((key) =>
        RUN_MODULE_SYNC_PATCH_KEYS.has(key as keyof CabinetNodeType),
      )
      if (!shouldSyncDepth && !shouldSyncHeight && !shouldSyncPosition && !shouldSyncModules) return

      const stylePatch: Partial<CabinetNodeType> = {}
      if ('frontStyle' in nextPatch) stylePatch.frontStyle = nextNode.frontStyle
      if ('frontOverlay' in nextPatch) stylePatch.frontOverlay = nextNode.frontOverlay
      if ('handleStyle' in nextPatch) stylePatch.handleStyle = nextNode.handleStyle
      if ('handlePosition' in nextPatch) stylePatch.handlePosition = nextNode.handlePosition

      for (const module of modules) {
        const modulePatch: Partial<CabinetModuleNodeType> = {}
        if (shouldSyncDepth) {
          modulePatch.depth = nextNode.depth
        }
        if (shouldSyncHeight) {
          modulePatch.carcassHeight = Math.max(
            nextNode.carcassHeight,
            minCabinetCarcassHeightForStack(module),
          )
        }
        if (shouldSyncPosition) {
          modulePatch.position = [module.position[0], runModuleBaseY(nextNode), module.position[2]]
        }
        if (shouldSyncModules) {
          if ('frontStyle' in nextPatch) modulePatch.frontStyle = nextNode.frontStyle
          if ('frontOverlay' in nextPatch) modulePatch.frontOverlay = nextNode.frontOverlay
          if ('handleStyle' in nextPatch) modulePatch.handleStyle = nextNode.handleStyle
          if ('handlePosition' in nextPatch) modulePatch.handlePosition = nextNode.handlePosition
        }
        scene.updateNode(module.id, modulePatch)

        if (shouldSyncModules) {
          const wallChild = wallChildOf(
            module,
            scene.nodes as Record<string, CabinetEditableNode | undefined>,
          )
          if (wallChild) {
            scene.updateNode(wallChild.id, {
              frontStyle: nextNode.frontStyle,
              frontOverlay: nextNode.frontOverlay,
              handleStyle: nextNode.handleStyle,
              handlePosition: nextNode.handlePosition,
            })
          }
        }
      }

      const cornerSource = cornerLinkedSourceModuleForRun(nextNode, scene.nodes)
      if (shouldSyncModules) {
        syncCornerStyleGroupFromRun({
          run: nextNode,
          patch: stylePatch,
          sceneApi,
        })
      } else if (cornerSource) {
        syncCornerRunsFromSourceModule({
          module: cornerSource,
          run: nextNode,
          sceneApi,
        })
      }

      // An upper/lower set's wall run tracks this run's REAL height — keep
      // it clear of the countertop after a plinth/carcass edit.
      if (shouldSyncHeight || shouldSyncPosition) {
        syncSetLinkWallRun({ baseRun: nextNode, sceneApi })
      }
    },
    [modules, node],
  )

  const updateSetLink = useCallback(
    (patch: Partial<NonNullable<CabinetNodeType['setLink']>>) => {
      if (!node.setLink) return
      const scene = useScene.getState()
      const sceneApi = createSceneApi(useScene)
      const nextSetLink = { ...node.setLink, ...patch }
      scene.updateNode(node.id, { setLink: nextSetLink })
      const baseRun = scene.nodes[nextSetLink.baseRunId]
      if (baseRun?.type === 'cabinet') {
        syncSetLinkWallRun({ baseRun, sceneApi })
      }
    },
    [node],
  )

  // Whole-piece sizing: the user gives the furniture's overall width or how
  // many bays it should have, and the modules follow. Adding/removing bays is
  // a scene mutation, so it reuses the existing add/delete paths and only the
  // layout comes from `run-layout`.
  const applyRunLayout = useCallback(
    (layout: ReturnType<typeof resizeRunToWidth>) => {
      const scene = useScene.getState()
      for (const bay of layout) {
        scene.updateNode(bay.id as AnyNodeId, { position: bay.position, width: bay.width })
      }
      scene.markDirty(node.id as AnyNodeId)
    },
    [node.id],
  )

  const setRunTotalWidth = useCallback(
    (totalWidth: number) => {
      applyRunLayout(resizeRunToWidth(sortedModules, totalWidth))
    },
    [applyRunLayout, sortedModules],
  )

  const setRunBayCount = useCallback(
    (bayCount: number) => {
      const target = Math.max(1, Math.min(24, Math.floor(bayCount)))
      const span = runSpanWidth(sortedModules)
      const sceneApi = createSceneApi(useScene)
      const scene = useScene.getState()

      // Grow first so the division lays out over the final module set, then
      // trim; both directions keep the run's overall span.
      for (let i = sortedModules.length; i < target; i += 1) {
        addCabinetModuleSide({ anchorModule: null, run: node, sceneApi, side: 'right' })
      }
      for (let i = sortedModules.length; i > target; i -= 1) {
        const last = sortRunModules(
          (scene.nodes[node.id as AnyNodeId] as CabinetNodeType | undefined)?.children
            ?.map((id) => scene.nodes[id as AnyNodeId] as CabinetModuleNodeType | undefined)
            .filter((m): m is CabinetModuleNodeType => m?.type === 'cabinet-module') ?? [],
        ).at(-1)
        if (last) scene.deleteNode(last.id as AnyNodeId)
      }

      const live = sortRunModules(
        (useScene.getState().nodes[node.id as AnyNodeId] as CabinetNodeType | undefined)?.children
          ?.map(
            (id) => useScene.getState().nodes[id as AnyNodeId] as CabinetModuleNodeType | undefined,
          )
          .filter((m): m is CabinetModuleNodeType => m?.type === 'cabinet-module') ?? [],
      )
      applyRunLayout(divideRunIntoBays(live, target, span))
    },
    [applyRunLayout, node, sortedModules],
  )

  const addModule = useCallback(
    (side: 'left' | 'right') => {
      const id = addCabinetModuleSide({
        anchorModule: null,
        run: node,
        sceneApi: createSceneApi(useScene),
        side,
      })
      if (id) setSelection({ selectedIds: [id] })
    },
    [node, setSelection],
  )

  const deleteModule = useCallback(
    (module: CabinetModuleNodeType) => {
      useScene.getState().deleteNode(module.id as AnyNodeId)
      // Deleting the last module cascades the empty run away too — only
      // keep it selected/dirty if it survived.
      if (useScene.getState().nodes[node.id as AnyNodeId]) {
        useScene.getState().markDirty(node.id as AnyNodeId)
        setSelection({ selectedIds: [node.id] })
      } else {
        setSelection({ selectedIds: [] })
      }
    },
    [node.id, setSelection],
  )

  const materials = useScene((s) => s.materials)
  const countertopSwatch = useMemo(
    () => countertopMaterialSwatch(node, materials),
    [node, materials],
  )
  // Same entry point the command palette / 'P' shortcut use
  // (`editor.mode.material-paint` in editor-commands.tsx): scope the paint
  // target to this run's `countertop` slot first so the picker opens primed
  // on the resolved current material instead of whatever was last painted.
  const startCountertopPaint = useCallback(() => {
    setSelection({ selectedIds: [node.id] })
    const editor = useEditor.getState()
    editor.setSelectedMaterialTarget({ nodeId: node.id, role: 'countertop' })
    editor.primeMaterialPaintFromSelection()
    editor.setPhase('structure')
    editor.setStructureLayer('elements')
    editor.setMode('material-paint')
  }, [node.id, setSelection])

  const [selectedCutoutId, setSelectedCutoutId] = useState<string | null>(null)
  const cutouts = node.countertopCutouts
  const selectedCutout = cutouts.find((cutout) => cutout.id === selectedCutoutId) ?? null

  const updateCutouts = useCallback(
    (next: CountertopCutout[]) => updateRun({ countertopCutouts: next }),
    [updateRun],
  )

  // Position ranges follow the actual slab, not a fixed ±3 m: a ±3 m slider on
  // a 1.2 m worktop makes the cutout impossible to place by drag, since almost
  // the whole travel is off the slab.
  const cutoutBounds = useMemo(() => {
    const span = runSpanWidth(sortedModules)
    const overhang = node.countertopOverhang ?? 0
    return {
      x: Math.max(0.05, span / 2 + overhang),
      z: Math.max(0.05, node.depth / 2 + overhang + (node.countertopBackOverhang ?? 0)),
    }
  }, [node.countertopBackOverhang, node.countertopOverhang, node.depth, sortedModules])

  const addCutout = useCallback(
    (shape: CountertopCutout['shape']) => {
      const cutout = newCountertopCutout(shape)
      updateCutouts([...cutouts, cutout])
      setSelectedCutoutId(cutout.id)
    },
    [cutouts, updateCutouts],
  )

  const removeCutout = useCallback(
    (id: string) => {
      updateCutouts(cutouts.filter((cutout) => cutout.id !== id))
      setSelectedCutoutId((current) => (current === id ? null : current))
    },
    [cutouts, updateCutouts],
  )

  const patchSelectedCutout = useCallback(
    (patch: Parameters<typeof patchCountertopCutout>[1]) => {
      if (!selectedCutout) return
      const id = selectedCutout.id
      updateCutouts(
        cutouts.map((cutout) => (cutout.id === id ? patchCountertopCutout(cutout, patch) : cutout)),
      )
    },
    [cutouts, selectedCutout, updateCutouts],
  )

  return (
    <PanelWrapper
      icon="/icons/item.webp"
      onClose={onClose}
      title={node.name || 'Modular Cabinet'}
      width={320}
    >
      <PanelSection title="Modules">
        <div className="space-y-2 px-1 pb-2">
          <SliderControl
            label="Total width"
            max={12}
            min={0.3}
            onChange={setRunTotalWidth}
            step={0.01}
            unit="m"
            value={Number(runSpanWidth(sortedModules).toFixed(3))}
          />
          <SliderControl
            label="Bays"
            max={12}
            min={1}
            onChange={setRunBayCount}
            step={1}
            value={sortedModules.length}
          />
        </div>
        <div className="flex flex-col gap-2 px-1 pb-2">
          {sortedModules.map((module, index) => (
            <div
              className="flex items-center justify-between rounded-lg border border-border/40 bg-[#252527] px-2 py-2"
              key={module.id}
            >
              <button
                className="min-w-0 flex-1 text-left"
                onClick={() => setSelection({ selectedIds: [module.id] })}
                type="button"
              >
                <div className="truncate text-xs font-medium text-foreground">
                  {module.name || `Module ${index + 1}`}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                  {moduleSummary(module)}
                </div>
              </button>
              <button
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-500/20 bg-red-500/8 text-red-300 transition-colors hover:bg-red-500/15 hover:text-red-200 disabled:opacity-30"
                disabled={modules.length <= 1}
                onClick={() => deleteModule(module)}
                type="button"
              >
                <Trash className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        <div className="px-1 pb-1">
          <div className="grid grid-cols-2 gap-2">
            <ActionButton
              icon={<Plus className="h-4 w-4" />}
              label="Add left"
              onClick={() => addModule('left')}
            />
            <ActionButton
              icon={<Plus className="h-4 w-4" />}
              label="Add right"
              onClick={() => addModule('right')}
            />
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Shared Plinth & Countertop">
        <div className="space-y-2 px-1 pb-2">
          <SliderControl
            label="Depth"
            max={1.2}
            min={0.3}
            onChange={(value) => updateRun({ depth: value })}
            precision={2}
            step={0.01}
            unit="m"
            value={node.depth}
          />
          <SliderControl
            label="Carcass height"
            max={node.runTier === 'tall' ? 2.4 : 1.4}
            min={Math.max(0.4, ...modules.map((module) => minCabinetCarcassHeightForStack(module)))}
            onChange={(value) => updateRun({ carcassHeight: value })}
            precision={2}
            step={0.01}
            unit="m"
            value={node.carcassHeight}
          />
          <ToggleControl
            checked={node.showPlinth}
            label="Show plinth"
            onChange={(checked) => updateRun({ showPlinth: checked })}
          />
          {node.showPlinth && (
            <SliderControl
              label="Plinth height"
              max={0.3}
              min={0.02}
              onChange={(value) => updateRun({ plinthHeight: value })}
              precision={2}
              step={0.01}
              unit="m"
              value={node.plinthHeight}
            />
          )}
          {!isWallSetRun && (
            <>
              <ToggleControl
                checked={node.withCountertop}
                label="Show countertop"
                onChange={(checked) => updateRun({ withCountertop: checked })}
              />
              {node.withCountertop && (
                <>
                  <SliderControl
                    label="Countertop height"
                    max={0.08}
                    min={0.005}
                    onChange={(value) => updateRun({ countertopThickness: value })}
                    precision={3}
                    step={0.005}
                    unit="m"
                    value={node.countertopThickness}
                  />
                  <SliderControl
                    label="Countertop depth"
                    max={0.12}
                    min={0}
                    onChange={(value) => updateRun({ countertopOverhang: value })}
                    precision={2}
                    step={0.005}
                    unit="m"
                    value={node.countertopOverhang}
                  />
                  <button
                    aria-label="Paint countertop"
                    className="flex w-full items-center gap-2 rounded-lg border border-border/40 bg-[#252527] px-2 py-2 text-left transition-colors hover:bg-[#2c2c2e]"
                    onClick={startCountertopPaint}
                    type="button"
                  >
                    <span
                      className="h-6 w-6 shrink-0 rounded-md border border-border/70"
                      style={{ backgroundColor: countertopSwatch.color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-medium text-foreground">
                        {countertopSwatch.name}
                      </span>
                      <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                        Countertop material — click to paint
                      </span>
                    </span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </PanelSection>

      {isWallSetRun && node.setLink && (
        <PanelSection title="Wall Set">
          <div className="space-y-2 px-1 pb-2">
            <SliderControl
              label="Gap above base"
              max={1}
              min={0}
              onChange={(value) => updateSetLink({ gap: value })}
              precision={2}
              step={0.05}
              unit="m"
              value={node.setLink.gap}
            />
            <SegmentedControl
              onChange={(value) => updateSetLink({ anchor: value as 'lower' | 'upper' })}
              options={[
                { value: 'lower', label: 'Follow base' },
                { value: 'upper', label: 'Fixed height' },
              ]}
              value={node.setLink.anchor}
            />
          </div>
        </PanelSection>
      )}

      {node.withCountertop && !isWallSetRun && (
        <PanelSection title="Countertop Cutouts">
          <div className="flex flex-col gap-2 px-1 pb-2">
            {cutouts.map((cutout) => {
              const label = cutoutLabel(cutout)
              return (
                <div
                  className="flex items-center justify-between rounded-lg border border-border/40 bg-[#252527] px-2 py-2"
                  key={cutout.id}
                >
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setSelectedCutoutId(cutout.id)}
                    type="button"
                  >
                    <div className="truncate text-xs font-medium text-foreground">
                      {label.primary}
                      {selectedCutout?.id === cutout.id ? ' •' : ''}
                    </div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {label.secondary}
                    </div>
                  </button>
                  <button
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-red-500/20 bg-red-500/8 text-red-300 transition-colors hover:bg-red-500/15 hover:text-red-200"
                    onClick={() => removeCutout(cutout.id)}
                    type="button"
                  >
                    <Trash className="h-3.5 w-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
          <div className="px-1 pb-1">
            <div className="grid grid-cols-2 gap-2">
              <ActionButton
                icon={<Plus className="h-4 w-4" />}
                label="Add rect"
                onClick={() => addCutout('rect')}
              />
              <ActionButton
                icon={<Plus className="h-4 w-4" />}
                label="Add circle"
                onClick={() => addCutout('circle')}
              />
            </div>
          </div>

          {selectedCutout && (
            <div className="space-y-2 px-1 pb-2">
              <div>
                <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Kind
                </div>
                <SegmentedControl
                  onChange={(value) => patchSelectedCutout({ kind: value as CountertopCutoutKind })}
                  options={COUNTERTOP_CUTOUT_KIND_OPTIONS}
                  value={selectedCutout.kind}
                />
              </div>
              <SliderControl
                label="Position X"
                max={cutoutBounds.x}
                min={-cutoutBounds.x}
                onChange={(value) =>
                  patchSelectedCutout({ position: { ...selectedCutout.position, x: value } })
                }
                precision={3}
                step={0.005}
                unit="m"
                value={selectedCutout.position.x}
              />
              <SliderControl
                label="Position Z"
                max={cutoutBounds.z}
                min={-cutoutBounds.z}
                onChange={(value) =>
                  patchSelectedCutout({ position: { ...selectedCutout.position, z: value } })
                }
                precision={3}
                step={0.005}
                unit="m"
                value={selectedCutout.position.z}
              />
              {selectedCutout.shape === 'circle' ? (
                <SliderControl
                  label="Radius"
                  max={0.6}
                  min={0.01}
                  onChange={(value) => patchSelectedCutout({ radius: value })}
                  precision={3}
                  step={0.005}
                  unit="m"
                  value={selectedCutout.radius}
                />
              ) : (
                <>
                  <SliderControl
                    label="Width"
                    max={1.2}
                    min={0.01}
                    onChange={(value) =>
                      patchSelectedCutout({ size: { ...selectedCutout.size, width: value } })
                    }
                    precision={3}
                    step={0.005}
                    unit="m"
                    value={selectedCutout.size.width}
                  />
                  <SliderControl
                    label="Depth"
                    max={1.2}
                    min={0.01}
                    onChange={(value) =>
                      patchSelectedCutout({ size: { ...selectedCutout.size, depth: value } })
                    }
                    precision={3}
                    step={0.005}
                    unit="m"
                    value={selectedCutout.size.depth}
                  />
                  <SliderControl
                    label="Corner radius"
                    max={0.3}
                    min={0}
                    onChange={(value) => patchSelectedCutout({ cornerRadius: value })}
                    precision={3}
                    step={0.005}
                    unit="m"
                    value={selectedCutout.cornerRadius}
                  />
                </>
              )}
            </div>
          )}
        </PanelSection>
      )}

      {!isWallSetRun && (
        <PanelSection title="Island & Bar">
          <div className="space-y-2 px-1 pb-2">
            {node.withCountertop && node.barLedge?.edge !== 'back' && (
              <SliderControl
                label="Seating overhang"
                max={0.45}
                min={0}
                onChange={(value) => updateRun({ countertopBackOverhang: value })}
                precision={2}
                step={0.05}
                unit="m"
                value={node.countertopBackOverhang}
              />
            )}
            <ToggleControl
              checked={node.withFinishedBack}
              label="Finished back"
              onChange={(checked) => updateRun({ withFinishedBack: checked })}
            />
            {node.withCountertop && (
              <ToggleControl
                checked={node.withWaterfall}
                label="Waterfall ends"
                onChange={(checked) => updateRun({ withWaterfall: checked })}
              />
            )}
            <ToggleControl
              checked={Boolean(node.barLedge)}
              label="Bar counter"
              onChange={(checked) =>
                updateRun({
                  barLedge: checked ? { edge: 'back', height: 1.06, depth: 0.35 } : undefined,
                })
              }
            />
            {node.barLedge && (
              <>
                <SegmentedControl
                  onChange={(value) =>
                    updateRun({
                      barLedge: { ...node.barLedge!, edge: value as 'back' | 'left' | 'right' },
                    })
                  }
                  options={[
                    { value: 'back', label: 'Back' },
                    { value: 'left', label: 'Left' },
                    { value: 'right', label: 'Right' },
                  ]}
                  value={node.barLedge.edge}
                />
                <SliderControl
                  label="Bar height"
                  max={1.3}
                  min={0.9}
                  onChange={(value) =>
                    updateRun({ barLedge: { ...node.barLedge!, height: value } })
                  }
                  precision={2}
                  step={0.01}
                  unit="m"
                  value={node.barLedge.height}
                />
                <SliderControl
                  label="Bar depth"
                  max={0.5}
                  min={0.15}
                  onChange={(value) => updateRun({ barLedge: { ...node.barLedge!, depth: value } })}
                  precision={2}
                  step={0.01}
                  unit="m"
                  value={node.barLedge.depth}
                />
              </>
            )}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Fronts">
        <div className="space-y-2 px-1 pb-2">
          <div>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Style
            </div>
            <SegmentedControl
              onChange={(value) =>
                updateRun({ frontStyle: value as CabinetNodeType['frontStyle'] })
              }
              options={FRONT_STYLE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={node.frontStyle ?? 'slab'}
            />
          </div>
          <div>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Mounting
            </div>
            <SegmentedControl
              onChange={(value) =>
                updateRun({ frontOverlay: value as CabinetNodeType['frontOverlay'] })
              }
              options={FRONT_OVERLAY_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={node.frontOverlay ?? 'full'}
            />
          </div>
        </div>
      </PanelSection>

      <PanelSection title="Handles">
        <div className="space-y-2 px-1 pb-2">
          <div>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Style
            </div>
            <SegmentedControl
              onChange={(value) =>
                updateRun({ handleStyle: value as CabinetNodeType['handleStyle'] })
              }
              options={HANDLE_STYLE_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={node.handleStyle}
            />
          </div>
          {(node.handleStyle === 'bar' || node.handleStyle === 'knob') && (
            <div>
              <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                Position
              </div>
              <SegmentedControl
                onChange={(value) =>
                  updateRun({ handlePosition: value as CabinetNodeType['handlePosition'] })
                }
                options={HANDLE_POSITION_OPTIONS.map((option) => ({
                  value: option.value,
                  label: option.label,
                }))}
                value={node.handlePosition ?? 'auto'}
              />
            </div>
          )}
        </div>
      </PanelSection>
    </PanelWrapper>
  )
}

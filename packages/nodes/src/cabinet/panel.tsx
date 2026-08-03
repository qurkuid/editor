'use client'

import type {
  AnyNodeId,
  CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode as CabinetNodeType,
  FurnitureAssembly,
  FurnitureFront,
  FurnitureKind,
} from '@pascal-app/core'
import {
  createDefaultFurnitureAssembly,
  createSceneApi,
  deleteFurnitureBay,
  deleteFurnitureTier,
  insertFurnitureBay,
  insertFurnitureTier,
  resizeFurnitureAssembly,
  resizeFurnitureBay,
  resizeFurnitureTier,
  setFurnitureKind,
  setFurnitureTierFront,
  setFurnitureTierInterior,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  getLinearUnitLabel,
  linearControlValueToMeters,
  metersToLinearUnit,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Minus, Pause, Play, Plus } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CompartmentCard } from './compartment-card'
import {
  animateCabinetOperationState,
  isCabinetAnimationRunning,
  onCabinetAnimationChange,
  stopCabinetAnimation,
} from './interaction'
import { CABINET_PRESETS, type CabinetPresetId } from './presets'
import {
  addWallChildAbove,
  backAlignZ,
  resolveCabinetType,
  runModuleBaseY,
  switchCabinetToBase,
  switchCabinetToTall,
  syncCornerRunsFromSourceModule,
  wallChildOf,
} from './run-ops'
import {
  bumpRunLayoutRevisionViaStore,
  type CabinetEditableNode,
  CabinetRunPanel,
  reflowRunModules,
} from './run-panel'
import {
  backAnchoredModuleZ,
  type CabinetCompartment,
  isHoodCompartmentType,
  minCabinetCarcassHeightForStack,
  newCabinetCompartment,
  normalizeCabinetStack,
  resizeCabinetCompartmentStack,
  stackForCabinet,
} from './stack'
import { resolveCompartmentTransition } from './stack-transitions'

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

const FRONT_OVERLAY_OPTIONS = [
  { value: 'full', label: 'Overlay' },
  { value: 'inset', label: 'Inset' },
] as const

const FRONT_STYLE_OPTIONS = [
  { value: 'slab', label: 'Slab' },
  { value: 'shaker', label: 'Shaker' },
  { value: 'raised-arch', label: 'Raised Arch' },
] as const

const CABINET_TIER_OPTIONS = [
  { value: 'base', label: 'Base Cabinet' },
  { value: 'tall', label: 'Tall Cabinet' },
] as const

const FURNITURE_KIND_OPTIONS: Array<{ value: FurnitureKind; label: string }> = [
  { value: 'wardrobe', label: 'Wardrobe' },
  { value: 'base-run', label: 'Base' },
  { value: 'upper-run', label: 'Upper' },
  { value: 'tall', label: 'Tall' },
  { value: 'island', label: 'Island' },
  { value: 'set', label: 'Set' },
  { value: 'sink', label: 'Sink' },
]

const FURNITURE_FRONT_KIND_OPTIONS: Array<{ value: FurnitureFront['kind']; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'hinged', label: 'Hinged' },
  { value: 'drawer', label: 'Drawer' },
  { value: 'flap', label: 'Flap' },
  { value: 'sliding', label: 'Sliding' },
  { value: 'pull-out', label: 'Pull-out' },
]

const FURNITURE_HINGED_LEAVES_OPTIONS = [
  { value: '1', label: '1 leaf' },
  { value: '2', label: '2 leaves' },
] as const

const FURNITURE_SLIDING_LEAVES_OPTIONS = [
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
] as const

const FURNITURE_FLAP_DIRECTION_OPTIONS = [
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
] as const

const FURNITURE_PULL_OUT_STYLE_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'spice', label: 'Spice' },
  { value: 'pantry', label: 'Pantry' },
] as const

const EMPTY_MODULES: CabinetModuleNodeType[] = []
const EMPTY_MODULE_IDS: AnyNodeId[] = []

const PRESET_BUTTON_CLASS =
  'flex h-9 items-center justify-center rounded-md border border-border/40 bg-[#252527] px-3 py-2 text-center text-xs font-medium text-foreground transition-colors hover:border-border/70 hover:bg-[#303033]'

type FurnitureNavigation = {
  bayId: string | null
  tierId: string | null
  editingInterior: boolean
  editingFront: boolean
}

export type FurnitureInteriorDraft = {
  shelfCount: number
  hanger: boolean
}

export type FurnitureInteriorDraftAction =
  | 'decreaseShelfCount'
  | 'increaseShelfCount'
  | 'toggleHanger'

export function reduceFurnitureInteriorDraft(
  draft: FurnitureInteriorDraft,
  action: FurnitureInteriorDraftAction,
): FurnitureInteriorDraft {
  if (action === 'decreaseShelfCount') {
    return { ...draft, shelfCount: Math.max(0, draft.shelfCount - 1) }
  }
  if (action === 'increaseShelfCount') {
    return { ...draft, shelfCount: Math.min(8, draft.shelfCount + 1) }
  }
  return { ...draft, hanger: !draft.hanger }
}

const INITIAL_FURNITURE_NAVIGATION: FurnitureNavigation = {
  bayId: null,
  tierId: null,
  editingInterior: false,
  editingFront: false,
}

export type FurnitureFrontDraftAction =
  | { type: 'setKind'; kind: FurnitureFront['kind'] }
  | { type: 'setLeaves'; leaves: number }
  | { type: 'setGlass'; glass: boolean }
  | { type: 'setDrawerCount'; count: number }
  | { type: 'setFlapDirection'; direction: 'up' | 'down' }
  | { type: 'setPullOutStyle'; style: 'standard' | 'spice' | 'pantry' }

function createFurnitureFrontDraft(
  kind: FurnitureFront['kind'],
  previous: FurnitureFront,
): FurnitureFront {
  const appearance = { color: previous.color, materialId: previous.materialId }
  if (kind === 'open') return { kind, ...appearance }
  if (kind === 'hinged') return { kind, leaves: 2, glass: false, ...appearance }
  if (kind === 'drawer') return { kind, count: 1, ...appearance }
  if (kind === 'flap') return { kind, direction: 'up', ...appearance }
  if (kind === 'sliding') return { kind, leaves: 2, ...appearance }
  return { kind, style: 'standard', ...appearance }
}

export function reduceFurnitureFrontDraft(
  draft: FurnitureFront,
  action: FurnitureFrontDraftAction,
): FurnitureFront {
  if (action.type === 'setKind') return createFurnitureFrontDraft(action.kind, draft)
  if (action.type === 'setLeaves' && draft.kind === 'hinged') {
    return { ...draft, leaves: Math.min(2, Math.max(1, action.leaves)) }
  }
  if (action.type === 'setLeaves' && draft.kind === 'sliding') {
    return { ...draft, leaves: Math.min(4, Math.max(2, action.leaves)) }
  }
  if (action.type === 'setGlass' && draft.kind === 'hinged') {
    return { ...draft, glass: action.glass }
  }
  if (action.type === 'setDrawerCount' && draft.kind === 'drawer') {
    return { ...draft, count: Math.min(6, Math.max(1, action.count)) }
  }
  if (action.type === 'setFlapDirection' && draft.kind === 'flap') {
    return { ...draft, direction: action.direction }
  }
  if (action.type === 'setPullOutStyle' && draft.kind === 'pull-out') {
    return { ...draft, style: action.style }
  }
  return draft
}

export function FurnitureTierInteriorControls({
  draft,
  onDraftChange,
  onCancel,
  onApply,
}: {
  draft: FurnitureInteriorDraft
  onDraftChange: (action: FurnitureInteriorDraftAction) => void
  onCancel: () => void
  onApply: () => void
}) {
  return (
    <div className="space-y-3 px-1 pb-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs">Shelf count</span>
        <div className="flex items-center gap-1 rounded-md border border-border/50 p-1">
          <button
            aria-label="Decrease shelf count"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground disabled:opacity-40"
            disabled={draft.shelfCount === 0}
            onClick={() => onDraftChange('decreaseShelfCount')}
            type="button"
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span aria-live="polite" className="w-5 text-center text-xs">
            {draft.shelfCount}
          </span>
          <button
            aria-label="Increase shelf count"
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground disabled:opacity-40"
            disabled={draft.shelfCount === 8}
            onClick={() => onDraftChange('increaseShelfCount')}
            type="button"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <button
        aria-pressed={draft.hanger}
        className="flex h-9 w-full items-center justify-between rounded-md border border-border/50 bg-[#2C2C2E] px-3 text-xs hover:bg-[#3e3e3e]"
        onClick={() => onDraftChange('toggleHanger')}
        type="button"
      >
        <span>Hanger rod</span>
        <span className="text-muted-foreground">{draft.hanger ? 'On' : 'Off'}</span>
      </button>
      <div className="flex gap-2">
        <ActionButton label="Cancel" onClick={onCancel} />
        <ActionButton label="Apply" onClick={onApply} />
      </div>
      <p className="text-[10px] text-muted-foreground">Enter to apply · Escape to cancel</p>
    </div>
  )
}

export function FurnitureTierFrontControls({
  draft,
  onDraftChange,
  onCancel,
  onApply,
}: {
  draft: FurnitureFront
  onDraftChange: (action: FurnitureFrontDraftAction) => void
  onCancel: () => void
  onApply: () => void
}) {
  return (
    <div className="space-y-3 px-1 pb-2">
      <div>
        <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Kind
        </div>
        <SegmentedControl
          onChange={(value) =>
            onDraftChange({ type: 'setKind', kind: value as FurnitureFront['kind'] })
          }
          options={FURNITURE_FRONT_KIND_OPTIONS}
          value={draft.kind}
        />
      </div>
      {draft.kind === 'hinged' && (
        <>
          <div>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Leaves
            </div>
            <SegmentedControl
              onChange={(value) => onDraftChange({ type: 'setLeaves', leaves: Number(value) })}
              options={FURNITURE_HINGED_LEAVES_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={String(draft.leaves)}
            />
          </div>
          <button
            aria-pressed={draft.glass}
            className="flex h-9 w-full items-center justify-between rounded-md border border-border/50 bg-[#2C2C2E] px-3 text-xs hover:bg-[#3e3e3e]"
            onClick={() => onDraftChange({ type: 'setGlass', glass: !draft.glass })}
            type="button"
          >
            <span>Glass</span>
            <span className="text-muted-foreground">{draft.glass ? 'On' : 'Off'}</span>
          </button>
        </>
      )}
      {draft.kind === 'drawer' && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs">Drawer count</span>
          <div className="flex items-center gap-1 rounded-md border border-border/50 p-1">
            <button
              aria-label="Decrease drawer count"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground disabled:opacity-40"
              disabled={draft.count === 1}
              onClick={() => onDraftChange({ type: 'setDrawerCount', count: draft.count - 1 })}
              type="button"
            >
              <Minus className="h-3.5 w-3.5" />
            </button>
            <span aria-live="polite" className="w-5 text-center text-xs">
              {draft.count}
            </span>
            <button
              aria-label="Increase drawer count"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground disabled:opacity-40"
              disabled={draft.count === 6}
              onClick={() => onDraftChange({ type: 'setDrawerCount', count: draft.count + 1 })}
              type="button"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
      {draft.kind === 'flap' && (
        <div>
          <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Direction
          </div>
          <SegmentedControl
            onChange={(value) =>
              onDraftChange({ type: 'setFlapDirection', direction: value as 'up' | 'down' })
            }
            options={FURNITURE_FLAP_DIRECTION_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={draft.direction}
          />
        </div>
      )}
      {draft.kind === 'sliding' && (
        <div>
          <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Leaves
          </div>
          <SegmentedControl
            onChange={(value) => onDraftChange({ type: 'setLeaves', leaves: Number(value) })}
            options={FURNITURE_SLIDING_LEAVES_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={String(draft.leaves)}
          />
        </div>
      )}
      {draft.kind === 'pull-out' && (
        <div>
          <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Style
          </div>
          <SegmentedControl
            onChange={(value) =>
              onDraftChange({
                type: 'setPullOutStyle',
                style: value as 'standard' | 'spice' | 'pantry',
              })
            }
            options={FURNITURE_PULL_OUT_STYLE_OPTIONS.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={draft.style}
          />
        </div>
      )}
      <div className="flex gap-2">
        <ActionButton label="Cancel" onClick={onCancel} />
        <ActionButton label="Apply" onClick={onApply} />
      </div>
      <p className="text-[10px] text-muted-foreground">Enter to apply · Escape to cancel</p>
    </div>
  )
}

export default function CabinetPanel() {
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const unit = useViewer((s) => s.unit)
  const [isAnimating, setIsAnimating] = useState(false)
  const [furnitureNavigation, setFurnitureNavigation] = useState<FurnitureNavigation>(
    INITIAL_FURNITURE_NAVIGATION,
  )
  const [furnitureDraft, setFurnitureDraft] = useState<FurnitureInteriorDraft | null>(null)
  const [furnitureFrontDraft, setFurnitureFrontDraft] = useState<FurnitureFront | null>(null)
  const node = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNodeId] as CabinetEditableNode | undefined) : undefined,
  )
  const parentRun = useScene((s) => {
    if (!selectedId) return undefined
    const selected = s.nodes[selectedId as AnyNodeId]
    if (selected?.type !== 'cabinet-module' || !selected.parentId) return undefined
    const parent = s.nodes[selected.parentId as AnyNodeId] as CabinetEditableNode | undefined
    return parent?.type === 'cabinet' ? parent : undefined
  })
  const moduleIds = useScene((s) => {
    if (!selectedId) return EMPTY_MODULE_IDS
    const selected = s.nodes[selectedId as AnyNodeId] as CabinetEditableNode | undefined
    const parent =
      selected?.type === 'cabinet'
        ? selected
        : selected?.type === 'cabinet-module' && selected.parentId
          ? (s.nodes[selected.parentId as AnyNodeId] as CabinetNodeType | undefined)
          : undefined
    if (parent?.type !== 'cabinet') return EMPTY_MODULE_IDS
    return (parent.children ?? EMPTY_MODULE_IDS) as AnyNodeId[]
  })
  // Select just the run's modules — subscribing to the whole `s.nodes` record
  // re-rendered the panel on every scene mutation anywhere in the scene.
  const modules = useScene(
    useShallow((s) => {
      if (moduleIds.length === 0) return EMPTY_MODULES
      const found = moduleIds
        .map((id) => s.nodes[id as AnyNodeId] as CabinetModuleNodeType | undefined)
        .filter((child): child is CabinetModuleNodeType => child?.type === 'cabinet-module')
      return found.length === 0 ? EMPTY_MODULES : found
    }),
  )
  const wallChild = useScene((s) => {
    const selected = selectedId ? s.nodes[selectedId as AnyNodeId] : undefined
    return selected?.type === 'cabinet-module'
      ? wallChildOf(selected, s.nodes as Record<string, CabinetEditableNode | undefined>)
      : undefined
  })
  const parentIsModule = useScene((s) => {
    const selected = selectedId ? s.nodes[selectedId as AnyNodeId] : undefined
    return (
      selected?.type === 'cabinet-module' &&
      selected.parentId != null &&
      s.nodes[selected.parentId as AnyNodeId]?.type === 'cabinet-module'
    )
  })

  const updateNode = useCallback(
    (patch: Partial<CabinetEditableNode>) => {
      if (!selectedId) return
      const scene = useScene.getState()
      const liveBeforeUpdate = scene.nodes[selectedId as AnyNodeId] as
        | CabinetEditableNode
        | undefined
      const nextPatch = { ...patch }
      if (
        liveBeforeUpdate?.type === 'cabinet-module' &&
        typeof nextPatch.carcassHeight === 'number'
      ) {
        nextPatch.carcassHeight = Math.max(
          nextPatch.carcassHeight,
          minCabinetCarcassHeightForStack(liveBeforeUpdate),
        )
      }
      if (
        liveBeforeUpdate?.type === 'cabinet-module' &&
        liveBeforeUpdate.parentId &&
        parentRun?.type === 'cabinet' &&
        'width' in nextPatch &&
        typeof nextPatch.width === 'number'
      ) {
        reflowRunModules({
          modules,
          parentRun,
          patch: nextPatch as Partial<CabinetModuleNodeType>,
          scene,
          selected: liveBeforeUpdate,
        })
        return
      }
      if (
        liveBeforeUpdate?.type === 'cabinet-module' &&
        liveBeforeUpdate.parentId &&
        parentRun?.type === 'cabinet' &&
        typeof nextPatch.depth === 'number'
      ) {
        const patchPosition = nextPatch.position as CabinetModuleNodeType['position'] | undefined
        nextPatch.position = [
          patchPosition?.[0] ?? liveBeforeUpdate.position[0],
          patchPosition?.[1] ?? liveBeforeUpdate.position[1],
          backAnchoredModuleZ(
            liveBeforeUpdate.position[2],
            liveBeforeUpdate.depth,
            nextPatch.depth,
          ),
        ]
      }
      scene.updateNode(selectedId as AnyNodeId, nextPatch)
      const liveNode = scene.nodes[selectedId as AnyNodeId] as CabinetEditableNode | undefined
      if (liveNode?.type === 'cabinet-module' && liveNode.parentId) {
        scene.markDirty(liveNode.parentId as AnyNodeId)
        const parent = scene.nodes[liveNode.parentId as AnyNodeId] as
          | CabinetEditableNode
          | undefined
        const affectsRunLayout =
          'stack' in nextPatch ||
          'carcassHeight' in nextPatch ||
          'cabinetType' in nextPatch ||
          'position' in nextPatch ||
          'depth' in nextPatch ||
          'width' in nextPatch
        if (parent?.type === 'cabinet' && affectsRunLayout) {
          bumpRunLayoutRevisionViaStore(scene, parent)
          if (liveNode?.type === 'cabinet-module') {
            syncCornerRunsFromSourceModule({
              module: liveNode,
              run: parent,
              sceneApi: createSceneApi(useScene),
            })
          }
        }
      }
      // Keep a nested wall cabinet's back flush with its base when the base depth changes.
      if ('depth' in nextPatch && liveNode?.type === 'cabinet-module') {
        const wallChild = wallChildOf(
          liveNode,
          scene.nodes as Record<string, CabinetEditableNode | undefined>,
        )
        if (wallChild) {
          scene.updateNode(wallChild.id as AnyNodeId, {
            position: [
              wallChild.position[0],
              wallChild.position[1],
              backAlignZ(liveNode.depth, wallChild.depth),
            ],
          })
          scene.markDirty(liveNode.id as AnyNodeId)
        }
      }
    },
    [modules, parentRun, selectedId],
  )

  const close = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  // Selecting the run as the sole selection is enough: the selection-manager's
  // parent-frame routing keeps clicks on child modules targeting the run while
  // it stays the single selected node.
  const backToRun = useCallback(() => {
    if (node?.type === 'cabinet-module' && node.parentId) {
      setSelection({ selectedIds: [node.parentId] })
    }
  }, [node, setSelection])

  // Animation lives in ./interaction.ts, shared with the registry E-key
  // action; the panel only mirrors its running state for the Play button.
  const stopAnimation = useCallback(() => {
    if (selectedId) stopCabinetAnimation(selectedId as AnyNodeId)
  }, [selectedId])

  const animateOperationState = useCallback(
    (target: 0 | 1) => {
      if (selectedId) animateCabinetOperationState(selectedId as AnyNodeId, target)
    },
    [selectedId],
  )

  useEffect(() => {
    if (selectedId === undefined) {
      setFurnitureNavigation(INITIAL_FURNITURE_NAVIGATION)
      setFurnitureDraft(null)
      setFurnitureFrontDraft(null)
      return
    }
    setFurnitureNavigation(INITIAL_FURNITURE_NAVIGATION)
    setFurnitureDraft(null)
    setFurnitureFrontDraft(null)
  }, [selectedId])

  useEffect(() => {
    setIsAnimating(selectedId ? isCabinetAnimationRunning(selectedId as AnyNodeId) : false)
    return onCabinetAnimationChange((nodeId, running) => {
      if (nodeId === selectedId) setIsAnimating(running)
    })
  }, [selectedId])

  const updateFurniture = useCallback(
    (furniture: FurnitureAssembly) => {
      updateNode({
        furniture,
        width: furniture.dimensions.width,
        depth: furniture.dimensions.depth,
        carcassHeight: furniture.dimensions.height,
        showPlinth: false,
        withCountertop: false,
      })
    },
    [updateNode],
  )

  const selectedFurniture = node?.type === 'cabinet' ? node.furniture : undefined
  const activeBay = selectedFurniture?.bays.find((bay) => bay.id === furnitureNavigation.bayId)
  const activeTier = activeBay?.tiers.find((tier) => tier.id === furnitureNavigation.tierId)
  const cancelFurnitureInterior = useCallback(() => {
    setFurnitureDraft(null)
    setFurnitureNavigation((current) => ({ ...current, editingInterior: false }))
  }, [])
  const applyFurnitureInterior = useCallback(() => {
    if (!selectedFurniture || !furnitureNavigation.bayId || !furnitureNavigation.tierId) return
    if (!furnitureDraft) return

    const nextFurniture = setFurnitureTierInterior(selectedFurniture, {
      bayId: furnitureNavigation.bayId,
      tierId: furnitureNavigation.tierId,
      shelfCount: furnitureDraft.shelfCount,
      hanger: furnitureDraft.hanger,
    })
    if (nextFurniture !== selectedFurniture) updateFurniture(nextFurniture)
    setFurnitureDraft(null)
    setFurnitureNavigation((current) => ({ ...current, editingInterior: false }))
  }, [furnitureDraft, furnitureNavigation, selectedFurniture, updateFurniture])

  const cancelFurnitureFront = useCallback(() => {
    setFurnitureFrontDraft(null)
    setFurnitureNavigation((current) => ({ ...current, editingFront: false }))
  }, [])
  const applyFurnitureFront = useCallback(() => {
    if (!selectedFurniture || !furnitureNavigation.bayId || !furnitureNavigation.tierId) return
    if (!furnitureFrontDraft) return

    const nextFurniture = setFurnitureTierFront(selectedFurniture, {
      bayId: furnitureNavigation.bayId,
      tierId: furnitureNavigation.tierId,
      front: furnitureFrontDraft,
    })
    if (nextFurniture !== selectedFurniture) updateFurniture(nextFurniture)
    setFurnitureFrontDraft(null)
    setFurnitureNavigation((current) => ({ ...current, editingFront: false }))
  }, [furnitureFrontDraft, furnitureNavigation, selectedFurniture, updateFurniture])

  useEffect(() => {
    if (!furnitureNavigation.editingInterior) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        applyFurnitureInterior()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        cancelFurnitureInterior()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [applyFurnitureInterior, cancelFurnitureInterior, furnitureNavigation.editingInterior])

  useEffect(() => {
    if (!furnitureNavigation.editingFront) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        applyFurnitureFront()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        cancelFurnitureFront()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [applyFurnitureFront, cancelFurnitureFront, furnitureNavigation.editingFront])

  if (!node || (node.type !== 'cabinet' && node.type !== 'cabinet-module')) return null

  const stack = stackForCabinet(node)
  const isHoodOnlyNode =
    stack.length > 0 && stack.every((compartment) => isHoodCompartmentType(compartment.type))
  const normalized = normalizeCabinetStack(node)
  const rowHeights = new Map(normalized.map((row) => [row.index, row.height]))
  const rows = stack.map((compartment, index) => ({ compartment, index })).reverse()

  const commitStack = (
    next: CabinetCompartment[],
    extraPatch: Partial<CabinetModuleNodeType> = {},
  ) => {
    const patch = { ...extraPatch, stack: next }
    const minCarcassHeight = minCabinetCarcassHeightForStack({ ...node, stack: next })
    const targetCarcassHeight = patch.carcassHeight ?? node.carcassHeight
    if (targetCarcassHeight < minCarcassHeight) patch.carcassHeight = minCarcassHeight
    if (node.type === 'cabinet-module' && parentRun?.type === 'cabinet' && patch.width) {
      reflowRunModules({
        modules,
        parentRun,
        patch,
        scene: useScene.getState(),
        selected: node,
      })
      return
    }
    updateNode(patch)
  }
  const replaceAt = (index: number, next: CabinetCompartment) => {
    const transition = resolveCompartmentTransition({ node, parentRun, index, next })
    commitStack(transition.stack, transition.modulePatch)
  }
  const resizeAt = (index: number, height: number) =>
    commitStack(resizeCabinetCompartmentStack(node, index, height))
  const removeAt = (index: number) => commitStack(stack.filter((_, i) => i !== index))
  const addCompartment = () => commitStack([...stack, newCabinetCompartment('shelf')])
  const moveCompartment = (index: number, delta: -1 | 1) => {
    const target = index + delta
    if (target < 0 || target >= stack.length) return
    const next = stack.slice()
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    commitStack(next)
  }

  // Structural run mutations live in run-ops.ts, shared with the quick-action
  // menu so the two surfaces can't drift.
  const runOpsApi = () => createSceneApi(useScene)

  const addWallCabinetOrHoodAbove = (kind: 'cabinet' | 'hood') => {
    if (node?.type !== 'cabinet-module' || parentRun?.type !== 'cabinet') return
    const id = addWallChildAbove({ kind, module: node, run: parentRun, sceneApi: runOpsApi() })
    if (id) setSelection({ selectedIds: [id] })
  }

  const addWallCabinetAbove = () => addWallCabinetOrHoodAbove('cabinet')
  const addHoodAbove = () => addWallCabinetOrHoodAbove('hood')

  const removeWallCabinet = () => {
    if (node?.type !== 'cabinet-module') return
    const scene = useScene.getState()
    const wall = wallChildOf(node, scene.nodes)
    if (!wall) return
    scene.deleteNode(wall.id as AnyNodeId)
    scene.markDirty(node.id as AnyNodeId)
    setSelection({ selectedIds: [node.id] })
  }

  const switchToTall = () => {
    if (node?.type !== 'cabinet-module' || parentRun?.type !== 'cabinet') return
    if (switchCabinetToTall({ module: node, run: parentRun, sceneApi: runOpsApi() })) {
      setSelection({ selectedIds: [node.id] })
    }
  }

  const switchToBase = () => {
    if (node?.type !== 'cabinet-module' || parentRun?.type !== 'cabinet') return
    if (switchCabinetToBase({ module: node, run: parentRun, sceneApi: runOpsApi() })) {
      setSelection({ selectedIds: [node.id] })
    }
  }

  const hasWallCabinet = node?.type === 'cabinet-module' ? Boolean(wallChild) : false

  const isWallChildModule = node?.type === 'cabinet-module' && parentIsModule

  const applyPreset = (presetId: CabinetPresetId) => {
    if (node?.type !== 'cabinet-module') return
    const scene = useScene.getState()
    const preset = CABINET_PRESETS.find((entry) => entry.id === presetId)
    if (!preset) return

    const patch = preset.createPatch(parentRun)
    const wallChild = wallChildOf(
      node,
      scene.nodes as Record<string, CabinetEditableNode | undefined>,
    )
    if (wallChild && patch.cabinetType === 'tall') {
      scene.deleteNode(wallChild.id as AnyNodeId)
    }

    const nextPatch: Partial<CabinetModuleNodeType> = {
      ...patch,
      position: [
        node.position[0],
        parentRun?.type === 'cabinet' ? runModuleBaseY(parentRun) : node.position[1],
        typeof patch.depth === 'number'
          ? backAnchoredModuleZ(node.position[2], node.depth, patch.depth)
          : node.position[2],
      ],
    }

    if (parentRun?.type === 'cabinet') {
      reflowRunModules({
        modules,
        parentRun,
        patch: nextPatch,
        preserveExtent: true,
        scene,
        selected: node,
      })
    } else {
      scene.updateNode(node.id as AnyNodeId, nextPatch)
    }
    setSelection({ selectedIds: [node.id] })
  }

  if (node.type === 'cabinet' && modules.length > 0) {
    return <CabinetRunPanel modules={modules} node={node} onClose={close} />
  }

  const unitLabel = getLinearUnitLabel(unit)

  if (node.type === 'cabinet' && node.furniture) {
    const furniture = node.furniture
    const updateFurnitureDimension = (
      key: keyof FurnitureAssembly['dimensions'],
      displayValue: number,
    ) => {
      const limits =
        key === 'width' ? { minMeters: 0.3, maxMeters: 10 } : { minMeters: 0.1, maxMeters: 4 }
      updateFurniture(
        resizeFurnitureAssembly(furniture, {
          [key]: linearControlValueToMeters(displayValue, unit, limits),
        }),
      )
    }

    if (activeBay && furnitureNavigation.bayId && furnitureNavigation.tierId && activeTier) {
      const bayIndex = furniture.bays.findIndex((bay) => bay.id === activeBay.id)
      const tierIndex = activeBay.tiers.findIndex((tier) => tier.id === activeTier.id)
      const adjacentTier = activeBay.tiers[tierIndex + 1] ?? activeBay.tiers[tierIndex - 1]

      if (furnitureNavigation.editingInterior && furnitureDraft) {
        return (
          <PanelWrapper
            icon="/icons/item.webp"
            onBack={cancelFurnitureInterior}
            onClose={close}
            title={`Tier ${tierIndex + 1} Interior`}
            width={320}
          >
            <div className="px-1 pb-2 text-[11px] text-muted-foreground">
              Bay {bayIndex + 1} → Tier {tierIndex + 1} → Interior
            </div>
            <PanelSection title="Interior">
              <FurnitureTierInteriorControls
                draft={furnitureDraft}
                onApply={applyFurnitureInterior}
                onCancel={cancelFurnitureInterior}
                onDraftChange={(action) =>
                  setFurnitureDraft((current) =>
                    current ? reduceFurnitureInteriorDraft(current, action) : current,
                  )
                }
              />
            </PanelSection>
          </PanelWrapper>
        )
      }

      if (furnitureNavigation.editingFront && furnitureFrontDraft) {
        return (
          <PanelWrapper
            icon="/icons/item.webp"
            onBack={cancelFurnitureFront}
            onClose={close}
            title={`Tier ${tierIndex + 1} Front`}
            width={320}
          >
            <div className="px-1 pb-2 text-[11px] text-muted-foreground">
              Bay {bayIndex + 1} → Tier {tierIndex + 1} → Front
            </div>
            <PanelSection title="Front">
              <FurnitureTierFrontControls
                draft={furnitureFrontDraft}
                onApply={applyFurnitureFront}
                onCancel={cancelFurnitureFront}
                onDraftChange={(action) =>
                  setFurnitureFrontDraft((current) =>
                    current ? reduceFurnitureFrontDraft(current, action) : current,
                  )
                }
              />
            </PanelSection>
          </PanelWrapper>
        )
      }

      return (
        <PanelWrapper
          icon="/icons/item.webp"
          onBack={() => setFurnitureNavigation((current) => ({ ...current, tierId: null }))}
          onClose={close}
          title={`Tier ${tierIndex + 1}`}
          width={320}
        >
          <div className="px-1 pb-2 text-[11px] text-muted-foreground">
            Bay {bayIndex + 1} → Tier {tierIndex + 1}
          </div>
          <PanelSection title="Tier">
            <div className="space-y-2 px-1 pb-2">
              {adjacentTier ? (
                <SliderControl
                  label="Height"
                  max={metersToLinearUnit(activeTier.height + adjacentTier.height - 0.05, unit)}
                  min={metersToLinearUnit(0.05, unit)}
                  onChange={(value) =>
                    updateFurniture(
                      resizeFurnitureTier(furniture, {
                        bayId: activeBay.id,
                        tierId: activeTier.id,
                        height: linearControlValueToMeters(value, unit, {
                          minMeters: 0.05,
                          maxMeters: activeTier.height + adjacentTier.height - 0.05,
                        }),
                      }),
                    )
                  }
                  precision={2}
                  step={unit === 'imperial' ? 0.1 : 0.01}
                  unit={unitLabel}
                  value={metersToLinearUnit(activeTier.height, unit)}
                />
              ) : null}
              <div className="flex gap-2">
                <ActionButton
                  label="Interior"
                  onClick={() => {
                    setFurnitureDraft({
                      shelfCount: activeTier.shelves.count,
                      hanger: activeTier.hanger,
                    })
                    setFurnitureNavigation((current) => ({ ...current, editingInterior: true }))
                  }}
                />
                <ActionButton
                  label="Front"
                  onClick={() => {
                    setFurnitureFrontDraft(activeTier.front)
                    setFurnitureNavigation((current) => ({ ...current, editingFront: true }))
                  }}
                />
              </div>
              <div className="flex gap-2">
                <ActionButton
                  label="Insert tier after"
                  onClick={() =>
                    updateFurniture(
                      insertFurnitureTier(furniture, {
                        bayId: activeBay.id,
                        afterTierId: activeTier.id,
                      }),
                    )
                  }
                />
                <ActionButton
                  disabled={activeBay.tiers.length === 1}
                  label="Delete tier"
                  onClick={() => {
                    updateFurniture(
                      deleteFurnitureTier(furniture, {
                        bayId: activeBay.id,
                        tierId: activeTier.id,
                      }),
                    )
                    setFurnitureNavigation((current) => ({ ...current, tierId: null }))
                  }}
                />
              </div>
            </div>
          </PanelSection>
        </PanelWrapper>
      )
    }

    if (activeBay && furnitureNavigation.bayId && !furnitureNavigation.tierId) {
      const bayIndex = furniture.bays.findIndex((bay) => bay.id === activeBay.id)
      const adjacentBay = furniture.bays[bayIndex + 1] ?? furniture.bays[bayIndex - 1]
      return (
        <PanelWrapper
          icon="/icons/item.webp"
          onBack={() => setFurnitureNavigation(INITIAL_FURNITURE_NAVIGATION)}
          onClose={close}
          title={`Bay ${bayIndex + 1}`}
          width={320}
        >
          <div className="px-1 pb-2 text-[11px] text-muted-foreground">Bay {bayIndex + 1}</div>
          <PanelSection title="Bay">
            <div className="space-y-2 px-1 pb-2">
              {adjacentBay ? (
                <SliderControl
                  label="Width"
                  max={metersToLinearUnit(activeBay.width + adjacentBay.width - 0.05, unit)}
                  min={metersToLinearUnit(0.05, unit)}
                  onChange={(value) =>
                    updateFurniture(
                      resizeFurnitureBay(furniture, {
                        bayId: activeBay.id,
                        width: linearControlValueToMeters(value, unit, {
                          minMeters: 0.05,
                          maxMeters: activeBay.width + adjacentBay.width - 0.05,
                        }),
                      }),
                    )
                  }
                  precision={2}
                  step={unit === 'imperial' ? 0.1 : 0.01}
                  unit={unitLabel}
                  value={metersToLinearUnit(activeBay.width, unit)}
                />
              ) : null}
              <div className="flex gap-2">
                <ActionButton
                  label="Insert bay after"
                  onClick={() =>
                    updateFurniture(insertFurnitureBay(furniture, { afterBayId: activeBay.id }))
                  }
                />
                <ActionButton
                  disabled={furniture.bays.length === 1}
                  label="Delete bay"
                  onClick={() => {
                    updateFurniture(deleteFurnitureBay(furniture, { bayId: activeBay.id }))
                    setFurnitureNavigation(INITIAL_FURNITURE_NAVIGATION)
                  }}
                />
              </div>
            </div>
          </PanelSection>
          <PanelSection title="Tiers">
            <div className="flex flex-col gap-2 px-1 pb-2">
              {activeBay.tiers.map((tier, index) => (
                <button
                  className={PRESET_BUTTON_CLASS}
                  key={tier.id}
                  onClick={() =>
                    setFurnitureNavigation((current) => ({
                      ...current,
                      tierId: tier.id,
                      editingInterior: false,
                    }))
                  }
                  type="button"
                >
                  <span>Tier {index + 1}</span>
                  <span className="text-muted-foreground">
                    {metersToLinearUnit(tier.height, unit).toFixed(2)} {unitLabel}
                  </span>
                </button>
              ))}
            </div>
          </PanelSection>
        </PanelWrapper>
      )
    }

    return (
      <PanelWrapper
        icon="/icons/item.webp"
        onClose={close}
        title={node.name || 'Furniture Assembly'}
        width={320}
      >
        <PanelSection title="Furniture type">
          <div className="px-1 pb-2">
            <SegmentedControl
              onChange={(value) =>
                updateFurniture(setFurnitureKind(furniture, value as FurnitureKind))
              }
              options={FURNITURE_KIND_OPTIONS}
              value={furniture.furnitureKind}
            />
          </div>
        </PanelSection>
        <PanelSection title="Overall dimensions">
          {(['width', 'height', 'depth'] as const).map((key) => (
            <SliderControl
              key={key}
              label={key[0]?.toUpperCase() + key.slice(1)}
              max={metersToLinearUnit(key === 'width' ? 10 : 4, unit)}
              min={metersToLinearUnit(key === 'width' ? 0.3 : 0.1, unit)}
              onChange={(value) => updateFurnitureDimension(key, value)}
              precision={2}
              step={unit === 'imperial' ? 0.1 : 0.01}
              unit={unitLabel}
              value={metersToLinearUnit(furniture.dimensions[key], unit)}
            />
          ))}
        </PanelSection>
        <PanelSection title="Bays">
          <div className="flex flex-col gap-2 px-1 pb-2">
            {furniture.bays.map((bay, index) => (
              <button
                className={PRESET_BUTTON_CLASS}
                key={bay.id}
                onClick={() =>
                  setFurnitureNavigation({
                    bayId: bay.id,
                    tierId: null,
                    editingInterior: false,
                    editingFront: false,
                  })
                }
                type="button"
              >
                <span>Bay {index + 1}</span>
                <span className="text-muted-foreground">
                  {metersToLinearUnit(bay.width, unit).toFixed(2)} {unitLabel}
                </span>
              </button>
            ))}
          </div>
        </PanelSection>
      </PanelWrapper>
    )
  }

  return (
    <PanelWrapper
      icon="/icons/item.webp"
      onBack={node.type === 'cabinet-module' ? backToRun : undefined}
      onClose={close}
      title={node.name || 'Modular Cabinet'}
      width={320}
    >
      {node.type === 'cabinet' && !node.furniture && (
        <PanelSection title="Furniture Builder">
          <div className="px-1 pb-2">
            <ActionButton
              label="Use furniture assembly"
              onClick={() => updateFurniture(createDefaultFurnitureAssembly())}
            />
          </div>
        </PanelSection>
      )}
      {node.type === 'cabinet-module' && parentRun?.type === 'cabinet' && (
        <PanelSection title="Presets">
          <div className="grid grid-cols-2 gap-2 px-1 pb-2">
            {CABINET_PRESETS.map((preset) => (
              <button
                className={PRESET_BUTTON_CLASS}
                key={preset.id}
                onClick={() => applyPreset(preset.id)}
                type="button"
              >
                <span className="truncate">{preset.label}</span>
              </button>
            ))}
          </div>
        </PanelSection>
      )}

      <PanelSection title="Dimensions">
        <SliderControl
          label="Width"
          max={3}
          min={0.3}
          onChange={(value) => updateNode({ width: value })}
          precision={2}
          step={0.05}
          unit="m"
          value={node.width}
        />
        {!isHoodOnlyNode && (
          <>
            <SliderControl
              label="Depth"
              max={1.2}
              min={0.3}
              onChange={(value) => updateNode({ depth: value })}
              precision={2}
              step={0.01}
              unit="m"
              value={node.depth}
            />
            <SliderControl
              label="Carcass height"
              max={
                node.type === 'cabinet-module' && resolveCabinetType(node, parentRun) === 'tall'
                  ? 2.4
                  : 1.4
              }
              min={
                node.type === 'cabinet-module'
                  ? Math.max(0.4, minCabinetCarcassHeightForStack(node))
                  : 0.4
              }
              onChange={(value) => updateNode({ carcassHeight: value })}
              precision={2}
              step={0.01}
              unit="m"
              value={node.carcassHeight}
            />
          </>
        )}
      </PanelSection>

      {node.type === 'cabinet-module' && parentRun?.type === 'cabinet' && !isHoodOnlyNode && (
        <PanelSection title="Cabinet Type">
          <div className="space-y-2 px-1 pb-2">
            <SegmentedControl
              onChange={(value) => {
                if (value === 'tall') {
                  switchToTall()
                  return
                }
                switchToBase()
              }}
              options={CABINET_TIER_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={resolveCabinetType(node, parentRun)}
            />
            {resolveCabinetType(node, parentRun) === 'base' &&
              (hasWallCabinet ? (
                <ActionButton label="Remove wall cabinet" onClick={removeWallCabinet} />
              ) : (
                <>
                  <ActionButton label="Add wall cabinet" onClick={addWallCabinetAbove} />
                  <ActionButton label="Add chimney" onClick={addHoodAbove} />
                </>
              ))}
          </div>
        </PanelSection>
      )}

      {!isHoodOnlyNode && (
        <PanelSection title="Open Animation">
          <div className="flex items-center gap-2 px-1">
            <div className="min-w-0 flex-1">
              <SliderControl
                label="Open"
                max={100}
                min={0}
                onChange={(value) => {
                  if (isAnimating) stopAnimation()
                  updateNode({ operationState: value / 100 })
                }}
                step={1}
                unit="%"
                value={Math.round((node.operationState ?? 0) * 100)}
              />
            </div>
            <button
              aria-label={
                isAnimating
                  ? 'Stop animation'
                  : (node.operationState ?? 0) >= 0.99
                    ? 'Close cabinet'
                    : 'Open cabinet'
              }
              className="flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-border/40 bg-[#2C2C2E] px-2.5 text-[11px] font-medium text-foreground transition-colors hover:bg-[#3e3e3e]"
              onClick={() => {
                if (isAnimating) {
                  stopAnimation()
                  return
                }
                animateOperationState((node.operationState ?? 0) >= 0.99 ? 0 : 1)
              }}
              title={
                isAnimating
                  ? 'Stop animation'
                  : (node.operationState ?? 0) >= 0.99
                    ? 'Close cabinet'
                    : 'Play animation'
              }
              type="button"
            >
              {isAnimating ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              <span>
                {isAnimating ? 'Stop' : (node.operationState ?? 0) >= 0.99 ? 'Close' : 'Play'}
              </span>
            </button>
          </div>
        </PanelSection>
      )}

      <PanelSection title="Compartments">
        <div className="flex flex-col gap-2 px-1 pb-2">
          {rows.map(({ compartment, index }, displayIndex) => (
            <CompartmentCard
              allowHood={isWallChildModule}
              wallCabinet={isWallChildModule}
              compartment={compartment}
              carcassHeight={node.carcassHeight}
              displayIndex={displayIndex}
              index={index}
              key={compartment.id}
              onMove={(delta) => moveCompartment(index, delta)}
              onRemove={() => removeAt(index)}
              onReplace={(next) => replaceAt(index, next)}
              onResizeHeight={(height) => resizeAt(index, height)}
              resolvedHeight={
                rowHeights.get(index) ?? node.carcassHeight / Math.max(stack.length, 1)
              }
              total={rows.length}
              width={node.width}
            />
          ))}
        </div>
        <div className="px-1 pb-1">
          <ActionButton
            icon={<Plus className="h-4 w-4" />}
            label="Add compartment"
            onClick={addCompartment}
          />
        </div>
      </PanelSection>

      {!isHoodOnlyNode && (
        <>
          <PanelSection title="Fronts">
            <div className="space-y-2 px-1 pb-2">
              <div>
                <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Style
                </div>
                <SegmentedControl
                  onChange={(value) =>
                    updateNode({ frontStyle: value as CabinetNodeType['frontStyle'] })
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
                    updateNode({ frontOverlay: value as CabinetNodeType['frontOverlay'] })
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
                    updateNode({ handleStyle: value as CabinetNodeType['handleStyle'] })
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
                      updateNode({ handlePosition: value as CabinetNodeType['handlePosition'] })
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
        </>
      )}
    </PanelWrapper>
  )
}

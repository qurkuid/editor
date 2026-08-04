'use client'

import type {
  AnyNodeId,
  CabinetModuleNode as CabinetModuleNodeType,
  CabinetNode as CabinetNodeType,
  FurnitureAssembly,
  FurnitureFace,
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
import type { MessageId } from '@pascal-app/editor'
import {
  ActionButton,
  formatLinearMeasurement,
  getLinearUnitLabel,
  linearControlValueToMeters,
  metersToLinearUnit,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  translate,
  useLocale,
  useT,
  useTLabel,
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

const HANDLE_STYLE_OPTIONS = (t: (key: MessageId) => string) =>
  [
    { value: 'bar', label: t('panel.bar') },
    { value: 'knob', label: t('panel.knob') },
    { value: 'cutout', label: t('panel.cutout') },
    { value: 'hole', label: t('panel.hole') },
    { value: 'none', label: t('panel.none') },
  ] as const

const HANDLE_POSITION_OPTIONS = (t: (key: MessageId) => string) =>
  [
    { value: 'auto', label: t('panel.auto') },
    { value: 'top', label: t('panel.top') },
    { value: 'center', label: t('panel.center') },
  ] as const

const FRONT_OVERLAY_OPTIONS = (t: (key: MessageId) => string) =>
  [
    { value: 'full', label: t('panel.overlay') },
    { value: 'inset', label: t('panel.inset') },
  ] as const

const FRONT_STYLE_OPTIONS = (t: (key: MessageId) => string) =>
  [
    { value: 'slab', label: t('panel.slab') },
    { value: 'shaker', label: t('panel.shaker') },
    { value: 'raised-arch', label: t('panel.raisedArch') },
  ] as const

const CABINET_TIER_OPTIONS = (t: (key: MessageId) => string) =>
  [
    { value: 'base', label: t('panel.baseCabinet') },
    { value: 'tall', label: t('panel.tallCabinet') },
  ] as const

const FURNITURE_KIND_OPTIONS = (
  t: (key: MessageId) => string,
): Array<{ value: FurnitureKind; label: string }> => [
  { value: 'wardrobe', label: t('panel.wardrobe') },
  { value: 'base-run', label: t('panel.base') },
  { value: 'upper-run', label: t('panel.upper') },
  { value: 'tall', label: t('panel.tall') },
  { value: 'island', label: t('panel.island') },
  { value: 'set', label: t('panel.set') },
  { value: 'sink', label: t('panel.sink') },
]

const FURNITURE_FRONT_KIND_OPTIONS = (
  t: (key: MessageId) => string,
): Array<{ value: FurnitureFront['kind']; label: string }> => [
  { value: 'open', label: t('panel.open') },
  { value: 'hinged', label: t('panel.hinged') },
  { value: 'drawer', label: t('panel.drawer') },
  { value: 'flap', label: t('panel.flap') },
  { value: 'sliding', label: t('panel.sliding') },
  { value: 'pull-out', label: t('panel.pullOut') },
]

const FURNITURE_HINGED_LEAVES_OPTIONS = (t: (key: MessageId) => string) =>
  [
    { value: '1', label: t('panel.1Leaf') },
    { value: '2', label: t('panel.2Leaves') },
  ] as const

const FURNITURE_SLIDING_LEAVES_OPTIONS = [
  { value: '2', label: '2' },
  { value: '3', label: '3' },
  { value: '4', label: '4' },
] as const

const FURNITURE_FLAP_DIRECTION_OPTIONS = (t: (key: MessageId) => string) =>
  [
    { value: 'up', label: t('panel.up') },
    { value: 'down', label: t('panel.down') },
  ] as const

const FURNITURE_PULL_OUT_STYLE_OPTIONS = (t: (key: MessageId) => string) =>
  [
    { value: 'standard', label: t('panel.standard') },
    { value: 'spice', label: t('panel.spice') },
    { value: 'pantry', label: t('panel.pantry') },
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
  face: FurnitureFace
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
  face: 'front',
}

const FURNITURE_FACE_OPTIONS = (
  t: (key: MessageId) => string,
): Array<{ value: FurnitureFace; label: string }> => [
  { value: 'front', label: t('panel.front') },
  { value: 'back', label: t('panel.back') },
]

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
  // Snapshot translator: these controls are invoked as plain functions in
  // panel.test.tsx, so no hooks; the parent panel re-renders on locale change.
  const t = (key: MessageId) => translate(key, useLocale.getState().locale)
  return (
    <div className="space-y-3 px-1 pb-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs">{t('panel.shelfCount')}</span>
        <div className="flex items-center gap-1 rounded-md border border-border/50 p-1">
          <button
            aria-label={t('panel.decreaseShelfCount')}
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
            aria-label={t('panel.increaseShelfCount')}
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
        <span>{t('panel.hangerRod')}</span>
        <span className="text-muted-foreground">
          {draft.hanger ? t('chrome.on') : t('chrome.off')}
        </span>
      </button>
      <div className="flex gap-2">
        <ActionButton label={t('chrome.cancel')} onClick={onCancel} />
        <ActionButton label={t('panel.apply')} onClick={onApply} />
      </div>
      <p className="text-[10px] text-muted-foreground">{t('panel.enterToApplyEscapeToCancel')}</p>
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
  // Snapshot translator: these controls are invoked as plain functions in
  // panel.test.tsx, so no hooks; the parent panel re-renders on locale change.
  const t = (key: MessageId) => translate(key, useLocale.getState().locale)
  return (
    <div className="space-y-3 px-1 pb-2">
      <div>
        <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          {t('panel.kind')}
        </div>
        <SegmentedControl
          onChange={(value) =>
            onDraftChange({ type: 'setKind', kind: value as FurnitureFront['kind'] })
          }
          options={FURNITURE_FRONT_KIND_OPTIONS(t)}
          value={draft.kind}
        />
      </div>
      {draft.kind === 'hinged' && (
        <>
          <div>
            <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {t('panel.leaves')}
            </div>
            <SegmentedControl
              onChange={(value) => onDraftChange({ type: 'setLeaves', leaves: Number(value) })}
              options={FURNITURE_HINGED_LEAVES_OPTIONS(t).map((option) => ({
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
            <span>{t('panel.glass')}</span>
            <span className="text-muted-foreground">
              {draft.glass ? t('chrome.on') : t('chrome.off')}
            </span>
          </button>
        </>
      )}
      {draft.kind === 'drawer' && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs">{t('panel.drawerCount')}</span>
          <div className="flex items-center gap-1 rounded-md border border-border/50 p-1">
            <button
              aria-label={t('panel.decreaseDrawerCount')}
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
              aria-label={t('panel.increaseDrawerCount')}
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
            {t('panel.direction')}
          </div>
          <SegmentedControl
            onChange={(value) =>
              onDraftChange({ type: 'setFlapDirection', direction: value as 'up' | 'down' })
            }
            options={FURNITURE_FLAP_DIRECTION_OPTIONS(t).map((option) => ({
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
            {t('panel.leaves')}
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
            {t('panel.style')}
          </div>
          <SegmentedControl
            onChange={(value) =>
              onDraftChange({
                type: 'setPullOutStyle',
                style: value as 'standard' | 'spice' | 'pantry',
              })
            }
            options={FURNITURE_PULL_OUT_STYLE_OPTIONS(t).map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            value={draft.style}
          />
        </div>
      )}
      <div className="flex gap-2">
        <ActionButton label={t('chrome.cancel')} onClick={onCancel} />
        <ActionButton label={t('panel.apply')} onClick={onApply} />
      </div>
      <p className="text-[10px] text-muted-foreground">{t('panel.enterToApplyEscapeToCancel')}</p>
    </div>
  )
}

export default function CabinetPanel() {
  const t = useT()
  const tLabel = useTLabel()
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const setSelection = useViewer((s) => s.setSelection)
  const unit = useViewer((s) => s.unit)
  const metricNotation = useViewer((state) => state.metricNotation)
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
  const activeFace = furnitureNavigation.face
  // Islands carry cabinetry on both faces (see backBays/depthSplit in the
  // schema) — the front/back switch below only makes sense once a back row
  // actually exists to edit independently.
  const isTwoSidedIsland =
    selectedFurniture?.furnitureKind === 'island' && (selectedFurniture.backBays?.length ?? 0) > 0
  const activeFaceBays =
    activeFace === 'back' ? (selectedFurniture?.backBays ?? []) : (selectedFurniture?.bays ?? [])
  const activeBay = activeFaceBays.find((bay) => bay.id === furnitureNavigation.bayId)
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
      face: furnitureNavigation.face,
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
      face: furnitureNavigation.face,
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
      const bayIndex = activeFaceBays.findIndex((bay) => bay.id === activeBay.id)
      const tierIndex = activeBay.tiers.findIndex((tier) => tier.id === activeTier.id)
      const adjacentTier = activeBay.tiers[tierIndex + 1] ?? activeBay.tiers[tierIndex - 1]

      if (furnitureNavigation.editingInterior && furnitureDraft) {
        return (
          <PanelWrapper
            icon="/icons/item.webp"
            onBack={cancelFurnitureInterior}
            onClose={close}
            title={`${t('panel.tierN').replace('{n}', String(tierIndex + 1))} ${t('panel.interior')}`}
            width={320}
          >
            <div className="px-1 pb-2 text-[11px] text-muted-foreground">
              {t('panel.bayN').replace('{n}', String(bayIndex + 1))} →{' '}
              {t('panel.tierN').replace('{n}', String(tierIndex + 1))} → {t('panel.interior')}
            </div>
            <PanelSection title={t('panel.interior')}>
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
            title={`${t('panel.tierN').replace('{n}', String(tierIndex + 1))} ${t('panel.front')}`}
            width={320}
          >
            <div className="px-1 pb-2 text-[11px] text-muted-foreground">
              {t('panel.bayN').replace('{n}', String(bayIndex + 1))} →{' '}
              {t('panel.tierN').replace('{n}', String(tierIndex + 1))} → {t('panel.front')}
            </div>
            <PanelSection title={t('panel.front')}>
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
          title={t('panel.tierN').replace('{n}', String(tierIndex + 1))}
          width={320}
        >
          <div className="px-1 pb-2 text-[11px] text-muted-foreground">
            {t('panel.bayN').replace('{n}', String(bayIndex + 1))} →{' '}
            {t('panel.tierN').replace('{n}', String(tierIndex + 1))}
          </div>
          <PanelSection title={t('panel.tier')}>
            <div className="space-y-2 px-1 pb-2">
              {adjacentTier ? (
                <SliderControl
                  label={t('common.height')}
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
                        face: activeFace,
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
                  label={t('panel.interior')}
                  onClick={() => {
                    setFurnitureDraft({
                      shelfCount: activeTier.shelves.count,
                      hanger: activeTier.hanger,
                    })
                    setFurnitureNavigation((current) => ({ ...current, editingInterior: true }))
                  }}
                />
                <ActionButton
                  label={t('panel.front')}
                  onClick={() => {
                    setFurnitureFrontDraft(activeTier.front)
                    setFurnitureNavigation((current) => ({ ...current, editingFront: true }))
                  }}
                />
              </div>
              <div className="flex gap-2">
                <ActionButton
                  label={t('panel.insertTierAfter')}
                  onClick={() =>
                    updateFurniture(
                      insertFurnitureTier(furniture, {
                        bayId: activeBay.id,
                        afterTierId: activeTier.id,
                        face: activeFace,
                      }),
                    )
                  }
                />
                <ActionButton
                  disabled={activeBay.tiers.length === 1}
                  label={t('panel.deleteTier')}
                  onClick={() => {
                    updateFurniture(
                      deleteFurnitureTier(furniture, {
                        bayId: activeBay.id,
                        tierId: activeTier.id,
                        face: activeFace,
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
      const bayIndex = activeFaceBays.findIndex((bay) => bay.id === activeBay.id)
      const adjacentBay = activeFaceBays[bayIndex + 1] ?? activeFaceBays[bayIndex - 1]
      return (
        <PanelWrapper
          icon="/icons/item.webp"
          onBack={() =>
            setFurnitureNavigation((current) => ({
              ...INITIAL_FURNITURE_NAVIGATION,
              face: current.face,
            }))
          }
          onClose={close}
          title={`Bay ${bayIndex + 1}`}
          width={320}
        >
          <div className="px-1 pb-2 text-[11px] text-muted-foreground">Bay {bayIndex + 1}</div>
          <PanelSection title={t('panel.bay')}>
            <div className="space-y-2 px-1 pb-2">
              {adjacentBay ? (
                <SliderControl
                  label={t('panel.width')}
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
                        face: activeFace,
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
                  label={t('panel.insertBayAfter')}
                  onClick={() =>
                    updateFurniture(
                      insertFurnitureBay(furniture, { afterBayId: activeBay.id, face: activeFace }),
                    )
                  }
                />
                <ActionButton
                  disabled={activeFaceBays.length === 1}
                  label={t('panel.deleteBay')}
                  onClick={() => {
                    updateFurniture(
                      deleteFurnitureBay(furniture, { bayId: activeBay.id, face: activeFace }),
                    )
                    setFurnitureNavigation((current) => ({
                      ...INITIAL_FURNITURE_NAVIGATION,
                      face: current.face,
                    }))
                  }}
                />
              </div>
            </div>
          </PanelSection>
          <PanelSection title={t('panel.tiers')}>
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
                  <span>{t('panel.tierN').replace('{n}', String(index + 1))}</span>
                  <span className="text-muted-foreground">
                    {formatLinearMeasurement(tier.height, unit, metricNotation)}
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
        title={tLabel(node.name || 'Furniture Assembly')}
        width={320}
      >
        <PanelSection title={t('panel.furnitureType')}>
          <div className="px-1 pb-2">
            <SegmentedControl
              onChange={(value) =>
                updateFurniture(setFurnitureKind(furniture, value as FurnitureKind))
              }
              options={FURNITURE_KIND_OPTIONS(t)}
              value={furniture.furnitureKind}
            />
          </div>
        </PanelSection>
        <PanelSection title={t('panel.overallDimensions')}>
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
        <PanelSection title={t('panel.openAnimation')}>
          <div className="flex items-center gap-2 px-1">
            <div className="min-w-0 flex-1">
              <SliderControl
                label={t('panel.open')}
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
                  ? t('panel.stopAnimation')
                  : (node.operationState ?? 0) >= 0.99
                    ? t('panel.closeCabinet')
                    : t('panel.openCabinet')
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
                  ? t('panel.stopAnimation')
                  : (node.operationState ?? 0) >= 0.99
                    ? t('panel.closeCabinet')
                    : t('panel.playAnimation')
              }
              type="button"
            >
              {isAnimating ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              <span>
                {isAnimating
                  ? t('panel.stop')
                  : (node.operationState ?? 0) >= 0.99
                    ? t('common.close')
                    : t('panel.play')}
              </span>
            </button>
          </div>
        </PanelSection>
        {isTwoSidedIsland && (
          <PanelSection title={t('panel.face')}>
            <div className="px-1 pb-2">
              <SegmentedControl
                onChange={(value) =>
                  setFurnitureNavigation((current) => ({
                    ...INITIAL_FURNITURE_NAVIGATION,
                    face: value as FurnitureFace,
                  }))
                }
                options={FURNITURE_FACE_OPTIONS(t)}
                value={activeFace}
              />
            </div>
          </PanelSection>
        )}
        <PanelSection title={t('panel.bays')}>
          <div className="mb-2 flex items-center justify-between gap-3 px-1">
            <span className="text-xs">{t('panel.bayCount')}</span>
            <div className="flex items-center gap-1 rounded-md border border-border/50 p-1">
              <button
                aria-label={t('panel.removeLastBay')}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground disabled:opacity-40"
                disabled={activeFaceBays.length === 1}
                onClick={() => {
                  const lastBay = activeFaceBays[activeFaceBays.length - 1]
                  if (!lastBay) return
                  updateFurniture(
                    deleteFurnitureBay(furniture, { bayId: lastBay.id, face: activeFace }),
                  )
                }}
                type="button"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span aria-live="polite" className="w-5 text-center text-xs">
                {activeFaceBays.length}
              </span>
              <button
                aria-label={t('panel.addBay')}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-[#3e3e3e] hover:text-foreground"
                onClick={() => {
                  const lastBay = activeFaceBays[activeFaceBays.length - 1]
                  if (!lastBay) return
                  updateFurniture(
                    insertFurnitureBay(furniture, { afterBayId: lastBay.id, face: activeFace }),
                  )
                }}
                type="button"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2 px-1 pb-2">
            {activeFaceBays.map((bay, index) => (
              <button
                className={PRESET_BUTTON_CLASS}
                key={bay.id}
                onClick={() =>
                  setFurnitureNavigation({
                    bayId: bay.id,
                    tierId: null,
                    editingInterior: false,
                    editingFront: false,
                    face: activeFace,
                  })
                }
                type="button"
              >
                <span>{t('panel.bayN').replace('{n}', String(index + 1))}</span>
                <span className="text-muted-foreground">
                  {formatLinearMeasurement(bay.width, unit, metricNotation)}
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
      title={tLabel(node.name || 'Modular Cabinet')}
      width={320}
    >
      {node.type === 'cabinet' && !node.furniture && (
        <PanelSection title={t('panel.furnitureBuilder')}>
          <div className="px-1 pb-2">
            <ActionButton
              label={t('panel.useFurnitureAssembly')}
              onClick={() => updateFurniture(createDefaultFurnitureAssembly())}
            />
          </div>
        </PanelSection>
      )}
      {node.type === 'cabinet-module' && parentRun?.type === 'cabinet' && (
        <PanelSection title={t('panel.presets')}>
          <div className="grid grid-cols-2 gap-2 px-1 pb-2">
            {CABINET_PRESETS.map((preset) => (
              <button
                className={PRESET_BUTTON_CLASS}
                key={preset.id}
                onClick={() => applyPreset(preset.id)}
                type="button"
              >
                <span className="truncate">{tLabel(preset.label)}</span>
              </button>
            ))}
          </div>
        </PanelSection>
      )}

      <PanelSection title={t('panel.dimensions')}>
        <SliderControl
          label={t('panel.width')}
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
              label={t('panel.depth')}
              max={1.2}
              min={0.3}
              onChange={(value) => updateNode({ depth: value })}
              precision={2}
              step={0.01}
              unit="m"
              value={node.depth}
            />
            <SliderControl
              label={t('panel.carcassHeight')}
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
        <PanelSection title={t('panel.cabinetType')}>
          <div className="space-y-2 px-1 pb-2">
            <SegmentedControl
              onChange={(value) => {
                if (value === 'tall') {
                  switchToTall()
                  return
                }
                switchToBase()
              }}
              options={CABINET_TIER_OPTIONS(t).map((option) => ({
                value: option.value,
                label: option.label,
              }))}
              value={resolveCabinetType(node, parentRun)}
            />
            {resolveCabinetType(node, parentRun) === 'base' &&
              (hasWallCabinet ? (
                <ActionButton label={t('panel.removeWallCabinet')} onClick={removeWallCabinet} />
              ) : (
                <>
                  <ActionButton label={t('panel.addWallCabinet')} onClick={addWallCabinetAbove} />
                  <ActionButton label={t('panel.addChimney')} onClick={addHoodAbove} />
                </>
              ))}
          </div>
        </PanelSection>
      )}

      {!isHoodOnlyNode && (
        <PanelSection title={t('panel.openAnimation')}>
          <div className="flex items-center gap-2 px-1">
            <div className="min-w-0 flex-1">
              <SliderControl
                label={t('panel.open')}
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
                  ? t('panel.stopAnimation')
                  : (node.operationState ?? 0) >= 0.99
                    ? t('panel.closeCabinet')
                    : t('panel.openCabinet')
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
                  ? t('panel.stopAnimation')
                  : (node.operationState ?? 0) >= 0.99
                    ? t('panel.closeCabinet')
                    : t('panel.playAnimation')
              }
              type="button"
            >
              {isAnimating ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              <span>
                {isAnimating
                  ? t('panel.stop')
                  : (node.operationState ?? 0) >= 0.99
                    ? t('common.close')
                    : t('panel.play')}
              </span>
            </button>
          </div>
        </PanelSection>
      )}

      <PanelSection title={t('panel.compartments')}>
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
            label={t('panel.addCompartment')}
            onClick={addCompartment}
          />
        </div>
      </PanelSection>

      {!isHoodOnlyNode && (
        <>
          <PanelSection title={t('panel.fronts')}>
            <div className="space-y-2 px-1 pb-2">
              <div>
                <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Style
                </div>
                <SegmentedControl
                  onChange={(value) =>
                    updateNode({ frontStyle: value as CabinetNodeType['frontStyle'] })
                  }
                  options={FRONT_STYLE_OPTIONS(t).map((option) => ({
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
                  options={FRONT_OVERLAY_OPTIONS(t).map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  value={node.frontOverlay ?? 'full'}
                />
              </div>
            </div>
          </PanelSection>

          <PanelSection title={t('panel.handles')}>
            <div className="space-y-2 px-1 pb-2">
              <div>
                <div className="px-1 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Style
                </div>
                <SegmentedControl
                  onChange={(value) =>
                    updateNode({ handleStyle: value as CabinetNodeType['handleStyle'] })
                  }
                  options={HANDLE_STYLE_OPTIONS(t).map((option) => ({
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
                    options={HANDLE_POSITION_OPTIONS(t).map((option) => ({
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

'use client'

import {
  type AnyNode,
  type AnyNodeId,
  getCatalogMaterialById,
  getLibraryMaterialIdFromRef,
  getSceneMaterialIdFromRef,
  type ZoneNode,
} from '@pascal-app/core'
import {
  applyHomeFinishTemplate,
  applyMaterialToCapturedZoneTarget,
  applyZoneFinishTemplate,
  type CapturedZoneFinishTarget,
  captureZoneFinishTemplate,
  commitZoneFinishApply,
  createHomeFinishTemplate,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  type HomeFinishTemplate,
  inspectZoneFinishTarget,
  type PortableMaterialSnapshot,
  useEditor,
  useScene,
  useViewer,
  type ZoneFinishError,
  type ZoneFinishInspection,
  type ZoneFinishTemplateSnapshot,
} from '@pascal-app/editor'
import {
  Check,
  ChevronDown,
  House,
  ImagePlus,
  Paintbrush,
  RefreshCw,
  RotateCw,
  Star,
  Upload,
} from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  type FinishTemplateMeta,
  type FinishTemplateVisibility,
  useFinishTemplates,
} from '@/lib/finish-template-store'
import {
  type CatalogMaterialSelection,
  FavoriteMaterialsGrid,
  MergedMaterialCatalog,
} from './paint-catalog'

type CatalogView = 'materials' | 'favorites' | 'scene'
type ApplyKind = 'walls' | 'ceiling' | 'floor'

type DialogTarget = {
  kind: ApplyKind
  materialsRef: ReturnType<typeof useScene.getState>['materials']
  nodesRef: ReturnType<typeof useScene.getState>['nodes']
  target: CapturedZoneFinishTarget
  zoneId: string
  sceneToken?: string
}

type CeilingInspection = {
  target: CapturedZoneFinishTarget
  status: 'existing' | 'creatable' | 'blocked'
  ceilingId?: string
  explicit: boolean
  reason?: string
  conflictIds?: string[]
}

type ZoneMappingState = {
  kind: 'zone'
  template: ZoneFinishTemplateSnapshot
  targetZoneId: string
  wallMapping: Record<string, string>
  uniformMaterial?: PortableMaterialSnapshot
}

type HomeMappingState = {
  kind: 'home'
  template: HomeFinishTemplate
  zoneMapping: Record<string, string>
  wallMappings: Record<string, Record<string, string>>
  uniformWallMaterials: Record<string, PortableMaterialSnapshot>
}

type MappingState = ZoneMappingState | HomeMappingState

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background'

function sceneToken(): string | undefined {
  if (typeof window === 'undefined') return undefined
  return window.location.pathname.match(/^\/scene\/([^/]+)/)?.[1]
}

function roomLabel(zone: ZoneNode, zones: readonly ZoneNode[]): string {
  const sameName = zones.filter((candidate) => candidate.name === zone.name)
  const suffix = sameName.length > 1 ? ` · ${sameName.indexOf(zone) + 1}` : ''
  return zone.roomNumber.trim()
    ? `${zone.name}${suffix} · ${zone.roomNumber}`
    : `${zone.name}${suffix}`
}

function selectedRoomZone(
  nodes: Record<string, AnyNode>,
  selectedIds: readonly string[],
  selectedZoneId: string | null,
): ZoneNode | null {
  const candidateId =
    selectedIds.length === 1 ? selectedIds[0] : selectedIds.length === 0 ? selectedZoneId : null
  if (!candidateId) return null

  const candidate = nodes[candidateId]
  return candidate?.type === 'zone' && candidate.spaceRole === 'room' ? candidate : null
}

function materialLabelForRef(
  ref: string | undefined,
  materials: Record<string, { name: string }>,
): string | null {
  if (!ref) return null
  const sceneId = getSceneMaterialIdFromRef(ref)
  if (sceneId) return materials[sceneId]?.name ?? null
  const libraryId = getLibraryMaterialIdFromRef(ref)
  if (!libraryId) return null
  return getCatalogMaterialById(libraryId)?.label ?? null
}

function materialRefForNode(node: AnyNode | undefined, role: string): string | undefined {
  if (!node || !('slots' in node) || !node.slots) return undefined
  return node.slots[role]
}

function materialPreviewForRef(
  ref: string | undefined,
  materials: Record<
    string,
    { material: { properties?: { color?: string }; texture?: { url?: string } } }
  >,
): { color?: string; imageUrl?: string } | null {
  if (!ref) return null
  const sceneId = getSceneMaterialIdFromRef(ref)
  if (sceneId) {
    const material = materials[sceneId]?.material
    if (!material) return null
    return { color: material.properties?.color, imageUrl: material.texture?.url }
  }
  const libraryId = getLibraryMaterialIdFromRef(ref)
  const catalog = libraryId ? getCatalogMaterialById(libraryId) : undefined
  if (!catalog) return null
  return { color: catalog.previewColor, imageUrl: catalog.previewThumbnailUrl }
}

function uniqueSnapshots(values: readonly PortableMaterialSnapshot[]) {
  const seen = new Set<string>()
  return values.filter((value) => {
    const key = JSON.stringify(value)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function templateMaterialOptions(template: ZoneFinishTemplateSnapshot) {
  return uniqueSnapshots(template.walls.flatMap((wall) => wall.slots.map((slot) => slot.material)))
}

function errorMessage(error: ZoneFinishError | Error | unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return '마감 자재를 적용하지 못했습니다.'
}

function templateStatusLabel(meta: FinishTemplateMeta | undefined): string {
  if (!meta) return '로컬 · 가져오기 대기'
  if (meta.status === 'saving') return '저장 중'
  if (meta.status === 'failed') return '실패 · 재시도'
  if (meta.imported) return meta.visibility === 'company' ? '가져옴 · 회사' : '가져옴 · 나만'
  if (meta.source === 'server') {
    return meta.visibility === 'company' ? '서버 · 회사' : '서버 · 나만'
  }
  return '로컬 · 가져오기 대기'
}

function rowStatus(
  inspection: ZoneFinishInspection | null,
  kind: ApplyKind,
  explicitFloor: boolean,
  ceiling: CeilingInspection | null,
): 'complete' | 'pending' | 'blocked' {
  if (kind === 'walls') {
    if (!inspection || inspection.boundaryError) return 'blocked'
    return inspection.completion.missing.length === 0 ? 'complete' : 'pending'
  }
  if (kind === 'floor') {
    if (!inspection || inspection.floor.status === 'blocked') return 'blocked'
    return explicitFloor ? 'complete' : 'pending'
  }
  if (!ceiling || ceiling.status === 'blocked') return 'blocked'
  return ceiling.explicit ? 'complete' : 'pending'
}

function ZoneFinishRow({
  detail,
  label,
  onClick,
  status,
  rowRef,
  swatch,
}: {
  detail: string
  label: string
  onClick: () => void
  status: 'complete' | 'pending' | 'blocked'
  rowRef: React.RefObject<HTMLButtonElement | null>
  swatch?: { color?: string; imageUrl?: string } | null
}) {
  const statusLabel = status === 'complete' ? '완료' : status === 'blocked' ? '확인 필요' : '미완료'
  return (
    <button
      aria-label={`${label}: ${detail}`}
      className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${focusRing} ${
        status === 'blocked'
          ? 'border-amber-500/35 bg-amber-500/5'
          : 'border-border/70 bg-background/50 hover:border-primary/60 hover:bg-sidebar-accent'
      }`}
      onClick={onClick}
      ref={rowRef}
      type="button"
    >
      <span
        aria-hidden="true"
        className={`h-2 w-2 shrink-0 rounded-full ${
          status === 'complete'
            ? 'bg-emerald-500'
            : status === 'blocked'
              ? 'bg-amber-500'
              : 'bg-muted-foreground/50'
        }`}
      />
      <span
        aria-hidden="true"
        className="h-5 w-5 shrink-0 rounded border border-border/70 bg-muted"
        style={{
          backgroundColor: swatch?.color ?? undefined,
          backgroundImage: swatch?.imageUrl ? `url(${swatch.imageUrl})` : undefined,
          backgroundPosition: 'center',
          backgroundSize: 'cover',
        }}
      />
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-xs">{label}</span>
        <span className="block truncate text-[10px] text-muted-foreground">{detail}</span>
      </span>
      <span className="shrink-0 text-[10px] text-muted-foreground">{statusLabel}</span>
    </button>
  )
}

function TemplateNameForm({
  detail,
  disabled,
  label,
  onVisibilityChange,
  onSubmit,
  visibility,
}: {
  detail: string
  disabled?: boolean
  label: string
  onVisibilityChange: (visibility: FinishTemplateVisibility) => void
  onSubmit: (name: string, visibility: FinishTemplateVisibility) => Promise<void>
  visibility: FinishTemplateVisibility
}) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    try {
      await onSubmit(name.trim(), visibility)
      setName('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <form className="mt-2 flex gap-1.5" onSubmit={submit}>
      <label className="sr-only" htmlFor={`finish-template-name-${label}`}>
        {label}
      </label>
      <input
        className="min-w-0 flex-1 rounded-md border border-border/70 bg-background px-2 py-1.5 text-[11px] outline-none focus:border-primary"
        id={`finish-template-name-${label}`}
        onChange={(event) => setName(event.target.value)}
        placeholder={label}
        value={name}
      />
      <label className="sr-only" htmlFor={`finish-template-visibility-${label}`}>
        {label} 공개 범위
      </label>
      <select
        aria-label={`${label} 공개 범위`}
        className="rounded-md border border-border/70 bg-background px-1.5 py-1.5 text-[11px] outline-none focus:border-primary"
        id={`finish-template-visibility-${label}`}
        onChange={(event) => onVisibilityChange(event.target.value as FinishTemplateVisibility)}
        value={visibility}
      >
        <option value="private">나만</option>
        <option value="company">회사</option>
      </select>
      <button
        className={`rounded-md border border-border/70 px-2 py-1.5 font-medium text-[11px] ${focusRing}`}
        disabled={busy || disabled || !name.trim()}
        type="submit"
      >
        저장
      </button>
      {disabled ? <span className="sr-only">{detail}</span> : null}
    </form>
  )
}

export function ZoneFinishInspectorFooter({ embedded = false }: { embedded?: boolean } = {}) {
  const nodes = useScene((state) => state.nodes)
  const materials = useScene((state) => state.materials)
  const spaces = useEditor((state) => state.spaces)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const selectedZoneId = useViewer((state) => state.selection.zoneId)
  const textures = useViewer((state) => state.textures)
  const selectedZone = selectedRoomZone(nodes, selectedIds, selectedZoneId)
  const allZones = useMemo(
    () =>
      Object.values(nodes).filter(
        (node): node is ZoneNode => node.type === 'zone' && node.spaceRole === 'room',
      ),
    [nodes],
  )
  const currentSceneToken = sceneToken()
  const templates = useFinishTemplates((state) => state.zoneTemplates)
  const homeTemplates = useFinishTemplates((state) => state.homeTemplates)
  const localZoneTemplates = useFinishTemplates((state) => state.localZoneTemplates)
  const localHomeTemplates = useFinishTemplates((state) => state.localHomeTemplates)
  const confirmedZoneTemplateIds = useFinishTemplates((state) => state.confirmedZoneTemplateIds)
  const confirmedHomeTemplateIds = useFinishTemplates((state) => state.confirmedHomeTemplateIds)
  const templateMeta = useFinishTemplates((state) => state.templateMeta)
  const serverLoaded = useFinishTemplates((state) => state.serverLoaded)
  const serverError = useFinishTemplates((state) => state.serverError)
  const serverErrorStatus = useFinishTemplates((state) => state.serverErrorStatus)
  const refreshTemplates = useFinishTemplates((state) => state.refreshTemplates)
  const importLegacyTemplates = useFinishTemplates((state) => state.importLegacyTemplates)
  const saveZoneTemplateRemote = useFinishTemplates((state) => state.saveZoneTemplate)
  const saveHomeTemplateRemote = useFinishTemplates((state) => state.saveHomeTemplate)
  const retryTemplate = useFinishTemplates((state) => state.retryTemplate)
  const [catalogView, setCatalogView] = useState<CatalogView>('materials')
  const [dialogTarget, setDialogTarget] = useState<DialogTarget | null>(null)
  const [dialogBusy, setDialogBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [zoneVisibility, setZoneVisibility] = useState<FinishTemplateVisibility>('private')
  const [homeVisibility, setHomeVisibility] = useState<FinishTemplateVisibility>('private')
  const [mapping, setMapping] = useState<MappingState | null>(null)
  const rowRefs = useRef<Record<ApplyKind, React.RefObject<HTMLButtonElement | null>>>({
    walls: { current: null },
    ceiling: { current: null },
    floor: { current: null },
  })
  const mountedRef = useRef(false)
  const activeDialogRef = useRef<DialogTarget | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      activeDialogRef.current = null
    }
  }, [])

  useEffect(() => {
    void refreshTemplates()
  }, [refreshTemplates])

  useEffect(() => {
    const active = activeDialogRef.current
    if (!active) return
    const selection = useViewer.getState().selection
    const currentZone = selectedRoomZone(nodes, selection.selectedIds, selection.zoneId)
    if (selectedZone?.id !== active.zoneId || currentZone?.id !== active.zoneId) {
      activeDialogRef.current = null
      setDialogTarget(null)
      setDialogBusy(false)
    }
  }, [nodes, selectedZone])

  const common = useMemo(
    () => ({
      nodes,
      materials,
      spaces,
      ...(currentSceneToken ? { sceneId: currentSceneToken } : {}),
    }),
    [currentSceneToken, materials, nodes, spaces],
  )

  const wallInspection = useMemo(() => {
    if (selectedZone?.spaceRole !== 'room') return null
    return inspectZoneFinishTarget({ zoneId: selectedZone.id, kind: 'walls', ...common })
  }, [common, selectedZone])
  const floorInspection = useMemo(() => {
    if (selectedZone?.spaceRole !== 'room') return null
    return inspectZoneFinishTarget({ zoneId: selectedZone.id, kind: 'floor', ...common })
  }, [common, selectedZone])
  const ceilingInspection = useMemo<CeilingInspection | null>(() => {
    if (selectedZone?.spaceRole !== 'room') return null
    const inspection = inspectZoneFinishTarget({
      zoneId: selectedZone.id,
      kind: 'ceiling',
      ...common,
    })
    return { ...inspection.ceiling, target: inspection.target }
  }, [common, selectedZone])

  const floorNode = useMemo(() => {
    if (floorInspection?.floor.status !== 'existing') return null
    return nodes[floorInspection.floor.slabId as AnyNodeId]
  }, [floorInspection, nodes])
  const floorRef = materialRefForNode(floorNode ?? undefined, 'surface')
  const explicitFloor = floorInspection?.completion.missing.length === 0
  const floorLabel = materialLabelForRef(floorRef, materials) ?? '미지정 · 선택 시 생성'

  const wallLabels = useMemo(
    () =>
      wallInspection
        ? wallInspection.materialRefs
            .map((ref) => materialLabelForRef(ref, materials))
            .filter((label): label is string => Boolean(label))
        : [],
    [materials, wallInspection],
  )
  const wallRef = wallInspection?.materialRefs[0]
  const wallSwatch = materialPreviewForRef(wallRef, materials)
  const wallDetail = !wallInspection
    ? '마감 대상을 찾을 수 없습니다.'
    : wallInspection.boundaryError
      ? '방 경계에서 벽 분할이 필요합니다.'
      : wallInspection.completion.missing.length > 0
        ? `${wallInspection.completion.missing.length}면 미지정`
        : wallLabels.length === 1
          ? (wallLabels[0] ?? '자재 1종')
          : `${wallLabels.length || wallInspection.materialCount}종 자재`
  const ceilingNode =
    ceilingInspection?.status === 'existing'
      ? nodes[ceilingInspection.ceilingId as AnyNodeId]
      : undefined
  const ceilingRef = materialRefForNode(ceilingNode, 'surface')
  const ceilingLabel =
    ceilingInspection?.explicit && ceilingRef
      ? (materialLabelForRef(ceilingRef, materials) ?? '천장 자재')
      : '미지정 · 선택 시 생성'
  const floorSwatch = materialPreviewForRef(floorRef, materials)
  const ceilingSwatch = materialPreviewForRef(ceilingRef, materials)
  const ceilingDetail =
    ceilingInspection?.status === 'blocked'
      ? (ceilingInspection.reason ?? '천장 정리가 필요합니다.')
      : ceilingLabel
  const zoneWallReady = Boolean(
    wallInspection &&
      !wallInspection.boundaryError &&
      wallInspection.completion.missing.length === 0,
  )
  const zoneFloorReady = Boolean(
    floorInspection &&
      floorInspection.floor.status !== 'blocked' &&
      floorInspection.completion.missing.length === 0,
  )
  const zoneReady = zoneWallReady && zoneFloorReady
  const zoneCompletionDetail = `벽 ${wallInspection?.completion.explicit ?? 0}/${wallInspection?.completion.total ?? 0} · 바닥 ${zoneFloorReady ? '1/1' : '0/1'}`
  const homeCompletion = useMemo(() => {
    let complete = 0
    for (const zone of allZones) {
      const walls = inspectZoneFinishTarget({ zoneId: zone.id, kind: 'walls', ...common })
      const floor = inspectZoneFinishTarget({ zoneId: zone.id, kind: 'floor', ...common })
      if (
        !walls.boundaryError &&
        walls.completion.missing.length === 0 &&
        floor.completion.missing.length === 0
      ) {
        complete += 1
      }
    }
    return { complete, total: allZones.length }
  }, [allZones, common])
  const homeReady = homeCompletion.total > 0 && homeCompletion.complete === homeCompletion.total

  const showError = useCallback((value: unknown) => {
    if (!mountedRef.current) return
    setError(errorMessage(value))
    setMessage(null)
  }, [])

  const openMaterialDialog = useCallback(
    (kind: ApplyKind) => {
      if (!selectedZone) return
      if (kind === 'walls' && wallInspection?.boundaryError) {
        showError(wallInspection.boundaryError.message)
        return
      }
      if (kind === 'floor' && floorInspection?.floor.status === 'blocked') {
        showError(floorInspection.floor.reason)
        return
      }
      if (kind === 'ceiling' && ceilingInspection?.status === 'blocked') {
        showError(ceilingInspection.reason ?? '천장 정리가 필요합니다.')
        return
      }
      if (kind === 'ceiling' && !ceilingInspection?.target) {
        showError('천장 대상을 읽지 못했습니다.')
        return
      }
      const inspection =
        kind === 'walls' ? wallInspection : kind === 'floor' ? floorInspection : null
      const target = kind === 'ceiling' ? ceilingInspection?.target : inspection?.target
      if (!target) {
        showError('마감 대상을 찾을 수 없습니다.')
        return
      }
      setError(null)
      setMessage(null)
      setCatalogView('materials')
      const nextTarget: DialogTarget = {
        kind,
        materialsRef: materials,
        nodesRef: nodes,
        sceneToken: currentSceneToken,
        target: { ...target, kind },
        zoneId: selectedZone.id,
      }
      activeDialogRef.current = nextTarget
      setDialogTarget(nextTarget)
    },
    [
      ceilingInspection,
      currentSceneToken,
      floorInspection,
      materials,
      nodes,
      selectedZone,
      showError,
      wallInspection,
    ],
  )

  const closeDialog = useCallback(() => {
    if (dialogBusy) return
    const kind = dialogTarget?.kind
    activeDialogRef.current = null
    setDialogTarget(null)
    if (kind) window.setTimeout(() => rowRefs.current[kind].current?.focus(), 0)
  }, [dialogBusy, dialogTarget?.kind])

  const applyCatalogSelection = useCallback(
    async (selection: CatalogMaterialSelection) => {
      const captured = dialogTarget
      if (!captured || dialogBusy) return
      const capturedZoneName = selectedZone?.name ?? 'Zone'
      setDialogBusy(true)
      setError(null)
      try {
        const currentSelection = useViewer.getState().selection
        const currentNodes = useScene.getState().nodes
        const currentZone = selectedRoomZone(
          currentNodes,
          currentSelection.selectedIds,
          currentSelection.zoneId,
        )
        if (
          !mountedRef.current ||
          activeDialogRef.current !== captured ||
          currentZone?.id !== captured.zoneId
        ) {
          throw new Error('방 또는 마감 대상이 바뀌어 자재를 적용하지 않았습니다.')
        }
        if (captured.sceneToken !== sceneToken()) {
          throw new Error('장면이 바뀌어 자재를 적용하지 않았습니다.')
        }
        if (
          currentNodes !== captured.nodesRef ||
          useScene.getState().materials !== captured.materialsRef
        ) {
          throw new Error('장면의 마감 대상이 바뀌어 자재를 적용하지 않았습니다.')
        }
        const latest = inspectZoneFinishTarget({
          zoneId: captured.zoneId,
          kind: captured.kind,
          nodes: useScene.getState().nodes,
          materials: useScene.getState().materials,
          spaces: useEditor.getState().spaces,
        })
        if (latest.target.fingerprint !== captured.target.fingerprint) {
          throw new Error('Zone 마감 대상이 바뀌어 자재를 적용하지 않았습니다.')
        }
        const result = applyMaterialToCapturedZoneTarget({
          target: captured.target,
          material: selection.material,
          materialLabel: selection.materialLabel,
          materialPreset: selection.materialPreset,
          nodes: useScene.getState().nodes,
          materials: useScene.getState().materials,
          spaces: useEditor.getState().spaces,
        })
        if (!result.ok) throw result
        if (!mountedRef.current || activeDialogRef.current !== captured) {
          throw new Error('자재 선택 창이 닫혀 적용을 취소했습니다.')
        }
        const committed = commitZoneFinishApply(result.plan)
        if (!committed.ok) throw committed
        if (!mountedRef.current) return
        activeDialogRef.current = null
        setDialogTarget(null)
        setMessage(
          `${capturedZoneName} · ${captured.kind === 'walls' ? '전체 벽면' : captured.kind === 'ceiling' ? '천장' : '바닥'}에 적용했습니다. Undo 한 번으로 되돌릴 수 있습니다.`,
        )
        window.setTimeout(() => rowRefs.current[captured.kind].current?.focus(), 0)
      } catch (cause) {
        showError(cause)
      } finally {
        if (mountedRef.current) setDialogBusy(false)
      }
    },
    [dialogBusy, dialogTarget, selectedZone?.name, showError],
  )

  const saveZoneTemplate = useCallback(
    async (name: string, visibility: FinishTemplateVisibility) => {
      if (!selectedZone || !zoneReady) return
      const result = captureZoneFinishTemplate({ zoneId: selectedZone.id, name, ...common })
      if (!('version' in result)) {
        showError(result)
        return
      }
      const saved = await saveZoneTemplateRemote(result, visibility)
      if (!saved.ok) {
        showError(new Error(saved.error))
        return
      }
      setMessage(
        visibility === 'company'
          ? '회사 Zone 템플릿을 서버에 저장했습니다.'
          : '나만 보는 Zone 템플릿을 서버에 저장했습니다.',
      )
      setError(null)
    },
    [common, saveZoneTemplateRemote, selectedZone, showError, zoneReady],
  )

  const saveHomeTemplate = useCallback(
    async (name: string, visibility: FinishTemplateVisibility) => {
      if (!homeReady) return
      const entries: Array<{
        sourceZoneId: string
        sourceZoneName: string
        template: ZoneFinishTemplateSnapshot
      }> = []
      for (const zone of allZones) {
        const result = captureZoneFinishTemplate({ zoneId: zone.id, name: zone.name, ...common })
        if (!('version' in result)) {
          showError(result)
          return
        }
        entries.push({
          sourceZoneId: zone.id,
          sourceZoneName: roomLabel(zone, allZones),
          template: result,
        })
      }
      const result = createHomeFinishTemplate({
        name,
        sourceSceneId: currentSceneToken,
        templates: entries,
      })
      if (!('version' in result)) {
        showError(result)
        return
      }
      const saved = await saveHomeTemplateRemote(result, visibility)
      if (!saved.ok) {
        showError(new Error(saved.error))
        return
      }
      setMessage(
        visibility === 'company'
          ? `현재 집의 ${entries.length}개 방 조합을 회사 서버에 저장했습니다.`
          : `현재 집의 ${entries.length}개 방 조합을 나만 보는 서버 템플릿으로 저장했습니다.`,
      )
      setError(null)
    },
    [allZones, common, currentSceneToken, homeReady, saveHomeTemplateRemote, showError],
  )

  const startZoneMapping = useCallback(
    (template: ZoneFinishTemplateSnapshot) => {
      if (!selectedZone) return
      setMapping({
        kind: 'zone',
        template,
        targetZoneId: selectedZone.id,
        wallMapping: {},
      })
    },
    [selectedZone],
  )

  const applyZoneTemplateDirect = useCallback(
    (template: ZoneFinishTemplateSnapshot) => {
      if (!selectedZone) return
      const result = applyZoneFinishTemplate({
        template,
        targetZoneId: selectedZone.id,
        ...common,
      })
      if (!result.ok) {
        if (result.code === 'mapping-required' || result.code === 'mapping-incomplete') {
          startZoneMapping(template)
          setMessage('원본과 대상 벽면을 직접 연결하세요.')
        } else {
          showError(result)
        }
        return
      }
      const committed = commitZoneFinishApply(result.plan)
      if (!committed.ok) {
        showError(committed)
        return
      }
      setMessage('Zone 템플릿을 한 번의 작업으로 적용했습니다.')
      setError(null)
    },
    [common, selectedZone, showError, startZoneMapping],
  )

  const applyZoneTemplateNow = useCallback(() => {
    if (mapping?.kind !== 'zone') return
    const result = applyZoneFinishTemplate({
      template: mapping.template,
      targetZoneId: mapping.targetZoneId,
      wallMapping: mapping.wallMapping,
      uniformWallMaterial: mapping.uniformMaterial,
      ...common,
    })
    if (!result.ok) {
      showError(result)
      return
    }
    const committed = commitZoneFinishApply(result.plan)
    if (!committed.ok) {
      showError(committed)
      return
    }
    setMapping(null)
    setMessage('Zone 템플릿을 한 번의 작업으로 적용했습니다.')
  }, [common, mapping, showError])

  const startHomeMapping = useCallback(
    (template: HomeFinishTemplate, zoneMapping: Record<string, string> = {}) => {
      setMapping({
        kind: 'home',
        template,
        zoneMapping,
        wallMappings: {},
        uniformWallMaterials: {},
      })
    },
    [],
  )

  const applyHomeTemplateDirect = useCallback(
    (template: HomeFinishTemplate) => {
      const sameScene = Boolean(
        template.sourceSceneId && currentSceneToken && template.sourceSceneId === currentSceneToken,
      )
      const exactZoneMapping =
        sameScene &&
        template.zones.every((entry) => {
          const node = nodes[entry.sourceZoneId as AnyNodeId]
          return node?.type === 'zone' && node.spaceRole === 'room'
        })
          ? Object.fromEntries(
              template.zones.map((entry) => [entry.sourceZoneId, entry.sourceZoneId]),
            )
          : null
      if (!exactZoneMapping) {
        startHomeMapping(template)
        setMessage('집 템플릿의 source room과 target room을 직접 연결하세요.')
        return
      }
      const result = applyHomeFinishTemplate({ template, zoneMapping: exactZoneMapping, ...common })
      if (!result.ok) {
        startHomeMapping(template, exactZoneMapping)
        setMessage('집 템플릿의 벽면 연결을 직접 확인하세요.')
        return
      }
      const committed = commitZoneFinishApply(result.plan)
      if (!committed.ok) {
        showError(committed)
        return
      }
      setMessage('집 템플릿을 한 번의 작업으로 적용했습니다.')
      setError(null)
    },
    [common, currentSceneToken, nodes, showError, startHomeMapping],
  )

  const applyHomeTemplateNow = useCallback(() => {
    if (mapping?.kind !== 'home') return
    if (Object.keys(mapping.zoneMapping).length !== mapping.template.zones.length) {
      showError(new Error('집 템플릿의 모든 방을 대상 방에 직접 연결하세요.'))
      return
    }
    const result = applyHomeFinishTemplate({
      template: mapping.template,
      zoneMapping: mapping.zoneMapping,
      wallMappings: mapping.wallMappings,
      uniformWallMaterials: mapping.uniformWallMaterials,
      ...common,
    })
    if (!result.ok) {
      showError(result)
      return
    }
    const committed = commitZoneFinishApply(result.plan)
    if (!committed.ok) {
      showError(committed)
      return
    }
    setMapping(null)
    setMessage('집 템플릿을 한 번의 작업으로 적용했습니다.')
  }, [common, mapping, showError])

  const refreshTemplateLibrary = useCallback(async () => {
    const result = await refreshTemplates()
    if (!result.ok) {
      showError(new Error(result.error))
      return
    }
    if (result.stale) return
    setMessage('서버 템플릿 목록을 새로고침했습니다.')
    setError(null)
  }, [refreshTemplates, showError])

  const importLocalTemplates = useCallback(async () => {
    const result = await importLegacyTemplates('private')
    if (!result.ok) {
      showError(new Error(result.error))
      return
    }
    setMessage(
      result.imported
        ? `${result.imported}개 로컬 템플릿을 서버에 가져왔습니다.`
        : '새로 가져올 로컬 템플릿이 없습니다.',
    )
    setError(null)
  }, [importLegacyTemplates, showError])

  const retryTemplateSave = useCallback(
    async (kind: 'zone' | 'home', id: string) => {
      const result = await retryTemplate(kind, id)
      if (!result.ok) {
        showError(new Error(result.error))
        return
      }
      setMessage('실패한 템플릿 저장을 다시 시도했습니다.')
      setError(null)
    },
    [retryTemplate, showError],
  )

  if (selectedZone?.spaceRole !== 'room') return null

  const zoneTemplateList = Object.values(templates)
  const homeTemplateList = Object.values(homeTemplates)
  const localTemplateCount =
    Object.keys(localZoneTemplates).filter(
      (id) => !confirmedZoneTemplateIds[id] && !templateMeta[`zone:${id}`]?.serverId,
    ).length +
    Object.keys(localHomeTemplates).filter(
      (id) => !confirmedHomeTemplateIds[id] && !templateMeta[`home:${id}`]?.serverId,
    ).length
  const renderTargetRow = (kind: ApplyKind) => {
    const inspection = kind === 'walls' ? wallInspection : kind === 'floor' ? floorInspection : null
    const detail = kind === 'walls' ? wallDetail : kind === 'floor' ? floorLabel : ceilingDetail
    const ceiling = kind === 'ceiling' ? ceilingInspection : null
    return (
      <ZoneFinishRow
        detail={detail}
        key={kind}
        label={kind === 'walls' ? '전체 벽면' : kind === 'ceiling' ? '천장' : '바닥'}
        onClick={() => openMaterialDialog(kind)}
        rowRef={rowRefs.current[kind]}
        status={rowStatus(inspection, kind, explicitFloor, ceiling)}
        swatch={kind === 'walls' ? wallSwatch : kind === 'floor' ? floorSwatch : ceilingSwatch}
      />
    )
  }

  return (
    <section
      {...(!embedded ? { 'aria-labelledby': 'zone-finish-inspector-title' } : {})}
      className={embedded ? 'px-0 py-0' : 'border-t border-border/70 bg-sidebar px-3 py-2'}
    >
      {!embedded ? (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 className="truncate font-semibold text-xs" id="zone-finish-inspector-title">
              실제 마감 자재
            </h2>
            <p className="truncate text-[10px] text-muted-foreground">
              {roomLabel(selectedZone, allZones)}
            </p>
          </div>
          <button
            aria-expanded={templateOpen}
            aria-label="Zone 템플릿 열기"
            className={`rounded-md border border-border/70 p-1.5 text-muted-foreground hover:text-foreground ${focusRing}`}
            onClick={() => setTemplateOpen((open) => !open)}
            type="button"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${templateOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      ) : null}
      {embedded ? (
        <div className="flex justify-end">
          <button
            aria-expanded={templateOpen}
            aria-label="Zone 템플릿 열기"
            className={`rounded-md border border-border/70 p-1.5 text-muted-foreground hover:text-foreground ${focusRing}`}
            onClick={() => setTemplateOpen((open) => !open)}
            type="button"
          >
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${templateOpen ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      ) : null}
      <div className="mt-2 grid gap-1.5">
        {(['walls', 'ceiling', 'floor'] as const).map(renderTargetRow)}
      </div>
      {!textures ? (
        <button
          className={`mt-2 w-full rounded-md border border-border/70 px-2 py-1.5 text-left text-[10px] text-muted-foreground hover:text-foreground ${focusRing}`}
          onClick={() => useViewer.getState().setTextures(true)}
          type="button"
        >
          단색 표시 중 · 자재 색상 보기
        </button>
      ) : null}
      {error ? (
        <p className="mt-1.5 text-[10px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mt-1.5 text-[10px] text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
      {templateOpen ? (
        <div className="subtle-scrollbar mt-2 max-h-56 overflow-y-auto rounded-lg border border-border/70 bg-background/30 p-2">
          <div className="flex items-center justify-end gap-1">
            <button
              aria-label="서버 템플릿 새로고침"
              className={`rounded border border-border/70 p-1 text-muted-foreground hover:text-foreground ${focusRing}`}
              onClick={() => void refreshTemplateLibrary()}
              type="button"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
            <button
              aria-label="로컬 템플릿 가져오기"
              className={`flex items-center gap-1 rounded border border-border/70 px-1.5 py-1 text-[10px] text-muted-foreground hover:text-foreground ${focusRing}`}
              disabled={!serverLoaded || localTemplateCount === 0}
              onClick={() => void importLocalTemplates()}
              type="button"
            >
              <Upload className="h-3 w-3" />
              가져오기
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Paintbrush className="h-3 w-3" />
            <span>완료된 방 조합을 저장하고 다른 방/집에 명시적으로 적용합니다.</span>
          </div>
          {serverError ? (
            <p className="mt-1 text-[10px] text-destructive" role="status">
              {serverErrorStatus === 401 || serverErrorStatus === 403
                ? '서버 템플릿 접근 권한을 확인할 수 없어 로컬 초안만 표시 중입니다.'
                : '서버 목록이 최신이 아니어서 이전 템플릿을 표시 중입니다.'}
            </p>
          ) : null}
          <p className="mt-2 text-[10px] text-muted-foreground">
            이 방 저장 조건 · {zoneCompletionDetail}
          </p>
          <p className="mt-0.5 text-[10px] text-muted-foreground">
            집 저장 조건 · {homeCompletion.complete}/{homeCompletion.total}개 방 완료
          </p>
          <TemplateNameForm
            detail={zoneCompletionDetail}
            disabled={!zoneReady}
            label="Zone 템플릿 이름"
            onVisibilityChange={setZoneVisibility}
            onSubmit={saveZoneTemplate}
            visibility={zoneVisibility}
          />
          <TemplateNameForm
            detail={`${homeCompletion.complete}/${homeCompletion.total}개 방 완료`}
            disabled={!homeReady}
            label="집 템플릿 이름"
            onVisibilityChange={setHomeVisibility}
            onSubmit={saveHomeTemplate}
            visibility={homeVisibility}
          />
          {zoneTemplateList.length > 0 ? (
            <div className="mt-2 grid gap-1">
              <p className="text-[10px] font-medium text-muted-foreground">Zone 템플릿</p>
              {zoneTemplateList.map((template) => (
                <div className="flex items-center gap-1" key={template.id}>
                  <button
                    className={`flex min-w-0 flex-1 items-center justify-between rounded-md border border-border/70 px-2 py-1.5 text-left text-[10px] hover:bg-sidebar-accent ${focusRing}`}
                    onClick={() => applyZoneTemplateDirect(template)}
                    type="button"
                  >
                    <span className="min-w-0 truncate">
                      {template.name} ·{' '}
                      {template.source.zoneId === selectedZone.id ? '현재 방' : '다른 방 조합'}
                    </span>
                    <span className="ml-1 flex shrink-0 items-center gap-1 text-muted-foreground">
                      <span>{templateStatusLabel(templateMeta[`zone:${template.id}`])}</span>
                      <Check className="h-3 w-3" />
                    </span>
                  </button>
                  {templateMeta[`zone:${template.id}`]?.status === 'failed' ? (
                    <button
                      aria-label={`${template.name} 저장 재시도`}
                      className={`rounded border border-border/70 p-1.5 text-muted-foreground hover:text-foreground ${focusRing}`}
                      onClick={() => void retryTemplateSave('zone', template.id)}
                      type="button"
                    >
                      <RotateCw className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {homeTemplateList.length > 0 ? (
            <div className="mt-2 grid gap-1">
              <p className="text-[10px] font-medium text-muted-foreground">집 템플릿</p>
              {homeTemplateList.map((template) => (
                <div className="flex items-center gap-1" key={template.id}>
                  <button
                    className={`flex min-w-0 flex-1 items-center justify-between rounded-md border border-border/70 px-2 py-1.5 text-left text-[10px] hover:bg-sidebar-accent ${focusRing}`}
                    onClick={() => applyHomeTemplateDirect(template)}
                    type="button"
                  >
                    <span className="min-w-0 truncate">
                      {template.name} · {template.zones.length}개 방 조합
                    </span>
                    <span className="ml-1 flex shrink-0 items-center gap-1 text-muted-foreground">
                      <span>{templateStatusLabel(templateMeta[`home:${template.id}`])}</span>
                      <House className="h-3 w-3" />
                    </span>
                  </button>
                  {templateMeta[`home:${template.id}`]?.status === 'failed' ? (
                    <button
                      aria-label={`${template.name} 저장 재시도`}
                      className={`rounded border border-border/70 p-1.5 text-muted-foreground hover:text-foreground ${focusRing}`}
                      onClick={() => void retryTemplateSave('home', template.id)}
                      type="button"
                    >
                      <RotateCw className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
          {mapping?.kind === 'zone' ? (
            <ZoneMappingEditor
              mapping={mapping}
              nodes={nodes}
              onCancel={() => setMapping(null)}
              onChange={setMapping}
              onSubmit={applyZoneTemplateNow}
            />
          ) : null}
          {mapping?.kind === 'home' ? (
            <HomeMappingEditor
              allZones={allZones}
              mapping={mapping}
              nodes={nodes}
              onCancel={() => setMapping(null)}
              onChange={setMapping}
              onSubmit={applyHomeTemplateNow}
            />
          ) : null}
        </div>
      ) : null}

      <Dialog open={dialogTarget !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent
          className={`flex max-h-[82vh] flex-col overflow-hidden p-0 ${dialogTarget?.kind === 'walls' ? 'sm:max-w-3xl' : 'sm:max-w-xl'}`}
          onEscapeKeyDown={(event) => {
            if (dialogBusy) event.preventDefault()
          }}
        >
          <DialogHeader className="border-b border-border/70 px-4 py-3 text-left">
            <DialogTitle className="text-sm">
              {dialogTarget?.kind === 'walls'
                ? '전체 벽면'
                : dialogTarget?.kind === 'ceiling'
                  ? '천장'
                  : '바닥'}{' '}
              자재 선택
            </DialogTitle>
            <DialogDescription className="text-[11px]">
              자재를 한 번 선택하면 현재 Zone의 선택한 부위에 적용됩니다. 취소하면 장면은 바뀌지
              않습니다.
            </DialogDescription>
          </DialogHeader>
          <div className="flex shrink-0 gap-1 px-4 pt-3">
            <button
              className={`flex-1 rounded-md px-2 py-1.5 text-xs ${catalogView === 'materials' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'} ${focusRing}`}
              onClick={() => setCatalogView('materials')}
              type="button"
            >
              자재
            </button>
            <button
              className={`flex-1 rounded-md px-2 py-1.5 text-xs ${catalogView === 'favorites' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'} ${focusRing}`}
              onClick={() => setCatalogView('favorites')}
              type="button"
            >
              <Star className="mr-1 inline h-3 w-3" />
              즐겨찾기
            </button>
            <button
              aria-label="내 자재"
              className={`flex w-9 items-center justify-center rounded-md ${catalogView === 'scene' ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'} ${focusRing}`}
              onClick={() => setCatalogView('scene')}
              type="button"
            >
              <ImagePlus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="subtle-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2">
            {catalogView === 'materials' ? (
              <MergedMaterialCatalog
                columns={dialogTarget?.kind === 'walls' ? 4 : undefined}
                onSelectMaterial={applyCatalogSelection}
              />
            ) : catalogView === 'favorites' ? (
              <FavoriteMaterialsGrid
                columns={dialogTarget?.kind === 'walls' ? 4 : undefined}
                onSelectMaterial={applyCatalogSelection}
              />
            ) : (
              <MergedMaterialCatalog
                columns={dialogTarget?.kind === 'walls' ? 4 : undefined}
                onSelectMaterial={applyCatalogSelection}
                sceneOnly
              />
            )}
          </div>
          {dialogBusy ? (
            <p
              className="border-t border-border/70 px-4 py-2 text-[10px] text-muted-foreground"
              role="status"
            >
              자재를 적용하는 중…
            </p>
          ) : null}
          {error ? (
            <p
              className="border-t border-border/70 px-4 py-2 text-[10px] text-destructive"
              role="alert"
            >
              {error}
            </p>
          ) : null}
        </DialogContent>
      </Dialog>
    </section>
  )
}

function ZoneMappingEditor({
  mapping,
  nodes,
  onChange,
  onSubmit,
  onCancel,
}: {
  mapping: ZoneMappingState
  nodes: Record<string, AnyNode>
  onChange: (mapping: MappingState) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  const target = inspectZoneFinishTarget({ zoneId: mapping.targetZoneId, kind: 'walls', nodes })
  const options = templateMaterialOptions(mapping.template)
  return (
    <div
      aria-labelledby="zone-mapping-title"
      className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2"
      role="region"
    >
      <h3 className="font-medium text-[10px]" id="zone-mapping-title">
        원본과 대상 벽면 연결
      </h3>
      <p className="mt-1 text-[9px] text-muted-foreground">
        자동 이름 매칭 없이 원본 벽면을 대상 벽면에 직접 지정하세요.
      </p>
      <div className="mt-1.5 grid gap-1.5">
        {mapping.template.walls.map((source, index) => (
          <label className="grid gap-1 text-[9px]" key={source.sourceFace.key}>
            <span>원본 벽면 {index + 1}</span>
            <select
              className="rounded border border-border/70 bg-background px-1.5 py-1 text-[10px]"
              onChange={(event) =>
                onChange({
                  ...mapping,
                  wallMapping: {
                    ...mapping.wallMapping,
                    [source.sourceFace.key]: event.target.value,
                  },
                })
              }
              value={mapping.wallMapping[source.sourceFace.key] ?? ''}
            >
              <option value="">대상 벽면 선택</option>
              {target.wallFaces.map((face) => (
                <option key={face.key} value={face.key}>
                  대상 벽면 {target.wallFaces.indexOf(face) + 1} · {face.length.toFixed(1)}m
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <label className="mt-2 grid gap-1 text-[9px]">
        <span>벽 수가 다르면 사용할 명시적 통일 자재</span>
        <select
          className="rounded border border-border/70 bg-background px-1.5 py-1 text-[10px]"
          onChange={(event) => {
            const selectedIndex = event.target.value ? Number(event.target.value) : -1
            onChange({
              ...mapping,
              uniformMaterial: Number.isInteger(selectedIndex) ? options[selectedIndex] : undefined,
            })
          }}
          value={
            mapping.uniformMaterial
              ? String(
                  options.findIndex(
                    (option) => JSON.stringify(option) === JSON.stringify(mapping.uniformMaterial),
                  ),
                )
              : ''
          }
        >
          <option value="">통일 자재를 사용하지 않음</option>
          {options.map((option, index) => (
            <option key={`${option.label}-${index}`} value={String(index)}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
      <MappingActions onCancel={onCancel} onSubmit={onSubmit} />
    </div>
  )
}

function HomeMappingEditor({
  allZones,
  mapping,
  nodes,
  onChange,
  onSubmit,
  onCancel,
}: {
  allZones: readonly ZoneNode[]
  mapping: HomeMappingState
  nodes: Record<string, AnyNode>
  onChange: (mapping: MappingState) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  return (
    <div
      aria-labelledby="home-mapping-title"
      className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2"
      role="region"
    >
      <h3 className="font-medium text-[10px]" id="home-mapping-title">
        집 템플릿 방 연결
      </h3>
      <p className="mt-1 text-[9px] text-muted-foreground">
        원본 방과 대상 방을 각각 선택하세요. 서로 다른 벽면 자재는 아래에서 직접 연결하거나 전체
        통일 자재를 선택할 수 있습니다.
      </p>
      <div className="mt-1.5 grid gap-1.5">
        {mapping.template.zones.map((entry) => {
          const sourceOptions = templateMaterialOptions(entry.template)
          const targetZoneId = mapping.zoneMapping[entry.sourceZoneId]
          const targetInspection = targetZoneId
            ? inspectZoneFinishTarget({ zoneId: targetZoneId, kind: 'walls', nodes })
            : null
          const wallMappings = mapping.wallMappings[entry.sourceZoneId] ?? {}
          return (
            <div className="rounded border border-border/60 p-1.5" key={entry.sourceZoneId}>
              <label className="grid gap-1 text-[9px]">
                <span>{entry.sourceZoneName} → 대상 방</span>
                <select
                  className="rounded border border-border/70 bg-background px-1.5 py-1 text-[10px]"
                  onChange={(event) =>
                    (() => {
                      const zoneMapping = {
                        ...mapping.zoneMapping,
                        [entry.sourceZoneId]: event.target.value,
                      }
                      const nextWallMappings = { ...mapping.wallMappings }
                      delete nextWallMappings[entry.sourceZoneId]
                      onChange({ ...mapping, zoneMapping, wallMappings: nextWallMappings })
                    })()
                  }
                  value={mapping.zoneMapping[entry.sourceZoneId] ?? ''}
                >
                  <option value="">대상 방 선택</option>
                  {allZones.map((zone) => (
                    <option key={zone.id} value={zone.id}>
                      {roomLabel(zone, allZones)}
                    </option>
                  ))}
                </select>
              </label>
              {targetInspection && entry.template.walls.length > 0 ? (
                <div className="mt-1.5 grid gap-1 rounded border border-border/50 bg-background/30 p-1.5">
                  <p className="text-[9px] font-medium text-muted-foreground">벽면 연결</p>
                  {entry.template.walls.map((source, sourceIndex) => (
                    <label className="grid gap-1 text-[9px]" key={source.sourceFace.key}>
                      <span>원본 벽면 {sourceIndex + 1} → 대상 벽면</span>
                      <select
                        className="rounded border border-border/70 bg-background px-1.5 py-1 text-[10px]"
                        onChange={(event) =>
                          onChange({
                            ...mapping,
                            wallMappings: {
                              ...mapping.wallMappings,
                              [entry.sourceZoneId]: {
                                ...wallMappings,
                                [source.sourceFace.key]: event.target.value,
                              },
                            },
                          })
                        }
                        value={wallMappings[source.sourceFace.key] ?? ''}
                      >
                        <option value="">대상 벽면 선택</option>
                        {targetInspection.wallFaces.map((face, targetIndex) => (
                          <option key={face.key} value={face.key}>
                            대상 벽면 {targetIndex + 1} · {face.length.toFixed(1)}m
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              ) : null}
              <label className="mt-1 grid gap-1 text-[9px]">
                <span>벽면 수 불일치 시 전체 통일 자재</span>
                <select
                  className="rounded border border-border/70 bg-background px-1.5 py-1 text-[10px]"
                  onChange={(event) => {
                    const selectedIndex = event.target.value ? Number(event.target.value) : -1
                    const selected = Number.isInteger(selectedIndex)
                      ? sourceOptions[selectedIndex]
                      : undefined
                    const uniformWallMaterials = { ...mapping.uniformWallMaterials }
                    if (selected) uniformWallMaterials[entry.sourceZoneId] = selected
                    else delete uniformWallMaterials[entry.sourceZoneId]
                    onChange({ ...mapping, uniformWallMaterials })
                  }}
                  value={
                    mapping.uniformWallMaterials[entry.sourceZoneId]
                      ? String(
                          sourceOptions.findIndex(
                            (option) =>
                              JSON.stringify(option) ===
                              JSON.stringify(mapping.uniformWallMaterials[entry.sourceZoneId]),
                          ),
                        )
                      : ''
                  }
                >
                  <option value="">선택하지 않음</option>
                  {sourceOptions.map((option, index) => (
                    <option key={`${option.label}-${index}`} value={String(index)}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )
        })}
      </div>
      <MappingActions onCancel={onCancel} onSubmit={onSubmit} />
    </div>
  )
}

function MappingActions({ onSubmit, onCancel }: { onSubmit: () => void; onCancel: () => void }) {
  return (
    <div className="mt-2 flex justify-end gap-1.5">
      <button
        className={`rounded border border-border/70 px-2 py-1 text-[10px] ${focusRing}`}
        onClick={onCancel}
        type="button"
      >
        취소
      </button>
      <button
        className={`rounded bg-primary px-2 py-1 font-medium text-[10px] text-primary-foreground ${focusRing}`}
        onClick={onSubmit}
        type="button"
      >
        명시 매핑 적용
      </button>
    </div>
  )
}

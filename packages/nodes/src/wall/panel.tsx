'use client'

import {
  type AnyNode,
  type AnyNodeId,
  bestConstructionMaterial,
  buildWallFaceBandCountPatch,
  calculateWallConstructionQuantities,
  createWallBandConstructionPreset,
  detectWallConstructionPreset,
  getClampedWallCurveOffset,
  getDynamicLibraryMaterials,
  getLibraryMaterialsVersion,
  getMaxWallCurveOffset,
  getWallBandConstruction,
  getWallBandSlotId,
  getWallConstructionEnvelopeThickness,
  getWallCurveLength,
  getWallFaceBandConfig,
  normalizeWallBandConstructionToThickness,
  normalizeWallCurveOffset,
  parseMaterialRef,
  type SceneMaterialId,
  subscribeLibraryMaterials,
  useLiveNodeOverrides,
  useScene,
  WALL_CHAIR_RAIL_DEFAULT,
  WALL_CROWN_DEFAULT,
  WALL_FACE_BAND_DEFAULT,
  WALL_SKIRTING_DEFAULT,
  type WallBandConstruction,
  type WallConstructionLayer,
  type WallConstructionPresetId,
  type WallFaceBand,
  type WallNode,
  type WallTrimProfile,
  withBandConstructionMaterials,
} from '@pascal-app/core'
import type { MessageId } from '@pascal-app/editor'
import {
  ActionButton,
  ActionGroup,
  curveReshapeScope,
  freezeHostMaterialCatalogItem,
  getLinearUnitLabel,
  linearControlValueToMeters,
  metersToLinearUnit,
  PanelSection,
  PanelWrapper,
  SegmentedControl,
  SliderControl,
  triggerSFX,
  useInteractionScope,
  useT,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Plus, Spline, Trash2 } from 'lucide-react'
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react'
import { resolveWallOpeningCeiling } from '../shared/wall-opening-ceiling'
import { WALL_LAYER_COLORS } from './construction-visual'
import { wallPaint } from './paint'

type WallTrimKey = 'skirting' | 'crown' | 'chairRail'

const WALL_TRIM_PROFILE_OPTIONS = (
  t: (key: MessageId) => string,
): Record<WallTrimKey, Array<{ label: string; value: WallTrimProfile }>> => ({
  skirting: [
    { label: t('panel.flat'), value: 'flat' },
    { label: t('panel.modern'), value: 'base-modern' },
    { label: t('panel.colonial'), value: 'base-colonial' },
    { label: t('panel.shoe'), value: 'base-shoe' },
    { label: t('panel.ogee'), value: 'base-ogee' },
  ],
  crown: [
    { label: t('panel.flat'), value: 'flat' },
    { label: t('panel.cove'), value: 'crown-cove' },
    { label: t('panel.ogee'), value: 'crown-ogee' },
    { label: t('panel.craft'), value: 'crown-craftsman' },
    { label: t('panel.layered'), value: 'crown-layered' },
  ],
  chairRail: [
    { label: t('panel.flat'), value: 'flat' },
    { label: t('panel.round'), value: 'rail-rounded' },
    { label: t('panel.ogee'), value: 'rail-ogee' },
    { label: t('panel.picture'), value: 'rail-picture' },
    { label: t('panel.step'), value: 'rail-stepped' },
  ],
})

export default function WallPanel() {
  const t = useT()
  const selectedId = useViewer((s) => s.selection.selectedIds[0])
  const unit = useViewer((s) => s.unit)
  const setSelection = useViewer((s) => s.setSelection)

  const sceneNode = useScene((s) =>
    selectedId ? (s.nodes[selectedId as AnyNode['id']] as WallNode | undefined) : undefined,
  )

  // Live override published by the 2D drag handlers (side-arrows /
  // corner dots / curve handle). Merged on top of the scene node so
  // the sliders read the live `start` / `end` / `curveOffset` during
  // a drag without zustand being touched until commit.
  const liveOverride = useLiveNodeOverrides((s) =>
    selectedId ? s.get(selectedId as AnyNodeId) : undefined,
  )

  const node = useMemo<WallNode | undefined>(() => {
    if (!sceneNode) return undefined
    if (!liveOverride || Object.keys(liveOverride).length === 0) return sceneNode
    return { ...sceneNode, ...liveOverride } as WallNode
  }, [sceneNode, liveOverride])

  // Boolean selector — re-renders only when this specific wall's child
  // composition crosses the "has a door/window/wall-item" threshold.
  const hasWallChildrenBlockingCurve = useScene((s) => {
    if (!node) return false
    return (node.children ?? []).some((childId) => {
      const child = s.nodes[childId as AnyNodeId]
      if (!child) return false
      if (child.type === 'door' || child.type === 'window') return true
      if (child.type === 'item') {
        const attachTo = child.asset?.attachTo
        return attachTo === 'wall' || attachTo === 'wall-side'
      }
      return false
    })
  })

  // Existing plane-bound walls have no stored height. Resolve their current
  // body height for display and materialize it if the user edits height or
  // enables terrain infill.
  const resolvedHeightMeters = useScene((s) => {
    const wall = selectedId ? (s.nodes[selectedId as AnyNodeId] as WallNode | undefined) : undefined
    if (wall?.type !== 'wall') return undefined
    return resolveWallOpeningCeiling(wall, s.nodes)
  })

  // Mirror the latest node into a ref so the slider handlers below have
  // stable identities across re-renders. Without this, every store tick
  // (one per pointermove during a slider drag) rebuilt the handler
  // refs, destabilising SliderControl's pointer-capture listeners and
  // combining with float drift in `getWallCurveLength` produced a
  // "Maximum update depth exceeded" cascade. Same fix in fence-panel.tsx.
  const nodeRef = useRef(node)
  nodeRef.current = node

  const handleUpdate = useCallback(
    (updates: Partial<WallNode>) => {
      if (!selectedId) return
      useScene.getState().updateNode(selectedId as AnyNode['id'], updates)
    },
    [selectedId],
  )

  const handleUpdateLength = useCallback(
    (newLength: number) => {
      const n = nodeRef.current
      if (!n || newLength <= 0) return

      const dx = n.end[0] - n.start[0]
      const dz = n.end[1] - n.start[1]
      const currentLength = Math.sqrt(dx * dx + dz * dz)

      if (currentLength === 0) return

      const dirX = dx / currentLength
      const dirZ = dz / currentLength

      const newEnd: [number, number] = [
        n.start[0] + dirX * newLength,
        n.start[1] + dirZ * newLength,
      ]

      handleUpdate({ end: newEnd })
    },
    [handleUpdate],
  )

  const handleBaseModeChange = useCallback(
    (mode: 'terrain' | 'fixed') => {
      const n = nodeRef.current
      if (!n) return
      const height = n.height ?? resolveWallOpeningCeiling(n, useScene.getState().nodes)
      handleUpdate({
        height: Math.max(0.1, height),
        fillToTerrain: mode === 'terrain' ? true : undefined,
      })
    },
    [handleUpdate],
  )

  const handleClose = useCallback(() => {
    setSelection({ selectedIds: [] })
  }, [setSelection])

  const handleCurve = useCallback(() => {
    if (!node) return
    triggerSFX('sfx:item-pick')
    useInteractionScope.getState().begin(curveReshapeScope(node.id))
    setSelection({ selectedIds: [] })
  }, [node, setSelection])

  if (!(node && node.type === 'wall' && selectedId)) return null

  const length = getWallCurveLength(node)

  const followsTerrain = node.fillToTerrain === true
  const height = node.height ?? resolvedHeightMeters ?? 2.5
  const thickness = node.thickness ?? 0.1
  const curveOffset = getClampedWallCurveOffset(node)
  const maxCurveOffset = getMaxWallCurveOffset(node)
  const unitLabel = getLinearUnitLabel(unit)
  const displayLength = metersToLinearUnit(length, unit)
  const displayHeight = metersToLinearUnit(height, unit)
  const displayThickness = metersToLinearUnit(thickness, unit)
  const displayCurveOffset = metersToLinearUnit(curveOffset, unit)
  const displayMaxCurveOffset = metersToLinearUnit(maxCurveOffset, unit)
  const curveOffsetLimit = Math.max(0.01, maxCurveOffset)
  const wallHeightMeters = height

  const skirting = { ...WALL_SKIRTING_DEFAULT, ...(node.skirting ?? {}) }
  const crown = { ...WALL_CROWN_DEFAULT, ...(node.crown ?? {}) }
  const chairRail = { ...WALL_CHAIR_RAIL_DEFAULT, ...(node.chairRail ?? {}) }

  return (
    <PanelWrapper
      icon="/icons/wall.webp"
      onClose={handleClose}
      title={node.name || 'Wall'}
      width={280}
    >
      <PanelSection title={t('panel.dimensions')}>
        <SliderControl
          label={t('common.length')}
          max={metersToLinearUnit(20, unit)}
          min={metersToLinearUnit(0.1, unit)}
          onChange={(value) =>
            handleUpdateLength(
              linearControlValueToMeters(value, unit, { maxMeters: 20, minMeters: 0.1 }),
            )
          }
          precision={2}
          step={unit === 'imperial' ? 0.1 : 0.01}
          unit={unitLabel}
          value={displayLength}
        />
        <SliderControl
          label={t('common.height')}
          max={metersToLinearUnit(6, unit)}
          min={metersToLinearUnit(0.1, unit)}
          onChange={(v) =>
            handleUpdate({
              height: linearControlValueToMeters(v, unit, { maxMeters: 6, minMeters: 0.1 }),
            })
          }
          precision={2}
          step={0.1}
          unit={unitLabel}
          value={Math.round(displayHeight * 100) / 100}
        />
        <div className="px-1 font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
          {t('panel.base2')}
        </div>
        <SegmentedControl
          onChange={handleBaseModeChange}
          options={[
            { label: t('panel.fixed'), value: 'fixed' },
            { label: t('panel.followsLevel'), value: 'terrain' },
          ]}
          value={followsTerrain ? 'terrain' : 'fixed'}
        />
        {followsTerrain && (
          <div className="px-1 text-[11px] text-muted-foreground">
            Extends downward to meet the terrain. Height and top stay unchanged.
          </div>
        )}
        <SliderControl
          label={t('panel.thickness')}
          max={metersToLinearUnit(1, unit)}
          min={metersToLinearUnit(0.05, unit)}
          onChange={(v) => {
            const targetThickness = linearControlValueToMeters(v, unit, {
              maxMeters: 1,
              minMeters: 0.05,
            })
            const constructions = node.faceBands?.construction
            handleUpdate({
              thickness: targetThickness,
              ...(constructions
                ? {
                    faceBands: {
                      ...WALL_FACE_BAND_DEFAULT,
                      ...node.faceBands,
                      construction: Object.fromEntries(
                        Object.entries(constructions).map(([band, construction]) => [
                          band,
                          normalizeWallBandConstructionToThickness(construction, targetThickness),
                        ]),
                      ) as Record<string, WallBandConstruction>,
                    },
                  }
                : {}),
            })
          }}
          precision={3}
          step={0.01}
          unit={unitLabel}
          value={Math.round(displayThickness * 1000) / 1000}
        />
        {!hasWallChildrenBlockingCurve && (
          <SliderControl
            label={t('common.curve')}
            max={Math.max(metersToLinearUnit(0.01, unit), displayMaxCurveOffset)}
            min={-Math.max(metersToLinearUnit(0.01, unit), displayMaxCurveOffset)}
            onChange={(v) =>
              handleUpdate({
                curveOffset: normalizeWallCurveOffset(
                  node,
                  linearControlValueToMeters(v, unit, {
                    maxMeters: curveOffsetLimit,
                    minMeters: -curveOffsetLimit,
                  }),
                ),
              })
            }
            precision={2}
            step={0.1}
            unit={unitLabel}
            value={Math.round(displayCurveOffset * 100) / 100}
          />
        )}
      </PanelSection>

      <WallFaceBandSection
        node={node}
        onUpdate={handleUpdate}
        unit={unit}
        unitLabel={unitLabel}
        wallHeightMeters={wallHeightMeters}
      />

      <WallTrimSection
        node={node}
        onUpdate={handleUpdate}
        title={t('panel.skirting')}
        trimKey="skirting"
        trimValue={skirting}
        unit={unit}
        unitLabel={unitLabel}
        wallHeightMeters={wallHeightMeters}
      />
      <WallTrimSection
        node={node}
        onUpdate={handleUpdate}
        title={t('panel.crownMolding')}
        trimKey="crown"
        trimValue={crown}
        unit={unit}
        unitLabel={unitLabel}
        wallHeightMeters={wallHeightMeters}
      />
      <WallTrimSection
        node={node}
        onUpdate={handleUpdate}
        title={t('panel.chairRail')}
        trimKey="chairRail"
        trimValue={chairRail}
        unit={unit}
        unitLabel={unitLabel}
        wallHeightMeters={wallHeightMeters}
      />

      {!hasWallChildrenBlockingCurve && (
        <PanelSection title={t('panel.actions')}>
          <ActionGroup>
            <ActionButton
              icon={<Spline className="h-3.5 w-3.5" />}
              label={t('common.curve')}
              onClick={handleCurve}
            />
          </ActionGroup>
        </PanelSection>
      )}
    </PanelWrapper>
  )
}

function WallFaceBandSection({
  node,
  onUpdate,
  unit,
  unitLabel,
  wallHeightMeters,
}: {
  node: WallNode
  onUpdate: (updates: Partial<WallNode>) => void
  unit: 'metric' | 'imperial'
  unitLabel: string
  wallHeightMeters: number
}) {
  const t = useT()
  const bandConfig = getWallFaceBandConfig(node, wallHeightMeters)
  const bandCount = bandConfig.count
  const lowerHeight = bandConfig.lowerHeight
  const middleHeight = bandConfig.middleHeight
  const upperHeight = bandConfig.upperHeight
  const physicalThickness = getWallConstructionEnvelopeThickness(node)
  const libraryMaterialsVersion = useSyncExternalStore(
    subscribeLibraryMaterials,
    getLibraryMaterialsVersion,
    getLibraryMaterialsVersion,
  )
  const constructionMaterials = useMemo(() => {
    void libraryMaterialsVersion
    return getDynamicLibraryMaterials().filter((material) => material.sourceRef)
  }, [libraryMaterialsVersion])
  const activeBands: WallFaceBand[] =
    bandCount === 1
      ? ['upper']
      : bandCount === 2
        ? ['lower', 'upper']
        : bandCount === 3
          ? ['lower', 'middle', 'upper']
          : ['lower', 'middle', 'upper', 'top']
  const updateBands = (patch: Partial<NonNullable<WallNode['faceBands']>>) =>
    onUpdate({
      faceBands: {
        ...WALL_FACE_BAND_DEFAULT,
        ...(node.faceBands ?? {}),
        enabled: bandCount > 1,
        count: bandCount,
        ...patch,
      },
    })

  return (
    <PanelSection title={t('panel.wallBands')}>
      <SliderControl
        label={t('panel.bands')}
        max={4}
        min={1}
        onChange={(value) => onUpdate(buildWallFaceBandCountPatch(node, Math.round(value)))}
        precision={0}
        step={1}
        value={bandCount}
      />
      {bandCount >= 2 && (
        <SliderControl
          label={t('panel.lower')}
          max={metersToLinearUnit(wallHeightMeters, unit)}
          min={metersToLinearUnit(0, unit)}
          onChange={(value) =>
            updateBands({
              lowerHeight: linearControlValueToMeters(value, unit, {
                maxMeters: wallHeightMeters,
                minMeters: 0,
              }),
            })
          }
          precision={2}
          step={0.01}
          unit={unitLabel}
          value={metersToLinearUnit(lowerHeight, unit)}
        />
      )}
      {bandCount >= 3 && (
        <SliderControl
          label={t('panel.middle')}
          max={metersToLinearUnit(Math.max(0, wallHeightMeters - lowerHeight), unit)}
          min={metersToLinearUnit(0, unit)}
          onChange={(value) =>
            updateBands({
              middleHeight: linearControlValueToMeters(value, unit, {
                maxMeters: Math.max(0, wallHeightMeters - lowerHeight),
                minMeters: 0,
              }),
            })
          }
          precision={2}
          step={0.01}
          unit={unitLabel}
          value={metersToLinearUnit(middleHeight, unit)}
        />
      )}
      {bandCount >= 4 && (
        <SliderControl
          label={t('panel.upper')}
          max={metersToLinearUnit(Math.max(0, wallHeightMeters - lowerHeight - middleHeight), unit)}
          min={metersToLinearUnit(0, unit)}
          onChange={(value) =>
            updateBands({
              upperHeight: linearControlValueToMeters(value, unit, {
                maxMeters: Math.max(0, wallHeightMeters - lowerHeight - middleHeight),
                minMeters: 0,
              }),
            })
          }
          precision={2}
          step={0.01}
          unit={unitLabel}
          value={metersToLinearUnit(upperHeight, unit)}
        />
      )}
      <div className="rounded-md border border-border/70 bg-muted/30 px-2.5 py-2 text-xs">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground">{t('panel.physicalEnvelope')}</span>
          <strong>{Math.round(physicalThickness * 1000)} mm</strong>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">{t('panel.physicalEnvelopeHint')}</p>
      </div>
      {activeBands.map((band) => (
        <WallBandConstructionEditor
          band={band}
          construction={getWallBandConstruction(node, band)}
          key={band}
          materials={constructionMaterials}
          node={node}
          onChange={(construction) => {
            const faceBands = {
              ...WALL_FACE_BAND_DEFAULT,
              ...(node.faceBands ?? {}),
              enabled: bandCount > 1,
              count: bandCount,
              construction: {
                ...(node.faceBands?.construction ?? {}),
                [band]: construction,
              },
            }
            onUpdate({
              faceBands,
              thickness: getWallConstructionEnvelopeThickness({ ...node, faceBands }),
            })
          }}
          targetThickness={node.thickness ?? 0.1}
          wallHeightMeters={wallHeightMeters}
        />
      ))}
    </PanelSection>
  )
}

const WALL_LAYER_LABELS: Record<WallConstructionLayer['kind'], string> = {
  'gypsum-board': '석고보드',
  mdf: 'MDF',
  'timber-stud': '각재',
  cavity: '공백',
  finish: '표면 마감',
  custom: '사용자 자재',
}

const WALL_BAND_LABELS: Record<WallFaceBand, MessageId> = {
  lower: 'panel.lowerBand',
  middle: 'panel.middleBand',
  upper: 'panel.upperBand',
  top: 'panel.topBand',
}

export function WallBandConstructionEditor({
  band,
  construction,
  materials,
  node,
  onChange,
  targetThickness,
  wallHeightMeters,
}: {
  band: WallFaceBand
  construction: WallBandConstruction
  materials: ReturnType<typeof getDynamicLibraryMaterials>
  node: WallNode
  onChange: (construction: WallBandConstruction) => void
  targetThickness: number
  wallHeightMeters: number
}) {
  const t = useT()
  const sceneMaterials = useScene((s) => s.materials)
  // 표면마감의 시각 재질은 이 밴드의 interior 슬롯이 담당한다 — 도장 모드가
  // 쓰는 슬롯과 동일하므로 어느 쪽에서 고르든 같은 표면이 갱신된다. 스펙·
  // 가격(INTM productRef)과 표면 이미지(RawPainter 슬롯 재질)는 서로 독립.
  const bandConfig = getWallFaceBandConfig(node, wallHeightMeters)
  const surfaceSlotId = bandConfig.enabled ? getWallBandSlotId('interior', band) : 'interior'
  const surfaceRef = node.slots?.[surfaceSlotId]
  const surfaceMaterials = materials.filter(
    (material) => material.sourceRef?.provider === 'rawpainter',
  )
  const parsedSurfaceRef = parseMaterialRef(surfaceRef)
  const surfaceSceneMaterial =
    parsedSurfaceRef?.kind === 'scene'
      ? sceneMaterials[parsedSurfaceRef.id as SceneMaterialId]
      : undefined
  const surfaceSceneSource =
    surfaceSceneMaterial?.material.source?.provider === 'rawpainter'
      ? surfaceSceneMaterial.material.source
      : undefined
  const surfaceCatalogItem =
    parsedSurfaceRef?.kind === 'library'
      ? surfaceMaterials.find((item) => item.id === parsedSurfaceRef.id)
      : surfaceSceneSource
        ? surfaceMaterials.find(
            (item) => item.id === `${surfaceSceneSource.provider}:${surfaceSceneSource.externalId}`,
          )
        : undefined
  const surfaceValue =
    surfaceCatalogItem?.id ?? (surfaceSceneSource && surfaceRef ? surfaceRef : '')
  const surfaceLabel =
    surfaceCatalogItem?.label ?? (surfaceSceneSource ? surfaceSceneMaterial?.name : undefined)

  const applySurfaceMaterial = (value: string) => {
    if (!value) {
      wallPaint.commit?.({
        node,
        role: surfaceSlotId,
        material: undefined,
        materialPreset: undefined,
      })
      return
    }
    if (value.startsWith('scene:')) {
      wallPaint.commit?.({ node, role: surfaceSlotId, material: undefined, materialPreset: value })
      return
    }
    const item = surfaceMaterials.find((entry) => entry.id === value)
    if (!item) return
    wallPaint.commit?.({
      node,
      role: surfaceSlotId,
      material: freezeHostMaterialCatalogItem(item),
      materialPreset: undefined,
    })
  }

  const assemblyThickness = construction.layers.reduce((sum, layer) => sum + layer.thickness, 0)
  const cavityThickness = construction.layers
    .filter((layer) => layer.kind === 'cavity')
    .reduce((sum, layer) => sum + layer.thickness, 0)
  const materialThickness = assemblyThickness - cavityThickness
  const thicknessMatches = Math.abs(assemblyThickness - targetThickness) < 0.0001
  const quantities = calculateWallConstructionQuantities(node, wallHeightMeters).filter(
    (quantity) => quantity.band === band,
  )
  const updateLayer = (index: number, patch: Partial<WallConstructionLayer>) => {
    const layers = construction.layers.map((layer, layerIndex) =>
      layerIndex === index ? { ...layer, ...patch } : layer,
    )
    onChange({ ...construction, layers })
  }

  return (
    <div className="space-y-2 rounded-lg border border-border/70 bg-background/60 p-2.5">
      <div className="flex items-center justify-between">
        <strong className="text-xs">{t(WALL_BAND_LABELS[band])}</strong>
        <span className="text-[10px] text-muted-foreground">
          {Math.round(assemblyThickness * 1000)} / {Math.round(targetThickness * 1000)} mm
        </span>
      </div>
      {construction.mode === 'assembly' && (
        <div
          className={`rounded-md px-2 py-1.5 text-[10px] ${
            thicknessMatches
              ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
          }`}
        >
          {thicknessMatches
            ? `자재 ${Number((materialThickness * 1000).toFixed(1))}mm + 공백 ${Number(
                (cavityThickness * 1000).toFixed(1),
              )}mm = 벽체 ${Number((assemblyThickness * 1000).toFixed(1))}mm`
            : '벽체 두께는 구성 레이어의 실제 합계로 갱신됩니다.'}
        </div>
      )}
      <label className="block space-y-1 text-[10px] text-muted-foreground uppercase tracking-wider">
        {t('panel.assemblyPreset')}
        <select
          aria-label={`${t(WALL_BAND_LABELS[band])} — ${t('panel.assemblyPreset')}`}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground normal-case tracking-normal"
          onChange={(event) => {
            const preset = event.target.value
            if (preset !== 'custom') {
              // A preset rebuilds the layers from scratch, which dropped every
              // product the wall had named. Re-link them so switching preset
              // does not quietly unprice the wall.
              onChange(
                withBandConstructionMaterials(
                  createWallBandConstructionPreset(
                    preset as WallConstructionPresetId,
                    targetThickness,
                  ),
                ),
              )
            }
          }}
          value={detectWallConstructionPreset(construction)}
        >
          <option value="finish-only">표면 마감만</option>
          <option value="gypsum">석고보드 덧시공</option>
          <option value="mdf">MDF 덧시공</option>
          <option value="stud-gypsum">33각재 + 석고</option>
          <option value="stud-gypsum-finish">33각재 + 석고 + 도배 마감</option>
          <option value="gypsum-stud-gypsum">석고 + 33각재 + 석고</option>
          <option value="custom">직접 구성</option>
        </select>
      </label>
      {construction.layers.length > 0 && (
        <SegmentedControl
          onChange={(mode) => {
            const next = { ...construction, mode }
            onChange(next)
          }}
          options={[
            { label: '벽체 구성', value: 'assembly' },
            { label: '덧시공', value: 'overlay' },
          ]}
          value={construction.mode === 'assembly' ? 'assembly' : 'overlay'}
        />
      )}
      {construction.layers.map((layer, index) => {
        const quantity = quantities.find((item) => item.layerIndex === index)
        const materialsForLayer = materials.filter((material) => {
          if (layer.kind === 'cavity') return false
          // RawPainter 항목은 표면 재질 전용 — 스펙/가격 목록(INTM)에서 제외.
          if (material.sourceRef?.provider === 'rawpainter') return false
          if (material.constructionKinds?.includes(layer.kind)) return true
          if (material.constructionKinds?.length) return false
          if (layer.kind === 'timber-stud' || layer.kind === 'mdf') {
            return material.category === 'wood'
          }
          return layer.kind === 'finish'
        })
        const selectedMaterial = materials.find((material) => material.id === layer.productRef)
        return (
          <div className="space-y-1.5 rounded-md bg-muted/40 p-2" key={`${band}-${index}`}>
            <div className="flex gap-1.5">
              <span
                aria-hidden="true"
                className="mt-1 h-5 w-1.5 shrink-0 rounded-full border border-black/10"
                style={{ backgroundColor: WALL_LAYER_COLORS[layer.kind] }}
              />
              <select
                aria-label={`${t(WALL_BAND_LABELS[band])} layer ${index + 1} type`}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-xs"
                onChange={(event) => {
                  const next = createWallBandConstructionPreset(
                    event.target.value === 'mdf' ? 'mdf' : 'gypsum',
                  ).layers[0]
                  const kind = event.target.value as WallConstructionLayer['kind']
                  const defaults =
                    kind === 'timber-stud'
                      ? createWallBandConstructionPreset('stud-gypsum').layers[0]
                      : kind === 'cavity'
                        ? { kind, thickness: 0.01, wasteFactor: 0 }
                        : kind === 'finish' || kind === 'custom'
                          ? { kind, thickness: kind === 'finish' ? 0.001 : 0.01, wasteFactor: 0.1 }
                          : next
                  if (!defaults) return
                  // Choosing a layer type should not then mean hunting the
                  // matching product out of a few thousand catalogue rows: the
                  // defaults state a thickness and sheet size, and the product
                  // names carry both. Nothing is chosen when nothing agrees.
                  const fit = bestConstructionMaterial(
                    materials.filter((material) =>
                      material.constructionKinds?.includes(kind as never),
                    ),
                    defaults,
                  )
                  updateLayer(
                    index,
                    fit
                      ? {
                          ...defaults,
                          productRef: fit.id,
                          brand: fit.commercial?.brand,
                          unitPrice: fit.commercial?.unitPrice,
                        }
                      : defaults,
                  )
                }}
                value={layer.kind}
              >
                {Object.entries(WALL_LAYER_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <button
                aria-label={`${t(WALL_BAND_LABELS[band])} layer ${index + 1} remove`}
                className="rounded-md border border-border px-1.5 text-muted-foreground hover:text-destructive"
                onClick={() =>
                  onChange({
                    ...construction,
                    layers: construction.layers.filter((_, layerIndex) => layerIndex !== index),
                  })
                }
                type="button"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <label className="text-[10px] text-muted-foreground">
                {layer.kind === 'timber-stud' ? '각재 깊이 mm' : '두께 mm'}
                <input
                  aria-label={`${t(WALL_BAND_LABELS[band])} layer ${index + 1} thickness mm`}
                  className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground"
                  min={0.1}
                  onChange={(event) =>
                    updateLayer(index, {
                      thickness: Math.max(0.0001, Number(event.target.value) / 1000),
                    })
                  }
                  step={0.5}
                  type="number"
                  value={Number((layer.thickness * 1000).toFixed(1))}
                />
              </label>
              {layer.kind === 'timber-stud' ? (
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="text-[10px] text-muted-foreground">
                    각재 규격 mm
                    <input
                      aria-label={`${t(WALL_BAND_LABELS[band])} layer ${index + 1} member width mm`}
                      className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground"
                      min={10}
                      onChange={(event) =>
                        updateLayer(index, {
                          memberWidth: Math.max(0.01, Number(event.target.value) / 1000),
                        })
                      }
                      step={1}
                      type="number"
                      value={Math.round((layer.memberWidth ?? 0.033) * 1000)}
                    />
                  </label>
                  <label className="text-[10px] text-muted-foreground">
                    간격 mm
                    <input
                      aria-label={`${t(WALL_BAND_LABELS[band])} layer ${index + 1} spacing mm`}
                      className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground"
                      min={50}
                      onChange={(event) =>
                        updateLayer(index, {
                          studSpacing: Math.max(0.05, Number(event.target.value) / 1000),
                        })
                      }
                      step={50}
                      type="number"
                      value={Math.round((layer.studSpacing ?? 0.3) * 1000)}
                    />
                  </label>
                </div>
              ) : (
                <div className="self-end pb-1 text-[10px] text-muted-foreground">
                  {layer.kind === 'cavity'
                    ? `공백 ${quantity?.volumeM3.toFixed(3) ?? 0}㎥`
                    : quantity?.sheetCount
                      ? `${quantity.sheetCount}장`
                      : `${quantity?.areaM2.toFixed(2) ?? 0}㎡`}
                </div>
              )}
            </div>
            {materialsForLayer.length > 0 && (
              <label className="block text-[10px] text-muted-foreground">
                INTM 자재
                <select
                  aria-label={`${t(WALL_BAND_LABELS[band])} layer ${index + 1} INTM material`}
                  className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground"
                  onChange={(event) => {
                    const product = materialsForLayer.find((item) => item.id === event.target.value)
                    updateLayer(index, {
                      productRef: product?.id,
                      brand: product?.commercial?.brand,
                      unitPrice: product?.commercial?.unitPrice,
                    })
                  }}
                  value={layer.productRef ?? ''}
                >
                  <option value="">자재 선택</option>
                  {materialsForLayer.map((material) => (
                    <option key={material.id} value={material.id}>
                      {[material.commercial?.brand, material.label].filter(Boolean).join(' · ')}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {quantity?.studCount && (
              <div className="text-[10px] text-muted-foreground">
                {Math.round((layer.memberWidth ?? 0.033) * 1000)}×
                {Math.round((layer.memberWidth ?? 0.033) * 1000)} 각재 · {quantity.studCount}본 ·{' '}
                {quantity.linearM?.toFixed(1)}m (손실 포함)
              </div>
            )}
            {(selectedMaterial || layer.brand || layer.unitPrice !== undefined) && (
              <div className="rounded border border-border/60 bg-background/70 px-2 py-1.5 text-[10px] text-muted-foreground">
                <div className="font-medium text-foreground">
                  {[layer.brand, selectedMaterial?.label].filter(Boolean).join(' · ') ||
                    '선택 자재'}
                </div>
                <div>
                  {[
                    selectedMaterial?.commercial?.productCode,
                    layer.unitPrice === undefined
                      ? undefined
                      : `${layer.unitPrice.toLocaleString()}원/${selectedMaterial?.commercial?.unit ?? '단위'}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
              </div>
            )}
          </div>
        )
      })}
      <div className="space-y-1.5 rounded-md bg-muted/40 p-2">
        <label className="block text-[10px] text-muted-foreground">
          표면 재질 (RawPainter)
          {surfaceMaterials.length > 0 || surfaceValue ? (
            <select
              aria-label={`${t(WALL_BAND_LABELS[band])} RawPainter surface`}
              className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground"
              onChange={(event) => applySurfaceMaterial(event.target.value)}
              value={surfaceValue}
            >
              <option value="">재질 선택</option>
              {surfaceValue && !surfaceCatalogItem && (
                <option value={surfaceValue}>{surfaceLabel ?? '적용된 재질'}</option>
              )}
              {surfaceMaterials.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          ) : (
            <span className="mt-0.5 block rounded border border-dashed border-border/70 px-1.5 py-1 text-[10px]">
              도장 탭에서 RawPainter 자재를 선택하면 여기서 고를 수 있습니다.
            </span>
          )}
        </label>
        {surfaceLabel && (
          <div className="flex items-center gap-1.5 rounded border border-border/60 bg-background/70 px-2 py-1.5">
            {surfaceCatalogItem?.previewThumbnailUrl ? (
              <img
                alt=""
                className="h-6 w-6 shrink-0 rounded object-cover"
                src={surfaceCatalogItem.previewThumbnailUrl}
              />
            ) : null}
            <span className="truncate text-[10px] text-foreground">{surfaceLabel}</span>
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          className="flex items-center justify-center gap-1 rounded-md border border-dashed border-border py-1.5 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() =>
            onChange({
              ...construction,
              mode: construction.mode === 'finish' ? 'assembly' : construction.mode,
              layers: [
                ...construction.layers,
                createWallBandConstructionPreset('gypsum').layers[0]!,
              ],
            })
          }
          type="button"
        >
          <Plus className="h-3.5 w-3.5" /> 자재 추가
        </button>
        <button
          className="flex items-center justify-center gap-1 rounded-md border border-dashed border-sky-400/60 py-1.5 text-[11px] text-sky-700 hover:text-sky-900 dark:text-sky-300"
          onClick={() =>
            onChange({
              ...construction,
              mode: 'assembly',
              layers: [...construction.layers, { kind: 'cavity', thickness: 0.01, wasteFactor: 0 }],
            })
          }
          type="button"
        >
          <Plus className="h-3.5 w-3.5" /> 공백 추가
        </button>
      </div>
    </div>
  )
}

function WallTrimSection({
  node,
  onUpdate,
  title,
  trimKey,
  trimValue,
  unit,
  unitLabel,
  wallHeightMeters,
}: {
  node: WallNode
  onUpdate: (updates: Partial<WallNode>) => void
  title: string
  trimKey: WallTrimKey
  trimValue: NonNullable<WallNode['skirting']>
  unit: 'metric' | 'imperial'
  unitLabel: string
  wallHeightMeters: number
}) {
  const t = useT()
  const updateTrim = (patch: Partial<NonNullable<WallNode['skirting']>>) =>
    onUpdate({
      [trimKey]: {
        ...trimValue,
        ...patch,
      },
    } as Partial<WallNode>)
  const profileOptions = WALL_TRIM_PROFILE_OPTIONS(t)[trimKey]
  const selectedProfile = profileOptions.some((option) => option.value === trimValue.profile)
    ? trimValue.profile
    : profileOptions[0]!.value

  return (
    <PanelSection title={title}>
      <ActionGroup>
        <ActionButton
          label={`${trimValue.enabled ? t('panel.hideTrim') : t('panel.showTrim')}: ${title}`}
          onClick={() => updateTrim({ enabled: !trimValue.enabled })}
        />
      </ActionGroup>
      {trimValue.enabled && (
        <>
          <SegmentedControl
            onChange={(next) => updateTrim({ sides: next as any })}
            options={[
              { label: t('panel.interior'), value: 'interior' },
              { label: t('panel.exterior'), value: 'exterior' },
              { label: t('panel.both'), value: 'both' },
            ]}
            value={trimValue.sides}
          />
          <SegmentedControl
            onChange={(next) => updateTrim({ profile: next })}
            options={profileOptions}
            value={selectedProfile}
          />
          <SliderControl
            label={t('common.height')}
            max={metersToLinearUnit(Math.max(0.05, wallHeightMeters), unit)}
            min={metersToLinearUnit(0.01, unit)}
            onChange={(value) =>
              updateTrim({
                height: linearControlValueToMeters(value, unit, {
                  maxMeters: Math.max(0.05, wallHeightMeters),
                  minMeters: 0.01,
                }),
              })
            }
            precision={2}
            step={0.01}
            unit={unitLabel}
            value={metersToLinearUnit(trimValue.height, unit)}
          />
          <SliderControl
            label={t('panel.proud')}
            max={metersToLinearUnit(0.2, unit)}
            min={metersToLinearUnit(0.001, unit)}
            onChange={(value) =>
              updateTrim({
                proud: linearControlValueToMeters(value, unit, {
                  maxMeters: 0.2,
                  minMeters: 0.001,
                }),
              })
            }
            precision={3}
            step={0.005}
            unit={unitLabel}
            value={metersToLinearUnit(trimValue.proud, unit)}
          />
          {trimKey === 'chairRail' && (
            <SliderControl
              label={t('panel.offset')}
              max={metersToLinearUnit(Math.max(0.05, wallHeightMeters - trimValue.height), unit)}
              min={metersToLinearUnit(0, unit)}
              onChange={(value) =>
                updateTrim({
                  offsetY: linearControlValueToMeters(value, unit, {
                    maxMeters: Math.max(0.05, wallHeightMeters - trimValue.height),
                    minMeters: 0,
                  }),
                })
              }
              precision={2}
              step={0.01}
              unit={unitLabel}
              value={metersToLinearUnit(trimValue.offsetY ?? 0, unit)}
            />
          )}
        </>
      )}
    </PanelSection>
  )
}

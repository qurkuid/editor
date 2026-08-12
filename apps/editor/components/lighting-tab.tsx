'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type AssetInput,
  LightingCircuitNode,
  type LightingFixtureNode,
  type LightingSwitchNode,
  resolveLightingFixtureCount,
  runAsSingleSceneHistoryStep,
  useScene,
} from '@pascal-app/core'
import { CATALOG_ITEMS, lightingReplacementNode, useEditor, useT } from '@pascal-app/editor'
import { useLightingToolOptions } from '@pascal-app/nodes'
import { useViewer } from '@pascal-app/viewer'
import {
  Check,
  ChevronDown,
  CircleDot,
  GripVertical,
  Lightbulb,
  Minus,
  Power,
  ScanLine,
  Search,
  ToggleLeft,
  Zap,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'

function activateLightingTool(tool: 'lighting-fixture' | 'lighting-switch') {
  const editor = useEditor.getState()
  editor.setPhase('structure')
  editor.setStructureLayer('elements')
  editor.setCatalogCategory(null)
  editor.setMode('build')
  editor.setTool(tool)
}

export function resolveLightingItems(remoteItems: readonly AssetInput[]): readonly AssetInput[] {
  const remoteLights = remoteItems.filter((item) => item.category === '조명')
  const items = new Map(
    CATALOG_ITEMS.filter((item) => item.tags?.includes('lighting')).map((item) => [item.id, item]),
  )
  for (const item of remoteLights) items.set(item.id, item)
  return [...items.values()]
}

export function filterLightingItems(
  items: readonly AssetInput[],
  query: string,
  recentIds: readonly string[],
  recentOnly: boolean,
): readonly AssetInput[] {
  const normalizedQuery = query.trim().toLocaleLowerCase()
  return items.filter(
    (item) =>
      (!recentOnly || recentIds.includes(item.id)) &&
      (!normalizedQuery || item.name.toLocaleLowerCase().includes(normalizedQuery)),
  )
}

type LightingWorkflowGuideProps = {
  readonly circuitCount: number
  readonly fixtureCount: number
  readonly switchCount: number
}

export function LightingWorkflowGuide({
  circuitCount,
  fixtureCount,
  switchCount,
}: LightingWorkflowGuideProps) {
  const t = useT()
  const steps = [
    { complete: circuitCount > 0, label: t('lighting.guide.stepCircuit') },
    { complete: fixtureCount > 0, label: t('lighting.guide.stepFixture') },
    { complete: switchCount > 0, label: t('lighting.guide.stepSwitch') },
  ] as const
  const completeCount = steps.filter((step) => step.complete).length

  return (
    <section className="overflow-hidden rounded-xl border border-amber-400/25 bg-amber-400/5">
      <div className="flex items-center gap-2 border-amber-400/15 border-b px-3 py-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-300">
          <Lightbulb className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-xs">{t('lighting.guide.title')}</h2>
          <p className="text-[10px] text-muted-foreground">{t('lighting.guide.desc')}</p>
        </div>
        <span className="rounded-full bg-background/50 px-2 py-1 text-[9px] text-amber-200">
          {t('lighting.guide.complete').replace('{n}', String(completeCount))}
        </span>
      </div>
      <ol className="grid grid-cols-3 gap-1.5 p-2.5">
        {steps.map((step, index) => {
          const active = !step.complete && steps.slice(0, index).every((item) => item.complete)
          return (
            <li
              className={cn(
                'flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border px-1 text-center text-[9px]',
                step.complete
                  ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200'
                  : active
                    ? 'border-amber-400/35 bg-amber-400/10 text-foreground'
                    : 'border-border/50 bg-background/30 text-muted-foreground',
              )}
              key={step.label}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-current/30 text-[9px]">
                {step.complete ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              {step.label}
            </li>
          )
        })}
      </ol>
    </section>
  )
}

/**
 * Optional GLB fixture model combined into each placed light. Sourced from the
 * SKP catalog's '조명' category (same endpoint the items panel uses — root
 * absolute path so the INTM session cookie rides along in prod and dev alike).
 * Renders nothing when the catalog has no lighting items, so bare placement
 * keeps working without it.
 */
function LightingItemPicker() {
  const t = useT()
  const itemAsset = useLightingToolOptions((state) => state.itemAsset)
  const replacementTargetId = useEditor((state) => state.replacementTargetId)
  const setReplacementTargetId = useEditor((state) => state.setReplacementTargetId)
  const setMode = useEditor((state) => state.setMode)
  const [items, setItems] = useState<readonly AssetInput[]>(() => resolveLightingItems([]))
  const [query, setQuery] = useState('')
  const [recentIds, setRecentIds] = useState<readonly string[]>([])
  const [recentOnly, setRecentOnly] = useState(false)
  const visibleItems = useMemo(
    () => filterLightingItems(items, query, recentIds, recentOnly),
    [items, query, recentIds, recentOnly],
  )

  const rememberItem = (item: AssetInput) => {
    setRecentIds((current) => [item.id, ...current.filter((id) => id !== item.id)].slice(0, 8))
  }

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/sketchup/pascal-catalog', { cache: 'no-store' })
        if (!res.ok) return
        const data = (await res.json()) as { items?: AssetInput[] }
        if (!cancelled) {
          setItems(resolveLightingItems(data.items ?? []))
        }
      } catch {
        // No catalog — bare light placement keeps working without it.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (items.length === 0) return null
  return (
    <div className="mt-2">
      <p className="mb-1 text-[10px] text-muted-foreground">{t('lighting.item.heading')}</p>
      <div className="mb-1.5 flex gap-1">
        <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2">
          <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
          <input
            aria-label={t('lighting.item.search')}
            className="min-w-0 flex-1 bg-transparent py-1.5 text-[11px] outline-none placeholder:text-muted-foreground"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('lighting.item.search')}
            type="search"
            value={query}
          />
        </label>
        <button
          aria-pressed={recentOnly}
          className={cn(
            'rounded-md border border-border px-2 text-[10px] text-muted-foreground hover:bg-muted',
            recentOnly && 'border-amber-400 bg-amber-500/10 text-amber-200',
          )}
          disabled={recentIds.length === 0}
          onClick={() => setRecentOnly((current) => !current)}
          type="button"
        >
          {t('lighting.item.recent')}
        </button>
      </div>
      <div className="grid max-h-[286px] grid-cols-4 gap-1.5 overflow-y-auto pr-1">
        <button
          aria-pressed={itemAsset === null}
          className={cn(
            'flex aspect-square min-w-0 flex-col items-center justify-center rounded-md border border-border text-[9px] text-muted-foreground hover:bg-muted',
            itemAsset === null && 'border-amber-400 bg-amber-500/10 text-amber-200',
          )}
          onClick={() => {
            if (replacementTargetId) setReplacementTargetId(null)
            useLightingToolOptions.getState().setItemAsset(null)
          }}
          type="button"
        >
          {t('lighting.item.none')}
        </button>
        {visibleItems.map((item) => {
          const selected = itemAsset?.id === item.id
          return (
            <button
              aria-pressed={selected}
              className={cn(
                'aspect-square min-w-0 overflow-hidden rounded-md border border-border hover:bg-muted',
                selected && 'border-amber-400 bg-amber-500/10',
              )}
              key={item.id}
              onClick={() => {
                rememberItem(item)
                const replacementTarget = replacementTargetId
                  ? useScene.getState().nodes[replacementTargetId]
                  : null
                if (replacementTarget?.type === 'body') {
                  const replacement = lightingReplacementNode(replacementTarget, item)
                  runAsSingleSceneHistoryStep(useScene, () => {
                    useScene.getState().createNode(replacement)
                    useScene.getState().deleteNode(replacementTarget.id)
                  })
                  setReplacementTargetId(null)
                  setMode('select')
                  useViewer.getState().setSelection({ selectedIds: [replacement.id], zoneId: null })
                  return
                }
                useLightingToolOptions.getState().setItemAsset(selected ? null : item)
              }}
              title={item.name}
              type="button"
            >
              {item.thumbnail ? (
                <img alt={item.name} className="h-full w-full object-cover" src={item.thumbnail} />
              ) : (
                <span className="block truncate p-1 text-[9px]">{item.name}</span>
              )}
            </button>
          )
        })}
        {visibleItems.length === 0 ? (
          <p className="col-span-4 py-4 text-center text-[10px] text-muted-foreground">
            {t('lighting.item.emptySearch')}
          </p>
        ) : null}
      </div>
    </div>
  )
}

export function LightingTab() {
  const t = useT()
  const levelId = useViewer((state) => state.selection.levelId)
  const selectedIds = useViewer((state) => state.selection.selectedIds)
  const activeTool = useEditor((state) => state.tool)
  const mode = useEditor((state) => state.mode)
  const lightType = useLightingToolOptions((state) => state.lightType)
  const circuitId = useLightingToolOptions((state) => state.circuitId)
  const fixtureHeight = useLightingToolOptions((state) => state.fixtureHeight)
  const switchHeight = useLightingToolOptions((state) => state.switchHeight)
  const switchGangCount = useLightingToolOptions((state) => state.switchGangCount)
  const switchShape = useLightingToolOptions((state) => state.switchShape)
  const placement = useLightingToolOptions((state) => state.placement)
  const arrayCount = useLightingToolOptions((state) => state.arrayCount)
  const nodes = useScene((state) => state.nodes)
  const updateNode = useScene((state) => state.updateNode)
  const [expandedSwitchId, setExpandedSwitchId] = useState<LightingSwitchNode['id'] | null>(null)
  const [draggedFixtureId, setDraggedFixtureId] = useState<LightingFixtureNode['id'] | null>(null)
  const [dragOverCircuitId, setDragOverCircuitId] = useState<string | null>(null)
  const circuits = useMemo(
    () =>
      Object.values(nodes)
        .filter(
          (node): node is LightingCircuitNode =>
            node.type === 'lighting-circuit' && (!levelId || node.parentId === levelId),
        )
        .sort((a, b) => a.circuitNumber - b.circuitNumber),
    [levelId, nodes],
  )
  const fixtures = useMemo(
    () =>
      Object.values(nodes).filter(
        (node): node is LightingFixtureNode => node.type === 'lighting-fixture',
      ),
    [nodes],
  )
  const switches = useMemo(
    () =>
      Object.values(nodes).filter(
        (node): node is LightingSwitchNode => node.type === 'lighting-switch',
      ),
    [nodes],
  )
  const selectedCircuit = circuits.find((circuit) => circuit.id === circuitId) ?? null
  const selectedSwitchId = switches.some((item) => item.id === selectedIds[0])
    ? selectedIds[0]
    : null
  const selectedFixture = fixtures.find((fixture) => fixture.id === selectedIds[0]) ?? null
  const focusedCircuitId = selectedFixture?.circuitId ?? circuitId

  useEffect(() => {
    const owner = switches.find((lightingSwitch) => {
      const ownedCircuitIds =
        lightingSwitch.circuitIds?.length > 0
          ? lightingSwitch.circuitIds
          : [lightingSwitch.circuitId]
      return lightingSwitch.id === selectedSwitchId || ownedCircuitIds.includes(focusedCircuitId)
    })
    if (owner) setExpandedSwitchId(owner.id)
  }, [focusedCircuitId, selectedSwitchId, switches])

  useEffect(() => {
    const nextCircuitId = circuits.some((circuit) => circuit.id === circuitId)
      ? circuitId
      : (circuits[0]?.id ?? null)
    if (nextCircuitId === circuitId) return
    useLightingToolOptions.getState().setCircuitId(nextCircuitId)
  }, [circuitId, circuits])

  useEffect(() => {
    if (!levelId) return
    const claimedCircuitIds = new Set<string>()
    let circuitNumber = Math.max(0, ...circuits.map((item) => item.circuitNumber))
    for (const lightingSwitch of switches) {
      const currentIds =
        lightingSwitch.circuitIds?.length > 0
          ? lightingSwitch.circuitIds
          : [lightingSwitch.circuitId]
      const nextIds = Array.from(
        { length: lightingSwitch.gangCount },
        (_, index) => currentIds[index] ?? null,
      )
      let changed = false
      for (let index = 0; index < nextIds.length; index += 1) {
        const currentId = nextIds[index]
        if (currentId && !claimedCircuitIds.has(currentId)) {
          claimedCircuitIds.add(currentId)
          continue
        }
        const source = currentId ? circuits.find((item) => item.id === currentId) : null
        circuitNumber += 1
        const circuit = LightingCircuitNode.parse({
          name: t('lighting.circuits.defaultName').replace('{n}', String(circuitNumber)),
          circuitNumber,
          enabled: source?.enabled ?? true,
          parentId: levelId,
        })
        useScene.getState().createNode(circuit as AnyNode, levelId as AnyNodeId)
        nextIds[index] = circuit.id
        claimedCircuitIds.add(circuit.id)
        changed = true
      }
      if (changed) {
        updateNode(lightingSwitch.id, {
          circuitId: nextIds[0] ?? null,
          circuitIds: nextIds,
        })
      }
    }
  }, [circuits, levelId, switches, t, updateNode])

  const prepareSwitchPlacement = () => {
    if (!levelId) return
    const nextCircuitIds: string[] = []
    let circuitNumber = Math.max(0, ...circuits.map((item) => item.circuitNumber))
    for (let index = 0; index < switchGangCount; index += 1) {
      circuitNumber += 1
      const circuit = LightingCircuitNode.parse({
        name: t('lighting.circuits.defaultName').replace('{n}', String(circuitNumber)),
        circuitNumber,
        enabled: true,
        parentId: levelId,
      })
      useScene.getState().createNode(circuit as AnyNode, levelId as AnyNodeId)
      nextCircuitIds.push(circuit.id)
    }
    const options = useLightingToolOptions.getState()
    for (let index = 0; index < switchGangCount; index += 1) {
      options.setSwitchCircuitId(index, nextCircuitIds[index] ?? null)
    }
    options.setCircuitId(nextCircuitIds[0] ?? null)
    activateLightingTool('lighting-switch')
  }

  const placeFixture = (type: LightingFixtureNode['lightType']) => {
    useLightingToolOptions.getState().setLightType(type)
    activateLightingTool('lighting-fixture')
  }

  const addSwitchCircuit = (lightingSwitch: LightingSwitchNode) => {
    if (!(levelId && lightingSwitch.gangCount < 4)) return
    const circuitNumber = Math.max(0, ...circuits.map((item) => item.circuitNumber)) + 1
    const circuit = LightingCircuitNode.parse({
      name: t('lighting.circuits.defaultName').replace('{n}', String(circuitNumber)),
      circuitNumber,
      enabled: true,
      parentId: levelId,
    })
    useScene.getState().createNode(circuit as AnyNode, levelId as AnyNodeId)
    const circuitIds = [
      ...(lightingSwitch.circuitIds?.length > 0
        ? lightingSwitch.circuitIds
        : [lightingSwitch.circuitId]),
      circuit.id,
    ]
    updateNode(lightingSwitch.id, { circuitIds, gangCount: circuitIds.length })
    useViewer.getState().setSelection({ selectedIds: [lightingSwitch.id], zoneId: null })
    useLightingToolOptions.getState().setCircuitId(circuit.id)
  }

  const removeSwitchCircuit = (
    lightingSwitch: LightingSwitchNode,
    circuit: LightingCircuitNode,
    gangIndex: number,
  ) => {
    if (lightingSwitch.gangCount <= 1) return
    for (const fixture of fixtures) {
      if (fixture.circuitId === circuit.id) updateNode(fixture.id, { circuitId: null })
    }
    useScene.getState().deleteNode(circuit.id)
    const circuitIds = (
      lightingSwitch.circuitIds?.length > 0 ? lightingSwitch.circuitIds : [lightingSwitch.circuitId]
    ).filter((_, index) => index !== gangIndex)
    updateNode(lightingSwitch.id, {
      circuitId: circuitIds[0] ?? null,
      circuitIds,
      gangCount: circuitIds.length,
    })
    useLightingToolOptions.getState().setCircuitId(circuitIds[0] ?? null)
  }

  const moveDraggedFixture = (targetCircuitId: LightingCircuitNode['id']) => {
    if (!draggedFixtureId) return
    updateNode(draggedFixtureId, { circuitId: targetCircuitId })
    useLightingToolOptions.getState().setCircuitId(targetCircuitId)
    useViewer.getState().setSelection({ selectedIds: [draggedFixtureId], zoneId: null })
    setDraggedFixtureId(null)
    setDragOverCircuitId(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3 text-sm">
      <LightingWorkflowGuide
        circuitCount={circuits.length}
        fixtureCount={fixtures.length}
        switchCount={switches.length}
      />

      <div className="my-3 flex items-center gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-2 text-xs">
        <Zap className="h-3.5 w-3.5 text-amber-300" />
        <span className="text-muted-foreground">{t('lighting.currentCircuit')}</span>
        <span className="ml-auto font-medium">
          {selectedCircuit?.name ?? t('lighting.noneSelected')}
        </span>
        {selectedCircuit ? (
          <span
            className={cn(
              'h-2 w-2 rounded-full',
              selectedCircuit.enabled ? 'bg-emerald-400' : 'bg-muted-foreground',
            )}
          />
        ) : null}
      </div>

      {!levelId && (
        <div className="mb-4 rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
          {t('lighting.selectLevelFirst')}
        </div>
      )}

      <section className="mb-5" id="lighting-switches">
        <div className="mb-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('lighting.switches.heading')}
          </h3>
        </div>
        <div className="mb-3 rounded-lg border border-border bg-background/40 p-2">
          <button
            className={cn(
              'flex w-full items-center gap-3 rounded-md p-2 text-left hover:bg-muted',
              mode === 'build' &&
                activeTool === 'lighting-switch' &&
                'bg-teal-500/10 text-teal-200',
            )}
            disabled={!levelId}
            onClick={prepareSwitchPlacement}
            type="button"
          >
            <ToggleLeft className="h-5 w-5 text-teal-400" />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{t('lighting.placeSwitch.wallSwitch')}</span>
              <span className="block text-xs text-muted-foreground">
                {t('lighting.placeSwitch.desc')}
              </span>
            </span>
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2 border-border border-t pt-2">
            <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              {t('lighting.placeSwitch.count')}
              <select
                aria-label={t('lighting.placeSwitch.count')}
                className="rounded-md border border-border bg-background px-2 py-1 text-foreground"
                onChange={(event) =>
                  useLightingToolOptions.getState().setSwitchGangCount(Number(event.target.value))
                }
                value={switchGangCount}
              >
                {[1, 2, 3, 4].map((count) => (
                  <option key={count} value={count}>
                    {count}구
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-center gap-1">
              {(['rectangle', 'round'] as const).map((shape) => (
                <button
                  aria-pressed={switchShape === shape}
                  className={cn(
                    'flex-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted',
                    switchShape === shape && 'border-teal-400 bg-teal-500/10 text-teal-200',
                  )}
                  key={shape}
                  onClick={() => useLightingToolOptions.getState().setSwitchShape(shape)}
                  type="button"
                >
                  {t(
                    shape === 'rectangle'
                      ? 'lighting.placeSwitch.rectangle'
                      : 'lighting.placeSwitch.round',
                  )}
                </button>
              ))}
            </div>
          </div>
          <label className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            {t('lighting.mountHeight')}
            <input
              className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right text-foreground"
              min={0.1}
              onChange={(event) =>
                useLightingToolOptions.getState().setSwitchHeight(Number(event.target.value))
              }
              step={0.1}
              type="number"
              value={switchHeight}
            />
            <span>m</span>
          </label>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t('lighting.placeSwitch.autoCircuit')}
          </p>
        </div>
        <div className="space-y-2">
          {switches.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              {t('lighting.switches.empty')}
            </div>
          )}
          {switches.map((lightingSwitch, switchIndex) => {
            const ownedCircuitIds =
              lightingSwitch.circuitIds?.length > 0
                ? lightingSwitch.circuitIds
                : [lightingSwitch.circuitId]
            const switchSelected =
              selectedSwitchId === lightingSwitch.id ||
              (!!selectedFixture?.circuitId && ownedCircuitIds.includes(selectedFixture.circuitId))
            const expanded = expandedSwitchId === lightingSwitch.id
            const ownedFixtures = fixtures.filter(
              (fixture) => fixture.circuitId && ownedCircuitIds.includes(fixture.circuitId),
            )
            const lightCount = ownedFixtures.reduce(
              (total, fixture) => total + resolveLightingFixtureCount(fixture),
              0,
            )
            return (
              <div
                className={cn(
                  'rounded-lg border p-2 transition-colors',
                  switchSelected ? 'border-teal-400 bg-teal-500/8' : 'border-border',
                )}
                key={lightingSwitch.id}
              >
                <div className={cn('flex items-center gap-2 text-xs font-medium', expanded && 'mb-2')}>
                  <button
                    aria-expanded={expanded}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => {
                      useViewer
                        .getState()
                        .setSelection({ selectedIds: [lightingSwitch.id], zoneId: null })
                      setExpandedSwitchId((current) =>
                        current === lightingSwitch.id ? null : lightingSwitch.id,
                      )
                    }}
                    type="button"
                  >
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5 shrink-0 transition-transform',
                        expanded && 'rotate-180',
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {t('lighting.switches.defaultName').replace('{n}', String(switchIndex + 1))}
                    </span>
                  </button>
                  <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                    {lightingSwitch.gangCount}구 · 조명 {lightCount}
                  </span>
                  <button
                    aria-label={t('lighting.circuits.addToSwitch')}
                    className="rounded border border-border px-1.5 py-0.5 text-sm disabled:opacity-30"
                    disabled={lightingSwitch.gangCount >= 4}
                    onClick={() => addSwitchCircuit(lightingSwitch)}
                    type="button"
                  >
                    +
                  </button>
                </div>
                {expanded ? <div className="space-y-1 border-border border-l pl-2">
                  {ownedCircuitIds.map((ownedCircuitId, gangIndex) => {
                    const circuit = circuits.find((item) => item.id === ownedCircuitId)
                    if (!circuit) return null
                    const circuitFixtures = fixtures.filter(
                      (fixture) => fixture.circuitId === circuit.id,
                    )
                    const lightCount = circuitFixtures.reduce(
                      (total, fixture) => total + resolveLightingFixtureCount(fixture),
                      0,
                    )
                    const selected =
                      circuit.id === (selectedFixture?.circuitId ?? circuitId) && switchSelected
                    const dropTarget = draggedFixtureId !== null && dragOverCircuitId === circuit.id
                    const defaultCircuitName = t('lighting.circuits.defaultName').replace(
                      '{n}',
                      String(circuit.circuitNumber),
                    )
                    return (
                      <div
                        className={cn(
                          'rounded-md px-2 py-1.5 transition-colors',
                          selected && 'bg-amber-500/10',
                          dropTarget && 'bg-teal-500/15 ring-1 ring-teal-400',
                        )}
                        data-circuit-id={circuit.id}
                        key={`${lightingSwitch.id}-${gangIndex}`}
                        onDragOver={(event) => {
                          if (!draggedFixtureId) return
                          event.preventDefault()
                          event.dataTransfer.dropEffect = 'move'
                          setDragOverCircuitId(circuit.id)
                        }}
                        onPointerEnter={() => {
                          if (draggedFixtureId) setDragOverCircuitId(circuit.id)
                        }}
                        onPointerUp={() => moveDraggedFixture(circuit.id)}
                        onDrop={(event) => {
                          event.preventDefault()
                          moveDraggedFixture(circuit.id)
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <button
                            aria-label={t('lighting.circuits.use').replace(
                              '{name}',
                              circuit.name ?? defaultCircuitName,
                            )}
                            aria-pressed={selected}
                            className={cn(
                              'h-3 w-3 rounded-full border',
                              selected
                                ? 'border-amber-400 bg-amber-400'
                                : 'border-muted-foreground',
                            )}
                            onClick={() => {
                              useViewer
                                .getState()
                                .setSelection({ selectedIds: [lightingSwitch.id], zoneId: null })
                              useLightingToolOptions.getState().setCircuitId(circuit.id)
                            }}
                            type="button"
                          />
                          <span className="w-6 text-[10px] text-muted-foreground">
                            {gangIndex + 1}구
                          </span>
                          <input
                            className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                            defaultValue={circuit.name ?? defaultCircuitName}
                            onBlur={(event) => {
                              const name = event.target.value.trim()
                              if (name && name !== circuit.name) updateNode(circuit.id, { name })
                            }}
                          />
                          <span className="text-[10px] text-muted-foreground">
                            조명 {lightCount}
                          </span>
                          <button
                            className={cn(
                              'rounded p-1',
                              circuit.enabled ? 'text-emerald-400' : 'text-muted-foreground',
                            )}
                            onClick={() => updateNode(circuit.id, { enabled: !circuit.enabled })}
                            title={
                              circuit.enabled
                                ? t('lighting.circuits.turnOff')
                                : t('lighting.circuits.turnOn')
                            }
                            type="button"
                          >
                            <Power className="h-3.5 w-3.5" />
                          </button>
                          <button
                            aria-label={t('lighting.circuits.removeFromSwitch')}
                            className="rounded px-1 text-muted-foreground hover:text-destructive disabled:opacity-30"
                            disabled={lightingSwitch.gangCount <= 1}
                            onClick={() => removeSwitchCircuit(lightingSwitch, circuit, gangIndex)}
                            type="button"
                          >
                            −
                          </button>
                        </div>
                        <div className="mt-1 space-y-1 pl-5">
                          {circuitFixtures.length === 0 ? (
                            <p className="rounded border border-dashed border-border/60 px-2 py-1 text-[10px] text-muted-foreground">
                              {dropTarget
                                ? t('lighting.circuits.dropFixture')
                                : t('lighting.circuits.noFixtures')}
                            </p>
                          ) : (
                            circuitFixtures.map((fixture, fixtureIndex) => {
                              const fixtureSelected = selectedIds[0] === fixture.id
                              const fixtureName =
                                fixture.name ??
                                fixture.asset?.name ??
                                t('lighting.fixture.defaultName').replace(
                                  '{n}',
                                  String(fixtureIndex + 1),
                                )
                              return (
                                <button
                                  aria-label={t('lighting.fixture.select').replace(
                                    '{name}',
                                    fixtureName,
                                  )}
                                  aria-pressed={fixtureSelected}
                                  className={cn(
                                    'flex w-full cursor-grab items-center gap-1.5 rounded border border-border/60 bg-background/50 px-1.5 py-1 text-left text-[10px] active:cursor-grabbing',
                                    fixtureSelected &&
                                      'border-teal-400 bg-teal-500/10 text-teal-100',
                                    draggedFixtureId === fixture.id && 'opacity-40',
                                  )}
                                  data-fixture-id={fixture.id}
                                  draggable
                                  key={fixture.id}
                                  onClick={() => {
                                    useLightingToolOptions.getState().setCircuitId(circuit.id)
                                    useViewer.getState().setSelection({
                                      selectedIds: [fixture.id],
                                      zoneId: null,
                                    })
                                  }}
                                  onDragEnd={() => {
                                    setDraggedFixtureId(null)
                                    setDragOverCircuitId(null)
                                  }}
                                  onDragStart={(event) => {
                                    event.dataTransfer.effectAllowed = 'move'
                                    event.dataTransfer.setData('text/plain', fixture.id)
                                    setDraggedFixtureId(fixture.id)
                                  }}
                                  onPointerDown={() => setDraggedFixtureId(fixture.id)}
                                  type="button"
                                >
                                  <GripVertical className="h-3 w-3 shrink-0 text-muted-foreground" />
                                  <span className="min-w-0 flex-1 truncate">{fixtureName}</span>
                                  {resolveLightingFixtureCount(fixture) > 1 ? (
                                    <span className="text-muted-foreground">
                                      ×{resolveLightingFixtureCount(fixture)}
                                    </span>
                                  ) : null}
                                </button>
                              )
                            })
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div> : null}
              </div>
            )
          })}
        </div>
      </section>
      <section className="mb-5">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('lighting.placeLights.heading')}
        </h3>
        <div className="grid grid-cols-2 gap-2">
          {(
            [
              [
                'point',
                'lighting.lightType.point.label',
                'lighting.lightType.point.desc',
                CircleDot,
              ],
              ['spot', 'lighting.lightType.spot.label', 'lighting.lightType.spot.desc', ScanLine],
              ['area', 'lighting.lightType.area.label', 'lighting.lightType.area.desc', Lightbulb],
              [
                'linear',
                'lighting.lightType.linear.label',
                'lighting.lightType.linear.desc',
                Minus,
              ],
            ] as const
          ).map(([type, labelKey, descriptionKey, Icon]) => (
            <button
              aria-pressed={
                mode === 'build' && activeTool === 'lighting-fixture' && lightType === type
              }
              className={cn(
                'flex flex-col items-center gap-1 rounded-lg border border-border p-3 hover:bg-muted',
                mode === 'build' &&
                  activeTool === 'lighting-fixture' &&
                  lightType === type &&
                  'border-amber-400 bg-amber-500/10',
              )}
              disabled={!levelId || !circuitId}
              key={type}
              onClick={() => placeFixture(type)}
              type="button"
            >
              <Icon className="h-5 w-5" />
              <span className="text-xs">{t(labelKey)}</span>
              <span className="text-[9px] text-muted-foreground">{t(descriptionKey)}</span>
            </button>
          ))}
        </div>
        {(lightType === 'point' || lightType === 'spot') && (
          <div className="mt-2 rounded-md border border-border bg-background/40 p-2">
            <div className="flex items-center gap-1.5">
              {(['single', 'array'] as const).map((mode) => (
                <button
                  aria-pressed={placement === mode}
                  className={cn(
                    'flex-1 rounded border border-border px-2 py-1 text-[11px] hover:bg-muted',
                    placement === mode && 'border-amber-400 bg-amber-500/10 text-amber-200',
                  )}
                  key={mode}
                  onClick={() => useLightingToolOptions.getState().setPlacement(mode)}
                  type="button"
                >
                  {t(mode === 'single' ? 'lighting.placement.single' : 'lighting.placement.array')}
                </button>
              ))}
              {placement === 'array' && (
                <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  {t('lighting.placement.count')}
                  <input
                    className="w-12 rounded-md border border-border bg-background px-1.5 py-1 text-right text-foreground"
                    max={50}
                    min={2}
                    onChange={(event) =>
                      useLightingToolOptions.getState().setArrayCount(Number(event.target.value))
                    }
                    type="number"
                    value={arrayCount}
                  />
                </label>
              )}
            </div>
            {placement === 'array' && (
              <p className="mt-1.5 text-[10px] text-muted-foreground">
                {t('lighting.placement.arrayHint')}
              </p>
            )}
          </div>
        )}
        {(lightType === 'point' || lightType === 'spot') && <LightingItemPicker />}
        <label className="mt-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          {t('lighting.mountHeight')}
          <input
            className="w-20 rounded-md border border-border bg-background px-2 py-1 text-right text-foreground"
            min={0.1}
            onChange={(event) =>
              useLightingToolOptions.getState().setFixtureHeight(Number(event.target.value))
            }
            step={0.1}
            type="number"
            value={fixtureHeight}
          />
          <span>m</span>
        </label>
      </section>
    </div>
  )
}

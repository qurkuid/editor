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
  CircleDot,
  Lightbulb,
  Minus,
  Plus,
  Power,
  ScanLine,
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
        {items.map((item) => {
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
      </div>
    </div>
  )
}

export function LightingTab() {
  const t = useT()
  const levelId = useViewer((state) => state.selection.levelId)
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

  useEffect(() => {
    const nextCircuitId = circuits.some((circuit) => circuit.id === circuitId)
      ? circuitId
      : (circuits[0]?.id ?? null)
    if (nextCircuitId === circuitId) return
    useLightingToolOptions.getState().setCircuitId(nextCircuitId)
  }, [circuitId, circuits])

  const addCircuit = () => {
    if (!levelId) return
    const circuitNumber = Math.max(0, ...circuits.map((circuit) => circuit.circuitNumber)) + 1
    const circuit = LightingCircuitNode.parse({
      name: t('lighting.circuits.defaultName').replace('{n}', String(circuitNumber)),
      circuitNumber,
      enabled: true,
      parentId: levelId,
    })
    useScene.getState().createNode(circuit as AnyNode, levelId as AnyNodeId)
    useLightingToolOptions.getState().setCircuitId(circuit.id)
  }

  const placeFixture = (type: LightingFixtureNode['lightType']) => {
    useLightingToolOptions.getState().setLightType(type)
    activateLightingTool('lighting-fixture')
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

      <section className="mb-5" id="lighting-circuits">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('lighting.circuits.heading')}
          </h3>
          <button
            className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-40"
            disabled={!levelId}
            onClick={addCircuit}
            type="button"
          >
            <Plus className="h-3.5 w-3.5" /> {t('lighting.circuits.add')}
          </button>
        </div>
        <div className="space-y-2">
          {circuits.length === 0 && (
            <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              {t('lighting.circuits.empty')}
            </div>
          )}
          {circuits.map((circuit) => {
            // Counts lights, not nodes — a divided run is one node carrying
            // `count` lights.
            const lightCount = fixtures
              .filter((fixture) => fixture.circuitId === circuit.id)
              .reduce((total, fixture) => total + resolveLightingFixtureCount(fixture), 0)
            const switchCount = switches.filter((item) => item.circuitId === circuit.id).length
            const selected = circuit.id === circuitId
            const defaultCircuitName = t('lighting.circuits.defaultName').replace(
              '{n}',
              String(circuit.circuitNumber),
            )
            return (
              <div
                className={cn(
                  'rounded-lg border p-2',
                  selected ? 'border-amber-400/60 bg-amber-500/8' : 'border-border',
                )}
                key={circuit.id}
              >
                <div className="flex items-center gap-2">
                  <button
                    aria-label={t('lighting.circuits.use').replace(
                      '{name}',
                      circuit.name ?? defaultCircuitName,
                    )}
                    className={cn(
                      'h-3 w-3 rounded-full border',
                      selected ? 'border-amber-400 bg-amber-400' : 'border-muted-foreground',
                    )}
                    onClick={() => useLightingToolOptions.getState().setCircuitId(circuit.id)}
                    type="button"
                  />
                  <input
                    className="min-w-0 flex-1 bg-transparent font-medium outline-none"
                    defaultValue={circuit.name ?? defaultCircuitName}
                    onBlur={(event) => {
                      const name = event.target.value.trim()
                      if (name && name !== circuit.name) updateNode(circuit.id, { name })
                    }}
                  />
                  <button
                    className={cn(
                      'rounded-md p-1.5',
                      circuit.enabled
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : 'bg-muted text-muted-foreground',
                    )}
                    onClick={() => updateNode(circuit.id, { enabled: !circuit.enabled })}
                    title={
                      circuit.enabled
                        ? t('lighting.circuits.turnOff')
                        : t('lighting.circuits.turnOn')
                    }
                    type="button"
                  >
                    <Power className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-1 pl-5 text-[11px] text-muted-foreground">
                  {t('lighting.circuits.summary')
                    .replace('{lights}', String(lightCount))
                    .replace('{switches}', String(switchCount))
                    .replace('{state}', circuit.enabled ? 'ON' : 'OFF')}
                </div>
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
        <section className="mt-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t('lighting.placeSwitch.heading')}
          </h3>
          <button
            className={cn(
              'flex w-full items-center gap-3 rounded-lg border border-border p-3 text-left hover:bg-muted',
              mode === 'build' &&
                activeTool === 'lighting-switch' &&
                'border-teal-400 bg-teal-500/10',
            )}
            disabled={!levelId || !circuitId}
            onClick={() => activateLightingTool('lighting-switch')}
            type="button"
          >
            <ToggleLeft className="h-5 w-5 text-teal-400" />
            <span>
              <span className="block font-medium">{t('lighting.placeSwitch.wallSwitch')}</span>
              <span className="block text-xs text-muted-foreground">
                {t('lighting.placeSwitch.desc')}
              </span>
            </span>
          </button>
          <div className="mt-2 grid grid-cols-2 gap-2 rounded-md border border-border bg-background/40 p-2">
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
        </section>
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

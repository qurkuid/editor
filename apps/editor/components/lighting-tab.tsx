'use client'

import {
  type AnyNode,
  type AnyNodeId,
  LightingCircuitNode,
  type LightingFixtureNode,
  type LightingSwitchNode,
  useScene,
} from '@pascal-app/core'
import { useEditor, useT } from '@pascal-app/editor'
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
import { useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'

function activateLightingTool(tool: 'lighting-fixture' | 'lighting-switch') {
  const editor = useEditor.getState()
  editor.setPhase('structure')
  editor.setStructureLayer('elements')
  editor.setCatalogCategory(null)
  editor.setMode('build')
  editor.setTool(tool)
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

export function LightingTab() {
  const t = useT()
  const levelId = useViewer((state) => state.selection.levelId)
  const activeTool = useEditor((state) => state.tool)
  const mode = useEditor((state) => state.mode)
  const lightType = useLightingToolOptions((state) => state.lightType)
  const circuitId = useLightingToolOptions((state) => state.circuitId)
  const fixtureHeight = useLightingToolOptions((state) => state.fixtureHeight)
  const switchHeight = useLightingToolOptions((state) => state.switchHeight)
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
            const lightCount = fixtures.filter((fixture) => fixture.circuitId === circuit.id).length
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

      <section>
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
    </div>
  )
}

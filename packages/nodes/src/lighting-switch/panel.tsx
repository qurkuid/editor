'use client'

import {
  type AnyNodeId,
  type LightingCircuitNode,
  type LightingSwitchNode,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  PanelWrapper,
  SliderControl,
  useT,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Power, Trash2 } from 'lucide-react'
import { useMemo } from 'react'
import { resolveLightingSwitchCircuitIds } from './circuits'

export default function LightingSwitchPanel() {
  const t = useT()
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const setSelection = useViewer((state) => state.setSelection)
  const node = useScene((state) =>
    selectedId
      ? (state.nodes[selectedId as AnyNodeId] as LightingSwitchNode | undefined)
      : undefined,
  )
  const nodes = useScene((state) => state.nodes)
  const circuits = useMemo(
    () =>
      Object.values(nodes)
        .filter(
          (candidate): candidate is LightingCircuitNode => candidate.type === 'lighting-circuit',
        )
        .sort((a, b) => a.circuitNumber - b.circuitNumber),
    [nodes],
  )
  const updateNode = useScene((state) => state.updateNode)
  const deleteNode = useScene((state) => state.deleteNode)
  if (!(selectedId && node?.type === 'lighting-switch')) return null
  const circuitIds = resolveLightingSwitchCircuitIds(node)
  const update = (patch: Partial<LightingSwitchNode>) => updateNode(node.id, patch)

  return (
    <PanelWrapper
      onClose={() => setSelection({ selectedIds: [] })}
      title={t('panel.lightSwitch')}
      width={320}
    >
      <PanelSection title={t('lighting.placeSwitch.settings')}>
        <div className="space-y-2">
          {circuitIds.map((circuitId, index) => {
            const circuit = circuits.find((candidate) => candidate.id === circuitId)
            return (
              <div className="flex items-center gap-2" key={index}>
                <label className="w-8 text-xs text-muted-foreground">{index + 1}구</label>
                <select
                  aria-label={`${index + 1}구 회로`}
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground"
                  onChange={(event) => {
                    const nextCircuitIds = [...circuitIds]
                    nextCircuitIds[index] = event.target.value || null
                    update({ circuitId: nextCircuitIds[0] ?? null, circuitIds: nextCircuitIds })
                  }}
                  value={circuitId ?? ''}
                >
                  <option value="">{t('panel.unassigned')}</option>
                  {circuits.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name ?? `Circuit ${candidate.circuitNumber}`}
                    </option>
                  ))}
                </select>
                <button
                  aria-label={circuit?.enabled ? 'Turn circuit off' : 'Turn circuit on'}
                  className="rounded-md border border-border p-2 disabled:opacity-40"
                  disabled={!circuit}
                  onClick={() => circuit && updateNode(circuit.id, { enabled: !circuit.enabled })}
                  type="button"
                >
                  <Power className="h-4 w-4" />
                </button>
              </div>
            )
          })}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-border pt-3">
          <label className="text-xs text-muted-foreground">
            {t('lighting.placeSwitch.count')}
            <select
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground"
              onChange={(event) => {
                const gangCount = Number(event.target.value)
                const circuitIds = Array.from(
                  { length: gangCount },
                  (_, index) => resolveLightingSwitchCircuitIds(node)[index] ?? null,
                )
                update({ circuitId: circuitIds[0] ?? null, circuitIds, gangCount })
              }}
              value={node.gangCount}
            >
              {[1, 2, 3, 4].map((count) => (
                <option key={count} value={count}>
                  {count}구
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted-foreground">
            {t('lighting.placeSwitch.shape')}
            <select
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground"
              onChange={(event) =>
                update({ switchShape: event.target.value === 'round' ? 'round' : 'rectangle' })
              }
              value={node.switchShape}
            >
              <option value="rectangle">{t('lighting.placeSwitch.rectangle')}</option>
              <option value="round">{t('lighting.placeSwitch.round')}</option>
            </select>
          </label>
        </div>
      </PanelSection>
      <PanelSection title={t('common.position')}>
        {(['X', 'Y', 'Z'] as const).map((label, index) => (
          <SliderControl
            key={label}
            label={label}
            max={(node.position[index] ?? 0) + 5}
            min={(node.position[index] ?? 0) - 5}
            onChange={(value) => {
              const position = [...node.position] as [number, number, number]
              position[index] = value
              update({ position })
            }}
            precision={2}
            step={0.01}
            unit="m"
            value={node.position[index] ?? 0}
          />
        ))}
      </PanelSection>
      <PanelSection title={t('panel.actions')}>
        <ActionGroup>
          <ActionButton
            icon={<Trash2 className="h-4 w-4" />}
            label={t('common.delete')}
            onClick={() => {
              deleteNode(node.id)
              setSelection({ selectedIds: [] })
            }}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}

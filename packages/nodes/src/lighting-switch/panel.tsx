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
  const circuit = circuits.find((candidate) => candidate.id === node.circuitId)
  const update = (patch: Partial<LightingSwitchNode>) => updateNode(node.id, patch)

  return (
    <PanelWrapper
      onClose={() => setSelection({ selectedIds: [] })}
      title={t('panel.lightSwitch')}
      width={320}
    >
      <PanelSection title={t('panel.circuit')}>
        <select
          className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground"
          onChange={(event) => update({ circuitId: event.target.value || null })}
          value={node.circuitId ?? ''}
        >
          <option value="">{t('panel.unassigned')}</option>
          {circuits.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name ?? `Circuit ${candidate.circuitNumber}`}
            </option>
          ))}
        </select>
        <ActionButton
          disabled={!circuit}
          icon={<Power className="h-4 w-4" />}
          label={circuit?.enabled ? 'Turn circuit off' : 'Turn circuit on'}
          onClick={() => circuit && updateNode(circuit.id, { enabled: !circuit.enabled })}
        />
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

'use client'

import {
  type AnyNodeId,
  type LightingCircuitNode,
  type LightingFixtureNode,
  useScene,
} from '@pascal-app/core'
import {
  ActionButton,
  ActionGroup,
  PanelSection,
  PanelWrapper,
  SliderControl,
  ToggleControl,
  useT,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useMemo } from 'react'

export default function LightingFixturePanel() {
  const t = useT()
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const setSelection = useViewer((state) => state.setSelection)
  const node = useScene((state) =>
    selectedId
      ? (state.nodes[selectedId as AnyNodeId] as LightingFixtureNode | undefined)
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
  if (!(selectedId && node?.type === 'lighting-fixture')) return null

  const update = (patch: Partial<LightingFixtureNode>) => updateNode(node.id, patch)
  // A point/spot node carrying drafted endpoints is a divided run — one node,
  // `count` lights. Its count is editable here; every other property already
  // applies to the whole run because the run IS the node.
  const isRun = (node.lightType === 'point' || node.lightType === 'spot') && node.start && node.end
  return (
    <PanelWrapper
      onClose={() => setSelection({ selectedIds: [] })}
      title={t('panel.light')}
      width={320}
    >
      <PanelSection title={t('panel.source')}>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Type
          <select
            className="rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground"
            onChange={(event) =>
              update({ lightType: event.target.value as LightingFixtureNode['lightType'] })
            }
            value={node.lightType}
          >
            <option value="point">{t('panel.point')}</option>
            <option value="spot">{t('panel.spot')}</option>
            <option value="area">{t('panel.area')}</option>
            <option value="linear">{t('panel.linear')}</option>
          </select>
        </label>
        <ToggleControl
          checked={node.enabled}
          label={t('panel.enabled')}
          onChange={(enabled) => update({ enabled })}
        />
        <SliderControl
          label={t('panel.brightness')}
          max={5000}
          min={0}
          onChange={(lumens) => update({ lumens })}
          step={50}
          unit="lm"
          value={node.lumens}
        />
        <SliderControl
          label={t('panel.temperature')}
          max={6500}
          min={1800}
          onChange={(colorTemperature) => update({ colorTemperature })}
          step={100}
          unit="K"
          value={node.colorTemperature}
        />
        <SliderControl
          label={t('panel.range')}
          max={30}
          min={0.5}
          onChange={(range) => update({ range })}
          step={0.5}
          unit="m"
          value={node.range}
        />
        {node.lightType === 'spot' && (
          <SliderControl
            label={t('panel.beam')}
            max={120}
            min={5}
            onChange={(beamAngle) => update({ beamAngle })}
            step={1}
            unit="°"
            value={node.beamAngle}
          />
        )}
        {node.lightType === 'linear' && (
          <SliderControl
            label={t('panel.width')}
            max={0.5}
            min={0.01}
            onChange={(linearWidth) => update({ linearWidth })}
            precision={2}
            step={0.01}
            unit="m"
            value={node.linearWidth}
          />
        )}
        {isRun && (
          <SliderControl
            label={t('panel.count')}
            max={50}
            min={2}
            onChange={(count) => update({ count: Math.round(count) })}
            step={1}
            value={node.count ?? 2}
          />
        )}
        <SliderControl
          label={t('panel.rotation')}
          max={180}
          min={-180}
          onChange={(degrees) =>
            update({
              rotation: [node.rotation[0], (degrees * Math.PI) / 180, node.rotation[2]],
            })
          }
          step={5}
          unit="°"
          value={Math.round((node.rotation[1] * 180) / Math.PI)}
        />
      </PanelSection>
      <PanelSection title={t('panel.circuit')}>
        <select
          className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm text-foreground"
          onChange={(event) => update({ circuitId: event.target.value || null })}
          value={node.circuitId ?? ''}
        >
          <option value="">{t('panel.independent')}</option>
          {circuits.map((circuit) => (
            <option key={circuit.id} value={circuit.id}>
              {circuit.name ?? `Circuit ${circuit.circuitNumber}`}
            </option>
          ))}
        </select>
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

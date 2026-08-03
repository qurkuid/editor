'use client'

import type { GuideNode, ScanNode } from '@pascal-app/core'
import { LocateFixed, RotateCcw, Ruler } from 'lucide-react'
import { ActionButton, ActionGroup } from '../controls/action-button'
import { PanelSection } from '../controls/panel-section'
import { SliderControl } from '../controls/slider-control'

type ReferenceNode = GuideNode | ScanNode

function AxisLabel({ axis, kind }: { readonly axis: string; readonly kind: string }) {
  return (
    <>
      {axis}
      <sub className="ml-[1px] text-[11px] opacity-70">{kind}</sub>
    </>
  )
}

function degrees(radians: number) {
  return Math.round((radians * 180) / Math.PI)
}

export function ReferenceTransformSections({
  node,
  onUpdate,
}: {
  readonly node: ReferenceNode
  readonly onUpdate: (patch: Partial<ReferenceNode>) => void
}) {
  const updatePosition = (axis: 0 | 1 | 2, value: number) => {
    const position = [...node.position] as [number, number, number]
    position[axis] = value
    onUpdate({ position })
  }

  const updateRotation = (axis: 0 | 1 | 2, value: number) => {
    const rotation = [...node.rotation] as [number, number, number]
    rotation[axis] = (value * Math.PI) / 180
    onUpdate({ rotation })
  }

  return (
    <>
      {node.type === 'guide' && (
        <PanelSection title="Quick Actions">
          <ActionGroup>
            <ActionButton
              icon={<LocateFixed className="h-3.5 w-3.5" />}
              label="Center"
              onClick={() => onUpdate({ position: [0, node.position[1], 0] })}
            />
            <ActionButton
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              label="Reset Rotation"
              onClick={() => onUpdate({ rotation: [0, 0, 0] })}
            />
          </ActionGroup>
          <ActionGroup>
            <ActionButton
              icon={<Ruler className="h-3.5 w-3.5" />}
              label="Reset Image Scale"
              onClick={() => onUpdate({ scale: 1 })}
            />
          </ActionGroup>
        </PanelSection>
      )}

      <PanelSection title="Position">
        {(['X', 'Y', 'Z'] as const).map((axis, index) => {
          const value = node.position[index] ?? 0
          return (
            <SliderControl
              key={axis}
              label={<AxisLabel axis={axis} kind="pos" />}
              max={50}
              min={-50}
              onChange={(nextValue) => updatePosition(index as 0 | 1 | 2, nextValue)}
              precision={2}
              step={0.1}
              unit="m"
              value={Math.round(value * 100) / 100}
            />
          )
        })}
      </PanelSection>

      <PanelSection title="Rotation">
        {(['X', 'Y', 'Z'] as const).map((axis, index) => {
          const value = node.rotation[index] ?? 0
          return (
            <SliderControl
              key={axis}
              label={<AxisLabel axis={axis} kind="rot" />}
              max={180}
              min={-180}
              onChange={(nextValue) => updateRotation(index as 0 | 1 | 2, nextValue)}
              precision={0}
              step={1}
              unit="°"
              value={degrees(value)}
            />
          )
        })}
      </PanelSection>

      <PanelSection title="Scale & Opacity">
        <SliderControl
          label={<AxisLabel axis="XYZ" kind="scale" />}
          max={10}
          min={0.01}
          onChange={(value) => {
            if (value > 0) {
              onUpdate({ scale: value })
            }
          }}
          precision={2}
          step={0.1}
          value={Math.round(node.scale * 100) / 100}
        />
        <SliderControl
          label="Opacity"
          max={100}
          min={0}
          onChange={(value) => onUpdate({ opacity: value })}
          precision={0}
          step={1}
          unit="%"
          value={node.opacity}
        />
      </PanelSection>
    </>
  )
}

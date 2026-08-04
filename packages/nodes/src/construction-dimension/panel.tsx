'use client'

import {
  type AnyNode,
  type AnyNodeId,
  type ConstructionDimensionDatumPolicy,
  type ConstructionDimensionDrawingPresentation,
  type ConstructionDimensionImperialPrecision,
  type ConstructionDimensionMetricNotation,
  type ConstructionDimensionNode,
  type ConstructionDimensionTerminator,
  type ConstructionDimensionTextPosition,
  type ConstructionDrawingType,
  resolveConstructionDimensionDrawingOverride,
  resolveConstructionDimensionDrawingPresentation,
  setConstructionDimensionDrawingPresentation,
  setConstructionDimensionDrawingSuppressedSegments,
  useScene,
} from '@pascal-app/core'
import type { MessageId } from '@pascal-app/editor'
import {
  ActionButton,
  ActionGroup,
  DRAWING_TYPE_OPTIONS,
  PanelSection,
  PanelWrapper,
  SliderControl,
  triggerSFX,
  useDrawingView,
  useT,
} from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

const MODE_LABELS: Record<ConstructionDimensionNode['mode'], string> = {
  linear: 'Linear',
  radius: 'Radius',
  diameter: 'Diameter',
  'center-mark': 'Center mark',
  chord: 'Chord',
  'arc-length': 'Arc length',
  angular: 'Angular',
  coordinate: 'Coordinate',
}

const DATUM_POLICY_OPTIONS = (
  t: (key: MessageId) => string,
): Array<{ label: string; value: ConstructionDimensionDatumPolicy }> => [
  { label: t('panel.centerline'), value: 'centerline' },
  { label: t('panel.wallFace'), value: 'wall-face' },
  { label: t('panel.structuralFace'), value: 'structural-face' },
  { label: t('panel.finishFace'), value: 'finish-face' },
]

const TERMINATOR_OPTIONS = (
  t: (key: MessageId) => string,
): Array<{ label: string; value: ConstructionDimensionTerminator }> => [
  { label: t('panel.architecturalTick'), value: 'architectural-tick' },
  { label: t('panel.filledArrow'), value: 'filled-arrow' },
  { label: t('panel.openArrow'), value: 'open-arrow' },
  { label: t('panel.dot'), value: 'dot' },
]

const TEXT_POSITION_OPTIONS = (
  t: (key: MessageId) => string,
): Array<{ label: string; value: ConstructionDimensionTextPosition }> => [
  { label: t('panel.aboveLine'), value: 'above' },
  { label: t('panel.centeredOnLine'), value: 'centered' },
]

const IMPERIAL_PRECISION_OPTIONS = (
  t: (key: MessageId) => string,
): Array<{
  label: string
  value: ConstructionDimensionImperialPrecision
}> => [
  { label: t('panel.nearestInch'), value: '1' },
  { label: t('panel.nearest12Inch'), value: '1/2' },
  { label: t('panel.nearest14Inch'), value: '1/4' },
  { label: t('panel.nearest18Inch'), value: '1/8' },
  { label: t('panel.nearest116Inch'), value: '1/16' },
]

const METRIC_NOTATION_OPTIONS = (
  t: (key: MessageId) => string,
): Array<{
  label: string
  value: ConstructionDimensionMetricNotation
}> => [
  { label: t('chrome.unitMeters'), value: 'meters' },
  { label: t('chrome.unitMillimeters'), value: 'millimeters' },
]

export default function ConstructionDimensionPanel() {
  const t = useT()
  const selectedId = useViewer((state) => state.selection.selectedIds[0])
  const setSelection = useViewer((state) => state.setSelection)
  const dimension = useScene((state) => {
    const node = selectedId ? state.nodes[selectedId as AnyNodeId] : undefined
    return node?.type === 'construction-dimension' ? node : null
  })
  const updateNode = useScene((state) => state.updateNode)
  const deleteNode = useScene((state) => state.deleteNode)
  const activeDrawingType = useDrawingView((state) => state.drawingType)

  if (!(dimension && selectedId)) return null
  const update = (patch: Partial<ConstructionDimensionNode>) => updateNode(dimension.id, patch)
  const supportsCenterMark = ['radius', 'diameter', 'arc-length', 'angular'].includes(
    dimension.mode,
  )
  const activeDrawingLabel =
    DRAWING_TYPE_OPTIONS.find((option) => option.id === activeDrawingType)?.label ?? 'Floor plan'
  const activePresentation = resolveConstructionDimensionDrawingPresentation(
    dimension,
    activeDrawingType,
  )
  const activeDrawingOverride = resolveConstructionDimensionDrawingOverride(
    dimension,
    activeDrawingType,
  )
  const suppressedSegmentsText = formatSuppressedSegments(
    activeDrawingOverride?.suppressedSegmentIndexes ?? [],
  )
  const updateDrawingPresentation = (
    drawingType: ConstructionDrawingType,
    presentation: ConstructionDimensionDrawingPresentation,
  ) => {
    const drawingOverrides = setConstructionDimensionDrawingPresentation(
      dimension,
      drawingType,
      presentation,
    )
    const firstFoundationController =
      presentation === 'controlled' && !dimension.controllingDimensionId
        ? selectFoundationControllers(useScene.getState().nodes, dimension.id)[0]
        : undefined
    update({
      drawingOverrides,
      ...(presentation === 'controlled' && !dimension.controllingDimensionId
        ? { controllingDimensionId: firstFoundationController?.id ?? null }
        : {}),
    })
  }
  const updateSuppressedSegments = (value: string) => {
    update({
      drawingOverrides: setConstructionDimensionDrawingSuppressedSegments(
        dimension,
        activeDrawingType,
        parseSuppressedSegments(value),
      ),
    })
  }

  return (
    <PanelWrapper
      icon="/icons/blueprint.webp"
      onClose={() => setSelection({ selectedIds: [] })}
      title={t('panel.constructionDimension')}
      width={320}
    >
      <PanelSection title={t('panel.dimension')}>
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="text-muted-foreground">{t('panel.mode')}</span>
          <span className="font-medium text-foreground">{MODE_LABELS[dimension.mode]}</span>
        </div>
        <SliderControl
          label={t('panel.featureCount')}
          max={999}
          min={1}
          onChange={(featureCount) => update({ featureCount })}
          precision={0}
          step={1}
          value={dimension.featureCount}
        />
        {supportsCenterMark ? (
          <label className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{t('panel.centerMark')}</span>
            <input
              checked={dimension.showCenterMark}
              onChange={(event) => update({ showCenterMark: event.target.checked })}
              type="checkbox"
            />
          </label>
        ) : null}
      </PanelSection>

      <PanelSection title={t('panel.drawingCoordination')}>
        <SelectField
          label={t('panel.primaryDrawing')}
          onChange={(drawingType) =>
            update({ drawingType: drawingType as ConstructionDrawingType })
          }
          options={DRAWING_TYPE_OPTIONS.map((option) => ({
            label: option.label,
            value: option.id,
          }))}
          value={dimension.drawingType}
        />
        <SelectField
          label={`${activeDrawingLabel} presentation`}
          onChange={(presentation) =>
            updateDrawingPresentation(
              activeDrawingType,
              presentation as ConstructionDimensionDrawingPresentation,
            )
          }
          options={[
            { label: t('panel.shown'), value: 'shown' },
            { label: t('panel.omitted'), value: 'omit' },
            ...(activeDrawingType === 'floor-plan'
              ? [{ label: t('panel.controlledByFoundation'), value: 'controlled' }]
              : []),
          ]}
          value={activePresentation}
        />
        {activeDrawingType === 'floor-plan' && activePresentation === 'controlled' ? (
          <FoundationControllerField
            dimensionId={dimension.id}
            onChange={(controllingDimensionId) =>
              update({
                controllingDimensionId,
              })
            }
            value={dimension.controllingDimensionId ?? ''}
          />
        ) : null}
        <p className="text-muted-foreground text-xs">
          Linked dimensions reuse the controller's associative anchors and update with it.
        </p>
        <TextField
          label={`${activeDrawingLabel} suppressed segments`}
          onCommit={updateSuppressedSegments}
          placeholder="e.g. 2, 4"
          value={suppressedSegmentsText}
        />
        <p className="text-muted-foreground text-xs">
          Segment numbers are one-based and apply only in this drawing view.
        </p>
      </PanelSection>

      <PanelSection title={t('panel.notation')}>
        <TextField
          label={t('panel.prefix')}
          onCommit={(prefix) => update({ prefix })}
          value={dimension.prefix}
        />
        <TextField
          label={t('panel.suffix')}
          onCommit={(suffix) => update({ suffix })}
          value={dimension.suffix}
        />
        <TextField
          label={t('panel.textOverride')}
          onCommit={(textOverride) => update({ textOverride: textOverride || null })}
          placeholder={t('panel.useMeasuredValue')}
          value={dimension.textOverride ?? ''}
        />
      </PanelSection>

      <PanelSection title={t('panel.standards')}>
        <SelectField
          label={t('panel.datumPolicy')}
          onChange={(datumPolicy) =>
            update({ datumPolicy: datumPolicy as ConstructionDimensionDatumPolicy })
          }
          options={DATUM_POLICY_OPTIONS(t)}
          value={dimension.datumPolicy}
        />
        <SelectField
          label={t('panel.terminator')}
          onChange={(terminator) =>
            update({ terminator: terminator as ConstructionDimensionTerminator })
          }
          options={TERMINATOR_OPTIONS(t)}
          value={dimension.terminator}
        />
        <SelectField
          label={t('panel.textPosition')}
          onChange={(textPosition) =>
            update({ textPosition: textPosition as ConstructionDimensionTextPosition })
          }
          options={TEXT_POSITION_OPTIONS(t)}
          value={dimension.textPosition}
        />
        <SelectField
          label={t('panel.imperialPrecision')}
          onChange={(imperialPrecision) =>
            update({
              imperialPrecision: imperialPrecision as ConstructionDimensionImperialPrecision,
            })
          }
          options={IMPERIAL_PRECISION_OPTIONS(t)}
          value={dimension.imperialPrecision}
        />
        <SelectField
          label={t('panel.metricNotation')}
          onChange={(metricNotation) =>
            update({ metricNotation: metricNotation as ConstructionDimensionMetricNotation })
          }
          options={METRIC_NOTATION_OPTIONS(t)}
          value={dimension.metricNotation}
        />
        <SliderControl
          label={t('panel.extensionGap')}
          max={0.5}
          min={0}
          onChange={(extensionStartGap) => update({ extensionStartGap })}
          precision={3}
          step={0.005}
          unit="m"
          value={dimension.extensionStartGap}
        />
        <SliderControl
          label={t('panel.extensionOvershoot')}
          max={0.5}
          min={0}
          onChange={(extensionOvershoot) => update({ extensionOvershoot })}
          precision={3}
          step={0.005}
          unit="m"
          value={dimension.extensionOvershoot}
        />
      </PanelSection>

      <PanelSection title={t('panel.actions')}>
        <ActionGroup>
          <ActionButton
            className="border-red-500/40 text-red-200 hover:bg-red-500/15"
            icon={<Trash2 className="h-4 w-4" />}
            label={t('common.delete')}
            onClick={() => {
              triggerSFX('sfx:structure-delete')
              deleteNode(dimension.id)
              setSelection({ selectedIds: [] })
            }}
          />
        </ActionGroup>
      </PanelSection>
    </PanelWrapper>
  )
}

function selectFoundationControllers(
  nodes: Record<string, AnyNode>,
  excludedId: AnyNodeId,
): ConstructionDimensionNode[] {
  return Object.values(nodes).filter(
    (candidate): candidate is ConstructionDimensionNode =>
      candidate.type === 'construction-dimension' &&
      candidate.id !== excludedId &&
      candidate.drawingType === 'foundation-plan',
  )
}

function FoundationControllerField({
  dimensionId,
  value,
  onChange,
}: {
  dimensionId: AnyNodeId
  value: string
  onChange: (value: NonNullable<ConstructionDimensionNode['controllingDimensionId']>) => void
}) {
  const t = useT()
  const foundationControllers = useScene(
    useShallow((state) => selectFoundationControllers(state.nodes, dimensionId)),
  )
  return (
    <SelectField
      disabled={foundationControllers.length === 0}
      label={t('panel.foundationController')}
      onChange={(controllingDimensionId) =>
        onChange(
          controllingDimensionId as NonNullable<
            ConstructionDimensionNode['controllingDimensionId']
          >,
        )
      }
      options={foundationControllers.map((controller) => ({
        label: controller.name || 'Foundation dimension',
        value: controller.id,
      }))}
      placeholder={t('panel.noFoundationDimensions')}
      value={value}
    />
  )
}

function parseSuppressedSegments(value: string): number[] {
  return [
    ...new Set(
      value
        .split(/[,\s]+/)
        .map((part) => Number.parseInt(part, 10))
        .filter((index) => Number.isInteger(index) && index > 0)
        .map((index) => index - 1),
    ),
  ].sort((left, right) => left - right)
}

function formatSuppressedSegments(indexes: readonly number[]): string {
  return indexes.map((index) => index + 1).join(', ')
}

function SelectField({
  label,
  value,
  options,
  placeholder,
  disabled,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ label: string; value: string }>
  placeholder?: string
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <select
        className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground disabled:opacity-50"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {placeholder && options.length === 0 ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function TextField({
  label,
  value,
  placeholder,
  onCommit,
}: {
  label: string
  value: string
  placeholder?: string
  onCommit: (value: string) => void
}) {
  return (
    <label className="space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <input
        className="w-full rounded-md border border-border/70 bg-background px-2 py-1.5 text-foreground"
        defaultValue={value}
        key={value}
        onBlur={(event) => onCommit(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  )
}

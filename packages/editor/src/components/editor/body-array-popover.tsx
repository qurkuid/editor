'use client'

import { type Dispatch, type FormEvent, type SetStateAction, useState } from 'react'
import { useT } from '../../i18n/use-t'
import type { BodyArrayRequest } from '../../lib/body-array'

type BodyArrayPopoverProps = {
  readonly error?: string | null
  readonly floorplan?: boolean
  readonly onCancel: () => void
  readonly onSubmit: (request: BodyArrayRequest) => void
}

type Triple = [string, string, string]

const offsetLabels = [
  'bodyModeling.arrayOffsetX',
  'bodyModeling.arrayOffsetY',
  'bodyModeling.arrayOffsetZ',
] as const
const centerLabels = [
  'bodyModeling.arrayCenterX',
  'bodyModeling.arrayCenterY',
  'bodyModeling.arrayCenterZ',
] as const
const axisLabels = [
  'bodyModeling.arrayAxisX',
  'bodyModeling.arrayAxisY',
  'bodyModeling.arrayAxisZ',
] as const

function toPoint(values: Triple): [number, number, number] {
  return values.map((value) => Number(value)) as [number, number, number]
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 'any',
}: {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly min?: number
  readonly max?: number
  readonly step?: number | 'any'
}) {
  return (
    <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[10px] text-muted-foreground">
      <span>{label}</span>
      <input
        className="w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground"
        max={max}
        min={min}
        onChange={(event) => onChange(event.target.value)}
        step={step}
        type="number"
        value={value}
      />
    </label>
  )
}

export function BodyArrayPopover({
  error,
  floorplan = false,
  onCancel,
  onSubmit,
}: BodyArrayPopoverProps) {
  const t = useT()
  const [kind, setKind] = useState<'linear' | 'circular'>('linear')
  const [count, setCount] = useState('2')
  const [offset, setOffset] = useState<Triple>(['1', '0', '0'])
  const [center, setCenter] = useState<Triple>(['0', '0', '0'])
  const [axis, setAxis] = useState<Triple>(['0', '1', '0'])
  const [angle, setAngle] = useState('360')
  const [angleUnit, setAngleUnit] = useState<'deg' | 'rad'>('deg')
  const [fullCircle, setFullCircle] = useState(true)

  const updateTriple = (setter: Dispatch<SetStateAction<Triple>>, index: number, value: string) => {
    setter(
      (current) =>
        current.map((entry, currentIndex) => (currentIndex === index ? value : entry)) as Triple,
    )
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const parsedCount = Number(count)
    if (kind === 'linear') {
      onSubmit({ kind, input: { count: parsedCount, offset: toPoint(offset) } })
      return
    }
    const parsedAngle = Number(angle)
    onSubmit({
      kind,
      input: {
        count: parsedCount,
        center: toPoint(center),
        axis: floorplan ? [0, 1, 0] : toPoint(axis),
        angle: fullCircle
          ? undefined
          : angleUnit === 'deg'
            ? (parsedAngle * Math.PI) / 180
            : parsedAngle,
        fullCircle,
      },
    })
  }

  return (
    <form
      aria-label={t('bodyModeling.array')}
      className="pointer-events-auto mt-1 flex w-72 flex-col gap-2 rounded-lg border border-border bg-background/95 p-2 shadow-xl backdrop-blur-md"
      data-testid="body-array-popover"
      onSubmit={submit}
    >
      <div className="flex items-center gap-1">
        <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[10px] text-muted-foreground">
          <span>{t('bodyModeling.arrayMode')}</span>
          <select
            className="rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground"
            onChange={(event) => setKind(event.target.value as 'linear' | 'circular')}
            value={kind}
          >
            <option value="linear">{t('bodyModeling.arrayLinear')}</option>
            <option value="circular">{t('bodyModeling.arrayCircular')}</option>
          </select>
        </label>
        <NumberField
          label={t('bodyModeling.arrayCount')}
          max={100}
          min={2}
          onChange={setCount}
          step={1}
          value={count}
        />
      </div>

      {kind === 'linear' ? (
        <div className="flex gap-1">
          {offset.map((value, index) => (
            <NumberField
              key={index}
              label={t(offsetLabels[index]!)}
              onChange={(next) => updateTriple(setOffset, index, next)}
              value={value}
            />
          ))}
        </div>
      ) : (
        <>
          <div className="flex gap-1">
            {center.map((value, index) => (
              <NumberField
                key={index}
                label={t(centerLabels[index]!)}
                onChange={(next) => updateTriple(setCenter, index, next)}
                value={value}
              />
            ))}
          </div>
          {!floorplan && (
            <div className="flex gap-1">
              {axis.map((value, index) => (
                <NumberField
                  key={index}
                  label={t(axisLabels[index]!)}
                  onChange={(next) => updateTriple(setAxis, index, next)}
                  value={value}
                />
              ))}
            </div>
          )}
          <div className="flex items-end gap-1">
            <NumberField label={t('bodyModeling.arrayAngle')} onChange={setAngle} value={angle} />
            <label className="flex min-w-0 flex-1 flex-col gap-0.5 text-[10px] text-muted-foreground">
              <span>{t('bodyModeling.arrayAngleUnit')}</span>
              <select
                className="rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground"
                onChange={(event) => setAngleUnit(event.target.value as 'deg' | 'rad')}
                value={angleUnit}
              >
                <option value="deg">{t('bodyModeling.arrayDegrees')}</option>
                <option value="rad">{t('bodyModeling.arrayRadians')}</option>
              </select>
            </label>
            <label className="flex items-center gap-1 pb-1 text-[10px] text-muted-foreground">
              <input
                checked={fullCircle}
                onChange={(event) => setFullCircle(event.target.checked)}
                type="checkbox"
              />
              {t('bodyModeling.arrayFullCircle')}
            </label>
          </div>
        </>
      )}

      {error ? (
        <p className="text-[10px] text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end gap-1">
        <button
          className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
          onClick={onCancel}
          type="button"
        >
          {t('common.close')}
        </button>
        <button
          className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground hover:bg-primary/90"
          type="submit"
        >
          {t('bodyModeling.arrayApply')}
        </button>
      </div>
    </form>
  )
}

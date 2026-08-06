'use client'

import {
  DEFAULT_MATERIALS,
  type MaterialPreset,
  type MaterialProperties,
  type MaterialSchema,
} from '@pascal-app/core'
import { useState } from 'react'
import { generateBumpAssetFromTexture } from '../../../lib/material-bump'
import { Input } from '../primitives/input'
import { MaterialSizeEditor } from './material-size-editor'
import { SliderControl } from './slider-control'

import { useT } from '../../../i18n/use-t'
const DEFAULT_MATERIAL_PROPERTIES: MaterialProperties = {
  color: '#ffffff',
  roughness: 0.5,
  metalness: 0,
  opacity: 1,
  transparent: false,
  side: 'front',
}

const SURFACE_PRESETS: MaterialPreset[] = [
  'white',
  'plaster',
  'concrete',
  'brick',
  'wood',
  'tile',
  'marble',
  'metal',
  'glass',
]

// Per-surface bump strength — reflective/smooth surfaces stay flat, porous and
// jointed surfaces get height detail derived from their own texture.
const PRESET_BUMP_SCALE: Partial<Record<MaterialPreset, number>> = {
  brick: 0.3,
  concrete: 0.2,
  tile: 0.15,
  wood: 0.12,
  plaster: 0.1,
}

const FINISHES = [
  { key: 'gloss', labelKey: 'materials.finishGloss', roughness: 0.12 },
  { key: 'semi', labelKey: 'materials.finishSemi', roughness: 0.45 },
  { key: 'matte', labelKey: 'materials.finishMatte', roughness: 0.85 },
] as const

export function MaterialPropertiesEditor({
  value,
  onChange,
}: {
  value: MaterialSchema
  onChange: (next: MaterialSchema) => void
}) {
  const t = useT()
  const currentProps = value.properties ?? DEFAULT_MATERIAL_PROPERTIES
  const [isGeneratingBump, setIsGeneratingBump] = useState(false)
  const [bumpError, setBumpError] = useState(false)

  const updateMaterial = (
    updates: Partial<MaterialProperties>,
    nextTransparent = currentProps.transparent,
  ) => {
    onChange({
      ...value,
      preset: value.preset ?? 'custom',
      properties: {
        ...currentProps,
        ...updates,
        transparent: nextTransparent,
      },
    })
  }

  // Apply a surface type: its optical properties (glass turns transparent,
  // metal turns metallic, …) plus a per-surface bump map derived from the
  // material's own texture so light catches joints and grain.
  const applySurfacePreset = async (preset: MaterialPreset) => {
    setBumpError(false)
    const bumpScale = PRESET_BUMP_SCALE[preset] ?? 0
    let texture = value.texture
    if (texture?.url && bumpScale > 0) {
      let bumpUrl = texture.bumpUrl
      if (!bumpUrl) {
        setIsGeneratingBump(true)
        try {
          bumpUrl = await generateBumpAssetFromTexture(texture.url)
        } catch {
          setBumpError(true)
        } finally {
          setIsGeneratingBump(false)
        }
      }
      texture = { ...texture, bumpUrl, bumpScale: bumpUrl ? bumpScale : undefined }
    } else if (texture) {
      texture = { ...texture, bumpScale: undefined }
    }
    onChange({
      ...value,
      preset,
      properties: { ...DEFAULT_MATERIALS[preset], color: currentProps.color },
      texture,
    })
  }

  const generateBump = async () => {
    const texture = value.texture
    if (!texture?.url || isGeneratingBump) return
    setBumpError(false)
    setIsGeneratingBump(true)
    try {
      const bumpUrl = await generateBumpAssetFromTexture(texture.url)
      onChange({
        ...value,
        texture: { ...texture, bumpUrl, bumpScale: texture.bumpScale || 0.15 },
      })
    } catch {
      setBumpError(true)
    } finally {
      setIsGeneratingBump(false)
    }
  }

  const removeBump = () => {
    if (!value.texture) return
    onChange({
      ...value,
      texture: { ...value.texture, bumpUrl: undefined, bumpScale: undefined },
    })
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="block font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
          {t('materials.surfaceType')}
        </label>
        <select
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          disabled={isGeneratingBump}
          onChange={(e) => void applySurfacePreset(e.target.value as MaterialPreset)}
          value={value.preset ?? 'custom'}
        >
          {(value.preset ?? 'custom') === 'custom' ? (
            <option value="custom">{t('materials.preset.custom')}</option>
          ) : null}
          {SURFACE_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {t(`materials.preset.${preset}`)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label className="block font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
          {t('materials.finish')}
        </label>
        <div className="grid grid-cols-3 gap-1">
          {FINISHES.map((finish) => {
            const active = Math.abs(currentProps.roughness - finish.roughness) < 0.1
            return (
              <button
                aria-pressed={active}
                className={`rounded-lg px-2 py-1.5 text-xs ${active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground'}`}
                key={finish.key}
                onClick={() => updateMaterial({ roughness: finish.roughness })}
                type="button"
              >
                {t(finish.labelKey)}
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-2">
        <label className="block font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
          Color
        </label>
        <div className="flex items-center gap-2">
          <input
            className="h-9 w-9 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0 [&::-moz-color-swatch]:rounded-[5px] [&::-moz-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded-[5px] [&::-webkit-color-swatch]:border-none"
            onChange={(e) => updateMaterial({ color: e.target.value })}
            type="color"
            value={currentProps.color}
          />
          <Input
            onChange={(e) => updateMaterial({ color: e.target.value })}
            value={currentProps.color}
          />
        </div>
      </div>

      <SliderControl
        label={t('materials.roughness')}
        max={1}
        min={0}
        onChange={(value) => updateMaterial({ roughness: value })}
        precision={2}
        step={0.01}
        value={currentProps.roughness}
      />

      <MaterialSizeEditor onChange={onChange} value={value} />

      <SliderControl
        label={t('materials.metalness')}
        max={1}
        min={0}
        onChange={(value) => updateMaterial({ metalness: value })}
        precision={2}
        step={0.01}
        value={currentProps.metalness}
      />

      {value.texture?.url ? (
        <div className="space-y-2">
          <label className="block font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
            {t('materials.bumpHeading')}
          </label>
          {value.texture.bumpUrl ? (
            <>
              <SliderControl
                label={t('materials.bumpScale')}
                max={0.5}
                min={0}
                onChange={(bumpScale) =>
                  value.texture &&
                  onChange({ ...value, texture: { ...value.texture, bumpScale } })
                }
                precision={2}
                step={0.01}
                value={value.texture.bumpScale ?? 0}
              />
              <button
                className="w-full rounded-lg bg-muted px-2 py-1.5 text-muted-foreground text-xs hover:text-foreground"
                onClick={removeBump}
                type="button"
              >
                {t('materials.bumpRemove')}
              </button>
            </>
          ) : (
            <button
              className="w-full rounded-lg bg-muted px-2 py-1.5 text-muted-foreground text-xs hover:text-foreground disabled:opacity-50"
              disabled={isGeneratingBump}
              onClick={() => void generateBump()}
              type="button"
            >
              {t('materials.bumpGenerate')}
            </button>
          )}
          {bumpError ? (
            <p className="text-destructive text-xs">{t('materials.bumpFailed')}</p>
          ) : null}
        </div>
      ) : null}

      <SliderControl
        label={t('common.opacity')}
        max={1}
        min={0}
        onChange={(value) => updateMaterial({ opacity: value }, value < 1 || currentProps.transparent)}
        precision={2}
        step={0.01}
        value={currentProps.opacity}
      />

      <div className="space-y-2">
        <label className="block font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
          Side
        </label>
        <select
          className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          onChange={(e) =>
            updateMaterial({ side: e.target.value as 'front' | 'back' | 'double' })
          }
          value={currentProps.side}
        >
          <option value="front">{t('materials.sideFront')}</option>
          <option value="back">{t('materials.sideBack')}</option>
          <option value="double">{t('materials.sideDouble')}</option>
        </select>
      </div>
    </div>
  )
}

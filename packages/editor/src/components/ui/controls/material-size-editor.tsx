'use client'

import { type MaterialSchema, resizeMaterialPhysicalSize } from '@pascal-app/core'
import { useEffect, useState } from 'react'
import { Input } from '../primitives/input'

type MaterialSizeEditorProps = {
  readonly value: MaterialSchema
  readonly onChange: (next: MaterialSchema) => void
}

import { useT } from '../../../i18n/use-t'
export function MaterialSizeEditor({ value, onChange }: MaterialSizeEditorProps) {
  const t = useT()
  const physicalSize = value.physicalSize ?? { widthM: 1, heightM: 1 }
  const [widthDraft, setWidthDraft] = useState(String(Math.round(physicalSize.widthM * 1000)))
  const [heightDraft, setHeightDraft] = useState(String(Math.round(physicalSize.heightM * 1000)))

  useEffect(() => {
    setWidthDraft(String(Math.round(physicalSize.widthM * 1000)))
    setHeightDraft(String(Math.round(physicalSize.heightM * 1000)))
  }, [physicalSize.heightM, physicalSize.widthM])

  const commit = (axis: 'widthM' | 'heightM', draft: string) => {
    const millimetres = Number(draft)
    if (!Number.isFinite(millimetres) || millimetres <= 0) {
      setWidthDraft(String(Math.round(physicalSize.widthM * 1000)))
      setHeightDraft(String(Math.round(physicalSize.heightM * 1000)))
      return
    }
    onChange(
      resizeMaterialPhysicalSize(value, {
        ...physicalSize,
        [axis]: millimetres / 1000,
      }),
    )
  }

  return (
    <div className="space-y-2">
      <label className="block font-medium text-muted-foreground text-xs uppercase tracking-[0.12em]">
        Material size (mm)
      </label>
      <div className="grid grid-cols-2 gap-2">
        <Input
          aria-label={t('materials.widthMillimetres')}
          min={1}
          onBlur={() => commit('widthM', widthDraft)}
          onChange={(event) => setWidthDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          step={1}
          type="number"
          value={widthDraft}
        />
        <Input
          aria-label={t('materials.heightMillimetres')}
          min={1}
          onBlur={() => commit('heightM', heightDraft)}
          onChange={(event) => setHeightDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          step={1}
          type="number"
          value={heightDraft}
        />
      </div>
      <p className="text-muted-foreground text-xs">
        Width × height controls the real texture scale on every painted surface.
      </p>
    </div>
  )
}

'use client'

import type { LevelNode } from '@pascal-app/core'
import { useEffect, useState } from 'react'
import type { LevelDuplicatePreset } from '../../lib/level-duplication'
import { getLevelDisplayName } from '@pascal-app/core'
import type { MessageId } from '../../i18n/translate'
import { useT } from '../../i18n/use-t'
import { cn } from '../../lib/utils'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './primitives/dialog'

const DUPLICATE_PRESETS: Array<{
  id: LevelDuplicatePreset
  labelKey: MessageId
  descriptionKey: MessageId
}> = [
  {
    id: 'everything',
    labelKey: 'chrome.duplicateLevelEverything',
    descriptionKey: 'chrome.duplicateLevelEverythingDesc',
  },
  {
    id: 'structure',
    labelKey: 'chrome.duplicateLevelStructure',
    descriptionKey: 'chrome.duplicateLevelStructureDesc',
  },
  {
    id: 'structure-materials',
    labelKey: 'chrome.duplicateLevelStructureMaterials',
    descriptionKey: 'chrome.duplicateLevelStructureMaterialsDesc',
  },
  {
    id: 'structure-furniture',
    labelKey: 'chrome.duplicateLevelStructureFurniture',
    descriptionKey: 'chrome.duplicateLevelStructureFurnitureDesc',
  },
]

function getLevelLabel(level: LevelNode | null, fallback: string) {
  if (!level) return fallback
  return getLevelDisplayName(level)
}

export function LevelDuplicateDialog({
  open,
  level,
  onConfirm,
  onOpenChange,
}: {
  open: boolean
  level: LevelNode | null
  onConfirm: (preset: LevelDuplicatePreset) => void
  onOpenChange: (open: boolean) => void
}) {
  const t = useT()
  const [preset, setPreset] = useState<LevelDuplicatePreset>('everything')

  useEffect(() => {
    if (open) {
      setPreset('everything')
    }
  }, [open])

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="sm:max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t('chrome.duplicateLevel')}</DialogTitle>
          <DialogDescription>
            {`${t('chrome.duplicateLevelFromPrefix')}${getLevelLabel(level, t('chrome.duplicateLevelThisLevel'))}${t('chrome.duplicateLevelFromSuffix')}`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2">
          {DUPLICATE_PRESETS.map((option) => (
            <button
              className={cn(
                'cursor-pointer rounded-xl border px-3 py-3 text-left transition-colors',
                preset === option.id
                  ? 'border-primary bg-primary/10 text-foreground'
                  : 'border-border bg-background hover:bg-accent/40',
              )}
              key={option.id}
              onClick={() => setPreset(option.id)}
              type="button"
            >
              <div className="font-medium text-sm">{t(option.labelKey)}</div>
              <div className="mt-1 text-muted-foreground text-xs">{t(option.descriptionKey)}</div>
            </button>
          ))}
        </div>

        <DialogFooter>
          <button
            className="cursor-pointer rounded-md px-4 py-2 text-muted-foreground text-sm transition-colors hover:bg-accent"
            onClick={() => onOpenChange(false)}
            type="button"
          >
            {t('chrome.cancel')}
          </button>
          <button
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-primary-foreground text-sm transition-opacity hover:opacity-90"
            onClick={() => onConfirm(preset)}
            type="button"
          >
            {t('common.duplicate')}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

'use client'

import type { MaterialSchema, SceneMaterialId } from '@pascal-app/core'
import { Check, ImageOff, LoaderCircle, Sparkles, TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { requestSceneMaterialSeamless } from '../../../lib/host-integration'
import { getMaterialSeamlessAvailability } from '../../../lib/material-seamless-status'
import { Button } from '../primitives/button'

type ActionState =
  | { readonly kind: 'error' }
  | { readonly kind: 'idle' }
  | { readonly kind: 'running' }

type SceneMaterialSeamlessActionProps = {
  readonly id: SceneMaterialId
  readonly material: MaterialSchema
  readonly onChange: (material: MaterialSchema) => void
}

export function SceneMaterialSeamlessAction({
  id,
  material,
  onChange,
}: SceneMaterialSeamlessActionProps) {
  const [state, setState] = useState<ActionState>({ kind: 'idle' })
  const texture = material.texture
  const availability = getMaterialSeamlessAvailability(texture?.url)
  if (availability === 'missing-texture' || !texture) {
    return (
      <div
        className="mt-2 flex items-center gap-2 rounded-md border border-dashed border-border/50 bg-muted/10 px-2 py-1.5"
        data-testid="scene-material-seamless-action"
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <ImageOff className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-medium text-muted-foreground text-xs">텍스처 이미지 필요</p>
          <p className="truncate text-[10px] text-muted-foreground/70">
            이미지 자재를 먼저 적용하세요
          </p>
        </div>
        <Button aria-label="AI 심리스 사용 불가" disabled size="sm" type="button" variant="ghost">
          사용 불가
        </Button>
      </div>
    )
  }

  const isComplete = availability === 'complete'
  const isRunning = state.kind === 'running'
  const hasError = state.kind === 'error'

  const makeSeamless = async () => {
    setState({ kind: 'running' })
    try {
      const result = await requestSceneMaterialSeamless({
        materialId: id,
        textureUrl: texture.url,
      })
      switch (result.kind) {
        case 'complete':
          onChange({
            ...material,
            texture: { ...texture, url: result.textureUrl },
          })
          setState({ kind: 'idle' })
          return
        case 'unavailable':
          setState({ kind: 'error' })
          return
      }
    } catch (error: unknown) {
      if (error instanceof Error) {
        setState({ kind: 'error' })
        return
      }
      throw error
    }
  }

  return (
    <div
      className={`mt-2 flex items-center gap-2 rounded-md border px-2 py-1.5 ${
        isComplete
          ? 'border-emerald-500/30 bg-emerald-500/8'
          : hasError
            ? 'border-destructive/30 bg-destructive/5'
            : 'border-border/60 bg-muted/20'
      }`}
      data-testid="scene-material-seamless-action"
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
          isComplete
            ? 'bg-emerald-500/15 text-emerald-500'
            : hasError
              ? 'bg-destructive/10 text-destructive'
              : 'bg-primary/10 text-primary'
        }`}
      >
        {isComplete ? (
          <Check className="h-3.5 w-3.5" />
        ) : hasError ? (
          <TriangleAlert className="h-3.5 w-3.5" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-xs">
          {isComplete ? '심리스 완료' : hasError ? '처리하지 못했습니다' : 'AI 심리스'}
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {isComplete
            ? '로컬 캐시 사용 · 재처리 없음'
            : hasError
              ? '이미지를 확인한 뒤 다시 시도하세요'
              : '반복 경계를 보정해 로컬에 저장'}
        </p>
      </div>
      <Button
        aria-label={isComplete ? '심리스 처리 완료' : 'AI 심리스 만들기'}
        disabled={isComplete || isRunning}
        onClick={() => void makeSeamless()}
        size="sm"
        type="button"
        variant={isComplete ? 'ghost' : 'outline'}
      >
        {isRunning ? <LoaderCircle className="animate-spin" /> : null}
        {isComplete ? '저장됨' : isRunning ? '처리 중' : hasError ? '다시 시도' : '만들기'}
      </Button>
    </div>
  )
}

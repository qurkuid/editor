'use client'

import { type Locale, SegmentedControl, useLocale, useT } from '@pascal-app/editor'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import {
  CLAUDE_EFFORT_OPTIONS,
  CLAUDE_MODEL_OPTIONS,
  CODEX_EFFORT_OPTIONS,
  CODEX_MODEL_OPTIONS,
} from '@/lib/ai-model-options'
import useAiProvider, { type AiProviderKind } from '@/lib/ai-provider-store'
import { withBasePath } from '@/lib/base-path'
import { loadRawPainterCategories } from '@/lib/rawpainter-adapter'

// SegmentedControl needs a string value, so the "use the CLI default" null
// selection rides as this sentinel. No real model or effort id collides.
const DEFAULT_SENTINEL = 'default'

export type AiConnectionState =
  | { status: 'loading' }
  | { status: 'connected'; model: string | null }
  | { status: 'not-connected' }

export type MaterialsConnectionState = 'loading' | 'connected' | 'unavailable'

const AiProviderStatusSchema = z.object({
  configured: z.boolean(),
  model: z.string().nullable(),
})

const AiDualStatusSchema = z.object({
  codex: AiProviderStatusSchema,
  claude: AiProviderStatusSchema,
})

function StatusRow({
  label,
  source,
  dotClassName,
  dotTitle,
  detail,
}: {
  label: string
  source: string
  dotClassName: string
  dotTitle: string
  detail: string
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="font-medium text-sm">{label}</div>
        <div className="text-muted-foreground text-xs">{source}</div>
      </div>
      <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
        {detail}
        <span aria-hidden className={`h-2 w-2 rounded-full ${dotClassName}`} title={dotTitle} />
      </div>
    </div>
  )
}

export function HostSettingsSectionView({
  language,
  onLanguageChange,
  aiProvider,
  onAiProviderChange,
  aiModel,
  onAiModelChange,
  aiEffort,
  onAiEffortChange,
  aiState,
  materialsState,
}: {
  language: Locale
  onLanguageChange: (language: Locale) => void
  aiProvider: AiProviderKind
  onAiProviderChange: (provider: AiProviderKind) => void
  aiModel: string | null
  onAiModelChange: (model: string | null) => void
  aiEffort: string | null
  onAiEffortChange: (effort: string | null) => void
  aiState: AiConnectionState
  materialsState: MaterialsConnectionState
}) {
  const t = useT()

  const modelOptions = [
    ...(aiProvider === 'claude'
      ? []
      : [{ value: DEFAULT_SENTINEL, label: t('hostSettings.defaultOption') }]),
    ...(aiProvider === 'claude' ? CLAUDE_MODEL_OPTIONS : CODEX_MODEL_OPTIONS).map((option) => ({
      value: option.id,
      label: option.label,
    })),
  ]
  const effortOptions = [
    { value: DEFAULT_SENTINEL, label: t('hostSettings.defaultOption') },
    ...(aiProvider === 'claude' ? CLAUDE_EFFORT_OPTIONS : CODEX_EFFORT_OPTIONS).map((effort) => ({
      value: effort,
      label: effort,
    })),
  ]

  const aiDetail =
    aiState.status === 'loading'
      ? t('hostSettings.checking')
      : aiState.status === 'connected'
        ? (aiState.model ?? t('hostSettings.connected'))
        : t('hostSettings.notConnected')
  const aiConnected = aiState.status === 'connected'
  const aiSourceLabel = `${
    aiProvider === 'claude' ? t('hostSettings.aiProviderClaude') : t('hostSettings.aiProviderCodex')
  } CLI`

  const materialsDetail =
    materialsState === 'loading'
      ? t('hostSettings.checking')
      : materialsState === 'connected'
        ? t('hostSettings.connected')
        : t('hostSettings.unavailable')
  const materialsConnected = materialsState === 'connected'

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          {t('hostSettings.language')}
        </label>
        <SegmentedControl
          onChange={onLanguageChange}
          options={[
            { value: 'ko', label: t('hostSettings.korean') },
            { value: 'en', label: t('hostSettings.english') },
          ]}
          value={language}
        />
      </div>

      <div className="space-y-1.5">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          {t('hostSettings.aiProviderLabel')}
        </label>
        <SegmentedControl
          onChange={onAiProviderChange}
          options={[
            { value: 'codex', label: t('hostSettings.aiProviderCodex') },
            { value: 'claude', label: t('hostSettings.aiProviderClaude') },
          ]}
          value={aiProvider}
        />
      </div>

      <div className="space-y-1.5">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          {t('hostSettings.aiModelLabel')}
        </label>
        <SegmentedControl
          onChange={(value) => onAiModelChange(value === DEFAULT_SENTINEL ? null : value)}
          options={modelOptions}
          value={aiModel ?? DEFAULT_SENTINEL}
        />
      </div>

      <div className="space-y-1.5">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          {t('hostSettings.aiEffortLabel')}
        </label>
        <SegmentedControl
          onChange={(value) => onAiEffortChange(value === DEFAULT_SENTINEL ? null : value)}
          options={effortOptions}
          value={aiEffort ?? DEFAULT_SENTINEL}
        />
      </div>

      <StatusRow
        detail={aiDetail}
        dotClassName={aiConnected ? 'bg-emerald-500' : 'bg-amber-500'}
        dotTitle={aiConnected ? t('hostSettings.connected') : t('hostSettings.notConnected')}
        label={t('hostSettings.ai')}
        source={aiSourceLabel}
      />

      <StatusRow
        detail={materialsDetail}
        dotClassName={materialsConnected ? 'bg-emerald-500' : 'bg-amber-500'}
        dotTitle={materialsConnected ? t('hostSettings.connected') : t('hostSettings.unavailable')}
        label={t('hostSettings.materials')}
        source={t('hostSettings.materialsSource')}
      />
    </div>
  )
}

function toConnectionState(status: {
  configured: boolean
  model: string | null
}): AiConnectionState {
  return status.configured
    ? { status: 'connected', model: status.model }
    : { status: 'not-connected' }
}

export function HostSettingsSection() {
  const locale = useLocale((state) => state.locale)
  const setLocale = useLocale((state) => state.setLocale)
  const aiProvider = useAiProvider((state) => state.provider)
  const setAiProvider = useAiProvider((state) => state.setProvider)
  const aiModel = useAiProvider((state) =>
    state.provider === 'claude' ? state.claudeModel : state.codexModel,
  )
  const aiEffort = useAiProvider((state) =>
    state.provider === 'claude' ? state.claudeEffort : state.codexEffort,
  )
  const setModel = useAiProvider((state) => state.setModel)
  const setEffort = useAiProvider((state) => state.setEffort)
  const [codexState, setCodexState] = useState<AiConnectionState>({ status: 'loading' })
  const [claudeState, setClaudeState] = useState<AiConnectionState>({ status: 'loading' })
  const [materialsState, setMaterialsState] = useState<MaterialsConnectionState>('loading')

  useEffect(() => {
    const controller = new AbortController()
    fetch(withBasePath('/api/ai/chat'), { signal: controller.signal })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
      )
      .then((data) => {
        const parsed = AiDualStatusSchema.parse(data)
        setCodexState(toConnectionState(parsed.codex))
        setClaudeState(toConnectionState(parsed.claude))
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setCodexState({ status: 'not-connected' })
          setClaudeState({ status: 'not-connected' })
        }
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    loadRawPainterCategories(fetch, controller.signal)
      .then((categories) => {
        setMaterialsState(categories.length > 0 ? 'connected' : 'unavailable')
      })
      .catch(() => {
        if (!controller.signal.aborted) setMaterialsState('unavailable')
      })
    return () => controller.abort()
  }, [])

  return (
    <HostSettingsSectionView
      aiEffort={aiEffort}
      aiModel={aiModel}
      aiProvider={aiProvider}
      aiState={aiProvider === 'claude' ? claudeState : codexState}
      language={locale}
      materialsState={materialsState}
      onAiEffortChange={(effort) => setEffort(aiProvider, effort)}
      onAiModelChange={(model) => setModel(aiProvider, model)}
      onAiProviderChange={setAiProvider}
      onLanguageChange={setLocale}
    />
  )
}

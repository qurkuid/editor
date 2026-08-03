'use client'

import { type Locale, SegmentedControl, useLocale, useT } from '@pascal-app/editor'
import { useEffect, useState } from 'react'
import { z } from 'zod'
import useAiProvider, { type AiProviderKind } from '@/lib/ai-provider-store'
import { loadRawPainterCategories } from '@/lib/rawpainter-adapter'

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
  aiState,
  materialsState,
}: {
  language: Locale
  onLanguageChange: (language: Locale) => void
  aiProvider: AiProviderKind
  onAiProviderChange: (provider: AiProviderKind) => void
  aiState: AiConnectionState
  materialsState: MaterialsConnectionState
}) {
  const t = useT()

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
  const [codexState, setCodexState] = useState<AiConnectionState>({ status: 'loading' })
  const [claudeState, setClaudeState] = useState<AiConnectionState>({ status: 'loading' })
  const [materialsState, setMaterialsState] = useState<MaterialsConnectionState>('loading')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/ai/chat', { signal: controller.signal })
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
      aiProvider={aiProvider}
      aiState={aiProvider === 'claude' ? claudeState : codexState}
      language={locale}
      materialsState={materialsState}
      onAiProviderChange={setAiProvider}
      onLanguageChange={setLocale}
    />
  )
}

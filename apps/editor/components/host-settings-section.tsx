'use client'

import { type Locale, SegmentedControl, useLocale, useT } from '@pascal-app/editor'
import { useCallback, useEffect, useState } from 'react'
import { z } from 'zod'
import {
  CLAUDE_EFFORT_OPTIONS,
  CLAUDE_MODEL_OPTIONS,
  CODEX_EFFORT_OPTIONS,
  CODEX_MODEL_OPTIONS,
} from '@/lib/ai-model-options'
import useAiPromptPresets from '@/lib/ai-prompt-presets-store'
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
  onAiConnected,
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
  onAiConnected: () => void
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

      {!aiConnected && aiState.status !== 'loading' && (
        <AiCliLoginControl onConnected={onAiConnected} provider={aiProvider} />
      )}

      <AiPromptPresetsSection />

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

const LoginViewSchema = z.object({
  status: z.enum(['idle', 'starting', 'awaiting', 'exited', 'failed', 'succeeded']),
  url: z.string().nullable().optional(),
  userCode: z.string().nullable().optional(),
  needsCode: z.boolean().optional(),
  detail: z.string().nullable().optional(),
})

type LoginView = z.infer<typeof LoginViewSchema>

async function postAiAuth(body: Record<string, unknown>): Promise<LoginView | null> {
  const response = await fetch(withBasePath('/api/ai/auth'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) return null
  return LoginViewSchema.parse(await response.json())
}

/**
 * Sign the server's bundled CLI in from the browser. Claude prints an OAuth
 * URL whose hosted page hands the user a code to paste back; Codex uses its
 * device-auth flow (URL + one-time code) and polls on its own.
 */
function AiCliLoginControl({
  provider,
  onConnected,
}: {
  provider: AiProviderKind
  onConnected: () => void
}) {
  const t = useT()
  const [view, setView] = useState<LoginView | null>(null)
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)

  // Whatever the flow state, a provider switch means a different login.
  useEffect(() => {
    setView(null)
    setCode('')
  }, [provider])

  const pending = view?.status === 'starting' || view?.status === 'awaiting'
  useEffect(() => {
    if (!pending) return
    const timer = setInterval(async () => {
      try {
        const response = await fetch(withBasePath(`/api/ai/auth?provider=${provider}`))
        if (!response.ok) return
        const next = LoginViewSchema.parse(await response.json())
        setView(next)
        if (next.status === 'succeeded') onConnected()
      } catch {
        // Transient poll failure — the next tick retries.
      }
    }, 2500)
    return () => clearInterval(timer)
  }, [pending, provider, onConnected])

  async function run(body: Record<string, unknown>) {
    setBusy(true)
    try {
      const next = await postAiAuth(body)
      setView(next)
      if (next?.status === 'succeeded') onConnected()
    } finally {
      setBusy(false)
    }
  }

  if (!view || view.status === 'idle') {
    return (
      <button
        className="rounded-md border px-2.5 py-1.5 font-medium text-xs hover:bg-accent"
        disabled={busy}
        onClick={() => run({ provider, action: 'start' })}
        type="button"
      >
        {t('hostSettings.cliLogin')}
      </button>
    )
  }

  if (view.status === 'succeeded') {
    return <div className="text-emerald-600 text-xs">{t('hostSettings.connected')}</div>
  }

  if (view.status === 'failed' || view.status === 'exited') {
    return (
      <div className="space-y-1.5">
        <div className="text-amber-600 text-xs">
          {t('hostSettings.cliLoginFailed')}
          {view.detail ? ` — ${view.detail.slice(-160)}` : ''}
        </div>
        <button
          className="rounded-md border px-2.5 py-1.5 font-medium text-xs hover:bg-accent"
          disabled={busy}
          onClick={() => run({ provider, action: 'start' })}
          type="button"
        >
          {t('hostSettings.cliLogin')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5 rounded-md border p-2.5 text-xs">
      {view.url ? (
        <div>
          <a
            className="font-medium text-blue-600 underline"
            href={view.url}
            rel="noreferrer"
            target="_blank"
          >
            {t('hostSettings.cliLoginOpen')}
          </a>
        </div>
      ) : (
        <div className="text-muted-foreground">{t('hostSettings.checking')}</div>
      )}
      {view.userCode && (
        <div>
          {t('hostSettings.cliLoginCode')}{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-semibold">{view.userCode}</code>
        </div>
      )}
      {view.needsCode && (
        <div className="flex items-center gap-1.5">
          <input
            className="w-full rounded-md border px-2 py-1"
            onChange={(event) => setCode(event.target.value)}
            placeholder={t('hostSettings.cliLoginPaste')}
            value={code}
          />
          <button
            className="rounded-md border px-2.5 py-1 font-medium hover:bg-accent"
            disabled={busy || code.trim().length < 8}
            onClick={() => run({ provider, action: 'submit', code: code.trim() })}
            type="button"
          >
            {t('hostSettings.cliLoginSubmit')}
          </button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <span className="text-muted-foreground">{t('hostSettings.cliLoginWaiting')}</span>
        <button
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            void postAiAuth({ provider, action: 'cancel' })
            setView(null)
            setCode('')
          }}
          type="button"
        >
          {t('hostSettings.cliLoginCancel')}
        </button>
      </div>
    </div>
  )
}

/** The operator's saved situation prompts, edited in place. */
function AiPromptPresetsSection() {
  const t = useT()
  const presets = useAiPromptPresets((state) => state.presets)
  const addPreset = useAiPromptPresets((state) => state.addPreset)
  const updatePreset = useAiPromptPresets((state) => state.updatePreset)
  const removePreset = useAiPromptPresets((state) => state.removePreset)

  return (
    <div className="space-y-1.5">
      <label className="font-medium text-muted-foreground text-xs uppercase">
        {t('hostSettings.promptPresets')}
      </label>
      {presets.map((preset) => (
        <div className="space-y-1 rounded-md border border-border/60 p-2" key={preset.id}>
          <div className="flex items-center gap-1.5">
            <input
              className="w-full rounded border border-border/60 bg-transparent px-2 py-1 text-xs"
              onChange={(event) => updatePreset(preset.id, { title: event.target.value })}
              placeholder={t('hostSettings.promptPresetTitle')}
              value={preset.title}
            />
            <button
              className="shrink-0 text-muted-foreground text-xs hover:text-foreground"
              onClick={() => removePreset(preset.id)}
              type="button"
            >
              {t('hostSettings.promptPresetDelete')}
            </button>
          </div>
          <textarea
            className="min-h-16 w-full resize-y rounded border border-border/60 bg-transparent px-2 py-1 text-xs"
            onChange={(event) => updatePreset(preset.id, { prompt: event.target.value })}
            placeholder={t('hostSettings.promptPresetText')}
            value={preset.prompt}
          />
        </div>
      ))}
      <button
        className="rounded-md border px-2.5 py-1.5 font-medium text-xs hover:bg-accent"
        onClick={addPreset}
        type="button"
      >
        {t('hostSettings.promptPresetAdd')}
      </button>
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

  const refreshAiStatus = useCallback((signal?: AbortSignal) => {
    fetch(withBasePath('/api/ai/chat'), { signal })
      .then((response) =>
        response.ok ? response.json() : Promise.reject(new Error(String(response.status))),
      )
      .then((data) => {
        const parsed = AiDualStatusSchema.parse(data)
        setCodexState(toConnectionState(parsed.codex))
        setClaudeState(toConnectionState(parsed.claude))
      })
      .catch(() => {
        if (!signal?.aborted) {
          setCodexState({ status: 'not-connected' })
          setClaudeState({ status: 'not-connected' })
        }
      })
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    refreshAiStatus(controller.signal)
    return () => controller.abort()
  }, [refreshAiStatus])

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
      onAiConnected={refreshAiStatus}
      onAiEffortChange={(effort) => setEffort(aiProvider, effort)}
      onAiModelChange={(model) => setModel(aiProvider, model)}
      onAiProviderChange={setAiProvider}
      onLanguageChange={setLocale}
    />
  )
}

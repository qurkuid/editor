'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  CLAUDE_EFFORT_OPTIONS,
  CLAUDE_MODEL_OPTIONS,
  CODEX_EFFORT_OPTIONS,
  CODEX_MODEL_OPTIONS,
  DEFAULT_CLAUDE_MODEL,
} from './ai-model-options'

export type AiProviderKind = 'codex' | 'claude'

type AiProviderState = {
  provider: AiProviderKind
  claudeModel: string
  codexModel: string | null
  claudeEffort: string | null
  codexEffort: string | null
  setProvider: (provider: AiProviderKind) => void
  setModel: (provider: AiProviderKind, model: string | null) => void
  setEffort: (provider: AiProviderKind, effort: string | null) => void
}

const PROVIDERS = ['codex', 'claude'] as const

function pickProvider(value: unknown): AiProviderKind {
  return typeof value === 'string' && PROVIDERS.includes(value as AiProviderKind)
    ? (value as AiProviderKind)
    : 'codex'
}

function pickOption<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T | null,
): T | null {
  return typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback
}

const CLAUDE_MODEL_IDS = CLAUDE_MODEL_OPTIONS.map((option) => option.id)
const CODEX_MODEL_IDS = CODEX_MODEL_OPTIONS.map((option) => option.id)

/**
 * Single source of truth for which AI CLI backs the modeling agent, and which
 * model/effort each provider should use. Lives client-side (not the server)
 * so `host-settings-section.tsx` and `ai-chat-panel.tsx` both read and drive
 * it, and the selection is sent with each `/api/ai/chat` request rather than
 * duplicated as server state.
 */
const useAiProvider = create<AiProviderState>()(
  persist(
    (set) => ({
      provider: 'codex',
      claudeModel: DEFAULT_CLAUDE_MODEL,
      codexModel: null,
      claudeEffort: null,
      codexEffort: null,
      setProvider: (provider) => set({ provider }),
      setModel: (provider, model) =>
        set(
          provider === 'claude'
            ? { claudeModel: model ?? DEFAULT_CLAUDE_MODEL }
            : { codexModel: model },
        ),
      setEffort: (provider, effort) =>
        set(provider === 'claude' ? { claudeEffort: effort } : { codexEffort: effort }),
    }),
    {
      name: 'pascal-ai-provider',
      merge: (persistedState, currentState) => {
        const persisted = persistedState as Partial<AiProviderState> | undefined
        return {
          ...currentState,
          provider: pickProvider(persisted?.provider),
          claudeModel:
            pickOption(persisted?.claudeModel, CLAUDE_MODEL_IDS, DEFAULT_CLAUDE_MODEL) ??
            DEFAULT_CLAUDE_MODEL,
          codexModel: pickOption(persisted?.codexModel, CODEX_MODEL_IDS, null),
          claudeEffort: pickOption(persisted?.claudeEffort, CLAUDE_EFFORT_OPTIONS, null),
          codexEffort: pickOption(persisted?.codexEffort, CODEX_EFFORT_OPTIONS, null),
        }
      },
      partialize: (state) => ({
        provider: state.provider,
        claudeModel: state.claudeModel,
        codexModel: state.codexModel,
        claudeEffort: state.claudeEffort,
        codexEffort: state.codexEffort,
      }),
    },
  ),
)

export default useAiProvider

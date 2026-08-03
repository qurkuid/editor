'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AiProviderKind = 'codex' | 'claude'

type AiProviderState = {
  provider: AiProviderKind
  setProvider: (provider: AiProviderKind) => void
}

const PROVIDERS = ['codex', 'claude'] as const

function pickProvider(value: unknown): AiProviderKind {
  return typeof value === 'string' && PROVIDERS.includes(value as AiProviderKind)
    ? (value as AiProviderKind)
    : 'codex'
}

/**
 * Single source of truth for which AI CLI backs the modeling agent. Lives
 * client-side (not the server) so `host-settings-section.tsx` and
 * `ai-chat-panel.tsx` both read and drive it, and the selection is sent
 * with each `/api/ai/chat` request rather than duplicated as server state.
 */
const useAiProvider = create<AiProviderState>()(
  persist(
    (set) => ({
      provider: 'codex',
      setProvider: (provider) => set({ provider }),
    }),
    {
      name: 'pascal-ai-provider',
      merge: (persistedState, currentState) => ({
        ...currentState,
        provider: pickProvider((persistedState as Partial<AiProviderState> | undefined)?.provider),
      }),
      partialize: (state) => ({ provider: state.provider }),
    },
  ),
)

export default useAiProvider

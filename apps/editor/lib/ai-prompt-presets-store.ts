'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AiPromptPreset = {
  readonly id: string
  readonly title: string
  readonly prompt: string
}

type AiPromptPresetsState = {
  presets: AiPromptPreset[]
  addPreset: () => void
  updatePreset: (id: string, patch: Partial<Omit<AiPromptPreset, 'id'>>) => void
  removePreset: (id: string) => void
}

function isPreset(value: unknown): value is AiPromptPreset {
  const preset = value as Partial<AiPromptPreset> | null
  return (
    typeof preset?.id === 'string' &&
    typeof preset?.title === 'string' &&
    typeof preset?.prompt === 'string'
  )
}

/**
 * User-authored prompts for recurring situations — the operator's own library,
 * persisted client-side. Edited in the settings panel, offered as one-click
 * chips in the AI panel.
 */
const useAiPromptPresets = create<AiPromptPresetsState>()(
  persist(
    (set) => ({
      presets: [],
      addPreset: () =>
        set((state) => ({
          presets: [...state.presets, { id: crypto.randomUUID(), title: '', prompt: '' }],
        })),
      updatePreset: (id, patch) =>
        set((state) => ({
          presets: state.presets.map((preset) =>
            preset.id === id ? { ...preset, ...patch } : preset,
          ),
        })),
      removePreset: (id) =>
        set((state) => ({
          presets: state.presets.filter((preset) => preset.id !== id),
        })),
    }),
    {
      name: 'pascal-ai-prompt-presets',
      merge: (persistedState, currentState) => ({
        ...currentState,
        presets: (
          (persistedState as Partial<AiPromptPresetsState> | undefined)?.presets ?? []
        ).filter(isPreset),
      }),
      partialize: (state) => ({ presets: state.presets }),
    },
  ),
)

export default useAiPromptPresets

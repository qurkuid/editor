'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type AiChatHistoryRole = 'user' | 'assistant' | 'status'

export type AiChatHistoryMessage = {
  id: string
  role: AiChatHistoryRole
  content: string
}

const ROLES = ['user', 'assistant', 'status'] as const

/** Cap on persisted messages — bounds localStorage growth across long
 * follow-up sessions. Independent of the 40-message limit `/api/ai/chat`
 * accepts per request (`AiChatRequestSchema` in `lib/ai-provider.ts`);
 * callers trim what they send to the API separately. */
export const AI_CHAT_HISTORY_LIMIT = 100

type AiChatHistoryState = {
  messages: AiChatHistoryMessage[]
  appendMessage: (message: AiChatHistoryMessage) => void
  reset: () => void
}

function isAiChatHistoryMessage(value: unknown): value is AiChatHistoryMessage {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<AiChatHistoryMessage>
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.content === 'string' &&
    typeof candidate.role === 'string' &&
    ROLES.includes(candidate.role as AiChatHistoryRole)
  )
}

function pickMessages(value: unknown): AiChatHistoryMessage[] {
  if (!Array.isArray(value)) return []
  return value.filter(isAiChatHistoryMessage).slice(-AI_CHAT_HISTORY_LIMIT)
}

/**
 * Persists the AI chat transcript (id/role/content only) so it survives tab
 * switches and reloads — follow-up requests ("now add a shelf") depend on
 * prior turns staying available. Image attachments, the pending plan, and
 * the thinking/reading flags stay in `AiChatPanel` component state instead:
 * attachments are base64 data URLs that would blow the localStorage quota,
 * and the rest is transient UI state with no reason to survive a reload.
 * The welcome message is never persisted, so it stays locale-reactive —
 * callers re-derive it (via `t('aiChat.welcome')`) whenever `messages` is
 * empty rather than reading a frozen translation out of storage.
 */
const useAiChatHistory = create<AiChatHistoryState>()(
  persist(
    (set) => ({
      messages: [],
      appendMessage: (message) =>
        set((state) => ({
          messages: [...state.messages, message].slice(-AI_CHAT_HISTORY_LIMIT),
        })),
      reset: () => set({ messages: [] }),
    }),
    {
      name: 'pascal-ai-chat',
      merge: (persistedState, currentState) => ({
        ...currentState,
        messages: pickMessages(
          (persistedState as Partial<AiChatHistoryState> | undefined)?.messages,
        ),
      }),
      partialize: (state) => ({ messages: state.messages }),
    },
  ),
)

export default useAiChatHistory

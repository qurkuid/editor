import { describe, expect, test } from 'bun:test'
import useAiChatHistory, { AI_CHAT_HISTORY_LIMIT } from './ai-chat-history'

describe('ai chat history store', () => {
  test('starts empty', () => {
    useAiChatHistory.getState().reset()

    expect(useAiChatHistory.getState().messages).toEqual([])
  })

  test('appendMessage appends to the transcript in order', () => {
    useAiChatHistory.getState().reset()

    useAiChatHistory.getState().appendMessage({ id: '1', role: 'user', content: 'hi' })
    useAiChatHistory.getState().appendMessage({ id: '2', role: 'assistant', content: 'hello' })

    expect(useAiChatHistory.getState().messages).toEqual([
      { id: '1', role: 'user', content: 'hi' },
      { id: '2', role: 'assistant', content: 'hello' },
    ])

    useAiChatHistory.getState().reset()
  })

  test('reset clears the transcript', () => {
    useAiChatHistory.getState().appendMessage({ id: '1', role: 'user', content: 'hi' })

    useAiChatHistory.getState().reset()

    expect(useAiChatHistory.getState().messages).toEqual([])
  })

  test('caps stored history at the most recent AI_CHAT_HISTORY_LIMIT messages', () => {
    useAiChatHistory.getState().reset()

    for (let i = 0; i < AI_CHAT_HISTORY_LIMIT + 10; i++) {
      useAiChatHistory.getState().appendMessage({ id: String(i), role: 'user', content: String(i) })
    }

    const { messages } = useAiChatHistory.getState()
    expect(messages).toHaveLength(AI_CHAT_HISTORY_LIMIT)
    expect(messages[0]?.id).toBe('10')
    expect(messages.at(-1)?.id).toBe(String(AI_CHAT_HISTORY_LIMIT + 9))

    useAiChatHistory.getState().reset()
  })

  // bun test has no `window`, so zustand's persist middleware never attaches
  // `.persist` here (see middleware.js: `createJSONStorage` swallows the
  // `window is not defined` throw and the wrapper bails before exposing
  // `.persist`) — every persisted store in this repo hits the same "storage
  // is currently unavailable" warning under `bun test`. This checks the
  // shape that would reach `partialize` instead of inspecting the real
  // localStorage write.
  test('carries only id/role/content messages — no attachment or plan fields', () => {
    useAiChatHistory.getState().reset()
    useAiChatHistory.getState().appendMessage({ id: '1', role: 'user', content: 'hi' })

    const state = useAiChatHistory.getState()
    expect(Object.keys(state).sort()).toEqual(['appendMessage', 'messages', 'reset'])
    expect(Object.keys(state.messages[0] ?? {}).sort()).toEqual(['content', 'id', 'role'])

    useAiChatHistory.getState().reset()
  })
})

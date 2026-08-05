import { expect, test } from 'bun:test'
import { conversationWindow, nextAiQueueStep } from './ai-chat-queue'

test('holds while a request is in flight or the queue is empty', () => {
  expect(nextAiQueueStep({ isBusy: true, hasPendingPlan: false, queuedCount: 2 })).toBe('wait')
  expect(nextAiQueueStep({ isBusy: true, hasPendingPlan: true, queuedCount: 2 })).toBe('wait')
  expect(nextAiQueueStep({ isBusy: false, hasPendingPlan: false, queuedCount: 0 })).toBe('wait')
  expect(nextAiQueueStep({ isBusy: false, hasPendingPlan: true, queuedCount: 0 })).toBe('wait')
})

test('applies a parked plan before dispatching queued work', () => {
  expect(nextAiQueueStep({ isBusy: false, hasPendingPlan: true, queuedCount: 1 })).toBe(
    'auto-apply',
  )
})

test('dispatches immediately when idle with no pending plan', () => {
  expect(nextAiQueueStep({ isBusy: false, hasPendingPlan: false, queuedCount: 1 })).toBe('dispatch')
})

const HISTORY = [
  { id: 'u1', role: 'user' },
  { id: 'a1', role: 'assistant' },
  { id: 'u2', role: 'user' },
  { id: 'u3', role: 'user' },
] as const

test('cuts history after the queued message so later prompts stay out', () => {
  expect(conversationWindow(HISTORY, 'u2', 40).map((message) => message.id)).toEqual([
    'u1',
    'a1',
    'u2',
  ])
})

test('falls back to full history when the message id is gone', () => {
  expect(conversationWindow(HISTORY, 'missing', 40)).toHaveLength(4)
})

test('applies the API message limit from the tail', () => {
  expect(conversationWindow(HISTORY, 'u2', 2).map((message) => message.id)).toEqual(['a1', 'u2'])
})

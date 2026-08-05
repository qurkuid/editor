/** Pure decision logic for the AI chat send queue, shared by the panel's
 * pump effect and its tests. */

export type AiQueueSignal = {
  readonly isBusy: boolean
  readonly hasPendingPlan: boolean
  readonly queuedCount: number
}

export type AiQueueStep = 'wait' | 'auto-apply' | 'dispatch'

/** One pump step: nothing moves while a request is in flight or the queue is
 * empty. A plan parked in front of queued work is applied before the next
 * dispatch so every request sees the previous one's scene changes. */
export function nextAiQueueStep(signal: AiQueueSignal): AiQueueStep {
  if (signal.isBusy || signal.queuedCount === 0) return 'wait'
  return signal.hasPendingPlan ? 'auto-apply' : 'dispatch'
}

/** History window for a queued request: everything up to and including its
 * own user message. Requests queued after it stay out of this request's
 * context so the model doesn't try to answer two prompts at once. */
export function conversationWindow<T extends { readonly id: string }>(
  messages: readonly T[],
  cutoffId: string,
  limit: number,
): T[] {
  const cut = messages.findIndex((message) => message.id === cutoffId)
  const upTo = cut === -1 ? [...messages] : messages.slice(0, cut + 1)
  return upTo.slice(-limit)
}

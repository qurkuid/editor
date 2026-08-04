/**
 * Model and effort choices for each AI CLI provider. Pure constants shared by
 * the settings UI, the persisted provider store, and the server request
 * schema — keep free of node imports so the client can bundle it.
 */

export type AiModelOption = { readonly id: string; readonly label: string }

export const CLAUDE_MODEL_OPTIONS: readonly AiModelOption[] = [
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
]

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5'

// null id = whatever the server's codex CLI config names as its default.
export const CODEX_MODEL_OPTIONS: readonly AiModelOption[] = [
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
]

export const CLAUDE_EFFORT_OPTIONS = ['low', 'medium', 'high', 'xhigh', 'max'] as const
export const CODEX_EFFORT_OPTIONS = ['minimal', 'low', 'medium', 'high', 'xhigh'] as const

export const AI_MODEL_IDS = [
  ...CLAUDE_MODEL_OPTIONS.map((option) => option.id),
  ...CODEX_MODEL_OPTIONS.map((option) => option.id),
] as [string, ...string[]]

export const AI_EFFORT_LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as [
  string,
  ...string[],
]

export type AiEffortLevel = (typeof AI_EFFORT_LEVELS)[number]

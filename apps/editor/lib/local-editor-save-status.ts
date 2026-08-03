import type { SaveStatus } from '@pascal-app/editor'

const LOCAL_EDITOR_SAVE_STATUS_LABELS = {
  idle: 'Loading local scene…',
  pending: 'Saving locally…',
  saving: 'Saving locally…',
  saved: 'Saved locally',
  paused: 'Local saving paused',
  error: 'Local save failed',
} as const satisfies Record<SaveStatus, string>

export function localEditorSaveStatusLabel(status: SaveStatus): string {
  return LOCAL_EDITOR_SAVE_STATUS_LABELS[status]
}

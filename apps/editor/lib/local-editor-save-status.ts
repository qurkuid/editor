import type { MessageId, SaveStatus } from '@pascal-app/editor'

const LOCAL_EDITOR_SAVE_STATUS_KEYS = {
  idle: 'panel.saveIdle',
  pending: 'panel.saveSaving',
  saving: 'panel.saveSaving',
  saved: 'panel.savedLocally',
  paused: 'panel.savePaused',
  error: 'panel.saveError',
} as const satisfies Record<SaveStatus, MessageId>

export function localEditorSaveStatusKey(status: SaveStatus): MessageId {
  return LOCAL_EDITOR_SAVE_STATUS_KEYS[status]
}

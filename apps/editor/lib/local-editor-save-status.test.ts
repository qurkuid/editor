import { describe, expect, test } from 'bun:test'
import type { SaveStatus } from '@pascal-app/editor'
import { localEditorSaveStatusKey } from './local-editor-save-status'

describe('localEditorSaveStatusKey', () => {
  test.each([
    ['idle', 'panel.saveIdle'],
    ['pending', 'panel.saveSaving'],
    ['saving', 'panel.saveSaving'],
    ['saved', 'panel.savedLocally'],
    ['paused', 'panel.savePaused'],
    ['error', 'panel.saveError'],
  ] satisfies readonly (readonly [
    SaveStatus,
    string,
  ])[])('returns %s status message id for the local editor', (status, expected) => {
    const givenSaveStatus = status
    const whenKeyIsResolved = localEditorSaveStatusKey(givenSaveStatus)
    const thenExpectedKey = expected
    expect(whenKeyIsResolved).toBe(thenExpectedKey)
  })
})

import { describe, expect, test } from 'bun:test'
import type { SaveStatus } from '@pascal-app/editor'
import { localEditorSaveStatusLabel } from './local-editor-save-status'

describe('localEditorSaveStatusLabel', () => {
  test.each([
    ['idle', 'Loading local scene…'],
    ['pending', 'Saving locally…'],
    ['saving', 'Saving locally…'],
    ['saved', 'Saved locally'],
    ['paused', 'Local saving paused'],
    ['error', 'Local save failed'],
  ] satisfies readonly (readonly [
    SaveStatus,
    string,
  ])[])('returns %s status copy for the local editor', (status, expected) => {
    const givenSaveStatus = status
    const whenLabelIsResolved = localEditorSaveStatusLabel(givenSaveStatus)
    const thenExpectedLabel = expected
    expect(whenLabelIsResolved).toBe(thenExpectedLabel)
  })
})

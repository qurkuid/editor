import { describe, expect, test } from 'bun:test'
import useEditor from '../../../../../store/use-editor'
import { resetEditorAfterSceneImport } from './index'

describe('resetEditorAfterSceneImport', () => {
  test('returns the editor to selection mode after replacing the scene', () => {
    useEditor.getState().setPhase('structure')
    useEditor.getState().setMode('build')

    resetEditorAfterSceneImport()

    expect(useEditor.getState().mode).toBe('select')
    expect(useEditor.getState().tool).toBeNull()
  })
})

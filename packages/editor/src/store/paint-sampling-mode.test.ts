import { afterEach, describe, expect, test } from 'bun:test'
import useEditor from './use-editor'
import useInteractionScope from './use-interaction-scope'

/**
 * Lifecycle contract for the paint eyedropper arm (`paintSampling`) — the
 * paint-mode sibling of the terrain flatten eyedropper covered in
 * `terrain-sculpt-mode.test.ts`. A one-shot arm that outlives its mode (or its
 * sample) would swallow the user's next click with no UI showing it as armed.
 */

function reset() {
  useEditor.getState().setPreviewMode(false)
  useEditor.getState().setViewMode('3d')
  useEditor.getState().setPhase('structure')
  useEditor.getState().setMode('select')
  useEditor.getState().setPaintSampling(false)
  useEditor.getState().setActivePaintMaterial(null)
  useInteractionScope.getState().end()
}
afterEach(reset)

describe('the paint eyedropper arm is not allowed to outlive paint mode', () => {
  test('leaving via setMode disarms it', () => {
    useEditor.getState().setMode('material-paint')
    useEditor.getState().setPaintSampling(true)
    useEditor.getState().setMode('select')
    expect(useEditor.getState().paintSampling).toBe(false)
  })

  test('leaving via a phase switch disarms it', () => {
    useEditor.getState().setMode('material-paint')
    useEditor.getState().setPaintSampling(true)
    useEditor.getState().setPhase('furnish')
    expect(useEditor.getState().paintSampling).toBe(false)
  })

  test('switching into the other brush mode disarms it', () => {
    useEditor.getState().setMode('material-paint')
    useEditor.getState().setPaintSampling(true)
    useEditor.getState().setMode('terrain-sculpt')
    expect(useEditor.getState().paintSampling).toBe(false)
  })
})

describe('sampling is one-shot', () => {
  test('picking a brush (what a successful sample does) disarms it', () => {
    useEditor.getState().setMode('material-paint')
    useEditor.getState().setPaintEraser(true)
    useEditor.getState().setPaintSampling(true)
    useEditor
      .getState()
      .setActivePaintMaterial({ materialPreset: 'library:oak', sourceTarget: 'wall' })
    // The sampled material is the brush now: eraser and sampler both stand down.
    expect(useEditor.getState().paintSampling).toBe(false)
    expect(useEditor.getState().paintEraser).toBe(false)
    expect(useEditor.getState().mode).toBe('material-paint')
  })
})

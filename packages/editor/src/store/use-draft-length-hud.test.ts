import { beforeEach, expect, test } from 'bun:test'
import { useDraftLengthHud } from './use-draft-length-hud'

beforeEach(() => useDraftLengthHud.getState().clear())

test('clear resets raw input, signed ownership, and preview validity', () => {
  useDraftLengthHud.getState().setRaw('-200mm')
  useDraftLengthHud.getState().setSignedMode(true)
  useDraftLengthHud.getState().setPreviewInvalid(true)

  useDraftLengthHud.getState().clear()

  expect(useDraftLengthHud.getState()).toMatchObject({
    raw: '',
    signedMode: false,
    previewInvalid: false,
  })
})

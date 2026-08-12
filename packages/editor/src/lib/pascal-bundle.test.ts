import { describe, expect, test } from 'bun:test'
import { attachPascalBundleAsset, parsePascalBundle, PascalBundleError } from './pascal-bundle'

function bundle(scene: unknown, model: Uint8Array): ArrayBuffer {
  const magic = new TextEncoder().encode('PASCALB1')
  const json = new TextEncoder().encode(JSON.stringify(scene))
  const output = new Uint8Array(12 + json.length + model.length)
  output.set(magic)
  new DataView(output.buffer).setUint32(8, json.length, true)
  output.set(json, 12)
  output.set(model, 12 + json.length)
  return output.buffer
}

describe('Pascal SketchUp bundle', () => {
  test('parses the scene and GLB payload', async () => {
    const input = { nodes: { scan_1: { id: 'scan_1', type: 'scan', url: 'asset://placeholder' } } }
    const model = new TextEncoder().encode('glTFmodel')
    const parsed = await parsePascalBundle(bundle(input, model))

    expect(parsed.scene).toEqual(input)
    expect(new Uint8Array(await parsed.model.arrayBuffer())).toEqual(model)
  })

  test('attaches the stored model URL to scan nodes', () => {
    const input = { nodes: { scan_1: { id: 'scan_1', type: 'scan', url: 'asset://placeholder' } } }

    expect(attachPascalBundleAsset(input, 'asset://stored-model')).toEqual({
      nodes: { scan_1: { id: 'scan_1', type: 'scan', url: 'asset://stored-model' } },
    })
  })

  test('rejects an invalid header', async () => {
    expect(parsePascalBundle(new ArrayBuffer(12))).rejects.toBeInstanceOf(PascalBundleError)
  })

  test('rejects a non-GLB model payload', async () => {
    expect(
      parsePascalBundle(bundle({ nodes: {} }, new Uint8Array([1, 2, 3, 4]))),
    ).rejects.toBeInstanceOf(PascalBundleError)
  })
})

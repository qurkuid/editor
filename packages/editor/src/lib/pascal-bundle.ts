const MAGIC_V1 = new TextEncoder().encode('PASCALB1')
const MAGIC_V2 = new TextEncoder().encode('PASCALB2')
const HEADER_BYTES = 12

export class PascalBundleError extends Error {
  readonly code: 'invalid_magic' | 'invalid_length' | 'invalid_json' | 'invalid_model'

  constructor(code: PascalBundleError['code']) {
    super(code)
    this.name = 'PascalBundleError'
    this.code = code
  }
}

export type PascalBundle = {
  readonly scene: unknown
  readonly model: Blob
}

export async function parsePascalBundle(buffer: ArrayBuffer): Promise<PascalBundle> {
  const bytes = new Uint8Array(buffer)
  const isV1 = MAGIC_V1.every((value, index) => bytes[index] === value)
  const isV2 = MAGIC_V2.every((value, index) => bytes[index] === value)
  if (bytes.length < HEADER_BYTES || (!isV1 && !isV2)) {
    throw new PascalBundleError('invalid_magic')
  }
  const sceneLength = new DataView(buffer).getUint32(MAGIC_V1.length, true)
  const modelOffset = HEADER_BYTES + sceneLength
  if (sceneLength === 0 || modelOffset >= bytes.length) {
    throw new PascalBundleError('invalid_length')
  }
  if (bytes.length - modelOffset < 4 || String.fromCharCode(...bytes.slice(modelOffset, modelOffset + 4)) !== 'glTF') {
    throw new PascalBundleError('invalid_model')
  }
  try {
    const sceneBytes = isV2
      ? new Uint8Array(
          await new Response(
            new Blob([bytes.slice(HEADER_BYTES, modelOffset)]).stream().pipeThrough(new DecompressionStream('gzip')),
          ).arrayBuffer(),
        )
      : bytes.slice(HEADER_BYTES, modelOffset)
    const scene = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(sceneBytes))
    return { scene, model: new Blob([bytes.slice(modelOffset)], { type: 'model/gltf-binary' }) }
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) {
      throw new PascalBundleError('invalid_json')
    }
    throw error
  }
}

export function attachPascalBundleAsset(scene: unknown, assetUrl: string): unknown {
  if (typeof scene !== 'object' || scene === null || !('nodes' in scene)) return scene
  const nodes = scene.nodes
  if (typeof nodes !== 'object' || nodes === null) return scene
  const updatedNodes = Object.fromEntries(
    Object.entries(nodes).map(([id, node]) => {
      if (typeof node !== 'object' || node === null || !('type' in node) || node.type !== 'scan') {
        return [id, node]
      }
      return [id, { ...node, url: assetUrl }]
    }),
  )
  return { ...scene, nodes: updatedNodes }
}

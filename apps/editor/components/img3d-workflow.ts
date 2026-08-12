import { type AssetInput, saveStoredAsset } from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { z } from 'zod'
import { compileImg3dSculpt, type Img3dDimensions } from '../lib/img3d-compiler'
import { Img3dRequestSchema, Img3dSculptSchema } from '../lib/img3d-contract'

const ErrorResponseSchema = z.object({ message: z.string().trim().min(1).optional() }).passthrough()
const Img3dDimensionsSchema = z
  .object({
    width: z.number().finite().min(0.001).max(100),
    height: z.number().finite().min(0.001).max(100),
    depth: z.number().finite().min(0.001).max(100),
  })
  .strict()
  .readonly()

export type Img3dDimensionDraft = {
  readonly width: string
  readonly height: string
  readonly depth: string
}

type GenerateInput = {
  readonly file: File
  readonly dimensions: Img3dDimensions
  readonly signal?: AbortSignal
}

type GenerateDependencies = {
  readonly request: typeof fetch
  readonly compile: typeof compileImg3dSculpt
  readonly save: typeof saveStoredAsset
  readonly createId: () => string
  readonly place: (asset: AssetInput) => void
}

export class Img3dGenerationError extends Error {
  readonly name = 'Img3dGenerationError'
}

export function detachImg3dRequest(request: typeof fetch): typeof fetch {
  return (...args) => request(...args)
}

export function parseImg3dDimensions(draft: Img3dDimensionDraft): Img3dDimensions | null {
  const parsed = Img3dDimensionsSchema.safeParse({
    width: Number(draft.width),
    height: Number(draft.height),
    depth: Number(draft.depth),
  })
  return parsed.success ? parsed.data : null
}

export async function readImg3dReference(file: File): Promise<{
  readonly name: string
  readonly mimeType: string
  readonly dataUrl: string
}> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32_768)))
  }
  const dataUrl = `data:${file.type};base64,${btoa(chunks.join(''))}`
  return { name: file.name, mimeType: file.type, dataUrl }
}

async function responseError(response: Response): Promise<Img3dGenerationError> {
  const body: unknown = await response.json().catch(() => null)
  const parsed = ErrorResponseSchema.safeParse(body)
  return new Img3dGenerationError(
    parsed.success && parsed.data.message
      ? parsed.data.message
      : '3D 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.',
  )
}

export async function generateImg3dAsset(
  input: GenerateInput,
  dependencies: GenerateDependencies,
): Promise<void> {
  const image = await readImg3dReference(input.file)
  const payload = Img3dRequestSchema.parse({
    image,
    dimensions: input.dimensions,
    provider: 'codex',
    model: null,
    effort: null,
  })
  const response = await dependencies.request('/api/ai/img3d', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: input.signal,
  })
  if (!response.ok) throw await responseError(response)

  const sculpt = Img3dSculptSchema.parse(await response.json())
  const assetId = dependencies.createId()
  const compiled = await dependencies.compile(sculpt, {
    assetId,
    thumbnail: image.dataUrl,
    dimensions: input.dimensions,
  })
  const src = await dependencies.save(assetId, compiled.glb)
  dependencies.place({ ...compiled.asset, src })
}

export const img3dWorkflowDependencies: GenerateDependencies = {
  request: detachImg3dRequest(fetch),
  compile: compileImg3dSculpt,
  save: saveStoredAsset,
  createId: () => crypto.randomUUID(),
  place: (asset) => {
    useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
    const editor = useEditor.getState()
    editor.setSelectedItem(asset)
    editor.setTool('item')
    editor.setMode('build')
  },
}

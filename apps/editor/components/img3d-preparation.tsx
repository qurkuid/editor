'use client'

import { ImageUp } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { z } from 'zod'
import { Img3dDialog, type Img3dGenerationState, type Img3dImageMetadata } from './img3d-dialog'
import {
  generateImg3dAsset,
  type Img3dDimensionDraft,
  Img3dGenerationError,
  img3dWorkflowDependencies,
  parseImg3dDimensions,
} from './img3d-workflow'

const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const DEFAULT_DIMENSIONS: Img3dDimensionDraft = { width: '0.8', height: '0.8', depth: '0.6' }

const ImageSizeSchema = z.object({ width: z.number().positive(), height: z.number().positive() })

export function validateImg3dReference(file: File): string | null {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) return 'PNG, JPEG, WebP 이미지만 선택할 수 있습니다.'
  if (file.size > MAX_IMAGE_BYTES) return '이미지는 5MB 이하여야 합니다.'
  return null
}

function readImageSize(
  previewUrl: string,
): Promise<{ readonly width: number; readonly height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const parsed = ImageSizeSchema.safeParse({
        width: image.naturalWidth,
        height: image.naturalHeight,
      })
      parsed.success
        ? resolve(parsed.data)
        : reject(new Img3dGenerationError('이미지 크기를 읽을 수 없습니다.'))
    }
    image.onerror = () => reject(new Img3dGenerationError('이미지 크기를 읽을 수 없습니다.'))
    image.src = previewUrl
  })
}

export function Img3dPreparation() {
  const inputId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const tileRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const previewUrlRef = useRef<string | null>(null)
  const generationRef = useRef<AbortController | null>(null)
  const [open, setOpen] = useState(false)
  const [metadata, setMetadata] = useState<Img3dImageMetadata | null>(null)
  const [dimensions, setDimensions] = useState<Img3dDimensionDraft>(DEFAULT_DIMENSIONS)
  const [state, setState] = useState<Img3dGenerationState>({ kind: 'idle' })
  const parsedDimensions = parseImg3dDimensions(dimensions)
  const generating = state.kind === 'generating'

  const releasePreview = useCallback(() => {
    if (!previewUrlRef.current) return
    URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = null
  }, [])

  const close = useCallback(() => {
    if (generating) return
    releasePreview()
    setOpen(false)
    setMetadata(null)
    setDimensions(DEFAULT_DIMENSIONS)
    setState({ kind: 'idle' })
    tileRef.current?.focus()
  }, [generating, releasePreview])

  useEffect(
    () => () => {
      generationRef.current?.abort()
      releasePreview()
    },
    [releasePreview],
  )
  useEffect(() => {
    if (!open) return
    closeButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [close, open])

  const selectFile = useCallback(
    async (file: File) => {
      const validationError = validateImg3dReference(file)
      if (validationError) {
        releasePreview()
        setMetadata(null)
        setState({ kind: 'error', message: validationError })
        return
      }
      releasePreview()
      const previewUrl = URL.createObjectURL(file)
      previewUrlRef.current = previewUrl
      setMetadata(null)
      setState({ kind: 'idle' })
      try {
        const size = await readImageSize(previewUrl)
        if (previewUrlRef.current === previewUrl) setMetadata({ file, previewUrl, ...size })
      } catch (error) {
        if (previewUrlRef.current !== previewUrl) return
        if (!(error instanceof Img3dGenerationError)) throw error
        releasePreview()
        setState({ kind: 'error', message: error.message })
      }
    },
    [releasePreview],
  )

  const generate = useCallback(async () => {
    if (!(metadata && parsedDimensions) || generationRef.current) return
    const controller = new AbortController()
    generationRef.current = controller
    setState({ kind: 'generating' })
    try {
      await generateImg3dAsset(
        { file: metadata.file, dimensions: parsedDimensions, signal: controller.signal },
        img3dWorkflowDependencies,
      )
      releasePreview()
      setOpen(false)
      setMetadata(null)
      setDimensions(DEFAULT_DIMENSIONS)
      setState({ kind: 'idle' })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      setState({
        kind: 'error',
        message:
          error instanceof Img3dGenerationError
            ? error.message
            : '3D 생성에 실패했습니다. 잠시 후 다시 시도해 주세요.',
      })
    } finally {
      if (generationRef.current === controller) generationRef.current = null
    }
  }, [metadata, parsedDimensions, releasePreview])

  return (
    <>
      <button
        aria-label="img3d 열기"
        className="group relative flex flex-col gap-1.5 rounded-xl p-1.5 transition-colors hover:cursor-pointer hover:bg-sidebar-accent"
        onClick={() => setOpen(true)}
        ref={tileRef}
        type="button"
      >
        <span className="flex aspect-square w-full items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:text-foreground">
          <ImageUp aria-hidden="true" className="size-7" />
        </span>
        <span className="truncate px-0.5 text-left font-medium text-[11px] text-muted-foreground group-hover:text-foreground">
          img3d
        </span>
      </button>
      <input
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        id={inputId}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void selectFile(file)
        }}
        ref={inputRef}
        type="file"
      />
      {open && (
        <Img3dDialog
          closeButtonRef={closeButtonRef}
          dimensions={dimensions}
          dimensionsValid={parsedDimensions !== null}
          metadata={metadata}
          onChooseImage={() => inputRef.current?.click()}
          onClose={close}
          onDimensionsChange={setDimensions}
          onGenerate={() => void generate()}
          state={state}
        />
      )}
    </>
  )
}

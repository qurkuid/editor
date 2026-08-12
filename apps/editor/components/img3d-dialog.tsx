import { ImageUp, LoaderCircle, X } from 'lucide-react'
import type { RefObject } from 'react'
import type { Img3dDimensionDraft } from './img3d-workflow'

export type Img3dImageMetadata = {
  readonly file: File
  readonly width: number
  readonly height: number
  readonly previewUrl: string
}

export type Img3dGenerationState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'generating' }
  | { readonly kind: 'error'; readonly message: string }

type Img3dDialogProps = {
  readonly metadata: Img3dImageMetadata | null
  readonly dimensions: Img3dDimensionDraft
  readonly state: Img3dGenerationState
  readonly dimensionsValid: boolean
  readonly closeButtonRef: RefObject<HTMLButtonElement | null>
  readonly onClose: () => void
  readonly onChooseImage: () => void
  readonly onDimensionsChange: (next: Img3dDimensionDraft) => void
  readonly onGenerate: () => void
}

function formatFileSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))}KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export function Img3dDialog(props: Img3dDialogProps) {
  const generating = props.state.kind === 'generating'
  return (
    <div
      className="absolute inset-0 z-[60] flex items-center justify-center bg-black/50 p-3"
      onClick={props.onClose}
      role="presentation"
    >
      <section
        aria-labelledby="img3d-title"
        aria-modal="true"
        className="w-full rounded-xl border border-border bg-background p-3 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-medium text-sm" id="img3d-title">
            img3d
          </h2>
          <button
            aria-label="img3d 닫기"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            disabled={generating}
            onClick={props.onClose}
            ref={props.closeButtonRef}
            type="button"
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </div>
        <button
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-2 font-medium text-xs hover:bg-muted/70 disabled:opacity-50"
          disabled={generating}
          onClick={props.onChooseImage}
          type="button"
        >
          <ImageUp aria-hidden="true" className="size-3.5" />
          참조 이미지 선택
        </button>
        <p className="mt-1.5 text-[11px] text-muted-foreground">PNG, JPEG, WebP · 최대 5MB</p>
        {props.metadata && <ReferencePreview metadata={props.metadata} />}
        <DimensionInputs
          dimensions={props.dimensions}
          disabled={generating}
          onChange={props.onDimensionsChange}
        />
        {props.state.kind === 'error' && (
          <p aria-live="assertive" className="mt-2 text-destructive text-xs" role="alert">
            {props.state.message}
          </p>
        )}
        {generating && (
          <p
            aria-live="polite"
            className="mt-2 flex items-center gap-1.5 text-muted-foreground text-xs"
            role="status"
          >
            <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" />
            3D 모델을 생성하고 있습니다.
          </p>
        )}
        <button
          className="mt-3 w-full rounded-md bg-primary px-2 py-1.5 font-medium text-primary-foreground text-xs disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!props.metadata || !props.dimensionsValid || generating}
          onClick={props.onGenerate}
          type="button"
        >
          {generating ? '생성 중…' : 'Generate 3D'}
        </button>
      </section>
    </div>
  )
}

function ReferencePreview({ metadata }: { readonly metadata: Img3dImageMetadata }) {
  return (
    <div className="mt-3 grid grid-cols-[4.5rem_1fr] gap-2.5 rounded-lg bg-muted p-2.5">
      <img
        alt="선택한 참조 이미지"
        className="aspect-square w-full rounded-md object-cover"
        height={72}
        src={metadata.previewUrl}
        width={72}
      />
      <dl className="grid min-w-0 grid-cols-[auto_1fr] content-center gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">파일</dt>
        <dd className="min-w-0 truncate text-right">{metadata.file.name}</dd>
        <dt className="text-muted-foreground">크기</dt>
        <dd className="text-right">
          {metadata.width} × {metadata.height}px
        </dd>
        <dt className="text-muted-foreground">용량</dt>
        <dd className="text-right">{formatFileSize(metadata.file.size)}</dd>
      </dl>
    </div>
  )
}

function DimensionInputs({
  dimensions,
  disabled,
  onChange,
}: {
  readonly dimensions: Img3dDimensionDraft
  readonly disabled: boolean
  readonly onChange: (next: Img3dDimensionDraft) => void
}) {
  return (
    <fieldset className="mt-3" disabled={disabled}>
      <legend className="mb-1.5 text-[11px] text-muted-foreground">실제 크기 (m)</legend>
      <div className="grid grid-cols-3 gap-2">
        {(['width', 'height', 'depth'] as const).map((axis) => (
          <label className="grid gap-1 text-[11px] text-muted-foreground" key={axis}>
            {axis === 'width' ? '너비' : axis === 'height' ? '높이' : '깊이'}
            <input
              aria-label={`${axis} metres`}
              className="w-full rounded-md bg-muted px-2 py-1.5 text-foreground text-xs outline-none focus:ring-2 focus:ring-ring/50"
              max={100}
              min={0.001}
              onChange={(event) => onChange({ ...dimensions, [axis]: event.currentTarget.value })}
              step={0.01}
              type="number"
              value={dimensions[axis]}
            />
          </label>
        ))}
      </div>
    </fieldset>
  )
}

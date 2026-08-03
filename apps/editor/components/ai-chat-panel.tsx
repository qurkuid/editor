'use client'

import { useScene } from '@pascal-app/core'
import { type Locale, translate, useLocale, useT } from '@pascal-app/editor'
import { Bot, Braces, Check, ImagePlus, LoaderCircle, Send, TerminalSquare, X } from 'lucide-react'
import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { type AiModelingPlan, AiModelingPlanSchema, buildAiSceneContext } from '@/lib/ai-control'
import { applyAiModelingPlanWithAssets } from '@/lib/ai-control-assets'
import useAiProvider from '@/lib/ai-provider-store'
import { withBasePath } from '@/lib/base-path'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'status'
  content: string
}

const ProviderStatusSchema = z.object({
  configured: z.boolean(),
  model: z.string().nullable(),
})

const DualProviderStatusSchema = z.object({
  codex: ProviderStatusSchema,
  claude: ProviderStatusSchema,
})

const ApiErrorSchema = z.object({
  message: z.string().optional(),
})

export const AI_CHAT_MAX_IMAGES = 4
export const AI_CHAT_MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const AI_CHAT_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
export const AI_CHAT_IMAGE_ACCEPT = AI_CHAT_IMAGE_MIME_TYPES.join(',')

type AiImageAttachment = {
  readonly id: string
  readonly name: string
  readonly mimeType: (typeof AI_CHAT_IMAGE_MIME_TYPES)[number]
  readonly size: number
  readonly dataUrl: string
}

export function validateAiChatImageFile(file: Pick<File, 'size' | 'type'>): string | null {
  const locale = useLocale.getState().locale
  if (!AI_CHAT_IMAGE_MIME_TYPES.includes(file.type as (typeof AI_CHAT_IMAGE_MIME_TYPES)[number])) {
    return translate('aiChat.imageErrors.unsupportedType', locale)
  }
  if (file.size <= 0 || file.size > AI_CHAT_MAX_IMAGE_BYTES) {
    return translate('aiChat.imageErrors.tooLarge', locale)
  }
  return null
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Could not read image'))
      }
    }
    reader.onerror = () => reject(new Error('Could not read image'))
    reader.readAsDataURL(file)
  })
}

function jsonRequest(method: 'GET' | 'POST', url: string, body?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open(method, url)
    request.responseType = 'json'
    if (body !== undefined) request.setRequestHeader('Content-Type', 'application/json')
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.response)
        return
      }
      const error = ApiErrorSchema.safeParse(request.response)
      const fallback = translate('aiChat.errors.requestFailed', useLocale.getState().locale)
      reject(new Error(error.success ? (error.data.message ?? fallback) : fallback))
    }
    request.onerror = () =>
      reject(new Error(translate('aiChat.errors.requestFailed', useLocale.getState().locale)))
    request.send(body === undefined ? null : JSON.stringify(body))
  })
}

const OPERATION_LABEL_KEYS = {
  create: 'aiChat.op.create',
  update: 'aiChat.op.update',
  delete: 'aiChat.op.delete',
  pushPullBodyFace: 'aiChat.op.pushPullBodyFace',
  transformBody: 'aiChat.op.transformBody',
  paintBodyFace: 'aiChat.op.paintBodyFace',
  makeMaterialSeamless: 'aiChat.op.makeMaterialSeamless',
  updateSceneMaterial: 'aiChat.op.updateSceneMaterial',
  createRoundedRectangularFrameBody: 'aiChat.op.createRoundedRectangularFrameBody',
  createFurniture: 'aiChat.op.createFurniture',
  setFurnitureTierInterior: 'aiChat.op.setFurnitureTierInterior',
  insertFurnitureBay: 'aiChat.op.insertFurnitureBay',
  deleteFurnitureBay: 'aiChat.op.deleteFurnitureBay',
  resizeFurnitureBay: 'aiChat.op.resizeFurnitureBay',
  insertFurnitureTier: 'aiChat.op.insertFurnitureTier',
  deleteFurnitureTier: 'aiChat.op.deleteFurnitureTier',
  resizeFurnitureTier: 'aiChat.op.resizeFurnitureTier',
} as const

export function operationLabel(plan: AiModelingPlan, locale: Locale = 'ko'): string {
  const counts: Record<keyof typeof OPERATION_LABEL_KEYS, number> = {
    create: 0,
    update: 0,
    delete: 0,
    pushPullBodyFace: 0,
    transformBody: 0,
    paintBodyFace: 0,
    makeMaterialSeamless: 0,
    updateSceneMaterial: 0,
    createRoundedRectangularFrameBody: 0,
    createFurniture: 0,
    setFurnitureTierInterior: 0,
    insertFurnitureBay: 0,
    deleteFurnitureBay: 0,
    resizeFurnitureBay: 0,
    insertFurnitureTier: 0,
    deleteFurnitureTier: 0,
    resizeFurnitureTier: 0,
  }
  for (const patch of plan.patches) counts[patch.op] += 1
  return (Object.keys(OPERATION_LABEL_KEYS) as (keyof typeof OPERATION_LABEL_KEYS)[])
    .map((op) =>
      counts[op] > 0 ? `${translate(OPERATION_LABEL_KEYS[op], locale)} ${counts[op]}` : null,
    )
    .filter(Boolean)
    .join(' · ')
}

export function AiChatPanel() {
  const t = useT()
  const locale = useLocale((state) => state.locale)
  const nodeCount = useScene((state) => Object.keys(state.nodes).length)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const aiProvider = useAiProvider((state) => state.provider)
  const providerLabel =
    aiProvider === 'claude' ? t('hostSettings.aiProviderClaude') : t('hostSettings.aiProviderCodex')
  const [providerStatuses, setProviderStatuses] = useState<z.infer<
    typeof DualProviderStatusSchema
  > | null>(null)
  const provider = providerStatuses?.[aiProvider] ?? null
  const [messages, setMessages] = useState<ChatMessage[]>([
    { id: 'welcome', role: 'assistant', content: t('aiChat.welcome') },
  ])
  const [draft, setDraft] = useState('')
  const [pendingPlan, setPendingPlan] = useState<AiModelingPlan | null>(null)
  const [isThinking, setIsThinking] = useState(false)
  const [isReadingImages, setIsReadingImages] = useState(false)
  const [imageAttachments, setImageAttachments] = useState<AiImageAttachment[]>([])
  const [imageError, setImageError] = useState<string | null>(null)

  useEffect(() => {
    jsonRequest('GET', withBasePath('/api/ai/chat'))
      .then((response) => setProviderStatuses(DualProviderStatusSchema.parse(response)))
      .catch(() =>
        setProviderStatuses({
          codex: { configured: false, model: null },
          claude: { configured: false, model: null },
        }),
      )
  }, [])

  const conversation = useMemo(
    () => messages.filter((message) => message.role !== 'status'),
    [messages],
  )

  async function handleImageSelection(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return

    const available = AI_CHAT_MAX_IMAGES - imageAttachments.length
    const maxCountError = t('aiChat.imageErrors.maxCount').replace(
      '{max}',
      String(AI_CHAT_MAX_IMAGES),
    )
    const errors: string[] = []
    const acceptedFiles: File[] = []

    for (const file of files) {
      const error = validateAiChatImageFile(file)
      if (error) {
        errors.push(`${file.name}: ${error}`)
        continue
      }
      if (acceptedFiles.length >= available) {
        errors.push(maxCountError)
        continue
      }
      acceptedFiles.push(file)
    }

    if (acceptedFiles.length === 0) {
      setImageError(errors[0] ?? maxCountError)
      return
    }

    setIsReadingImages(true)
    try {
      const loadedImages = await Promise.all(
        acceptedFiles.map(
          async (file): Promise<AiImageAttachment> => ({
            id: crypto.randomUUID(),
            name: file.name,
            mimeType: file.type as AiImageAttachment['mimeType'],
            size: file.size,
            dataUrl: await readFileAsDataUrl(file),
          }),
        ),
      )
      setImageAttachments((current) => [...current, ...loadedImages].slice(0, AI_CHAT_MAX_IMAGES))
      setImageError(errors[0] ?? null)
    } catch {
      setImageError(t('aiChat.imageErrors.readFailed'))
    } finally {
      setIsReadingImages(false)
    }
  }

  function removeImageAttachment(id: string) {
    setImageAttachments((current) => current.filter((image) => image.id !== id))
    setImageError(null)
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!(content && !isThinking && !isReadingImages)) return

    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: 'user', content }
    const nextMessages = [...conversation, userMessage]
    const images = imageAttachments.map(({ name, mimeType, dataUrl }) => ({
      name,
      mimeType,
      dataUrl,
    }))
    setMessages((current) => [...current, userMessage])
    setDraft('')
    setPendingPlan(null)
    setIsThinking(true)

    try {
      const response = await jsonRequest('POST', withBasePath('/api/ai/chat'), {
        messages: nextMessages.map(({ role, content: messageContent }) => ({
          role,
          content: messageContent,
        })),
        images,
        provider: aiProvider,
        scene: buildAiSceneContext(),
      })
      const plan = AiModelingPlanSchema.parse(response)
      setImageAttachments([])
      setImageError(null)
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: 'assistant', content: plan.message },
      ])
      setPendingPlan(plan.patches.length > 0 ? plan : null)
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'status',
          content: error instanceof Error ? error.message : t('aiChat.errors.requestFailed'),
        },
      ])
    } finally {
      setIsThinking(false)
    }
  }

  async function applyPlan() {
    if (!pendingPlan) return
    setIsThinking(true)
    try {
      const result = await applyAiModelingPlanWithAssets(pendingPlan)
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'status',
          content: t('aiChat.pendingPlan.appliedStatus').replace('{n}', String(result.appliedOps)),
        },
      ])
      setPendingPlan(null)
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'status',
          content: error instanceof Error ? error.message : t('aiChat.pendingPlan.applyFailed'),
        },
      ])
    } finally {
      setIsThinking(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="border-border/60 border-b px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 font-semibold text-sm">
              <Bot className="h-4 w-4 text-emerald-500" />
              {t('aiChat.header.title')}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">{t('aiChat.header.desc')}</p>
          </div>
          <span
            className={`mt-0.5 h-2 w-2 rounded-full ${provider?.configured ? 'bg-emerald-500' : 'bg-amber-500'}`}
            title={
              provider?.configured
                ? t('aiChat.header.connectedTitle').replace('{provider}', providerLabel)
                : t('aiChat.header.notConnectedTitle').replace('{provider}', providerLabel)
            }
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-1.5 text-[10px] text-muted-foreground">
          <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
            <Braces className="h-3 w-3" />{' '}
            {t('aiChat.header.nodesBadge').replace('{n}', String(nodeCount))}
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5">
            <TerminalSquare className="h-3 w-3" />{' '}
            {t('aiChat.header.oauthBadge').replace('{provider}', providerLabel)}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {messages.map((message) => (
          <div
            className={
              message.role === 'user'
                ? 'ml-6 rounded-xl rounded-br-sm bg-foreground px-3 py-2 text-background text-xs'
                : message.role === 'status'
                  ? 'rounded-md border border-amber-500/30 bg-amber-500/8 px-2.5 py-2 text-[11px] text-foreground'
                  : 'mr-3 rounded-xl rounded-bl-sm border border-border/60 bg-muted/35 px-3 py-2 text-foreground text-xs'
            }
            key={message.id}
          >
            {message.content}
          </div>
        ))}
        {isThinking && (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> {t('aiChat.thinking')}
          </div>
        )}
        {pendingPlan && (
          <div className="rounded-lg border border-emerald-500/35 bg-emerald-500/7 p-3">
            <div className="font-medium text-[11px] text-emerald-700 dark:text-emerald-300">
              {t('aiChat.pendingPlan.pending').replace('{op}', operationLabel(pendingPlan, locale))}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">{t('aiChat.pendingPlan.desc')}</p>
            <button
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 py-2 font-medium text-white text-xs hover:bg-emerald-500"
              onClick={applyPlan}
              type="button"
            >
              <Check className="h-3.5 w-3.5" /> {t('aiChat.pendingPlan.apply')}
            </button>
          </div>
        )}
      </div>

      <form className="border-border/60 border-t p-3" onSubmit={submit}>
        {!provider?.configured && (
          <p className="mb-2 text-[10px] text-amber-600 dark:text-amber-400">
            {t('aiChat.loginRequired').replace('{provider}', providerLabel)}
          </p>
        )}
        {imageAttachments.length > 0 && (
          <div
            aria-label={t('aiChat.attach.list.ariaLabel')}
            className="mb-2 flex flex-wrap gap-2"
            role="list"
          >
            {imageAttachments.map((image) => (
              <div className="group relative w-16" key={image.id} role="listitem">
                <img
                  alt={image.name}
                  className="h-16 w-16 rounded-md border border-border/60 object-cover"
                  src={image.dataUrl}
                />
                <button
                  aria-label={t('aiChat.attach.remove').replace('{name}', image.name)}
                  className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:text-foreground"
                  onClick={() => removeImageAttachment(image.id)}
                  title={t('aiChat.attach.remove').replace('{name}', image.name)}
                  type="button"
                >
                  <X className="h-3 w-3" />
                </button>
                <span
                  className="mt-1 block truncate text-[9px] text-muted-foreground"
                  title={image.name}
                >
                  {image.name}
                </span>
              </div>
            ))}
          </div>
        )}
        {imageError && (
          <p className="mb-2 text-[10px] text-amber-600 dark:text-amber-400" role="alert">
            {imageError}
          </p>
        )}
        <div className="rounded-lg border border-border bg-background shadow-sm focus-within:border-foreground/40">
          <textarea
            aria-label={t('aiChat.textarea.ariaLabel')}
            className="min-h-20 w-full resize-none bg-transparent px-3 pt-2.5 text-xs outline-none placeholder:text-muted-foreground/70"
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('aiChat.textarea.placeholder')}
            value={draft}
          />
          <div className="flex items-center justify-between px-2 pb-2">
            <div className="flex min-w-0 items-center gap-2">
              <input
                accept={AI_CHAT_IMAGE_ACCEPT}
                className="sr-only"
                disabled={isThinking || isReadingImages}
                multiple
                onChange={handleImageSelection}
                ref={fileInputRef}
                type="file"
              />
              <button
                aria-label={t('aiChat.attach.button.ariaLabel')}
                className="flex shrink-0 items-center gap-1 rounded-md border border-border/70 px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                disabled={
                  imageAttachments.length >= AI_CHAT_MAX_IMAGES || isThinking || isReadingImages
                }
                onClick={() => fileInputRef.current?.click()}
                type="button"
              >
                <ImagePlus className="h-3 w-3" /> {t('aiChat.attach.button.label')}
              </button>
              <span className="truncate text-[9px] text-muted-foreground">
                {isReadingImages
                  ? t('aiChat.attach.statusReading')
                  : t('aiChat.attach.statusCount')
                      .replace('{n}', String(imageAttachments.length))
                      .replace('{max}', String(AI_CHAT_MAX_IMAGES))}
              </span>
            </div>
            <button
              aria-label={t('aiChat.send.ariaLabel')}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-foreground text-background disabled:opacity-30"
              disabled={!draft.trim() || isThinking || isReadingImages}
              type="submit"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

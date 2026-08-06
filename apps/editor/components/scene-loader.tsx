'use client'

// Node registry bootstrap is loaded once at the root via
// `<ClientBootstrap>` in `app/layout.tsx` — no per-page side-effect
// import here.
import { emitter } from '@pascal-app/core'
import {
  applySceneGraphToEditor,
  Editor,
  type SceneGraph,
  type SidebarTab,
  useT,
} from '@pascal-app/editor'
import {
  Armchair,
  BarChart3,
  Bot,
  Camera,
  Hammer,
  Layers,
  Lightbulb,
  Package,
  PaintBucket,
  Settings,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { withBasePath } from '@/lib/base-path'
import { AiChatPanel } from './ai-chat-panel'
import { FurnitureTab } from './furniture-tab'
import { GuidedBuildTab } from './guided-build-tab'
import { HostSettingsSection } from './host-settings-section'
import { IntmMaterialLibrary } from './intm-material-library'
import { LightingTab } from './lighting-tab'
import { ModelingRailControls } from './modeling-rail-controls'
import { PaintingTab } from './painting-tab'
import { SkpItemsPanel } from './skp-items-panel'
import { StatsTab } from './stats-tab'
import { CommunityViewerToolbarLeft, CommunityViewerToolbarRight } from './viewer-toolbar'

export interface SceneMeta {
  id: string
  name: string
  projectId: string | null
  thumbnailUrl: string | null
  version: number
  createdAt: string
  updatedAt: string
  ownerId: string | null
  sizeBytes: number
  nodeCount: number
}

// Matches the standalone editor's own Items panel (see `app/page.tsx`) — the
// scene route registers its tabs separately, so anything added there has to be
// added here too or it only exists on the home route.
const EditorItemsPanel = SkpItemsPanel

// Labels resolve from the current locale at render time (see `buildSidebarTabs`
// below) — this array must not be read directly for `label`.
function buildSidebarTabs(
  t: ReturnType<typeof useT>,
): (SidebarTab & { component: React.ComponentType })[] {
  return [
    {
      id: 'site',
      label: t('sidebarTabs.scene'),
      component: () => null, // Built-in SitePanel handles this
      mobileDefaultSnap: 0.5,
      mobileIcon: <Layers className="h-5 w-5" />,
      icon: (
        <Image
          alt=""
          className="h-8 w-8 object-contain"
          height={32}
          src="/icons/scene.webp"
          width={32}
        />
      ),
    },
    {
      id: 'build',
      label: t('sidebarTabs.modeling'),
      component: GuidedBuildTab,
      mobileDefaultSnap: 0.5,
      mobileIcon: <Hammer className="h-5 w-5" />,
      icon: (
        <Image
          alt=""
          className="h-8 w-8 object-contain"
          height={32}
          src="/icons/build.webp"
          width={32}
        />
      ),
    },
    {
      id: 'furniture',
      label: t('sidebarTabs.furniture'),
      component: FurnitureTab,
      mobileDefaultSnap: 0.75,
      mobileIcon: <Armchair className="h-5 w-5" />,
      icon: <Armchair className="h-5 w-5" />,
    },
    {
      id: 'lighting',
      label: t('sidebarTabs.lighting'),
      component: LightingTab,
      mobileDefaultSnap: 0.75,
      mobileIcon: <Lightbulb className="h-5 w-5" />,
      icon: <Lightbulb className="h-5 w-5" />,
    },
    {
      id: 'items',
      label: t('sidebarTabs.items'),
      component: EditorItemsPanel,
      mobileDefaultSnap: 0.5,
      mobileIcon: <Package className="h-5 w-5" />,
      icon: (
        <Image
          alt=""
          className="h-8 w-8 object-contain"
          height={32}
          src="/icons/couch.webp"
          width={32}
        />
      ),
    },
    {
      id: 'painting',
      label: t('sidebarTabs.painting'),
      component: PaintingTab,
      mobileDefaultSnap: 0.85,
      mobileIcon: <PaintBucket className="h-5 w-5" />,
      icon: (
        <Image
          alt=""
          className="h-8 w-8 object-contain"
          height={32}
          src="/icons/paint.webp"
          width={32}
        />
      ),
    },
    {
      id: 'stats',
      label: t('sidebarTabs.stats'),
      component: StatsTab,
      mobileDefaultSnap: 0.75,
      mobileIcon: <BarChart3 className="h-5 w-5" />,
      icon: <BarChart3 className="h-5 w-5" />,
    },
    {
      id: 'ai',
      label: t('sidebarTabs.ai'),
      component: AiChatPanel,
      mobileDefaultSnap: 0.85,
      mobileIcon: <Bot className="h-5 w-5" />,
      icon: <Bot className="h-5 w-5" />,
    },
    {
      id: 'views',
      label: t('sidebarTabs.views'),
      component: () => null, // Built-in ViewsPanel handles this
      mobileDefaultSnap: 0.5,
      mobileIcon: <Camera className="h-5 w-5" />,
      icon: (
        <Image
          alt=""
          className="h-8 w-8 object-contain"
          height={32}
          src="/icons/orbit.webp"
          width={32}
        />
      ),
    },
    {
      id: 'settings',
      label: t('sidebarTabs.settings'),
      component: () => null,
      mobileDefaultSnap: 0.5,
      mobileIcon: <Settings className="h-5 w-5" />,
      icon: (
        <Image
          alt=""
          className="h-8 w-8 object-contain"
          height={32}
          src="/icons/settings.webp"
          width={32}
        />
      ),
    },
  ]
}

interface SceneLoaderProps {
  initialScene: SceneGraph
  meta: SceneMeta
}

type SceneGraphWithCollections = SceneGraph & {
  collections?: Record<string, unknown>
}

interface LiveSceneEvent {
  eventId: number
  sceneId: string
  version: number
  kind: string
  createdAt: string
  graph: SceneGraphWithCollections
}

function sceneGraphSignature(graph: SceneGraphWithCollections): string {
  return JSON.stringify({
    nodes: graph.nodes,
    rootNodeIds: graph.rootNodeIds,
    collections: graph.collections,
    installedPlugins: graph.installedPlugins,
    savedViews: graph.savedViews,
  })
}

export function SceneLoader({ initialScene, meta }: SceneLoaderProps) {
  const router = useRouter()
  const versionRef = useRef(meta.version)
  const lastThumbnailAtRef = useRef(0)
  const lastRemoteGraphJsonRef = useRef<string | null>(null)
  const suppressRemoteSaveUntilRef = useRef(0)
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const t = useT()
  const sidebarTabs = useMemo(() => buildSidebarTabs(t), [t])

  const handleLoad = useCallback(async () => initialScene, [initialScene])

  const handleSave = useCallback(
    async (graph: SceneGraph, options?: { keepalive?: boolean }) => {
      const graphJson = sceneGraphSignature(graph)
      const isRecentRemoteApply = Date.now() < suppressRemoteSaveUntilRef.current
      if (lastRemoteGraphJsonRef.current === graphJson) {
        lastRemoteGraphJsonRef.current = null
        suppressRemoteSaveUntilRef.current = 0
        return
      }
      if (isRecentRemoteApply) return

      try {
        const response = await fetch(withBasePath(`/api/scenes/${meta.id}`), {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'If-Match': String(versionRef.current),
          },
          body: JSON.stringify({ name: meta.name, graph }),
          // `keepalive` lets the request outlive a page unload (the autosave
          // flush on refresh/close). Browsers cap keepalive bodies at 64KB, so
          // only the unload flush opts in — normal debounced saves omit it and
          // can carry arbitrarily large scenes.
          keepalive: options?.keepalive,
        })

        if (response.status === 409) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null
          if (body?.error === 'wipe_blocked') {
            // The server refused to overwrite a populated scene with a (near)
            // empty graph — almost always a failed load autosaving, not the
            // user. Surface it as an error instead of a version conflict.
            setSaveError('저장 차단: 빈 씬으로 덮어쓰기가 방지되었습니다. 새로고침 후 다시 시도하세요.')
            return
          }
          setConflict(true)
          return
        }

        if (!response.ok) {
          setSaveError(`Save failed (${response.status})`)
          return
        }

        const next = (await response.json()) as SceneMeta
        versionRef.current = next.version
        setSaveError(null)

        // Refresh the scenes-page card thumbnail alongside the autosave, at
        // most once a minute — the capture renders a frame, so don't do it
        // on every debounced save.
        if (Date.now() - lastThumbnailAtRef.current > 60_000) {
          lastThumbnailAtRef.current = Date.now()
          emitter.emit('camera-controls:generate-thumbnail', {
            projectId: meta.projectId ?? 'default',
            snapLevels: true,
          })
        }
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : 'Save failed')
      }
    },
    [meta.id, meta.name, meta.projectId],
  )

  useEffect(() => {
    const source = new EventSource(withBasePath(`/api/scenes/${meta.id}/events`))

    source.addEventListener('scene', (event) => {
      let payload: LiveSceneEvent
      try {
        payload = JSON.parse((event as MessageEvent<string>).data) as LiveSceneEvent
      } catch {
        return
      }
      if (payload.sceneId !== meta.id) return
      if (payload.version <= versionRef.current) return

      versionRef.current = payload.version
      lastRemoteGraphJsonRef.current = sceneGraphSignature(payload.graph)
      suppressRemoteSaveUntilRef.current = Date.now() + 2500
      applySceneGraphToEditor(payload.graph)
      setConflict(false)
      setSaveError(null)
    })

    source.addEventListener('error', () => {
      if (source.readyState === EventSource.CLOSED) {
        setSaveError('Live scene connection closed')
      }
    })

    return () => source.close()
  }, [meta.id])

  const handleThumb = useCallback(
    async (blob: Blob) => {
      await fetch(withBasePath(`/api/scenes/${meta.id}/thumbnail`), {
        method: 'POST',
        headers: { 'Content-Type': blob.type || 'image/webp' },
        body: blob,
      }).catch(() => {
        // Swallow errors silently; thumbnail upload is best-effort.
      })
    },
    [meta.id],
  )

  return (
    <div className="relative h-screen w-screen">
      {conflict && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-background p-4 shadow-xl">
          <h2 className="font-semibold text-sm">{t('scenes.saveConflict')}</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            Your changes haven&apos;t been saved. Reload to pick up the latest version.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              className="rounded-md border border-border bg-accent px-3 py-1.5 font-medium text-xs hover:bg-accent/80"
              onClick={() => router.refresh()}
              type="button"
            >
              Reload
            </button>
            <button
              className="rounded-md border border-border bg-background px-3 py-1.5 font-medium text-xs hover:bg-accent/40"
              onClick={() => setConflict(false)}
              type="button"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      {saveError && !conflict && (
        <div className="pointer-events-auto absolute top-4 left-1/2 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-destructive/50 bg-background p-3 shadow-xl">
          <p className="font-medium text-destructive text-xs">{saveError}</p>
        </div>
      )}
      <div className="pointer-events-none absolute top-4 right-4 z-40 flex items-center gap-2">
        <Link
          className="pointer-events-auto rounded-md border border-border bg-background/90 px-3 py-1.5 font-medium text-xs shadow-sm backdrop-blur hover:bg-accent/40"
          href="/scenes"
        >
          All scenes
        </Link>
      </div>
      {/* Also mounted in app/page.tsx — this app has two Editor roots. */}
      <IntmMaterialLibrary />
      <Editor
        actionMenuControls={<ModelingRailControls />}
        layoutVersion="v2"
        onLoad={handleLoad}
        onSave={handleSave}
        onThumbnailCapture={handleThumb}
        projectId={meta.projectId ?? 'default'}
        settingsPanelProps={{ hostSection: <HostSettingsSection /> }}
        sidebarTabs={sidebarTabs}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={<CommunityViewerToolbarRight />}
      />
    </div>
  )
}

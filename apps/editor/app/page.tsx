'use client'

import { Editor, type SaveStatus, useT } from '@pascal-app/editor'
import {
  Armchair,
  BarChart3,
  Bot,
  Hammer,
  Layers,
  Lightbulb,
  Package,
  PaintBucket,
  Settings,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { AiChatPanel } from '@/components/ai-chat-panel'
import { FurnitureTab } from '@/components/furniture-tab'
import { GuidedBuildTab } from '@/components/guided-build-tab'
import { HostSettingsSection } from '@/components/host-settings-section'
import { LightingTab } from '@/components/lighting-tab'
import { PaintingTab } from '@/components/painting-tab'
import { SkpItemsPanel } from '@/components/skp-items-panel'
import { StatsTab } from '@/components/stats-tab'
import {
  CommunityViewerToolbarLeft,
  CommunityViewerToolbarRight,
} from '@/components/viewer-toolbar'
import { localEditorSaveStatusLabel } from '@/lib/local-editor-save-status'
import { rawPainterIntegrationAdapter } from '@/lib/rawpainter-adapter'

const EditorItemsPanel = SkpItemsPanel

// Labels resolve from the current locale at render time (see `buildSidebarTabs`
// below) — this array must not be read directly for `label`.
function buildSidebarTabs(t: ReturnType<typeof useT>) {
  return [
    {
      id: 'site',
      label: t('sidebarTabs.scene'),
      component: () => null,
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

const PROJECT_ID = 'local-editor'

export default function Home() {
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const t = useT()
  const sidebarTabs = useMemo(() => buildSidebarTabs(t), [t])

  return (
    <div className="relative h-screen w-screen">
      {PROJECT_ID === 'local-editor' && (
        <div className="pointer-events-none absolute top-14 right-3 z-40">
          <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-border/60 bg-background/90 px-4 py-1.5 text-xs shadow-sm backdrop-blur">
            <span aria-live="polite" className="text-muted-foreground">
              {localEditorSaveStatusLabel(saveStatus)}
            </span>
            <Link className="font-medium text-foreground hover:underline" href="/scenes">
              Open recent scenes
            </Link>
            <span aria-hidden className="text-muted-foreground">
              ·
            </span>
            <Link className="font-medium text-foreground hover:underline" href="/scenes">
              Create new
            </Link>
          </div>
        </div>
      )}
      <Editor
        integrationAdapter={rawPainterIntegrationAdapter}
        layoutVersion="v2"
        onSaveStatusChange={setSaveStatus}
        projectId={PROJECT_ID}
        settingsPanelProps={{ hostSection: <HostSettingsSection /> }}
        sidebarTabs={sidebarTabs}
        viewerToolbarLeft={<CommunityViewerToolbarLeft />}
        viewerToolbarRight={<CommunityViewerToolbarRight />}
      />
    </div>
  )
}

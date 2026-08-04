'use client'

import { emitter } from '@pascal-app/core'
import {
  CLAY_PALETTE,
  type EdgeMode,
  getSceneTheme,
  SCENE_THEMES,
  useViewer,
} from '@pascal-app/viewer'
import {
  Box,
  Camera,
  Check,
  Contrast,
  Diamond,
  Eye,
  EyeOff,
  Footprints,
  Layers,
  Layers2,
  Palette,
  PenLine,
  SlidersHorizontal,
  Sparkles,
  Square,
  SwatchBook,
} from 'lucide-react'
import type { MessageId } from '../../i18n/translate'
import { useT } from '../../i18n/use-t'
import { assetPath } from '../../lib/asset-path'
import { cn } from '../../lib/utils'
import { ActionButton } from '../ui/action-menu/action-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '../ui/primitives/dropdown-menu'
import { TooltipProvider } from '../ui/primitives/tooltip'

const levelModeLabelKeys: Record<'stacked' | 'exploded' | 'solo', MessageId> = {
  stacked: 'chrome.levelModeStacked',
  exploded: 'chrome.levelModeExploded',
  solo: 'chrome.levelModeSolo',
}

const wallModeConfig = {
  up: {
    icon: (props: any) => (
      <img
        alt=""
        height={28}
        src={assetPath('/icons/room.webp')}
        width={28}
        {...props}
      />
    ),
    labelKey: 'chrome.wallModeUp' as MessageId,
  },
  cutaway: {
    icon: (props: any) => (
      <img alt="" height={28} src={assetPath('/icons/wallcut.webp')} width={28} {...props} />
    ),
    labelKey: 'chrome.wallModeCutaway' as MessageId,
  },
  down: {
    icon: (props: any) => (
      <img alt="" height={28} src={assetPath('/icons/walllow.webp')} width={28} {...props} />
    ),
    labelKey: 'chrome.wallModeDown' as MessageId,
  },
}

const SHADING_OPTIONS = [
  {
    id: 'solid',
    nameKey: 'chrome.shadingSolid',
    detailKey: 'chrome.shadingSolidDetail',
    icon: Box,
  },
  {
    id: 'rendered',
    nameKey: 'chrome.shadingRendered',
    detailKey: 'chrome.shadingRenderedDetail',
    icon: Sparkles,
  },
] as const

const EDGE_OPTIONS = [
  { id: 'off', nameKey: 'chrome.edgesOff', detailKey: 'chrome.edgesOffDetail' },
  { id: 'soft', nameKey: 'chrome.edgesSoft', detailKey: 'chrome.edgesSoftDetail' },
  { id: 'strong', nameKey: 'chrome.edgesStrong', detailKey: 'chrome.edgesStrongDetail' },
] as const satisfies readonly { id: EdgeMode; nameKey: MessageId; detailKey: MessageId }[]

// Keep the dropdown open when flipping an in-place toggle row.
const keepOpen = (event: Event, fn: () => void) => {
  event.preventDefault()
  fn()
}

// Scans + guides folded into one control. A baked GLB carries none of its own,
// but the GLB viewer re-adds them from scene data when the privacy flags allow,
// so the toggle shows for whichever exist.
function VisibilityMenu({
  canShowScans,
  canShowGuides,
}: {
  canShowScans: boolean
  canShowGuides: boolean
}) {
  const t = useT()
  const showScans = useViewer((s) => s.showScans)
  const showGuides = useViewer((s) => s.showGuides)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton
          className="hover:bg-white/5 hover:text-foreground"
          label={t('chrome.visibility')}
          size="icon"
          tooltipSide="top"
          variant="ghost"
        >
          <Eye className="h-5 w-5" />
        </ActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-44" side="top">
        {canShowScans && (
          <DropdownMenuItem
            onSelect={(e) => keepOpen(e, () => useViewer.getState().setShowScans(!showScans))}
          >
            <img alt="" className="h-4 w-4 object-contain" src={assetPath('/icons/mesh.webp')} />
            <span>{t('common.scans')}</span>
            {showScans ? (
              <Eye className="ml-auto h-4 w-4 text-foreground" />
            ) : (
              <EyeOff className="ml-auto h-4 w-4 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        )}
        {canShowGuides && (
          <DropdownMenuItem
            onSelect={(e) => keepOpen(e, () => useViewer.getState().setShowGuides(!showGuides))}
          >
            <img
              alt=""
              className="h-4 w-4 object-contain"
              src={assetPath('/icons/floorplan.webp')}
            />
            <span>{t('common.guides')}</span>
            {showGuides ? (
              <Eye className="ml-auto h-4 w-4 text-foreground" />
            ) : (
              <EyeOff className="ml-auto h-4 w-4 text-muted-foreground" />
            )}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// One "Display" button gathering shadows, camera projection, colors, render
// mode, scene theme and edges.
function DisplayMenu() {
  const t = useT()
  const cameraMode = useViewer((s) => s.cameraMode)
  const shading = useViewer((s) => s.shading)
  const textures = useViewer((s) => s.textures)
  const shadows = useViewer((s) => s.shadows)
  const sceneTheme = useViewer((s) => s.sceneTheme)
  const edges = useViewer((s) => s.edges)
  const activeShading = SHADING_OPTIONS.find((o) => o.id === shading) ?? SHADING_OPTIONS[0]
  const activeTheme = getSceneTheme(sceneTheme)
  const activeEdges = EDGE_OPTIONS.find((o) => o.id === edges) ?? EDGE_OPTIONS[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <ActionButton
          className="hover:bg-white/5 hover:text-foreground"
          label={t('common.displaySettings')}
          size="icon"
          tooltipSide="top"
          variant="ghost"
        >
          <SlidersHorizontal className="h-5 w-5" />
        </ActionButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="min-w-56" side="top">
        <DropdownMenuItem
          onSelect={(e) => keepOpen(e, () => useViewer.getState().setShadows(!shadows))}
        >
          <Contrast className="h-4 w-4" />
          <span>{t('common.shadows')}</span>
          <span className="ml-auto text-muted-foreground text-xs">{shadows ? 'On' : 'Off'}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) =>
            keepOpen(e, () =>
              useViewer
                .getState()
                .setCameraMode(cameraMode === 'perspective' ? 'orthographic' : 'perspective'),
            )
          }
        >
          <Camera className="h-4 w-4" />
          <span>{t('common.camera')}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {cameraMode === 'perspective' ? 'Perspective' : 'Orthographic'}
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => keepOpen(e, () => useViewer.getState().setTextures(!textures))}
        >
          {textures ? <Palette className="h-4 w-4" /> : <Square className="h-4 w-4" />}
          <span>{t('common.colors')}</span>
          <span className="ml-auto text-muted-foreground text-xs">
            {textures ? 'Colored' : 'Monochrome'}
          </span>
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <activeShading.icon className="h-4 w-4" />
            <span>{t('common.render')}</span>
            <span className="ml-auto text-muted-foreground text-xs">{t(activeShading.nameKey)}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-56">
            {SHADING_OPTIONS.map((option) => {
              const OptionIcon = option.icon
              return (
                <DropdownMenuItem
                  key={option.id}
                  onSelect={() => useViewer.getState().setShading(option.id)}
                >
                  <OptionIcon className="h-4 w-4" />
                  <div className="flex flex-col">
                    <span className="text-foreground">{t(option.nameKey)}</span>
                    <span className="text-muted-foreground text-xs">{t(option.detailKey)}</span>
                  </div>
                  {shading === option.id ? (
                    <Check className="ml-auto h-4 w-4 text-foreground" />
                  ) : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SwatchBook className="h-4 w-4" />
            <span>{t('common.theme')}</span>
            <span className="ml-auto truncate text-muted-foreground text-xs">
              {activeTheme.name}
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-48">
            {SCENE_THEMES.map((theme) => {
              const swatches = (['wall', 'roof', 'floor', 'glazing'] as const).map(
                (role) => theme.clayTints?.[role] ?? CLAY_PALETTE[role],
              )
              return (
                <DropdownMenuItem
                  className="gap-2"
                  key={theme.id}
                  onSelect={() => useViewer.getState().setSceneTheme(theme.id)}
                >
                  <span
                    className="grid h-5 w-5 shrink-0 grid-cols-2 overflow-hidden rounded-sm border border-black/10"
                    style={{ backgroundColor: theme.background }}
                  >
                    {swatches.map((color, index) => (
                      <span key={`${theme.id}-${index}`} style={{ backgroundColor: color }} />
                    ))}
                  </span>
                  <span>{theme.name}</span>
                  {sceneTheme === theme.id ? <Check className="ml-auto h-4 w-4" /> : null}
                </DropdownMenuItem>
              )
            })}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <PenLine className="h-4 w-4" />
            <span>{t('common.edges')}</span>
            <span className="ml-auto text-muted-foreground text-xs">{t(activeEdges.nameKey)}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-56">
            {EDGE_OPTIONS.map((option) => (
              <DropdownMenuItem
                key={option.id}
                onSelect={() => useViewer.getState().setEdges(option.id)}
              >
                <div className="flex flex-col">
                  <span className="text-foreground">{t(option.nameKey)}</span>
                  <span className="text-muted-foreground text-xs">{t(option.detailKey)}</span>
                </div>
                {edges === option.id ? <Check className="ml-auto h-4 w-4 text-foreground" /> : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export type ViewerControlsBarProps = {
  canShowScans?: boolean
  canShowGuides?: boolean
  /** A baked GLB is the active artifact: hide controls it can't honor (wall
   *  modes aren't baked into the GLB). */
  glbActive?: boolean
  /** In GLB mode, whether scans/guides were re-added from scene data — so the
   *  visibility control surfaces the matching toggle even though the artifact
   *  itself carries none. */
  glbHasScans?: boolean
  glbHasGuides?: boolean
  walkthroughActive?: boolean
  onWalkthroughToggle: () => void
  className?: string
}

export const ViewerControlsBar = ({
  canShowScans = true,
  canShowGuides = true,
  glbActive = false,
  glbHasScans = false,
  glbHasGuides = false,
  walkthroughActive = false,
  onWalkthroughToggle,
  className,
}: ViewerControlsBarProps) => {
  const t = useT()
  const levelMode = useViewer((s) => s.levelMode)
  const wallMode = useViewer((s) => s.wallMode)
  // Sessions may carry a stale mode outside the cycle (e.g. the retired
  // 'translucent'); render and cycle it as cutaway instead of crashing.
  const safeWallMode = (
    wallMode in wallModeConfig ? wallMode : 'cutaway'
  ) as keyof typeof wallModeConfig
  const WallModeIcon = wallModeConfig[safeWallMode].icon

  return (
    <div
      className={cn(
        'dark absolute bottom-4 left-1/2 z-20 -translate-x-1/2 text-foreground sm:bottom-6',
        className,
      )}
    >
      <TooltipProvider delayDuration={0}>
        <div className="corner-smooth pointer-events-auto flex h-12 max-w-[calc(100vw-1rem)] flex-row items-center justify-center gap-0.5 overflow-hidden rounded-2xl border border-border/40 bg-background/95 p-1 shadow-elevation-4 backdrop-blur-xl transition-colors duration-200 ease-out sm:h-14 sm:gap-1.5 sm:p-1.5">
          {((canShowScans && (!glbActive || glbHasScans)) ||
            (canShowGuides && (!glbActive || glbHasGuides))) && (
            <>
              <VisibilityMenu
                canShowGuides={canShowGuides && (!glbActive || glbHasGuides)}
                canShowScans={canShowScans && (!glbActive || glbHasScans)}
              />
              <div className="mx-1 h-5 w-px bg-border/40" />
            </>
          )}

          {/* Level mode */}
          <ActionButton
            className={
              levelMode === 'stacked'
                ? 'hover:bg-white/5 hover:text-amber-400'
                : 'bg-amber-500/20 text-amber-400'
            }
            label={`${t('chrome.levels')}: ${levelMode === 'manual' ? t('chrome.levelModeManual') : t(levelModeLabelKeys[levelMode as keyof typeof levelModeLabelKeys])}`}
            onClick={() => {
              if (levelMode === 'manual') return useViewer.getState().setLevelMode('stacked')
              const modes: ('stacked' | 'exploded' | 'solo')[] = ['stacked', 'exploded', 'solo']
              const nextIndex = (modes.indexOf(levelMode as any) + 1) % modes.length
              useViewer.getState().setLevelMode(modes[nextIndex] ?? 'stacked')
            }}
            size="icon"
            tooltipSide="top"
            variant="ghost"
          >
            {levelMode === 'solo' && <Diamond className="h-6 w-6" />}
            {levelMode === 'exploded' && <Layers2 className="h-6 w-6" />}
            {(levelMode === 'stacked' || levelMode === 'manual') && <Layers className="h-6 w-6" />}
          </ActionButton>

          {/* Wall mode — parametric only; baked GLB walls are fixed-height. */}
          {!glbActive && (
            <ActionButton
              className={
                safeWallMode === 'cutaway'
                  ? 'opacity-60 grayscale hover:bg-white/5 hover:opacity-100 hover:grayscale-0'
                  : 'bg-white/10'
              }
              label={`${t('chrome.walls')}: ${t(wallModeConfig[safeWallMode].labelKey)}`}
              onClick={() => {
                const modes: ('cutaway' | 'up' | 'down')[] = ['cutaway', 'up', 'down']
                const nextIndex = (modes.indexOf(safeWallMode) + 1) % modes.length
                useViewer.getState().setWallMode(modes[nextIndex] ?? 'cutaway')
              }}
              size="icon"
              tooltipSide="top"
              variant="ghost"
            >
              <WallModeIcon className="h-[28px] w-[28px]" />
            </ActionButton>
          )}

          <div className="mx-1 h-5 w-px bg-border/40" />

          <DisplayMenu />

          <div className="mx-1 h-5 w-px bg-border/40" />

          {/* Walkthrough */}
          <ActionButton
            className={
              walkthroughActive
                ? 'bg-emerald-500/20 text-emerald-400'
                : 'hover:bg-white/5 hover:text-emerald-400'
            }
            label={`Walkthrough: ${walkthroughActive ? 'On' : 'Off'}`}
            onClick={onWalkthroughToggle}
            size="icon"
            tooltipSide="top"
            variant="ghost"
          >
            <Footprints className="h-6 w-6" />
          </ActionButton>

          <div className="mx-1 h-5 w-px bg-border/40" />

          {/* Camera actions */}
          <ActionButton
            className="group hidden hover:bg-white/5 sm:inline-flex"
            label={t('common.orbitLeft')}
            onClick={() => emitter.emit('camera-controls:orbit-ccw')}
            size="icon"
            tooltipSide="top"
            variant="ghost"
          >
            <img
              alt="Orbit left"
              className="h-[28px] w-[28px] -scale-x-100 object-contain opacity-70 transition-opacity group-hover:opacity-100"
              src={assetPath('/icons/rotate.webp')}
            />
          </ActionButton>

          <ActionButton
            className="group hidden hover:bg-white/5 sm:inline-flex"
            label={t('common.orbitRight')}
            onClick={() => emitter.emit('camera-controls:orbit-cw')}
            size="icon"
            tooltipSide="top"
            variant="ghost"
          >
            <img
              alt="Orbit right"
              className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
              src={assetPath('/icons/rotate.webp')}
            />
          </ActionButton>

          <ActionButton
            className="group hover:bg-white/5"
            label={t('common.topView')}
            onClick={() => emitter.emit('camera-controls:top-view')}
            size="icon"
            tooltipSide="top"
            variant="ghost"
          >
            <img
              alt="Top view"
              className="h-[28px] w-[28px] object-contain opacity-70 transition-opacity group-hover:opacity-100"
              src={assetPath('/icons/topview.webp')}
            />
          </ActionButton>
        </div>
      </TooltipProvider>
    </div>
  )
}

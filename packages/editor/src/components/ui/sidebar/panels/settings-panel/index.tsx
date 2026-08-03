import {
  clearSceneHistory,
  emitter,
  useScene,
  validateBuildJson,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { TreeView, VisualJson } from '@visual-json/react'
import { Camera, Download, Map as MapIcon, Save, Trash2, Upload } from 'lucide-react'
import {
  type KeyboardEvent,
  type ReactNode,
  type SyntheticEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { exportFloorplanPdf } from '../../../../../lib/floorplan/floorplan-export'
import { SegmentedControl } from '../../../controls/segmented-control'
import { Button } from './../../../../../components/ui/primitives/button'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from './../../../../../components/ui/primitives/dialog'
import { Switch } from './../../../../../components/ui/primitives/switch'
import { useT } from './../../../../../i18n/use-t'
import useEditor, { selectDefaultBuildingAndLevel } from './../../../../../store/use-editor'
import useFloorplanMode from './../../../../../store/use-floorplan-mode'
import { AudioSettingsDialog } from './audio-settings-dialog'
import { KeyboardShortcutsDialog } from './keyboard-shortcuts-dialog'
import { LoadBuildDialog, type PendingImport } from './load-build-dialog'

type SceneNode = Record<string, unknown> & {
  id?: unknown
  type?: unknown
  name?: unknown
  parentId?: unknown
  children?: unknown
}

type SceneGraphNode = {
  id: string
  type: string
  name: string | null
  parentId: string | null
  children: SceneGraphNode[]
  missing?: true
  cycle?: true
}

type SceneGraphValue = {
  roots: SceneGraphNode[]
  detachedNodes?: SceneGraphNode[]
}

const isSceneNode = (value: unknown): value is SceneNode => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof (value as { id: unknown }).id === 'string'
  )
}

const getChildIdsFromNode = (node: SceneNode): string[] => {
  if (!Array.isArray(node.children)) {
    return []
  }

  const childIds = new Set<string>()

  for (const child of node.children) {
    if (typeof child === 'string') {
      childIds.add(child)
      continue
    }

    if (isSceneNode(child)) {
      childIds.add(child.id as string)
    }
  }

  return Array.from(childIds)
}

const buildSceneGraphValue = (
  nodes: Record<string, SceneNode>,
  rootNodeIds: string[],
): SceneGraphValue => {
  const childIdsByParent = new Map<string, Set<string>>()

  for (const [id, node] of Object.entries(nodes)) {
    const childIds = getChildIdsFromNode(node)
    if (childIds.length > 0) {
      childIdsByParent.set(id, new Set(childIds))
    }
  }

  for (const [id, node] of Object.entries(nodes)) {
    if (typeof node.parentId !== 'string') {
      continue
    }

    const siblings = childIdsByParent.get(node.parentId) ?? new Set<string>()
    siblings.add(id)
    childIdsByParent.set(node.parentId, siblings)
  }

  const visited = new Set<string>()

  const buildNode = (id: string, path: Set<string>): SceneGraphNode => {
    const node = nodes[id]
    if (!node) {
      return {
        id,
        type: 'missing',
        name: null,
        parentId: null,
        missing: true,
        children: [],
      }
    }

    const nodeType = typeof node.type === 'string' ? node.type : 'unknown'
    const nodeName = typeof node.name === 'string' ? node.name : null
    const parentId = typeof node.parentId === 'string' ? node.parentId : null

    if (path.has(id)) {
      return {
        id,
        type: nodeType,
        name: nodeName,
        parentId,
        cycle: true,
        children: [],
      }
    }

    visited.add(id)
    const nextPath = new Set(path)
    nextPath.add(id)

    const childIds = Array.from(childIdsByParent.get(id) ?? [])
    return {
      id,
      type: nodeType,
      name: nodeName,
      parentId,
      children: childIds.map((childId) => buildNode(childId, nextPath)),
    }
  }

  const roots = rootNodeIds.map((id) => buildNode(id, new Set()))
  const detachedNodeIds = Object.keys(nodes).filter((id) => !visited.has(id))

  if (detachedNodeIds.length === 0) {
    return { roots }
  }

  return {
    roots,
    detachedNodes: detachedNodeIds.map((id) => buildNode(id, new Set())),
  }
}

export interface ProjectVisibility {
  isPrivate: boolean
  showScansPublic: boolean
  showGuidesPublic: boolean
}

export interface SettingsPanelProps {
  projectId?: string
  projectVisibility?: ProjectVisibility
  onVisibilityChange?: (
    field: 'isPrivate' | 'showScansPublic' | 'showGuidesPublic',
    value: boolean,
  ) => Promise<void>
  /** Host-owned section rendered first, above the built-in sections. */
  hostSection?: ReactNode
}

export function SettingsPanel({
  projectId,
  projectVisibility,
  onVisibilityChange,
  hostSection,
}: SettingsPanelProps = {}) {
  const t = useT()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const nodes = useScene((state) => state.nodes)
  const rootNodeIds = useScene((state) => state.rootNodeIds)
  const collections = useScene((state) => state.collections)
  const materials = useScene((state) => state.materials)
  const installedPlugins = useScene((state) => state.installedPlugins)
  const setScene = useScene((state) => state.setScene)
  const clearScene = useScene((state) => state.clearScene)
  const resetSelection = useViewer((state) => state.resetSelection)
  const exportScene = useViewer((state) => state.exportScene)
  const shadows = useViewer((state) => state.shadows)
  const unit = useViewer((state) => state.unit)
  const setUnit = useViewer((state) => state.setUnit)
  const metricNotation = useViewer((state) => state.metricNotation)
  const setMetricNotation = useViewer((state) => state.setMetricNotation)
  const setPhase = useEditor((state) => state.setPhase)
  const floorplanMode = useFloorplanMode((state) => state.mode)
  const [isGeneratingThumbnail, setIsGeneratingThumbnail] = useState(false)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const sceneGraphValue = useMemo(
    () => buildSceneGraphValue(nodes as Record<string, SceneNode>, rootNodeIds),
    [nodes, rootNodeIds],
  )
  const blockSceneGraphMutations = useCallback((event: SyntheticEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }, [])
  const blockSceneGraphDeletion = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      event.stopPropagation()
    }
  }, [])

  const isLocalProject = false // Props-based; only show cloud sections when projectId provided

  const handleSaveBuild = () => {
    const sceneData = { nodes, rootNodeIds, collections, materials, installedPlugins }
    const json = JSON.stringify(sceneData, null, 2)
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    const date = new Date().toISOString().split('T')[0]
    link.download = `layout_${date}.json`
    link.click()
    URL.revokeObjectURL(url)
  }

  const handleFileLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        setPendingImport({
          fileName: file.name,
          fileSizeBytes: file.size,
          result: {
            ok: false,
            parsed: null,
            stats: { total: 0, byType: {}, pluginTypes: {}, unknownTypes: {}, floorAreaM2: 0 },
            errors: [
              {
                severity: 'error',
                code: 'invalid_json',
                message: 'File could not be parsed as JSON.',
              },
            ],
            warnings: [],
            schemaIssues: [],
            schemaIssueCount: 0,
          },
        })
        return
      }
      setPendingImport({
        fileName: file.name,
        fileSizeBytes: file.size,
        result: validateBuildJson(parsed),
      })
    }
    reader.readAsText(file)

    // Reset input so the same file can be loaded again
    e.target.value = ''
  }

  const handleConfirmImport = (parsed: {
    nodes: Record<string, unknown>
    rootNodeIds: string[]
    collections?: Record<string, unknown>
    materials?: Record<string, unknown>
    installedPlugins?: string[]
  }) => {
    const currentScene = useScene.getState()
    setScene(
      parsed.nodes as Parameters<typeof setScene>[0],
      parsed.rootNodeIds as Parameters<typeof setScene>[1],
      {
        collections: parsed.collections as NonNullable<
          Parameters<typeof setScene>[2]
        >['collections'],
        materials: parsed.materials as NonNullable<
          Parameters<typeof setScene>[2]
        >['materials'],
        installedPlugins: parsed.installedPlugins ?? currentScene.installedPlugins,
        hasExplicitPluginInstallState:
          parsed.installedPlugins !== undefined || currentScene.hasExplicitPluginInstallState,
      },
    )
    // An import is a scene load: it becomes the undo floor. Without this,
    // undo could step back into the pre-import scene state.
    clearSceneHistory()
    resetSelection()
    setPhase('site')
    setPendingImport(null)
  }

  const handleResetToDefault = () => {
    clearScene()
    // Same floor rule as import — undo after a reset must not resurrect the
    // old scene (or land on the empty intermediate `unloadScene` state).
    clearSceneHistory()
    resetSelection()
    setPhase('structure')
    selectDefaultBuildingAndLevel()
  }

  const handleGenerateThumbnail = () => {
    if (!projectId) return
    setIsGeneratingThumbnail(true)
    emitter.emit('camera-controls:generate-thumbnail', { projectId })
    setTimeout(() => setIsGeneratingThumbnail(false), 3000)
  }

  const handleVisibilityChange = async (
    field: 'isPrivate' | 'showScansPublic' | 'showGuidesPublic',
    value: boolean,
  ) => {
    await onVisibilityChange?.(field, value)
  }

  return (
    <div className="flex flex-col gap-6 p-3">
      {hostSection}

      {/* Units Section */}
      <div className="space-y-3">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          {t('settings.units.label')}
        </label>
        <div className="space-y-1.5">
          <div className="font-medium text-muted-foreground text-xs">
            {t('settings.units.system')}
          </div>
          <SegmentedControl
            onChange={(next) => setUnit(next)}
            options={[
              { value: 'metric', label: t('settings.units.metric') },
              { value: 'imperial', label: t('settings.units.imperial') },
            ]}
            value={unit}
          />
        </div>
        {unit === 'metric' && (
          <div className="space-y-1.5">
            <div className="font-medium text-muted-foreground text-xs">
              {t('settings.units.metricNotation')}
            </div>
            <SegmentedControl
              onChange={(next) => setMetricNotation(next)}
              options={[
                { value: 'meters', label: t('settings.units.meters') },
                { value: 'millimeters', label: t('settings.units.millimeters') },
              ]}
              value={metricNotation}
            />
          </div>
        )}
      </div>

      {/* Visibility Section (only for cloud projects) */}
      {projectId && !isLocalProject && (
        <div className="space-y-3">
          <label className="font-medium text-muted-foreground text-xs uppercase">
            {t('settings.visibility.label')}
          </label>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">{t('settings.visibility.public')}</div>
              <div className="text-muted-foreground text-xs">
                {projectVisibility?.isPrivate
                  ? t('settings.visibility.viewOnlyYou')
                  : t('settings.visibility.viewAnyone')}
              </div>
            </div>
            <Switch
              checked={!(projectVisibility?.isPrivate ?? false)}
              onCheckedChange={(checked) => handleVisibilityChange('isPrivate', !checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">{t('settings.visibility.showScans')}</div>
              <div className="text-muted-foreground text-xs">
                {t('settings.visibility.visibleToPublic')}
              </div>
            </div>
            <Switch
              checked={projectVisibility?.showScansPublic ?? true}
              onCheckedChange={(checked) => handleVisibilityChange('showScansPublic', checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">{t('settings.visibility.showFloorplans')}</div>
              <div className="text-muted-foreground text-xs">
                {t('settings.visibility.visibleToPublic')}
              </div>
            </div>
            <Switch
              checked={projectVisibility?.showGuidesPublic ?? true}
              onCheckedChange={(checked) => handleVisibilityChange('showGuidesPublic', checked)}
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-sm">{t('settings.visibility.shadows')}</div>
              <div className="text-muted-foreground text-xs">
                {t('settings.visibility.shadowsDesc')}
              </div>
            </div>
            <Switch
              checked={shadows}
              onCheckedChange={(checked) => useViewer.getState().setShadows(checked)}
            />
          </div>
        </div>
      )}

      {/* Export Section */}
      <div className="space-y-4">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          {t('settings.export.label')}
        </label>

        <div className="space-y-2">
          <div className="font-medium text-muted-foreground text-xs">
            {t('settings.export.model3d')}
          </div>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => exportScene?.('glb')}
            variant="outline"
          >
            <Download className="size-4" />
            {t('settings.export.glb')}
          </Button>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => exportScene?.('stl')}
            variant="outline"
          >
            <Download className="size-4" />
            {t('settings.export.stl')}
          </Button>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => exportScene?.('obj')}
            variant="outline"
          >
            <Download className="size-4" />
            {t('settings.export.obj')}
          </Button>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between font-medium text-muted-foreground text-xs">
            <span>{t('settings.export.floorplan')}</span>
            <span>
              {floorplanMode === 'default'
                ? t('settings.export.defaultMode')
                : t('settings.export.expertMode')}
            </span>
          </div>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => exportFloorplanPdf('full')}
            variant="outline"
          >
            <MapIcon className="size-4" />
            {t('settings.export.fullFloorplan')}
          </Button>
          <Button
            className="w-full justify-start gap-2"
            onClick={() => exportFloorplanPdf('structure')}
            variant="outline"
          >
            <MapIcon className="size-4" />
            {t('settings.export.structureOnly')}
          </Button>
        </div>
      </div>

      {/* Thumbnail Section (only for cloud projects) */}
      {projectId && !isLocalProject && (
        <div className="space-y-2">
          <label className="font-medium text-muted-foreground text-xs uppercase">
            {t('settings.thumbnail.label')}
          </label>
          <Button
            className="w-full justify-start gap-2"
            disabled={isGeneratingThumbnail}
            onClick={handleGenerateThumbnail}
            variant="outline"
          >
            <Camera className="size-4" />
            {isGeneratingThumbnail
              ? t('settings.thumbnail.generating')
              : t('settings.thumbnail.generate')}
          </Button>
        </div>
      )}

      {/* Save/Load Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          {t('settings.saveLoad.label')}
        </label>

        <Button className="w-full justify-start gap-2" onClick={handleSaveBuild} variant="outline">
          <Save className="size-4" />
          {t('settings.saveLoad.save')}
        </Button>

        <Button
          className="w-full justify-start gap-2"
          onClick={() => fileInputRef.current?.click()}
          variant="outline"
        >
          <Upload className="size-4" />
          {t('settings.saveLoad.load')}
        </Button>

        <input
          accept="application/json"
          className="hidden"
          onChange={handleFileLoad}
          ref={fileInputRef}
          type="file"
        />

        <LoadBuildDialog
          onCancel={() => setPendingImport(null)}
          onConfirm={handleConfirmImport}
          pending={pendingImport}
        />
      </div>

      {/* Audio Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          {t('settings.audio.label')}
        </label>
        <AudioSettingsDialog />
      </div>

      {/* Keyboard Section */}
      <div className="space-y-2">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          {t('settings.keyboard.label')}
        </label>
        <KeyboardShortcutsDialog />
      </div>

      {/* Scene Graph */}
      <div className="space-y-1">
        <label className="font-medium text-muted-foreground text-xs uppercase">
          {t('settings.sceneGraph.label')}
        </label>
        <Dialog>
          <DialogTrigger asChild>
            <Button className="h-auto justify-start p-0 text-sm" variant="link">
              {t('settings.sceneGraph.explore')}
            </Button>
          </DialogTrigger>
          <DialogContent className="h-[80vh] max-w-[95vw] gap-0 overflow-hidden border-0 bg-[#1e1e1e] p-0 shadow-none sm:max-w-5xl">
            <DialogTitle className="sr-only">{t('settings.sceneGraph.label')}</DialogTitle>
            <div
              className="flex h-full min-h-0 w-full min-w-0 *:h-full *:w-full *:overflow-y-auto"
              onContextMenuCapture={blockSceneGraphMutations}
              onDragStartCapture={blockSceneGraphMutations}
              onDropCapture={blockSceneGraphMutations}
              onKeyDownCapture={blockSceneGraphDeletion}
            >
              <VisualJson value={sceneGraphValue}>
                <TreeView showCounts />
              </VisualJson>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Danger Zone */}
      <div className="space-y-2">
        <label className="font-medium text-destructive text-xs uppercase">
          {t('settings.dangerZone.label')}
        </label>

        <Button
          className="w-full justify-start gap-2"
          onClick={handleResetToDefault}
          variant="destructive"
        >
          <Trash2 className="size-4" />
          {t('settings.dangerZone.clearAndStartNew')}
        </Button>
      </div>
    </div>
  )
}

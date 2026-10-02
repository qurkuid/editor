import { afterEach, expect, test } from 'bun:test'
import { emitter, useScene, WallNode } from '@pascal-app/core'
import { useEditor, useFloorplanMode, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { toggleZoneView } from './viewer-toolbar'

const editorState = useEditor.getState()
const viewerState = useViewer.getState()
const floorplanState = useFloorplanMode.getState()
const interactionState = useInteractionScope.getState()

afterEach(() => {
  useEditor.setState(editorState)
  useViewer.setState(viewerState)
  useFloorplanMode.setState(floorplanState)
  useInteractionScope.setState(interactionState)
})

test('zone view cancels the active tool and toggles room inspection without changing the scene or view', () => {
  const nodes = useScene.getState().nodes
  let cancellations = 0
  const onCancel = () => cancellations++
  emitter.on('tool:cancel', onCancel)
  try {
    for (const viewMode of ['2d', '3d', 'split'] as const) {
      useEditor.setState({
        phase: 'structure',
        mode: 'build',
        tool: 'wall',
        structureLayer: 'elements',
        viewMode,
      })
      useFloorplanMode.setState({ mode: 'expert' })
      useEditor.getState().setMovingNode(WallNode.parse({ start: [0, 0], end: [2, 0] }))
      useViewer.setState({
        selection: { ...viewerState.selection, selectedIds: ['wall_test'], zoneId: null },
      })

      toggleZoneView()

      expect(useEditor.getState()).toMatchObject({
        phase: 'structure',
        mode: 'select',
        tool: null,
        structureLayer: 'zones',
        viewMode,
      })
      expect(useInteractionScope.getState().scope.kind).toBe('idle')
      expect(useViewer.getState().selection).toMatchObject({ selectedIds: [], zoneId: null })
      expect(useFloorplanMode.getState().mode).toBe('expert')
      expect(useScene.getState().nodes).toBe(nodes)

      useViewer.setState({ selection: { ...useViewer.getState().selection, zoneId: 'zone_test' } })
      toggleZoneView()

      expect(useEditor.getState()).toMatchObject({
        mode: 'select',
        structureLayer: 'elements',
        viewMode,
      })
      expect(useViewer.getState().selection.zoneId).toBeNull()
    }
    expect(cancellations).toBe(6)
  } finally {
    emitter.off('tool:cancel', onCancel)
  }
})

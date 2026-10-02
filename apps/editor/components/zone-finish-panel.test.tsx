import { afterEach, beforeEach, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  getCatalogMaterialById,
  useScene,
  WallNode,
  ZoneNode,
} from '@pascal-app/core'
import { useEditor } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { renderToStaticMarkup } from 'react-dom/server'
import useFinishTemplates from '@/lib/finish-template-store'
import { ZoneFinishInspectorFooter } from './zone-finish-panel'

const sceneInitialState = useScene.getInitialState()
const viewerInitialState = useViewer.getInitialState()
const editorInitialState = useEditor.getInitialState()
const templateInitialState = useFinishTemplates.getInitialState()

const originalScene = {
  collections: sceneInitialState.collections,
  materials: sceneInitialState.materials,
  nodes: sceneInitialState.nodes,
  rootNodeIds: sceneInitialState.rootNodeIds,
}
const originalSelection = viewerInitialState.selection
const originalSpaces = editorInitialState.spaces
const originalTemplates = {
  confirmedHomeTemplateIds: templateInitialState.confirmedHomeTemplateIds,
  confirmedZoneTemplateIds: templateInitialState.confirmedZoneTemplateIds,
  homeTemplates: templateInitialState.homeTemplates,
  localHomeTemplates: templateInitialState.localHomeTemplates,
  localZoneTemplates: templateInitialState.localZoneTemplates,
  templateMeta: templateInitialState.templateMeta,
  zoneTemplates: templateInitialState.zoneTemplates,
}

function setTestStores(
  nodes: Record<string, AnyNode>,
  selection: { selectedIds: AnyNodeId[]; zoneId: AnyNodeId | null },
) {
  const scene = {
    collections: {},
    materials: {},
    nodes,
    rootNodeIds: [],
  }
  const viewer = {
    selection: {
      buildingId: null,
      levelId: null,
      selectedIds: selection.selectedIds,
      zoneId: selection.zoneId,
    },
  }
  const editor = { spaces: {} }
  const templates = {
    confirmedHomeTemplateIds: {},
    confirmedZoneTemplateIds: {},
    homeTemplates: {},
    localHomeTemplates: {},
    localZoneTemplates: {},
    templateMeta: {},
    zoneTemplates: {},
  }

  useScene.setState(scene)
  Object.assign(useScene.getInitialState(), scene)
  useViewer.setState(viewer)
  Object.assign(useViewer.getInitialState(), viewer)
  useEditor.setState(editor)
  Object.assign(useEditor.getInitialState(), editor)
  useFinishTemplates.setState(templates)
  Object.assign(useFinishTemplates.getInitialState(), templates)
}

function restoreStores() {
  const scene = {
    collections: originalScene.collections,
    materials: originalScene.materials,
    nodes: originalScene.nodes,
    rootNodeIds: originalScene.rootNodeIds,
  }
  const viewer = { selection: originalSelection }
  const editor = { spaces: originalSpaces }
  const templates = originalTemplates

  useScene.setState(scene)
  Object.assign(sceneInitialState, scene)
  useViewer.setState(viewer)
  Object.assign(viewerInitialState, viewer)
  useEditor.setState(editor)
  Object.assign(editorInitialState, editor)
  useFinishTemplates.setState(templates)
  Object.assign(templateInitialState, templates)
}

function parsedRoomZone(id: string, name: string) {
  return ZoneNode.parse({
    id,
    name,
    parentId: 'level_footer',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    roomNumber: '101',
    spaceRole: 'room',
  })
}

function parsedGenericZone(id: string) {
  return ZoneNode.parse({
    id,
    name: 'Site area',
    parentId: 'level_footer',
    polygon: [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ],
    spaceRole: 'generic',
  })
}

function parsedWall(id: string) {
  return WallNode.parse({
    id,
    parentId: 'level_footer',
    start: [0, 0],
    end: [4, 0],
  })
}

function parsedFinishWall(
  id: string,
  start: [number, number],
  end: [number, number],
  directRef: string,
  finishRegions?: Array<{
    id: string
    side: 'interior' | 'exterior'
    start: number
    end: number
    slots: Record<string, string>
  }>,
) {
  return WallNode.parse({
    id,
    parentId: 'level_footer',
    start,
    end,
    frontSide: 'interior',
    backSide: 'exterior',
    slots: { interior: directRef },
    ...(finishRegions ? { finishRegions } : {}),
  })
}

function renderFooter() {
  return renderToStaticMarkup(<ZoneFinishInspectorFooter />)
}

function expectFinishRows(markup: string) {
  expect(markup).toContain('실제 마감 자재')
  expect(markup).toContain('전체 벽면')
  expect(markup).toContain('천장')
  expect(markup).toContain('바닥')
}

beforeEach(() => {
  setTestStores({}, { selectedIds: [], zoneId: null })
})

afterEach(() => {
  restoreStores()
})

test('renders the footer for a sole room Zone in selectedIds', () => {
  const room = parsedRoomZone('zone_footer_room', '현관')
  const staleRoom = parsedRoomZone('zone_footer_stale', '거실')
  setTestStores(
    { [room.id]: room, [staleRoom.id]: staleRoom },
    { selectedIds: [room.id], zoneId: staleRoom.id },
  )

  const markup = renderFooter()
  expectFinishRows(markup)
  expect(markup).toContain('현관 · 101')
  expect(markup).not.toContain('거실 · 101')
})

test('renders the footer through the empty selectedIds zoneId route', () => {
  const room = parsedRoomZone('zone_footer_room', '현관')
  setTestStores({ [room.id]: room }, { selectedIds: [], zoneId: room.id })

  expectFinishRows(renderFooter())
})

test('does not render for a generic Zone or non-Zone selected entry', () => {
  const genericZone = parsedGenericZone('zone_footer_generic')
  const wall = parsedWall('wall_footer_non_zone')
  const nodes = { [genericZone.id]: genericZone, [wall.id]: wall }

  setTestStores(nodes, { selectedIds: [genericZone.id], zoneId: null })
  expect(renderFooter()).toBe('')

  setTestStores(nodes, { selectedIds: [wall.id], zoneId: null })
  expect(renderFooter()).toBe('')
})

test('does not render for multi-selection, stale zoneId, or no selection', () => {
  const room = parsedRoomZone('zone_footer_room', '현관')
  const wall = parsedWall('wall_footer_multi')
  const nodes = { [room.id]: room, [wall.id]: wall }

  setTestStores(nodes, { selectedIds: [room.id, wall.id], zoneId: room.id })
  expect(renderFooter()).toBe('')

  setTestStores(nodes, { selectedIds: [], zoneId: 'zone_footer_missing' })
  expect(renderFooter()).toBe('')

  setTestStores(nodes, { selectedIds: [], zoneId: null })
  expect(renderFooter()).toBe('')
})

test('renders the regional wall material name and swatch in the SSR footer', () => {
  const room = parsedRoomZone('zone_footer_regional', '현관')
  const rustic = 'library:flooring-rusticbrick'
  const finewood = 'library:wood-finewood27'
  const walls = [
    parsedFinishWall('wall_footer_bottom', [0, 0], [4, 0], finewood, [
      {
        id: 'zone-finish:regional-footer',
        side: 'interior',
        start: 0,
        end: 1,
        slots: { interior: rustic },
      },
    ]),
    parsedFinishWall('wall_footer_right', [4, 0], [4, 4], rustic),
    parsedFinishWall('wall_footer_top', [4, 4], [0, 4], rustic),
    parsedFinishWall('wall_footer_left', [0, 4], [0, 0], rustic),
  ]
  setTestStores(Object.fromEntries([room, ...walls].map((node) => [node.id, node])), {
    selectedIds: [room.id],
    zoneId: null,
  })

  const markup = renderFooter()
  const catalog = getCatalogMaterialById('flooring-rusticbrick')
  expect(catalog?.label).toBe('Rustic Brick')
  expect(markup).toContain(catalog?.label ?? '')
  expect(markup).toContain(catalog?.previewThumbnailUrl ?? '')
})

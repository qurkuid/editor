import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import {
  type AnyNode,
  type AnyNodeId,
  BuildingNode,
  clearSceneHistory,
  emitter,
  LevelNode,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import useEditor from '../store/use-editor'
import useInteractionScope from '../store/use-interaction-scope'
import { markToolCancelConsumed, useKeyboard } from './use-keyboard'

class FakeElement extends EventTarget {
  readonly nodeType = 1
  readonly nodeName = 'DIV'
  readonly tagName = 'DIV'
  readonly namespaceURI = 'http://www.w3.org/1999/xhtml'
  readonly style: Record<string, string> = {}
  readonly ownerDocument: FakeDocument

  constructor(ownerDocument: FakeDocument) {
    super()
    this.ownerDocument = ownerDocument
  }

  appendChild(): void {}
  removeChild(): void {}
}

class FakeDocument extends EventTarget {
  readonly nodeType = 9
  readonly defaultView = globalThis
  readonly activeElement = null
  readonly documentElement: FakeElement
  readonly body: FakeElement

  constructor() {
    super()
    this.documentElement = new FakeElement(this)
    this.body = new FakeElement(this)
  }
}

class FakeKeyboardEvent extends Event {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly repeat: boolean
  readonly shiftKey: boolean

  constructor(type: string, init: KeyboardEventInit = {}) {
    super(type, { bubbles: true, cancelable: true })
    this.altKey = init.altKey ?? false
    this.ctrlKey = init.ctrlKey ?? false
    this.key = init.key ?? ''
    this.metaKey = init.metaKey ?? false
    this.repeat = init.repeat ?? false
    this.shiftKey = init.shiftKey ?? false
  }
}

const fakeDocument = new FakeDocument()
const fakeWindow = new EventTarget()
const BUILDING_ID = 'building_keyboard_history' as AnyNodeId
const LEVEL_ID = 'level_keyboard_history' as AnyNodeId
const WALL_ID = 'wall_keyboard_history' as AnyNodeId

let root: Root | null = null
let previousGlobals: Record<string, PropertyDescriptor | undefined> = {}

function Probe() {
  useKeyboard()
  return null
}

async function mount(): Promise<void> {
  const container = new FakeElement(fakeDocument)
  root = createRoot(container as never)
  await act(async () => root?.render(<Probe />))
}

async function press(key: string, init: KeyboardEventInit = {}): Promise<void> {
  await act(async () => {
    fakeWindow.dispatchEvent(new KeyboardEvent('keydown', { key, ...init }))
  })
}

function seedHistory(): void {
  const wall = WallNode.parse({
    id: WALL_ID,
    parentId: LEVEL_ID,
    start: [0, 0],
    end: [2, 0],
  })
  const level = LevelNode.parse({
    id: LEVEL_ID,
    parentId: BUILDING_ID,
    children: [WALL_ID],
    level: 0,
  })
  const building = BuildingNode.parse({
    id: BUILDING_ID,
    parentId: null,
    children: [LEVEL_ID],
  })

  useScene.setState({
    nodes: {
      [BUILDING_ID]: building,
      [LEVEL_ID]: level,
      [WALL_ID]: wall,
    },
    rootNodeIds: [BUILDING_ID],
    collections: {},
    dirtyNodes: new Set<AnyNodeId>(),
    materials: {},
    readOnly: false,
  } as never)
  clearSceneHistory()
  useViewer.setState({
    inputDragging: false,
    selection: {
      buildingId: BUILDING_ID,
      levelId: LEVEL_ID,
      selectedIds: [WALL_ID],
      zoneId: null,
    },
  } as never)
  useScene.getState().updateNode(WALL_ID, { end: [3, 0] } as Partial<AnyNode>)
}

function resetTransientState(): void {
  useInteractionScope.getState().end()
  useEditor.getState().setMode('select')
  useViewer.getState().setInputDragging(false)
  useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
  clearSceneHistory()
}

function wallEnd(): [number, number] {
  const wall = useScene.getState().nodes[WALL_ID]
  if (wall?.type !== 'wall') throw new Error('keyboard history test wall is missing')
  return wall.end
}

beforeAll(() => {
  for (const key of [
    'HTMLIFrameElement',
    'HTMLInputElement',
    'HTMLTextAreaElement',
    'document',
    'window',
    'KeyboardEvent',
    'IS_REACT_ACT_ENVIRONMENT',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ]) {
    previousGlobals[key] = Object.getOwnPropertyDescriptor(globalThis, key)
  }

  Object.defineProperty(globalThis, 'HTMLIFrameElement', {
    configurable: true,
    value: class HTMLIFrameElement {},
  })
  Object.defineProperty(globalThis, 'HTMLInputElement', {
    configurable: true,
    value: class HTMLInputElement {},
  })
  Object.defineProperty(globalThis, 'HTMLTextAreaElement', {
    configurable: true,
    value: class HTMLTextAreaElement {},
  })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow })
  Object.defineProperty(globalThis, 'KeyboardEvent', {
    configurable: true,
    value: FakeKeyboardEvent,
  })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      callback(0)
      return 0
    },
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: () => {},
  })
})

beforeEach(() => {
  resetTransientState()
  seedHistory()
})

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  resetTransientState()
})

afterAll(() => {
  for (const [key, descriptor] of Object.entries(previousGlobals)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else Reflect.deleteProperty(globalThis, key)
  }
})

describe('useKeyboard history cancellation', () => {
  test('undoes idle continuous Paint with one native Cmd+Z', async () => {
    await mount()
    useEditor.getState().setMode('material-paint')

    expect(useInteractionScope.getState().scope.kind).toBe('painting')
    expect(wallEnd()).toEqual([3, 0])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)

    await press('z', { metaKey: true })

    expect(wallEnd()).toEqual([2, 0])
    expect(useEditor.getState().mode).toBe('select')
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(useScene.temporal.getState().futureStates).toHaveLength(1)
  })

  test('keeps a consumed drafting cancel out of history', async () => {
    await mount()
    useInteractionScope.getState().begin({ kind: 'drafting', tool: 'wall' })
    const onCancel = () => {
      useInteractionScope.getState().end()
      markToolCancelConsumed()
    }
    emitter.on('tool:cancel', onCancel)

    try {
      await press('z', { metaKey: true })
    } finally {
      emitter.off('tool:cancel', onCancel)
    }

    expect(wallEnd()).toEqual([3, 0])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('keeps a pointer drag cancel out of history', async () => {
    await mount()
    useViewer.getState().setInputDragging(true)

    await press('z', { metaKey: true })

    expect(wallEnd()).toEqual([3, 0])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })

  test('keeps paused temporal history out of the shortcut path', async () => {
    await mount()
    useScene.temporal.getState().pause()

    await press('z', { metaKey: true })

    expect(wallEnd()).toEqual([3, 0])
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
  })
})

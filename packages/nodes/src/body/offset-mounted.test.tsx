import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  BodyNode,
  createRectangleBody,
  emitter,
  getBodySemanticHash,
  nodeRegistry,
  pushPullBodyFace,
  registerNode,
  sceneRegistry,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useDraftLengthHud, useEditor, useInteractionScope } from '@pascal-app/editor'
import { useViewer } from '@pascal-app/viewer'
import { act, createRoot, type ReconcilerRoot } from '@react-three/fiber'
import { type Line, type Object3D, PerspectiveCamera, type Scene, Vector3 } from 'three'
import { SelectionManager } from '../../../editor/src/components/editor/selection-manager'
import { bodyDefinition } from './definition'
import { buildBodyGeometry } from './geometry'
import { useBodyToolOptions } from './options'

const actualDrei = await import('@react-three/drei')
mock.module('@react-three/drei', () => ({ ...actualDrei, Html: () => null }))
const { default: BodySelectionAffordance } = await import('./selection')

class FakeCanvas extends EventTarget {
  readonly style = { cursor: '' }
}

class FakeKeyboardEvent extends Event {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly key: string
  readonly metaKey: boolean

  constructor(type: string, init: KeyboardEventInit = {}) {
    super(type, { bubbles: true, cancelable: true })
    this.altKey = init.altKey ?? false
    this.ctrlKey = init.ctrlKey ?? false
    this.key = init.key ?? ''
    this.metaKey = init.metaKey ?? false
  }
}

class FakePointerEvent extends Event {
  readonly altKey: boolean
  readonly clientX: number
  readonly clientY: number

  constructor(type: string, init: { altKey?: boolean; clientX: number; clientY: number }) {
    super(type, { bubbles: true, cancelable: true })
    this.altKey = init.altKey ?? false
    this.clientX = init.clientX
    this.clientY = init.clientY
  }
}

const fakeWindow = new EventTarget()
const callbacks = new Map<number, FrameRequestCallback>()
let nextFrameId = 1
let root: ReconcilerRoot<FakeCanvas> | null = null
let canvas = new FakeCanvas()
let camera: PerspectiveCamera
let scene: Scene
let renderScene: Object3D | null = null

function createRenderer(targetCanvas: FakeCanvas) {
  return {
    domElement: Object.assign(targetCanvas, {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
      style: targetCanvas.style,
    }),
    outputColorSpace: '',
    render: () => {},
    setAnimationLoop: () => {},
    setPixelRatio: () => {},
    setSize: () => {},
    shadowMap: { enabled: false, type: 0 },
    toneMapping: 0,
    xr: Object.assign(new EventTarget(), {
      enabled: false,
      isPresenting: false,
      setAnimationLoop: () => {},
    }),
  }
}

function bodyFixture(): BodyNode {
  const body = pushPullBodyFace(createRectangleBody({ width: 2, depth: 1 }), 'face:0', 1).body
  return BodyNode.parse({ ...body, id: 'body_offset_mounted' })
}

function sweepBodyFixture(): BodyNode {
  return BodyNode.parse({
    ...createRectangleBody({ width: 2, depth: 1 }),
    id: 'body_offset_mounted',
  })
}

async function flushFrames(): Promise<void> {
  const pending = [...callbacks.entries()]
  callbacks.clear()
  await act(async () => {
    for (const [id, callback] of pending) callback(id)
  })
}

async function press(key: string): Promise<void> {
  await act(async () => fakeWindow.dispatchEvent(new KeyboardEvent('keydown', { key })))
}

async function click(): Promise<void> {
  await act(async () => fakeWindow.dispatchEvent(new Event('click', { cancelable: true })))
}

async function movePointerToWorld(point: [number, number, number]): Promise<void> {
  const projected = new Vector3(...point).project(camera)
  await act(async () =>
    fakeWindow.dispatchEvent(
      new FakePointerEvent('pointermove', {
        clientX: (projected.x + 1) * 400,
        clientY: (1 - projected.y) * 300,
      }),
    ),
  )
}

async function armAndTarget(body: BodyNode): Promise<void> {
  await act(async () =>
    emitter.emit('body:selection-action', { bodyId: body.id, action: 'offset' }),
  )
  const faceObject = sceneRegistry.nodes.get(body.id)?.getObjectByName('face:face:0')
  if (!faceObject) throw new Error('Expected the real Body face mesh to be registered')
  await act(async () =>
    emitter.emit('body:click', {
      node: body,
      object: faceObject,
      position: [0.5, 0, 0.5],
      localPosition: [0.5, 0, 0.5],
      stopPropagation: () => {},
      nativeEvent: { object: faceObject } as never,
    }),
  )
  await flushFrames()
}

async function armSweepAndTarget(body: BodyNode): Promise<void> {
  await act(async () => emitter.emit('body:selection-action', { bodyId: body.id, action: 'sweep' }))
  await flushFrames()
  const faceObject = sceneRegistry.nodes.get(body.id)?.getObjectByName('face:face:0')
  if (!faceObject) throw new Error('Expected the real Body face mesh to be registered')
  await act(async () =>
    emitter.emit('body:click', {
      node: body,
      object: faceObject,
      position: [0.5, 0, 0.5],
      localPosition: [0.5, 0, 0.5],
      stopPropagation: () => {},
      nativeEvent: { object: faceObject } as never,
    }),
  )
  await flushFrames()
}

function offsetOutline(): Line | null {
  return renderScene?.getObjectByProperty<Line>('type', 'Line') ?? null
}

function offsetOutlinePositions(): number[] {
  const outline = offsetOutline()
  const attribute = outline?.geometry.getAttribute('position')
  return attribute ? Array.from(attribute.array) : []
}

function sweepPreviewHash(body: BodyNode): string | null {
  const override = useLiveNodeOverrides.getState().get(body.id)
  return override ? getBodySemanticHash(BodyNode.parse({ ...body, ...override })) : null
}

async function mountAffordance(productionComposition = false): Promise<void> {
  await act(async () =>
    root?.render(
      productionComposition ? (
        <>
          <SelectionManager />
          <BodySelectionAffordance />
        </>
      ) : (
        <BodySelectionAffordance />
      ),
    ),
  )
}

beforeAll(() => {
  if (!nodeRegistry.has('body')) registerNode(bodyDefinition as never)
  Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { body: { style: { cursor: '' } } },
  })
  Object.defineProperty(globalThis, 'KeyboardEvent', {
    configurable: true,
    value: FakeKeyboardEvent,
  })
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    configurable: true,
    value: true,
  })
  Object.defineProperties(fakeWindow, {
    cancelAnimationFrame: {
      value: (id: number) => callbacks.delete(id),
    },
    requestAnimationFrame: {
      value: (callback: FrameRequestCallback) => {
        const id = nextFrameId
        nextFrameId += 1
        callbacks.set(id, callback)
        return id
      },
    },
  })
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: (id: number) => callbacks.delete(id),
  })
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => {
      const id = nextFrameId
      nextFrameId += 1
      callbacks.set(id, callback)
      return id
    },
  })
})

beforeEach(async () => {
  callbacks.clear()
  const body = bodyFixture()
  useScene.setState({ nodes: { [body.id]: body }, rootNodeIds: [body.id] })
  useScene.temporal.getState().clear()
  useInteractionScope.getState().end()
  useBodyToolOptions.setState({ selectedFace: null, selectionAction: null })
  useDraftLengthHud.getState().clear()
  useViewer.setState({ inputDragging: false })
  useViewer.getState().setSelection({ selectedIds: [body.id] })
  useEditor.getState().setSnappingMode('polygon', 'off')
  useEditor.setState({ viewMode: '3d' })

  canvas = new FakeCanvas()
  root = createRoot(canvas)
  camera = new PerspectiveCamera(50, 800 / 600, 0.1, 100)
  await root.configure({
    camera,
    frameloop: 'never',
    gl: createRenderer(canvas) as never,
    size: { height: 600, left: 0, top: 0, width: 800 },
  })
  scene = root.render(null).getState().scene
  renderScene = scene
  const target = buildBodyGeometry(body)
  scene.add(target)
  sceneRegistry.nodes.set(body.id, target)
  camera.position.set(4, 2, 4)
  camera.lookAt(1, 0, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  scene.updateMatrixWorld(true)
})

afterEach(async () => {
  sceneRegistry.nodes.delete('body_offset_mounted')
  await act(async () => root?.unmount())
  root = null
  renderScene = null
})

afterAll(() => mock.restore())

describe('mounted Body Offset lifecycle', () => {
  test('ineligible open face click keeps Offset armed and does not start a session', async () => {
    const open = BodyNode.parse({
      ...createRectangleBody({ width: 2, depth: 1 }),
      id: 'body_offset_mounted',
    })
    await act(async () => useScene.setState({ nodes: { [open.id]: open } }))
    sceneRegistry.nodes.set(open.id, buildBodyGeometry(open))
    await mountAffordance()

    await armAndTarget(open)

    expect(useBodyToolOptions.getState().selectionAction).toEqual({
      bodyId: open.id,
      kind: 'offset',
      faceId: null,
      hitPoint: null,
    })
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(canvas.style.cursor).toBe('crosshair')
  })

  test('eligible face click auto-starts the Offset session', async () => {
    const body = bodyFixture()
    await mountAffordance()

    await armAndTarget(body)

    expect(useInteractionScope.getState().scope).toEqual({
      kind: 'handle-drag',
      nodeId: body.id,
      handle: 'body:offset',
    })
    expect(useViewer.getState().inputDragging).toBe(true)

    await press('Escape')
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(useViewer.getState().inputDragging).toBe(false)
  })

  test('one populated-input Escape cancels the actual Offset session and action', async () => {
    const body = bodyFixture()
    await mountAffordance()
    await armAndTarget(body)
    await press('-')
    await press('0')
    await press('.')
    await press('1')

    await press('Escape')

    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(useBodyToolOptions.getState().selectionAction).toBeNull()
    expect(useViewer.getState().inputDragging).toBe(false)
    expect(offsetOutline()).toBeNull()
  })

  test('valid typed Offset previews expose a changing visible boundary and clear on cancel', async () => {
    const body = bodyFixture()
    await mountAffordance()
    await armAndTarget(body)

    await press('-')
    await press('0')
    await press('.')
    await press('1')
    const firstPositions = offsetOutlinePositions()
    expect(offsetOutline()?.type).toBe('Line')
    expect(firstPositions.length).toBeGreaterThan(0)
    expect(firstPositions.slice(-3)).toEqual(firstPositions.slice(0, 3))

    await press('2')
    const secondPositions = offsetOutlinePositions()
    expect(secondPositions).not.toEqual(firstPositions)

    await press('Escape')
    expect(offsetOutline()).toBeNull()
  })

  test('pointer Offset previews expose a changing visible boundary and clear on cancel', async () => {
    const body = bodyFixture()
    await mountAffordance()
    await armAndTarget(body)

    await movePointerToWorld([0.5, 0, 0.25])
    const firstPositions = offsetOutlinePositions()
    expect(firstPositions.length).toBeGreaterThan(0)

    await movePointerToWorld([0.5, 0, 0.1])
    const secondPositions = offsetOutlinePositions()
    expect(secondPositions).not.toEqual(firstPositions)

    await press('Escape')
    expect(offsetOutline()).toBeNull()
  })

  test('commit publishes createdFaceId through the existing Body face selection owner', async () => {
    const body = bodyFixture()
    await mountAffordance()
    await armAndTarget(body)
    await press('-')
    await press('0')
    await press('.')
    await press('1')

    await press('Enter')

    expect(useBodyToolOptions.getState().selectedFace).toEqual({
      bodyId: body.id,
      faceId: 'face:0:offset:2',
    })
    expect(useScene.temporal.getState().pastStates).toHaveLength(1)
    expect(offsetOutline()).toBeNull()
  })

  test('Follow Path stays idle while armed and starts reshaping only after a valid face click', async () => {
    const body = sweepBodyFixture()
    await act(async () => useScene.setState({ nodes: { [body.id]: body } }))
    sceneRegistry.nodes.set(body.id, buildBodyGeometry(body))
    await mountAffordance()

    await act(async () =>
      emitter.emit('body:selection-action', { bodyId: body.id, action: 'sweep' }),
    )
    expect(useBodyToolOptions.getState().selectionAction).toEqual({
      bodyId: body.id,
      kind: 'sweep',
      faceId: null,
      hitPoint: null,
    })
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(useViewer.getState().inputDragging).toBe(false)

    await armSweepAndTarget(body)

    expect(useBodyToolOptions.getState().selectionAction).toMatchObject({
      bodyId: body.id,
      kind: 'sweep',
      faceId: 'face:0',
    })
    expect(useInteractionScope.getState().scope).toEqual({
      kind: 'reshaping',
      nodeId: body.id,
      reshape: 'sweep',
      driver: 'tool',
    })
    expect(useViewer.getState().inputDragging).toBe(true)
  })

  test('Follow Path click appends the exact typed candidate shown by the live preview', async () => {
    const body = sweepBodyFixture()
    await act(async () => useScene.setState({ nodes: { [body.id]: body } }))
    sceneRegistry.nodes.set(body.id, buildBodyGeometry(body))
    await mountAffordance()
    await armSweepAndTarget(body)
    await movePointerToWorld([0.5, 0.73, 0.5])
    await press('1')
    await press('0')
    await press('0')
    await press('0')
    const previewHash = sweepPreviewHash(body)
    expect(previewHash).not.toBeNull()

    await click()

    expect(sweepPreviewHash(body)).toBe(previewHash)
  })

  test('Follow Path click appends the exact grid-snapped candidate shown by the live preview', async () => {
    const body = sweepBodyFixture()
    await act(async () => useScene.setState({ nodes: { [body.id]: body } }))
    sceneRegistry.nodes.set(body.id, buildBodyGeometry(body))
    useEditor.getState().setSnappingMode('polygon', 'grid')
    useEditor.setState({ gridSnapStep: 0.5 })
    await mountAffordance()
    await armSweepAndTarget(body)
    await movePointerToWorld([0.5, 0.73, 0.5])
    const previewHash = sweepPreviewHash(body)
    expect(previewHash).not.toBeNull()

    await click()

    expect(sweepPreviewHash(body)).toBe(previewHash)
  })

  test('Follow Path Backspace does not remove a path station while the live raw buffer is populated', async () => {
    const body = sweepBodyFixture()
    await act(async () => useScene.setState({ nodes: { [body.id]: body } }))
    sceneRegistry.nodes.set(body.id, buildBodyGeometry(body))
    await mountAffordance()
    await armSweepAndTarget(body)
    await movePointerToWorld([0.5, 1, 0.5])
    await click()
    await movePointerToWorld([1.5, 1, 0.5])
    const previewHash = sweepPreviewHash(body)
    expect(previewHash).not.toBeNull()
    await act(async () => useDraftLengthHud.getState().setRaw('1000'))
    const typedPreviewHash = sweepPreviewHash(body)
    expect(typedPreviewHash).not.toBeNull()

    await press('Backspace')

    expect(sweepPreviewHash(body)).toBe(typedPreviewHash)
    expect(useDraftLengthHud.getState().raw).toBe('1000')
  })

  test('selected Body face click bypasses production structure-layer routing before Offset retargets', async () => {
    const body = bodyFixture()
    useEditor.setState({ mode: 'select', phase: 'structure', structureLayer: 'zones', tool: null })
    useViewer.getState().setSelection({ selectedIds: [body.id] })
    await mountAffordance(true)

    await armAndTarget(body)

    expect(useViewer.getState().selection.selectedIds).toEqual([body.id])
    expect(useBodyToolOptions.getState().selectionAction).toEqual({
      bodyId: body.id,
      kind: 'offset',
      faceId: 'face:0',
      hitPoint: [0.5, 0, 0.5],
    })
    expect(useInteractionScope.getState().scope).toEqual({
      kind: 'handle-drag',
      nodeId: body.id,
      handle: 'body:offset',
    })
  })
})

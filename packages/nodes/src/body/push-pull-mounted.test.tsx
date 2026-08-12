import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  BodyNode,
  createPlanarFaceBody,
  emitter,
  getBodyFaceFrame,
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
import { PerspectiveCamera, type Scene, Vector3 } from 'three'
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
  const source = createPlanarFaceBody([
    [0, -0.5, -0.5],
    [0, -0.5, 0.5],
    [0, 0.5, 0.5],
    [0, 0.5, -0.5],
  ])
  const { body } = pushPullBodyFace(source, 'face:0', 1)
  return BodyNode.parse({ ...body, id: 'body_push_pull_mounted' })
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

async function movePointer(clientX = 400, clientY = 300): Promise<void> {
  await act(async () =>
    fakeWindow.dispatchEvent(new FakePointerEvent('pointermove', { clientX, clientY })),
  )
}

async function movePointerToWorld(point: [number, number, number]): Promise<void> {
  const projected = new Vector3(...point).project(camera)
  await movePointer((projected.x + 1) * 400, (1 - projected.y) * 300)
}

async function armAndTarget(body: BodyNode): Promise<void> {
  await act(async () =>
    emitter.emit('body:selection-action', { bodyId: body.id, action: 'push-pull' }),
  )
  const faceObject = sceneRegistry.nodes.get(body.id)?.getObjectByName('face:face:0')
  if (!faceObject) throw new Error('Expected the real Body face mesh to be registered')
  await act(async () =>
    emitter.emit('body:click', {
      node: body,
      object: faceObject,
      position: [1, 0, 0],
      localPosition: [1, 0, 0],
      stopPropagation: () => {},
      nativeEvent: { object: faceObject } as never,
    }),
  )
  await flushFrames()
}

function setCameraX(positionX: number): void {
  camera.position.set(positionX, 0, 0)
  camera.lookAt(1, 0, 0)
  camera.updateProjectionMatrix()
  camera.updateMatrixWorld(true)
  scene.updateMatrixWorld(true)
}

function previewDistance(body: BodyNode): number | null {
  const override = useLiveNodeOverrides.getState().get(body.id)
  if (!override) return null
  const sourceFrame = getBodyFaceFrame(body, 'face:0')
  const previewFrame = getBodyFaceFrame(BodyNode.parse({ ...body, ...override }), 'face:0')
  return (
    (previewFrame.centroid[0] - sourceFrame.centroid[0]) * sourceFrame.normal[0] +
    (previewFrame.centroid[1] - sourceFrame.centroid[1]) * sourceFrame.normal[1] +
    (previewFrame.centroid[2] - sourceFrame.centroid[2]) * sourceFrame.normal[2]
  )
}

async function mountAffordance(): Promise<void> {
  await act(async () => root?.render(<BodySelectionAffordance />))
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
  useLiveNodeOverrides.getState().clearAll()
  useInteractionScope.getState().end()
  useBodyToolOptions.setState({ selectedFeature: null, selectionAction: null })
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
  const target = buildBodyGeometry(body)
  scene.add(target)
  sceneRegistry.nodes.set(body.id, target)
})

afterEach(async () => {
  useLiveNodeOverrides.getState().clearAll()
  sceneRegistry.nodes.delete('body_push_pull_mounted')
  await act(async () => root?.unmount())
  root = null
})

afterAll(() => mock.restore())

describe('mounted Body Push/Pull spatial lifecycle', () => {
  test('does not synthesize distance from the camera origin when view is parallel to the face normal', async () => {
    const body = bodyFixture()
    await mountAffordance()

    setCameraX(6)
    await armAndTarget(body)
    await movePointer()
    expect(previewDistance(body)).toBeNull()
    expect(useViewer.getState().inputDragging).toBe(true)
    await press('Escape')

    setCameraX(-4)
    await armAndTarget(body)
    await movePointer()
    expect(previewDistance(body)).toBeNull()
    await press('Escape')
  })

  test('applies a typed positive magnitude using the live spatial cursor sign', async () => {
    const body = bodyFixture()
    await mountAffordance()

    camera.position.set(4, 2, 4)
    camera.lookAt(1, 0, 0)
    camera.updateProjectionMatrix()
    camera.updateMatrixWorld(true)
    scene.updateMatrixWorld(true)
    await armAndTarget(body)
    await movePointerToWorld([0.75, 0, 0])
    expect(previewDistance(body)).toBeCloseTo(-0.25, 5)

    await press('4')
    await press('0')
    await press('0')
    expect(previewDistance(body)).toBeCloseTo(-0.4, 5)
    await press('Escape')
    expect(useLiveNodeOverrides.getState().get(body.id)).toBeUndefined()
  })
})

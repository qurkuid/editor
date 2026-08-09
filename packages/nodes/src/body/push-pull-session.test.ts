import { beforeEach, describe, expect, test } from 'bun:test'
import {
  type BodyNode,
  createRectangleBody,
  getBodyLoopVertices,
  useLiveNodeOverrides,
  useScene,
} from '@pascal-app/core'
import { useInteractionScope } from '@pascal-app/editor'
import { createBodyPushPullSession } from './push-pull-session'

if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    callback(0)
    return 0
  }
}

if (!globalThis.cancelAnimationFrame) {
  globalThis.cancelAnimationFrame = () => {}
}

const BODY_MATERIAL = 'library:wood-woodplank48'

function paintedBody(): BodyNode {
  const body = createRectangleBody({ width: 1.2, depth: 0.8 })
  return {
    ...body,
    faces: body.faces.map((face) => ({
      ...face,
      surface: {
        ...face.surface,
        materialRef: BODY_MATERIAL,
        uvOrigin: [0.1, 0, 0.2],
        uvU: [0.5, 0, 0],
        uvV: [0, 0, 0.5],
      },
    })),
  }
}

function storedBody(id: BodyNode['id']): BodyNode {
  const node = useScene.getState().nodes[id]
  if (node?.type !== 'body') {
    throw new TypeError(`Expected stored body ${id}`)
  }
  return node
}

function seedScene(body: BodyNode): void {
  useScene.setState({
    nodes: { [body.id]: body },
    rootNodeIds: [body.id],
    dirtyNodes: new Set(),
    collections: {},
    materials: {},
    installedPlugins: [],
  })
  useScene.temporal.getState().clear()
}

describe('Body Push/Pull session transaction', () => {
  beforeEach(() => {
    useLiveNodeOverrides.getState().clearAll()
    useInteractionScope.getState().end()
    useScene.setState({ nodes: {}, rootNodeIds: [], dirtyNodes: new Set() })
    useScene.temporal.getState().clear()
  })

  test('previews and cancels through live overrides without scene history', () => {
    // Given
    const body = paintedBody()
    seedScene(body)
    const session = createBodyPushPullSession({
      body,
      faceId: 'face:0',
      handle: 'body:push-pull',
    })
    const pastBefore = useScene.temporal.getState().pastStates.length

    // When
    const preview = session.preview(1.2)

    // Then
    expect(preview).toBe(true)
    expect(storedBody(body.id)).toEqual(body)
    expect(useScene.temporal.getState().pastStates).toHaveLength(pastBefore)
    expect(useScene.getState().dirtyNodes.has(body.id)).toBe(true)
    expect(useInteractionScope.getState().scope).toEqual({
      kind: 'handle-drag',
      nodeId: body.id,
      handle: 'body:push-pull',
    })

    const override = useLiveNodeOverrides.getState().get(body.id)
    expect(override?.faces).toBeDefined()
    const overrideBody = { ...body, ...override }
    expect(getBodyLoopVertices(overrideBody, 'loop:0').every((point) => point[1] === 1.2)).toBe(
      true,
    )

    // When
    useScene.getState().clearDirty(body.id)
    session.cancel()

    // Then
    expect(useLiveNodeOverrides.getState().get(body.id)).toBeUndefined()
    expect(useScene.getState().dirtyNodes.has(body.id)).toBe(true)
    expect(storedBody(body.id)).toEqual(body)
    expect(useScene.temporal.getState().pastStates).toHaveLength(pastBefore)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })

  test('commits one scene update and undo restores the original painted face', () => {
    // Given
    const body = paintedBody()
    seedScene(body)
    const session = createBodyPushPullSession({
      body,
      faceId: 'face:0',
      handle: 'body:push-pull',
    })
    const pastBefore = useScene.temporal.getState().pastStates.length

    // When
    expect(session.preview(1.2)).toBe(true)
    useScene.getState().clearDirty(body.id)
    const committed = session.commit()

    // Then
    expect(committed).toBe(true)
    expect(useLiveNodeOverrides.getState().get(body.id)).toBeUndefined()
    expect(useScene.getState().dirtyNodes.has(body.id)).toBe(true)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
    expect(useScene.temporal.getState().pastStates).toHaveLength(pastBefore + 1)

    const pushed = storedBody(body.id)
    expect(getBodyLoopVertices(pushed, 'loop:0').every((point) => point[1] === 1.2)).toBe(true)
    expect(pushed.faces.find((face) => face.id === 'face:0')?.surface).toEqual(
      body.faces[0]?.surface,
    )

    useScene.temporal.getState().undo()
    const restored = storedBody(body.id)
    expect(restored).toEqual(body)
    expect(restored.faces.find((face) => face.id === 'face:0')?.surface.materialRef).toBe(
      BODY_MATERIAL,
    )
  })

  test('zero-distance preview clears only the live override until commit no-ops', () => {
    // Given
    const body = paintedBody()
    seedScene(body)
    const session = createBodyPushPullSession({
      body,
      faceId: 'face:0',
      handle: 'body:push-pull',
    })
    const pastBefore = useScene.temporal.getState().pastStates.length
    expect(session.preview(1.2)).toBe(true)
    useScene.getState().clearDirty(body.id)

    // When
    const preview = session.preview(0)

    // Then
    expect(preview).toBe(false)
    expect(useLiveNodeOverrides.getState().get(body.id)).toBeUndefined()
    expect(useScene.getState().dirtyNodes.has(body.id)).toBe(true)
    expect(storedBody(body.id)).toEqual(body)
    expect(useInteractionScope.getState().scope.kind).toBe('handle-drag')

    // When
    useScene.getState().clearDirty(body.id)
    const committed = session.commit()

    // Then
    expect(committed).toBe(false)
    expect(useScene.getState().dirtyNodes.has(body.id)).toBe(true)
    expect(useScene.temporal.getState().pastStates).toHaveLength(pastBefore)
    expect(storedBody(body.id)).toEqual(body)
    expect(useInteractionScope.getState().scope.kind).toBe('idle')
  })
})

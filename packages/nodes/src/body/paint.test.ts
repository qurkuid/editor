import { beforeEach, describe, expect, test } from 'bun:test'
import { createRectangleBody, type SceneMaterialId, useScene } from '@pascal-app/core'
import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three'
import { bodyPaint } from './paint'

describe('bodyPaint', () => {
  beforeEach(() => {
    useScene.setState({ nodes: {}, materials: {} } as never)
  })

  test('resolves only persistent faces that belong to the hit body', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })

    expect(
      bodyPaint.resolveRole({
        node: body,
        hitObject: { userData: { bodyId: body.id, faceId: 'face:0' } },
        materialIndex: null,
      }),
    ).toBe('face:0')
    expect(
      bodyPaint.resolveRole({
        node: body,
        hitObject: { userData: { bodyId: body.id, faceId: 'missing' } },
        materialIndex: null,
      }),
    ).toBeNull()
  })

  test('patches one face material ref without changing topology or UV data', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })
    const patch = bodyPaint.buildPatch({
      node: body,
      role: 'face:0',
      material: undefined,
      materialPreset: 'library:wood-woodplank48',
    }) as { faces: typeof body.faces }

    expect(patch.faces[0]?.surface.materialRef).toBe('library:wood-woodplank48')
    expect(patch.faces[0]?.surface.uvOrigin).toEqual(body.faces[0]?.surface.uvOrigin)
    expect(body.faces[0]?.surface.materialRef).toBeUndefined()
    expect(patch.faces[0]?.outerLoopId).toBe(body.faces[0]?.outerLoopId)
  })

  test('exposes every persistent face for the whole-body paint scope', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })

    expect(bodyPaint.objectRoles?.(body)).toEqual(body.faces.map((face) => face.id))
  })

  test('commits one material to the whole body as one scene mutation', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })
    useScene.setState({ nodes: { [body.id]: body }, materials: {} } as never)

    bodyPaint.commitRoles?.({
      node: body,
      roles: body.faces.map((face) => face.id),
      material: { properties: { color: '#884422' } },
      materialPreset: undefined,
    })

    const state = useScene.getState()
    const storedBody = state.nodes[body.id] as typeof body
    const refs = new Set(storedBody.faces.map((face) => face.surface.materialRef))
    expect(refs.size).toBe(1)
    expect([...refs][0]).toStartWith('scene:')
    expect(Object.keys(state.materials)).toHaveLength(1)
  })

  test('commits a custom material as one reusable scene ref on the target face', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })
    useScene.setState({ nodes: { [body.id]: body }, materials: {} } as never)

    bodyPaint.commit?.({
      node: body,
      role: 'face:0',
      material: { properties: { color: '#336699' } },
      materialPreset: undefined,
    })

    const state = useScene.getState()
    const storedBody = state.nodes[body.id] as typeof body
    const refs = Object.keys(state.materials)
    expect(refs).toHaveLength(1)
    expect(storedBody.faces[0]?.surface.materialRef).toBe(`scene:${refs[0]}`)
    expect(state.materials[refs[0] as SceneMaterialId]?.material.properties?.color).toBe('#336699')
  })

  test('previews and restores only the hit face mesh', () => {
    const body = createRectangleBody({ width: 1.2, depth: 0.8 })
    const root = new Group()
    const targetMaterial = new MeshBasicMaterial({ color: '#111111' })
    const otherMaterial = new MeshBasicMaterial({ color: '#222222' })
    const target = new Mesh(new PlaneGeometry(), targetMaterial)
    const other = new Mesh(new PlaneGeometry(), otherMaterial)
    target.userData = { bodyId: body.id, faceId: 'face:0' }
    other.userData = { bodyId: body.id, faceId: 'other' }
    root.add(target, other)

    const restore = bodyPaint.applyPreview({
      node: body,
      role: 'face:0',
      material: { properties: { color: '#ff0000' } },
      materialPreset: undefined,
      root,
    })

    expect(restore).not.toBeNull()
    expect(target.material).not.toBe(targetMaterial)
    expect(other.material).toBe(otherMaterial)
    restore?.()
    expect(target.material).toBe(targetMaterial)
  })
})

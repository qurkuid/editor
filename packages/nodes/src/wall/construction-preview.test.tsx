import { afterAll, beforeAll, expect, test } from 'bun:test'
import {
  calculateLevelMiters,
  createWallBandConstructionPreset,
  emitter,
  WallNode,
} from '@pascal-app/core'
import { act, createRoot, extend } from '@react-three/fiber'
import * as THREE from 'three'
import { generateExtrudedWall } from '../../../viewer/src/systems/wall/wall-system'
import { WallConstructionModel } from './construction-preview'

extend(THREE)
const actEnvironment = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
beforeAll(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
})
afterAll(() => {
  if (actEnvironment) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', actEnvironment)
  else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
})

test('wall construction edits atomically replace complete meshes and export includes hidden finish layers', async () => {
  const canvas = Object.assign(new EventTarget(), { style: {} })
  const root = createRoot(canvas)
  await root.configure({
    frameloop: 'never',
    size: { width: 800, height: 600, top: 0, left: 0 },
    gl: {
      domElement: canvas,
      render() {},
      setPixelRatio() {},
      setSize() {},
      xr: Object.assign(new EventTarget(), { enabled: false, isPresenting: false }),
      shadowMap: { enabled: false },
    } as never,
  })
  const wall = WallNode.parse({
    start: [0, 0],
    end: [4, 0],
    height: 2.5,
    faceBands: {
      construction: { upper: createWallBandConstructionPreset('stud-gypsum-finish', 0.189) },
    },
  })
  const geometries: THREE.BufferGeometry[] = []
  const render = async (node: WallNode, mode: 'finish' | 'frame' = 'finish') => {
    const geometry = generateExtrudedWall(node, [], calculateLevelMiters([node]))
    geometries.push(geometry)
    let scene: THREE.Scene | undefined
    let advance: ((timestamp: number, runGlobalEffects?: boolean) => void) | undefined
    await act(async () => {
      const state = root
        .render(
          <mesh geometry={geometry}>
            <WallConstructionModel mode={mode} node={node} />
          </mesh>,
        )
        .getState()
      scene = state.scene
      advance = state.advance
    })
    advance?.(1, true)
    const meshes: THREE.Mesh[] = []
    scene?.traverse((object) => {
      if (object instanceof THREE.Mesh && object.userData.constructionKind) meshes.push(object)
    })
    return meshes
  }
  try {
    const before = await render(wall)
    expect(before.length).toBeGreaterThan(0)
    const after = await render({ ...wall, end: [5, 0], height: 3 })
    for (const mesh of after) {
      expect(before.includes(mesh)).toBe(false)
      expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0)
      expect(mesh.geometry.getAttribute('normal').count).toBeGreaterThan(0)
    }
    const layer = after.find((mesh) => mesh.userData.constructionKind === 'gypsum-board')
    expect(layer).toBeDefined()
    const size = new THREE.Box3().setFromObject(layer!).getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(5)
    expect(size.y).toBeCloseTo(3)
    for (const curveOffset of [0.5, 0.8, 0]) {
      const curved = await render({ ...wall, curveOffset })
      expect(curved.length).toBeGreaterThan(0)
      for (const mesh of curved) {
        expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0)
        expect(mesh.geometry.getAttribute('normal').count).toBeGreaterThan(0)
      }
    }
    const frame = await render(wall, 'frame')
    expect(frame.some((mesh) => !mesh.visible)).toBe(true)
    emitter.emit('thumbnail:before-capture', undefined)
    expect(frame.every((mesh) => mesh.visible)).toBe(true)
    emitter.emit('thumbnail:after-capture', undefined)
    expect(
      frame
        .filter((mesh) => mesh.visible)
        .every((mesh) => mesh.userData.constructionKind === 'timber-stud'),
    ).toBe(true)
  } finally {
    await act(async () => root.unmount())
    for (const geometry of geometries) geometry.dispose()
  }
})

import { afterAll, beforeAll, expect, test } from 'bun:test'
import {
  calculateLevelMiters,
  createWallBandConstructionPreset,
  emitter,
  WallNode,
} from '@pascal-app/core'
import { resolveMaterialRef, useViewer } from '@pascal-app/viewer'
import { act, createRoot, extend } from '@react-three/fiber'
import * as THREE from 'three'
import { generateExtrudedWall } from '../../../viewer/src/systems/wall/wall-system'
import { resolveWallPresentation, WallConstructionModel } from './construction-preview'

extend(THREE)
const actEnvironment = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
beforeAll(() => {
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true })
})
afterAll(() => {
  if (actEnvironment) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', actEnvironment)
  else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
})

test('keeps the base envelope and construction assembly mutually exclusive for every presentation row', () => {
  const rows = [
    { name: 'normal/unselected finish', mode: 'finish' as const },
    { name: 'selected finish', mode: 'finish' as const },
    { name: 'selected layers', mode: 'layers' as const },
    { name: 'selected frame', mode: 'frame' as const },
  ]
  for (const row of rows) {
    const presentation = resolveWallPresentation({
      hasConstruction: true,
      mode: row.mode,
      isExporting: false,
      capture: null,
    })
    expect(presentation, row.name).toMatchObject(
      row.mode === 'finish'
        ? { baseVisible: true, constructionVisible: false }
        : { baseVisible: false, constructionVisible: true, constructionMode: row.mode },
    )
  }

  expect(
    resolveWallPresentation({
      hasConstruction: true,
      mode: 'layers',
      isExporting: false,
      capture: 'thumbnail',
    }),
  ).toMatchObject({ baseVisible: true, constructionVisible: false })
  expect(
    resolveWallPresentation({
      hasConstruction: true,
      mode: 'finish',
      isExporting: true,
      capture: null,
    }),
  ).toMatchObject({
    baseVisible: false,
    constructionVisible: true,
    constructionMode: 'layers',
  })
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
    const group = scene?.getObjectByName('wall-construction-model')
    return { advance, group, meshes }
  }
  try {
    useViewer.getState().setExporting(false)
    const before = await render(wall)
    expect(before.meshes.length).toBeGreaterThan(0)
    const after = await render({ ...wall, end: [5, 0], height: 3 })
    for (const mesh of after.meshes) {
      expect(before.meshes.includes(mesh)).toBe(false)
      expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0)
      expect(mesh.geometry.getAttribute('normal').count).toBeGreaterThan(0)
    }
    const layer = after.meshes.find((mesh) => mesh.userData.constructionKind === 'gypsum-board')
    expect(layer).toBeDefined()
    const size = new THREE.Box3().setFromObject(layer!).getSize(new THREE.Vector3())
    expect(size.x).toBeCloseTo(5)
    expect(size.y).toBeCloseTo(3)
    for (const curveOffset of [0.5, 0.8, 0]) {
      const curved = await render({ ...wall, curveOffset })
      expect(curved.meshes.length).toBeGreaterThan(0)
      for (const mesh of curved.meshes) {
        expect(mesh.geometry.getAttribute('position').count).toBeGreaterThan(0)
        expect(mesh.geometry.getAttribute('normal').count).toBeGreaterThan(0)
      }
    }
    const frame = await render(wall, 'frame')
    expect(frame.meshes.some((mesh) => !mesh.visible)).toBe(true)
    emitter.emit('thumbnail:before-capture', undefined)
    expect(frame.group?.visible).toBe(false)
    useViewer.getState().setExporting(true)
    emitter.emit('thumbnail:before-capture', undefined)
    expect(frame.group?.visible).toBe(true)
    expect(frame.meshes.every((mesh) => mesh.visible)).toBe(true)
    emitter.emit('thumbnail:after-capture', undefined)
    useViewer.getState().setExporting(false)
    frame.advance?.(2, true)
    expect(
      frame.meshes
        .filter((mesh) => mesh.visible)
        .every((mesh) => mesh.userData.constructionKind === 'timber-stud'),
    ).toBe(true)

    const semanticWall = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      height: 2.5,
      thickness: 0.1,
      frontSide: 'interior',
      backSide: 'exterior',
      faceBands: {
        enabled: true,
        count: 1,
        construction: {
          upper: {
            mode: 'assembly',
            layers: [
              { kind: 'finish', thickness: 0.01 },
              { kind: 'concrete', thickness: 0.08 },
              { kind: 'finish', thickness: 0.01 },
            ],
          },
        },
      },
      slots: {
        interior: 'library:preset-charcoal',
        exterior: 'library:preset-softwhite',
      },
    })
    const semantic = await render(semanticWall)
    const finishes = semantic.meshes.filter((mesh) => mesh.userData.constructionKind === 'finish')
    expect(finishes).toHaveLength(2)
    const frontFinish = finishes.find((mesh) => mesh.userData.constructionLayer === 2)
    const backFinish = finishes.find((mesh) => mesh.userData.constructionLayer === 0)
    expect(frontFinish).toBeDefined()
    expect(backFinish).toBeDefined()
    const frontExpected = resolveMaterialRef('library:preset-charcoal', undefined, 'rendered')
    const backExpected = resolveMaterialRef('library:preset-softwhite', undefined, 'rendered')
    expect(frontExpected).toBeDefined()
    expect(backExpected).toBeDefined()
    expect((frontFinish!.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
      (frontExpected as THREE.MeshStandardMaterial).color.getHex(),
    )
    expect((backFinish!.material as THREE.MeshStandardMaterial).color.getHex()).toBe(
      (backExpected as THREE.MeshStandardMaterial).color.getHex(),
    )
    expect((frontFinish!.material as THREE.MeshStandardMaterial).color.getHex()).not.toBe(
      (backFinish!.material as THREE.MeshStandardMaterial).color.getHex(),
    )

    const unbandedWall = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      height: 2.5,
      thickness: 0.1,
      frontSide: 'interior',
      backSide: 'exterior',
      faceBands: {
        enabled: false,
        construction: semanticWall.faceBands?.construction,
      },
      slots: {
        interior: 'library:preset-charcoal',
        exterior: 'library:preset-softwhite',
      },
    })
    const unbanded = await render(unbandedWall)
    const unbandedFinishes = unbanded.meshes.filter(
      (mesh) => mesh.userData.constructionKind === 'finish',
    )
    expect(unbandedFinishes).toHaveLength(2)
    expect(
      (
        unbandedFinishes.find((mesh) => mesh.userData.constructionLayer === 2)!
          .material as THREE.MeshStandardMaterial
      ).color.getHex(),
    ).toBe((frontExpected as THREE.MeshStandardMaterial).color.getHex())
    expect(
      (
        unbandedFinishes.find((mesh) => mesh.userData.constructionLayer === 0)!
          .material as THREE.MeshStandardMaterial
      ).color.getHex(),
    ).toBe((backExpected as THREE.MeshStandardMaterial).color.getHex())

    const assembly = semanticWall.faceBands?.construction?.upper
    if (!assembly) throw new Error('semantic assembly fixture is missing')
    const bandedWall = WallNode.parse({
      start: [0, 0],
      end: [4, 0],
      height: 2.5,
      thickness: 0.1,
      frontSide: 'interior',
      backSide: 'exterior',
      faceBands: {
        enabled: true,
        count: 2,
        lowerHeight: 1.2,
        construction: {
          lower: assembly,
          upper: assembly,
        },
      },
      slots: {
        lowerInterior: 'library:preset-charcoal',
        lowerExterior: 'library:preset-softwhite',
        upperInterior: 'library:preset-charcoal',
        upperExterior: 'library:preset-softwhite',
      },
    })
    const banded = await render(bandedWall)
    const bandedUpperFinishes = banded.meshes.filter(
      (mesh) =>
        mesh.userData.constructionBand === 'upper' && mesh.userData.constructionKind === 'finish',
    )
    expect(bandedUpperFinishes).toHaveLength(2)
    expect(
      (
        bandedUpperFinishes.find((mesh) => mesh.userData.constructionLayer === 2)!
          .material as THREE.MeshStandardMaterial
      ).color.getHex(),
    ).toBe((frontExpected as THREE.MeshStandardMaterial).color.getHex())
    expect(
      (
        bandedUpperFinishes.find((mesh) => mesh.userData.constructionLayer === 0)!
          .material as THREE.MeshStandardMaterial
      ).color.getHex(),
    ).toBe((backExpected as THREE.MeshStandardMaterial).color.getHex())
  } finally {
    useViewer.getState().setExporting(false)
    await act(async () => root.unmount())
    for (const geometry of geometries) geometry.dispose()
  }
})

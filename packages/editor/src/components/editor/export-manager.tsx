'use client'

import { emitter, useScene } from '@pascal-app/core'
import { useViewer } from '@pascal-app/viewer'
import { useThree } from '@react-three/fiber'
import { useEffect } from 'react'
import * as THREE from 'three'
import { OBJExporter } from 'three/examples/jsm/exporters/OBJExporter.js'
import { strToU8, zipSync } from 'three/examples/jsm/libs/fflate.module.js'
import { exportSceneToDxf } from '../../lib/dxf-export'
import { exportFloorplanImages } from '../../lib/floorplan-image-export'
import { exportSceneToGlb, nextFrames, prepareSceneForExport } from '../../lib/glb-export'
import { exportSceneToStl } from '../../lib/stl-export'

// prepareSceneForExport neutralises container meshes (door/window hitbox roots,
// material-less renderables) with an attribute-less geometry — GLTFExporter
// emits those as plain transform nodes, but STL/OBJExporter read
// `position.count` unconditionally and crash. Swap in a geometry with an empty
// (count-0) position so they iterate zero vertices instead. Shared: the export
// scene is a throwaway clone, only its geometry *ref* is swapped.
const EMPTY_POSITION_GEOMETRY = new THREE.BufferGeometry()
EMPTY_POSITION_GEOMETRY.setAttribute(
  'position',
  new THREE.Float32BufferAttribute(new Float32Array(0), 3),
)

function ensurePositionAttributes(root: THREE.Object3D) {
  root.traverse((object) => {
    const renderable = object as THREE.Mesh & { isLine?: boolean; isPoints?: boolean }
    if (!(renderable.isMesh || renderable.isLine || renderable.isPoints)) return
    if (!renderable.geometry?.getAttribute('position')) {
      renderable.geometry = EMPTY_POSITION_GEOMETRY
    }
  })
}

export function ExportManager() {
  const scene = useThree((state) => state.scene)
  const setExportScene = useViewer((state) => state.setExportScene)

  useEffect(() => {
    const exportFn = async (format: 'glb' | 'stl' | 'obj' | 'dxf' = 'glb') => {
      // Find the scene renderer group by name
      const sceneGroup = scene.getObjectByName('scene-renderer')
      if (!sceneGroup) {
        console.error('scene-renderer group not found')
        return
      }

      const date = new Date().toISOString().split('T')[0]

      // Signal export so instanced kinds (trees/flowers/grass) swap their
      // invisible proxy for real, exportable geometry, then wait for the
      // commit before cloning the scene graph (same dance as BakeExporter —
      // without it every plant exports as its raycast collider, a white box).
      useViewer.getState().setExporting(true)
      try {
        await nextFrames()

        if (format === 'glb') {
          const buffer = await exportSceneToGlb(sceneGroup, useScene.getState().nodes, {
            includeGuides: true,
          })
          const blob = new Blob([buffer], { type: 'model/gltf-binary' })
          downloadBlob(blob, `model_${date}.glb`)
          return
        }

        // Hide editor affordances that live on the scene layer (selection handles,
        // ceiling/site brackets) and let wall-cutout reveal all walls — the same
        // synchronous capture path thumbnails use. We clone the scene inside the
        // window, so the export snapshots the clean building, then restore.
        emitter.emit('thumbnail:before-capture', undefined)
        let prepared: ReturnType<typeof prepareSceneForExport>
        try {
          prepared = prepareSceneForExport(sceneGroup, useScene.getState().nodes, {
            includeGuides: true,
          })
        } finally {
          emitter.emit('thumbnail:after-capture', undefined)
        }
        const { scene: exportScene } = prepared
        const { images, files } = await exportFloorplanImages(exportScene)
        const downloadWithImages = async (blob: Blob, extension: string) => {
          const name = `model_${date}.${extension}`
          if (!images.length) {
            downloadBlob(blob, name)
            return
          }
          files[name] = new Uint8Array(await blob.arrayBuffer())
          if (extension !== 'dxf')
            files['floorplan.dxf'] = strToU8(exportSceneToDxf(new THREE.Group(), images))
          files['README.txt'] = strToU8(
            '압축을 모두 푼 뒤 DXF를 SketchUp에서 가져오세요. PNG는 DXF와 같은 폴더에 두세요.\n단위: 밀리미터 / 동일 평면 병합: 켜기 / 평평하게 선 작업 가져오기: 끄기\nSTL/OBJ 사용 시 floorplan.dxf에 도면 이미지 위치와 크기가 포함됩니다.\n\nExtract all files together before importing the DXF. Keep the PNG beside it.\nUnits: millimeters. Merge Coplanar Faces: on. Import Linework Flattened: off.\nFor STL/OBJ, floorplan.dxf carries the positioned reference image.\n',
          )
          downloadBlob(
            new Blob([zipSync(files)], { type: 'application/zip' }),
            `model_${date}_${extension}.zip`,
          )
        }
        if (format === 'dxf') {
          const result = exportSceneToDxf(exportScene, images)
          await downloadWithImages(new Blob([result], { type: 'application/dxf' }), 'dxf')
          return
        }
        const guides: THREE.Object3D[] = []
        exportScene.traverse((object) => {
          if (object.userData.kind === 'guide') guides.push(object)
        })
        for (const guide of guides) guide.removeFromParent()
        ensurePositionAttributes(exportScene)

        if (format === 'stl') {
          const result = exportSceneToStl(exportScene)
          const blob = new Blob([result], { type: 'model/stl' })
          await downloadWithImages(blob, 'stl')
          return
        }

        if (format === 'obj') {
          const exporter = new OBJExporter()
          const result = exporter.parse(exportScene)
          const blob = new Blob([result], { type: 'model/obj' })
          await downloadWithImages(blob, 'obj')
          return
        }
      } finally {
        useViewer.getState().setExporting(false)
      }
    }

    setExportScene(exportFn)

    return () => {
      setExportScene(null)
    }
  }, [scene, setExportScene])

  return null
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

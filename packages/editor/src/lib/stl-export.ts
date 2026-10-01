import { Group, Mesh, type Object3D } from 'three'
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js'

export function exportSceneToStl(scene: Object3D): DataView<ArrayBuffer> {
  scene.updateWorldMatrix(true, true)
  const visibleScene = new Group()
  // STLExporter traverses hidden collision walls too; those have no opening cuts.
  scene.traverseVisible((object) => {
    if (!(object instanceof Mesh) || !object.geometry.getAttribute('position')?.count) return
    const mesh = object.clone(false)
    mesh.matrixAutoUpdate = false
    mesh.matrixWorld.copy(object.matrixWorld)
    visibleScene.add(mesh)
  })
  return new STLExporter().parse(visibleScene, { binary: true })
}

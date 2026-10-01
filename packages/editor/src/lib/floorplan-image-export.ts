import { Box3, Mesh, type MeshBasicMaterial, type Object3D, Vector3 } from 'three'
import type { DxfImage } from './dxf-export'

function planeBounds(mesh: Mesh) {
  const position = mesh.geometry.getAttribute('position')
  const bounds = new Box3()
  const point = new Vector3()
  for (let i = 0; i < position.count; i++)
    bounds.expandByPoint(point.fromBufferAttribute(position, i))
  return bounds
}

export function floorplanImagePlacement(mesh: Mesh, width: number, height: number) {
  const box = planeBounds(mesh)
  const world = (x: number, y: number) => {
    const p = new Vector3(x, y, box.min.z).applyMatrix4(mesh.matrixWorld)
    return new Vector3(p.x * 1000, -p.z * 1000, p.y * 1000)
  }
  const origin = world(box.min.x, box.min.y)
  return {
    origin,
    u: world(box.max.x, box.min.y).sub(origin).divideScalar(width),
    v: world(box.min.x, box.max.y).sub(origin).divideScalar(height),
  }
}

export async function exportFloorplanImages(scene: Object3D) {
  const images: DxfImage[] = []
  const files: Record<string, Uint8Array> = {}
  const guides: Object3D[] = []
  scene.updateMatrixWorld(true)
  scene.traverseVisible((object) => {
    if (object.userData.kind === 'guide') guides.push(object)
  })
  for (const guide of guides) {
    const meshes: Mesh[] = []
    guide.traverseVisible((object) => {
      if (object instanceof Mesh) meshes.push(object)
    })
    if (!meshes.length) throw new Error('Floorplan image is still loading; try exporting again.')
    for (const [index, mesh] of meshes.entries()) {
      const texture = (mesh.material as MeshBasicMaterial).map
      const image = texture?.image as HTMLImageElement | ImageBitmap | undefined
      if (!image?.width || !image.height) throw new Error('Floorplan image is not loaded.')
      const canvas = document.createElement('canvas')
      canvas.width = image.width
      canvas.height = image.height
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Could not export floorplan image.')
      const geometry = mesh.geometry
      const pos = geometry.getAttribute('position'),
        uv = geometry.getAttribute('uv')
      const box = planeBounds(mesh)
      const count = geometry.index?.count ?? pos.count
      for (let offset = 0; offset < count; offset += 3) {
        const points = [0, 1, 2].map((corner) => {
          const i = geometry.index?.getX(offset + corner) ?? offset + corner
          return {
            x: ((pos.getX(i) - box.min.x) / (box.max.x - box.min.x)) * canvas.width,
            y: ((box.max.y - pos.getY(i)) / (box.max.y - box.min.y)) * canvas.height,
            u: uv.getX(i) * image.width,
            v: (1 - uv.getY(i)) * image.height,
          }
        })
        const [a, b, c] = points as [
          (typeof points)[number],
          (typeof points)[number],
          (typeof points)[number],
        ]
        const det = (b.u - a.u) * (c.v - a.v) - (c.u - a.u) * (b.v - a.v)
        if (Math.abs(det) < 1e-10) continue
        const m11 = ((b.x - a.x) * (c.v - a.v) - (c.x - a.x) * (b.v - a.v)) / det
        const m12 = ((b.y - a.y) * (c.v - a.v) - (c.y - a.y) * (b.v - a.v)) / det
        const m21 = ((c.x - a.x) * (b.u - a.u) - (b.x - a.x) * (c.u - a.u)) / det
        const m22 = ((c.y - a.y) * (b.u - a.u) - (b.y - a.y) * (c.u - a.u)) / det
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.lineTo(c.x, c.y)
        ctx.closePath()
        ctx.clip()
        ctx.setTransform(
          m11,
          m12,
          m21,
          m22,
          a.x - m11 * a.u - m21 * a.v,
          a.y - m12 * a.u - m22 * a.v,
        )
        ctx.drawImage(image, 0, 0)
        ctx.restore()
      }
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (value) =>
            value ? resolve(value) : reject(new Error('Could not encode floorplan PNG.')),
          'image/png',
        ),
      )
      const name = `${String(guide.userData.pascalId).replace(/[^a-zA-Z0-9_-]/g, '_')}_${index}`
      const filename = `${name}.png`
      files[filename] = new Uint8Array(await blob.arrayBuffer())
      images.push({
        name,
        filename,
        width: canvas.width,
        height: canvas.height,
        ...floorplanImagePlacement(mesh, canvas.width, canvas.height),
      })
    }
  }
  return { images, files }
}

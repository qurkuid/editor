import { BoxGeometry, type BufferGeometry, CylinderGeometry, ExtrudeGeometry, Shape } from 'three'
import type { CountertopCutout } from '../countertop-cutouts'
import { cooktopFootprint } from './cooktop'

/**
 * Solid prism footprint (width along X, depth along Z, extruded along Y) for
 * a rounded-rect CSG cutter. Square corners (`cornerRadius` ~0) fall back to
 * a plain box — cheaper and avoids a degenerate zero-radius rounded shape.
 */
function roundedRectPrismGeometry(
  width: number,
  depth: number,
  height: number,
  cornerRadius: number,
): BufferGeometry {
  const r = Math.min(cornerRadius, width / 2, depth / 2)
  if (r <= 1e-4) return new BoxGeometry(width, height, depth)

  const shape = new Shape()
  const hw = width / 2
  const hd = depth / 2
  shape.moveTo(-hw + r, -hd)
  shape.lineTo(hw - r, -hd)
  shape.quadraticCurveTo(hw, -hd, hw, -hd + r)
  shape.lineTo(hw, hd - r)
  shape.quadraticCurveTo(hw, hd, hw - r, hd)
  shape.lineTo(-hw + r, hd)
  shape.quadraticCurveTo(-hw, hd, -hw, hd - r)
  shape.lineTo(-hw, -hd + r)
  shape.quadraticCurveTo(-hw, -hd, -hw + r, -hd)

  // Extrude in the shape's own Z, then rotate that extrusion axis onto Y so
  // the prism stands upright through the (horizontal) countertop slab.
  const geometry = new ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    curveSegments: 12,
    steps: 1,
  })
  geometry.translate(0, 0, -height / 2)
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/**
 * Cutter geometry for one freeform countertop opening, tall enough (4x slab
 * thickness) to guarantee a clean through-cut regardless of the slab's own Y
 * position — mirrors the margin `sink.ts` uses for the bowl cutters.
 */
export function countertopCutoutGeometry(
  cutout: CountertopCutout,
  slabThickness: number,
): BufferGeometry {
  const tall = Math.max(slabThickness, 0.01) * 4
  if (cutout.shape === 'circle') return new CylinderGeometry(cutout.radius, cutout.radius, tall, 48)
  return roundedRectPrismGeometry(cutout.size.width, cutout.size.depth, tall, cutout.cornerRadius)
}

/**
 * Cutter geometry matching a cooktop compartment's visible surface footprint
 * (see `cooktopFootprint`), so the countertop opening never drifts from what
 * `addCooktopCompartment` actually draws.
 */
export function cooktopCutterGeometry(
  node: { width: number; depth: number },
  slabThickness: number,
): BufferGeometry {
  const { surfaceWidth, surfaceDepth, cutoutCornerRadius } = cooktopFootprint(node)
  const tall = Math.max(slabThickness, 0.01) * 4
  return roundedRectPrismGeometry(surfaceWidth, surfaceDepth, tall, cutoutCornerRadius)
}

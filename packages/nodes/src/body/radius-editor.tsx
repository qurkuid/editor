'use client'

import {
  type BodyNode,
  getRoundedRectangularFrameOpeningPlacement,
  getRoundedRectangularFrameParameters,
  updateRoundedRectangularFrameOpening,
  updateRoundedRectangularFrameRadius,
} from '@pascal-app/core'
import { SliderControl } from '@pascal-app/editor'

function geometryPatch(updated: BodyNode): Partial<BodyNode> {
  return {
    revision: updated.revision,
    shells: updated.shells,
    vertices: updated.vertices,
    halfEdges: updated.halfEdges,
    loops: updated.loops,
    faces: updated.faces,
    curves: updated.curves,
    metadata: updated.metadata,
  }
}

export function RoundedFrameRadiusEditor({
  node,
  onUpdate,
}: {
  node: BodyNode
  onUpdate: (patch: Partial<BodyNode>) => void
}) {
  const parameters = getRoundedRectangularFrameParameters(node)
  const placement = getRoundedRectangularFrameOpeningPlacement(node)
  if (!parameters || !placement) return null

  const handleChange = (topCornerRadius: number) => {
    const updated = updateRoundedRectangularFrameRadius(node, topCornerRadius)
    onUpdate(geometryPatch(updated))
  }

  return (
    <SliderControl
      label="Top corner R"
      max={placement.maxTopCornerRadius}
      min={0}
      onChange={handleChange}
      precision={3}
      step={0.01}
      unit="m"
      value={parameters.topCornerRadius}
    />
  )
}

export function RoundedFrameOpeningEditor({
  node,
  onUpdate,
}: {
  node: BodyNode
  onUpdate: (patch: Partial<BodyNode>) => void
}) {
  const placement = getRoundedRectangularFrameOpeningPlacement(node)
  if (!placement) return null

  const updatePosition = (centerOffsetX: number, centerOffsetY: number) => {
    const updated = updateRoundedRectangularFrameOpening(node, {
      centerOffsetX,
      centerOffsetY,
    })
    onUpdate(geometryPatch(updated))
  }

  return (
    <>
      <SliderControl
        label="Opening X"
        max={placement.maxCenterOffsetX}
        min={placement.minCenterOffsetX}
        onChange={(value) => updatePosition(value, placement.centerOffsetY)}
        precision={3}
        step={0.01}
        unit="m"
        value={placement.centerOffsetX}
      />
      <SliderControl
        label="Opening Y"
        max={placement.maxCenterOffsetY}
        min={placement.minCenterOffsetY}
        onChange={(value) => updatePosition(placement.centerOffsetX, value)}
        precision={3}
        step={0.01}
        unit="m"
        value={placement.centerOffsetY}
      />
    </>
  )
}

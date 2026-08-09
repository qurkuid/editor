import { createPlanarFaceBody } from '@pascal-app/core'
import { EDITOR_LAYER } from '@pascal-app/editor'
import { type RefObject, useEffect, useMemo } from 'react'
import { BufferGeometry, Float32BufferAttribute, type Group, Mesh } from 'three'
import type { FaceProjection } from './face-imprint-geometry'
import { buildBodyGeometry } from './geometry'
import type { resolveBodyDraftFeedback } from './primitive-draft'
import type { BodyDraftPoint } from './rectangle-draft'

type BodyFaceImprintPreviewProps = {
  readonly outerRef: RefObject<Group | null>
  readonly projection: FaceProjection
  readonly draftPolygon: readonly BodyDraftPoint[] | null
  readonly feedback: ReturnType<typeof resolveBodyDraftFeedback>
}

export function BodyFaceImprintPreview({
  outerRef,
  projection,
  draftPolygon,
  feedback,
}: BodyFaceImprintPreviewProps) {
  const preview = useMemo(() => {
    if (!draftPolygon) return null
    const group = buildBodyGeometry(createPlanarFaceBody(draftPolygon.map(projection.fromPlane)))
    group.traverse((object) => {
      object.layers.set(EDITOR_LAYER)
      if (!(object instanceof Mesh)) return
      const material = object.material.clone()
      material.transparent = true
      material.opacity = 0.35
      material.depthWrite = false
      object.material = material
    })
    return group
  }, [draftPolygon, projection])
  const pathGeometry = useMemo(() => {
    const geometry = new BufferGeometry()
    if (feedback.path.length < 2) return geometry
    const vertices = feedback.path.slice(1).flatMap((point, index) => {
      const previous = feedback.path[index]
      return previous ? [...projection.fromPlane(previous), ...projection.fromPlane(point)] : []
    })
    geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3))
    return geometry
  }, [feedback.path, projection])

  useEffect(() => () => pathGeometry.dispose(), [pathGeometry])
  useEffect(
    () => () => {
      preview?.traverse((object) => {
        if (!(object instanceof Mesh)) return
        object.geometry.dispose()
        const materials = Array.isArray(object.material) ? object.material : [object.material]
        for (const material of materials) material.dispose()
      })
    },
    [preview],
  )

  return (
    <group ref={outerRef}>
      {preview ? <primitive object={preview} /> : null}
      {feedback.path.length > 1 ? (
        <lineSegments geometry={pathGeometry} layers={EDITOR_LAYER} renderOrder={3}>
          <lineBasicMaterial color="#0284c7" depthTest={false} depthWrite={false} />
        </lineSegments>
      ) : null}
      {feedback.committed.map((point, index) => (
        <mesh
          key={`${point[0]}:${point[1]}:${index}`}
          layers={EDITOR_LAYER}
          position={projection.fromPlane(point)}
          renderOrder={4}
        >
          <sphereGeometry args={[index === 0 ? 0.09 : 0.065, 20, 14]} />
          <meshBasicMaterial
            color={index === 0 ? '#22c55e' : '#0284c7'}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

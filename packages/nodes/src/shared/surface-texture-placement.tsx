'use client'

import {
  type AnyNode,
  getCatalogMaterialById,
  parseMaterialRef,
  type SceneMaterialId,
  useScene,
} from '@pascal-app/core'
import { freezeHostMaterialCatalogItem, PanelSection } from '@pascal-app/editor'
import {
  commitSurfaceTextureTransform,
  readSurfaceTextureTransform,
  type SurfaceTextureTransform,
} from './surface-texture-transform'

type SlotsNode = AnyNode & { slots?: Record<string, string> }

/**
 * SketchUp-style placement controls (start point, tile size, rotation) for the
 * textured material on one paintable slot. Renders nothing when the slot has
 * no texture to position. Used inline by the wall panel's surface block and as
 * a standalone section by ceiling / slab panels.
 */
export function SurfaceTexturePlacementControls({
  node,
  slotId,
  ariaPrefix,
}: {
  node: AnyNode
  slotId: string
  ariaPrefix: string
}) {
  const sceneMaterials = useScene((s) => s.materials)
  const ref = (node as SlotsNode).slots?.[slotId]
  const parsed = parseMaterialRef(ref)
  const baseMaterial =
    parsed?.kind === 'scene'
      ? (() => {
          const material = sceneMaterials[parsed.id as SceneMaterialId]?.material
          return material?.texture?.url ? material : undefined
        })()
      : parsed?.kind === 'library'
        ? (() => {
            const item = getCatalogMaterialById(parsed.id)
            return item?.sourceRef && item.preset.maps.albedoMap
              ? freezeHostMaterialCatalogItem(item)
              : undefined
          })()
        : undefined
  const transform = baseMaterial ? readSurfaceTextureTransform(baseMaterial) : null
  if (!transform) return null

  const commit = (next: SurfaceTextureTransform) => {
    commitSurfaceTextureTransform({
      node,
      slotId,
      transform: next,
      freezeLibraryMaterial: (catalogId) => {
        const item = getCatalogMaterialById(catalogId)
        return item?.sourceRef ? freezeHostMaterialCatalogItem(item) : null
      },
    })
  }

  return (
    <div className="space-y-1.5 rounded border border-border/60 bg-background/70 p-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
          재질 배치
        </span>
        <button
          className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          onClick={() => commit({ ...transform, offsetXM: 0, offsetYM: 0, rotationDeg: 0 })}
          type="button"
        >
          초기화
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <label className="text-[10px] text-muted-foreground">
          시작점 X mm
          <input
            aria-label={`${ariaPrefix} surface offset x mm`}
            className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground"
            onChange={(event) =>
              commit({ ...transform, offsetXM: Number(event.target.value) / 1000 })
            }
            step={10}
            type="number"
            value={Math.round(transform.offsetXM * 1000)}
          />
        </label>
        <label className="text-[10px] text-muted-foreground">
          시작점 Y mm
          <input
            aria-label={`${ariaPrefix} surface offset y mm`}
            className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground"
            onChange={(event) =>
              commit({ ...transform, offsetYM: Number(event.target.value) / 1000 })
            }
            step={10}
            type="number"
            value={Math.round(transform.offsetYM * 1000)}
          />
        </label>
        <label className="text-[10px] text-muted-foreground">
          타일 폭 mm
          <input
            aria-label={`${ariaPrefix} surface tile width mm`}
            className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground"
            min={10}
            onChange={(event) =>
              commit({
                ...transform,
                tileWidthM: Math.max(0.01, Number(event.target.value) / 1000),
              })
            }
            step={10}
            type="number"
            value={Math.round(transform.tileWidthM * 1000)}
          />
        </label>
        <label className="text-[10px] text-muted-foreground">
          타일 높이 mm
          <input
            aria-label={`${ariaPrefix} surface tile height mm`}
            className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground"
            min={10}
            onChange={(event) =>
              commit({
                ...transform,
                tileHeightM: Math.max(0.01, Number(event.target.value) / 1000),
              })
            }
            step={10}
            type="number"
            value={Math.round(transform.tileHeightM * 1000)}
          />
        </label>
        <label className="text-[10px] text-muted-foreground">
          회전 °
          <input
            aria-label={`${ariaPrefix} surface rotation deg`}
            className="mt-0.5 w-full rounded border border-border bg-background px-1.5 py-1 text-xs text-foreground"
            onChange={(event) => commit({ ...transform, rotationDeg: Number(event.target.value) })}
            step={15}
            type="number"
            value={Math.round(transform.rotationDeg)}
          />
        </label>
      </div>
    </div>
  )
}

/**
 * Panel-section wrapper for kinds whose panel has no material block of its
 * own (ceiling, slab). Self-gates: no textured slot material → no section.
 */
export function SurfaceTexturePlacementSection({
  node,
  slotId,
  ariaPrefix,
  title,
}: {
  node: AnyNode
  slotId: string
  ariaPrefix: string
  title: string
}) {
  const hasTexture = useScene((s) => {
    const ref = (node as SlotsNode).slots?.[slotId]
    const parsed = parseMaterialRef(ref)
    if (parsed?.kind === 'scene') {
      return Boolean(s.materials[parsed.id as SceneMaterialId]?.material.texture?.url)
    }
    if (parsed?.kind === 'library') {
      const item = getCatalogMaterialById(parsed.id)
      return Boolean(item?.sourceRef && item.preset.maps.albedoMap)
    }
    return false
  })
  if (!hasTexture) return null
  return (
    <PanelSection title={title}>
      <SurfaceTexturePlacementControls ariaPrefix={ariaPrefix} node={node} slotId={slotId} />
    </PanelSection>
  )
}

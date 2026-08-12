'use client'

import {
  type AssetInput,
  type AnyNodeId,
  type BodyNode,
  generateId,
  ItemNode,
  LightingFixtureNode,
  runAsSingleSceneHistoryStep,
  useScene,
  WallNode,
} from '@pascal-app/core'
import { resolveCdnUrl, useViewer } from '@pascal-app/viewer'
import { useEffect } from 'react'
import { triggerSFX } from './../../../lib/sfx-bus'
import { cn } from './../../../lib/utils'
import useEditor, { type CatalogCategory } from './../../../store/use-editor'
import { resolveAssetSnapTarget, SnapTargetBadge } from '../snap-target-badge'
import { CATALOG_ITEMS, type CatalogItem } from './catalog-items'

function bodyBounds(body: BodyNode) {
  const xs = body.vertices.map((vertex) => vertex.position[0])
  const ys = body.vertices.map((vertex) => vertex.position[1])
  const zs = body.vertices.map((vertex) => vertex.position[2])
  const min = [Math.min(...xs), Math.min(...ys), Math.min(...zs)] as const
  const max = [Math.max(...xs), Math.max(...ys), Math.max(...zs)] as const
  return { min, max }
}

function replacementMetadata(body: BodyNode) {
  const metadata =
    typeof body.metadata === 'object' && body.metadata !== null && !Array.isArray(body.metadata)
      ? body.metadata
      : {}
  return { ...metadata, replacedSketchUpBodyId: body.id }
}

export function catalogReplacementNode(body: BodyNode, asset: AssetInput) {
  const { min, max } = bodyBounds(body)
  const dimensions = asset.dimensions ?? [1, 1, 1]
  return ItemNode.parse({
    id: generateId('item'),
    name: asset.name,
    parentId: body.parentId,
    position: [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2],
    scale: dimensions.map((dimension, index) =>
      dimension > 0 ? (max[index]! - min[index]!) / dimension : 1,
    ),
    asset,
    metadata: replacementMetadata(body),
  })
}

export function wallReplacementNode(body: BodyNode) {
  const { min, max } = bodyBounds(body)
  const centerX = (min[0] + max[0]) / 2
  const centerZ = (min[2] + max[2]) / 2
  const alongX = max[0] - min[0] >= max[2] - min[2]
  return WallNode.parse({
    id: generateId('wall'),
    name: body.name,
    parentId: body.parentId,
    start: alongX ? [min[0], centerZ] : [centerX, min[2]],
    end: alongX ? [max[0], centerZ] : [centerX, max[2]],
    thickness: alongX ? max[2] - min[2] : max[0] - min[0],
    height: max[1] - min[1],
    supportOffset: min[1],
    metadata: replacementMetadata(body),
  })
}

export function lightingReplacementNode(body: BodyNode, asset?: AssetInput) {
  const { min, max } = bodyBounds(body)
  return LightingFixtureNode.parse({
    id: generateId('lighting-fixture'),
    name: body.name,
    parentId: body.parentId,
    position: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
    lightType: 'point',
    asset,
    metadata: replacementMetadata(body),
  })
}

export function ItemCatalog({
  category,
  items: itemsOverride,
  activePlacementTag = null,
  activeFunctionalTag = null,
  search = '',
  overrideItems,
  leadingTile,
  emptyState,
}: {
  category: CatalogCategory
  items?: AssetInput[]
  activePlacementTag?: string | null
  activeFunctionalTag?: string | null
  search?: string
  /** When set, bypasses all filtering and displays these items directly (used for server search results) */
  overrideItems?: AssetInput[]
  /** Rendered as the first grid cell, always visible when there are items. */
  leadingTile?: React.ReactNode
  /** Rendered when there are no items to show. Replaces the empty grid. */
  emptyState?: React.ReactNode
}) {
  const selectedItem = useEditor((state) => state.selectedItem)
  const setSelectedItem = useEditor((state) => state.setSelectedItem)
  const setMode = useEditor((state) => state.setMode)
  const setTool = useEditor((state) => state.setTool)
  const replacementTargetId = useEditor((state) => state.replacementTargetId)
  const setReplacementTargetId = useEditor((state) => state.setReplacementTargetId)

  const sourceItems: CatalogItem[] = itemsOverride ?? CATALOG_ITEMS
  // Server-provided results bypass all local filtering; otherwise filter by category/search/tags
  const filteredItems: CatalogItem[] =
    overrideItems ??
    (() => {
      const categoryItems = search
        ? sourceItems
        : sourceItems.filter((item) => item.category === category)
      return categoryItems.filter((item) => {
        const tags = item.tags ?? []
        if (activePlacementTag && !tags.includes(activePlacementTag)) return false
        if (activeFunctionalTag && !tags.includes(activeFunctionalTag)) return false
        if (search && !item.name.toLowerCase().includes(search.toLowerCase())) return false
        return true
      })
    })()

  if (filteredItems.length === 0 && emptyState) {
    return <>{emptyState}</>
  }

  return (
    <div
      className="grid gap-2"
      style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}
    >
      {leadingTile}
      {filteredItems.map((item, index) => {
        const isSelected = selectedItem?.src === item?.src
        const snapTarget = resolveAssetSnapTarget(item?.attachTo)
        return (
          <button
            className={cn(
              'group relative flex flex-col gap-1.5 rounded-xl p-1.5 transition-colors hover:cursor-pointer hover:bg-sidebar-accent',
              isSelected && 'bg-sidebar-accent ring-2 ring-primary-foreground',
            )}
            key={index}
            onClick={() => {
              triggerSFX('sfx:menu-click')
              const replacementTarget = replacementTargetId
                ? useScene.getState().nodes[replacementTargetId]
                : null
              if (replacementTarget?.type === 'body') {
                const replacement = catalogReplacementNode(replacementTarget, item)
                runAsSingleSceneHistoryStep(useScene, () => {
                  useScene
                    .getState()
                    .createNode(replacement, (replacement.parentId as AnyNodeId | null) ?? undefined)
                  useScene.getState().deleteNode(replacementTarget.id)
                })
                setReplacementTargetId(null)
                setMode('select')
                useViewer.getState().setSelection({ selectedIds: [replacement.id], zoneId: null })
                return
              }
              // Drop the current selection before arming placement — keeping
              // it would route shortcuts (rotate & co) to both the ghost and
              // the selected node.
              useViewer.getState().setSelection({ selectedIds: [], zoneId: null })
              setSelectedItem(item)
              setTool(item.tool ?? 'item')
              setMode('build')
            }}
            onMouseEnter={() => triggerSFX('sfx:menu-hover')}
            type="button"
          >
            <div className="relative aspect-square w-full overflow-hidden rounded-lg">
              <img
                alt={item.name}
                className="h-full w-full object-cover"
                loading="eager"
                src={resolveCdnUrl(item.thumbnail) || ''}
              />
              {snapTarget && (
                <SnapTargetBadge className="absolute right-1 bottom-1" target={snapTarget} />
              )}
            </div>
            <span className="truncate px-0.5 text-left font-medium text-[11px] text-muted-foreground group-hover:text-foreground">
              {item.name}
            </span>
          </button>
        )
      })}
    </div>
  )
}

import {
  type AnyNodeId,
  CabinetNode,
  createDefaultFurnitureAssembly,
  type FurnitureKind,
} from '@pascal-app/core'
import useLocale from '../../../i18n/locale-store'
import { type MessageId, translate } from '../../../i18n/translate'

export const FURNITURE_KIND_LABEL_KEYS: Record<FurnitureKind, MessageId> = {
  wardrobe: 'furniture.kind.wardrobe',
  'base-run': 'furniture.kind.baseRun',
  'upper-run': 'furniture.kind.upperRun',
  tall: 'furniture.kind.tall',
  island: 'furniture.kind.island',
  set: 'furniture.kind.set',
  sink: 'furniture.kind.sink',
}

export function createFurnitureNode(options: {
  kind: FurnitureKind
  dimensions: { width: number; height: number; depth: number }
  bayCount: number
  parentId?: AnyNodeId | null
  position?: [number, number, number]
  rotation?: number
}) {
  const furniture = createDefaultFurnitureAssembly({
    furnitureKind: options.kind,
    dimensions: options.dimensions,
    bayCount: options.bayCount,
  })
  const label = translate(FURNITURE_KIND_LABEL_KEYS[options.kind], useLocale.getState().locale)
  return CabinetNode.parse({
    name: label,
    parentId: options.parentId ?? null,
    position: options.position ?? [0, 0, 0],
    rotation: options.rotation ?? 0,
    width: furniture.dimensions.width,
    depth: furniture.dimensions.depth,
    carcassHeight: furniture.dimensions.height,
    showPlinth: false,
    withCountertop: false,
    furniture,
  })
}

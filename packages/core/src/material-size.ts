import type { MaterialPhysicalSize, MaterialSchema } from './schema/material'

export function resizeMaterialPhysicalSize(
  material: MaterialSchema,
  physicalSize: MaterialPhysicalSize,
): MaterialSchema {
  return {
    ...material,
    physicalSize,
    texture: material.texture
      ? {
          ...material.texture,
          repeat: [1 / physicalSize.widthM, 1 / physicalSize.heightM],
        }
      : undefined,
  }
}

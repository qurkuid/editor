import { z } from 'zod'

const rawPainterOptionSchema = z
  .object({
    size: z.string().nullish(),
    price: z.union([z.number(), z.string()]).nullish(),
  })
  .passthrough()
  .readonly()

export const rawPainterProductSchema = z
  .object({
    id: z.union([z.number(), z.string()]),
    categoryId: z.union([z.number(), z.string()]).nullish(),
    name: z.string().nullish(),
    category: z.string().nullish(),
    subCategory: z.string().nullish(),
    thumbnailUrl: z.string().nullish(),
    image: z.string().nullish(),
    img: z.string().nullish(),
    hasSeamless: z.boolean().nullish(),
    seamlessImage: z.string().nullish(),
    brand: z.string().nullish(),
    store: z.string().nullish(),
    price: z.union([z.number(), z.string()]).nullish(),
    options: z.array(rawPainterOptionSchema).readonly().nullish(),
  })
  .passthrough()
  .readonly()

export type RawPainterProduct = z.infer<typeof rawPainterProductSchema>

export const rawPainterCategorySchema = z
  .object({
    id: z.number(),
    name: z.string(),
    productCount: z.number(),
    seamlessProductCount: z.number().optional(),
  })
  .passthrough()
  .readonly()

export type RawPainterCategory = z.infer<typeof rawPainterCategorySchema>

export const rawPainterCatalogPageSchema = z
  .object({
    products: z.array(rawPainterProductSchema).readonly(),
    next: z.union([z.number(), z.string(), z.boolean()]).nullish(),
    pageNum: z.number().optional(),
    total: z.number().default(0),
  })
  .readonly()

export type RawPainterCatalogPage = z.infer<typeof rawPainterCatalogPageSchema>

export const rawPainterCategoryListSchema = z.array(rawPainterCategorySchema).readonly()

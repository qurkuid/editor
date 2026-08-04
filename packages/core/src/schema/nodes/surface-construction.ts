import { z } from 'zod'

/**
 * The build-up of a horizontal surface — a floor's joists and boards, a
 * ceiling's furring and gypsum.
 *
 * Deliberately the same shape as `WallConstructionLayer`: a layer is a layer
 * whichever plane it sits in, and a takeoff prices them identically (framing
 * by the metre at its spacing, sheet goods by the sheet). Keeping the two
 * shapes aligned means one expansion routine serves both; they are separate
 * declarations only because walls key theirs by band and surfaces do not.
 */

export const SurfaceConstructionLayerKind = z.enum([
  'gypsum-board',
  'plywood',
  'mdf',
  'timber-joist', // 장선 — floor joists
  'furring', // 각재 — ceiling furring / battens
  'insulation',
  'screed', // 방통 — poured, measured by volume
  'cavity',
  'finish',
  'custom',
])
export type SurfaceConstructionLayerKind = z.infer<typeof SurfaceConstructionLayerKind>

export const SurfaceConstructionLayer = z.object({
  kind: SurfaceConstructionLayerKind,
  thickness: z.number().positive(),
  /** Section width of a framing member, in metres. */
  memberWidth: z.number().positive().optional(),
  /** Centre-to-centre spacing of framing members, in metres. */
  memberSpacing: z.number().positive().optional(),
  /** Sheet dimensions for board goods, in metres. */
  sheetWidth: z.number().positive().optional(),
  sheetHeight: z.number().positive().optional(),
  /** Cutting loss, 0–1. */
  wasteFactor: z.number().min(0).max(1).default(0.1),
  productRef: z.string().optional(),
  brand: z.string().optional(),
  unitPrice: z.number().nonnegative().optional(),
})
export type SurfaceConstructionLayer = z.infer<typeof SurfaceConstructionLayer>

/**
 * A surface's layers, outermost first. Empty means "no build-up recorded" —
 * the takeoff then reports plain area rather than inventing a make-up.
 */
export const SurfaceConstruction = z.array(SurfaceConstructionLayer).default([])
export type SurfaceConstruction = z.infer<typeof SurfaceConstruction>

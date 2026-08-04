import {
  type CabinetModuleNode,
  CabinetModuleNode as CabinetModuleNodeSchema,
  type CabinetNode,
  CabinetNode as CabinetNodeSchema,
} from '@pascal-app/core'
import { cabinetDefinition, cabinetModuleDefinition } from './definition'
import { cabinetPresetById } from './presets'
import {
  CABINET_BASE_DEPTH,
  CABINET_BASE_WIDTH,
  CABINET_TALL_CARCASS_HEIGHT,
  CABINET_TALL_DEPTH,
  CABINET_TALL_PLINTH_HEIGHT,
  CABINET_WALL_CARCASS_HEIGHT,
  CABINET_WALL_DEPTH,
  runModuleBaseY,
} from './run-ops'
import { newCabinetCompartment } from './stack'

/**
 * Furniture the sidebar gallery places. Each kind is a plain composition of
 * what the cabinet system already has — a run tier, the shared run-ops
 * dimensions, and existing `CABINET_PRESETS` module patches — so furniture is
 * a *configuration* of a cabinet run, not a second modelling system.
 *
 * An island is a `base-run` plus the linked back row `addIslandBackRun` adds
 * at placement time; it isn't a distinct carcass here.
 */
export type FurnitureRunKind = 'wardrobe' | 'base-run' | 'upper-run' | 'tall' | 'island'

const WALL_MOUNT_HEIGHT = 1.5

type FurnitureRunSpec = {
  name: string
  runTier: CabinetNode['runTier']
  depth: number
  carcassHeight: number
  showPlinth: boolean
  withCountertop: boolean
  /** Lifted off the floor at placement — wall cabinets only. */
  mountHeight: number
  moduleWidth: number
  /** Built per module. Falls back to a `CABINET_PRESETS` patch when null. */
  stack: (() => CabinetModuleNode['stack']) | null
  presetId: Parameters<typeof cabinetPresetById>[0] | null
}

const FURNITURE_RUN_SPECS: Record<FurnitureRunKind, FurnitureRunSpec> = {
  wardrobe: {
    name: 'Wardrobe',
    runTier: 'tall',
    depth: 0.6,
    carcassHeight: CABINET_TALL_CARCASS_HEIGHT,
    showPlinth: true,
    withCountertop: false,
    mountHeight: 0,
    moduleWidth: 0.6,
    // Hanging section over a shelf stack — the rail is what makes it a
    // wardrobe rather than a tall pantry.
    stack: () => [
      { ...newCabinetCompartment('door'), doorType: 'double', shelfCount: 1, hanger: true },
    ],
    presetId: null,
  },
  'base-run': {
    name: 'Base Cabinets',
    runTier: 'base',
    depth: CABINET_BASE_DEPTH,
    carcassHeight: 0.72,
    showPlinth: true,
    withCountertop: true,
    mountHeight: 0,
    moduleWidth: CABINET_BASE_WIDTH,
    stack: null,
    presetId: 'base-door',
  },
  'upper-run': {
    name: 'Wall Cabinets',
    runTier: 'wall',
    depth: CABINET_WALL_DEPTH,
    carcassHeight: CABINET_WALL_CARCASS_HEIGHT,
    showPlinth: false,
    withCountertop: false,
    mountHeight: WALL_MOUNT_HEIGHT,
    moduleWidth: CABINET_BASE_WIDTH,
    stack: () => [{ ...newCabinetCompartment('door'), doorType: 'double', shelfCount: 2 }],
    presetId: null,
  },
  tall: {
    name: 'Tall Cabinets',
    runTier: 'tall',
    depth: CABINET_TALL_DEPTH,
    carcassHeight: CABINET_TALL_CARCASS_HEIGHT,
    showPlinth: true,
    withCountertop: false,
    mountHeight: 0,
    moduleWidth: CABINET_BASE_WIDTH,
    stack: null,
    presetId: 'tall-pantry',
  },
  island: {
    name: 'Kitchen Island',
    runTier: 'base',
    depth: CABINET_BASE_DEPTH,
    carcassHeight: 0.72,
    showPlinth: true,
    withCountertop: true,
    mountHeight: 0,
    moduleWidth: CABINET_BASE_WIDTH,
    stack: null,
    presetId: 'base-door',
  },
}

export function furnitureRunKinds(): FurnitureRunKind[] {
  return Object.keys(FURNITURE_RUN_SPECS) as FurnitureRunKind[]
}

export function furnitureRunSpec(kind: FurnitureRunKind): FurnitureRunSpec {
  return FURNITURE_RUN_SPECS[kind]
}

/**
 * Build the run + its modules for a gallery placement. Returns unattached
 * nodes; the caller upserts the run first, then each module under it (and
 * calls `addIslandBackRun` for `island`).
 */
export function createFurnitureRun(options: {
  kind: FurnitureRunKind
  moduleCount?: number
  parentId?: string | null
  position?: [number, number, number]
  rotation?: number
  name?: string
}): { run: CabinetNode; modules: CabinetModuleNode[] } {
  const spec = FURNITURE_RUN_SPECS[options.kind]
  const moduleCount = Math.max(1, Math.floor(options.moduleCount ?? 1))
  const [x, y, z] = options.position ?? [0, 0, 0]

  const run = CabinetNodeSchema.parse({
    ...cabinetDefinition.defaults(),
    name: options.name ?? spec.name,
    parentId: options.parentId ?? null,
    position: [x, y + spec.mountHeight, z],
    rotation: options.rotation ?? 0,
    runTier: spec.runTier,
    depth: spec.depth,
    carcassHeight: spec.carcassHeight,
    showPlinth: spec.showPlinth,
    withCountertop: spec.withCountertop,
    plinthHeight: spec.showPlinth ? CABINET_TALL_PLINTH_HEIGHT : 0,
    // A free-standing furniture run shows both ends; a kitchen run usually
    // dies into a wall, so only the furniture kinds default them on.
    endPanels:
      options.kind === 'wardrobe' || options.kind === 'tall'
        ? { left: true, right: true }
        : { left: false, right: false },
  })

  const presetPatch = spec.presetId ? cabinetPresetById(spec.presetId).createPatch(run) : null
  const baseY = runModuleBaseY(run)
  const totalWidth = spec.moduleWidth * moduleCount

  const modules = Array.from({ length: moduleCount }, (_, index) =>
    CabinetModuleNodeSchema.parse({
      ...cabinetModuleDefinition.defaults(),
      ...presetPatch,
      name: index === 0 ? spec.name : `${spec.name} ${index + 1}`,
      parentId: run.id,
      position: [-totalWidth / 2 + spec.moduleWidth * (index + 0.5), baseY, 0],
      width: spec.moduleWidth,
      depth: run.depth,
      carcassHeight: run.carcassHeight,
      // Module `cabinetType` is base|tall only — a wall run's modules are
      // 'base' boxes, the run tier is what makes them wall-hung.
      cabinetType: spec.runTier === 'tall' ? 'tall' : 'base',
      plinthHeight: run.plinthHeight,
      showPlinth: false,
      withCountertop: false,
      ...(spec.stack ? { stack: spec.stack() } : {}),
    }),
  )

  return { run, modules }
}

import type { FurnitureAssembly } from '../../schema/nodes/furniture'
import { normalizeFurnitureAssembly } from './normalize'

export type FurnitureImportWarningCode =
  | 'unsupported_field'
  | 'invalid_json'
  | 'invalid_input'
  | 'normalization_error'

export type FurnitureImportWarning = {
  severity: 'warning' | 'error'
  code: FurnitureImportWarningCode
  path: string
  message: string
}

export type FurnitureBuilderImportResult = {
  assembly: FurnitureAssembly | null
  warnings: FurnitureImportWarning[]
}

type RawRecord = Record<string, unknown>
type FieldContext =
  | 'root'
  | 'dimensions'
  | 'constraints'
  | 'margins'
  | 'fillers'
  | 'side-opening'
  | 'surround'
  | 'curtain'
  | 'ceiling-step'
  | 'step-side'
  | 'material-defaults'
  | 'side-finish'
  | 'depth-split'
  | 'set-upper'
  | 'bay'
  | 'base'
  | 'tier'
  | 'depth'
  | 'front'
  | 'door-extension'
  | 'count-heights'
  | 'channels'
  | 'channel'
  | 'panel'
  | 'chamfer'
  | 'fixture'
  | 'position'
  | 'size'
  | 'sink'
  | 'induction'
  | 'tier-markers'
  | 'marker-rect'
  | 'marker-point'
  | 'light'
  | 'outlet'
  | 'smps'

const supportedFields: Record<FieldContext, ReadonlySet<string>> = {
  root: new Set([
    'schema_version',
    'schemaVersion',
    'type',
    'furnitureKind',
    'location',
    'locationTagSync',
    'W',
    'H',
    'D',
    'width',
    'carcassHeight',
    'depth',
    'dimensions',
    'constraints',
    'HLocked',
    'margins',
    'margin',
    'fillers',
    'surround',
    'curtain',
    'ceilingStep',
    'step',
    'defaultFace',
    'face',
    'materialDefaults',
    'sideFinish',
    'depthSplit',
    'frontD',
    'backD',
    'setUpper',
    'bays',
    'backBays',
    'upperBays',
    'stack',
    'fixtures',
    'sink',
    'induction',
    'runTier',
    'showPlinth',
    'plinthHeight',
    'furniture',
  ]),
  dimensions: new Set(['width', 'height', 'depth']),
  constraints: new Set([
    'minWidth',
    'maxWidth',
    'minHeight',
    'maxHeight',
    'minDepth',
    'maxDepth',
    'heightLocked',
  ]),
  margins: new Set(['left', 'right', 'top', 'front', 'back']),
  fillers: new Set(['left', 'right', 'leftW', 'rightW']),
  'side-opening': new Set(['enabled', 'width']),
  surround: new Set(['enabled', 'size', 'top', 'left', 'right']),
  curtain: new Set(['left', 'right', 'leftW', 'rightW', 'height', 'shape', 'includedInTotal']),
  'ceiling-step': new Set(['left', 'right', 'leftW', 'rightW', 'leftH', 'rightH', 'depth', 'D']),
  'step-side': new Set(['enabled', 'width', 'height']),
  'material-defaults': new Set(['carcass', 'back', 'front', 'countertop', 'edge', 'hardware']),
  'side-finish': new Set(['left', 'right', 'color']),
  'depth-split': new Set(['front', 'back']),
  'set-upper': new Set([
    'enabled',
    'height',
    'depth',
    'gap',
    'totalWidth',
    'totalW',
    'anchor',
    'gapLocked',
    'heightLocked',
  ]),
  bay: new Set([
    'id',
    'width',
    'widthLocked',
    'base',
    'baseBack',
    'kickplate',
    'endPanels',
    'ep',
    'visible',
    'hidden',
    'lowerStile',
    'noLowerStile',
    'tiers',
  ]),
  base: new Set(['type', 'height']),
  tier: new Set([
    'id',
    'type',
    'height',
    'depth',
    'face',
    'front',
    'door',
    'openMethod',
    'openType',
    'doorExtension',
    'doorExt',
    'doorColor',
    'doorMaterial',
    'drawerCount',
    'visible',
    'hidden',
    'heightLocked',
    'shelves',
    'shelfCount',
    'hanger',
    'internalDrawers',
    'channels',
    'channel',
    'topPanel',
    'bottomPanel',
    'epBottom',
    'mergeNext',
    'fixtures',
    'tierMarkers',
    'lights',
    'outlets',
    'smps',
  ]),
  depth: new Set(['value', 'reference']),
  front: new Set(['kind', 'leaves', 'glass', 'color', 'materialId', 'count', 'direction', 'style']),
  'door-extension': new Set(['top', 'bottom']),
  'count-heights': new Set(['count', 'heights']),
  channels: new Set(['top', 'middle']),
  channel: new Set(['enabled', 'height', 'depth', 'handSpace', 'color']),
  panel: new Set(['kind', 'enabled', 'thickness', 'material', 'overhang', 'color', 'chamfer']),
  chamfer: new Set(['enabled', 'size']),
  fixture: new Set([
    'type',
    'id',
    'enabled',
    'position',
    'size',
    'model',
    'radius',
    'bowlHeight',
    'diameter',
    'componentName',
    'mount',
    'axis',
    'shelfIndex',
    'shelf_idx',
    'inset',
    'rotate',
  ]),
  position: new Set(['x', 'y', 'z']),
  size: new Set(['width', 'depth', 'height']),
  sink: new Set(['enabled', 'preset', 'cutoutW', 'cutoutD', 'cutoutR', 'bowlH']),
  induction: new Set(['enabled', 'preset', 'width', 'depth', 'height']),
  'tier-markers': new Set(['induction', 'sinkBowl', 'faucet']),
  'marker-rect': new Set(['enabled', 'x', 'y', 'w', 'd', 'r', 'model']),
  'marker-point': new Set(['enabled', 'x', 'y', 'dia', 'component']),
  light: new Set([
    'id',
    'mount',
    'axis',
    'shelfIndex',
    'shelf_idx',
    'inset',
    'componentName',
    'rotate',
  ]),
  outlet: new Set(['id', 'mount', 'x', 'z', 'w', 'h', 'componentName']),
  smps: new Set(['id', 'mount', 'x', 'z', 'w', 'd', 'h', 'componentName']),
}

const childContexts: Partial<Record<FieldContext, Record<string, FieldContext>>> = {
  root: {
    dimensions: 'dimensions',
    constraints: 'constraints',
    margins: 'margins',
    margin: 'margins',
    fillers: 'fillers',
    surround: 'surround',
    curtain: 'curtain',
    ceilingStep: 'ceiling-step',
    step: 'ceiling-step',
    materialDefaults: 'material-defaults',
    sideFinish: 'side-finish',
    depthSplit: 'depth-split',
    setUpper: 'set-upper',
    bays: 'bay',
    backBays: 'bay',
    upperBays: 'bay',
    stack: 'tier',
    fixtures: 'fixture',
    sink: 'sink',
    induction: 'induction',
    furniture: 'root',
  },
  fillers: { left: 'side-opening', right: 'side-opening' },
  curtain: { left: 'side-opening', right: 'side-opening' },
  'ceiling-step': { left: 'step-side', right: 'step-side' },
  bay: {
    base: 'base',
    baseBack: 'base',
    endPanels: 'side-finish',
    ep: 'side-finish',
    tiers: 'tier',
  },
  tier: {
    depth: 'depth',
    front: 'front',
    doorExtension: 'door-extension',
    doorExt: 'door-extension',
    shelves: 'count-heights',
    internalDrawers: 'count-heights',
    channels: 'channels',
    channel: 'channels',
    topPanel: 'panel',
    bottomPanel: 'panel',
    fixtures: 'fixture',
    tierMarkers: 'tier-markers',
    lights: 'light',
    outlets: 'outlet',
    smps: 'smps',
  },
  front: {},
  panel: { chamfer: 'chamfer' },
  channels: { top: 'channel', middle: 'channel' },
  fixture: { position: 'position', size: 'size' },
  'tier-markers': {
    induction: 'marker-rect',
    sinkBowl: 'marker-rect',
    faucet: 'marker-point',
  },
}

const inputShapeFields = new Set([
  'schema_version',
  'schemaVersion',
  'type',
  'furnitureKind',
  'W',
  'H',
  'D',
  'dimensions',
  'bays',
  'stack',
  'furniture',
])

export function importFurnitureBuilder(input: unknown): FurnitureBuilderImportResult {
  if (!isRecord(input)) return invalidInput('Furniture Builder input must be a JSON object.')

  try {
    const source = unwrapFurniture(input)
    if (!hasInputShape(source)) {
      return invalidInput('Furniture Builder input does not contain a supported root shape.')
    }

    const warnings = collectUnsupportedFieldWarnings(source)
    try {
      return {
        assembly: normalizeFurnitureAssembly(source),
        warnings,
      }
    } catch {
      return {
        assembly: null,
        warnings: [...warnings, normalizationError()],
      }
    }
  } catch {
    return {
      assembly: null,
      warnings: [normalizationError()],
    }
  }
}

export function importFurnitureBuilderJson(input: unknown): FurnitureBuilderImportResult {
  if (typeof input !== 'string') {
    return invalidInput('Furniture Builder JSON input must be a string.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(input)
  } catch {
    return {
      assembly: null,
      warnings: [
        {
          severity: 'error',
          code: 'invalid_json',
          path: '',
          message: 'Invalid Furniture Builder JSON.',
        },
      ],
    }
  }

  return importFurnitureBuilder(parsed)
}

function unwrapFurniture(input: RawRecord): RawRecord {
  return isRecord(input.furniture) ? input.furniture : input
}

function hasInputShape(input: RawRecord): boolean {
  return Object.keys(input).some((key) => inputShapeFields.has(key))
}

function collectUnsupportedFieldWarnings(input: RawRecord): FurnitureImportWarning[] {
  const warnings: FurnitureImportWarning[] = []
  visitRecord(input, 'root', '', warnings)
  return warnings
}

function visitRecord(
  value: unknown,
  context: FieldContext,
  path: string,
  warnings: FurnitureImportWarning[],
): void {
  if (!isRecord(value)) return

  const fields = supportedFields[context]
  const nestedContexts = childContexts[context] ?? {}
  for (const key of Object.keys(value)) {
    const fieldPath = path ? `${path}.${key}` : key
    if (!fields.has(key)) {
      warnings.push({
        severity: 'warning',
        code: 'unsupported_field',
        path: fieldPath,
        message: `Unsupported Furniture Builder field "${key}".`,
      })
      continue
    }

    const childContext = nestedContexts[key]
    if (!childContext) continue
    const child = value[key]
    if (Array.isArray(child)) {
      child.forEach((entry, index) => {
        visitRecord(entry, childContext, `${fieldPath}[${index}]`, warnings)
      })
    } else {
      visitRecord(child, childContext, fieldPath, warnings)
    }
  }
}

function invalidInput(message: string): FurnitureBuilderImportResult {
  return {
    assembly: null,
    warnings: [
      {
        severity: 'error',
        code: 'invalid_input',
        path: '',
        message,
      },
    ],
  }
}

function normalizationError(): FurnitureImportWarning {
  return {
    severity: 'error',
    code: 'normalization_error',
    path: '',
    message: 'Furniture Builder input could not be normalized.',
  }
}

function isRecord(value: unknown): value is RawRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

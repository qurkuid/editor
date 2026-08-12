import { describe, expect, test } from 'bun:test'
import { manipulationSnapMarkerToken, manipulationSnapTier } from '@pascal-app/core'
import {
  getModelingOperationManifestEntry,
  MODELING_OPERATION_IDS,
} from '@pascal-app/core/modeling-operations'
import { resolveResizeSnapValue } from '../components/editor/handles/resize-snap'
import {
  constrainSpatialDraftPoint,
  parseDraftLength,
  parseSignedDraftLength,
} from './draft-length-input'
import { parseTypedAngle, typedAngleToDelta } from './pivot-rotate-math'
import { cycleSnappingModeIn, snapContextOf } from './snapping-mode'

const CASES = [
  {
    label: 'Move',
    id: MODELING_OPERATION_IDS.transformBody,
    typed: () => constrainSpatialDraftPoint([0, 0, 0], [2, 0, 0], 1.2),
    expected: [1.2, 0, 0],
  },
  {
    label: 'Rotate',
    id: MODELING_OPERATION_IDS.transformBody,
    typed: () => typedAngleToDelta(parseTypedAngle('15') ?? 0),
    expected: (-15 * Math.PI) / 180,
  },
  {
    label: 'Scale',
    id: MODELING_OPERATION_IDS.transformBody,
    typed: () => parseDraftLength('1200', 'metric', 'millimeters'),
    expected: 1.2,
  },
  {
    label: 'Push/Pull',
    id: MODELING_OPERATION_IDS.pushPullBodyFace,
    typed: () => parseDraftLength('1.2', 'metric', 'meters'),
    expected: 1.2,
  },
  {
    label: 'Offset',
    id: MODELING_OPERATION_IDS.offsetBodyFace,
    typed: () => parseSignedDraftLength('-120', 'metric', 'millimeters'),
    expected: -0.12,
  },
] as const

describe('precise manipulation conformance', () => {
  for (const operationCase of CASES) {
    test(`${operationCase.label} uses the shared snap, modifier, input, and lifecycle contract`, () => {
      const interaction = getModelingOperationManifestEntry(operationCase.id).interaction

      expect(interaction).toBeDefined()
      expect(interaction?.snap).toEqual({
        tiers: ['endpoint', 'midpoint', 'edge', 'face'],
        markerTokenPrefix: 'manipulation-snap:',
      })
      expect(interaction?.modifiers).toEqual({ shift: 'cycle-context', alt: 'raw-bypass' })
      expect(interaction?.typedInput).toBe(true)
      expect(interaction?.commit).toEqual(['click', 'enter'])
      expect(interaction?.cancel).toBe('escape')
      expect(interaction?.previewEqualsCommit).toBe(true)
      expect(interaction?.cancelImmutable).toBe(true)
      expect(interaction?.history).toBe('single-undo')
      expect(interaction?.serialization).toBe('round-trip')
      const actual = operationCase.typed()
      if (Array.isArray(actual)) {
        expect(JSON.stringify(actual)).toBe(JSON.stringify(operationCase.expected))
      } else {
        expect(actual).toBeCloseTo(operationCase.expected as number)
      }
    })
  }

  test('keeps Shift as the active context chip and Alt as the raw snap bypass', () => {
    expect(cycleSnappingModeIn('polygon', 'grid')).toBe('lines')
    expect(
      snapContextOf({
        scope: { kind: 'moving', nodeType: 'body' },
        mode: 'select',
        tool: null,
        profileOf: (type) => (type === 'body' ? 'structural' : undefined),
      }),
    ).toBe('polygon')
    expect(
      resolveResizeSnapValue({
        rawValue: 0.56,
        gridSnapEnabled: true,
        gridSnapActive: true,
        gridSnapStep: 0.1,
        magneticSnapActive: true,
        magneticSnap: () => 0.6,
        bypassSnap: true,
      }),
    ).toBe(0.56)
  })

  test('keeps the semantic marker token stable through serialization', () => {
    const marker = {
      tier: manipulationSnapTier('endpoint'),
      markerToken: manipulationSnapMarkerToken('endpoint'),
    }
    expect(JSON.parse(JSON.stringify(marker))).toEqual(marker)
  })
})

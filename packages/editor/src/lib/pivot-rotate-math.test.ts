import { describe, expect, it } from 'bun:test'
import { DEFAULT_ANGLE_STEP } from '@pascal-app/core'
import type { ParticipantStart } from '../components/editor/group-transform-shared'
import {
  normalizeAngle,
  parseTypedAngle,
  planBearing,
  resolveRotateDelta,
  rotateVec3PatchesAboutAxis,
  typedAngleToDelta,
} from './pivot-rotate-math'

const pivot = { x: 1, z: 1 }

describe('planBearing', () => {
  it('measures atan2 in the x→z sense around the pivot', () => {
    expect(planBearing(pivot, { x: 2, z: 1 })).toBeCloseTo(0)
    expect(planBearing(pivot, { x: 1, z: 2 })).toBeCloseTo(Math.PI / 2)
    expect(planBearing(pivot, { x: 0, z: 1 })).toBeCloseTo(Math.PI)
  })
})

describe('normalizeAngle', () => {
  it('wraps into (-π, π]', () => {
    expect(normalizeAngle(3 * Math.PI)).toBeCloseTo(Math.PI)
    expect(normalizeAngle(-1.5 * Math.PI)).toBeCloseTo(Math.PI / 2)
    expect(normalizeAngle(0.25)).toBeCloseTo(0.25)
  })
})

describe('resolveRotateDelta', () => {
  const reference = { x: 2, z: 1 }

  it('returns the swept angle from reference to cursor when free', () => {
    expect(resolveRotateDelta(pivot, reference, { x: 1, z: 2 }, true)).toBeCloseTo(Math.PI / 2)
    expect(resolveRotateDelta(pivot, reference, { x: 1, z: 0 }, true)).toBeCloseTo(-Math.PI / 2)
  })

  it('snaps to the canonical angle step by default', () => {
    const nearFifteen = (14 * Math.PI) / 180
    const cursor = {
      x: pivot.x + Math.cos(nearFifteen),
      z: pivot.z + Math.sin(nearFifteen),
    }
    expect(resolveRotateDelta(pivot, reference, cursor, false)).toBeCloseTo(DEFAULT_ANGLE_STEP)
  })

  it('takes the short way around past ±180°', () => {
    const cursor = {
      x: pivot.x + Math.cos((-170 * Math.PI) / 180),
      z: pivot.z + Math.sin((-170 * Math.PI) / 180),
    }
    expect(resolveRotateDelta(pivot, reference, cursor, true)).toBeCloseTo((-170 * Math.PI) / 180)
  })
})

describe('parseTypedAngle', () => {
  it('parses plain, decimal, and negative degrees', () => {
    expect(parseTypedAngle('45')).toBe(45)
    expect(parseTypedAngle('-30.5')).toBe(-30.5)
    expect(parseTypedAngle('.5')).toBe(0.5)
  })

  it('rejects incomplete or invalid buffers', () => {
    expect(parseTypedAngle('')).toBeNull()
    expect(parseTypedAngle('-')).toBeNull()
    expect(parseTypedAngle('.')).toBeNull()
    expect(parseTypedAngle('1.2.3')).toBeNull()
  })
})

describe('typedAngleToDelta', () => {
  it('negates degrees into the internal x→z sense', () => {
    expect(typedAngleToDelta(90)).toBeCloseTo(-Math.PI / 2)
    expect(typedAngleToDelta(-45)).toBeCloseTo(Math.PI / 4)
  })
})

describe('rotateVec3PatchesAboutAxis', () => {
  const item = (position: [number, number, number]): ParticipantStart => ({
    id: 'item_test' as never,
    kind: 'vec3',
    position,
    rotation: [0, 0, 0],
  })

  it('orbits position and tilts orientation about the z axis', () => {
    // Typed +90° → delta -π/2 → R_z(+π/2): +X lifts to +Y.
    const [patch] = rotateVec3PatchesAboutAxis([item([2, 0, 0])], { x: 0, z: 0 }, 'z', -Math.PI / 2)
    const { position, rotation } = patch![1] as {
      position: [number, number, number]
      rotation: [number, number, number]
    }
    expect(position[0]).toBeCloseTo(0)
    expect(position[1]).toBeCloseTo(2)
    expect(position[2]).toBeCloseTo(0)
    expect(rotation[2]).toBeCloseTo(Math.PI / 2)
  })

  it('orbits about the x axis through the pivot', () => {
    // R_x(+π/2): +Z folds to -Y; the x offset from the pivot is unaffected.
    const [patch] = rotateVec3PatchesAboutAxis([item([1, 0, 3])], { x: 1, z: 1 }, 'x', -Math.PI / 2)
    const { position } = patch![1] as { position: [number, number, number] }
    expect(position[0]).toBeCloseTo(1)
    expect(position[1]).toBeCloseTo(-2)
    expect(position[2]).toBeCloseTo(1)
  })

  it('skips non-vec3 participants', () => {
    const wall: ParticipantStart = {
      id: 'wall_test' as never,
      kind: 'endpoint',
      start: [0, 0],
      end: [1, 0],
    }
    expect(rotateVec3PatchesAboutAxis([wall], { x: 0, z: 0 }, 'z', 1)).toEqual([])
  })
})

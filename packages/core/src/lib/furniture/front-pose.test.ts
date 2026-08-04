import { describe, expect, test } from 'bun:test'
import { drawerFrontPose, flapFrontPose, hingedFrontPose, slidingFrontPose } from './front-pose'

describe('hingedFrontPose', () => {
  test('left hinge sits at the left edge and swings toward +Z (front face)', () => {
    expect(hingedFrontPose('left', 0.6)).toEqual({
      kind: 'hinge',
      axis: 'y',
      hingeOffset: -0.3,
      angle: -(Math.PI / 2),
    })
  })

  test('right hinge sits at the right edge and swings toward +Z (front face)', () => {
    expect(hingedFrontPose('right', 0.6)).toEqual({
      kind: 'hinge',
      axis: 'y',
      hingeOffset: 0.3,
      angle: Math.PI / 2,
    })
  })

  test('a left/right pair opens symmetrically', () => {
    const left = hingedFrontPose('left', 0.5)
    const right = hingedFrontPose('right', 0.5)
    if (left.kind !== 'hinge' || right.kind !== 'hinge') throw new Error('expected hinge poses')

    expect(left.hingeOffset).toBeCloseTo(-right.hingeOffset)
    expect(left.angle).toBeCloseTo(-right.angle)
  })

  test('a back-face hinge (dirSign -1) swings toward -Z instead', () => {
    const front = hingedFrontPose('left', 0.6, 1)
    const back = hingedFrontPose('left', 0.6, -1)
    if (front.kind !== 'hinge' || back.kind !== 'hinge') throw new Error('expected hinge poses')

    // Same hinge edge either way; only the open direction flips.
    expect(back.hingeOffset).toBeCloseTo(front.hingeOffset)
    expect(back.angle).toBeCloseTo(-front.angle)
  })
})

describe('flapFrontPose', () => {
  test('an "up" flap hinges at the top edge', () => {
    const pose = flapFrontPose('up', 0.4)
    if (pose.kind !== 'hinge') throw new Error('expected a hinge pose')

    expect(pose.axis).toBe('x')
    expect(pose.hingeOffset).toBeCloseTo(0.2)
  })

  test('a "down" flap hinges at the bottom edge', () => {
    const pose = flapFrontPose('down', 0.4)
    if (pose.kind !== 'hinge') throw new Error('expected a hinge pose')

    expect(pose.axis).toBe('x')
    expect(pose.hingeOffset).toBeCloseTo(-0.2)
  })

  test('up/down mirror each other, both opening toward +Z (front face)', () => {
    const up = flapFrontPose('up', 0.4)
    const down = flapFrontPose('down', 0.4)
    if (up.kind !== 'hinge' || down.kind !== 'hinge') throw new Error('expected hinge poses')

    expect(up.angle).toBeCloseTo(-down.angle)
  })

  test('a back-face flap (dirSign -1) opens toward -Z instead', () => {
    const front = flapFrontPose('down', 0.4, 1)
    const back = flapFrontPose('down', 0.4, -1)
    if (front.kind !== 'hinge' || back.kind !== 'hinge') throw new Error('expected hinge poses')

    expect(back.hingeOffset).toBeCloseTo(front.hingeOffset)
    expect(back.angle).toBeCloseTo(-front.angle)
  })
})

describe('slidingFrontPose', () => {
  test('even-indexed (near-track) leaves slide one way, odd-indexed (recessed) the other', () => {
    const near = slidingFrontPose(0.5, 0)
    const recessed = slidingFrontPose(0.5, 1)
    if (near.kind !== 'slide' || recessed.kind !== 'slide') throw new Error('expected slide poses')

    expect(Math.sign(near.distance)).toBe(-Math.sign(recessed.distance))
  })

  test('same-track leaves get the identical distance, so they never converge', () => {
    const leaf0 = slidingFrontPose(0.4, 0)
    const leaf2 = slidingFrontPose(0.4, 2)
    const leaf1 = slidingFrontPose(0.4, 1)
    const leaf3 = slidingFrontPose(0.4, 3)
    if (
      leaf0.kind !== 'slide' ||
      leaf1.kind !== 'slide' ||
      leaf2.kind !== 'slide' ||
      leaf3.kind !== 'slide'
    ) {
      throw new Error('expected slide poses')
    }

    expect(leaf0.distance).toBeCloseTo(leaf2.distance)
    expect(leaf1.distance).toBeCloseTo(leaf3.distance)
  })
})

describe('drawerFrontPose', () => {
  test('a single drawer slides out along +Z, capped at a sensible max', () => {
    const pose = drawerFrontPose(1, 1)
    if (pose.kind !== 'slide') throw new Error('expected a slide pose')

    expect(pose.axis).toBe('z')
    expect(pose.distance).toBeLessThanOrEqual(0.35)
    expect(pose.distance).toBeGreaterThan(0)
  })

  test('shallow compartments open proportionally less than the cap', () => {
    const shallow = drawerFrontPose(0.2, 1)
    const deep = drawerFrontPose(2, 1)
    if (shallow.kind !== 'slide' || deep.kind !== 'slide') throw new Error('expected slide poses')

    expect(shallow.distance).toBeLessThan(deep.distance)
    expect(deep.distance).toBeCloseTo(0.35)
  })

  test('stacked drawers cascade — the bottom drawer (index 0) opens furthest', () => {
    const bottom = drawerFrontPose(0.6, 1, 0, 3)
    const middle = drawerFrontPose(0.6, 1, 1, 3)
    const top = drawerFrontPose(0.6, 1, 2, 3)
    if (bottom.kind !== 'slide' || middle.kind !== 'slide' || top.kind !== 'slide') {
      throw new Error('expected slide poses')
    }

    expect(bottom.distance).toBeGreaterThan(middle.distance)
    expect(middle.distance).toBeGreaterThan(top.distance)
  })

  test('a back-face drawer (dirSign -1) slides out along -Z instead', () => {
    const pose = drawerFrontPose(0.6, -1)
    if (pose.kind !== 'slide') throw new Error('expected a slide pose')

    expect(pose.distance).toBeLessThan(0)
  })
})

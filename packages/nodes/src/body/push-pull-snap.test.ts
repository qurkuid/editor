import { describe, expect, test } from 'bun:test'
import { PerspectiveCamera, Vector3 } from 'three'
import {
  projectPushPullDistance,
  resolvePushPullRayCandidate,
  snapPushPullDistanceToGrid,
} from './push-pull-snap'

describe('Push/Pull snapping', () => {
  test('projects semantic surface hits onto the selected face normal', () => {
    expect(
      projectPushPullDistance({
        anchor: [1, 2, 3],
        normal: [0, 1, 0],
        point: [4, 3.25, 9],
      }),
    ).toBeCloseTo(1.25)
    expect(
      projectPushPullDistance({
        anchor: [1, 2, 3],
        normal: [0, 1, 0],
        point: [4, 1.25, 9],
      }),
    ).toBeCloseTo(-0.75)
  })

  test('resolves horizontal, vertical, and tilted face-normal axes from a pointer ray', () => {
    const cases = [
      {
        anchor: [0, 0, 0] as const,
        normal: [0, 1, 0] as const,
        rayOrigin: [0, 1.5, -2] as const,
        rayDirection: [0, 0, 1] as const,
        expected: [0, 1.5, 0] as const,
        distance: 1.5,
      },
      {
        anchor: [0, 0, 0] as const,
        normal: [1, 0, 0] as const,
        rayOrigin: [2, 0, -3] as const,
        rayDirection: [0, 0, 1] as const,
        expected: [2, 0, 0] as const,
        distance: 2,
      },
      {
        anchor: [0, 0, 0] as const,
        normal: [Math.SQRT1_2, Math.SQRT1_2, 0] as const,
        rayOrigin: [2 * Math.SQRT1_2, 2 * Math.SQRT1_2, -4] as const,
        rayDirection: [0, 0, 1] as const,
        expected: [2 * Math.SQRT1_2, 2 * Math.SQRT1_2, 0] as const,
        distance: 2,
      },
    ]

    for (const testCase of cases) {
      const candidate = resolvePushPullRayCandidate(testCase)
      expect(candidate).not.toBeNull()
      if (!candidate) throw new Error('Expected a valid pointer-ray candidate')
      expect(candidate[0]).toBeCloseTo(testCase.expected[0])
      expect(candidate[1]).toBeCloseTo(testCase.expected[1])
      expect(candidate[2]).toBeCloseTo(testCase.expected[2])
      expect(
        projectPushPullDistance({
          anchor: testCase.anchor,
          normal: testCase.normal,
          point: candidate,
        }),
      ).toBeCloseTo(testCase.distance)
    }
  })

  test('keeps the same signed world distance when camera azimuth moves the point across screen sides', () => {
    const normal = [Math.SQRT1_2, Math.SQRT1_2, 0] as const
    const distance = 1.25
    const candidate = new Vector3(normal[0], normal[1], normal[2]).multiplyScalar(distance)
    const cameras = [[5, 4, -5] as const, [-5, 4, 5] as const]
    const screenSigns: number[] = []

    for (const position of cameras) {
      const camera = new PerspectiveCamera(50, 4 / 3, 0.1, 100)
      camera.position.set(...position)
      camera.lookAt(0, 0, 0)
      camera.updateMatrixWorld(true)
      screenSigns.push(Math.sign(candidate.clone().project(camera).x))

      const projected = resolvePushPullRayCandidate({
        anchor: [0, 0, 0],
        normal,
        rayOrigin: position,
        rayDirection: [
          candidate.x - position[0],
          candidate.y - position[1],
          candidate.z - position[2],
        ],
      })
      expect(projected).not.toBeNull()
      expect(projectPushPullDistance({ anchor: [0, 0, 0], normal, point: projected! })).toBeCloseTo(
        distance,
      )
    }

    expect(screenSigns).toEqual([-1, 1])
  })

  test('rejects head-on rays from either camera side and candidates behind the ray', () => {
    const axis = { anchor: [1, 0, 0] as const, normal: [1, 0, 0] as const }
    expect(
      resolvePushPullRayCandidate({
        ...axis,
        rayOrigin: [6, 0, 0],
        rayDirection: [-1, 0, 0],
      }),
    ).toBeNull()
    expect(
      resolvePushPullRayCandidate({
        ...axis,
        rayOrigin: [-4, 0, 0],
        rayDirection: [1, 0, 0],
      }),
    ).toBeNull()
    expect(
      resolvePushPullRayCandidate({
        anchor: [0, 0, 0],
        normal: [0, 1, 0],
        rayOrigin: [0, 1, -2],
        rayDirection: [0, 0, -1],
      }),
    ).toBeNull()
  })

  test('quantizes the scalar distance only when a positive grid step is active', () => {
    expect(snapPushPullDistanceToGrid(1.24, 0.5)).toBe(1)
    expect(snapPushPullDistanceToGrid(1.26, 0.5)).toBe(1.5)
    expect(snapPushPullDistanceToGrid(1.26, 0)).toBe(1.26)
  })
})

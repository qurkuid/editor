import { expect, test } from 'bun:test'
import { DoorNode, WallNode, WindowNode } from '../schema'
import { buildWallLengthUpdates, WallOperationError } from './wall-operations'

test('length input follows shared endpoints and validates all hosts before mutation', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [4, 0] })
  const neighbor = WallNode.parse({ start: [4, 0], end: [4, 3] })
  const nodes = { [wall.id]: wall, [neighbor.id]: neighbor }
  const updates = buildWallLengthUpdates(nodes, wall.id, 3)
  expect(updates.find((update) => update.id === wall.id)?.data.end).toEqual([3, 0])
  expect(updates.find((update) => update.id === neighbor.id)?.data.start).toEqual([3, 0])
  expect(wall.end).toEqual([4, 0])

  for (const Schema of [DoorNode, WindowNode]) {
    const opening = Schema.parse({
      wallId: wall.id,
      parentId: wall.id,
      position: [3, 0, 0],
      width: 1,
    })
    expect(() => buildWallLengthUpdates({ ...nodes, [opening.id]: opening }, wall.id, 3)).toThrow(
      WallOperationError,
    )
  }
  const collinear = WallNode.parse({ start: [4, 0], end: [8, 0] })
  const opening = WindowNode.parse({ wallId: collinear.id, position: [3, 0, 0], width: 1 })
  expect(() =>
    buildWallLengthUpdates(
      { [wall.id]: wall, [collinear.id]: collinear, [opening.id]: opening },
      wall.id,
      6,
    ),
  ).toThrow(WallOperationError)
  expect(collinear.start).toEqual([4, 0])
})

test('length input rejects loss of an interior T junction, collapsed neighbors and curved walls', () => {
  const wall = WallNode.parse({ start: [0, 0], end: [4, 0] })
  const branch = WallNode.parse({ start: [3, 0], end: [3, 3] })
  expect(() =>
    buildWallLengthUpdates({ [wall.id]: wall, [branch.id]: branch }, wall.id, 2),
  ).toThrow(WallOperationError)
  expect(() =>
    buildWallLengthUpdates({ [wall.id]: wall, [branch.id]: branch }, branch.id, 4),
  ).not.toThrow()
  const neighbor = WallNode.parse({ start: [4, 0], end: [5, 0] })
  expect(() =>
    buildWallLengthUpdates({ [wall.id]: wall, [neighbor.id]: neighbor }, wall.id, 5),
  ).toThrow(WallOperationError)
  expect(() =>
    buildWallLengthUpdates({ [wall.id]: wall, [neighbor.id]: neighbor }, wall.id, 6),
  ).toThrow(WallOperationError)
  const curve = WallNode.parse({ ...wall, curveOffset: 0.5 })
  expect(() => buildWallLengthUpdates({ [curve.id]: curve }, curve.id, 5)).toThrow(
    WallOperationError,
  )
})

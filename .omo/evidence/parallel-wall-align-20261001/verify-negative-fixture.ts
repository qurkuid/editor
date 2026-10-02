import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AnyNode } from '../../../packages/core/src/schema'
import {
  buildWallParallelAlignmentUpdates,
  WallOperationError,
} from '../../../packages/core/src/lib/wall-operations'

const fixturePath = resolve(
  process.argv[2] ?? '.omo/evidence/parallel-wall-align-20261001/negative-fixture.json',
)
const outputPath = resolve(
  process.argv[3] ??
    '.omo/evidence/parallel-wall-align-20261001/negative-fixture-verification.json',
)
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  graph: { nodes: Record<string, any> }
  cases: Array<{ id: string; selectedWallId: string; expectedError: string }>
}

for (const [id, node] of Object.entries(fixture.graph.nodes)) {
  const parsed = AnyNode.parse(node)
  if (parsed.id !== id) throw new Error(`Node key does not match node id: ${id}`)
}

const results = fixture.cases.map((testCase) => {
  const before = JSON.stringify(fixture.graph.nodes)
  let actualError: string | undefined
  let updateCount = 0
  try {
    updateCount = buildWallParallelAlignmentUpdates(
      fixture.graph.nodes as any,
      testCase.selectedWallId,
    ).length
  } catch (error) {
    actualError = error instanceof WallOperationError ? error.code : String(error)
  }
  const after = JSON.stringify(fixture.graph.nodes)
  return {
    id: testCase.id,
    selectedWallId: testCase.selectedWallId,
    expectedError: testCase.expectedError,
    actualError,
    updateCount,
    graphUnchanged: before === after,
    passed: actualError === testCase.expectedError && before === after,
  }
})

const result = {
  status: results.every((entry) => entry.passed) ? 'PASS' : 'FAIL',
  fixturePath,
  nodeCount: Object.keys(fixture.graph.nodes).length,
  caseCount: results.length,
  results,
}
writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify(result))
if (result.status !== 'PASS') process.exitCode = 1

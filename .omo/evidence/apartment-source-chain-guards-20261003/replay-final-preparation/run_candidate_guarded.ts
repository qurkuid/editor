#!/usr/bin/env bun
/**
 * Explicit Lane B candidate gate.
 *
 * Preparation commands never call this file.  It refuses to execute unless
 * the caller supplies --execute-candidate, an explicit --source-freeze, a
 * run id, and all three source-copy paths.  The evaluator writes only under
 * replay-final-preparation/ and still performs the source/hash guard itself.
 */
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'

const REPO = resolve(import.meta.dir, '../../../..')
const ROOT = join(REPO, '.omo/evidence/apartment-source-chain-guards-20261003/replay-final-preparation')
const args = Bun.argv.slice(2)
const has = (name: string) => args.includes(name)
const value = (name: string) => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] ?? '' : ''
}

if (!has('--execute-candidate')) {
  console.error(JSON.stringify({ status: 'BLOCKED_PREPARATION_ONLY', candidateRunExecuted: false, reason: 'Pass --execute-candidate only after parent supplies and verifies the final B source freeze.' }))
  process.exit(2)
}

const required = ['--run-id', '--source-freeze', '--core-source', '--room-boundary-source', '--importer-source']
for (const name of required) {
  if (!value(name)) throw new Error(`candidate execution requires explicit ${name}`)
}
for (const name of ['--source-freeze', '--core-source', '--room-boundary-source', '--importer-source']) {
  const path = resolve(REPO, value(name))
  if (!existsSync(path)) throw new Error(`missing explicit ${name}: ${path}`)
}

const runId = value('--run-id')
const manifest = value('--manifest') || join(ROOT, 'preparation-manifest-lane-b-final-frozen-core-baseline-measured.json')
const guardOutput = value('--guard-output') || join(ROOT, `guard-${runId}.json`)
const verifier = join(ROOT, 'verify_final_preparation.py')
const preflight = Bun.spawnSync({
  cmd: ['python3', verifier, '--phase', 'candidate', '--manifest', manifest, '--source-freeze', value('--source-freeze'), '--output', guardOutput],
  cwd: REPO,
  stdout: 'pipe',
  stderr: 'pipe',
})
if (preflight.exitCode !== 0) {
  console.error(new TextDecoder().decode(preflight.stderr) || new TextDecoder().decode(preflight.stdout))
  process.exit(preflight.exitCode || 1)
}

const evaluator = join(ROOT, 'evaluate_candidate.ts')
const forwarded = args.filter((arg) => arg !== '--execute-candidate')
const run = Bun.spawnSync({ cmd: ['bun', evaluator, ...forwarded], cwd: REPO, stdout: 'inherit', stderr: 'inherit' })
process.exit(run.exitCode)

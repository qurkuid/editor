# Manual boundary repair discovery

Scope: bounded read-only source discovery while approved plan is pending. No implementation claim.

## Direct observations
- `floorplan-zone-closure-layer.tsx`: marker click selects wall and site panel; pointer down/up only stop propagation. Existing focus-visible SVG ring remains required.
- `nodes/src/wall/floorplan.ts`: selected wall exposes move-endpoint start/end affordances.
- `nodes/src/wall/floorplan-affordances.ts`: previews use live overrides; canCommit checks only primary minimum segment length; commit writes primary/linked endpoints and resolves a target split.
- `floorplan-registry-layer.tsx` lines 1240–1580: local generic drag dispatcher owns scope, snapshots, pointer lifecycle and history; `tools/shared/affordance-dispatch.ts` only resolves lazy 3D tools.
- `room-boundary.ts`: automatic repair requires new space and <=0.35 m candidate; these constraints must remain automatic-only.
- `wall-operations.ts` buildWallEndpointUpdates: validates finite geometry, reversal, curves, hosted child span and detached T contacts, returns child rebasing patches.
- `zone-closure-panel.tsx`: automatic action already replans current nodes and rejects read-only state.

## Captured artifacts
- Scenario: dirty baseline preservation. Invocation: `git status --short`. Observable: existing tracked/untracked paths captured before source changes. Artifact: `discovery-status.txt`.
- Scenario: existing local server. Invocation: `curl -s -o /dev/null -w 'HTTP %{http_code}\n' http://localhost:3002`. Observable: HTTP 307. Artifact: `discovery-server.txt`.
- Scenario: active attempt status discovery. Invocation: `omo-agent-toolkit ulw-loop status --json`. Observable: command failed because configured plugin runtime is missing. Artifact: `attempt-status.txt`. Parent instructed no further runtime invocation.

Concerns sent to parent and planner: manual operation must validate complete explicit endpoint/corner proposal; generic endpoint drag cannot be reused blindly; avoid new core editor concepts and package cycle.

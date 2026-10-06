# Apartment Viewer Init Recovery — 2026-10-03

## Status and ownership

- **Planning lane:** `gpt-5.6-sol`, reasoning `high`.
- **Implementation lane:** `luna-max` only after this contract is accepted.
- **Scope:** `packages/viewer` renderer initialization and its focused tests. No `apps/editor` import, scene/modeling mutation, apartment importer change, source-chain change, schema change, or modeling-manual update.
- **Stop condition:** the blank 300×150 canvas can no longer wait forever. The first runtime branch that actually renders the apartment ends the recovery work. A visible timeout card is valid failure recovery, but it is **not** evidence that 3D apartment geometry rendered.

## Current evidence and bounded diagnosis

The fresh Lane A scene `2880f77b1dbc` was in 3D / full-height mode with a visible 2664×1418 parent, while the R3F canvas stayed at its 300×150 default:

- `.omo/evidence/apartment-next-residual-improvement-20261003/lane-a/browser/fresh-2880-3d-prereload-up.json`
- `.omo/evidence/apartment-next-residual-improvement-20261003/lane-a/browser/fresh-2880-3d-postreload-up.json`
- `.omo/evidence/apartment-next-residual-improvement-20261003/lane-a/browser/fresh-2880-3d-reload-comparison.json`

The pre-reload capture was taken about 34 seconds after navigation and contains neither `[viewer] WebGPU device ready` nor `[viewer] WebGPURenderer init failed`. `packages/viewer/src/components/viewer/index.tsx` awaits `renderer.init()` without a deadline; the catch, cache eviction, failure card, R3F size application, and `GPUDeviceWatcher` all occur only after that promise settles. This is sufficient to classify an **unbounded renderer initialization wait**. It does not identify a browser, driver, WebGPU, scene, or geometry root cause.

The change belongs in `packages/viewer`: `wiki/architecture/viewer-isolation.md` requires the viewer to remain host-agnostic, and no node renderer/system or editor workflow needs to change.

## Exact file contract

1. `packages/viewer/src/lib/renderer-init.ts` — new internal pure lifecycle helper.
2. `packages/viewer/src/lib/renderer-init.test.ts` — fail-first timer and late-settlement regressions.
3. `packages/viewer/src/components/viewer/index.tsx` — use the helper, preserve per-canvas promise sharing, show an accurate failure state, and conditionally mount a fresh WebGL retry.

Do not export the helper from the public viewer barrel. Do not change `post-processing.tsx`; when the optional forced-WebGL branch is active, pass `disablePostFx || rendererBackend === 'webgl'` from `index.tsx` because the current post-processing capability check uses `navigator.gpu`, which does not describe a deliberately forced WebGL backend.

## Phase 1 — mandatory bounded initialization

### Lifecycle helper

Add one small helper that accepts a renderer-like object with `init(): Promise<void>` and `dispose(): void`, plus an injectable timeout duration/scheduler for deterministic tests. Its production deadline is **10,000 ms**.

The helper must:

- resolve with the same renderer only when `init()` fulfills before the deadline;
- preserve an initialization rejection that arrives before the deadline;
- reject with a distinct `RendererInitTimeoutError` when the deadline wins;
- clear the timer on every early settlement;
- keep observing the original, non-abortable `init()` promise after timeout;
- dispose that renderer exactly once if the original promise later fulfills or rejects, without resolving/rejecting the already-settled bounded promise again;
- report a disposal failure with a warning while keeping the original timeout/init error visible; it must not swallow or replace the primary failure.

Do not use `Promise.race()` alone: it would leave the late renderer alive and would not define late rejection handling. Do not claim that `renderer.init()` was cancelled.

### Cache and React integration

Keep `WEBGPU_RENDERER_CACHE` as one in-flight promise per DOM canvas so StrictMode/R3F duplicate `configure()` calls still share one renderer. Store the **bounded** attempt promise. On failure, remove the cache entry only when it still equals that exact attempt; a late result from an old attempt must never evict a newer entry.

Classify the visible state as `unsupported`, `init-timeout`, or `init-error` instead of one boolean:

- `unsupported`: retain the existing WebGPU/WebGL capability wording;
- `init-timeout` / `init-error`: say that the 3D renderer did not start and expose a retry only under the Phase 2 gate below;
- all failure states keep the existing `onSceneReadyChange(true)` behavior so the host loader does not conceal the card.

Log one structured initialization failure containing the backend attempt (`webgpu` or `webgl`) and whether it timed out. A late settlement may log cleanup, but must not emit a ready signal, remount the old canvas, or change the current failure/retry state.

### Fail-first focused tests

The new helper tests must prove:

1. an unresolved `init()` rejects at 10,000 ms with `RendererInitTimeoutError`;
2. success before the deadline returns the original renderer, clears the timer, and never disposes it;
3. rejection before the deadline preserves the original error rather than relabeling it timeout;
4. fulfillment after timeout disposes exactly once and cannot turn the failed attempt into success;
5. rejection after timeout is observed, disposes exactly once, and creates no unhandled rejection;
6. disposal failure preserves the timeout/init failure and is separately observable.

Keep the per-canvas get-or-create/cache-eviction seam in the new helper and cover it from `renderer-init.test.ts`: duplicate configuration for one canvas must return the same promise, while an old timed-out attempt cannot remove or satisfy a later attempt. Do not render the full Three/R3F tree just to test this lifecycle.

## Phase 2 — conditional explicit WebGL retry

Implement this phase only if the fresh production-browser Phase 1 run reaches `init-timeout`/`init-error`, `canCreateWebGLContext()` is true, and 3D geometry has not rendered. If WebGPU initializes and the apartment visibly renders under Phase 1, stop and do not add this branch.

The failure card may then offer one explicit action, **“Retry with WebGL”**. The action must:

- require a successful existing `canCreateWebGLContext()` check;
- never run automatically;
- switch the next `THREE.WebGPURenderer` construction to `{ forceWebGL: true }`, a capability already supplied by the installed Three version;
- increment a render-attempt key so React unmounts the failed canvas and mounts a new DOM canvas;
- leave the old WebGPU attempt bound to its old canvas and late-disposal handler;
- run the same 10-second deadline and failure card on the WebGL attempt;
- force direct rendering with `disablePostFx || rendererBackend === 'webgl'`; `post-processing.tsx` currently treats the mere presence of `navigator.gpu` as WebGPU capability, so allowing its WebGPU-only pipeline on a forced-WebGL backend is unsafe;
- preserve all Viewer props, children, camera behavior, scene graph, selection, and presentation state.

No same-canvas retry is allowed. No delayed WebGPU result may replace the fresh WebGL renderer. Do not add an automatic WebGL fallback loop, query parameter, app-level retry, GPU-vendor heuristic, or second renderer implementation.

Add focused regressions proving primary options omit `forceWebGL`, the explicit retry includes it, retry increments the canvas-attempt identity, forced WebGL disables post-processing, and a late primary settlement only disposes the primary renderer.

## Verification sequence

Run against the final adopted branch only:

1. `bun test packages/viewer/src/lib/renderer-init.test.ts`.
2. `bun run --cwd packages/viewer build`.
3. `bun run --cwd apps/editor check-types`.
4. `bunx biome check` on the three changed viewer files.
5. `bun run --cwd apps/editor build` so the QA runtime is bound to the Viewer source change.

Then use a new owned production build/port and the saved p42 scene; do not restart or mutate the user-managed server. Record source hashes, build identity, navigation time, console, canvas identity/size, screenshots, and scene graph before/after.

### Browser gate A — primary attempt

Wait at least the 10-second deadline plus 3 seconds.

- **Rendered:** the canvas is resized from 300×150 to the visible parent/DPR size, a renderer/backend-ready log exists, walls/slabs/ceilings are visibly present in an inspected screenshot, and orbit or view-mode interaction produces a corresponding visible change. This completes Lane C; omit Phase 2.
- **Failed visibly:** the canvas is replaced by the accurate initialization failure card within the bound, the editor shell is usable, and no old renderer later reports ready. This proves hang recovery but does not complete the 3D geometry gate; proceed to Phase 2 only when WebGL capability is present.

### Browser gate B — explicit fresh WebGL attempt, only if adopted

- Capture the old canvas identity, click “Retry with WebGL” once, and prove a different canvas element was mounted.
- Prove the backend is the WebGL fallback and post-processing is disabled for that attempt.
- Require canvas dimensions to track the visible parent rather than remain 300×150.
- Inspect a full-height 3D screenshot showing the saved apartment walls, openings, slabs, and ceilings; change the camera or wall-height control and confirm the rendered image changes.
- Confirm the 2D scene and graph IDs/counts are unchanged, save/reload preserves the graph, and no late WebGPU ready event or uncaptured renderer error appears.

If the explicit WebGL attempt also fails, retain the visible card and report 3D runtime validation as unresolved. Do not weaken the gate or infer rendered geometry from graph counts, AX state, canvas existence, readiness callbacks, or absence of console errors.

## Acceptance and non-goals

Accepted only when:

- no renderer attempt can leave an indefinitely blank 300×150 canvas;
- timer, cache, and late-disposal tests pass;
- failure wording matches capability failure versus initialization failure;
- any retry uses a fresh canvas and cannot race with the old attempt;
- the final production build is hash-bound to the Viewer change;
- actual 3D geometry is claimed only after a visible rendered-browser gate passes.

This lane does not diagnose GPU hardware, alter apartment geometry, change import/topology logic, modify the modeling manual, add dependencies, or touch Lane A/B owned files. Lane B can continue its focused importer tests, but its final browser QA/build must be rerun against the final Viewer source if Phase 1 or Phase 2 is adopted.

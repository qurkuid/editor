# Zone finish improvements — approved implementation contract

**Status:** APPROVED for implementation  
**Scope:** four linked improvements only: stable 3D Canvas, visible real wall finishes, manual-Zone partial-wall finishes, server-persisted/shared finish templates, and complete browser QA.  
**Source baseline:** preserve every existing dirty change. This plan is the only artifact written by the planning lane.

## Outcome and non-negotiable boundaries

1. The editor must render a live 3D scene after initial load, hard reload, view/preview remount, and route return. The known `events.connect(...null)` Canvas race is fixed by the upstream React Three Fiber release, not by a local null guard or custom `eventSource` workaround.
2. Normal finish view, thumbnails, and Zone material operations must show the real wall surface materials from `WallNode.slots` and partial `finishRegions`. Construction layers remain available in selected `layers`/`frame` modes and in model exports.
3. A manual Zone may own only part of one physical wall face. Applying or templating that Zone changes the normalized interval on the inward face and preserves the rest of the wall, the opposite face, openings, vertical bands, construction, UV scale, and wall identity.
4. Zone/home finish templates are persisted in the existing server SQLite database. A verified INTM user may keep a template private or share it with the verified company. Local development has one explicit loopback-only `localhost` scope shared across browser profiles. Request bodies never choose `ownerId` or `companyId`.
5. Do not kill or manually restart the existing supervised `localhost:3002` runtime. Its stable supervisor parent and responsive port are the continuity evidence; a Next.js config watcher may legitimately replace the listener child PID. Dependency-runtime proof uses a second server on a discovered free port, while port 3002 remains available for comparison and current-flow QA.
   Any custom `PASCAL_NEXT_DIST_DIR` used by that isolated runtime must match the app-local `/.next*/` ignore rule before startup. This prevents Tailwind's automatic plain-text source scanner from ingesting Turbopack `.sst` cache bytes and generating invalid arbitrary-selector CSS; do not alter the valid source selector to mask generated-cache contamination.
6. Keep package boundaries: pure persisted semantics in core; Three.js tessellation/material assignment in viewer; node rendering in nodes; Zone workflow and UI in editor/app; server persistence in MCP storage plus app API routes. Do not move partial-wall behavior into the paint tool or split one Wall into multiple Wall nodes.

## Evidence behind the contract

- The shared Viewer creates an async WebGPU renderer in [`packages/viewer/src/components/viewer/index.tsx`](/Users/changseok/editor/packages/viewer/src/components/viewer/index.tsx:539). Baseline R3F 9.6.1 awaits configuration and can later connect events to an already-unmounted wrapper. The official [R3F 9.8.0 changelog](https://github.com/pmndrs/react-three-fiber/blob/master/packages/fiber/CHANGELOG.md#980) names the exact `Cannot read properties of null (reading 'addEventListener')` failure and fixes stale async Canvas roots; 9.8.1 is the selected patch release for this change.
- The frozen baseline requested `^9.5.0` in [`apps/editor/package.json`](/Users/changseok/editor/apps/editor/package.json:27) and [`apps/ifc-converter/package.json`](/Users/changseok/editor/apps/ifc-converter/package.json:23), while [`bun.lock`](/Users/changseok/editor/bun.lock:830) resolved 9.6.1. The approved dependency lane has already changed those three dirty working-tree files to `^9.8.1`/9.8.1; retain that exact narrow diff and do not overwrite unrelated edits.
- The wall body already goes through opening CSG, post-CSG triangle splitting, material-group assignment, and final world-space UV projection. The reusable seam is [`wall-system.tsx`](/Users/changseok/editor/packages/viewer/src/systems/wall/wall-system.tsx:403), with the post-cutout calls at lines 1111–1166 and UV projection at lines 807–855. Material groups alone cannot represent an interval when a triangle crosses its boundary; extending the existing post-CSG splitter can.
- Normal constructed walls are currently wrong because [`packages/nodes/src/wall/renderer.tsx`](/Users/changseok/editor/packages/nodes/src/wall/renderer.tsx:95) makes the slot-aware base mesh fully transparent whenever any construction exists. [`construction-preview.tsx`](/Users/changseok/editor/packages/nodes/src/wall/construction-preview.tsx:79) builds assembly meshes and resolves finish layers from the interior slot only. Showing both models would z-fight, so presentation state must select exactly one.
- Manual Zone matching already calculates overlap data in [`packages/editor/src/lib/zone-finish.ts`](/Users/changseok/editor/packages/editor/src/lib/zone-finish.ts:480), but lines 630–637 reject every partial claim and lines 684–693 reject more than one claim per wall face. That is the domain gate to replace after the persisted range model exists.
- The existing browser store is localStorage-backed at [`apps/editor/lib/finish-template-store.ts`](/Users/changseok/editor/apps/editor/lib/finish-template-store.ts:152). The actual server factory is SQLite-only at [`packages/mcp/src/storage/index.ts`](/Users/changseok/editor/packages/mcp/src/storage/index.ts:14). INTM identity is already resolved by forwarding the session cookie in [`apps/editor/lib/intm-session.ts`](/Users/changseok/editor/apps/editor/lib/intm-session.ts:70); the presence-only API guard at [`scene-api-security.ts`](/Users/changseok/editor/apps/editor/lib/scene-api-security.ts:80) is insufficient as an ownership decision.

## 1. Stable Canvas and correct wall presentation

### Dependency repair

Change only these dependency declarations and the generated lockfile:

- `apps/editor/package.json`: `@react-three/fiber` → `^9.8.1`.
- `apps/ifc-converter/package.json`: the same direct version so one lockfile cannot resolve an older app-specific copy.
- Regenerate `bun.lock` with Bun and confirm the resolved entry is 9.8.1 or newer within major 9.
- Leave package peer ranges such as `"@react-three/fiber": "^9"` unchanged. Do not add a dependency override, Canvas remount key, `eventSource`, retry timer, or null-catching wrapper.

Run dependency installation only when ready for the isolated runtime verification. Do not signal, kill, or replace the process on port 3002. Before starting a second editor server, change the app-local Next output ignore from `/.next/` to `/.next*/`, confirm both the default and custom output directories are ignored, and use a clean custom output directory with `PASCAL_NEXT_DIST_DIR=<custom-dir> PORT=<free-port> bun run --cwd apps/editor dev`. If an owned custom directory is already contaminated, stop only its isolated server and recreate only that custom directory; never remove the port-3002 runtime's `.next`. Shut down only the new isolated process after evidence is captured.

### Wall presentation state

Keep `WallConstructionModel` mounted so its assembly geometry stays current, but make its visibility mutually exclusive with the slot-aware wall body:

| Situation | Base wall mesh | Construction model |
|---|---:|---:|
| normal/unselected finish | visible | hidden |
| selected + `finish` | visible | hidden |
| selected + `layers` or `frame` | hidden | visible in requested mode |
| thumbnail/screenshot capture | visible | hidden |
| GLB/STL/OBJ model export while `useViewer.isExporting` is true | hidden | visible with all currently exportable finish/assembly layers |

Implement that state in [`packages/nodes/src/wall/renderer.tsx`](/Users/changseok/editor/packages/nodes/src/wall/renderer.tsx:46) and [`packages/nodes/src/wall/construction-preview.tsx`](/Users/changseok/editor/packages/nodes/src/wall/construction-preview.tsx:41). Reuse `useViewer.isExporting`; during `thumbnail:before-capture`, construction is exposed only when exporting is already true. This keeps thumbnail materials correct and preserves the existing model-export contract in [`construction-preview.test.tsx`](/Users/changseok/editor/packages/nodes/src/wall/construction-preview.test.tsx:23). Construction finish layers must resolve their semantic side from the signed center of the physically positioned strip after any overlay core offset is applied, so an overlay stack wholly on one side cannot be misclassified by the unshifted layer-span center. With face bands disabled, resolve that semantic side through the whole-side `interior`/`exterior` slot; with bands enabled, resolve its band slot. Do not remove configured construction layers, cavity semantics, or assembly geometry.

Partial `finishRegions` remain a normal-view and thumbnail capability in this delivery. Construction assembly CSG currently clears the host geometry's material groups and has no wall-station material plan, so model export of partial region finishes remains unsupported and is outside the requested Zone UI/template scope. Do not claim partial-region assembly export support or add overlay/topology machinery for it; preserve the existing full assembly export and verify distinct whole-side finish refs with a two-sided sentinel test.

Tests must prove all five rows of the table and prove only one exterior envelope is color-rendered at a time. Add a constructed wall with different interior/exterior textured refs so an interior-only fallback cannot pass unnoticed.

## 2. Manual Zone partial-wall finish domain

### Persisted Wall schema

Add one optional field to `WallNode` in [`packages/core/src/schema/nodes/wall.ts`](/Users/changseok/editor/packages/core/src/schema/nodes/wall.ts:168):

```ts
type WallFinishRegion = {
  id: string
  side: 'interior' | 'exterior'
  start: number // normalized authored wall path, inclusive, 0..1
  end: number   // normalized authored wall path, exclusive except 1, 0..1
  slots: Partial<Record<WallSurfaceSlotId, MaterialRef>>
}

type WallNode = {
  // existing fields...
  finishRegions?: WallFinishRegion[]
}
```

Schema and normalization invariants:

- `id` is stable across material changes; the Zone workflow mints it once and reuses it when the same side/range is updated.
- Require finite `0 <= start < end <= 1`; snap values within the existing endpoint tolerance to 0 or 1.
- `side` is semantic, independent of `front`/`back` winding. `slots` accepts only roles that resolve to that side; it stores normal `library:`/`scene:` material refs.
- Canonically sort by `side`, `start`, `end`, `id`. Overlap on the same `(side, slot role)` is invalid. Touching ranges may remain distinct; exact same-material neighbors may be merged only when no stable template target refers to both.
- Outside a region, and for roles omitted by a region, rendering falls back to existing `wall.slots` and current band fallback rules. Scenes without `finishRegions` parse and render unchanged.
- Add pure helpers in core for normalization, overlap validation, semantic role lookup, and normalized ratio on a straight wall path. Reuse an existing canonical core curve-path helper only if one already provides the required projection and monotonicity guarantees; do not add an approximate curve projection to satisfy this feature. Core must not import Three.js.

This is appearance metadata on one real Wall. It does not alter `start`, `end`, `curveOffset`, mitering, children, cutouts, construction, or hosting.

### Zone boundary resolution and atomic apply

Replace the partial-claim rejection in [`packages/editor/src/lib/zone-finish.ts`](/Users/changseok/editor/packages/editor/src/lib/zone-finish.ts:562) with interval-aware faces:

```ts
type ZoneFinishWallFace = {
  wallId: WallNode['id']
  face: 'front' | 'back'
  side: 'interior' | 'exterior'
  start: number
  end: number
  roles: WallSurfaceSlotId[]
  segmentSignature: string
}
```

- Convert each manual boundary overlap to the wall's own normalized authored direction, including reversed wall direction. Determine inward semantic side from a probe inside the Zone against the wall/curve frame; never reuse polygon edge winding as if it were wall winding.
- Auto detected-space `boundaryFaces` also carry normalized start/end. A full boundary remains `[0,1]`; a detected partial boundary uses the same region path, so auto and manual Zones obey one apply model.
- Resolve manual polygon edges independently. An edge with no qualifying physical wall candidate is an open/non-wall boundary and contributes no face, regardless of candidates found on earlier edges; remove the cross-edge `attempted` gate. Do not require accepted wall intervals to cover the full polygon edge or fill gaps with virtual walls.
- Keep every qualifying existing wall face, including different physical wall nodes whose projected intervals overlap. Ambiguity is checked after normalization only when the same `(wallId, face)` is claimed by overlapping Zone subsegments. If the entire Zone resolves to zero physical wall faces, block the wall row with a specific no-physical-wall reason instead of reporting a successful empty target.
- Straight walls are the required manual-Zone path for this delivery. Curved walls use the same normalized contract only when an existing canonical path helper can prove a continuous monotone interval within tolerance. Otherwise inspection fails closed with a specific `curved-wall-partial-finish-unsupported` reason and mutation/history 0; do not infer a curve interval from chord projection. Ambiguous, discontinuous, self-overlapping, and off-wall boundaries also fail closed.
- Multiple non-overlapping claims on the same face are valid. Overlapping claims with different materials/Zone ownership block during preflight; never resolve by last-write-wins.
- Applying a partial face updates or creates one `finishRegion`, preserving all other ranges, the opposite side, inactive band slots, and whole-wall fallback slots. Applying a full `[0,1]` face writes the normal whole-face slots and removes only redundant regions on that same side/roles after preflight proves no other Zone claim would be lost.
- Material registration plus every region/slot patch remains one `runAsSingleSceneHistoryStep()` transaction. Any stale scene token, changed range fingerprint, overlap conflict, invalid ref, or missing wall produces zero scene mutations and zero history entries.
- Replace user copy `벽을 분할한 뒤 다시 적용` with a precise blocked-boundary message only for truly ambiguous geometry. The actual manual `현관`, `거실`, and `안방` partial/shared walls must become ready.

Read-only proof against server scene `zone-improvements-span-20261001-231520` is the regression fixture for this resolver: `현관` resolves four existing wall faces, `거실` resolves ten, and its three `안방` Zones resolve five each. Candidate-less jog/open edges remain absent, not synthesized. Tests must also retain reversed-wall face flipping and reject an overlapping duplicate claim only when it targets the same normalized wall face.

Extend the existing version-1 wall fingerprint with optional `side`, `start`, and `end` fields. New captures write all three. The shared full-range helper interprets an older fingerprint with omitted range as `[0,1]` and resolves its semantic side from the stored face/current wall mapping. Keep the portable Zone/home payload version at `1`, preserve the existing `source.sceneId`/`sourceSceneId`, and avoid a second payload version or compatibility shim. Legacy local records are read only by the explicit import action and are never silently rewritten in localStorage.

### Preserve regions through existing wall operations

Put the remapping helpers beside the canonical mutation builders in [`packages/core/src/lib/wall-operations.ts`](/Users/changseok/editor/packages/core/src/lib/wall-operations.ts:714); the store wrappers at [`wall-actions.ts`](/Users/changseok/editor/packages/core/src/store/actions/wall-actions.ts:22) must remain thin.

- For `buildWallSplit` at normalized split `s`, intersect every source region `[a,b]` with `[0,s]` and `[s,1]`. Remap the first intersection to `[a/s,min(b,s)/s]` and the second to `[(max(a,s)-s)/(1-s),(b-s)/(1-s)]`, clamp with the schema epsilon, and drop only zero-width fragments. A fragment containing the source region's authored start keeps its id; a second fragment created by a crossing receives a fresh region id. Preserve `side`, `slots`, and all material refs.
- `buildWallSplitAtContacts` already calls `buildWallSplit` on snapshots at [`wall-operations.ts`](/Users/changseok/editor/packages/core/src/lib/wall-operations.ts:918), so it must obtain exactly the same behavior without a second implementation. A failed later contact still returns no partial mutation.
- For explicit `buildWallMerge`, remap each aligned source segment into the merged wall by cumulative physical length, then canonicalize and validate all regions before mutating nodes. Do not add `finishRegions` to the exact style-equality keys, because valid adjacent ranges differ by design. If a chain segment would be reversed and it has regions, fail before mutation with `reversed-finish-regions`; the existing merge already fails closed for direction-sensitive painted/hosted walls at lines 692–709. If mapped regions have any positive-width overlap on the same semantic side and role, fail with `finish-region-conflict`; touching endpoints remain valid. Preserve ids unless two source walls reused one local id, in which case mint one fresh id deterministically during the plan.
- The deletion cleanup path has its own automatic merge planner in [`node-actions.ts`](/Users/changseok/editor/packages/core/src/store/actions/node-actions.ts:619). When either surviving candidate has `finishRegions`, skip that optional auto-merge and keep both candidates unchanged; deleting the requested intermediary node may proceed. It must never spread the primary wall's regions over the secondary or discard the secondary's regions.
- Focused mutation tests cover a split before/inside/after a region, a crossing split, descending multi-contact splits, aligned multi-wall merge, reversed-region merge rejection, conflicting-overlap rejection with byte-equivalent nodes/history, and deletion cleanup preserving two region-bearing neighbors. Existing attachment, parent, collection, and child-hosting assertions remain in the same fixtures.

### Reuse the existing wall geometry pipeline

Implement interval rendering in [`packages/viewer/src/systems/wall/wall-system.tsx`](/Users/changseok/editor/packages/viewer/src/systems/wall/wall-system.tsx:243), after CSG and before material-group assignment:

1. Generalize `splitGeometryAtHorizontalPlanes` into a triangle-polygon splitter that accepts signed half-plane classifiers.
2. Keep current Y planes for vertical bands. Add wall-station planes for every unique `finishRegions.start/end` that lies strictly inside `(0,1)`. A station plane passes through `getWallCurveFrameAt(wall,t).point` and is normal to that frame's tangent, transformed into the wall mesh's local frame.
3. Run these splits on the post-opening-CSG geometry at the existing lines 1111–1166. The operation subdivides existing surface triangles only; it creates no new cap surface. Therefore door/window holes remain holes.
4. Recompute normals, run material-group assignment, and keep the existing final world-planar UV projection at lines 807–855. Textures must remain one metre world scale with no seam or stretch at a region boundary.
5. During group assignment, classify only front/back surface triangles. Resolve centroid path ratio and active vertical band role, then select the matching region slot; caps and thickness edges retain material index 0.

In [`packages/viewer/src/systems/wall/wall-materials.ts`](/Users/changseok/editor/packages/viewer/src/systems/wall/wall-materials.ts:409), extend the deterministic fixed 0–10 wall material plan with canonical region entries. The geometry system and renderer must consume the same pure index plan. Include region refs and referenced scene-material content in `materialHash`; append matching visible, invisible, translucent, delete, and selection variants so cutaway/selection modes keep index parity. A dangling region ref falls back to the underlying semantic slot, matching existing dangling-ref behavior.

Do not create overlay meshes, duplicate wall envelopes, Zone-layer finish surfaces, or new Wall nodes. Do not convert `finishRegions` into paint-tool state. Existing paint remains a whole-face operation: if a paint hit lands on a region material index, resolve its semantic side and band role; on commit, update that whole-face base slot and remove that role from every region on the clicked semantic side in the same node patch, deleting a region only when no roles remain. This guarantees the clicked face visibly changes while preserving other roles, ranges, and the opposite side. Preview and commit must use the same resolver, and Undo restores both the base slot and removed overrides atomically.

Required geometry tests:

- straight wall ranges `[0,.35]` and `[.35,1]` render different materials with no unassigned triangle;
- reversed endpoints select the same physical Zone span and correct inward side;
- a curved manual boundary either uses the existing canonical continuous-path helper or returns the exact fail-closed unsupported result with zero mutation;
- a door and a window crossing a region boundary remain open after splitting;
- four vertical bands × two horizontal regions choose the correct role/ref combination;
- opposite face, caps, construction, UV/UV2 presence, world-scale texture coordinates, collision mesh, and node count remain unchanged;
- no z-fighting duplicate surface is created.

Update [`packages/mcp/src/modeling-agent-manual.ts`](/Users/changseok/editor/packages/mcp/src/modeling-agent-manual.ts:1) and its ontology test because the Wall material capability and Zone apply rules change.

## 3. Server template library and sharing

### Shared schema and client transition

Extract the strict, server-safe Zod payload schemas from [`apps/editor/lib/finish-template-store.ts`](/Users/changseok/editor/apps/editor/lib/finish-template-store.ts:9) into `apps/editor/lib/finish-template-schema.ts`. It must contain no React, Zustand, browser, or server imports. Validate complete version-1 Zone/home snapshots with optional range fields, reject transient `blob:` texture URLs and unknown fields, and expose the shared full-range reader for older snapshots.

Convert `finish-template-store.ts` from persisted authority to client query/cache state:

- load lists from the server;
- track each template as `server`, `pending-local-import`, `saving`, or `failed`;
- retain an unsaved template and its retry action after a network/API failure;
- retain a legacy local copy after confirmed import, record its server id/status, and deduplicate later import attempts against that confirmed mapping;
- never treat localStorage as evidence that a server template exists.

Expose an explicit `로컬 템플릿 가져오기` action when valid `pascal-finish-templates-v1` data exists. There is no automatic upload, merge, rewrite, or deletion. A confirmed imported copy remains locally visible as legacy/imported provenance and cannot create a duplicate server row on retry.

### SQLite storage

Use the existing `PASCAL_DB_PATH`/`PASCAL_DATA_DIR` database and migration style in [`packages/mcp/src/storage/sqlite-scene-store.ts`](/Users/changseok/editor/packages/mcp/src/storage/sqlite-scene-store.ts:780). Add an opaque-JSON finish-template table and typed store methods; do not add Supabase, multi-host replication, a provider interface, or a second database.

```sql
CREATE TABLE IF NOT EXISTS finish_templates (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('zone','home')),
  name TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('private','company')),
  owner_id TEXT NOT NULL,
  company_id TEXT,
  version INTEGER NOT NULL CHECK (version >= 1),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Add indices for `(owner_id, updated_at)` and `(company_id, visibility, updated_at)`. Storage owns CRUD, list filters, timestamps, JSON byte size, and compare-and-swap `version`; the app owns payload validation and authorization. Return metadata plus parsed payload. Mutations use `expectedVersion` and raise the existing-style `version_conflict`/`not_found` errors.

### Principal and authorization

Add `resolveFinishTemplatePrincipal(request)` beside the existing auth helpers:

- first run `guardSceneApiRequest(request, { skipAuth: true })` so origin and rate limits still apply but a cookie's mere presence is not accepted as identity;
- when INTM auth is enabled, call `fetchIntmUser(cookie)` and require a non-empty verified `user.id`; retain a verified non-empty `user.companyId` when present, but allow a company-less principal to use private templates;
- when INTM auth is disabled, allow only an actual loopback host in non-production and resolve the fixed principal `{ userId: 'local', companyId: 'localhost' }`;
- scene API bearer tokens do not establish template ownership; production without a verified INTM principal is denied;
- ignore/reject client-supplied `ownerId` and `companyId` everywhere.

Authorization rules:

- `private`: readable and mutable only by `owner_id`.
- `company`: create/list/read/apply requires a verified non-empty company id and is blocked when it is missing; callers in that company may read/apply, while only `owner_id` may mutate, rename, change visibility, or delete.
- A same-company peer receives a read-only template and may apply its payload to an editable scene. Cross-company and unauthenticated callers receive no row disclosure.
- Local loopback profiles share the fixed localhost company scope; this is explicitly a development behavior, not a production tenant model.

### API surface

Add force-dynamic routes using `sceneApiJson`/CORS headers and a template-specific 2 MiB expanded-body limit:

- `GET /api/finish-templates?scope=mine|company&kind=zone|home&limit=N`
- `POST /api/finish-templates` with only `{kind,visibility,template}`; the validated template already owns its id, name, timestamps, source-scene metadata, and payload version
- `GET /api/finish-templates/[id]`
- `PATCH /api/finish-templates/[id]` for existing rename/visibility operations, with `If-Match`
- `DELETE /api/finish-templates/[id]` with `If-Match`

`PATCH` accepts only owner-controlled `{visibility?,template?}` with immutable kind and uses the template's validated name for rename. Return `ETag: "<version>"`; stale mutations return 409 plus `currentVersion`. POST returns 201 and `Location`. Invalid payload/scope is 400, unauthorized is 401, missing-company or forbidden owner mutation is 403, missing/non-visible is 404, too large is 413. Parse and validate before writing; malformed JSON and storage failures never create partial rows.

### Minimal UI

Keep the existing inspector template controls in [`apps/editor/components/zone-finish-panel.tsx`](/Users/changseok/editor/apps/editor/components/zone-finish-panel.tsx:1):

- save dialog adds `나만 보기` / `회사 공유` choice;
- template list shows source/status and a retry action for failed saves/imports;
- company peer templates are visibly read-only but retain `적용`;
- current rename/remove controls call owner-authorized server endpoints with the loaded version;
- while `useViewer.textures` is false, show one compact notice `단색 표시 중 · 자재 색상 보기`; its action calls the existing `useViewer.getState().setTextures(true)`. Applying a material must not silently force the user's appearance setting.
- no new management page, tenant switcher, collaboration system, or expanded admin tour.

## 4. Execution order and gates

Implement in this order so each layer has a testable dependency:

1. **Canvas dependency + wall presentation:** manifest/lock update; mutually exclusive finish/construction presentation; focused tests. Keep port 3002 untouched.
2. **Core region contract:** schema, normalization/path helpers, serialization and invalid-overlap tests.
3. **Viewer region rendering:** post-CSG station splitting, deterministic region material indices, wall-mode variants, geometry tests.
4. **Zone workflow:** range-aware inspection/apply/capture/mapping, version-1 optional range fields, single Undo, manual snapshot fixtures.
5. **Server library:** shared schemas, SQLite methods/table, verified principal, API route tests.
6. **UI/cache migration:** privacy selector, server lists, explicit local import, status/retry, owner-only mutations.
7. **Static/build checks, then isolated runtime and browser QA.** A failed gate returns to its owning lane; do not mask a geometry failure with UI guards.

Suggested file ownership to minimize conflicts:

- Core/geometry lane: `packages/core/src/schema/nodes/wall.ts`, relevant core wall helpers/tests, `packages/viewer/src/systems/wall/{wall-system,wall-materials}.*`, `packages/nodes/src/wall/{renderer,construction-preview,paint}.*`.
- Zone lane: `packages/editor/src/lib/zone-finish.*`, `packages/mcp/src/modeling-agent-manual.ts`, ontology test.
- Server lane: `packages/mcp/src/storage/{types,sqlite-scene-store,index}.*`, `apps/editor/lib/{finish-template-schema,finish-template-server,intm-session,scene-api-security}.*`, `apps/editor/app/api/finish-templates/**`.
- UI lane: `apps/editor/lib/finish-template-store.*`, `apps/editor/components/zone-finish-panel.*`.
- `packages/editor/src/index.tsx` remains Zone-lane owned if exports change.

## Automated acceptance

Run fresh and retain the exact command outputs:

```bash
bun test packages/core/src/schema/nodes/wall*.test.ts
bun test packages/viewer/src/systems/wall/wall-system*.test.ts packages/nodes/src/wall/paint.test.ts packages/nodes/src/wall/construction-preview.test.tsx
bun test packages/editor/src/lib/zone-finish.test.ts apps/editor/components/zone-finish-panel.test.tsx
bun test apps/editor/lib/finish-template-schema.test.ts apps/editor/lib/finish-template-store.test.ts apps/editor/app/api/finish-templates
bun test packages/mcp/src/storage/sqlite-scene-store.test.ts packages/mcp/src/ontology-manual.test.ts
bun run --cwd apps/editor check-types
bunx biome check <every changed source/test file>
bun run --cwd apps/editor build
```

Server tests must use a temporary SQLite file and prove:

- private/company list filtering and no cross-company disclosure;
- same-company read/apply but 403 rename/delete by a peer;
- invalid/expired INTM session fails closed;
- forged payload identity fields are rejected or ignored and never persisted;
- local loopback sharing works only with INTM auth disabled and non-production;
- a company-less verified user can CRUD private templates but receives 403 for company create/list;
- 2 MiB limit, malformed payload, blob URL, stale ETag, retry after transient failure, and delete all have exact status codes;
- process/store recreation reloads the same server rows.

## Browser/runtime acceptance

Use a disposable server-side copy of scene `d26f866cd069`; never use the original as a destructive fixture. Capture scene-copy ID, server URL, browser profile, timestamp, screenshots, network responses, and console log.

### A. Canvas and wall rendering on the isolated upgraded runtime

1. Confirm the existing `localhost:3002` supervisor parent remains stable and the port remains responsive. Record listener-child PID changes as watcher activity rather than failure; do not kill or manually restart the runtime.
2. Confirm `git check-ignore` matches both `apps/editor/.next` and the selected custom Next output directory, start the upgraded app on a free second port with that clean custom directory, and open `/scene/<copy-id>` in a fresh tab. Generated CSS must contain no control-byte variants of valid arbitrary selectors and the isolated runtime must return a non-500 scene response before browser interaction.
3. Wait for the editor's actual scene-ready signal and visible wall geometry; a toolbar/sidebar response alone is insufficient.
4. Complete two editor ↔ preview cycles, one direct 2D ↔ 3D round trip, and one fresh hard reload. Each pass must show non-black 3D geometry and complete scene readiness. Repeat only when a new regression needs isolation; arbitrary toggle/reload loops are not evidence.
5. With a constructed wall unselected and then selected in `finish`, verify real interior/exterior material and texture. In selected `layers` and `frame`, verify the assembly view replaces the base without z-fighting. Capture a thumbnail and one model export; thumbnail shows finish surfaces, export retains configured layers.
6. Console must have zero uncaught errors, zero `addEventListener` null errors, zero WebGPU device/context loss errors, and zero viewer-readiness timeouts. Network must show no failed dynamic chunk required by the Viewer.

### B. Exact UI, 2D/3D partial wall, and Undo

1. In 2D click the manual Zone labels for `현관`, `거실`, and `안방`. Each must show the existing right-inspector rows `전체 벽면 / 천장 / 바닥`; the wall row must be ready rather than `벽 분할 필요`.
2. From the material dialog apply three visibly different materials to adjacent/shared partial spans. Switch directly to 3D and inspect both ends of each boundary, openings, the opposite wall face, and the neighboring Zone span. Only the claimed interval changes; no white/black wall, hole fill, UV jump, or duplicated surface is allowed.
3. In 3D click the Zone label and apply a second material from the same three-row UI. Switch directly back to 2D; selection, row summary, and Zone identity must remain correct.
4. With textures disabled, applying a material leaves solid mode enabled and shows `단색 표시 중 · 자재 색상 보기`; activating the notice restores actual material textures. The appearance setting changes only from that explicit action.
5. Use the ordinary whole-face paint tool on a side that has partial overrides. The clicked side/role changes across the full face immediately, its role overrides are removed, unrelated region roles and the opposite side remain intact, and one Undo restores both base and overrides.
6. One Undo restores the entire last Zone operation, including material registration and every region/ceiling/floor node patch. One Redo reapplies it. History count changes by exactly one per successful apply and by zero for cancel, stale target, or blocked overlap.
7. Split a region-bearing straight wall through one range, then merge an aligned pair; rendered spans and refs must be physically unchanged. A reversed/conflicting merge must fail with the specified reason and no scene/history mutation. Reload the route. The wall ranges, wall/floor/ceiling materials, rows, and scene graph reload from scene autosave. Repeating apply must update the same region rather than accumulate overlapping regions.

### C. Server persistence and cross-profile sharing

1. In browser profile A save one private and one company Zone template plus one company home template. Record successful POST responses, ids, versions, visibility, and `Location` headers.
2. Record a direct `GET /api/finish-templates?scope=mine` and `GET ...?scope=company` response from the browser Network panel or authenticated fetch. The expected ids must be present in server JSON.
3. Clear only the finish-template localStorage/cache key and hard reload. All server templates must return; this proves the browser store is not authority.
4. Open a genuinely separate browser profile/context B authenticated as another user in the same verified company. Company templates must list and apply; the private template must not list or fetch. Rename/delete of A's company template must return 403 and leave the row unchanged.
5. Open a profile from another company in the API integration fixture and prove the company ids do not list or fetch. Do not use a UI-only absence as the sole proof.
6. Simulate one failed save/import, verify the local pending copy and retry control remain, restore the endpoint, retry, and verify exactly one server row. Explicit local-v1 import retains the local copy with confirmed server provenance; repeating import must reuse that mapping and create no duplicate row.
7. Reload both profiles and repeat the server-list calls. Templates and versions must persist across browser profiles and server-store recreation.

### D. Final console/network gate

After all A–C actions, export fresh console and failed-network lists. Completion requires:

- no uncaught exception, React error boundary, hydration error, R3F stale-root error, viewer-ready timeout, failed template API request left unrecovered, or SQLite error;
- no mutation of the original `d26f866cd069` scene;
- no kill or manual restart of the existing port-3002 runtime, with stable supervisor-parent and responsive-port evidence;
- screenshots showing actual 3D wall geometry/materials, partial boundary behavior, single Undo result, and both-profile template lists;
- direct server JSON evidence for ownership/visibility claims.

## Stop condition

The work is complete only when all automated checks pass and the browser evidence proves all four improvements together: stable Canvas, real slot-aware walls, partial manual-Zone wall finishes with one-step history, and server-persisted private/company templates visible from the correct second profile. A source diff, a passing build, localStorage persistence, or a responsive non-canvas UI does not satisfy this contract alone.

## Final validation state (2026-10-02)

The frozen source implementation passed the recorded core/viewer/editor/API tests, Biome, type checks, and isolated production build. A fresh owned `localhost:3002` tab rendered WebGPU 3D and completed a direct 2D ↔ 3D round trip with no viewer-readiness timeout, React unmount error, null-listener error, deleted-module error, or CSS parser error; the supervised parent stayed in place and the port remained responsive.

One historical `localhost:3003` span run visibly recovered and rendered after WebGPU initialization, but its captured development console contained one viewer-readiness fallback and one React synchronous-root-unmount error immediately around two Fast Refresh rebuilds. The available console API exposed no stack. React DOM is the component that emits that exact diagnostic, while the installed R3F 9.8.1 Canvas uses its separate reconciler teardown path; timing alone does not prove that the warning was HMR-only, so this historical run remains recorded as a failed console sample. A subsequent genuinely fresh owned 3003 navigation rendered walls, openings, textured floors, and the Rustic Brick wall after WebGPU readiness; its console contained Fast Refresh completion and only the THREE.Clock deprecation warning, with no error or viewer-readiness timeout. Together with the clean 3002 round trip, this clears the focused current Canvas runtime check without claiming that every development remount race is eliminated.

The remaining acceptance gaps are explicit: a genuinely separate company user/account and browser profile were unavailable; a fresh partial-region paint on the opposite face was not exercised in the final browser pass; the one-metre world-UV metric has no direct numeric assertion; curved partial regions remain fail-closed unsupported; and partial finish regions in assembly export remain outside this Zone UI scope. Whole configured assembly export remains the supported export contract.

## Continuation acceptance contract

Continue only the three evidence gaps below. Curved partial regions remain a documented fail-closed limitation, and partial-region assembly export remains excluded from this Zone UI scope. Do not restart or replace the supervised `localhost:3002` runtime.

### 1. Numeric world-UV regression

Make the smallest test seam in [`packages/viewer/src/systems/wall/wall-system.tsx`](/Users/changseok/editor/packages/viewer/src/systems/wall/wall-system.tsx:904): export `applyWorldPlanarWallUVs` from that module for its existing relative test, without adding it to a package barrel or creating a second projection helper. Extend [`wall-material-override.test.ts`](/Users/changseok/editor/packages/viewer/src/systems/wall/wall-material-override.test.ts:172) with one generated straight wall whose finish-region stations land at exact metre positions. Pass the generated post-split geometry through the production projection function and assert, with a numeric tolerance:

- a one-metre longitudinal or vertical world-space displacement on each vertical side changes the corresponding UV coordinate by exactly one;
- vertices duplicated across one finish station have identical UV and UV2 values on the same physical side, even though their material groups differ;
- the opposite vertical face retains the same one-metre magnitude with the existing mirrored sign convention;
- one top-cap vertex uses its world X/Z coordinates, and UV2 equals UV for every checked vertex.

The test may transform sampled positions with the same explicit matrix passed into the function, but must derive expectations from the known world coordinates rather than copy the production normal-axis branch. No renderer production behavior or public package API changes are approved beyond that internal named export. Run only the focused viewer test first, then the already-green viewer build/types/Biome gates required by the repository workflow.

### 2. Fresh partial-span UI and Undo proof

Create a new disposable server-side scene by POSTing an exact copy of the owned `zone-improvements-span-20261001-231520` graph under a fresh test id. Record its initial graph hash, node/material counts, and the four existing `현관` finish-region ids, ranges, sides, and refs. Never mutate the source fixture or `d26f866cd069`.

On the disposable copy in the existing 3002 runtime:

1. In 2D select `현관`, open the existing `전체 벽면` row, enable textures through the existing appearance action if needed, and apply one catalog material visibly different from Rustic Brick through the actual Zone UI.
2. Wait for autosave, switch directly to 3D, and capture the changed partial span from the `현관` side plus the same physical wall from its opposite side. The target interval must change; the unclaimed wall interval, opposite face, and neighboring room must retain their baseline appearance. A selected-wall tint is not material evidence.
3. Read the saved scene JSON and record this post-Zone-apply state. The same region ids and normalized ranges must remain, only the intended semantic side refs may change, direct wall `slots` must remain absent/unchanged, and no wall/layer/node may be added.
4. Enter the ordinary Paint tool with `이 면`, choose a third visibly distinct material, and click a triangle inside the newly rendered partial region so the hit resolves through its regional material group. The clicked physical side must immediately take the Paint material across its whole face; matching roles must be removed from that side's partial overrides, while the opposite side and unrelated region roles remain unchanged. Capture both sides and the saved JSON.
5. Invoke one ordinary Undo. After autosave, require the exact post-Zone-apply graph content and partial-region appearance from step 3 to return, including the same region ids/ranges/sides/refs and no leftover Paint material registration. Invoke Undo once more and require the original pre-Zone baseline graph hash, node count, material set, region ids/ranges/sides/refs, direct wall slots, and appearance to return. Scene versions may advance. Each gesture must consume exactly one Undo; console and failed-network output must be clean throughout.

This closes both missing proofs: Zone partial-span apply/Undo and an ordinary Paint hit resolved from an existing regional material group with opposite-side preservation and atomic Undo. Do not substitute a direct API mutation, a click on a non-regional triangle, or an existing pre-painted screenshot.

### 3. Independent profile and real company-session boundary

The current computer-use inventory exposes only one controllable Chrome extension profile (`고생`). Named tabs in it are one profile. Chrome for Testing and Aside are installed native apps but are not currently exposed as separate controllable browser profiles. The local server also resolves loopback callers to `{ ownerId: 'local', companyId: null, local: true }` and rewrites created template visibility to `local` in [`finish-template-server.ts`](/Users/changseok/editor/apps/editor/lib/finish-template-server.ts:19) and [`finish-templates/route.ts`](/Users/changseok/editor/apps/editor/app/api/finish-templates/route.ts:96); a second local profile cannot prove company authorization.

Split this evidence into two honest gates:

- **Independent local persistence:** use a genuinely separate browser context with separate cookies and storage, such as the installed persistent headless Chromium browser surface or a fresh Chrome-for-Testing user-data directory. In that context, open the owned scene, clear only its finish-template localStorage key, refresh the server list, and show an existing server-backed `local` template in both direct JSON and UI. Record the browser/context identity. Do not call this company sharing.
- **Verified company sharing:** run only on an environment with `INTM_BASE_URL` enabled and two already-authorized browser sessions. From each session, read INTM's session response and establish two distinct non-empty user ids with the same non-empty company id; redact the raw identifiers in screenshots/log summaries. Profile A creates a company template and records its id/version. Profile B must list, fetch, reload, and apply it while receiving 403 for rename/delete; A must still read the unchanged row afterward. If an authorized different-company session is available, additionally prove non-list/non-fetch. Never synthesize session cookies, override principal resolution, reuse the same profile, or treat local-mode records as company records.

If two suitable verified INTM sessions are unavailable, mark only the company browser gate blocked with that exact reason. Preserve the existing API/storage authorization tests as automated evidence, but do not promote them to real-session browser proof. Stop when the UV test and disposable partial-span flow pass and the independent-profile/company gates are either proven with captured identities or explicitly blocked by unavailable authorized sessions.

## Continuation blocker: idle Paint mode consumes the first Undo

The disposable partial-span run proved the paint mutation itself is atomic: after the regional hit, saved scene version 15 held one whole-side `interior` slot and removed only that wall's matching interior finish region, while the opposite side and the other three Rustic Brick regions were unchanged. The failure is in shortcut routing, not in the paint commit, autosave, or history snapshot. The first native `Cmd+Z` only exited Paint mode and left the saved graph at version 15; the second reached history and restored all four original regions at version 16.

[`cancelInteractionForHistoryShortcut`](/Users/changseok/editor/packages/editor/src/hooks/use-keyboard.ts:146) emits `tool:cancel`, then treats every non-idle interaction scope as an uncommitted gesture and returns before the Undo arm at [`use-keyboard.ts:480`](/Users/changseok/editor/packages/editor/src/hooks/use-keyboard.ts:480). Paint mode deliberately owns `{ kind: 'painting' }` for the lifetime of the mode, including the idle interval after a committed click, through [`syncBrushModeScope`](/Users/changseok/editor/packages/editor/src/store/use-editor.tsx:940). Therefore an idle persistent brush is misclassified as an in-flight gesture. The observed two-key behavior follows directly from those branches.

Authorize the smallest repair in two implementation/test files:

1. In [`packages/editor/src/hooks/use-keyboard.ts`](/Users/changseok/editor/packages/editor/src/hooks/use-keyboard.ts:146), snapshot the current scope, `inputDragging`, and temporal `isTracking` after the synchronous `tool:cancel` emission and `_toolCancelConsumed` check. When the surviving scope is `painting`, input is not dragging, and temporal history is tracking, call the existing `exitToSelectAfterUnconsumedCancel()` so the brush scope, sampling state, hover/preview effect, and Paint UI leave through the normal mode transition, then return `false` so the same key event continues to `runUndo()` or `runRedo()`. Do not bypass the mode transition or manipulate scene history directly.
2. Preserve every existing abort gate: reference-scale cancellation still returns before history; `_toolCancelConsumed` still wins for a tool with a live draft/stroke; `inputDragging` and `!isTracking` still consume the shortcut; moving, placing, drafting, reshaping, handle-drag, and box-select scopes still take the current cancel-without-history path. Do not generalize all active scopes to fall through. Keep `terrain-sculpt` behavior unchanged in this repair unless a separate reproduced idle-sculpt failure establishes that scope.
3. Add [`packages/editor/src/hooks/use-keyboard.test.tsx`](/Users/changseok/editor/packages/editor/src/hooks/use-keyboard.test.tsx) using the repository's mounted-hook/fake-window pattern from `use-draft-length-input.test.tsx`. Mount a component that calls the real `useKeyboard`, seed a real `useScene` history entry, enter Paint through `useEditor.getState().setMode('material-paint')`, dispatch one cancelable `keydown` with `key: 'z'` and `metaKey: true`, and assert that the actual scene history entry is undone, mode is `select`, and interaction scope is `idle` after that single event. This must exercise the registered keyboard listener and `runUndo`; a copied predicate or direct call to a newly exported helper is insufficient.
4. In the same mounted-keyboard test file, cover the preserved blockers with real key events: a `tool:cancel` listener that ends and marks a drafting interaction consumed must leave the seeded history entry unchanged; an `inputDragging` case and a paused-temporal case must also leave it unchanged. Add the reference-scale case if its existing guide emitter can be reset without introducing a third production seam. Every case must restore temporal tracking, viewer drag state, interaction scope, event listeners, editor mode, and scene history in cleanup so the suite cannot leak state.

Run the focused keyboard test first, followed by editor type checking and Biome on the two touched implementation/test files. No history-controller, scene-store, interaction-scope, paint-commit, or autosave source change is approved by this diagnosis.

Resume browser acceptance only after those checks pass. On a fresh disposable copy, repeat the regional Paint hit and press native `Cmd+Z` exactly once. After autosave, the saved graph must equal the recorded post-Zone-apply content: same region ids/ranges/sides/refs, no whole-side Paint slot or leftover Paint material, opposite side unchanged. The brush UI and hover preview must be gone in that same interaction. A second `Cmd+Z` may then be used as a separate gesture to restore the pre-Zone baseline, but it must not be needed to undo Paint. Capture the saved scene versions and console/network output; do not describe a failed one-key result as an atomic-history defect unless the keyboard fix is present and the first event demonstrably reaches `runUndo()`.

## Continuation validation update (2026-10-02)

The frozen continuation source now clears the approved automated and build gates:

- The typed Zone fixture correction uses canonical node-id prefixes and schema parsing rather than `unknown` casts, ignore directives, or compiler configuration changes. [`zone-finish.test.ts`](/Users/changseok/editor/packages/editor/src/lib/zone-finish.test.ts) at SHA-256 `26bfb0861c91746a2ffdeaf64bed723db83515b5d971e9eeb35cf5e00288f354` passed 43 tests and 188 expectations; its final Biome check and the app typecheck passed. The package-only editor typecheck no longer reports Zone fixture diagnostics. Its remaining failures are the already-recorded TS6059 cross-package test imports from `glb-wall-topology.test.ts` and `stl-export.test.ts` into viewer source.
- The mounted keyboard regression remains at hashes `45086c236c523e6353a493aa58b1de0e9396208acda41bfd9d71f12d70615ec7` (`use-keyboard.ts`) and `e68d9d975915f8025daaca93d0630ba08d7960ad9c86c20ff627fcec7b960e27` (`use-keyboard.test.tsx`). The focused four tests and 39 relevant editor regressions passed, as did app typecheck and final Biome. This proves the shortcut branch and preserved cancel blockers in automation; browser evidence is tracked separately below.
- The world-UV seam remains at hashes `1d18ca8b87054d9a625860e2aa207205b138a260f3f592230385179024391fe0` (`wall-system.tsx`) and `1d11b3e879742b02e0302f3722871f27062bf2b55a73587cd72a8f30af977926` (`wall-material-override.test.ts`). Six focused material tests and all 25 wall-system regressions passed, along with viewer build, app typecheck, and final Biome. `applyWorldPlanarWallUVs` is exported only from its implementation module and remains absent from the viewer barrel.
- The isolated production build completed with exit 0 and build id `GpXk_rGTcZM69UIYpMD42`. All recorded source hashes were identical before and after the build. It used `apps/editor/.next-zone-finish-validation`; the default `.next` timestamp remained unchanged. The existing port-3002 listener PID `79978` stayed in place, with root redirect 307 and health API 200 before and after.

Independent local persistence is now browser-proven without promoting it to company sharing. A separate native Chrome Testing profile cleared only `pascal-finish-templates-v1`, used the still-available 2D surface despite the inline GPU fallback, selected `현관`, and displayed `전체 벽면 / 천장 / 바닥`. After `서버 템플릿 새로고침`, the live dialog showed the refresh toast; the captured DOM recorded the exact server-backed names `QA Zone 20261002 Luna` and `QA Home 20261002 Luna`, while the bottom of that list is only partly visible in the screenshot. Evidence is in `/tmp/zone-finish-2d-template-dialog-after-refresh.png` and `/tmp/zone-finish-continuation-sharing.log`. No template was applied. A fresh direct GET of original scene `128765970842` proved version 48 before and after, exact canonical graph equality, and unchanged SHA-256 `6bfa6af80c00af2d89fce53e6e247dd53d7c92cbfebd6d76bfd0fe90201c783d`. This is local-development persistence only. Verified company sharing remains blocked because two distinct already-authorized INTM sessions with the same non-empty company id are unavailable.

One runtime gate is still active and must not be pre-marked complete: `/tmp/zone-finish-continuation-browser.log` has established a fresh disposable clone, exact baseline hash, successful Zone UI apply, preserved four region ids/ranges/sides, absent direct wall slots, and the new Polished Concrete scene material. It has not yet recorded the subsequent ordinary regional Paint hit, opposite-face visual proof, and a single post-fix `Cmd+Z` restoring the exact post-Zone graph. Completion requires that final sequence, clean console/network output, and the resulting saved-graph hashes. The unavailable real-company session gate must remain explicitly blocked unless the user supplies those sessions; curved partial regions and partial-region assembly export remain the previously declared exclusions.

## Continuation blocker: synchronous KTX2 scene texture return assumption

The final disposable run reproduced a separate renderer blocker before the regional Paint proof could start. Applying Polished Concrete through the Zone UI produced scene version 3 with the same four region ids/ranges/sides, no direct wall slots, and a new scene material whose albedo URL is `/material/concrete/concrete_polished/concrete_polished_basecolor_512.ktx2`. On the following 3D render, the viewer ErrorBoundary recorded `Cannot set properties of undefined (setting 'wrapS')` from `loadSceneTexture`; the canvas retained its stale frame and did not deliver the Paint hit. The run must remain a failed console sample. One native `Cmd+Z` from idle Paint subsequently restored the exact baseline graph at version 4, so the live Zone Undo gate passes independently; regional Paint remains unproved.

The failure is the loader contract at [`materials.ts`](/Users/changseok/editor/packages/viewer/src/lib/materials.ts:123), not malformed Zone data or a missing asset. `pickTextureLoader` casts the shared `KTX2Loader` to `TextureLoader` and claims both synchronous `load` methods return a texture. Three 0.185.1's installed `KTX2Loader.load` at `node_modules/.bun/three@0.185.1/node_modules/three/examples/jsm/loaders/KTX2Loader.js:375` starts `FileLoader`, supplies the decoded texture only to its callback, and returns nothing at line 397. Consequently [`loadSceneTexture`](/Users/changseok/editor/packages/viewer/src/lib/materials.ts:219) receives `undefined` from line 240 and dereferences it at line 242. The unused synchronous `getPresetTexture` repeats the same invalid assumption at [`materials.ts`](/Users/changseok/editor/packages/viewer/src/lib/materials.ts:328). The existing preset path already demonstrates the correct contract: [`loadPresetTexture`](/Users/changseok/editor/packages/viewer/src/lib/materials.ts:374) waits for `whenKtx2Ready`, uses `loadAsync`, caches the resolved texture, and [`queueTextureAssignment`](/Users/changseok/editor/packages/viewer/src/lib/materials.ts:425) attaches the real texture to the cached material and marks it for a node-graph rebuild.

Authorize one viewer implementation file and its existing focused test file:

1. In [`packages/viewer/src/lib/materials.ts`](/Users/changseok/editor/packages/viewer/src/lib/materials.ts), remove the false synchronous KTX2 loader selection and the unused synchronous `getPresetTexture`. Preserve the current synchronous `TextureLoader` and stored-asset behavior for non-KTX2 scene textures.
2. For a scene material `map` or rendered-mode `bumpMap` whose resolved URL ends in `.ktx2`, create the material without that slot, deduplicate the cold load through the existing `textureLoadPromises`, wait for [`whenKtx2Ready`](/Users/changseok/editor/packages/viewer/src/lib/ktx2-loader.ts:140), and use the real `ktx2Loader.loadAsync` result. Apply the existing scene texture repeat, offset, rotation, matrix, colour-space, and `project-asset` reference stamp to that resolved texture, cache it under the existing scene cache key, attach that actual texture instance to the already-cached material slot, and set `material.needsUpdate = true`. Do not copy a compressed texture into a plain `THREE.Texture`, create a fake placeholder compressed texture, or convert this into an editor/Zone callback.
3. Catch a KTX2 fetch/transcode rejection inside the asynchronous texture queue, clear its promise entry, and leave the material renderable with its authored flat colour while emitting the existing viewer texture-load warning shape. The rejected promise must not reach React's ErrorBoundary or become a permanently cached rejected promise. Keep `clearMaterialCache` ownership and ordinary image behavior unchanged.
4. Extend [`packages/viewer/src/lib/materials.test.ts`](/Users/changseok/editor/packages/viewer/src/lib/materials.test.ts) through the public-in-module `createMaterial` path. Resolve KTX2 readiness with the existing loader test setup, mock `ktx2Loader.loadAsync` to return a real `THREE.CompressedTexture`, and prove: material creation does not throw before the promise resolves; the resolved compressed object itself becomes `map`; repeat, offset, rotation/matrix, sRGB, `project-asset` reference, and cache key are applied; the cached material is updated rather than replaced; a second material resolution does not issue another load; and a rejected load leaves a usable mapless material with no unhandled rejection. Include one ordinary image case asserting that its existing synchronous texture path remains unchanged. Restore loader spies and clear material caches after each case.

Run the focused materials test, viewer build, app typecheck, and Biome only through the assigned Luna implementation lane, then resume the disposable browser flow from an exact baseline clone. Reapply Polished Concrete through the actual Zone UI, wait for the real KTX2 surface, switch 2D ↔ 3D, and require no ErrorBoundary, `wrapS` exception, viewer-readiness timeout, or failed texture request. Only after the textured regional triangle accepts the ordinary Paint hit may the existing opposite-face and single-Undo acceptance sequence continue. Do not count API health, a stale retained frame, or a flat fallback before the asynchronous load completes as runtime proof.

### KTX2 automated validation update (2026-10-02)

The frozen KTX2 repair is approved at SHA-256 `0df95d78f9c64d61af5f281c3427d95184728867612fba3d3cf51e638a1d1c93` for [`materials.ts`](/Users/changseok/editor/packages/viewer/src/lib/materials.ts) and `e965dfaf4d0f66f98ee99ae59dd5b0c3959b3344ae717a96cf69f5738c319e79` for [`materials.test.ts`](/Users/changseok/editor/packages/viewer/src/lib/materials.test.ts). It removes both false synchronous KTX2 return assumptions, preserves synchronous ordinary-image and stored-asset loading, queues the actual resolved compressed map and bump texture after readiness, keeps negative nonzero bump scale, retries a transient rejection from the cached material, and avoids redundant material rebuilds once the cached texture is already attached. The shared property helper does not mark an ordinary image texture ready before its image exists.

Recorded validation in `/tmp/zone-finish-continuation-ktx2.log` passes 6 material tests with 38 expectations, 5 texture-reference tests with 16 expectations, viewer build, app typecheck, changed-file Biome, and the isolated production build with build id `YkgclBS1uzNchpG8uspZg`. The test proves compressed-object identity, map and bump attachment, transforms and matrix, sRGB/linear slots, project-asset stamping, negative bump scale, load deduplication, stable cached-material version, rejection fallback and retry, and the ordinary synchronous image path. No viewer/editor layer boundary or public barrel changed.

This closes the source and automated KTX2 gate only. The prior ErrorBoundary browser sample remains failed until the root-owned 3002 flow reloads an exact disposable baseline, applies the actual `/material/concrete/concrete_polished/concrete_polished_basecolor_512.ktx2` catalog surface, visibly renders it without console/network failure, and completes the regional Paint, opposite-face preservation, and one-Undo proof. Verified company sharing remains separately blocked by the unavailable two authorized same-company INTM sessions.

## Continuation blocker: wall region material cardinality and cold asynchronous texture propagation

The final disposable browser run now proves the data and Undo behavior independently of the renderer failure. Zone apply saved version 9 with four finish regions and graph SHA-256 `7a727a4d5a8aec25bfca37af9a70fe645545d928df67443319ce90bb68315f58`. Ordinary Paint changed only `wall_qb9mjjcodnvutm49` at version 10: its one interior finish region was removed and `slots.interior` became `library:concrete-raw`. One native `Cmd+Z` produced version 11 exactly equal to the post-Zone graph, and the next produced version 12 exactly equal to the baseline graph with SHA-256 `322a8dfb357252494596e2e994ba1fbdbee6af53bc906c6a8b2833829b3b79bc`. Evidence is in `/tmp/zone-finish-root-final-repaired-{zone,paint,paint-undo,zone-undo}.json` and `/tmp/zone-finish-continuation-browser.log`.

The Paint click also reproduced `TypeError: Cannot read properties of undefined (reading 'side')` from Three `Mesh._computeIntersections`; the canvas survived, but this sample is not console-clean. The failure is a transient wall geometry/material cardinality mismatch. Region geometry uses appended material indices beginning at 11 in [`wall-system.tsx`](/Users/changseok/editor/packages/viewer/src/systems/wall/wall-system.tsx:215), while the material array appends one entry per current region-plan role in [`wall-materials.ts`](/Users/changseok/editor/packages/viewer/src/systems/wall/wall-materials.ts:578). Removing this wall's sole region lets React replace its material array with indices 0 through 10 immediately. `updateNodesAction` defers dirty marking until `requestAnimationFrame` in [`node-actions.ts`](/Users/changseok/editor/packages/core/src/store/actions/node-actions.ts:1071), and `WallSystem` rebuilds geometry later from `useFrame` in [`wall-system.tsx`](/Users/changseok/editor/packages/viewer/src/systems/wall/wall-system.tsx:614). Until that rebuild, the old geometry still contains group 11. Three's installed raycaster indexes `material[group.materialIndex]` before reading its `side` at `node_modules/.bun/three@0.185.1/node_modules/three/src/objects/Mesh.js:291`, which exactly explains the captured exception. A raycast guard would only mask the invalid render state and is not approved.

The same run exposed a separate cold-load propagation defect. Polished Concrete was present as a valid scene material but its finish region stayed flat white, while the later whole-face Raw Concrete rendered textured. [`getMaterialsForWall`](/Users/changseok/editor/packages/viewer/src/systems/wall/wall-materials.ts:591) clones the material returned by `resolveMaterialRef` only for appended region slots. On a cold KTX2 load the clone has no map; [`queueSceneKtx2Texture`](/Users/changseok/editor/packages/viewer/src/lib/materials.ts:292) later attaches the resolved compressed texture to the cached source material, not to that clone. The unchanged wall hash gives the clone no later replacement. Ordinary image textures appear to work because `TextureLoader.load` returns a placeholder texture synchronously and the clone shares that texture object while its image fills in. Library presets have the same cold-clone failure because their asynchronous texture assignment also targets the cached source material.

Authorize the smallest repair in [`packages/viewer/src/systems/wall/wall-materials.ts`](/Users/changseok/editor/packages/viewer/src/systems/wall/wall-materials.ts) and its existing focused test file only:

1. Resolve each appended finish-region entry to the shared cached material directly; remove the region-only `.clone()`. Base face and band slots already use these cached materials by reference. This lets existing scene KTX2 and preset texture queues update the material instance actually held by the wall array. Do not add a second loader, promise subscription, material polling hook, or cloned-texture propagation layer. The visible wall cache does not dispose shared cached materials, so this also preserves the existing ownership boundary.
2. When replacing a cached wall-material result for the same wall/view cache key, keep every new presentation array long enough to cover the greater of its current required length and the previous visible-array length. Pad `visible`, `invisible`, and `translucent` with their own safe slot-0 material before deriving delete-highlight arrays. The extra trailing entries are unused once new geometry lands, allocate no extra textures, and may disappear when the wall-material cache is cleared; they exist only to keep old geometry groups valid during the deferred rebuild window. Do not retain disposed invisible/translucent instances and do not mutate Three geometry groups from the material module.
3. Compute the region plan before the material hash and include its material-entry count in the textures-off hash. The textures-off arrays already append `regionPlan` entries, but the current hash omits them, so adding or removing regions can otherwise return a permanently wrong-length cached array. Textured mode already includes full region signatures and remains unchanged.
4. Extend [`wall-material-override.test.ts`](/Users/changseok/editor/packages/viewer/src/systems/wall/wall-material-override.test.ts) with the real transition. Build a straight wall with one region, generate its geometry and materials, resolve the same wall after removing that region and adding the whole-side slot, and raycast the still-old geometry against the new array. Require no throw and require every old group index to resolve to a material. Then generate the new no-region geometry and require all of its indices covered. Repeat the cache-cardinality assertion with `textures=false`, including a region add and removal, so the hash dependency is exercised rather than copied into a helper-only test.
5. In the same focused test surface, cover cold asynchronous region propagation for both `scene:` and `library:` refs. Before the mocked load resolves, the appended entry may be mapless. After the existing KTX2/preset loader promise resolves, require that the exact material instance stored at the region index has the exact resolved texture object and triggers no replacement of the cached wall array. Preserve the existing ordinary-image behavior. Clear global material and wall caches plus loader spies between cases; if the wall cache lacks a test-only clear seam, add only a module-local exported-for-tests reset rather than a production lifecycle API or public barrel export.

Run the focused wall-material test, the existing materials KTX2 test, all wall-system regressions, viewer build, app typecheck, and changed-file Biome in the assigned Luna lane. Then reload the exact disposable baseline in one foreground owned tab, apply Polished Concrete through Zone, wait until the region itself is visibly textured, and paint that regional triangle with Raw Concrete. Require no `material[group.materialIndex]`/`side` exception, no ErrorBoundary, no failed texture request, and no readiness timeout. One native `Cmd+Z` must restore the exact version-9 post-Zone graph and textured region; the next must restore the exact baseline. Keep the already-captured failed console sample as regression evidence rather than relabeling it as a pass.

### Wall material cache automated validation update (2026-10-02)

The final two-file viewer repair is approved with no HIGH or MED source finding at SHA-256 `abce06021bb1dd4b5845bddb82d6e338af70d6a56c5ed6f89b10fe7f2b208806` for [`wall-materials.ts`](/Users/changseok/editor/packages/viewer/src/systems/wall/wall-materials.ts) and `97d6553c0cf46fa3b6ef3560899a038696c3833ba3ed762f48136c2b351e4fb6` for [`wall-material-override.test.ts`](/Users/changseok/editor/packages/viewer/src/systems/wall/wall-material-override.test.ts). Finish-region entries now retain the shared cached material returned by `resolveMaterialRef`; there is no region-only clone. On a replacement for the same wall/view key, the code records the previous visible, invisible, and translucent lengths, pads each new array with its own safe slot-zero material, and only then derives the three delete-highlight arrays. Thus all six presentation variants cover the old geometry's appended group indices without retaining disposed invisible/translucent instances. The textures-off hash and array both use `regionPlan.length`, so add/remove cannot return a stale eleven-entry cache result.

The regression uses actual generated old region geometry, the new no-region material array, and Three's real `Raycaster`; it requires every old group index to resolve and a real hit without throwing, then swaps in the generated new geometry and requires another real hit. Cold `scene:` KTX2 proves the exact loader-returned `CompressedTexture`, cached material identity, and stable wall-array identity. Cold `library:` KTX2 preserves the preset pipeline's intentional assigned-texture clone while proving `CompressedTexture` backing identity, exact shared preset-material identity, and stable wall-array identity. The test directly asserts cardinality for visible, invisible, and translucent textures-off variants; delete variants are structurally derived from those padded arrays at [`wall-materials.ts`](/Users/changseok/editor/packages/viewer/src/systems/wall/wall-materials.ts:708). Two non-blocking test-quality gaps remain: delete-array lengths are not separately asserted, and the scene fixture contains an unnecessary `as unknown as MaterialSchema` type escape. Neither changes the production invariant or browser acceptance requirement.

Recorded evidence in `/tmp/zone-finish-continuation-region-cache.log` passes 29 tests across five files with 574 expectations, changed-file Biome, viewer build, app typecheck, and the isolated production build with build id `e5ibaMqV1L7kXq9teQC-b`. This closes only the source, automated, and build gates. The foreground browser must still reapply the real catalog KTX2 finish, visibly show it on the regional span, complete the ordinary regional Paint hit, preserve the opposite face, avoid the captured `material.side` exception, and restore exact saved graphs with one Undo per gesture.

Fresh foreground runtime evidence now closes the visible cold-region texture sub-gate: `/tmp/zone-finish-final-zone-apply.jpg` shows the dark Polished Concrete texture on the intended regional wall span after a clean reload, and no ErrorBoundary or KTX2/material exception appeared in the fresh window. It does not establish a warning-free Canvas: viewer readiness warned at `02:33:56.603`, then the device reported ready at `02:33:57.331`, about 0.7 seconds later, with the foreground canvas correctly sized and rendered. Treat this as a recovered initialization warning and a non-blocking timing observation unless a fresh foreground run fails to render or supplies a causal stack; do not hide it by merely extending the timeout. Historical HMR deleted-module messages at `02:30:44` are outside this fresh reload window. The ordinary Paint hit, opposite-face proof, and post-fix exact Undo sequence remain open.

## Continuation blocker: ordinary 2D Zone selection hides the finish footer

The foreground QA exposed a separate entry-path defect before material application. In Modeling selection mode, clicking the visible `현관` Zone opened the normal right inspector headed `구역`, but `실제 마감 자재`, `전체 벽면`, `천장`, and `바닥` were absent. This is deterministic from the current selection paths. Outside Paint mode, [`FloorplanRegistryLayer.applyEntrySelection`](/Users/changseok/editor/packages/editor/src/components/editor-2d/renderers/floorplan-registry-layer.tsx:739) routes the selected Zone through the generic node path and writes it to `selection.selectedIds` at line 766. [`PanelManager`](/Users/changseok/editor/packages/editor/src/components/ui/panels/panel-manager.tsx:253) correctly passes the host inspector footer to that single-node Zone panel. However, [`ZoneFinishInspectorFooter`](/Users/changseok/editor/apps/editor/components/zone-finish-panel.tsx:321) resolves a Zone only when `selectedIds.length === 0 && selectedZoneId`, then returns `null` at line 887. The visible Zone inspector and absent finish rows are therefore the expected result of this gate; the footer is not missing from the panel composition.

Authorize the smallest app-only repair in [`zone-finish-panel.tsx`](/Users/changseok/editor/apps/editor/components/zone-finish-panel.tsx) and its existing component test:

1. Resolve the footer target from the current scene nodes and selection with explicit precedence. If `selectedIds` contains exactly one id and that node is a `zone` with `spaceRole === 'room'`, use that Zone. Otherwise, only when `selectedIds` is empty, resolve `selection.zoneId` and use it if it is a room Zone. A sole generic Zone, a sole non-Zone node, any multi-selection, or a dangling id must render no finish footer. A sole room Zone in `selectedIds` must win over a stale `zoneId` so the right inspector and footer cannot describe different rooms.
2. Keep both existing selection representations. Do not rewrite `FloorplanRegistryLayer`, the viewer selection store, `PanelManager`, phases, or generic Zone inspector routing for this footer repair. Paint mode's explicit `{ selectedIds: [], zoneId }` route and ordinary Modeling's `{ selectedIds: [zoneId] }` route must both show the same three actual-finish rows.
3. Update [`zone-finish-panel.test.tsx`](/Users/changseok/editor/apps/editor/components/zone-finish-panel.test.tsx) through the actual stores and rendered component. Seed a parsed room Zone in `useScene`, render once with the Zone as the sole `selectedIds` entry and once through `zoneId`, and require `실제 마감 자재`, `전체 벽면`, `천장`, and `바닥`. Add a stale-zone precedence case and preserve the current no-selection empty result plus non-Zone/multi-selection negative behavior. Restore scene, viewer selection, and template-store state in cleanup; do not test a copied resolver alone.
4. Run the focused component test, app typecheck, and Biome on the two app files in the assigned implementation lane. In the already-owned foreground browser, select `현관` from ordinary Modeling 2D selection and require the three rows before continuing the existing material dialog flow. Recheck the Paint-mode Zone selection path once because it uses `zoneId`. Console/network cleanliness and the material/Undo acceptance gates above remain unchanged.

## Final regional material and Undo browser validation (2026-10-02)

The disposable foreground scene `zone-undo-final-20261002-104054` now clears the previously open regional material, ordinary Paint, opposite-face, renderer-cardinality, and Undo gates. Independent parsing of `/tmp/zone-finish-final-current-{baseline,zone,paint,paint-undo,zone-undo}.json` produced these canonical graph states:

- Baseline version 13: 108 nodes, 2 materials, SHA-256 `322a8dfb357252494596e2e994ba1fbdbee6af53bc906c6a8b2833829b3b79bc`.
- Zone version 14: 108 nodes, 3 materials, SHA-256 `ae9a37e81c8c67cfdf0d2136312936e5ff77a2e759e09fa5ae50bbfc861a7e34`. Exactly four existing wall nodes changed. Their region ids, normalized start/end values, and `side: interior` remained byte-for-byte equal; only each region's `slots.interior` ref changed from the original Rustic Brick scene material to the newly registered Polished Concrete scene material `mat_93i61itm0iyg527a`. No direct wall slot or node was added. The new material points to `/material/concrete/concrete_polished/concrete_polished_basecolor_512.ktx2`.
- Paint version 15: 108 nodes, 3 materials, SHA-256 `4515e5879c9163acbb083397f2b65cc0ce0eedd9af6abcebf7595135851a2f8e`. Exactly one node, `wall_vmewnkotwtk7f64o`, changed after the actual regional triangle click at `[1543,349]`: its one interior finish region was removed and `slots.interior` became `library:concrete-raw`. Collections, roots, material registry, all other nodes, and the opposite semantic side remained equal to version 14.
- One native `Cmd+Z` produced version 16 whose graph is exactly equal to version 14, including canonical SHA-256 `ae9a37e81c8c67cfdf0d2136312936e5ff77a2e759e09fa5ae50bbfc861a7e34`. A second native `Cmd+Z` produced version 17 exactly equal to the baseline graph, including SHA-256 `322a8dfb357252494596e2e994ba1fbdbee6af53bc906c6a8b2833829b3b79bc`.

The images corroborate the saved graph: `/tmp/zone-finish-final-zone-apply.jpg` shows the loaded Polished Concrete KTX2 surface; `zone-opposite`, `paint-apply`, and `paint-opposite` show the targeted and opposite views; `paint-undo` restores the post-Zone appearance; and `zone-undo` restores the original Rustic Brick region. `/tmp/zone-finish-final-console-errors.json` is an empty array for the fresh reload and full interaction, with no ErrorBoundary, KTX2 failure, raycast `material.side` exception, or other runtime error. The already-recorded readiness timeout warning at `02:33:56.603` recovered when the device became ready at `02:33:57.331`; it remains an explicit non-blocking initialization warning rather than a console-cleanliness claim.

This closes the regional material and history acceptance sequence. The only product gate still active in this continuation is the ordinary Modeling 2D sole-Zone footer route described above. Verified company sharing remains blocked by the unavailable pair of distinct authorized same-company INTM sessions. Curved partial regions and partial-region assembly export remain the declared exclusions.

## Sole-Zone footer implementation review: dialog guard follow-up

The initial two-file footer implementation passes its display contract but is not yet product-complete. [`selectedRoomZone`](/Users/changseok/editor/apps/editor/components/zone-finish-panel.tsx:112) correctly gives a sole `selectedIds` room Zone precedence over a stale `zoneId`, falls back to `zoneId` only when `selectedIds` is empty, and rejects generic, non-Zone, dangling, and multi-selection inputs. The footer uses it at line 341. The existing component test exercises both positive selection representations, stale precedence, and all required negative cases through real stores. `/tmp/zone-finish-continuation-selection.log` records 4 passing tests with 15 expectations, app typecheck, changed-file Biome, and isolated production build id `1p77vTyJoDj-X_GRZy3Jn`; reviewed hashes are `5f22a5f8245eb749f18de3f15ee1b716b31b231a37394554afcc29ab55f24b98` for the panel and `a21fa679543a9da0f0e78bd67bb5eae4ffa9af281ebd16b5b989b7980ec88946` for its test.

One MED functional blocker remains in the same component. The open-dialog invalidation effect at [`zone-finish-panel.tsx`](/Users/changseok/editor/apps/editor/components/zone-finish-panel.tsx:394) and the material-apply guard at line 587 still encode only the old `{ selectedIds: [], zoneId }` representation: both require `selection.zoneId === captured.zoneId` and reject any non-empty `selectedIds`. Consequently the newly supported ordinary Modeling route can render all three rows and open the modal, but selecting a material from that modal is guaranteed to be rejected as a changed room. A modal-open/cancel browser check cannot close this gate.

Authorize the narrow completion in the same two files:

1. At both the dialog invalidation effect and the apply callback, read the current viewer selection and current scene nodes, resolve them through the existing `selectedRoomZone`, and compare the resulting room id with `active.zoneId` or `captured.zoneId`. Permit either valid selection representation. Keep stale, dangling, generic, non-Zone, and multi-selection behavior fail-closed; retain the captured scene token, nodes/materials identity, target fingerprint, dialog identity, and mounted checks unchanged.
2. Do not alter the viewer store, `FloorplanRegistryLayer`, `PanelManager`, dialog target schema, commit path, or selection precedence. This is one consistency repair at the two existing safety gates.
3. Extend the existing test with the smallest mounted interaction that proves a sole `selectedIds` room can open `전체 벽면`, choose a material through the real callback, and reach the existing commit path, while a selection change to a stale/multi/non-Zone target still closes or rejects. If the catalog's portal/browser dependencies make a focused mounted test disproportionate, keep the current real-store resolver coverage and make the already-owned browser apply the mandatory proof rather than exporting a test-only production seam.
4. Re-run the focused component test, app typecheck, changed-file Biome, and isolated production build. Then in ordinary Modeling 2D select `현관`, open `전체 벽면`, apply a visibly distinct material, verify the saved graph changes only the captured Zone target, and Undo once back to the exact pre-gesture graph. Recheck the Paint-mode `{ selectedIds: [], zoneId }` path remains accepted. No other source scope is approved.

### Sole-Zone footer guard completion and remaining material-summary blocker (2026-10-02)

The narrow selection-guard follow-up is approved. [`selectedRoomZone`](/Users/changseok/editor/apps/editor/components/zone-finish-panel.tsx:112) remains the single precedence rule for both ordinary Modeling's sole `selectedIds` room and Paint's empty-`selectedIds` `zoneId` route. The open-dialog invalidation effect now resolves the live selection through that helper at [`zone-finish-panel.tsx`](/Users/changseok/editor/apps/editor/components/zone-finish-panel.tsx:394), and the apply callback does the same against current scene nodes at line 591. The dialog identity, mounted, scene token, nodes/materials identity, and captured-target fingerprint gates remain intact. The final two-file source/build evidence records panel SHA-256 `ce4a1bbf66a467a677bc83c198c63330370b05e3e66810eb979ce0f4538a9eca`, unchanged test SHA-256 `a21fa679543a9da0f0e78bd67bb5eae4ffa9af281ebd16b5b989b7980ec88946`, four focused tests with 15 expectations, app typecheck, changed-file Biome, and isolated production build id `H9ioXNOkDBBwVy6Ap7HRx` in `/tmp/zone-finish-continuation-selection.log`.

The actual ordinary Modeling route also closes the interaction and history gate. Selecting the room through `selectedIds`, applying Raw Concrete, and issuing one native Undo produced `/tmp/zone-finish-final-modeling-{apply,undo}.json`: apply version 18 changed only the four captured walls' existing `finishRegions` material refs while retaining their ids, ranges, sides, opposite faces, all other nodes, and the 108-node graph; Undo version 19 exactly restored pre-apply version 17 with canonical SHA-256 `322a8dfb357252494596e2e994ba1fbdbee6af53bc906c6a8b2833829b3b79bc`. HMR dependency-array errors at `02:52:45` and `02:54:23` occurred before this actual apply and remain historical evidence; a post-freeze fresh reload is still required before claiming a fresh error-free console window.

One MED user-visible completion blocker remains in the same footer. [`zone-finish-panel.tsx`](/Users/changseok/editor/apps/editor/components/zone-finish-panel.tsx:442) derives wall labels and the swatch by reading only each wall's direct `slots` through `materialRefForNode`. A partial Zone finish is stored in `finishRegions`, so a fully assigned regional wall currently falls through to `1종 자재` and has no swatch even though its rendered surface uses Raw Concrete, Rustic Brick, or another real material. This contradicts the footer's `실제 마감 자재` contract and the requested visible material identity.

Authorize one final domain-to-app projection repair:

1. Add `materialRefs: ReadonlyArray<string>` to `ZoneFinishInspection` in [`packages/editor/src/lib/zone-finish.ts`](/Users/changseok/editor/packages/editor/src/lib/zone-finish.ts:134). [`makeInspection`](/Users/changseok/editor/packages/editor/src/lib/zone-finish.ts:1359) already accumulates the exact unique ref set through [`explicitWallMaterialRef`](/Users/changseok/editor/packages/editor/src/lib/zone-finish.ts:1335), including normalized region coverage, semantic side, active band role, material existence, and direct-slot fallback. Return `[...refs]` beside `materialCount`; return `[]` in the missing-Zone result. Do not export the private resolver, add another range resolver, or add a test-only seam. The existing exported inspection type/function carry the data through the current package barrel.
2. Replace the two direct wall-slot scans at [`zone-finish-panel.tsx`](/Users/changseok/editor/apps/editor/components/zone-finish-panel.tsx:442) with `wallInspection.materialRefs`. Resolve the unique labels from that list and use its first entry for the existing preview helper. Keep `completion.missing` precedence and `materialCount` behavior. A single material must show its real catalog/scene label and swatch; multiple distinct refs must retain the existing count presentation and use a deterministic first-ref swatch.
3. Extend the existing domain test with a face whose enclosing `finishRegion` ref differs from its direct wall-slot fallback. Require `materialRefs` to contain the regional ref, exclude the shadowed direct ref for that captured span, and stay unique across repeated faces/roles. Preserve the existing invalid-ref and material-count semantics. Extend the current footer component test through real stores with a parsed regional wall and registered material, and require the rendered `전체 벽면` detail to contain the actual material label plus the existing swatch style/preview output rather than `1종 자재` with an empty preview.
4. Run the focused zone-finish domain test, footer component test, editor package and app typechecks, changed-file Biome, and isolated production build in the assigned implementation lane. On the final fresh foreground reload, select the room through ordinary Modeling and confirm the sidebar shows the applied regional material name and swatch before and after reopening selection. Preserve the already-proved graph mutation and one-Undo behavior; require no fresh product exception, while retaining the earlier HMR errors as historical evidence rather than relabeling them.

### Regional material summary automated validation (2026-10-02)

The four-file material-summary repair is approved with no HIGH or MED source finding. [`ZoneFinishInspection.materialRefs`](/Users/changseok/editor/packages/editor/src/lib/zone-finish.ts:151) is populated from the same unique ref set that [`explicitWallMaterialRef`](/Users/changseok/editor/packages/editor/src/lib/zone-finish.ts:1335) feeds during inspection, and the missing-Zone result returns an empty list. The footer consumes that list directly for labels and its deterministic first-ref swatch at [`zone-finish-panel.tsx`](/Users/changseok/editor/apps/editor/components/zone-finish-panel.tsx:442); it no longer reinterprets direct wall slots. The domain regression proves a full-span finish region shadows a different direct fallback across all three active wall roles while remaining one unique ref. The SSR regression uses a first wall whose direct fallback is Finewood but whose regional ref is Rustic Brick and requires the actual Rustic Brick label and thumbnail, so both label and preview must come through the regional inspection result.

`/tmp/zone-finish-continuation-selection.log` records 44 domain tests with 192 expectations, five footer tests with 18 expectations, changed-file Biome, app typecheck, and isolated production build id `t8TTDsuy8NUoNYUgTh5UY`. Final SHA-256 values are `3403af19d4600bc03f73eb626f8978535c753f0ff86e0ffea37961cbdde48a78` for `zone-finish.ts`, `a9ec9459c78c9fa0c394282ae07b7ca6d2847172bc3857168f5e9885b3e3ae8d` for its test, `f4a72544368d77ef2c4a709b2acdeda55fbdf1d9a56d4f744eb213d654b252b8` for the footer, and `6c840307efb16604af3bc601e065f70f8a12b362160542cf18ddf91cebb9619d` for its test; the hashes remained stable across the build.

The `03:04:47` browser sample in `/tmp/zone-finish-final-display-reload-console.json` is retained as a failed pre-freeze sample, not accepted as clean runtime evidence. It rendered the correctly sized foreground canvas after WebGPU readiness, but readiness first timed out and React then reported a synchronous-root-unmount race eight milliseconds after device readiness and a duplicate post-processing build; Fast Refresh rebuilt shortly afterward. This timing is consistent with the already-observed dev live-update/init interaction, but the absent stack does not establish HMR-only causality. No source repair or arbitrary readiness-timeout increase is justified from this recovered sample. Exactly one post-freeze foreground reload remains required: if it renders the material name/swatch and produces no product exception, the display gate closes; if the same React error repeats after the frozen build, capture a causal stack and reproducible lifecycle before changing renderer code.

## Terminal implementation and production browser acceptance (2026-10-02)

The requested implementation is approved with no remaining HIGH or MED source or product finding. The source, automated, build, persistence, regional renderer, ordinary Paint, Modeling entry, material-summary, and Undo gates described above are all closed. `/tmp/zone-finish-continuation-browser.log` contains the consolidated sequence.

The final frozen development reload retained one diagnostic boundary. Both pre-freeze and post-freeze development runs reproduced React's `Attempted to synchronously unmount a root while React was already rendering` immediately after asynchronous WebGPU readiness while the correctly sized canvas continued rendering. This disproves HMR as the sole trigger. The evidence points to the development StrictMode lifecycle of Drei `Html`: the viewer store defaults `showZones` to true, Zone renderers mount separate ReactDOM roots through [`Html`](/Users/changseok/editor/node_modules/.bun/@react-three+drei@10.7.7+fc330d7da5c36198/node_modules/@react-three/drei/web/Html.js:141), and editor [`ZoneSystem`](/Users/changseok/editor/packages/editor/src/components/systems/zone/zone-system.tsx:21) derives `showZones` from the default `elements` layer after the asynchronous R3F scene commit. Drei's cleanup synchronously calls `currentRoot.unmount()` at line 156, which is the exact ReactDOM operation named by the diagnostic. The absence of a captured stack prevents assigning the warning to one specific Html instance, so no upstream patch, deferred unmount, renderer remount, or timeout increase is authorized.

The same frozen production build provides the severity boundary. The isolated loopback production instance on port 3004 rendered a 2568×1569 canvas with CSS bounds 1712×1046, selected the room in 2D, returned to 3D, and displayed the actual partial-wall `Rustic Brick` label with the correct brick thumbnail. `/tmp/zone-finish-final-production-init-console.json`, `/tmp/zone-finish-final-production-display.dom.txt`, and `/tmp/zone-finish-final-production-canvas.jpg` contain that evidence. The React unmount diagnostic was absent. Viewer readiness warned at `03:13:19.834` while the automated tab was backgrounded, then WebGPU reported ready at `03:13:24.621` after foreground activation; the canvas rendered and remained interactive. This remains a recovered timing warning, not an error-free readiness claim.

The final actual production mutation sequence also passes. `/tmp/zone-finish-final-production-apply.json` version 25 has 108 nodes and canonical graph SHA-256 `236c1e1380beed06f6934f6f791a4a53f301bfda70a52033572a95a2f2abe78f`. Exactly four existing captured walls changed from the baseline: only their existing `finishRegions` material refs became Polished Concrete; node identities, region identities, normalized ranges, semantic sides, geometry, opposite faces, and every other node remained equal. The applied surface is visible in `/tmp/zone-finish-final-production-apply.jpg`, `production-apply-visible.jpg`, and `production-apply-interior.jpg`. One native `Cmd+Z` produced version 26 exactly equal to frozen baseline version 23 and the original copied baseline, including canonical SHA-256 `322a8dfb357252494596e2e994ba1fbdbee6af53bc906c6a8b2833829b3b79bc`; `/tmp/zone-finish-final-production-undo.jpg` corroborates it. `/tmp/zone-finish-final-production-errors.json` is an empty array for the complete production initialization, 2D-to-3D navigation, apply, camera move, and Undo sequence.

The isolated production process was stopped with a controlled `Ctrl+C` after evidence capture and its owned tab was closed. The existing development listener PID `79978` on port 3002 remained intact. A final direct check of original scene version 48 again proved HTTP 200 and canonical graph SHA-256 `6bfa6af80c00af2d89fce53e6e247dd53d7c92cbfebd6d76bfd0fe90201c783d`, recorded in `/tmp/zone-finish-final-original-safety.json`.

Declared limits remain unchanged: real same-company sharing could not be exercised because two distinct already-authorized same-company INTM sessions were unavailable; independent-profile server persistence/listing was proved instead. Partial curved-wall finish regions and partial-region assembly export remain explicit exclusions. The standalone `packages/editor` typecheck still has the known cross-package TS6059 import-boundary failure; the app typecheck, focused package tests, changed-file Biome, viewer build, and isolated production builds passed. These limits do not block the implemented straight-wall Zone finish, local/server template, actual material display, ordinary Paint, or atomic Undo behavior accepted here.

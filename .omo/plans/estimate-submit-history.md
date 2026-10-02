# Estimate submission history — implementation contract

## Result and boundary

Persist a small audit history for each INTM estimate document that was actually created, including partial and all-item-failure results. Reuse the existing scene metadata host and autosave/version pipeline; do not add a database, API persistence route, retry flow, or “update existing estimate” behavior. Do not touch Zone/paint, `scene-loader.tsx`, or `app/editor/page.tsx`.

The modeling-agent manual does not change: this is INTM integration metadata and Stats UI, not a modeling operation or AI control contract.

## Owned files

- `apps/editor/components/stats-tab.tsx`
- `apps/editor/app/api/intm/materials/route.ts` (add the server-configured public INTM base to the existing bootstrap response)
- `apps/editor/lib/scene-project-link.ts`
- `apps/editor/lib/scene-project-link.test.ts`
- `packages/editor/src/i18n/dictionary/furniture.ts`

No new helper is needed unless extracting a pure URL/history parser materially shortens `scene-project-link.ts`; if extracted, keep it under `apps/editor/lib/` with one focused test file.

## Metadata contract

Add `intmEstimateSubmissions` beside `intmProjectId` on the same node returned by `projectLinkHost`. Store newest first and retain at most **10** valid v1 records. Append from a fresh `useScene.getState()` snapshot so the async response cannot overwrite metadata changed while the request was in flight. Preserve unrelated metadata and the current project link. De-duplicate by `(projectId, estimateId)` before prepending.

```ts
type SceneEstimateSubmissionV1 = {
  schemaVersion: 1
  projectId: string
  title: string
  estimateId: string
  estimateUrl: string
  submittedAt: string // client receipt time, ISO-8601
  itemCount: number   // successfully added items
  failedItems: number
  items: EstimateItemPayload[] // exact toEstimateItems(draft) attempted for this document
}
```

`items.length` must equal `itemCount + failedItems`. The reader accepts only plain, structurally valid v1 records, valid ISO timestamps, non-negative integer counts, non-empty identifiers/title, and an item array; it drops malformed entries rather than throwing. Keep the complete attempted-item snapshot and bound growth by record count, not by silently truncating individual estimates.

Append only when `SubmitResult.ok === true`, because that means the INTM document exists even when `itemCount === 0`. Do not append network/refusal failures where no document ID was created. Keep the existing immediate success/partial/all-failed result UI.

## UI and link trust

Read history from scene state so JSON reload restores it. Show a compact “previous estimates for this project” list below the create result, filtered by exact `record.projectId === projectId` where `projectId` is the currently selected picker value. Changing the picker from project A to B must immediately remove A’s rows and links; switching back may reveal them again. Each row shows title, localized timestamp, successful/failed/total counts, and a link when trusted.

Treat persisted URLs as untrusted scene data. The editor is served from `https://apt.intm.kr` while production `INTM_BASE_URL` may be `https://intm.kr`, so browser same-origin is not a valid trust rule. Extend the existing `GET /api/intm/materials` response with `intmBaseUrl`, sourced only from the normalized server-side `intmBaseUrl()` configuration (or `null` when unconfigured). This response is already StatsTab's authenticated bootstrap and avoids a new route or storage abstraction.

Build a canonical history link from that trusted response value and the stored estimate ID. The persisted `estimateUrl` is audit data only and is never assigned directly to `href`. A history anchor is renderable only when all checks pass:

1. The server-provided `intmBaseUrl` parses as HTTP(S), has no username/password/query/hash, and is reduced to its origin.
2. The canonical URL is `${trustedIntmOrigin}/newportal/estimates/${encodeURIComponent(record.estimateId)}/edit`.
3. The stored `estimateUrl` parses, has no credentials/query/hash, and exactly equals the canonical URL. A mismatch is corruption or stale configuration, not a reason to repair or guess.

Use the canonical URL, not the stored string, as the anchor. Never repair, rebase, or guess a rejected URL. Keep the row/counts visible but omit the anchor and show a localized unavailable-link label. The current non-persisted success link remains the server-built `SubmitResult.estimateUrl`.

## Acceptance criteria

- Full success, partial success, and all-item-failure responses each create one v1 history record with exact counts and attempted items; a pre-document failure creates none.
- The append patch uses the existing building/root fallback host, preserves `intmProjectId` and unrelated metadata, de-duplicates, and keeps only the newest 10 valid records.
- After autosave completes and the scene is reloaded, the matching project’s prior submission remains visible with the same counts/title/time.
- Selecting another project cannot display or link a record filed under the previous project.
- A URL on the configured INTM origin becomes an anchor even when the editor itself is on `apt.intm.kr`; an arbitrary origin, credentialed/queried/hashed URL, wrong ID/path, or stored/canonical mismatch never becomes one.
- No INTM retry/update/history API, storage abstraction, or changes to excluded editor/Zone/paint files are introduced.

## Focused verification

1. Extend `scene-project-link.test.ts` for: host/metadata preservation; JSON round trip; full/partial/all-failed records; no append for failed result; project filtering; de-duplication; newest-first cap at 10; malformed-record rejection; canonical `https://intm.kr` links while the editor origin is `https://apt.intm.kr`; and every trusted-URL rejection listed above. Make the URL helper accept the server-provided base explicitly so Bun tests do not require a browser global.
2. Run `bun test apps/editor/lib/scene-project-link.test.ts apps/editor/lib/estimate-submit.test.ts`.
3. Run `bunx biome check apps/editor/components/stats-tab.tsx apps/editor/app/api/intm/materials/route.ts apps/editor/lib/scene-project-link.ts apps/editor/lib/scene-project-link.test.ts packages/editor/src/i18n/dictionary/furniture.ts` and `bun run check-types --filter=editor` (or the repository’s equivalent focused editor typecheck).
4. Review only the owned-file diff and confirm excluded dirty files are untouched.

## Browser-safe save/reopen proof

Run an isolated source snapshot on a separate port with `PASCAL_DB_PATH` pointing to a fresh temporary SQLite file. Create a local fixture scene containing a building node. Mock every browser request under `/api/intm/*`; the catalogue fixture must return `intmBaseUrl: "https://intm.kr"`, alongside deterministic catalogue/project fixtures and one partial-success estimate response. Do not click the generated INTM link—assert its `href` only.

Wait for the full editor to hydrate (loaded floor/view text visible), then open Stats normally, submit, and wait for the real local autosave `PUT /api/scenes/[id]` to return 200. Verify the saved graph contains both metadata keys and the v1 snapshot. Reload the same scene from the local scene API, wait for hydration again, open Stats, and verify the row/counts and canonical `https://intm.kr/newportal/estimates/.../edit` link persist even though the editor origin differs. Select a second mocked project and verify the first project’s row/link disappears; switch back and verify it returns. Load a fixture record with an arbitrary-origin URL and verify its counts remain visible without an anchor.

Network evidence must show zero actual external INTM/API mutations. Known editor static-asset GETs (for example Iconify/Unisvg or configured texture hosts) may be allowed or mocked and must be classified separately; they are not mutation failures. Record zero console errors and zero page errors for the exercised flow.

## Verified deployment contract

Production verification on 2026-10-02 confirmed the editor runs at `https://apt.intm.kr` and its PM2 process has `INTM_BASE_URL=https://intm.kr`. The split-origin canonical-link acceptance case is therefore required production behavior. Browser origin and the stale same-origin comment in `intm-session.ts` are not authority. A later configuration change intentionally makes old mismatched stored links unavailable rather than silently retargeting them.

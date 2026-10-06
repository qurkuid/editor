# Wall related-zone navigation: implementation contract

Planning only; no product source changed. Directly inspected current source, not prior reports. Local server responded HTTP 307 to /apt on localhost:3002. The attempt-status CLI is unavailable (missing OMO 5.1.0 dist/cli/index.js), so evidence uses .omo/evidence.

## Finding and smallest desktop contract

The shared RelatedZonePanel renders static div cards. Both wall and slab panels reuse it. Replace each card wrapper with a native button type=button, preserving content, adding w-full/text-left and visible hover/focus treatment. Subscribe to useViewer setSelection and useEditor phase/layer actions. On click call setPhase('structure'), setStructureLayer('zones'), then setSelection({zoneId: zone.id}) last, so selection survives phase/layer reset guards and matches direct zone selection. The real setter clears previous selectedIds when zoneId is supplied, preserving building and level context. PanelManager already renders ParametricInspector with nodeId=selectedZoneId when selectedIds is empty. No event emission, camera move, core changes, membership recalculation, or new abstraction is needed. Programmatic navigation is not selection:canvas-node-click.

Source assignment: packages/editor/src/components/ui/panels/related-zone-panel.tsx. Focused runnable test can live alongside it as related-zone-panel.test.tsx, following Bun + React SSR conventions. No changes required in dirty manual or quantity files for a navigation-only affordance.

## Acceptance and captured artifacts required from executor

1. Existing wall inspector lists its related zones as accessible native buttons; mouse-click desired card changes selected zone, clears wall selection and renders matching zone name/room/quantities. Test the real UI, not only a setter invocation. Capture before.png, after.png, runtime.json with selected zone ID and unchanged scene content/history.
2. Shared wall with two distinct zones: reselect wall and click each; each opens the corresponding zone. Unrelated zone remains absent. Capture two-zone-navigation.json and screenshots.
3. Tab then Enter/Space on the button opens the same information. Capture keyboard.json. Native button supplies keyboard semantics; do not write a custom key handler.
4. Shared slab consumer retains text/area and now navigates consistently. A wall with no related zones still hides the section. Run bun test packages/editor/src/lib/zone-content.test.ts packages/editor/src/components/ui/panels/related-zone-panel.test.tsx > focused-tests.log, with exit code captured separately.
5. Run bun run --cwd apps/editor check-types, bunx biome check <changed files>, bun run --cwd apps/editor build; record exact commands, exit codes and nonempty output files. Capture browser console errors and local URL. A code/string test alone does not prove the navigation.
6. Commit/push/deploy belongs to root/executor. Stage only assigned clean-source files. Preserve all pre-existing dirty files. Verify commit, remote SHA, deployment runtime and production URL by fresh evidence, then repeat actual public click flow.

## Mobile constraint discovered directly

PanelManager's mobile branch resolves only selectedIds, not zoneId; MobilePanelLayer also closes its sheet whenever node ID changes. Therefore a zoneId-only change proves desktop navigation, NOT mobile navigation. Do not claim mobile success. Include the following bounded mobile completion requested by root: make a second edit in panel-manager.tsx: resolve a zoneId-only selected node and pass explicit nodeId/onClose to its ParametricInspector; preserve an already-open sheet for inspector navigation to a zone. Keep ordinary selection changes collapsing as before. Add mobile regression and test tap through an open wall sheet at 390x844. Do not put zone IDs in both selectedIds and zoneId just to evade this existing mobile limitation: close/deselect semantics become inconsistent.

## Verified evidence

- owner.txt: invocation rg, exit 0; binary observable both wall and slab mount the same RelatedZonePanel.
- selection.txt: invocation sed, exit 0; binary observable zoneId update clears selectedIds when omitted.
- inspector.txt: invocation sed, exit 0; binary observable desktop zone branch exists; mobile branch only uses selectedNodeType/selectedNode.
- dirty.txt: invocation git status --short, exit 0; pre-existing unrelated edits listed.

Memory used only to guide preservation and evidence expectations (MEMORY.md:37-41, rollout 01a0f592-606f-7fb2-83e1-a9d281c82970); code conclusions are current direct reads.

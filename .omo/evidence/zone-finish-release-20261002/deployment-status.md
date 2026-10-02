# Zone finish production deployment

- Source: 999b2771b3a0f1aa84f18d74fda82c77b29aad08, pushed to fork deploy/floorplan
- Scope: reviewed 61 files; unrelated dirty work preserved
- Validation: 248 focused tests, app types, changed-file static checks, production build passed
- CI: branch excluded by repository main-only Actions; clean isolated local validation used
- Release: /Volumes/DATABASE/floorplan-releases/20261002-999b2771
- Runtime BUILD_ID: teZZYbe0c3JXeZCui2Wr5
- PM2: apt-subdomain, PID 48938, online, PORT 3024
- Public /apt: HTTP 200; response HTML contains matching new BUILD_ID
- SQLite online backup completed before activation
- Previous release/config preserved; automatic rollback configured for initial health failure
- Synthetic QA fixture: qa-zone-finish-999b2771, initialized with 8 nodes
- Live desktop browser acceptance: PASS. Wall Aged Brick apply, one Undo to Rustic Brick; floor/ceiling creation and apply; private Zone/Home server template save; changed wall restored by Zone apply, Undo, Home apply; reload retained all finishes and both templates; real textured 3D interior visible; console errors [].
- Mobile 390x844: existing property sheet shows actions only, no injected Zone finish footer. Source cause: mobile PanelManager calls panelForType(selectedNodeType) without inspectorFooter. Desktop scope deployed; mobile access limitation remains explicit.

Known gaps: standalone packages/editor retains baseline TS6059 test-import issue; app typecheck and production build passed. Two distinct same-company accounts not available for live sharing verification.

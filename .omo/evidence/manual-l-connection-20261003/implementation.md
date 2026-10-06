# Manual L connection implementation evidence

- Rollout: `gpt-5.6-luna/max`
- Scope: pure core L-corner planning and validation, 2D target projection and controls, shared manual modeling guide assertions.
- Core files: `packages/core/src/lib/room-boundary.ts`, `packages/core/src/lib/room-boundary-l.test.ts`, `packages/core/src/index.ts`.
- Editor files: `packages/editor/src/components/editor-2d/room-boundary-connect.tsx`, `packages/editor/src/components/editor-2d/room-boundary-interaction.ts`, `packages/editor/src/components/editor-2d/room-boundary-interaction.test.ts`.
- Manual files: `packages/mcp/src/modeling-agent-manual.ts`, `packages/mcp/src/ontology-manual.test.ts`, `packages/mcp/src/resources/resources.test.ts`, `apps/editor/lib/ai-provider.test.ts`.

## Fresh checks

- `bun test packages/core/src/lib/room-boundary-l.test.ts packages/core/src/lib/room-boundary-manual.test.ts packages/editor/src/components/editor-2d/room-boundary-interaction.test.ts`: 28 pass, 0 fail.
- `bun test packages/mcp/src/ontology-manual.test.ts packages/mcp/src/resources/resources.test.ts`: 37 pass, 0 fail.
- `bun test apps/editor/lib/ai-provider.test.ts`: 18 pass, 0 fail after rebuilding `packages/mcp` so the app package export contains the current manual.
- `bun run build` in `packages/core`: pass.
- `bun run build` in `packages/mcp`: pass.
- `bunx tsgo --noEmit` in `packages/editor`: pass after rebuilding core declarations.
- `bunx biome check` on all owned implementation/test/manual files: pass.

## Geometry evidence

- L planning is pure and returns two stable-id creates plus two leg measurements; selected source/target nodes and children are not updated.
- Direct mode ignores the optional L-only projected target point and retains supporting-line behavior.
- L body hits are projected onto the target centerline and validated on-segment; endpoint and interior T contacts are supported.
- New ids are generated once in the UI and rejected by core when duplicated or already present.
- Final source/target host checks use miter footprints for non-intended near contacts, while unrelated centerline crossings and nearby curved obstacles remain conservative rejections; far-away curves are skipped by the expanded broad phase.
- Intended endpoint contacts also reject near-collinear retracing into either selected host before the footprint gate, covering source and target endpoint P1 regressions.

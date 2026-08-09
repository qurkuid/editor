---
name: develop-pascal-editor
description: Implement, modify, debug, and verify features in pascalorg/editor. Use whenever working in /Users/changseok/editor or the Pascal editor packages on modeling or Body topology, drawing and placement tools, 2D/3D interactions, selection and affordances, materials or RawPainter, AI scene control, reference images, units and dimensions, sidebar UI, or editor runtime defects.
---

# Develop Pascal Editor

Deliver the requested behavior on the real editor surface while preserving the repository's layer boundaries, current scene data, and unrelated worktree changes.

## Start with the current truth

1. Read `AGENTS.md` and the architecture pages named for the touched area.
2. Read `packages/mcp/src/modeling-agent-manual.ts` before any scene-modeling work.
3. Inspect `git status --short`; treat existing tracked and untracked changes as user work.
4. Search the node registry, schemas, tools, panels, and tests before adding a new abstraction. Extend an existing capability when it already owns the behavior.
5. Check the running editor at `http://localhost:3002` before starting or restarting it. Do not replace a user-managed dev server without an explicit request.
6. Define an observable success condition: exact UI entry, interaction sequence, scene mutation, undo behavior, and validation evidence.

## Keep the modeling manual current

- Update `packages/mcp/src/modeling-agent-manual.ts` in the same change whenever modeling behavior, AI operations, MCP capabilities, interaction modifiers, units, validation, or agent execution rules change.
- Import or serve `MODELING_AGENT_MANUAL`; never copy its text into another prompt or guide.
- Add or update tests proving `pascal://agent-guide` and `buildAiModelingPrompt` expose the new instruction.

## Required model relay

- Use `gpt-5.6-sol` with `high` reasoning for requirements analysis, architecture, implementation planning, acceptance criteria, and verification-plan design.
- Hand the approved plan to `gpt-5.6-luna` with `max` reasoning for code implementation, focused fixes, tests, browser verification, and completion of the validation loop.
- Keep the Sol planning artifact as the implementation contract. Luna may make local implementation decisions but must return to Sol planning when evidence invalidates the architecture or acceptance criteria.
- Apply this relay to both Codex and Claude-driven Pascal Editor work when their execution surface provides the requested model adapter.
- On Codex, use the installed `luna-max` agent type for the Luna implementation lane. Do not combine an explicit model override with another fixed `agent_type`; the role TOML wins, and the current native child surface may ignore a model-only override. Spawn `luna-max` with isolated context, then verify the resolved model and effort before assigning implementation work.
- Verify the model and effort actually used. If Luna or `max` is unavailable, do not silently substitute another model or effort; report the unavailable route before continuing with a different profile.

## Respect package ownership

- Put schemas, topology, semantic IDs, transforms, validation, and pure scene logic in `packages/core`.
- Put reusable node definitions, geometry contributions, node tools, paint adapters, and affordances in `packages/nodes`.
- Put editor workflow, tool selection, panels, HUD, shortcuts, and host integration in `packages/editor` or `apps/editor` according to current ownership.
- Keep Three.js and editor vocabulary out of core. Keep `useEditor`, phases, tools, and paint mode out of viewer.
- Prefer registry-driven geometry and extensions. Do not add a custom viewer renderer when `NodeDefinition.geometry` can represent the node.

## Implement interactions as one complete contract

For a placement, drawing, move, or reshape change:

1. Store committed data in `useScene`; keep pointer-move previews ephemeral.
2. Enter and leave the correct `useInteractionScope` state. Clean up previews and input handlers on cancel, commit, tool switch, and unmount.
3. Use the shared snapping-mode helpers. Do not reintroduce Shift-based bypass behavior; Alt is the force/free modifier.
4. Use the shared draft-length input so typed dimensions appear in the bottom HUD and remain unit-aware. Internal geometry stays in metres.
5. Implement applicable behavior in both 3D and floor-plan tools in the same change. A passing 3D interaction is not evidence for 2D parity.
6. Make the feature discoverable from the user-facing sidebar or contextual panel. A registered tool without a visible entry is incomplete.
7. Commit one undoable scene mutation per gesture; do not write scene geometry on every pointer move.

## Direct-modeling Body rules

- Preserve `BodyNode` half-edge topology and persistent vertex, edge, loop, and face IDs.
- Create planar faces through `createPlanarFaceBody`; use `pushPullBodyFace` for initial extrusion and later closed-solid face movement.
- Render one mesh per logical face with `userData.bodyId`, `userData.faceId`, and `userData.pascalNodeId`. Resolve editing targets from the clicked mesh instead of assuming `faces[0]`.
- Reject degenerate loops, zero-distance extrusion, collapsing face moves, holes unsupported by an operation, and curved edges unsupported by the kernel before mutation.
- Preserve face material refs and UV frames through topology edits.
- Keep primitive draft math pure and tested separately from React pointer handling.

## Material and AI integration rules

- Apply materials by stable scene material references; do not rewrite topology to paint a face.
- Route external material images through the existing asset/proxy/storage path and validate a real textured surface, not only a successful catalog response.
- Preserve physical material size and cache seamless results locally so the same source is not processed repeatedly.
- Give AI structured scene state and deterministic operations. Do not make viewport screenshots the scene-understanding contract.
- Validate the complete AI plan before applying it, apply it as one undo step, and keep CLI/OAuth provider concerns outside the modeling kernel.
- Do not ship a user-facing modeling capability as AI-only. The same core operation must be reachable through a visible direct UI path such as the modeling sidebar, contextual panel, or floating action menu unless the user explicitly requests an AI-only workflow.
- Keep AI and direct UI behavior equivalent: the same defaults, validation, scene mutation, units, undo behavior, and resulting node schema must apply to both paths.

## Verification loop

Start with a failing focused test, implement the smallest complete behavior, then run these gates in order:

1. Focused pure-logic and component tests: `bun test <changed tests>`.
2. Package compile: `bun run --cwd packages/nodes build` when node code changed.
3. Editor types: `bun run --cwd apps/editor check-types`.
4. Changed-file static check: `bunx biome check <changed files>`.
5. Relevant regression suite, including core topology and AI operations when touched.
6. Real browser workflow at `http://localhost:3002`: activate the visible entry, perform the exact clicks and typed dimension, confirm the resulting control/state, and inspect console errors.
   When AI can invoke the feature, verify both the AI-chat path and the direct UI path before declaring it complete.
7. Production build: `bun run --cwd apps/editor build` for feature-sized changes.

Remove only artifacts created for the test. Preserve the user's scene and leave the useful editor tab open. Report build warnings separately from failures.

## Completion gate

Do not claim completion until the feature is reachable through direct UI, AI and direct paths agree when AI support exists, the intended scene mutation works, applicable 2D/3D paths agree, undo/cancel remains safe, focused tests and types pass, the production build succeeds, and browser console errors are checked. State any unsupported geometry case or untested runtime path explicitly.

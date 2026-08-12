# Phase 0 modeling baseline

This is the frozen Phase 0 baseline for the operation/ontology vertical slice. It is an implementation inventory, not a second modeling manual. The canonical operation fields and behavior remain in `packages/core/src/modeling/operations.ts` and `packages/mcp/src/modeling-agent-manual.ts`.

## Operation and validation matrix

| Operation | Direct UI | Internal AI | MCP | Validation evidence | Competency goldens |
| --- | --- | --- | --- | --- | --- |
| Push/Pull | 3D face action, ephemeral preview, one undo | structured `pushPullBodyFace` patch | `preflight_modeling_operation` + `commit_modeling_operation` | core input schema, topology executor, preview/commit/undo tests | CQ-01, CQ-02, CQ-10 |
| Imprint | 3D face draft, flat or signed profile | structured `imprintBodyFace` patch | preflight + commit | coplanar profile validation, deterministic remap, preview/commit/undo tests | CQ-02, CQ-11 |
| Offset | 3D face action, signed miter profile | structured `offsetBodyFace` patch | preflight + commit | planar host/collapse/self-intersection diagnostics and cross-surface hash test | CQ-01, CQ-11 |
| Transform | 2D/3D move/transform sessions | structured `transformBody` patch | preflight + commit | translation/rotation/scale schema, one history step, hash parity | CQ-06, CQ-11 |
| Paint | 2D/3D face capability, preview/commit | structured `paintBodyFace` patch | preflight + commit with SceneMaterial | required material contract, reusable scene ref, save/reopen proof | CQ-01, CQ-09 |
| Ontology lookup | read-only selection/host context | selected-node semantic refs | `query_design_ontology` + `explain_design_rule` | pack hash/integrity/license/version gate; unavailable lookup is non-mutating | CQ-03–CQ-09, CQ-12 |

The matrix records the same operation contract on each surface: typed input, bounded preview, one commit, affected-node diagnostics, and one undo step. A surface omission is a failing contract test, not an undocumented fallback.

## Fixed representative node kinds

The baseline set is the first twenty built-in node kinds in `packages/nodes/src/index.ts`; the order is stable for Phase 0 evidence and must not be silently expanded by an external pack:

`shelf`, `body`, `spawn`, `wall`, `fence`, `slab`, `ceiling`, `door`, `window`, `cabinet`, `cabinet-module`, `item`, `lighting-circuit`, `lighting-fixture`, `lighting-switch`, `column`, `elevator`, `roof`, `roof-segment`, `stair`.

## Acquisition gate

Decision: **do not acquire an external OpenCrab Marketplace pack for Phase 0**.

Result: use the own MIT-licensed `pascal-architecture-core` Pack v1. The current slice has implementation-backed evidence, stable Pascal ids, and a read-only unavailable-pack fallback; no authenticated marketplace candidate or reviewable license/evidence bundle was supplied. External BOT/IFC/bSDD identifiers remain mapping-only values and are not execution dependencies.

## Competency-question links

The twelve executable question/evidence goldens are `CQ-01` through `CQ-12` in `ontology/pascal-architecture-core/sample_queries.json`. They are queryable through `query_design_ontology` with `questionId` and are version-pinned with `packVersion`.

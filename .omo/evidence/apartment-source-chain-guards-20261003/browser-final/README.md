# Lane B browser-final preparation

Status: **READY_BROWSER_ONLY_AFTER_SOURCE_FREEZE**. This directory contains only an isolated QA fixture and hash-bound preparation evidence for the approved source-chain guard work.

## What is prepared

- `qa-scenes.db` is a private SQLite backup of the Lane A QA database. Its integrity check is recorded in `preparation-manifest-browser-final.json`; the source DB and its WAL/SHM sidecars were not edited.
- `inputs/` contains the exact p07 V15 document, matching vector-cache copy, OCR cache, and source image.
- Port `3010` is free for the future owned runtime. Existing runtimes on `3002`, `3008`, `3009`, and `3011` were observed and left running.
- The intended build output is `apps/editor/.next-source-chain-guards-20261003`; it was absent during preparation.

## Stop boundary

No product source was changed and no candidate build, browser interaction, import/reimport, replay, saved-scene mutation, or deployment was run. Continue only after the parent records an explicit final Lane B source freeze. The current product hashes in the manifest describe dirty working-tree state and are not a final acceptance claim.

The exact p07 V15 input is `3FO40C71IWG4.json` with SHA-256 `7f76c71f5989a256c9a0c599c92dfef69841e3922dd172e76c8cd14a68de9e1a`, `docVersion: 15`, 41 walls, 15 openings, and 9 rooms.

# R4 browser replay preparation

Prepared read-only for the approved R4 replay. The directory contains a byte-identical copy of the Lane A p07 pre-import QA database at the 66-node state, exact V15 p07 and p30 vector/cache inputs, source images, and OCR caches.

An exact-plan scan across 21 evidence SQLite databases found no saved scene containing p30 plan `3FO3TOWE773J`. The private fixture plan is recorded in `p30-preparation.json`: after the explicit R4 source-freeze/review gate, create a fresh QA scene through the visible apartment UI in this copied database, apply the p30 guide, and capture its scene ID before one model run.

No product source, existing server, build output, saved scene, or browser tab was changed during preparation. Build and UI replay remain blocked until the explicit R4 source-freeze/review gate.

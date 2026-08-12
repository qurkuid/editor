# Pascal Architecture Core

Pack v1 is the small, implementation-backed ontology boundary used by Pascal Editor and its MCP server.

The pack is licensed under MIT. `manifest.json` pins semantic version `1.0.0` and SHA-256 hashes for every companion artifact. Pascal identifiers are stable local ids; BOT, IFC, and bSDD identifiers appear only under `mappings`.

The first vertical slice covers Body, Wall, Window, Space, MEP terminals, the deterministic Body operation contract, the Window-hosted-by-Wall relationship, and evidence-backed version/host rules. `sample_queries.json` contains the three discovery examples plus twelve executable competency-question goldens (`CQ-01` through `CQ-12`). Query consumers must treat the pack as read-only data and must bound result counts.

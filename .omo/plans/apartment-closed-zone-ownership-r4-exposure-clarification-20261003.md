# Sol approved canonical exposure clarification

Base contract: `apartment-closed-zone-ownership-r4-20261003.md`, SHA256 `47a6e6f1e4fa306cf82e0d9b144755d7b001263e862fd3a6dfbfec4feb30d58e`. Product logic and acceptance are unchanged.


The existing canonical exposure file `packages/mcp/src/ontology-manual.test.ts` is also in scope. Replace its obsolete Zone-policy sentence assertion with `Every confirmed closed apartment Space receives exactly one enclosed physical Zone`. Preserve generatedFrom detected-space, split-face/open-review, direct-UI and atomic-boundary assertions. This aligns all three existing manual exposure surfaces and permits no product logic or weaker assertion.

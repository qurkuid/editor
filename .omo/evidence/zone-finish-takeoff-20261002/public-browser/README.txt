Prepared public QA only; no production scene was created in this preparation step.

Run only after root confirms activation and BUILD_ID match, with QA_ACTIVATED=1.
Expected command: QA_ACTIVATED=1 QA_BASE_URL=https://apt.intm.kr node zone-finish-public-qa.mjs

The script creates one fresh synthetic QA scene, mocks only catalogue/static asset APIs, and verifies visible Zone apply -> Stats 5/2/3 sqm -> undo/redo -> scene GET/PUT reload.

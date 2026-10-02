# Source review before implementation

Reviewed by missing_wall_review, resolved gpt-5.6-sol/high, 2026-09-30.

Keep the default short-thin wall filter. Recover only rejected jamb fragments with a retained wall connection, physical opening width, source brightness/contrast, local separation, and clustered fixture evidence. The isolated 15px runs at source (547.5,402)-(547.5,387) and (774.5,354)-(774.5,338.5) remain rejected.

The left boundary has two doors, with source-supported barrier spans approximately (457,339)-(484,366) and (484,366)-(514,396). Their hypotheses are 0.579 and 0.368. A single long window is incorrect. The normal door threshold remains; a lower threshold needs the additional bounded fixture evidence.

The top dress room has semantic door leaf (917,174)-(954,174) and full room barrier (906,174.5)-(960,174.5). Keep those distinct. Its 0.372 square metre component needs OCR-label protection from area filtering.

Room sliver absorption must use the full barrier complement. OCR room-label overlap may protect existing connected components; it cannot create walls or Voronoi boundaries. Preserve global dark barriers, removing only actual OCR text pixels if needed.

The reviewer verified 15 components in an in-memory source experiment with these barriers and protection rules. This is planning evidence, not completed product or browser verification.

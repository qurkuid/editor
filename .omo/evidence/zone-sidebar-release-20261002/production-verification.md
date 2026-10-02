# Zone sidebar production release

- Commit: `2528a9b0631b469727568e198147414465268ef5`, pushed to public `qurkuid/editor` `deploy/floorplan`.
- PM2: `apt-subdomain`, PID 36944, online, PORT 3024.
- Runtime cwd: `/Volumes/DATABASE/floorplan-releases/20261002-2528a9b0/apps/editor`.
- Runtime HEAD matches commit; BUILD_ID `FcohPi3uE3mBIRUWgnWRW`.
- Public `/apt`: HTTP 200.
- Browser-loaded `/_next/static/chunks/0en87jtwlyur1.js` matches server SHA256 `fea0745e83ce4b3ead95fed11557b440b4392a5add96ad5986baf96d6ed4e312`.
- Authenticated fresh Chrome scene `/scene/8552ea8b9254`: default collapsed 마감재; expanding shows all-wall/ceiling/floor entries; legacy finish text inputs absent.
- Wall selection: 소속 구역 displays 발코니, 4.63 m² and enclosure/use information.
- Room 1 Slab selection: 소속 구역 displays 현관 1.93 m² and 거실 24.65 m².
- All-wall dialog: wall paper / 개나리벽지 first four cards share y=385.09 at distinct x=1000.18,1186.22,1372.27,1558.32; fifth starts next row y=653.05. Screenshot `production-four-columns.png`.
- Desktop interaction errors: none before viewport changes; final fresh desktop load renders model and logs no errors.
- Mobile limitation: 390px switches to existing mobile shell without desktop inspector. Viewport switching destroys WebGPU device and logs recovery-required errors. Mobile inspector flow is not verified. Viewport reset; fresh desktop confirmed healthy.
- No materials applied or geometry changed on the existing production scene. No production QA fixture created (unauthenticated API refused 401). Temporary tabs closed.
- Local synthetic-scene checks already proved shared wall/floor membership, all-wall finish application + Undo, 2D move + Undo, delete boundary retention + Undo. 3D movement observed, 3D Undo remains unverified. Existing core boundary-sync behavior retained and strengthened tests run.
- Clean release validation: 106 tests pass, 0 failures, 443 assertions; package builds, app typecheck, scoped Biome and local/server production builds pass. This branch does not trigger repository CI.
- Unrelated apartment/guide dirty changes remain in the source checkout and were excluded from the 20-file commit.

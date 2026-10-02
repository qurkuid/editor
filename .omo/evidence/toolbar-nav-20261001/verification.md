# Toolbar navigation deployment

- Source and pushed fork/deploy/floorplan: d69669a1dbb868f22e09196367e020cf3dbaa373
- Scope: apps/editor/components/scene-loader.tsx, top-4 right-4 to top-14 right-3.
- Server release: /Volumes/DATABASE/floorplan-releases/20261001-d69669a1
- BUILD_ID: VRM-2jjurLkoTKDIsEF-v
- PM2: apt-subdomain online, PID 45631, cwd points to the new release's apps/editor.
- Backup and rollback configuration: /Volumes/DATABASE/floorplan-deploy-backups/20261001-d69669a1/ecosystem-previous.config.cjs
- Server build completed; local Biome, editor typecheck and diff check passed.
- Production browser: https://apt.intm.kr/scene/1db72a607919 loaded in 2D. Navigation starts at 55.99px; display trigger ends at 43.08px. No intersection.
- Actual display-button click opened the menu containing floorplan mode and annotation settings.
- Same no-intersection and menu-click checks passed at 390x844; viewport override reset.
- Browser captured errors: none.
- Original user tab and scene content were preserved. No scene, database, extractor or unrelated service mutations.
- Screenshot: /private/tmp/pascal-toolbar-deployed.png

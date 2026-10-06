# Browser verification

Verified on isolated local source runtime http://localhost:3014/scene/ccf7719c186a, using a backup copy of the QA database. Existing servers and original scene were preserved.

- Before: default SVG focus outline `auto 5px` renders a huge disk in the metre-based floorplan. `before.png` and `before-focus.json`.
- After: click the actual yellow endpoint circle; active marker outline is `none`, keyboard focus ring hidden, wall inspector length 2031mm. `after.png`, `browser-click.json`.
- Tab: next marker receives visible custom ring. Enter and Space select the wall and show 5060mm. `browser-keyboard.json`, `after-keyboard.png`.
- Zoom: changed SVG viewBox width from 33.87858699470047 to 4.038135852096588; focus ring remains 18px diameter and 2px stroke. `browser-zoom.json`.
- Browser console errors: none. `console-after.json`.
- Scene API response before/after interactions identical, including graph and graphHash. `fixed-scene-baseline.json`, `fixed-scene-after.json`.
- Isolated production build completed with exit 0. `build.log`.

Only the marker component and its regression tests were edited. No deployment or commit performed.

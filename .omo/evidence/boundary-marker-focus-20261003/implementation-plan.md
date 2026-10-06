# Boundary marker keyboard focus

Scope: preserve existing untracked marker and test code; edit only these files.

Cause supplied by parent browser reproduction: focusable SVG group receives native auto 5px outline in world coordinates.

Approved behavior: suppress native outline with inline outline:none; named Tailwind group exposes a status-colored, fill:none, aria-hidden, non-hit-testing circle only on focus-visible. Radius 9 * unitsPerPixel and stroke 2 * unitsPerPixel. Preserve activation and scene behavior.

Validation: SSR render regression at unitsPerPixel 0.01 and 0.1 for outline, focus-visible class, accessibility, and screen-scaled ring. Parent owns live click/Tab/Enter/Space/zoom proof. Run focused bun test, app check-types, changed-file biome. Production build not selected for this narrow styling fix.

Attempt status CLI unavailable: omo-agent-toolkit reports runtime target missing; use assigned .omo/evidence directory.

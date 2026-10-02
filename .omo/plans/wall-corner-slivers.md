# Corner junction sliver fix contract
Sol high reviewed root cause: independent 1mm centerline cuts create 14 imported walls shorter than 120mm in plan 3FO3Y6P99XL2. Authored source spans 133.913/214.082/252.661mm must remain.

Use existing construction-envelope thickness in apt-vector-scene connectWallJunctions to project contact bands along the host axis. Cluster overlapping bands transitively; omit endpoint-touching groups; keep one deterministic actual intersection for interior groups. Preserve opening guard and disjoint T/X. No post-hoc length deletion or core explicit split change.

Acceptance: actual tracked vector fixture, no generated slivers, original short wall coverage, 16 openings with valid hosts/children, 12 zones/9 auto polygons matching final detected spaces. Focused endpoint/interior/disjoint/opening tests; manual exposed through MCP and AI prompt. Local real UI auto import, 2D/3D corner view, exact undo/redo and console. Build/types/static checks, scoped fork commit and Mac mini release, runtime SHA/BUILD_ID/public byte equality, real production UI reimport.

Production baseline 65 walls; independent probe 52 walls and no <120mm segment, minimum133.913mm, 9 detected spaces. Counts are observed evidence, not a global hard-coded policy.

## Sol high topology correction
Simple endpoint-group suppression breaks exact balcony closure: source w53 loses its shared horizontal intersection, causing r11 to merge into a larger detected space. Endpoint groups must absorb a tip into the actual shared contact: start picks minimum at, end maximum at; interior chooses actual contact nearest band midpoint. Reuse {at,point} boundaries and opening localX subtraction. Do not collapse groups touching both ends, trim through openings, or shorten authored parents below the existing MIN_WALL_LENGTH_M. w53 trim removes25.084mm redundant tip but keeps227.577mm wall; w51 remains133.913mm. Mandatory actual fixture auto zones9 and final polygon equality.

from pathlib import Path
import json
source = Path("packages/editor/src/components/editor-2d/room-boundary-connect.tsx").read_text()
assert "strokeWidth={18 * scale}" in source
assert "selectTarget(wall.id)" in source
walls = [("wall_x_2", 2), ("wall_x_203", 2.03)]
for scale in (.01, .005, .001):
    hits = [id for id, x in walls if abs(2 - x) <= 18 * scale / 2]
    expected = "wall_x_2" if scale == .001 else "wall_x_203"
    assert hits[-1] == expected
    print(json.dumps({"unitsPerPixel": scale, "click": [2, 0], "DOMHits": hits, "selected": hits[-1], "matchesIntended": hits[-1] == "wall_x_2"}))

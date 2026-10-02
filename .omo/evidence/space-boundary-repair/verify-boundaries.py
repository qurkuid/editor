"""Read-only saved-scene check of the four visibly audited source boundaries."""
import json
import math
import sys
from collections import Counter
from pathlib import Path

scene = json.loads(Path(sys.argv[1]).read_text())
frame = json.loads(Path(sys.argv[2]).read_text())["frame"]
nodes = scene["graph"]["nodes"]
walls = [n for n in nodes.values() if n["type"] == "wall"]
zones = [n for n in nodes.values() if n["type"] == "zone"]
tx, ty = frame["sceneTranslationM"]
metres_per_pixel = frame["mmPerPx"] * frame["analysisScale"] / 1000


def point_distance(point, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    length = dx * dx + dy * dy
    t = max(0, min(1, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / length)) if length else 0
    return math.hypot(point[0] - start[0] - t * dx, point[1] - start[1] - t * dy)


boundaries = [
    ("central-dress-divider-top-diagonal", (532, 323), (548, 340)),
    ("central-dress-divider-vertical", (548, 340), (548, 409)),
    ("left-bedroom-diagonal-upper-jamb", (459, 309), (445, 323)),
    ("left-bedroom-diagonal-jamb", (445, 323), (462, 340)),
    ("top-dress-left-side", (913, 147), (913, 174.5)),
    ("top-dress-right-side", (960, 147), (960, 174.5)),
]
results = []
for name, a, b in boundaries:
    distances = []
    for step in range(9):
        fraction = step / 8
        point = (tx + (a[0] + fraction * (b[0] - a[0])) * metres_per_pixel,
                 ty + (a[1] + fraction * (b[1] - a[1])) * metres_per_pixel)
        distances.append(min(point_distance(point, wall["start"], wall["end"]) for wall in walls))
    results.append({"boundary": name, "maxDistanceM": round(max(distances), 4),
                    "pass": max(distances) <= 0.13,
                    "samplesM": [round(d, 4) for d in distances]})

bedroom_names = [n["name"] for n in zones if n.get("metadata", {}).get("cls") == "bedroom"]
opening_types = Counter(n.get("metadata", {}).get("sourceOpeningType") for n in nodes.values()
                        if n["type"] in ("door", "window"))
central_openings = []
target = (tx + 548 * metres_per_pixel, ty + 365 * metres_per_pixel)
for node in nodes.values():
    if node["type"] not in ("door", "window"):
        continue
    host = nodes.get(node.get("wallId"))
    if not host or host["type"] != "wall":
        continue
    t = node.get("wallT")
    if not isinstance(t, (int, float)):
        position = node.get("position")
        length = math.dist(host["start"], host["end"])
        if not position or length <= 0:
            continue
        t = position[0] / length
    center = tuple(host["start"][i] + t * (host["end"][i] - host["start"][i]) for i in (0, 1))
    if math.dist(center, target) < 0.3:
        central_openings.append({"id": node["id"], "type": node.get("metadata", {}).get("sourceOpeningType"),
                                 "openingKind": node.get("openingKind"), "host": host["id"],
                                 "parentMatches": node.get("parentId") == host["id"] and node["id"] in host.get("children", []),
                                 "center": center})
passed = (all(r["pass"] for r in results) and len(zones) == 15
          and len(bedroom_names) == 3 and bedroom_names.count("안방") == 3
          and opening_types == {"door": 9, "window": 3, "opening": 5}
          and len(central_openings) == 1 and central_openings[0]["type"] == "opening"
          and central_openings[0]["openingKind"] == "opening" and central_openings[0]["parentMatches"])
report = {"status": "PASS" if passed else "FAIL",
          "walls": len(walls), "zones": len(zones), "boundaries": results,
          "bedroomNames": bedroom_names, "openingTypes": dict(opening_types),
          "centralOpenings": central_openings, "toleranceM": 0.13}
print(json.dumps(report, ensure_ascii=False, indent=2))
sys.exit(0 if report["status"] == "PASS" else 1)

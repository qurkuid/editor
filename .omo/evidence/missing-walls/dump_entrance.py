#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import cv2
import numpy as np

root = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("v", root / ".omx/recovery-20260929/data/vectorize.py")
assert spec and spec.loader
v = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = v
spec.loader.exec_module(v)
img = cv2.imread("/tmp/wall-missing-plan.jpg")
img = cv2.resize(img, None, fx=v.UP, fy=v.UP, interpolation=cv2.INTER_LINEAR)
m = v.build_masks(img)
segs = v.assign_thickness(v.extract_segments(v.zhang_suen(m["wall"]), m["dist_wall"]), m["dist_wall"], m["wall"])
v.snap_junctions(segs)
gaps = v.collinear_gaps(segs, m["wall"])
for gap in gaps:
    a, b, width, src = gap
    center = (a + b) / (2 * v.UP)
    if 500 <= center[0] <= 700 and 150 <= center[1] <= 400:
        print("gap", np.round(a / v.UP, 1), np.round(b / v.UP, 1), "width", width / v.UP, src)
print("openings no pts")
for o in v.classify_openings(gaps, m, segs, None, []):
    center = (o.a + o.b) / (2 * v.UP)
    if 500 <= center[0] <= 700 and 150 <= center[1] <= 400:
        print(o.kind, np.round(o.a / v.UP, 1), np.round(o.b / v.UP, 1), o.src,
              "hinge", None if o.hinge is None else np.round(o.hinge / v.UP, 1),
              "r", o.radius / v.UP)


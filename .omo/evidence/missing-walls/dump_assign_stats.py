#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import cv2
import numpy as np

root = Path(__file__).resolve().parents[3]
path = root / ".omx/recovery-20260929/data/vectorize.py"
spec = importlib.util.spec_from_file_location("vectorize_stats", path)
assert spec and spec.loader
v = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = v
spec.loader.exec_module(v)

image = cv2.imread("/tmp/wall-missing-plan.jpg")
assert image is not None
image = cv2.resize(image, None, fx=v.UP, fy=v.UP, interpolation=cv2.INTER_LINEAR)
masks = v.build_masks(image)
raw = v.extract_segments(v.zhang_suen(masks["wall"]), masks["dist_wall"])
kept = v.assign_thickness(raw, masks["dist_wall"], masks["wall"])

target = [
    (366.6, 477.1, 481.9, 361.9, "left"),
    (674.3, 584.0, 674.3, 463.0, "kitchen"),
    (540.0, 322.3, 587.5, 321.5, "entrance"),
]

def err(s, t):
    a = np.array(t[:2]) * v.UP
    b = np.array(t[2:4]) * v.UP
    direct = max(np.linalg.norm(s.p1 - a), np.linalg.norm(s.p2 - b))
    reverse = max(np.linalg.norm(s.p1 - b), np.linalg.norm(s.p2 - a))
    return min(direct, reverse)

def stats(s):
    h, w = masks["dist_wall"].shape
    L = s.length
    d = s.vec / L
    steps = max(int(L / 2), 1)
    ths = []
    on = 0
    for k in range(steps + 1):
        p = s.p1 + d * (L * k / steps)
        x, y = int(round(p[0])), int(round(p[1]))
        if 0 <= x < w and 0 <= y < h and masks["wall"][y, x]:
            on += 1
            ths.append(masks["dist_wall"][y, x] * 2.0)
    return L, on, steps + 1, (float(np.median(ths)) if ths else None), len(ths)

def nearby_stats(s, radius, pick):
    h, w = masks["dist_wall"].shape
    L = s.length
    d = s.vec / L
    n = np.array([-d[1], d[0]])
    steps = max(int(L / 2), 1)
    ths = []
    on = 0
    for k in range(steps + 1):
        p = s.p1 + d * (L * k / steps)
        probes = []
        for offset in np.arange(-radius, radius + 0.01, 1.0):
            q = p + n * offset
            x, y = int(round(q[0])), int(round(q[1]))
            if 0 <= x < w and 0 <= y < h and masks["wall"][y, x]:
                probes.append((float(masks["dist_wall"][y, x]), offset))
        if probes:
            dist, _ = max(probes, key=(lambda item: item[0]) if pick == "thick" else (lambda item: -abs(item[1])))
            on += 1
            ths.append(dist * 2.0)
    return on, steps + 1, (float(np.median(ths)) if ths else None), len(ths)

def intervals(s):
    L = s.length
    d = s.vec / L
    steps = max(int(L / 2), 1)
    values = []
    for k in range(steps + 1):
        p = s.p1 + d * (L * k / steps)
        x, y = int(round(p[0])), int(round(p[1]))
        values.append(bool(masks["wall"][y, x]))
    runs = []
    start = 0
    for i in range(1, len(values) + 1):
        if i == len(values) or values[i] != values[start]:
            if values[start]:
                runs.append((round(start / steps * L / v.UP, 1), round((i - 1) / steps * L / v.UP, 1)))
            start = i
    return runs

for i, s in sorted(enumerate(raw), key=lambda it: min((err(it[1], t) for t in target), default=99999)):
    if min((err(s, t) for t in target), default=99999) / v.UP > 1.0:
        continue
    L, on, total, med, count = stats(s)
    best = min(((err(s, t), t[4]) for t in target), default=(99999, ""))
    if best[1] == "kitchen":
        print("wall intervals from p1", intervals(s))
        L = s.length; d = s.vec / L; n = np.array([-d[1], d[0]])
        for source_offset in (0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120):
            p = s.p1 + d * (source_offset * v.UP)
            rows = []
            for offset in range(-8, 9):
                q = p + n * offset
                x, y = int(round(q[0])), int(round(q[1]))
                if 0 <= x < masks["wall"].shape[1] and 0 <= y < masks["wall"].shape[0]:
                    rows.append((offset, int(masks["wall"][y, x]), round(float(masks["dist_wall"][y, x]), 2)))
            print("offsets", source_offset, rows)
        for radius in (1, 2, 3, 4, 6, 8):
            for pick in ("near", "thick"):
                on, total, med, count = nearby_stats(s, radius, pick)
                print("near", radius, pick, "on", on, "/", total, "cov", round(on / total, 3),
                      "med", None if med is None else round(med / v.UP, 3), "samples", count)

print("kept total", len(kept))
for kept_seg in kept:
    best = min(((err(kept_seg, t), t[4]) for t in target), default=(99999, ""))
    if best[1] == "kitchen" and best[0] / v.UP < 130:
        print("kept kitchen", np.round(kept_seg.p1 / v.UP, 1), np.round(kept_seg.p2 / v.UP, 1),
              "srcL", round(kept_seg.length / v.UP, 2), "srcTh", round(kept_seg.th / v.UP, 3),
              "err", round(best[0] / v.UP, 2))

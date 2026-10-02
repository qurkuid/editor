#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import cv2
import numpy as np

root = Path(__file__).resolve().parents[3]
image = cv2.imread("/tmp/wall-missing-plan.jpg")
assert image is not None

def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod

before = load("before", root / ".omo/evidence/missing-walls/vectorize-before.py")
after = load("after", root / ".omx/recovery-20260929/data/vectorize.py")

def extract(v):
    img = cv2.resize(image, None, fx=v.UP, fy=v.UP, interpolation=cv2.INTER_LINEAR)
    masks = v.build_masks(img)
    raw = v.extract_segments(v.zhang_suen(masks["wall"]), masks["dist_wall"])
    return raw, v.assign_thickness(raw, masks["dist_wall"], masks["wall"])

raw_before, kept_before = extract(before)
raw_after, kept_after = extract(after)

def key(s):
    p1, p2 = s.p1 / after.UP, s.p2 / after.UP
    return tuple(round(float(x), 1) for x in (*p1, *p2))

def fmt(s):
    return f"{np.round(s.p1 / after.UP, 1)} -> {np.round(s.p2 / after.UP, 1)} L={s.length / after.UP:.1f} th={s.th / after.UP:.2f}"

print("before", len(raw_before), len(kept_before))
print("after", len(raw_after), len(kept_after))
for s in kept_after:
    nearest = min((np.linalg.norm(s.p1 - q.p1) + np.linalg.norm(s.p2 - q.p2), q)
                  for q in kept_before)
    if nearest[0] > 2 * after.UP:
        print("added", fmt(s), "nearest", round(nearest[0] / after.UP, 1))


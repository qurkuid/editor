#!/usr/bin/env python3
"""Kujiale-style apartment floorplan raster -> SVG/JSON vectorizer.

Extracts exterior/interior walls (centerline segments + thickness), windows,
doors (swing arcs), openings, and rooms (polygon + class + OCR label) from the
plan images served by apt.intm.kr, and writes a layered SVG plus a JSON sidecar
in millimeter coordinates for downstream modeling.

Usage:
    python3 vectorize.py samples/XXXX.jpg [-o out] [--debug] [--no-ocr]
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
from dataclasses import dataclass, field

import cv2
import numpy as np

TOOL_DIR = os.path.dirname(os.path.abspath(__file__))

# ---- measured constants (probed from the dataset; wall gray V=153+-3) ----
WALL_CHROMA_MAX = 14
WALL_V_MIN, WALL_V_MAX = 118, 196
PAPER_V_MIN, PAPER_CHROMA_MAX = 249, 8
THIN_CHROMA_MAX, THIN_V_MIN, THIN_V_MAX = 24, 95, 218
DARK_LINE_V_MAX = 135

# Analysis runs on a nearest-neighbor UPscaled copy of the source image.
# Nearest keeps the threshold masks bit-identical in value while making the
# fixed 3x3-open / 5x5-close wall morphology HALF as aggressive relative to
# the drawing, so adjacent walls and openings separated by 1-2 source px no
# longer fuse; the skeleton also gains sub-source-pixel centerline accuracy.
# Every pixel-unit threshold below is expressed via UP so behavior is
# calibrated at source scale.
UP = 2

# Thin interior walls can measure below the old 4 px source floor after
# antialiasing. Keep them only when their run is long enough to be structural.
MIN_WALL_THICKNESS = 4 * UP
MIN_THIN_WALL_THICKNESS = 2.5 * UP
MIN_THIN_SEG_LEN = 35 * UP
MIN_SEG_LEN = 7 * UP
GAP_MIN, GAP_MAX = 9 * UP, 520 * UP
ARC_R_MIN, ARC_R_MAX = 13 * UP, 85 * UP
MIN_ROOM_AREA_PX = 260 * UP * UP

ROOM_WORDS = {
    'bedroom': ['안방', '침실', '방'],
    'living': ['거실'],
    'kitchen': ['부엌', '주방'],
    'bath': ['욕실', '화장실', '파우더룸'],
    'balcony': ['발코니', '베란다', '테라스'],
    'entrance': ['현관'],
    'dress': ['드레스룸', '드레스'],
    'storage': ['창고', '팬트리'],
    'utility': ['다용도실', '다용도', '세탁실', '실외기실', '실외기', '보일러실', '덕트'],
    'study': ['서재', '알파룸', '알파'],
    'hall': ['복도', '홀'],
    'shelter': ['대피공간', '대피', '피난'],
    'elevator': ['엘리베이터', '승강기', '계단'],
}
CLASS_FILL = {
    'bedroom': '#d9b38c', 'living': '#d8d2c8', 'kitchen': '#e3e0da',
    'bath': '#eef1f3', 'balcony': '#efe8d5', 'entrance': '#e6e0d6',
    'dress': '#d9c8ae', 'storage': '#dfd8cb', 'utility': '#e4e2dd',
    'study': '#d9b38c', 'hall': '#d8d2c8', 'shelter': '#e0e6e8',
    'elevator': '#d8dade', 'room': '#ddd6ca',
}


# --------------------------------------------------------------------------
# raster analysis
# --------------------------------------------------------------------------

def build_masks(img):
    b, g, r = (img[:, :, i].astype(np.int16) for i in range(3))
    chroma = np.maximum(np.maximum(abs(r - g), abs(g - b)), abs(r - b)).astype(np.uint8)
    v = img.max(axis=2)

    wall_raw = ((chroma < WALL_CHROMA_MAX) & (v > WALL_V_MIN) & (v < WALL_V_MAX)).astype(np.uint8)
    k3 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    k_open = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * UP + 1, 2 * UP + 1))
    # open at source-equivalent radius 1: linear upscaling widens 1-source-px
    # antialiased edges (door-sill borders!) to 2 analysis px, and a smaller
    # open would keep them as phantom wall bridging every doorway gap. The
    # CLOSE stays at 5x5 on purpose — half its source-relative reach, so
    # items separated by 1-2 source px no longer fuse (the point of UP).
    wall = cv2.morphologyEx(wall_raw, cv2.MORPH_OPEN, k_open)
    nw, lw, sw, _ = cv2.connectedComponentsWithStats(wall, 8)
    small = np.nonzero(sw[1:, cv2.CC_STAT_AREA] < 60 * UP * UP)[0] + 1
    if len(small):
        wall[np.isin(lw, small)] = 0
    wall = cv2.morphologyEx(wall, cv2.MORPH_CLOSE, k5)
    # fill small ENCLOSED holes (wood-grain texture, grout specks inside a
    # wall body): the half-reach close above no longer bridges them and the
    # wall splits into two shells with garbage thickness. A slit between two
    # separate walls opens into a room, so it is part of a large background
    # component and stays — hole filling keeps the separation the upscale won
    inv = (wall == 0).astype(np.uint8)
    nh, lh, sh, _ = cv2.connectedComponentsWithStats(inv, 4)
    hole = np.nonzero(sh[1:, cv2.CC_STAT_AREA] < 60 * UP * UP)[0] + 1
    if len(hole):
        wall[np.isin(lh, hole)] = 1

    paper = ((v >= PAPER_V_MIN) & (chroma < PAPER_CHROMA_MAX)).astype(np.uint8)

    # outside = white area flood-reachable from the border. Thin symbol lines
    # (window borders) survive as barriers because JPEG halos widen them.
    outside = np.zeros_like(paper)
    ff = paper.copy()
    h, w = ff.shape
    mask = np.zeros((h + 2, w + 2), np.uint8)
    for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]:
        if ff[seed[1], seed[0]]:
            cv2.floodFill(ff, mask, seed, 2)
    outside = (ff == 2).astype(np.uint8)

    inside_raw = ((outside == 0)).astype(np.uint8)
    inside_raw = cv2.morphologyEx(inside_raw, cv2.MORPH_OPEN,
                                  cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(inside_raw, 8)
    if n > 1:
        big = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        sil = (lab == big).astype(np.uint8)
    else:
        sil = inside_raw
    # fill internal holes
    ff2 = sil.copy()
    mask2 = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(ff2, mask2, (0, 0), 2)
    sil = ((ff2 != 2)).astype(np.uint8)

    wall &= sil
    wall_dil = cv2.dilate(wall, k5)
    # door arcs can swing outside the unit (entrance) — search a halo around it
    halo = 45 * UP * 2 + 1
    near_sil = cv2.dilate(sil, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (halo, halo)))
    thin = ((chroma < THIN_CHROMA_MAX) & (v > THIN_V_MIN) & (v < THIN_V_MAX)
            & (wall_dil == 0)).astype(np.uint8) & near_sil
    dark = ((chroma < THIN_CHROMA_MAX + 6) & (v < DARK_LINE_V_MAX) & (wall_dil == 0)).astype(np.uint8) & sil
    white = ((v >= 238) & (chroma <= 14) & (wall_dil == 0)).astype(np.uint8) & sil

    # dark-thin-line mask independent of background level (arc strokes over
    # paper, tile, or wood): blackhat highlights lines darker than surroundings
    bh_k = 3 * UP * 2 + 1
    bh_img = cv2.morphologyEx(v.astype(np.uint8), cv2.MORPH_BLACKHAT,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (bh_k, bh_k)))
    # >9, not >12: linear upscaling softens dark strokes and the blackhat
    # response of arc dashes drops ~25%; measured swing scores fell to
    # 0.42-0.47 against the 0.5 floor with the old threshold
    stroke = ((bh_img > 9) & (chroma < 40) & (wall_dil == 0)).astype(np.uint8) & near_sil
    # erase long straight runs (grout grid, plank joints, dimension lines);
    # door arcs curve away and survive as short chunks
    straight = cv2.HoughLinesP(stroke * 255, 1, np.pi / 360, 30 * UP,
                               minLineLength=40 * UP, maxLineGap=4 * UP)
    if straight is not None:
        for x1, y1, x2, y2 in straight[:, 0]:
            cv2.line(stroke, (x1, y1), (x2, y2), 0, 3 * UP)
    # arcs render dashed; bridge the fragments so one component spans the swing
    bridge = 2 * UP * 2 + 1
    stroke = cv2.morphologyEx(stroke, cv2.MORPH_CLOSE,
                              cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (bridge, bridge)))

    dist_wall = cv2.distanceTransform(wall, cv2.DIST_L2, 3)
    dist_to_out = cv2.distanceTransform(1 - ((outside > 0) | False).astype(np.uint8), cv2.DIST_L2, 3)
    return dict(chroma=chroma, v=v, wall=wall, paper=paper, outside=outside,
                sil=sil, thin=thin, dark=dark, white=white, stroke=stroke,
                dist_wall=dist_wall, dist_to_out=dist_to_out)


def zhang_suen(mask):
    img = np.pad((mask > 0).astype(np.uint8), 1)
    while True:
        changed = False
        for step in (0, 1):
            p2 = img[:-2, 1:-1]; p3 = img[:-2, 2:]; p4 = img[1:-1, 2:]; p5 = img[2:, 2:]
            p6 = img[2:, 1:-1]; p7 = img[2:, :-2]; p8 = img[1:-1, :-2]; p9 = img[:-2, :-2]
            c = img[1:-1, 1:-1]
            seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
            B = sum(s.astype(np.int16) for s in seq[:8])
            A = sum(((seq[k] == 0) & (seq[k + 1] == 1)).astype(np.int16) for k in range(8))
            if step == 0:
                cond = (c == 1) & (B >= 2) & (B <= 6) & (A == 1) & ((p2 * p4 * p6) == 0) & ((p4 * p6 * p8) == 0)
            else:
                cond = (c == 1) & (B >= 2) & (B <= 6) & (A == 1) & ((p2 * p4 * p8) == 0) & ((p2 * p6 * p8) == 0)
            if cond.any():
                img[1:-1, 1:-1][cond] = 0
                changed = True
        if not changed:
            break
    return img[1:-1, 1:-1]


# --------------------------------------------------------------------------
# wall segments
# --------------------------------------------------------------------------

@dataclass
class Seg:
    p1: np.ndarray
    p2: np.ndarray
    th: float = 8.0
    exterior: bool = False
    j1: bool = False  # endpoint joins another wall (render miter)
    j2: bool = False

    @property
    def vec(self):
        return self.p2 - self.p1

    @property
    def length(self):
        return float(np.linalg.norm(self.vec))

    @property
    def angle(self):
        v = self.vec
        return math.degrees(math.atan2(v[1], v[0])) % 180.0


def ang_diff(a, b):
    d = abs(a - b) % 180.0
    return min(d, 180.0 - d)


def point_line_dist(p, a, d):
    """distance from p to infinite line through a with unit dir d"""
    ap = p - a
    return abs(ap[0] * d[1] - ap[1] * d[0])


def extract_segments(skel, dist_wall):
    lines = cv2.HoughLinesP((skel * 255).astype(np.uint8), 1, np.pi / 360, 10 * UP,
                            minLineLength=9 * UP, maxLineGap=3 * UP)
    segs = []
    if lines is None:
        return segs
    for (x1, y1, x2, y2) in lines[:, 0]:
        segs.append(Seg(np.array([x1, y1], float), np.array([x2, y2], float)))
    return merge_segments(merge_segments(segs))


def merge_segments(segs, ang_tol=6.0, off_tol=3.6 * UP, gap_tol=8.0 * UP):
    n = len(segs)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    def union(i, j):
        parent[find(i)] = find(j)

    infos = []
    for s in segs:
        d = s.vec / (s.length + 1e-9)
        infos.append((s, d))
    for i in range(n):
        si, di = infos[i]
        for j in range(i + 1, n):
            sj, dj = infos[j]
            if ang_diff(si.angle, sj.angle) > ang_tol:
                continue
            if point_line_dist(sj.p1, si.p1, di) > off_tol or point_line_dist(sj.p2, si.p1, di) > off_tol:
                continue
            t = [float(np.dot(p - si.p1, di)) for p in (si.p1, si.p2, sj.p1, sj.p2)]
            a1, b1 = sorted(t[:2]); a2, b2 = sorted(t[2:])
            if a2 > b1 + gap_tol or a1 > b2 + gap_tol:
                continue
            union(i, j)
    groups = {}
    for i in range(n):
        groups.setdefault(find(i), []).append(segs[i])
    out = []
    for members in groups.values():
        longest = max(members, key=lambda s: s.length)
        d = longest.vec / (longest.length + 1e-9)
        anchor = longest.p1
        # refine offset: weighted mean of perpendicular offsets
        nvec = np.array([-d[1], d[0]])
        wsum = sum(m.length for m in members)
        off = sum(float(np.dot((m.p1 + m.p2) / 2 - anchor, nvec)) * m.length for m in members) / (wsum + 1e-9)
        anchor = anchor + nvec * off
        ts = []
        for m in members:
            ts.append(float(np.dot(m.p1 - anchor, d)))
            ts.append(float(np.dot(m.p2 - anchor, d)))
        out.append(Seg(anchor + d * min(ts), anchor + d * max(ts)))
    return out


def assign_thickness(segs, dist_wall, wall, allow_short=False):
    h, w = dist_wall.shape
    kept = []

    def samples(seg):
        """Return wall thickness samples and support using a bounded recenter.

        Hough centerlines can drift by a source pixel at a pale window/door
        frame. Search only along the segment normal and keep the nearest
        existing wall pixel whose measured body reaches the thin-wall floor;
        this does not widen the wall mask or invent gray pixels. A bounded
        support miss remains a real gap even when the centerline drifts.
        """
        length = seg.length
        direction = seg.vec / length
        normal = np.array([-direction[1], direction[0]])
        count = max(int(length / 2), 1)
        values = []
        exact_supported = []
        for k in range(count + 1):
            point = seg.p1 + direction * (length * k / count)
            x, y = int(round(point[0])), int(round(point[1]))
            # Two source pixels on either side is enough for the measured
            # antialiased centerline drift, while avoiding nearby walls. Keep
            # the exact sample in the same bounded set: a thin border pixel
            # must not hide a nearby pixel whose measured body reaches the
            # physical thin-wall floor.
            candidates = []
            exact_wall = 0 <= x < w and 0 <= y < h and bool(wall[y, x])
            exact_thickness = float(dist_wall[y, x]) * 2.0 if exact_wall else 0.0
            exact_supported.append(exact_thickness >= MIN_THIN_WALL_THICKNESS)
            if exact_wall:
                candidates.append((0.0, exact_thickness / 2.0))
            for offset in np.arange(-2 * UP, 2 * UP + 0.1, 1.0):
                q = point + normal * offset
                qx, qy = int(round(q[0])), int(round(q[1]))
                if 0 <= qx < w and 0 <= qy < h and wall[qy, qx]:
                    candidates.append((abs(float(offset)), float(dist_wall[qy, qx])))
            eligible = [
                (offset, distance)
                for offset, distance in candidates
                if distance * 2.0 >= MIN_THIN_WALL_THICKNESS
            ]
            if eligible:
                _, distance = min(eligible, key=lambda item: item[0])
                values.append(distance * 2.0)
            else:
                values.append(None)
        return values, exact_supported, count

    for s in segs:
        L = s.length
        if L < 2:
            continue
        values, exact_supported, steps = samples(s)
        step_length = L / steps

        # A long Hough run can trace a pale frame on the edge of a genuine
        # opening. Recentered support keeps a uniformly shifted wall intact;
        # only split an exact unsupported run when it also contains a bounded
        # support miss, which distinguishes a real opening from centerline
        # drift through a continuous wall body.
        if L >= 2.5 * MIN_THIN_SEG_LEN:
            gap_start = None
            for i, supported in enumerate(exact_supported + [True]):
                if not supported and gap_start is None:
                    gap_start = i
                elif supported and gap_start is not None:
                    if ((i - gap_start) * step_length >= GAP_MIN
                            and any(value is None for value in values[gap_start:i])):
                        for j in range(gap_start, i):
                            values[j] = None
                    gap_start = None

        # Preserve an actual opening inside a long Hough candidate. Short
        # centerline misses are handled by the bounded recenter above; only a
        # source-scale gap is allowed to split the candidate into wall runs.
        split_runs = []
        gap_start = None
        for i, supported in enumerate([value is not None for value in values] + [True]):
            if not supported and gap_start is None:
                gap_start = i
            elif supported and gap_start is not None:
                if (i - gap_start) * step_length >= GAP_MIN:
                    split_runs.append((gap_start, i - 1))
                gap_start = None

        intervals = [(0, steps)]
        for gap_start, gap_end in split_runs:
            next_intervals = []
            for lo, hi in intervals:
                if gap_end < lo or gap_start > hi:
                    next_intervals.append((lo, hi))
                    continue
                if lo <= gap_start - 1:
                    next_intervals.append((lo, gap_start - 1))
                if gap_end + 1 <= hi:
                    next_intervals.append((gap_end + 1, hi))
            intervals = next_intervals

        direction = s.vec / L
        for lo, hi in intervals:
            if hi <= lo:
                continue
            p1 = s.p1 + direction * (step_length * lo)
            p2 = s.p1 + direction * (step_length * hi)
            candidate = s if lo == 0 and hi == steps else Seg(p1, p2)
            candidate_length = candidate.length
            if candidate_length < 2:
                continue

            candidate_values, _, candidate_steps = samples(candidate)
            ths = [value for value in candidate_values if value is not None]
            on_wall = len(ths)
            if not ths or on_wall / (candidate_steps + 1) < 0.55:
                continue
            candidate.th = float(np.median(ths))
            if candidate.th < MIN_THIN_WALL_THICKNESS:
                continue
            if candidate_length < max(MIN_SEG_LEN, candidate.th * 0.55):
                continue
            if not allow_short and candidate.th < MIN_WALL_THICKNESS and candidate_length < MIN_THIN_SEG_LEN:
                continue
            kept.append(candidate)
    return kept


def _segment_point_distance(point, seg):
    vec = seg.p2 - seg.p1
    den = float(np.dot(vec, vec))
    if den <= 1e-9:
        return float(np.linalg.norm(point - seg.p1))
    t = min(max(float(np.dot(point - seg.p1, vec) / den), 0.0), 1.0)
    return float(np.linalg.norm(point - (seg.p1 + vec * t)))


def _bright_parallel_capsule(v_img, pa, pb, width):
    """Return true when a gap carries a clustered bright fixture render.

    The profile is sampled along the candidate centerline and across its wall
    width. Uniform floor or tile may be bright, but it does not produce a
    localized bright run with the measured opening contrast.
    """
    glen = float(np.linalg.norm(pb - pa))
    if glen < 4:
        return False
    d = (pb - pa) / glen
    nvec = np.array([-d[1], d[0]])
    h, w = v_img.shape
    offsets = np.arange(-(width / 2 + 1), width / 2 + 1.01, 1.0)
    ts = np.arange(2.0, glen - 1.0, 2.0)
    values = []
    for t in ts:
        points = pa + t * d + offsets[:, None] * nvec
        xs = np.clip(np.rint(points[:, 0]).astype(int), 0, w - 1)
        ys = np.clip(np.rint(points[:, 1]).astype(int), 0, h - 1)
        values.append(float(np.max(v_img[ys, xs])))
    if not values:
        return False
    # A blank white strip (including the synthetic all-white negative) is not
    # fixture evidence.  Keep the capsule gate tied to a measured ridge
    # contrast before looking for a localized bright run.
    if max(values) - min(values) < 25.0:
        return False
    bright = np.asarray(values) >= 235.0
    # Keep short runs: linear-upscaled source capsules are often only a few
    # analysis samples wide. Ignore isolated single-pixel noise.
    runs = []
    start = None
    for index, hit in enumerate(np.r_[bright, False]):
        if hit and start is None:
            start = index
        elif not hit and start is not None:
            if index - start >= 2:
                runs.append((start, index))
            start = None
    return bool(runs)


def retain_source_short_segments(short_segs, base_segs, gaps, masks=None, scale=None):
    """Retain short thin jambs only with bounded source evidence.

    The ordinary thickness path intentionally rejects short thin Hough runs.
    A recovery is valid only when it flanks a measured 0.4--1.8 m gap whose
    source profile is bright and contrasted, locally separates two spaces,
    and carries a clustered fixture capsule. This keeps isolated symbol runs
    out of the structural wall set without weakening the default guard.
    """
    accepted = list(base_segs)
    for candidate in short_segs:
        # ``allow_short`` is a recovery probe only.  Long or normally thick
        # runs belong to the ordinary wall pass and must never be promoted by
        # this source-evidence branch.
        if (candidate.th >= MIN_WALL_THICKNESS
                or candidate.length >= MIN_THIN_SEG_LEN):
            continue
        if candidate.length < 14.0 * UP or candidate.th < MIN_THIN_WALL_THICKNESS:
            continue
        if any(
            ang_diff(candidate.angle, existing.angle) <= 8.0
            and _segment_point_distance(candidate.p1, existing) <= 2.5 * UP
            and _segment_point_distance(candidate.p2, existing) <= 2.5 * UP
            for existing in accepted
            ):
                continue
        # A recovered jamb must touch retained structural geometry.  Checking
        # only its relaxed gap would let the candidate prove itself and admits
        # isolated dimension/symbol strokes from the source image.
        if not any(
            min(_segment_point_distance(candidate.p1, existing),
                _segment_point_distance(candidate.p2, existing)) <= 3.0 * UP
            for existing in base_segs
        ):
            continue
        for pa, pb, width, _src in gaps:
            gap_length = float(np.linalg.norm(pb - pa))
            if scale:
                gap_m = gap_length * float(scale) / 1000.0
                if not (0.4 <= gap_m <= 1.8):
                    continue
            elif gap_length < 30.0 * UP:
                continue
            endpoint_distance = min(
                float(np.linalg.norm(candidate.p1 - pa)),
                float(np.linalg.norm(candidate.p1 - pb)),
                float(np.linalg.norm(candidate.p2 - pa)),
                float(np.linalg.norm(candidate.p2 - pb)),
            )
            line_distance = min(_segment_point_distance(pa, candidate),
                                _segment_point_distance(pb, candidate))
            # Parallel jambs end at the gap flank; a perpendicular frame stub
            # can meet that flank a little farther away. Both remain bounded
            # by the source wall geometry and never use labels or coordinates.
            parallel = ang_diff(candidate.angle,
                                math.degrees(math.atan2(*(pb - pa)[::-1]))) <= 8.0
            if parallel:
                if endpoint_distance > 10.0 * UP or line_distance > 12.0 * UP:
                    continue
            elif endpoint_distance > 24.0 * UP or line_distance > 12.0 * UP:
                continue
            if masks is None:
                continue
            profile = gap_cross_profile(masks['v'], pa, pb, width)
            if (not profile or max(profile) < 235.0
                    or max(profile) - min(profile) < 25.0):
                continue
            if not gap_separates(masks, pa, pb, width):
                continue
            if not _bright_parallel_capsule(masks['v'], pa, pb, width):
                continue
            accepted.append(candidate)
            break
    return accepted


def snap_junctions(segs, radius=8.0 * UP):
    # corner clusters between endpoints
    pts = []
    for si, s in enumerate(segs):
        pts.append((si, 0)); pts.append((si, 1))

    def get(ep):
        s = segs[ep[0]]
        return s.p1 if ep[1] == 0 else s.p2

    def setp(ep, val):
        s = segs[ep[0]]
        if ep[1] == 0:
            s.p1 = val; s.j1 = True
        else:
            s.p2 = val; s.j2 = True

    n = len(pts)
    parent = list(range(n))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(n):
        for j in range(i + 1, n):
            if pts[i][0] == pts[j][0]:
                continue
            if np.linalg.norm(get(pts[i]) - get(pts[j])) <= radius:
                parent[find(i)] = find(j)
    clusters = {}
    for i in range(n):
        clusters.setdefault(find(i), []).append(pts[i])
    for members in clusters.values():
        if len(members) < 2:
            continue
        ss = sorted({m[0] for m in members}, key=lambda k: -segs[k].length)
        target = None
        if len(ss) >= 2:
            a, b = segs[ss[0]], segs[ss[1]]
            if ang_diff(a.angle, b.angle) > 25:
                da = a.vec / (a.length + 1e-9); db = b.vec / (b.length + 1e-9)
                M = np.array([[da[0], -db[0]], [da[1], -db[1]]])
                if abs(np.linalg.det(M)) > 1e-6:
                    t = np.linalg.solve(M, b.p1 - a.p1)
                    target = a.p1 + da * t[0]
        if target is None:
            target = np.mean([get(m) for m in members], axis=0)
        for m in members:
            if np.linalg.norm(get(m) - target) <= radius * 1.6:
                setp(m, target.copy())
    # T-junctions: free endpoint near another segment's interior
    for si, s in enumerate(segs):
        for ei, (p, joined) in enumerate([(s.p1, s.j1), (s.p2, s.j2)]):
            if joined:
                continue
            best = None
            for ti, t in enumerate(segs):
                if ti == si:
                    continue
                d = t.vec / (t.length + 1e-9)
                proj = float(np.dot(p - t.p1, d))
                if proj < -2 * UP or proj > t.length + 2 * UP:
                    continue
                q = t.p1 + d * min(max(proj, 0), t.length)
                dd = float(np.linalg.norm(p - q))
                if dd <= t.th / 2 + 3.0 * UP and (best is None or dd < best[0]):
                    best = (dd, q)
            if best is not None:
                if ei == 0:
                    s.p1 = best[1]; s.j1 = True
                else:
                    s.p2 = best[1]; s.j2 = True
    return segs


def classify_exterior(segs, dist_to_out):
    h, w = dist_to_out.shape
    for s in segs:
        d = s.vec / (s.length + 1e-9)
        vals = []
        steps = max(int(s.length / 4), 1)
        for k in range(steps + 1):
            p = s.p1 + d * (s.length * k / steps)
            x, y = int(round(p[0])), int(round(p[1]))
            if 0 <= x < w and 0 <= y < h:
                vals.append(dist_to_out[y, x])
        if vals:
            s.exterior = float(np.median(vals)) < s.th / 2 + 4.5 * UP
    return segs


def render_walls(segs, shape):
    canvas = np.zeros(shape, np.uint8)
    for s in segs:
        d = s.vec / (s.length + 1e-9)
        a = s.p1 - d * (s.th / 2 if s.j1 else 0)
        b = s.p2 + d * (s.th / 2 if s.j2 else 0)
        nvec = np.array([-d[1], d[0]]) * (s.th / 2)
        poly = np.array([a + nvec, b + nvec, b - nvec, a - nvec]).astype(np.int32)
        cv2.fillConvexPoly(canvas, poly, 1)
    return canvas


# --------------------------------------------------------------------------
# openings
# --------------------------------------------------------------------------

@dataclass
class Opening:
    kind: str            # door | window | opening
    a: np.ndarray        # gap start (on wall line)
    b: np.ndarray        # gap end
    width: float         # wall thickness at the gap
    src: str = 'pair'    # gap origin: pair | ray | boundary
    hinge: np.ndarray | None = None
    radius: float = 0.0
    leaf_deg: float = 0.0
    arc_from: float = 0.0
    arc_to: float = 0.0
    # Semantic opening endpoints may be narrower than the source wall barrier
    # used for room connectivity (for example the top-dress door leaf).
    barrier_a: np.ndarray | None = None
    barrier_b: np.ndarray | None = None
    barrier_width: float | None = None


def arc_coverage(stroke, hinge, d_along, n_side, r, v_img=None):
    """Fraction of a hypothesized door-swing arc (quarter circle from the
    wall direction toward n_side) covered by stroke pixels. Mid-quadrant
    coverage is enforced so wall/leaf lines at 0/90 deg earn no free credit."""
    h, w = stroke.shape
    win = 2 * UP
    hits = total = mid_hits = mid_total = 0
    for deg in range(0, 91, 5):
        th = math.radians(deg)
        p = hinge + d_along * (r * math.cos(th)) + n_side * (r * math.sin(th))
        x, y = int(round(p[0])), int(round(p[1]))
        if not (win <= x < w - win and win <= y < h - win):
            continue
        hit = int(stroke[y - win:y + win + 1, x - win:x + win + 1].any())
        if not hit and v_img is not None:
            # Some plans render the swing arc as a pale gray line on a pale
            # floor.  The dark-only stroke mask intentionally drops it, so
            # inspect a narrow radial cross-section in the original value
            # image.  Equal-valued white sides are not evidence.
            radial = p - hinge
            radial /= np.linalg.norm(radial) + 1e-9
            side_values = []
            for sign in (-1.0, 1.0):
                q = p + radial * sign * 2.0 * UP
                qx, qy = int(round(q[0])), int(round(q[1]))
                if 0 <= qx < w and 0 <= qy < h:
                    side_values.append(float(v_img[qy, qx]))
            center = float(np.percentile(v_img[
                max(0, y - UP):min(h, y + UP + 1),
                max(0, x - UP):min(w, x + UP + 1)], 25))
            if len(side_values) == 2:
                side_delta = abs(side_values[0] - side_values[1])
                arc_delta = abs(float(np.median(side_values)) - center)
                hit = int(side_delta <= 24.0 and arc_delta >= 5.0)
        total += 1
        hits += hit
        if 15 <= deg <= 75:
            mid_total += 1
            mid_hits += hit
    if total < 15 or mid_total < 8:
        return 0.0
    return min(hits / total, mid_hits / mid_total + 0.15)


def inner_clutter(stroke, hinge, d_along, n_side, r):
    """Stroke density inside the swing pie, sampled mid-quadrant (20-70 deg)
    at 0.45r and 0.65r — clear for real doors, dense at window/grout corners."""
    h, w = stroke.shape
    win = 2 * UP
    hits = total = 0
    for rf in (0.45, 0.65):
        for deg in range(20, 71, 5):
            th = math.radians(deg)
            p = hinge + d_along * (r * rf * math.cos(th)) + n_side * (r * rf * math.sin(th))
            x, y = int(round(p[0])), int(round(p[1]))
            if not (win <= x < w - win and win <= y < h - win):
                continue
            total += 1
            hits += int(stroke[y - win:y + win + 1, x - win:x + win + 1].any())
    return hits / total if total else 1.0


def door_hypothesis(stroke, pa, pb, glen, scale=None, v_img=None):
    """Best door interpretation of a wall gap: hinge at either end, swing to
    either side, radius a fraction of the gap (door + fixed panel openings)
    or a typical door width in mm when the plan scale is known.
    Returns (score, hinge, along_dir, swing_normal, radius) or None."""
    d = (pb - pa) / (glen + 1e-9)
    n = np.array([-d[1], d[0]])
    r_max = min(glen + 2, (1150 / scale) if scale else ARC_R_MAX)
    radii = {round(glen * f) for f in (1.0, 0.85, 0.7, 0.55)}
    if scale:
        radii |= {round(mm / scale) for mm in (600, 700, 800, 900, 1000, 1100)}
    else:
        radii |= {r * UP for r in (18, 24, 30, 38, 47, 58, 70, 82)}
    radii = sorted(r for r in radii if ARC_R_MIN <= r <= r_max)
    best = None
    for hinge, other_dir in ((pa, d), (pb, -d)):
        for side in (n, -n):
            for r in radii:
                s = arc_coverage(stroke, hinge, other_dir, side, float(r), v_img=v_img)
                if best is None or s > best[0]:
                    best = (s, hinge, other_dir, side, float(r))
    return best


def to_face(wall, p, d):
    """Walk p along unit dir d (into the gap) to the actual wall face.
    Skeleton-derived endpoints retract ~th/2 inside the wall; hinges and gap
    lengths need the face, not the centerline tip."""
    h, w = wall.shape

    def at(q):
        x, y = int(round(q[0])), int(round(q[1]))
        return 0 <= x < w and 0 <= y < h and wall[y, x] > 0

    q = p.copy()
    if at(q):
        for _ in range(45 * UP):
            nq = q + d
            if not at(nq):
                return nq
            q = nq
        return q
    for _ in range(45 * UP):
        nq = q - d
        if at(nq):
            return q
        q = nq
    return p


def collinear_gaps(segs, wall):
    """Opening candidates: gaps between collinear wall pairs, plus ray-cast
    gaps from a free wall end to a crossing perpendicular wall (door-at-corner
    case). Ray gaps carry src='ray' and are only kept later with symbol
    evidence (arc or window lines) to avoid false positives across rooms."""
    cands = []
    for i in range(len(segs)):
        for j in range(i + 1, len(segs)):
            si, sj = segs[i], segs[j]
            if ang_diff(si.angle, sj.angle) > 8:
                continue
            d = si.vec / (si.length + 1e-9)
            off = max(point_line_dist(sj.p1, si.p1, d), point_line_dist(sj.p2, si.p1, d))
            if off > max(si.th, sj.th) * 0.75 + 1.5 * UP:
                continue
            t = [(float(np.dot(p - si.p1, d)), p) for p in (si.p1, si.p2, sj.p1, sj.p2)]
            ti = sorted(t[:2], key=lambda z: z[0]); tj = sorted(t[2:], key=lambda z: z[0])
            if ti[1][0] < tj[0][0]:
                g = tj[0][0] - ti[1][0]; pa, pb = ti[1][1], tj[0][1]
            elif tj[1][0] < ti[0][0]:
                g = ti[0][0] - tj[1][0]; pa, pb = tj[1][1], ti[0][1]
            else:
                continue
            if not (GAP_MIN <= g <= GAP_MAX):
                continue
            cands.append((pa.copy(), pb.copy(), max(si.th, sj.th), 'pair'))

    def only_stub_partners(seg, endpoint):
        # a doorway next to its frame stub: the wall end is 'joined', but
        # every wall sharing that point is a tiny stub. A join to a real
        # wall is a genuine corner and must not cast through it.
        for other in segs:
            if other is seg:
                continue
            for q in (other.p1, other.p2):
                if (float(np.linalg.norm(q - endpoint)) <= 3 * UP
                        and other.length > 30 * UP
                        and other.th >= MIN_WALL_THICKNESS):
                    return False
        return True

    for i, s in enumerate(segs):
        d = s.vec / (s.length + 1e-9)
        for e, outward, joined in ((s.p1, -d, s.j1), (s.p2, d, s.j2)):
            if joined and not only_stub_partners(s, e):
                continue
            best_t = None
            for j, t_seg in enumerate(segs):
                if j == i or ang_diff(s.angle, t_seg.angle) < 25:
                    continue
                dt = t_seg.vec / (t_seg.length + 1e-9)
                M = np.array([[outward[0], -dt[0]], [outward[1], -dt[1]]])
                if abs(np.linalg.det(M)) < 1e-6:
                    continue
                t, u = np.linalg.solve(M, t_seg.p1 - e)
                tol = max(6.0 * UP, float(t_seg.th))
                if GAP_MIN <= t <= 240 * UP and -tol <= u <= t_seg.length + tol:
                    if best_t is None or t < best_t[0]:
                        best_t = (float(t), e + outward * t)
            if best_t is None:
                # segment intersection misses doors whose facing wall's
                # skeleton retracted past the sill line (endpoint sits a few
                # px outside the segment's u range) — the wall MASK still
                # covers the corner, so walk the cast ray into it directly
                hh, ww = wall.shape
                wall_body = False
                gap_start = None
                for t in range(1, 240 * UP + 1):
                    q = e + outward * t
                    x, y = int(round(q[0])), int(round(q[1]))
                    if not (0 <= x < ww and 0 <= y < hh):
                        break
                    covered = bool(wall[y, x])
                    if not wall_body:
                        if covered:
                            wall_body = True
                        continue
                    if not covered:
                        if gap_start is None:
                            gap_start = t
                        continue
                    if gap_start is not None and t - gap_start >= GAP_MIN:
                        best_t = (float(t), q)
                        break
            if best_t is not None:
                cands.append((e.copy(), best_t[1], s.th, 'ray'))

    out = []
    # pair evidence beats ray casts; among equals the tighter span first.
    # No cross-candidate suppression here — a long phantom pair gap across
    # open floor used to swallow the real door gap sharing its line, and
    # when classification later killed the phantom the door stayed lost.
    # classify_openings suppresses against ACCEPTED openings instead.
    for pa, pb, wd, src in sorted(
            cands, key=lambda c: (c[3] != 'pair', float(np.linalg.norm(c[1] - c[0])))):
        g = pb - pa
        gl = float(np.linalg.norm(g))
        if gl > 1:
            d = g / gl
            pa = to_face(wall, pa, d)
            pb = to_face(wall, pb, -d)
            if float(np.dot(pb - pa, d)) < GAP_MIN:
                continue
        out.append((pa, pb, wd, src))
    return out


def gap_covers_same_span(pa, pb, qa, qb):
    """True when two gap candidates describe the same opening: same line
    (angle + lateral) with substantial interval overlap. A midpoint test
    misses ray gaps that overshoot a pair gap on one side."""
    d = pb - pa
    gl = float(np.linalg.norm(d))
    dq = qb - qa
    ql = float(np.linalg.norm(dq))
    if gl < 1e-6 or ql < 1e-6:
        return False
    d = d / gl
    cosang = abs(float(np.dot(d, dq / ql)))
    if cosang < math.cos(math.radians(8)):
        return False
    if point_line_dist(qa, pa, d) > 6 * UP or point_line_dist(qb, pa, d) > 6 * UP:
        return False
    s0, s1 = sorted((float(np.dot(qa - pa, d)), float(np.dot(qb - pa, d))))
    overlap = min(gl, s1) - max(0.0, s0)
    return overlap > 0.4 * min(gl, s1 - s0)


def boundary_gaps(masks, segs, existing):
    """Opening candidates along the silhouette outline where NO wall covers
    the boundary — balcony glazing runs whose corner piers merged into the
    perpendicular walls leave no collinear pair, so the ordinary gap search
    never sees them. Emitted on the wall centerline (outline inset by half
    the exterior thickness) with src='boundary'."""
    sil, wall = masks['sil'], masks['wall']
    h, w = sil.shape
    dist_to_wall = cv2.distanceTransform((wall == 0).astype(np.uint8), cv2.DIST_L2, 3)
    ext = [s.th for s in segs if s.exterior]
    wd = float(np.median(ext)) if ext else 10.0
    cnts, _ = cv2.findContours(sil, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return []
    poly = cv2.approxPolyDP(max(cnts, key=cv2.contourArea), 3 * UP, True)[:, 0, :].astype(float)
    cands = []
    m = len(poly)
    for i in range(m):
        a, b = poly[i], poly[(i + 1) % m]
        edge_len = float(np.linalg.norm(b - a))
        if edge_len < GAP_MIN:
            continue
        d = (b - a) / edge_len
        n = np.array([-d[1], d[0]])
        probe = (a + b) / 2 + n * 6 * UP
        px, py = int(round(probe[0])), int(round(probe[1]))
        if not (0 <= px < w and 0 <= py < h and sil[py, px]):
            n = -n
        run = None
        runs = []
        for k in np.arange(0, edge_len + 1, 3.0 * UP):
            p = a + d * min(k, edge_len)
            x, y = int(round(p[0])), int(round(p[1]))
            covered = 0 <= x < w and 0 <= y < h and dist_to_wall[y, x] <= wd * 0.9
            if not covered:
                run = [k, k] if run is None else [run[0], k]
            else:
                if run and run[1] - run[0] >= 14 * UP:
                    runs.append(run)
                run = None
        if run and run[1] - run[0] >= 14 * UP:
            runs.append(run)
        for k0, k1 in runs:
            if k1 - k0 > 700 * UP:
                continue
            off = n * (wd / 2)
            pa = a + d * k0 + off
            pb = a + d * k1 + off
            if any(gap_covers_same_span(pa, pb, qa, qb) for qa, qb, _, _ in existing + cands):
                continue
            cands.append((pa, pb, wd, 'boundary'))
    return cands


def strip_mask(shape, a, b, width):
    canvas = np.zeros(shape, np.uint8)
    d = b - a
    L = np.linalg.norm(d)
    if L < 1:
        return canvas
    d = d / L
    nvec = np.array([-d[1], d[0]]) * (width / 2)
    poly = np.array([a + nvec, b + nvec, b - nvec, a - nvec]).astype(np.int32)
    cv2.fillConvexPoly(canvas, poly, 1)
    return canvas


def gap_cross_profile(v_img, pa, pb, wd):
    """Median V per 1px lateral offset across the gap strip — the gap's
    cross-section. Real openings carry bright fixture renders (glazing frame,
    door sill/leaf); open floor between distant collinear walls is uniform
    tile/wood and profiles flat."""
    glen = float(np.linalg.norm(pb - pa))
    if glen < 4:
        return []
    d = (pb - pa) / glen
    nvec = np.array([-d[1], d[0]])
    h, w = v_img.shape
    prof = []
    ts = np.linspace(2, glen - 2, max(int(glen / 2), 8))
    for off in np.arange(-(wd / 2 + 1), wd / 2 + 1.01, 1.0):
        pts = pa[None] + ts[:, None] * d[None] + off * nvec[None]
        xs = np.clip(np.round(pts[:, 0]).astype(int), 0, w - 1)
        ys = np.clip(np.round(pts[:, 1]).astype(int), 0, h - 1)
        prof.append(float(np.median(v_img[ys, xs])))
    return prof


def window_frame_evidence(v_img, pa, pb, wd):
    """Rejects window candidates over bare open floor. A real glazing/counter
    render modulates the cross profile (measured >= 43: frame capsules ~77+,
    thin counter double-lines ~43) while uniform tile/wood between distant
    collinear walls stays flat (measured <= 15 even with grout running
    parallel to the gap, which fools the thin-line/cover test)."""
    prof = gap_cross_profile(v_img, pa, pb, wd)
    return bool(prof) and max(prof) - min(prof) >= 25


def split_fixture_gap(pa, pb, wd, masks, scale=None):
    """Split one long source gap when two bright fixture runs flank a dark hinge.

    The left diagonal barrier contains two adjacent door leaves. Hough sees
    one long gap, while the source render has two bright runs separated by a
    dark central hinge. Splitting from that measured profile preserves two
    semantic openings without inventing a wall or using plan coordinates.
    """
    v_img = masks['v']
    glen = float(np.linalg.norm(pb - pa))
    # The split is physical evidence for two adjacent doors, so use the
    # measured plan scale instead of a source-coordinate threshold.  A
    # 1.2--1.8 m parent span is broad enough for a paired door while keeping
    # ordinary long walls and unscaled sketches on the normal path.
    if scale is None or not (1.2 <= glen * float(scale) / 1000.0 <= 1.8):
        return []
    d = (pb - pa) / glen
    nvec = np.array([-d[1], d[0]])
    h, w = v_img.shape
    offsets = np.arange(-(wd / 2 + 1), wd / 2 + 1.01, 1.0)
    ts = np.arange(2.0, glen - 1.0, 2.0)
    values = []
    for t in ts:
        points = pa + t * d + offsets[:, None] * nvec
        xs = np.clip(np.rint(points[:, 0]).astype(int), 0, w - 1)
        ys = np.clip(np.rint(points[:, 1]).astype(int), 0, h - 1)
        values.append(float(np.max(v_img[ys, xs])))
    if len(values) < 12:
        return []
    bright = np.asarray(values) >= 235.0
    runs = []
    start = None
    for index, hit in enumerate(np.r_[bright, False]):
        if hit and start is None:
            start = index
        elif not hit and start is not None:
            if index - start >= 3:
                runs.append((start, index))
            start = None
    if len(runs) < 2:
        return []
    # Use the first separated pair. A genuine double fixture has a clear
    # source-scale dark hinge; uniform floor never creates two bright runs.
    for first, second in zip(runs, runs[1:]):
        dark_start, dark_end = first[1], second[0]
        dark_length = (dark_end - dark_start) * 2.0
        if dark_length < 6.0 * UP:
            continue
        split_t = float((ts[first[1] - 1] + ts[second[0]]) / 2.0)
        split = pa + d * split_t
        if min(split_t, glen - split_t) < GAP_MIN:
            continue
        left_profile = gap_cross_profile(v_img, pa, split, wd)
        right_profile = gap_cross_profile(v_img, split, pb, wd)
        if not left_profile or not right_profile:
            continue
        if any(max(profile) < 235.0 or max(profile) - min(profile) < 25.0
               for profile in (left_profile, right_profile)):
            continue
        # Each half must remain a topological barrier.  This is what makes
        # the two ridges semantic doors rather than merely bright floor
        # decoration, and keeps the low-score fixture branch source-backed.
        if not (gap_separates(masks, pa, split, wd)
                and gap_separates(masks, split, pb, wd)):
            continue
        return [(pa.copy(), split.copy(), wd, 'fixture-split'),
                (split.copy(), pb.copy(), wd, 'fixture-split')]
    return []


def wall_barrier_span(pa, pb, masks, max_extension=45.0 * UP, segs=None):
    """Expand a semantic ray gap to its source wall flanks when present.

    Ray endpoints are often placed on the bright fixture itself.  Use nearby
    retained wall geometry to recover the full barrier: parallel wall ends
    contribute their projected endpoint, while a perpendicular wall whose
    endpoint stops just short of the ray contributes its projected crossing.
    The raster scan remains the fallback for plans without a usable segment.
    """
    wall = masks['wall']
    h, w = wall.shape

    def flank(point, direction):
        for distance in np.arange(0.0, max_extension + 0.1, 1.0):
            q = point + direction * distance
            x, y = int(round(q[0])), int(round(q[1]))
            if not (0 <= x < w and 0 <= y < h):
                break
            if wall[y, x]:
                return q
        return point.copy()

    gap_length = float(np.linalg.norm(pb - pa))
    direction = (pb - pa) / (gap_length + 1e-9)
    left_scalar = 0.0
    right_scalar = gap_length
    if segs:
        gap_angle = math.degrees(math.atan2(direction[1], direction[0])) % 180.0
        flank_points = []
        for segment in segs:
            segment_angle = segment.angle
            parallel = ang_diff(segment_angle, gap_angle) <= 8.0
            for endpoint in (segment.p1, segment.p2):
                scalar = float(np.dot(endpoint - pa, direction))
                lateral = point_line_dist(endpoint, pa, direction)
                if lateral > max_extension:
                    continue
                if scalar < -max_extension or scalar > gap_length + max_extension:
                    continue
                # Parallel wall ends and nearby perpendicular endpoints are
                # both valid flanks; the latter covers a wall that terminates
                # a few pixels before the semantic ray line.
                if parallel or abs(ang_diff(segment_angle, gap_angle) - 90.0) <= 12.0:
                    flank_points.append(scalar)
        left_candidates = [scalar for scalar in flank_points
                           if -max_extension <= scalar <= 0.0]
        right_candidates = [scalar for scalar in flank_points
                            if gap_length <= scalar <= gap_length + max_extension]
        if left_candidates:
            left_scalar = max(left_candidates)
        if right_candidates:
            right_scalar = min(right_candidates)

    left = pa + direction * left_scalar
    right = pa + direction * right_scalar
    # Keep the mask scan as a fallback when no retained endpoint supplied a
    # flank.  Start beyond the semantic endpoint so a fixture pixel cannot
    # masquerade as the wall itself.
    if not segs or not left_scalar:
        left = flank(pa + direction * min(2.0 * UP, gap_length / 3), -direction)
    if not segs or right_scalar == gap_length:
        right = flank(pb + direction * min(2.0 * UP, gap_length / 3), direction)
    return left, right


def gap_separates(masks, pa, pb, wd, source=None):
    """True when blocking the gap strip locally disconnects its two sides —
    the topological definition of a doorway. A phantom gap cast through a
    room's interior (bath tile is bright enough to fool the sill gate) has
    the same room on both sides, which stay connected around the strip."""
    sil, wall = masks['sil'], masks['wall']
    h, w = sil.shape
    glen = float(np.linalg.norm(pb - pa))
    if glen < 2:
        return True
    d = (pb - pa) / glen
    nvec = np.array([-d[1], d[0]])
    # Include enough of the adjacent wall runs for the blocked strip to be
    # tested against the actual local topology. Rays need a wider local crop
    # because their semantic endpoint can stop inside the room; preserve the
    # original compact pair crop for ordinary wall gaps.
    pad_factor = 1.25 if source == 'ray' else 0.6
    pad = int(max(24 * UP, wd * 3, glen * pad_factor))
    x0 = max(int(min(pa[0], pb[0])) - pad, 0)
    x1 = min(int(max(pa[0], pb[0])) + pad, w - 1)
    y0 = max(int(min(pa[1], pb[1])) - pad, 0)
    y1 = min(int(max(pa[1], pb[1])) + pad, h - 1)
    free = ((wall[y0:y1 + 1, x0:x1 + 1] == 0) & (sil[y0:y1 + 1, x0:x1 + 1] > 0)).astype(np.uint8)
    block = strip_mask(free.shape, pa - [x0, y0], pb - [x0, y0], wd + 4)
    free[block > 0] = 0
    n, lab = cv2.connectedComponents(free, 8)

    def probe_label(sign):
        for k in range(int(wd / 2) + 3 * UP, int(wd / 2) + 12 * UP):
            p = (pa + pb) / 2 + nvec * sign * k - [x0, y0]
            x, y = int(round(p[0])), int(round(p[1]))
            if 0 <= x < free.shape[1] and 0 <= y < free.shape[0] and free[y, x]:
                return int(lab[y, x])
        return None

    la, lb = probe_label(1), probe_label(-1)
    if la is None or lb is None:
        return True  # a side is buried in wall — inconclusive, don't reject
    return la != lb


def source_room_barriers(relaxed_segs, masks, scale=None):
    """Return source-backed barrier spans for room components only.

    The relaxed thickness pass is an evidence lane: its gaps can recover a
    missing room divider even when opening classification rejects the same
    candidate.  Keep the result as plain spans so it cannot enter structural
    walls, semantic openings, or the serialized output.
    """
    if scale is None:
        return []

    candidates = []
    for gap in collinear_gaps(relaxed_segs, masks['wall']):
        split = split_fixture_gap(gap[0], gap[1], gap[2], masks, scale=scale)
        candidates.extend(split or [gap])

    accepted = []
    seen = set()
    for pa, pb, width, source in candidates:
        gap_length = float(np.linalg.norm(pb - pa))
        gap_m = gap_length * float(scale) / 1000.0
        if not (0.4 <= gap_m <= 1.8):
            continue
        strip = strip_mask(masks['wall'].shape, pa, pb, width + 3.0 * UP)
        area = max(int(strip.sum()), 1)
        thin_frac = float((strip & masks['thin']).sum()) / area
        wall_frac = float((strip & masks['wall']).sum()) / area
        if thin_frac < 0.25 or wall_frac > 0.30:
            continue
        profile = gap_cross_profile(masks['v'], pa, pb, width)
        if not profile or max(profile) - min(profile) < 25.0:
            continue
        separates = gap_separates(masks, pa, pb, width, source=source)
        if not separates:
            if source != 'ray' or max(profile) < 235.0:
                continue
            hypothesis = door_hypothesis(
                masks['stroke'], pa, pb, gap_length, scale,
                v_img=masks['v'])
            if hypothesis is None or hypothesis[0] < 0.8:
                continue
            if inner_clutter(masks['stroke'], hypothesis[1], hypothesis[2],
                             hypothesis[3], hypothesis[4]) > 0.38:
                continue

        a_key = tuple(np.round(np.asarray(pa, dtype=float), 3))
        b_key = tuple(np.round(np.asarray(pb, dtype=float), 3))
        ends = tuple(sorted((a_key, b_key)))
        key = (ends[0], ends[1], round(float(width), 3))
        if key in seen:
            continue
        seen.add(key)
        accepted.append((np.asarray(pa, dtype=float).copy(),
                         np.asarray(pb, dtype=float).copy(), float(width)))
    return accepted


def _entrance_endpoint_candidates(first, second):
    """Find parallel jamb endpoints that form a transverse doorway gap."""
    if ang_diff(first.angle, second.angle) > 8.0:
        return []
    if min(first.length, second.length) < 18.0 * UP:
        return []
    candidates = []
    for pa, body_a in ((first.p1, first.p2 - first.p1),
                       (first.p2, first.p1 - first.p2)):
        body_a = body_a / (np.linalg.norm(body_a) + 1e-9)
        for pb, body_b in ((second.p1, second.p2 - second.p1),
                           (second.p2, second.p1 - second.p2)):
            body_b = body_b / (np.linalg.norm(body_b) + 1e-9)
            if float(np.dot(body_a, body_b)) < 0.75:
                continue
            gap = pb - pa
            gap_len = float(np.linalg.norm(gap))
            if not (25.0 * UP <= gap_len <= 110.0 * UP):
                continue
            if abs(float(np.dot(gap / gap_len, body_a))) > 0.30:
                continue
            if abs(float(np.dot(gap, body_a))) > 12.0 * UP:
                continue
            candidates.append((pa.copy(), pb.copy(), gap_len, body_a, body_b))
    return candidates


def _entrance_wall_support(masks, point, body, width):
    """Require gray wall pixels immediately inside the proposed jamb."""
    wall = masks['wall']
    height, image_width = wall.shape
    normal = np.array([-body[1], body[0]])
    hits = samples = 0
    for distance in np.arange(1.0, max(8.0 * UP, width * 1.8) + 0.1):
        for side in (-0.5, 0.0, 0.5):
            q = point + body * distance + normal * width * side
            x, y = np.rint(q).astype(int)
            if 0 <= x < image_width and 0 <= y < height:
                samples += 1
                hits += int(bool(wall[y, x]))
    return samples > 0 and hits / samples >= 0.35


def _entrance_white_fraction(masks, a, b, width):
    strip = strip_mask(masks['wall'].shape, a, b, width + 3.0 * UP)
    return float((strip & masks['white']).sum()) / max(int(strip.sum()), 1)


def find_entrance_gap_candidate(masks, segs, entrance_pts, scale=None,
                                max_ocr_distance=None):
    """Return an OCR-gated transverse entrance gap or ``None``.

    This only returns an existing pair of wall endpoints.  The candidate must
    also carry a bright sill/profile, separate the two sides, and pass the
    existing swing-arc hypothesis; it never creates a wall or room boundary.
    """
    if not entrance_pts:
        return None
    max_ocr_distance = (120.0 * UP if max_ocr_distance is None
                        else float(max_ocr_distance))
    points = []
    for point in entrance_pts:
        point = np.asarray(point, dtype=float).reshape(-1)[:2]
        if point.size == 2 and np.all(np.isfinite(point)):
            points.append(point)
    if not points:
        return None

    best = None
    seg_list = list(segs)
    for index, first in enumerate(seg_list):
        for second in seg_list[index + 1:]:
            for pa, pb, gap_len, body_a, body_b in _entrance_endpoint_candidates(first, second):
                width = max(float(first.th), float(second.th))
                if not (_entrance_wall_support(masks, pa, body_a, width)
                        and _entrance_wall_support(masks, pb, body_b, width)):
                    continue
                midpoint = (pa + pb) / 2.0
                ocr_distance = min(float(np.linalg.norm(midpoint - point)) for point in points)
                if ocr_distance > max_ocr_distance:
                    continue
                profile = gap_cross_profile(masks['v'], pa, pb, width)
                if (not profile or max(profile) < 235.0
                        or max(profile) - min(profile) < 25.0):
                    continue
                if _entrance_white_fraction(masks, pa, pb, width) < 0.10:
                    continue
                if not gap_separates(masks, pa, pb, width):
                    continue
                hypothesis = door_hypothesis(masks['stroke'], pa, pb, gap_len, scale,
                                             v_img=masks['v'])
                if hypothesis is None or hypothesis[0] < 0.62:
                    continue
                candidate = (pa.copy(), pb.copy(), width, 'entrance-transverse')
                score = (ocr_distance, -float(hypothesis[0]))
                if best is None or score < best[0]:
                    best = (score, candidate)
    return best[1] if best else None


def classify_openings(gaps, masks, segs, scale=None, entrance_pts=None,
                      semantic_gaps=None):
    wall, thin, stroke, outside = masks['wall'], masks['thin'], masks['stroke'], masks['outside']
    h, w = wall.shape
    openings = []

    # A long gap with two bright runs and a dark hinge is two semantic doors,
    # not one wide window. Replace that parent in place so the normal
    # pair-before-ray ordering from ``collinear_gaps`` remains intact for all
    # other openings.
    expanded_gaps = []
    for gap in list(gaps) + list(semantic_gaps or ()):
        split = split_fixture_gap(gap[0], gap[1], gap[2], masks, scale=scale)
        expanded_gaps.extend(split or [gap])
    gaps = expanded_gaps

    def make_opening(kind, pa, pb, wd, src, **kwargs):
        barrier_a = barrier_b = None
        barrier_width = None
        if src == 'ray':
            barrier_a, barrier_b = wall_barrier_span(pa, pb, masks, segs=segs)
            barrier_width = wd
        return Opening(kind, pa, pb, wd, src=src,
                       barrier_a=barrier_a, barrier_b=barrier_b,
                       barrier_width=barrier_width, **kwargs)

    for pa, pb, wd, src in gaps:
        glen = float(np.linalg.norm(pb - pa))
        # suppress against accepted openings only — a candidate rejected by
        # the evidence gates must not shadow the real opening on its line
        if any(gap_covers_same_span(pa, pb, o.a, o.b) for o in openings):
            continue
        # ray gaps may overrun an under-extracted wall; judge only the near
        # portion so a door at the cast origin still qualifies
        gate_end = pb if src == 'pair' else pa + (pb - pa) * min(1.0, 72 * UP / max(glen, 1))
        strip = strip_mask(wall.shape, pa, gate_end, wd + 3 * UP)
        area = max(int(strip.sum()), 1)
        wall_frac = float((strip & wall).sum()) / area
        if wall_frac > 0.30:
            continue
        strip = strip_mask(wall.shape, pa, pb, wd + 3 * UP)
        area = max(int(strip.sum()), 1)
        d = (pb - pa) / (glen + 1e-9)
        thin_frac = float((strip & thin).sum()) / area
        ys, xs = np.nonzero(strip & thin)
        cover = 0.0
        if len(xs):
            ts = np.dot(np.stack([xs, ys], 1) - pa, d)
            bin_w = 4 * UP
            hist = np.zeros(max(int(glen / bin_w) + 1, 1), bool)
            hist[np.clip((ts / bin_w).astype(int), 0, len(hist) - 1)] = True
            cover = hist.mean()
        # exterior-facing gaps are almost always glazing; measured true doors
        # score >=0.84 there while tick-noise false arcs sit near 0.5
        nvec = np.array([-d[1], d[0]])
        mid = (pa + pb) / 2
        ext_facing = False
        for sign in (1, -1):
            hits = total = 0
            for k in (0.8, 1.5, 2.2):
                p = mid + nvec * sign * wd * k
                x, y = int(round(p[0])), int(round(p[1]))
                if 0 <= x < w and 0 <= y < h:
                    total += 1
                    hits += int(outside[y, x] > 0)
            if total and hits / total >= 0.67:
                ext_facing = True
        # 0.45, not 0.5: linear upscaling systematically lowers swing-arc
        # coverage ~0.05 (measured 0.42-0.47 on real doors); false-arc
        # scores drop by the same amount so the relative margin holds
        min_door_score = 0.62 if ext_facing else 0.45
        if entrance_pts:
            for ep in entrance_pts:
                if float(np.linalg.norm(mid - ep)) <= 120 * UP:
                    min_door_score = 0.45
                    break
        # boundary spans are glazing by construction: a real door always has
        # framing walls, so pair/ray finds it; nearby entrance arcs otherwise
        # bleed into a boundary strip and mint phantom doors
        # physical width cap: px thresholds scale badly on coarse plans
        # (22.7 mm/px turns 150 px into a 3.4 m "door" across open floor).
        # Real door gaps always render a bright fixture (white sill/leaf,
        # >= 238 measured; bath doors on white tile too) — an open-floor gap
        # peaks at tile brightness ~221 even when a neighbor's swing arc
        # strays into the hypothesis.
        if src != 'boundary' and 13 * UP <= glen <= ((110 if src == 'pair' else 150) * UP) \
                and (not scale or glen * scale <= 1750):
            door_prof = gap_cross_profile(masks['v'], pa, pb, wd)
            # a real doorway renders a bright sill/leaf (max >= 235) that
            # stands out from its surroundings (contrast >= 15; diagonal
            # sills alias down that far) — unless the strip sits entirely on
            # the pure-white leaf (min >= 250, diagonal doors). A ray through
            # a white-tiled bath interior is bright but FLAT (contrast <= 7).
            # Do NOT relax the 235 peak for high-contrast strips: window
            # capsules modulate just as strongly and drift into doors.
            if not door_prof or max(door_prof) < 235 or (
                    max(door_prof) - min(door_prof) < 15 and min(door_prof) < 250):
                door_prof = None
            # a doorway must locally separate its two sides; a ray cast
            # through a bright-tiled room interior passes the sill gate but
            # keeps the same room on both flanks
            if door_prof and not gap_separates(masks, pa, pb, wd, source=src):
                # Strong source-backed ray swings are the bounded exception:
                # the ray endpoint can stop just inside a room, so the local
                # crop may report one component even when the independent
                # dark arc, source profile, and score identify a doorway.
                topology_hyp = door_hypothesis(
                    stroke, pa, pb, glen, scale, v_img=masks['v'])
                strong_ray = False
                if topology_hyp is not None and src == 'ray':
                    topology_clutter = inner_clutter(
                        stroke, topology_hyp[1], topology_hyp[2],
                        topology_hyp[3], topology_hyp[4])
                    topology_arc = arc_coverage(
                        stroke, topology_hyp[1], topology_hyp[2],
                        topology_hyp[3], topology_hyp[4])
                    barrier_a, barrier_b = wall_barrier_span(
                        pa, pb, masks, segs=segs)
                    barrier_len = float(np.linalg.norm(barrier_b - barrier_a))
                    physical = (glen * scale / 1000.0
                                if scale else None)
                    strong_ray = (
                        topology_hyp[0] >= 0.8
                        and topology_clutter <= 0.38
                        and topology_arc >= 0.8
                        and thin_frac >= 0.25
                        and wall_frac <= 0.30
                        and (physical is None or 0.4 <= physical <= 1.8)
                        and barrier_len >= glen * 0.65)
                if not strong_ray:
                    door_prof = None
        else:
            door_prof = None
        if door_prof:
            hyp = door_hypothesis(stroke, pa, pb, glen, scale, v_img=masks['v'])
            # a real swing region is clutter-free inside the arc; window/grout
            # corners that mimic an arc are dense with lines there too. Sample
            # away from 0/90 deg so the door frame and leaf earn no penalty.
            # Real doors over tiled floors still need a clean enough swing
            # hypothesis; fixture evidence only lowers the score floor for
            # the explicitly split double-door source span.
            if hyp:
                clutter = inner_clutter(stroke, hyp[1], hyp[2], hyp[3], hyp[4])
                fixture_branch = (src == 'fixture-split'
                                  and hyp[0] >= 0.35 and clutter <= 0.38
                                  and _bright_parallel_capsule(masks['v'], pa, pb, wd))
                # White door arcs are absent from the dark-only stroke mask.
                # Require an independent light-arc trace in the source value
                # image plus a normal door score; uniform white capsules do
                # not produce this coverage.
                light_arc = arc_coverage(
                    np.zeros_like(stroke), hyp[1], hyp[2], hyp[3], hyp[4],
                    v_img=masks['v'])
                dark_arc = arc_coverage(
                    stroke, hyp[1], hyp[2], hyp[3], hyp[4])
                white_arc_branch = (
                    src in ('pair', 'ray') and hyp[0] >= 0.55
                    and light_arc >= 0.55)
                arc_proof = (dark_arc >= min_door_score
                             or light_arc >= 0.55)
                ordinary_branch = (hyp[0] >= min_door_score
                                   and (hyp[0] >= 0.8
                                        and arc_proof
                                        or (clutter <= 0.38 and arc_proof)
                                        or white_arc_branch))
            else:
                clutter = None
                fixture_branch = ordinary_branch = False
            if hyp and (fixture_branch or ordinary_branch):
                _, hinge, d_along, side, r = hyp
                a0 = math.degrees(math.atan2(d_along[1], d_along[0])) % 360
                a1 = math.degrees(math.atan2(side[1], side[0])) % 360
                # sweep from the wall direction toward the swing side
                if abs((a1 - a0) % 360 - 90) < 1:
                    arc_from, arc_to = a0, a0 + 90
                else:
                    arc_from, arc_to = a0 - 90, a0
                openings.append(make_opening('door', pa, pb, wd, src,
                                             hinge=hinge.copy(), radius=r,
                                             arc_from=arc_from, arc_to=arc_to))
                continue
        # a long ray can cross a whole room; only near-continuous double
        # lines (counters, glazing) justify a window at that range
        # silhouette jags (stair landings, entrance nooks) that upscaling now
        # resolves emit boundary slivers far below any real glazing run
        if src == 'boundary' and scale and glen * scale < 350:
            continue
        win_ok = (thin_frac >= 0.08 and cover >= 0.75) if (src == 'ray' and glen > 155 * UP) \
            else (thin_frac >= 0.045 and cover >= 0.45)
        # grout lines parallel to the gap satisfy thin/cover across open
        # floor; demand the framed-glazing cross profile for pair/ray windows
        # (boundary spans sit on the silhouette and cannot cross a room)
        profile = gap_cross_profile(masks['v'], pa, pb, wd)
        hypothesis = None
        if win_ok and src != 'boundary' and not window_frame_evidence(masks['v'], pa, pb, wd):
            win_ok = False
        if win_ok and src != 'boundary':
            # A ray through an interior fixture is an uncertain opening. Ray
            # windows need an exterior flank and a bright framed capsule;
            # internal pair windows are retained only for the long repeated
            # glazing run between the living room and balcony.
            if src == 'ray':
                win_ok = bool(ext_facing and profile and max(profile) >= 235.0)
            elif not ext_facing:
                clutter = None
                hypothesis = door_hypothesis(stroke, pa, pb, glen, scale,
                                             v_img=masks['v'])
                if hypothesis is not None:
                    clutter = inner_clutter(stroke, hypothesis[1], hypothesis[2],
                                             hypothesis[3], hypothesis[4])
                long_glazing = (glen >= 50.0 * UP
                                and profile
                                and max(profile) - min(profile) >= 25.0
                                and not (hypothesis is not None
                                         and hypothesis[0] >= 0.45
                                         and clutter is not None and clutter > 0.5))
                win_ok = bool(long_glazing)
        if win_ok:
            openings.append(make_opening('window', pa, pb, wd, src))
        elif (src == 'pair' and not ext_facing
              and 50 * UP <= glen <= 150 * UP
              and (not scale or 0.8 <= glen * scale / 1000 <= 1.8)
              and thin_frac >= 0.25 and cover >= 0.75
              and profile and max(profile) < 235
              and max(profile) - min(profile) >= 25
              and wall_frac <= 0.35
              and gap_separates(masks, pa, pb, wd, source=src)
              and (hypothesis is None
                   or arc_coverage(stroke, hypothesis[1], hypothesis[2],
                                   hypothesis[3], hypothesis[4]) < 0.55)):
            # Repeated balcony glazing rails can carry a dense thin-line
            # signal without a bright sill.  The low peak keeps bright
            # interior fixtures (for example the kitchen opening) on the
            # uncertain-opening path.
            openings.append(make_opening('window', pa, pb, wd, src))
        elif src == 'pair' and glen <= 150 * UP and (not scale or glen * scale <= 1800):
            ang = math.degrees(math.atan2(d[1], d[0])) % 90
            if min(ang, 90 - ang) > 8 and glen < 60 * UP:
                continue  # short diagonal skeleton artifact, not an opening
            # a real pass-through still renders something across the gap
            # (sill strip, header line); uniform floor (contrast < 25) means
            # the "gap" is open space between unrelated collinear walls
            prof = gap_cross_profile(masks['v'], pa, pb, wd)
            if not prof or max(prof) - min(prof) < 25:
                continue
            # a bare hole in the exterior shell is glazing in reality
            kind = 'window' if ext_facing else 'opening'
            openings.append(make_opening(kind, pa, pb, wd, src))
        elif (src in ('ray', 'entrance-transverse') and profile
              and max(profile) >= 235
              and max(profile) - min(profile) >= 25
              and thin_frac >= 0.25 and wall_frac <= 0.30
              and gap_separates(masks, pa, pb, wd, source=src)
              and (not scale or 0.4 <= glen * scale / 1000 <= 1.8)):
            # Preserve a source-backed physical gap when the strict swing
            # hypothesis is inconclusive.  It remains an uncertain opening;
            # only the external-facing glazing branch above may call it a
            # window.  Ray openings carry their full wall barrier metadata.
            openings.append(make_opening('opening', pa, pb, wd, src))
    return openings


# --------------------------------------------------------------------------
# rooms
# --------------------------------------------------------------------------

def detect_rooms(img, masks, segs, openings, scale=None, ocr_items=None,
                 room_barriers=None):
    sil, wall, dark = masks['sil'], masks['wall'], masks['dark']
    h, w = sil.shape
    barrier = render_walls(segs, sil.shape) | wall
    for o in openings:
        # Opening detection can keep a semantic span separate from the wider
        # room barrier used to prevent sliver merges.
        a = o.barrier_a if o.barrier_a is not None else o.a
        b = o.barrier_b if o.barrier_b is not None else o.b
        width = o.barrier_width if o.barrier_width is not None else o.width
        barrier |= strip_mask(sil.shape, a, b, width + 4 * UP)
    for a, b, width in room_barriers or ():
        barrier |= strip_mask(sil.shape, a, b, width + 4 * UP)

    # Keep the global dark mask as a room barrier.  Only the actual pixels in
    # OCR room-label boxes are removed; the bbox expansion below is for
    # component protection and must not erase nearby source barriers.
    room_dark = dark.copy()
    for item in ocr_items or ():
        text = str(item.get('text', '')).strip()
        if not any(word in text for words in ROOM_WORDS.values() for word in words):
            continue
        x0 = max(0, int(math.floor(item['x'])))
        y0 = max(0, int(math.floor(item['y'])))
        x1 = min(w, int(math.ceil(item['x'] + item['w'])))
        y1 = min(h, int(math.ceil(item['y'] + item['h'])))
        if x0 < x1 and y0 < y1:
            room_dark[y0:y1, x0:x1] = 0
    barrier |= cv2.dilate(room_dark, np.ones((2 * UP, 2 * UP), np.uint8))
    space = sil & (1 - (barrier > 0).astype(np.uint8))
    space = cv2.morphologyEx(space, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(space, 4)

    protected = set()
    for item in ocr_items or ():
        text = str(item.get('text', '')).strip()
        if not any(word in text for words in ROOM_WORDS.values() for word in words):
            continue
        x0 = max(0, int(math.floor(item['x'] - 3 * UP)))
        y0 = max(0, int(math.floor(item['y'] - 3 * UP)))
        x1 = min(w, int(math.ceil(item['x'] + item['w'] + 3 * UP)))
        y1 = min(h, int(math.ceil(item['y'] + item['h'] + 3 * UP)))
        if x0 >= x1 or y0 >= y1:
            continue
        labels = np.unique(lab[y0:y1, x0:x1])
        protected.update(int(label) for label in labels if label > 0)

    # absorb sub-room slivers (opening-barrier offcuts, jaggy necks) into a
    # bigger neighbor reachable without crossing an actual wall: geodesic
    # dilation over the full barrier complement cannot cross source-backed
    # openings, dark fixtures, or wall geometry.
    keep_px = int(0.85e6 / (scale * scale)) if scale else 1400
    free = (barrier == 0).astype(np.uint8)
    k3 = np.ones((3, 3), np.uint8)
    for i in sorted(range(1, n), key=lambda k: stats[k, cv2.CC_STAT_AREA]):
        area = stats[i, cv2.CC_STAT_AREA]
        if i in protected or area < MIN_ROOM_AREA_PX or area >= keep_px:
            continue
        seed = (lab == i).astype(np.uint8)
        for _ in range(13 * UP):
            seed = cv2.dilate(seed, k3) & free
        touched = np.bincount(lab[seed > 0], minlength=n)
        touched[0] = touched[i] = 0
        if touched.max() == 0:
            continue
        cand = [j for j in np.nonzero(touched)[0]
                if stats[j, cv2.CC_STAT_AREA] > area]
        if not cand:
            continue
        j = max(cand, key=lambda k: stats[k, cv2.CC_STAT_AREA])
        lab[lab == i] = j
        stats[j, cv2.CC_STAT_AREA] += area
        stats[i, cv2.CC_STAT_AREA] = 0

    # unmergeable specks (door-swing pockets bulging the silhouette, niches)
    drop_px = int(0.6e6 / (scale * scale)) if scale else 1000
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    rooms = []
    for i in range(1, n):
        if i not in protected and stats[i, cv2.CC_STAT_AREA] < max(MIN_ROOM_AREA_PX, drop_px):
            continue
        comp = (lab == i).astype(np.uint8)
        Hm = int(np.median(hsv[:, :, 0][comp > 0]))
        Sm = int(np.median(hsv[:, :, 1][comp > 0]))
        Vm = int(np.median(hsv[:, :, 2][comp > 0]))
        cls = classify_room_color(Hm, Sm, Vm)
        close_k = 2 * UP * 2 + 1
        comp_c = cv2.morphologyEx(comp, cv2.MORPH_CLOSE, np.ones((close_k, close_k), np.uint8))
        cnts, _ = cv2.findContours(comp_c, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not cnts:
            continue
        cnt = max(cnts, key=cv2.contourArea)
        poly = cv2.approxPolyDP(cnt, 2.2 * UP, True)[:, 0, :].astype(float)
        poly = snap_rectilinear(poly)
        M = cv2.moments(comp)
        cx, cy = M['m10'] / (M['m00'] + 1e-9), M['m01'] / (M['m00'] + 1e-9)
        rooms.append(dict(poly=poly, cls=cls, area_px=float(stats[i, cv2.CC_STAT_AREA]),
                          centroid=(cx, cy), hsv=(Hm, Sm, Vm), label=None))
    return rooms


def classify_room_color(H, S, V):
    if S >= 38 and 5 <= H <= 32:
        return 'bedroom'
    if 14 <= S < 38 and 8 <= H <= 42 and V >= 210:
        return 'balcony'
    if S < 20 and V >= 231:
        return 'bath'
    if S < 30 and 190 <= V < 234:
        return 'living'
    return 'room'


def snap_rectilinear(poly, tol=3.0 * UP):
    pts = poly.copy()
    m = len(pts)
    for i in range(m):
        j = (i + 1) % m
        dx, dy = abs(pts[j][0] - pts[i][0]), abs(pts[j][1] - pts[i][1])
        if dx <= tol < dy:
            mean = (pts[i][0] + pts[j][0]) / 2
            pts[i][0] = pts[j][0] = mean
        elif dy <= tol < dx:
            mean = (pts[i][1] + pts[j][1]) / 2
            pts[i][1] = pts[j][1] = mean
    return pts


# --------------------------------------------------------------------------
# OCR (macOS Vision via Swift helper)
# --------------------------------------------------------------------------

def ensure_ocr_bin():
    src = os.path.join(TOOL_DIR, 'ocr_vision.swift')
    binp = os.path.join(TOOL_DIR, '.build', 'ocr_vision')
    if not os.path.exists(src):
        return None
    if os.path.exists(binp) and os.path.getmtime(binp) >= os.path.getmtime(src):
        return binp
    os.makedirs(os.path.dirname(binp), exist_ok=True)
    r = subprocess.run(['swiftc', '-O', src, '-o', binp], capture_output=True, text=True)
    if r.returncode != 0:
        sys.stderr.write('[ocr] swiftc failed: ' + r.stderr[:400] + '\n')
        return None
    return binp


def run_ocr(img_path, cache_dir):
    os.makedirs(cache_dir, exist_ok=True)
    cache = os.path.join(cache_dir, os.path.splitext(os.path.basename(img_path))[0] + '.json')
    if os.path.exists(cache):
        return json.load(open(cache))
    binp = ensure_ocr_bin()
    if binp is None:
        return []
    try:
        r = subprocess.run([binp, img_path], capture_output=True, text=True, timeout=90)
        items = json.loads(r.stdout) if r.returncode == 0 and r.stdout.strip() else []
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f'[ocr] failed: {e}\n')
        items = []
    json.dump(items, open(cache, 'w'), ensure_ascii=False)
    return items


def dimension_scale(ocr_items, masks, ext_th_px):
    """mm/px by matching each OCR dimension number to the dimension line
    right next to it, then majority-voting the resulting ratios. Robust for
    non-rectangular plans where overall dims don't span the silhouette bbox."""
    sil, chroma, v = masks['sil'], masks['chroma'], masks['v']
    dil_k = 4 * UP * 2 + 1
    sil_dil = cv2.dilate(sil, np.ones((dil_k, dil_k), np.uint8))
    dim = (((chroma < 22) & (v > 138) & (v < 208)).astype(np.uint8)) & (1 - sil_dil)
    lines = cv2.HoughLinesP(dim * 255, 1, np.pi / 360, 25 * UP,
                            minLineLength=30 * UP, maxLineGap=3 * UP)
    if lines is None:
        return None
    dsegs = [Seg(np.array([x1, y1], float), np.array([x2, y2], float))
             for x1, y1, x2, y2 in lines[:, 0]]
    dsegs = merge_segments(merge_segments(dsegs))
    cands = []
    for it in ocr_items:
        t = it['text'].replace(',', '').strip()
        if not t.isdigit() or len(t) < 3:
            continue
        val = int(t)
        if val < 700:
            continue
        cx, cy = it['x'] + it['w'] / 2, it['y'] + it['h'] / 2
        horizontal = it['w'] >= it['h']
        best = None
        for s in dsegs:
            ang = s.angle
            if horizontal:
                if not (ang < 8 or ang > 172):
                    continue
                x1, x2 = sorted([s.p1[0], s.p2[0]])
                if not (x1 - 8 * UP <= cx <= x2 + 8 * UP):
                    continue
                off = abs((s.p1[1] + s.p2[1]) / 2 - cy)
            else:
                if not (82 < ang < 98):
                    continue
                y1, y2 = sorted([s.p1[1], s.p2[1]])
                if not (y1 - 8 * UP <= cy <= y2 + 8 * UP):
                    continue
                off = abs((s.p1[0] + s.p2[0]) / 2 - cx)
            if off > 24 * UP:
                continue
            if best is None or off < best[0]:
                best = (off, s.length)
        if best and best[1] > 20 * UP:
            sc = val / best[1]
            if 4.0 / UP <= sc <= 30.0 / UP:
                cands.append(sc)
    if not cands:
        return None
    cands.sort()
    cluster = max(([x for x in cands if abs(x - c) <= 0.06 * c] for c in cands), key=len)
    if len(cluster) < 2:
        return None
    s = float(np.median(cluster))
    # a 3+ vote cluster of independent dimension lines is stronger evidence
    # than the exterior-thickness sanity band — wood-dense renders leave only
    # the wall outline in the mask, halving the measured thickness
    if len(cluster) < 3 and ext_th_px and not (110 <= ext_th_px * s <= 540):
        return None
    return s


def estimate_scale(ocr_items, sil, ext_th_px, masks=None):
    """mm/px from OCR dimension numbers. Prefer per-line matching; fall back
    to cross-validated silhouette-bbox pairing (rectangular plans)."""
    if masks is not None:
        s = dimension_scale(ocr_items, masks, ext_th_px)
        if s:
            return s
    ys, xs = np.nonzero(sil)
    if not len(xs):
        return None
    bw = float(xs.max() - xs.min())
    bh = float(ys.max() - ys.min())
    nums = []
    for it in ocr_items:
        t = it['text'].replace(',', '').strip()
        if t.isdigit() and len(t) >= 4 and int(t) >= 1500:
            nums.append(int(t))
    nums = sorted(set(nums), reverse=True)[:14]

    def plausible(s):
        if not (4.0 / UP <= s <= 30.0 / UP):
            return False
        return not ext_th_px or (110 <= ext_th_px * s <= 540)

    best = None
    for vw in nums:
        sw = vw / bw
        if not plausible(sw):
            continue
        for vh in nums:
            if vh == vw:
                continue
            sh = vh / bh
            if not plausible(sh):
                continue
            if abs(sw - sh) > 0.06 * max(sw, sh):
                continue
            score = vw + vh  # overall dims are the largest consistent pair
            if best is None or score > best[0]:
                best = (score, (sw + sh) / 2)
    if best:
        return best[1]
    # fallback: single axis, largest plausible number
    for v in nums:
        for ext in (bw, bh):
            s = v / ext
            if plausible(s):
                return s
    return None


def label_rooms(rooms, ocr_items):
    def word_class(txt):
        # longest matching word wins so 주방->kitchen beats 방->bedroom
        hits = [(len(wd), cls, wd) for cls, words in ROOM_WORDS.items()
                for wd in words if wd in txt]
        if not hits:
            return None, None
        hits.sort(reverse=True)
        return hits[0][1], hits[0][2]

    labels = []
    for it in ocr_items:
        txt = it['text'].strip()
        cls, wd = word_class(txt)
        if cls is None:
            continue
        labels.append(dict(text=txt, cls=cls,
                           cx=it['x'] + it['w'] / 2,
                           cy=it['y'] + it['h'] / 2))

    # Assign only source-contained labels. A relaxed distance plus greedy
    # assignment used to hide extra OCR labels when a missing barrier merged
    # two rooms; leave that component unnamed and report the conflict instead.
    TILE_CLASSES = {'living', 'room', 'entrance', 'hall'}
    matches = [[] for _ in labels]
    for li, label in enumerate(labels):
        for ri, room in enumerate(rooms):
            d = cv2.pointPolygonTest(room['poly'].astype(np.float32),
                                     (label['cx'], label['cy']), True)
            if d < -3 * UP:
                continue
            if label['cls'] == room['cls']:
                bonus = 25
            elif room['cls'] in TILE_CLASSES and label['cls'] in (
                    'entrance', 'hall', 'dress', 'storage', 'utility', 'study',
                    'shelter', 'elevator', 'kitchen', 'living'):
                bonus = 10
            else:
                bonus = 0
            matches[li].append((float(d + bonus), ri))

    diagnostics = []
    for li, label in enumerate(labels):
        if not matches[li]:
            diagnostics.append(dict(kind='unassigned-label', text=label['text'],
                                    x=label['cx'] / UP, y=label['cy'] / UP))

    room_labels = {}
    for li, candidates in enumerate(matches):
        for _, ri in candidates:
            room_labels.setdefault(ri, []).append(li)
    conflicted = {ri: lis for ri, lis in room_labels.items() if len(lis) > 1}
    for ri, lis in conflicted.items():
        texts = [labels[li]['text'] for li in lis]
        rooms[ri]['label_diagnostic'] = 'conflicted-labels'
        diagnostics.append(dict(kind='conflicted-room', room=ri, labels=texts))

    used_rooms = set()
    for li, candidates in enumerate(matches):
        if not candidates:
            continue
        candidates.sort(reverse=True)
        ri = candidates[0][1]
        if ri in conflicted or ri in used_rooms:
            continue
        used_rooms.add(ri)
        rooms[ri]['label'] = labels[li]['text']
        rooms[ri]['cls'] = labels[li]['cls']
    if diagnostics:
        sys.stderr.write('[rooms] label diagnostics: ' +
                         json.dumps(diagnostics, ensure_ascii=False) + '\n')
    return diagnostics


# --------------------------------------------------------------------------
# output
# --------------------------------------------------------------------------

def svg_escape(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def arc_path(o: Opening):
    c, r = o.hinge, o.radius
    a0, a1 = math.radians(o.arc_from), math.radians(o.arc_to)
    p0 = (c[0] + r * math.cos(a0), c[1] + r * math.sin(a0))
    p1 = (c[0] + r * math.cos(a1), c[1] + r * math.sin(a1))
    large = 1 if (o.arc_to - o.arc_from) % 360 > 180 else 0
    return (f'M {p0[0]:.1f} {p0[1]:.1f} A {r:.1f} {r:.1f} 0 {large} 1 {p1[0]:.1f} {p1[1]:.1f}',
            p0, p1)


def write_svg(path, img_shape, segs, openings, rooms, scale, meta):
    h, w = img_shape[:2]
    mm = f' data-mm-per-px="{scale:.4f}"' if scale else ''
    L = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}"{mm}>',
         f'<metadata>{svg_escape(json.dumps(meta, ensure_ascii=False))}</metadata>',
         f'<rect width="{w}" height="{h}" fill="#ffffff"/>']

    L.append('<g id="rooms">')
    for i, room in enumerate(rooms):
        pts = ' '.join(f'{p[0]:.1f},{p[1]:.1f}' for p in room['poly'])
        fill = CLASS_FILL.get(room['cls'], '#ddd6ca')
        area = f' data-area-m2="{room["area_px"] * scale * scale / 1e6:.2f}"' if scale else ''
        name = svg_escape(room['label'] or room['cls'])
        L.append(f'<polygon points="{pts}" fill="{fill}" fill-opacity="0.55" stroke="#b9b2a6" '
                 f'stroke-width="1" data-class="{room["cls"]}" data-name="{name}"{area}/>')
    L.append('</g>')

    for gid, sel in (('walls-exterior', True), ('walls-interior', False)):
        color = '#4a4a4a' if sel else '#7d7d7d'
        L.append(f'<g id="{gid}" stroke="{color}" stroke-linecap="butt">')
        for s in segs:
            if s.exterior != sel:
                continue
            d = s.vec / (s.length + 1e-9)
            a = s.p1 - d * (s.th / 2 if s.j1 else 0)
            b = s.p2 + d * (s.th / 2 if s.j2 else 0)
            thmm = f' data-thickness-mm="{s.th * scale:.0f}"' if scale else ''
            L.append(f'<line x1="{a[0]:.1f}" y1="{a[1]:.1f}" x2="{b[0]:.1f}" y2="{b[1]:.1f}" '
                     f'stroke-width="{s.th:.1f}"{thmm}/>')
        L.append('</g>')

    L.append('<g id="windows" stroke="#2b7de9" fill="none">')
    for o in openings:
        if o.kind != 'window':
            continue
        d = (o.b - o.a); glen = np.linalg.norm(d); d = d / (glen + 1e-9)
        nvec = np.array([-d[1], d[0]]) * (o.width / 2)
        p = [o.a + nvec, o.b + nvec, o.b - nvec, o.a - nvec]
        lenmm = f' data-length-mm="{glen * scale:.0f}"' if scale else ''
        L.append(f'<polygon points="{" ".join(f"{q[0]:.1f},{q[1]:.1f}" for q in p)}" '
                 f'stroke-width="1.2"{lenmm}/>')
        m1, m2 = o.a, o.b
        L.append(f'<line x1="{m1[0]:.1f}" y1="{m1[1]:.1f}" x2="{m2[0]:.1f}" y2="{m2[1]:.1f}" stroke-width="1.2"/>')
    L.append('</g>')

    L.append('<g id="doors" stroke="#e0862e" fill="none">')
    for o in openings:
        if o.kind != 'door':
            continue
        wmm = f' data-width-mm="{np.linalg.norm(o.b - o.a) * scale:.0f}"' if scale else ''
        if o.hinge is not None:
            dpath, p0, p1 = arc_path(o)
            L.append(f'<path d="{dpath}" stroke-width="1.4" stroke-dasharray="3 2"{wmm}/>')
            L.append(f'<line x1="{o.hinge[0]:.1f}" y1="{o.hinge[1]:.1f}" x2="{p0[0]:.1f}" y2="{p0[1]:.1f}" stroke-width="2"/>')
        L.append(f'<line x1="{o.a[0]:.1f}" y1="{o.a[1]:.1f}" x2="{o.b[0]:.1f}" y2="{o.b[1]:.1f}" '
                 f'stroke-width="1" stroke-dasharray="2 2"{wmm}/>')
    L.append('</g>')

    L.append('<g id="openings" stroke="#9a8f80" fill="none">')
    for o in openings:
        if o.kind != 'opening':
            continue
        L.append(f'<line x1="{o.a[0]:.1f}" y1="{o.a[1]:.1f}" x2="{o.b[0]:.1f}" y2="{o.b[1]:.1f}" '
                 f'stroke-width="1" stroke-dasharray="4 3"/>')
    L.append('</g>')

    L.append('<g id="labels" font-family="sans-serif" font-size="13" fill="#333" text-anchor="middle">')
    for room in rooms:
        cx, cy = room['centroid']
        name = svg_escape(room['label'] or room['cls'])
        L.append(f'<text x="{cx:.0f}" y="{cy:.0f}">{name}</text>')
    L.append('</g>')
    L.append('</svg>')
    open(path, 'w').write('\n'.join(L))


def build_doc(img_path, img_shape, segs, openings, rooms, scale):
    s = scale or 1.0
    unit = 'mm' if scale else 'px'

    def pt(p):
        return [round(float(p[0]) * s, 1), round(float(p[1]) * s, 1)]

    def opening_doc(index, opening):
        value = dict(id=f'o{index}', type=opening.kind, a=pt(opening.a),
                     b=pt(opening.b), wallThickness=round(opening.width * s, 1),
                     src=opening.src)
        if opening.hinge is not None:
            value.update(hinge=pt(opening.hinge), radius=round(opening.radius * s, 1))
        if opening.barrier_a is not None and opening.barrier_b is not None:
            value.update(barrierA=pt(opening.barrier_a), barrierB=pt(opening.barrier_b))
            if opening.barrier_width is not None:
                value['barrierThickness'] = round(opening.barrier_width * s, 1)
        return value

    return dict(
        source=os.path.basename(img_path), unit=unit, docVersion=11,
        imageSize=[img_shape[1], img_shape[0]], mmPerPx=scale,
        walls=[dict(id=f'w{i}', kind='exterior' if sg.exterior else 'interior',
                    start=pt(sg.p1), end=pt(sg.p2), thickness=round(sg.th * s, 1))
               for i, sg in enumerate(segs)],
        openings=[opening_doc(i, opening) for i, opening in enumerate(openings)],
        rooms=[dict(id=f'r{i}', name=r['label'], cls=r['cls'],
                    areaM2=round(r['area_px'] * (scale or 0) ** 2 / 1e6, 2) if scale else None,
                    polygon=[pt(p) for p in r['poly']])
               for i, r in enumerate(rooms)],
    )


def write_json(path, img_path, img_shape, segs, openings, rooms, scale):
    json.dump(build_doc(img_path, img_shape, segs, openings, rooms, scale),
              open(path, 'w'), ensure_ascii=False, indent=1)


# --------------------------------------------------------------------------
# driver
# --------------------------------------------------------------------------

def analyze(img_path, ocr_dir=None, use_ocr=True):
    """Full pipeline on one image; no file output. Returns everything the
    writers and callers need."""
    img = cv2.imread(img_path)
    if img is None:
        raise SystemExit(f'cannot read {img_path}')
    # linear, not nearest: nearest doubles the 1px boundary staircase and the
    # skeleton zigzags along it, shattering Hough segments; linear resolves
    # mask boundaries at sub-source-pixel positions while a 2-source-px
    # separation still spans 4 analysis px that the 5x5 close cannot fuse
    img = cv2.resize(img, None, fx=UP, fy=UP, interpolation=cv2.INTER_LINEAR)
    masks = build_masks(img)
    skel = zhang_suen(masks['wall'])
    # Derive both thickness passes from one Hough result.  The relaxed pass
    # is evidence-only and must not get a different set of source segments.
    raw_segs = extract_segments(skel, masks['dist_wall'])
    segs = assign_thickness(
        [Seg(s.p1.copy(), s.p2.copy()) for s in raw_segs],
        masks['dist_wall'], masks['wall'])
    segs = snap_junctions(segs)
    segs = classify_exterior(segs, masks['dist_to_out'])

    scale = None
    ocr_items = []
    room_barriers = []
    semantic_gaps = []
    if use_ocr:
        # OCR runs on the ORIGINAL file (Vision quality, cache key stable);
        # its px coordinates are lifted into the upscaled analysis frame
        ocr_items = [
            {**it, 'x': it['x'] * UP, 'y': it['y'] * UP, 'w': it['w'] * UP, 'h': it['h'] * UP}
            for it in run_ocr(img_path, ocr_dir or os.path.join(TOOL_DIR, '.build', 'ocr-cache'))
        ]
        ext = [s.th for s in segs if s.exterior]
        scale = estimate_scale(ocr_items, masks['sil'],
                               float(np.median(ext)) if ext else None, masks=masks)

    # Keep the default short-thin rejection above. When source OCR is
    # available, derive a separate source-backed barrier lane for rooms. It
    # must not alter the structural wall list or semantic opening output.
    if ocr_items:
        relaxed = assign_thickness(
            [Seg(s.p1.copy(), s.p2.copy()) for s in raw_segs],
            masks['dist_wall'], masks['wall'], allow_short=True)
        room_barriers = source_room_barriers(relaxed, masks, scale=scale)
        # The relaxed pass is evidence-only. Keep the paired-door semantic
        # spans separate from the structural wall list, whose short-jamb
        # rejection remains unchanged.
        for relaxed_gap in collinear_gaps(relaxed, masks['wall']):
            split = split_fixture_gap(
                relaxed_gap[0], relaxed_gap[1], relaxed_gap[2], masks,
                scale=scale)
            if split:
                semantic_gaps.extend(split)
                continue
            # Reuse the room-barrier evidence gate for relaxed pair gaps that
            # are semantic openings. Rays stay on the stricter source lane;
            # this recovers an upper-right fixture divider while keeping
            # isolated symbols out of opening classification.
            pa, pb, width, source = relaxed_gap
            if source != 'pair':
                continue
            gap_length = float(np.linalg.norm(pb - pa))
            physical = gap_length * float(scale) / 1000.0 if scale else None
            if physical is None or not 0.4 <= physical <= 1.8:
                continue
            strip = strip_mask(masks['wall'].shape, pa, pb, width + 3.0 * UP)
            area = max(int(strip.sum()), 1)
            thin_frac = float((strip & masks['thin']).sum()) / area
            wall_frac = float((strip & masks['wall']).sum()) / area
            profile = gap_cross_profile(masks['v'], pa, pb, width)
            if (thin_frac < 0.25 or wall_frac > 0.30 or not profile
                    or max(profile) - min(profile) < 25.0
                    or not gap_separates(masks, pa, pb, width, source=source)):
                continue
            semantic_gaps.append(relaxed_gap)

    gaps = collinear_gaps(segs, masks['wall'])
    gaps = gaps + boundary_gaps(masks, segs, gaps)
    entrance_pts = [np.array([it['x'] + it['w'] / 2, it['y'] + it['h'] / 2])
                    for it in ocr_items
                    if ('ntrance' in it.get('text', '').lower()
                        or '현관' in it.get('text', ''))]
    entrance_gap = find_entrance_gap_candidate(masks, segs, entrance_pts, scale)
    if entrance_gap is not None:
        gaps.insert(0, entrance_gap)
    openings = classify_openings(
        gaps, masks, segs, scale, entrance_pts,
        semantic_gaps=semantic_gaps)
    rooms = detect_rooms(img, masks, segs, openings, scale, ocr_items=ocr_items,
                         room_barriers=room_barriers)
    room_diagnostics = label_rooms(rooms, ocr_items) if use_ocr else []

    rendered = render_walls(segs, masks['wall'].shape)
    union = float((rendered | masks['wall']).sum())
    iou = float((rendered & masks['wall']).sum()) / union if union else 0.0
    colored = float(((masks['chroma'] > 40) & (masks['v'] > 100)).mean())
    stem = os.path.splitext(os.path.basename(img_path))[0]
    metrics = dict(planId=stem, style='wood-dense' if colored > 0.25 else 'standard',
                   wallIoU=round(iou, 3), scale=round(scale, 3) if scale else None,
                   walls=len(segs), doors=sum(o.kind == 'door' for o in openings),
                   windows=sum(o.kind == 'window' for o in openings),
                   openings=sum(o.kind == 'opening' for o in openings), rooms=len(rooms))
    return dict(img=img, masks=masks, skel=skel, segs=segs, openings=openings,
                rooms=rooms, scale=scale, ocr=ocr_items,
                room_diagnostics=room_diagnostics, metrics=metrics)


def process(img_path, outdir, debug=False, use_ocr=True):
    stem = os.path.splitext(os.path.basename(img_path))[0]
    os.makedirs(outdir, exist_ok=True)
    a = analyze(img_path, ocr_dir=os.path.join(outdir, 'ocr'), use_ocr=use_ocr)
    img, masks, skel = a['img'], a['masks'], a['skel']
    segs, openings, rooms, scale = a['segs'], a['openings'], a['rooms'], a['scale']
    metrics = a['metrics']

    meta = dict(planId=stem, mmPerPx=scale,
                counts={k: metrics[k] for k in ('walls', 'doors', 'windows', 'openings', 'rooms')})
    write_svg(os.path.join(outdir, stem + '.svg'), img.shape, segs, openings, rooms, scale, meta)
    write_json(os.path.join(outdir, stem + '.json'), img_path, img.shape, segs, openings, rooms, scale)

    if debug:
        dbg = img.copy()
        overlay = dbg.copy()
        for room in rooms:
            color = tuple(int(CLASS_FILL.get(room['cls'], '#cccccc')[i:i + 2], 16) for i in (5, 3, 1))
            cv2.fillPoly(overlay, [room['poly'].astype(np.int32)], color)
        dbg = cv2.addWeighted(overlay, 0.35, dbg, 0.65, 0)
        for s in segs:
            c = (40, 40, 220) if s.exterior else (70, 190, 70)
            cv2.line(dbg, tuple(s.p1.astype(int)), tuple(s.p2.astype(int)), c, 2)
        for o in openings:
            col = dict(door=(30, 140, 240), window=(255, 60, 0), opening=(200, 0, 200))[o.kind]
            cv2.line(dbg, tuple(o.a.astype(int)), tuple(o.b.astype(int)), col, 3)
            if o.hinge is not None:
                cv2.circle(dbg, tuple(np.array(o.hinge).astype(int)), int(o.radius), col, 1)
        cv2.imwrite(os.path.join(outdir, stem + '.debug.png'), dbg)
        cv2.imwrite(os.path.join(outdir, stem + '.wallmask.png'), masks['wall'] * 255)
        cv2.imwrite(os.path.join(outdir, stem + '.skel.png'), skel * 255)
    return metrics


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('images', nargs='+')
    ap.add_argument('-o', '--out', default=os.path.join(TOOL_DIR, 'out'))
    ap.add_argument('--debug', action='store_true')
    ap.add_argument('--no-ocr', action='store_true')
    ap.add_argument('--stdout', action='store_true',
                    help='print the vector document as JSON to stdout; no file output')
    args = ap.parse_args()
    results = []
    for p in args.images:
        if args.stdout:
            a = analyze(p, use_ocr=not args.no_ocr)
            doc = build_doc(p, a['img'].shape, a['segs'], a['openings'], a['rooms'], a['scale'])
            doc['metrics'] = a['metrics']
            print(json.dumps(doc, ensure_ascii=False))
            results.append(doc)
        else:
            m = process(p, args.out, debug=args.debug, use_ocr=not args.no_ocr)
            results.append(m)
            print(json.dumps(m, ensure_ascii=False))
    return results


if __name__ == '__main__':
    main()

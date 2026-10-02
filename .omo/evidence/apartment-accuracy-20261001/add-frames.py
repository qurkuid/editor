from pathlib import Path
p=Path('.omx/recovery-20260929/data/vectorize.py');s=p.read_text();anchor='def continuous_frame_evidence(v_img, pa, pb, width):'
helper='''def source_frame_gaps(masks, scale):
    if not scale:
        return []
    value, chroma, wall = masks['v'], masks['chroma'], masks['wall']
    ridge = cv2.morphologyEx(value, cv2.MORPH_TOPHAT,
                            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13)))
    bright = ((ridge >= 12) & (value >= 235) & (chroma < 20)
              & (masks['sil'] > 0)).astype(np.uint8)
    lines = extract_segments(bright, masks['dist_wall'], threshold=20,
                             min_line_length=20 * UP, max_line_gap=4 * UP,
                             theta=np.pi / 360, merge=False)
    candidates = []
    height, width = wall.shape
    for line in sorted(lines, key=lambda line: -line.length):
        direction = line.vec / line.length
        normal = np.array([-direction[1], direction[0]])
        thickness = 8 * UP
        ends = []
        for point, sign in ((line.p1, -1), (line.p2, 1)):
            last = point.copy()
            misses = 0
            for distance in np.arange(0, 200 * UP, 1.0):
                q = point + sign * direction * distance
                pixels = q + np.arange(-1, 2)[:, None] * normal
                xs, ys = np.rint(pixels).astype(int).T
                if np.any(xs < 0) or np.any(xs >= width) or np.any(ys < 0) or np.any(ys >= height):
                    break
                profile = gap_cross_profile(value, q - direction * 3,
                                            q + direction * 3, thickness)
                supported = (np.any((value[ys, xs] >= 235) & (chroma[ys, xs] < 20))
                             and profile and max(profile) - min(profile) >= 25)
                if supported:
                    last, misses = q, 0
                else:
                    misses += 1
                    if misses > 3 * UP:
                        break
            found = None
            for distance in np.arange(0, 15 * UP, 1.0):
                q = last + sign * direction * distance
                x, y = np.rint(q).astype(int)
                if not (0 <= x < width and 0 <= y < height):
                    break
                if wall[y, x]:
                    found = q
                    break
            if found is None:
                break
            ends.append(found)
        if len(ends) != 2:
            continue
        pa, pb = ends
        length_m = float(np.linalg.norm(pb - pa)) * scale / 1000
        if not 0.35 <= length_m <= 6.0:
            continue
        if not continuous_frame_evidence(value, pa, pb, thickness):
            continue
        if any(gap_covers_same_span(pa, pb, qa, qb) for qa, qb, _, _ in candidates):
            continue
        candidates.append((pa, pb, thickness, 'pair'))
    return candidates


'''
s=s.replace(anchor,helper+anchor)
s=s.replace("    # Keep the default short-thin rejection above.","    frame_gaps = source_frame_gaps(masks, scale)\n\n    # Keep the default short-thin rejection above.")
s=s.replace("baseline_gaps = baseline_gaps + boundary_gaps(\n            masks, room_segs, baseline_gaps)","baseline_gaps = baseline_gaps + boundary_gaps(\n            masks, room_segs, baseline_gaps) + frame_gaps")
s=s.replace("gaps = gaps + boundary_gaps(masks, room_segs, gaps)","gaps = gaps + boundary_gaps(masks, room_segs, gaps) + frame_gaps")
# A relaxed owner can recover the short jamb that the ordinary wall pass drops.
anchor="    for pa, pb, width in recovered_apertures:"
helper='''    if ocr_items:
        relaxed_gaps = collinear_gaps(relaxed, masks['wall'])
        extra_openings = classify_openings(relaxed_gaps, masks, relaxed, scale, entrance_pts)
        for opening in extra_openings:
            if (continuous_frame_evidence(masks['v'], opening.a, opening.b, opening.width)
                    and not any(gap_covers_same_span(opening.a, opening.b, old.a, old.b)
                                for old in openings)):
                openings.append(opening)
'''
s=s.replace(anchor,helper+anchor)
# Prefer a fully measured glazing strip over a short ray that borrowed a nearby arc.
anchor="    room_openings = [opening for opening in openings"
helper='''    framed_openings = classify_openings(frame_gaps, masks, segs, scale, entrance_pts)
    for frame in framed_openings:
        if frame.kind != 'window':
            continue
        for opening in openings:
            if (opening.src == 'ray' and gap_covers_same_span(frame.a, frame.b, opening.a, opening.b)):
                opening.kind = 'window'
                opening.a, opening.b = frame.a.copy(), frame.b.copy()
                opening.hinge = None
                opening.radius = 0.0
'''
s=s.replace(anchor,helper+anchor)
p.write_text(s)

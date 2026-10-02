from pathlib import Path
p=Path('.omx/recovery-20260929/data/vectorize.py');s=p.read_text()
s=s.replace("'entrance': ['현관']", "'entrance': ['현관', '전실']")
anchor='def split_fixture_gap(pa, pb, wd, masks, scale=None):'
helper='''def continuous_frame_evidence(v_img, pa, pb, width):
    length = float(np.linalg.norm(pb - pa))
    if length < 8 * UP:
        return False
    direction = (pb - pa) / length
    profiles = [gap_cross_profile(v_img, pa + direction * t,
                                 pa + direction * min(t + 6 * UP, length), width)
                for t in np.arange(0, length - 4, 6 * UP)]
    return bool(profiles) and sum(bool(p) and max(p) - min(p) >= 25
                                 for p in profiles) / len(profiles) >= 0.85


'''
s=s.replace(anchor,helper+anchor)
s=s.replace("if win_ok and src != 'boundary' and not window_frame_evidence(masks['v'], pa, pb, wd):", "if win_ok and src != 'boundary' and not continuous_frame_evidence(masks['v'], pa, pb, wd):")
s=s.replace("barrier |= cv2.dilate(room_dark, np.ones((2 * UP, 2 * UP), np.uint8))", "structural_barrier = barrier.copy()\n    barrier |= cv2.dilate(room_dark, np.ones((2 * UP, 2 * UP), np.uint8))")
anchor='    protected = set()\n'
helper='''    # Text over a fixture line must not make two independently protected rooms.
    for item in ocr_items or ():
        if _known_room_label(item.get('text', '')) is None:
            continue
        x0, y0 = max(0, int(item['x'])), max(0, int(item['y']))
        x1, y1 = min(w, int(item['x'] + item['w']) + 1), min(h, int(item['y'] + item['h']) + 1)
        patch = lab[y0:y1, x0:x1]
        if not patch.size or np.mean(structural_barrier[y0:y1, x0:x1]) > 0.08:
            continue
        ids, counts = np.unique(patch[patch > 0], return_counts=True)
        if len(ids) < 2:
            continue
        owner = int(ids[np.argmax(counts)])
        for other in ids:
            other = int(other)
            if other == owner:
                continue
            lab[lab == other] = owner
            stats[owner, cv2.CC_STAT_AREA] += stats[other, cv2.CC_STAT_AREA]
            stats[other, cv2.CC_STAT_AREA] = 0
        lab[y0:y1, x0:x1][structural_barrier[y0:y1, x0:x1] == 0] = owner

'''
s=s.replace(anchor,helper+anchor,1)
s=s.replace("if i not in protected and stats[i, cv2.CC_STAT_AREA] < max(MIN_ROOM_AREA_PX, drop_px):", "if stats[i, cv2.CC_STAT_AREA] == 0 or (i not in protected and stats[i, cv2.CC_STAT_AREA] < max(MIN_ROOM_AREA_PX, drop_px)):")
anchor='def label_rooms(rooms, ocr_items):'
helper='''def room_label_items(items):
    result = []
    for item in items:
        text = str(item.get('text', '')).strip()
        hits = []
        for cls, words in ROOM_WORDS.items():
            for word in words:
                pos = text.find(word)
                if pos >= 0:
                    hits.append((pos, pos + len(word), word))
        hits = [hit for hit in hits if not any(a <= hit[0] and b >= hit[1]
                and b - a > hit[1] - hit[0] for a, b, _ in hits)]
        for start, end, word in hits:
            value = dict(item, text=word)
            if len(hits) > 1:
                value.update(x=item['x'] + item['w'] * start / len(text),
                             w=item['w'] * (end - start) / len(text))
            result.append(value)
    return result


def partition_labeled_spaces(rooms, items, shape):
    result = []
    for room in rooms:
        labels = [it for it in items if cv2.pointPolygonTest(
            room['poly'].astype(np.float32),
            (float(it['x'] + it['w'] / 2), float(it['y'] + it['h'] / 2)), True) >= -3 * UP]
        if len(labels) < 2:
            result.append(room)
            continue
        mask = np.zeros(shape[:2], np.uint8)
        cv2.fillPoly(mask, [np.rint(room['poly']).astype(np.int32)], 1)
        ys, xs = np.nonzero(mask)
        centers = np.array([[it['x'] + it['w'] / 2, it['y'] + it['h'] / 2] for it in labels])
        distances = (xs[:, None] - centers[:, 0]) ** 2 + (ys[:, None] - centers[:, 1]) ** 2
        owners = np.argmin(distances, axis=1)
        parts = []
        for i, item in enumerate(labels):
            part = np.zeros_like(mask)
            part[ys[owners == i], xs[owners == i]] = 1
            contours, _ = cv2.findContours(part, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                break
            contour = max(contours, key=cv2.contourArea)
            if cv2.contourArea(contour) < MIN_ROOM_AREA_PX:
                break
            poly = cv2.approxPolyDP(contour, 1.0 * UP, True)[:, 0, :].astype(float)
            moments = cv2.moments(part)
            parts.append(dict(room, poly=poly, cls=_known_room_label(item['text'])[0],
                              label=item['text'], area_px=float(part.sum()),
                              centroid=(moments['m10']/moments['m00'], moments['m01']/moments['m00'])))
        result.extend(parts if len(parts) == len(labels) else [room])
    return result


'''
s=s.replace(anchor,helper+anchor)
s=s.replace("ocr_items = [\n            {**it", "ocr_items = [\n            {**it")
anchor="        ext = [s.th for s in segs if s.exterior]"
s=s.replace(anchor,"        dimension_items = ocr_items\n        ocr_items = room_label_items(ocr_items) + [it for it in ocr_items if not _known_room_matches(it.get('text', ''))]\n"+anchor)
s=s.replace("scale = estimate_scale(ocr_items, masks['sil'],", "scale = estimate_scale(dimension_items, masks['sil'],")
s=s.replace("room_diagnostics = label_rooms(rooms, ocr_items) if use_ocr else []", "rooms = partition_labeled_spaces(rooms, room_label_items(ocr_items), img.shape) if use_ocr else rooms\n    room_diagnostics = label_rooms(rooms, ocr_items) if use_ocr else []")
s=s.replace('docVersion=12','docVersion=13')
p.write_text(s)

import json
import math
import random
from collections import Counter
from pathlib import Path


OUT = Path(__file__).resolve().parent
CATALOG = OUT.parent / 'catalog.json'
RESULT = OUT / 'nesting.json'
SHEET_W = 600.0
SHEET_H = 2400.0
BORDER = 10.0
KERF = 4.0
USABLE_W = SHEET_W - BORDER * 2
USABLE_H = SHEET_H - BORDER * 2
EPSILON = 1e-6


def clean_number(value):
    return int(round(value)) if abs(value - round(value)) <= EPSILON else round(value, 6)


def rectangle(rect):
    return {key: clean_number(value) for key, value in zip(('x_mm', 'y_mm', 'w_mm', 'h_mm'), rect)}


def load_parts():
    products = json.loads(CATALOG.read_text(encoding='utf-8'))['products']
    parts = []
    for product_index, product in enumerate(products, 1):
        for part_index, part in enumerate(product['parts'], 1):
            xs = [point[0] for point in part['outer_mm']]
            ys = [point[1] for point in part['outer_mm']]
            width = float(max(xs) - min(xs))
            height = float(max(ys) - min(ys))
            assert width > 0 and height > 0
            parts.append({
                'id': f'P{product_index:02d}-{part_index:02d}',
                'product_index': product_index,
                'part_index': part_index,
                'product_id': product['id'],
                'source_part_name': part['name'],
                'thickness_mm': clean_number(float(part['thickness_mm'])),
                'original_w_mm': width,
                'original_h_mm': height,
                'blank_area_mm2': width * height,
            })
    assert len(parts) == 89
    assert Counter(part['thickness_mm'] for part in parts) == Counter({15: 80, 12: 9})
    return parts


def edge_trim(direction, rect, side, removal_width, child, node_type='edge_trim'):
    x, y, width, height = rect
    if side == 'left':
        removed = (x, y, removal_width, height)
        position = x + removal_width
    elif side == 'right':
        removed = (x + width - removal_width, y, removal_width, height)
        position = x + width - removal_width
    elif side == 'bottom':
        removed = (x, y, width, removal_width)
        position = y + removal_width
    else:
        removed = (x, y + height - removal_width, width, removal_width)
        position = y + height - removal_width
    return {
        'type': node_type,
        'direction': direction,
        'trim_side': side,
        'rect_mm': rectangle(rect),
        'cut_position_mm': clean_number(position),
        'kerf_mm': clean_number(KERF),
        'removal_width_mm': clean_number(removal_width),
        'kerf_side': 'removed',
        'kerf_overhang_mm': clean_number(max(0.0, KERF - removal_width)),
        'removed_rect_mm': rectangle(removed),
        'child': child,
    }


def split_leaf(node, part_node, split, rect, placed_w, placed_h):
    x, y, width, height = rect
    right_gap = width - placed_w
    top_gap = height - placed_h
    right_width = width - placed_w - KERF
    top_height = height - placed_h - KERF
    right = {'type': 'free', 'rect_mm': rectangle((x + placed_w + KERF, y, right_width, height))}
    top = {'type': 'free', 'rect_mm': rectangle((x, y + placed_h + KERF, width, top_height))}
    new_leaves = []

    def cut(direction, cut_rect, position, first, second):
        return {
            'type': 'cut',
            'direction': direction,
            'rect_mm': rectangle(cut_rect),
            'cut_position_mm': clean_number(position),
            'kerf_mm': clean_number(KERF),
            'children': [first, second],
        }

    if split == 'vertical_first':
        left = part_node
        if top_height > EPSILON:
            top = {'type': 'free', 'rect_mm': rectangle((x, y + placed_h + KERF, placed_w, top_height))}
            left = cut('horizontal', (x, y, placed_w, height), y + placed_h, part_node, top)
            new_leaves.append((top, (x, y + placed_h + KERF, placed_w, top_height)))
        elif top_gap > EPSILON:
            left = edge_trim(
                'horizontal', (x, y, placed_w, height), 'top', top_gap, part_node
            )
        if right_width > EPSILON:
            replacement = cut('vertical', rect, x + placed_w, left, right)
            new_leaves.append((right, (x + placed_w + KERF, y, right_width, height)))
        elif right_gap > EPSILON:
            replacement = edge_trim('vertical', rect, 'right', right_gap, left)
        else:
            replacement = left
    else:
        bottom = part_node
        if right_width > EPSILON:
            right = {'type': 'free', 'rect_mm': rectangle((x + placed_w + KERF, y, right_width, placed_h))}
            bottom = cut('vertical', (x, y, width, placed_h), x + placed_w, part_node, right)
            new_leaves.append((right, (x + placed_w + KERF, y, right_width, placed_h)))
        elif right_gap > EPSILON:
            bottom = edge_trim(
                'vertical', (x, y, width, placed_h), 'right', right_gap, part_node
            )
        if top_height > EPSILON:
            replacement = cut('horizontal', rect, y + placed_h, bottom, top)
            new_leaves.append((top, (x, y + placed_h + KERF, width, top_height)))
        elif top_gap > EPSILON:
            replacement = edge_trim('horizontal', rect, 'top', top_gap, bottom)
        else:
            replacement = bottom
    node.clear()
    node.update(replacement)
    return new_leaves


def add_sheet_border_trims(usable_tree):
    top = edge_trim(
        'horizontal', (BORDER, BORDER, USABLE_W, SHEET_H - BORDER),
        'top', BORDER, usable_tree, 'border_trim'
    )
    bottom = edge_trim(
        'horizontal', (BORDER, 0, USABLE_W, SHEET_H),
        'bottom', BORDER, top, 'border_trim'
    )
    right = edge_trim(
        'vertical', (BORDER, 0, SHEET_W - BORDER, SHEET_H),
        'right', BORDER, bottom, 'border_trim'
    )
    return edge_trim(
        'vertical', (0, 0, SHEET_W, SHEET_H),
        'left', BORDER, right, 'border_trim'
    )


def pack_attempt(parts, board_count, seed, mode):
    rng = random.Random(seed)
    ordered = sorted(
        parts,
        key=lambda part: (
            -(max(part['original_w_mm'], part['original_h_mm']) * (1 + rng.random() * 0.12)),
            -part['blank_area_mm2'],
        ),
    )
    roots = [
        {'type': 'free', 'rect_mm': rectangle((BORDER, BORDER, USABLE_W, USABLE_H))}
        for _ in range(board_count)
    ]
    leaves = [[(root, (BORDER, BORDER, USABLE_W, USABLE_H))] for root in roots]
    placements = [[] for _ in roots]
    for part in ordered:
        candidates = []
        orientations = (
            (0, part['original_w_mm'], part['original_h_mm']),
            (90, part['original_h_mm'], part['original_w_mm']),
        )
        for board_index, board_leaves in enumerate(leaves):
            for leaf_index, (_, (x, y, width, height)) in enumerate(board_leaves):
                for rotation, placed_w, placed_h in orientations:
                    if placed_w > width + EPSILON or placed_h > height + EPSILON:
                        continue
                    right_width = max(0.0, width - placed_w - KERF)
                    top_height = max(0.0, height - placed_h - KERF)
                    for split in ('vertical_first', 'horizontal_first'):
                        if split == 'vertical_first':
                            remaining = ((right_width, height), (placed_w, top_height))
                        else:
                            remaining = ((width, top_height), (right_width, placed_h))
                        remaining = [(w, h) for w, h in remaining if w > EPSILON and h > EPSILON]
                        waste = width * height - placed_w * placed_h
                        short_side = min(width - placed_w, height - placed_h)
                        long_side = max(width - placed_w, height - placed_h)
                        max_free_area = max((w * h for w, h in remaining), default=0)
                        if mode == 0:
                            score = (waste, short_side, long_side, board_index)
                        elif mode == 1:
                            score = (short_side, long_side, waste, board_index)
                        elif mode == 2:
                            score = (-max_free_area, waste, short_side, board_index)
                        elif mode == 3:
                            score = (abs((width - placed_w) - (height - placed_h)), waste, short_side, board_index)
                        elif mode == 4:
                            score = (board_index, waste, short_side, long_side)
                        else:
                            score = (waste + rng.random() * USABLE_W * USABLE_H * 0.08, short_side, board_index)
                        candidates.append((
                            score,
                            rng.random(),
                            board_index,
                            leaf_index,
                            rotation,
                            split,
                            placed_w,
                            placed_h,
                            x,
                            y,
                        ))
        if not candidates:
            return None
        _, _, board_index, leaf_index, rotation, split, placed_w, placed_h, x, y = min(
            candidates, key=lambda candidate: (candidate[0], candidate[1])
        )
        leaf_node, leaf_rect = leaves[board_index].pop(leaf_index)
        placement = {
            'id': part['id'],
            'product_index': part['product_index'],
            'part_index': part['part_index'],
            'x_mm': clean_number(x),
            'y_mm': clean_number(y),
            'w_mm': clean_number(placed_w),
            'h_mm': clean_number(placed_h),
            'rotation_deg': rotation,
            'source_part_name': part['source_part_name'],
            'original_blank_mm': [clean_number(part['original_w_mm']), clean_number(part['original_h_mm'])],
        }
        part_node = {'type': 'part', 'part_id': part['id'], 'rect_mm': rectangle((x, y, placed_w, placed_h))}
        leaves[board_index].extend(split_leaf(leaf_node, part_node, split, leaf_rect, placed_w, placed_h))
        placements[board_index].append(placement)
    return [add_sheet_border_trims(root) for root in roots], placements


def find_optimal_guillotine_layout(parts):
    total_area = sum(part['blank_area_mm2'] for part in parts)
    lower_bound = math.ceil(total_area / (USABLE_W * USABLE_H))
    assert all(min(part['original_w_mm'], part['original_h_mm']) <= USABLE_W for part in parts)
    for board_count in range(lower_bound, lower_bound + 3):
        for seed in range(50_000):
            result = pack_attempt(parts, board_count, seed, seed % 6)
            if result:
                roots, placements = result
                return {
                    'roots': roots,
                    'placements': placements,
                    'board_count': board_count,
                    'area_lower_bound': lower_bound,
                    'seed': seed,
                    'heuristic_mode': seed % 6,
                    'optimal_by_area_lower_bound': board_count == lower_bound,
                    'blank_area_mm2': total_area,
                }
    raise RuntimeError('no guillotine layout found within lower bound + 2 sheets')


def cut_sequence(tree):
    cuts = []

    def visit(node):
        if node['type'] not in {'cut', 'edge_trim', 'border_trim'}:
            return
        rect = node['rect_mm']
        entry = {
            'order': len(cuts) + 1,
            'type': node['type'],
            'direction': node['direction'],
            'cut_position_mm': node['cut_position_mm'],
            'kerf_mm': node['kerf_mm'],
            'parent_rect_mm': rect,
            'span_start_mm': rect['y_mm'] if node['direction'] == 'vertical' else rect['x_mm'],
            'span_end_mm': clean_number(
                (rect['y_mm'] + rect['h_mm']) if node['direction'] == 'vertical'
                else (rect['x_mm'] + rect['w_mm'])
            ),
        }
        if node['type'] == 'cut':
            entry['remaining_rects_mm'] = [child['rect_mm'] for child in node['children']]
            cuts.append(entry)
            visit(node['children'][0])
            visit(node['children'][1])
        else:
            entry.update({
                'trim_side': node['trim_side'],
                'removal_width_mm': node['removal_width_mm'],
                'removed_rect_mm': node['removed_rect_mm'],
                'remaining_rect_mm': node['child']['rect_mm'],
                'kerf_side': node['kerf_side'],
                'kerf_overhang_mm': node['kerf_overhang_mm'],
            })
            cuts.append(entry)
            visit(node['child'])

    visit(tree)
    return cuts


def validate_cut_tree(tree, placements):
    errors = []
    tree_part_ids = []
    cut_count = 0
    placement_rects = {
        part['id']: (
            float(part['x_mm']), float(part['y_mm']),
            float(part['w_mm']), float(part['h_mm']),
        )
        for part in placements
    }

    def values(node):
        rect = node['rect_mm']
        return tuple(float(rect[key]) for key in ('x_mm', 'y_mm', 'w_mm', 'h_mm'))

    def same_rect(actual, expected):
        return all(abs(first - second) <= EPSILON for first, second in zip(actual, expected))

    def visit(node, parent_rect=None):
        nonlocal cut_count
        x, y, width, height = values(node)
        if width <= 0 or height <= 0:
            errors.append(f"non-positive rectangle: {node.get('part_id', node['type'])}")
        if parent_rect:
            px, py, pwidth, pheight = parent_rect
            if not (
                x >= px - EPSILON and y >= py - EPSILON
                and x + width <= px + pwidth + EPSILON
                and y + height <= py + pheight + EPSILON
            ):
                errors.append(f"child outside parent: {node.get('part_id', node['type'])}")
        if node['type'] == 'part':
            tree_part_ids.append(node['part_id'])
            if node['part_id'] not in placement_rects or not same_rect((x, y, width, height), placement_rects[node['part_id']]):
                errors.append(f"part leaf differs from placement: {node['part_id']}")
            return
        if node['type'] == 'free':
            return
        cut_count += 1
        position = float(node['cut_position_mm'])
        kerf = float(node['kerf_mm'])
        if abs(kerf - KERF) > EPSILON:
            errors.append(f'invalid kerf width: {kerf}')
        if node['type'] == 'cut' and len(node.get('children', [])) == 2:
            first, second = node['children']
            if node['direction'] == 'vertical':
                expected_first = (x, y, position - x, height)
                expected_second = (position + kerf, y, x + width - position - kerf, height)
            elif node['direction'] == 'horizontal':
                expected_first = (x, y, width, position - y)
                expected_second = (x, position + kerf, width, y + height - position - kerf)
            else:
                errors.append(f"invalid cut direction: {node.get('direction')}")
                return
            if not same_rect(values(first), expected_first) or not same_rect(values(second), expected_second):
                errors.append(f"incomplete cut partition at {position}")
            visit(first, (x, y, width, height))
            visit(second, (x, y, width, height))
            return
        if node['type'] not in {'edge_trim', 'border_trim'} or 'child' not in node:
            errors.append('invalid cut node')
            return
        removal = float(node['removal_width_mm'])
        side = node['trim_side']
        if side == 'left':
            expected_removed = (x, y, removal, height)
            expected_child = (x + removal, y, width - removal, height)
            expected_position = x + removal
        elif side == 'right':
            expected_removed = (x + width - removal, y, removal, height)
            expected_child = (x, y, width - removal, height)
            expected_position = x + width - removal
        elif side == 'bottom':
            expected_removed = (x, y, width, removal)
            expected_child = (x, y + removal, width, height - removal)
            expected_position = y + removal
        elif side == 'top':
            expected_removed = (x, y + height - removal, width, removal)
            expected_child = (x, y, width, height - removal)
            expected_position = y + height - removal
        else:
            errors.append(f'invalid trim side: {side}')
            return
        if not same_rect(values({'rect_mm': node['removed_rect_mm']}), expected_removed):
            errors.append(f'invalid removed trim rectangle: {side}')
        if not same_rect(values(node['child']), expected_child):
            errors.append(f'incomplete trim partition: {side}')
        if abs(position - expected_position) > EPSILON:
            errors.append(f'invalid trim cut position: {side}')
        if abs(float(node['kerf_overhang_mm']) - max(0.0, KERF - removal)) > EPSILON:
            errors.append(f'invalid kerf overhang: {side}')
        if node['type'] == 'edge_trim' and not (0 < removal <= KERF + EPSILON):
            errors.append(f'invalid edge trim width: {removal}')
        if node['type'] == 'border_trim' and abs(removal - BORDER) > EPSILON:
            errors.append(f'invalid border trim width: {removal}')
        visit(node['child'], (x, y, width, height))

    root_rect = values(tree)
    if any(abs(actual - expected) > EPSILON for actual, expected in zip(
        root_rect, (0, 0, SHEET_W, SHEET_H)
    )):
        errors.append('root is not the full sheet rectangle')
    visit(tree)
    if Counter(tree_part_ids) != Counter(placement_rects.keys()):
        errors.append('cut-tree part leaves do not match sheet placements')
    return errors, cut_count


def validate(parts, sheets):
    expected = {part['id']: part for part in parts}
    seen = []
    out_of_bounds = []
    clearance_violations = []
    thickness_mismatches = []
    rotation_mismatches = []
    guillotine_tree_errors = []
    for sheet in sheets:
        placed = sheet['parts']
        tree_errors, cut_count = validate_cut_tree(sheet['cut_pattern'], placed)
        guillotine_tree_errors.extend(f"{sheet['id']}: {error}" for error in tree_errors)
        if cut_count != len(sheet['cut_sequence']):
            guillotine_tree_errors.append(f"{sheet['id']}: cut sequence count mismatch")
        border_prefix = [(cut['type'], cut.get('trim_side')) for cut in sheet['cut_sequence'][:4]]
        if border_prefix != [
            ('border_trim', 'left'),
            ('border_trim', 'right'),
            ('border_trim', 'bottom'),
            ('border_trim', 'top'),
        ]:
            guillotine_tree_errors.append(f"{sheet['id']}: invalid initial border trim sequence")
        for part in placed:
            seen.append(part['id'])
            source = expected[part['id']]
            if source['thickness_mm'] != sheet['thickness_mm']:
                thickness_mismatches.append(part['id'])
            expected_size = (
                (source['original_w_mm'], source['original_h_mm'])
                if part['rotation_deg'] == 0
                else (source['original_h_mm'], source['original_w_mm'])
            )
            if abs(part['w_mm'] - expected_size[0]) > EPSILON or abs(part['h_mm'] - expected_size[1]) > EPSILON:
                rotation_mismatches.append(part['id'])
            if not (
                part['x_mm'] >= BORDER - EPSILON
                and part['y_mm'] >= BORDER - EPSILON
                and part['x_mm'] + part['w_mm'] <= SHEET_W - BORDER + EPSILON
                and part['y_mm'] + part['h_mm'] <= SHEET_H - BORDER + EPSILON
            ):
                out_of_bounds.append(part['id'])
        for index, first in enumerate(placed):
            for second in placed[index + 1:]:
                separated = (
                    first['x_mm'] + first['w_mm'] + KERF <= second['x_mm'] + EPSILON
                    or second['x_mm'] + second['w_mm'] + KERF <= first['x_mm'] + EPSILON
                    or first['y_mm'] + first['h_mm'] + KERF <= second['y_mm'] + EPSILON
                    or second['y_mm'] + second['h_mm'] + KERF <= first['y_mm'] + EPSILON
                )
                if not separated:
                    clearance_violations.append([first['id'], second['id']])
    counts = Counter(seen)
    missing = sorted(set(expected) - set(seen))
    duplicates = sorted(part_id for part_id, count in counts.items() if count != 1)
    actual_thickness_counts = Counter()
    for sheet in sheets:
        actual_thickness_counts[sheet['thickness_mm']] += len(sheet['parts'])
    expected_thickness_counts = Counter(part['thickness_mm'] for part in parts)
    passed = not any((
        missing,
        duplicates,
        out_of_bounds,
        clearance_violations,
        thickness_mismatches,
        rotation_mismatches,
        guillotine_tree_errors,
    ))
    passed = passed and actual_thickness_counts == expected_thickness_counts and len(seen) == len(parts)
    return {
        'passed': passed,
        'input_part_count': len(parts),
        'placed_part_count': len(seen),
        'expected_thickness_part_counts': {str(key): value for key, value in sorted(expected_thickness_counts.items())},
        'placed_thickness_part_counts': {str(key): value for key, value in sorted(actual_thickness_counts.items())},
        'missing_part_ids': missing,
        'duplicate_part_ids': duplicates,
        'out_of_bounds_count': len(out_of_bounds),
        'out_of_bounds_part_ids': out_of_bounds,
        'collision_count': len(clearance_violations),
        'kerf_clearance_violation_count': len(clearance_violations),
        'kerf_clearance_violations': clearance_violations,
        'thickness_mismatch_part_ids': thickness_mismatches,
        'rotation_size_mismatch_part_ids': rotation_mismatches,
        'guillotine_cut_trees_valid': not guillotine_tree_errors,
        'guillotine_cut_tree_errors': guillotine_tree_errors,
    }


def main():
    parts = load_parts()
    layouts = {
        thickness: find_optimal_guillotine_layout([part for part in parts if part['thickness_mm'] == thickness])
        for thickness in sorted({part['thickness_mm'] for part in parts}, reverse=True)
    }
    sheets = []
    for thickness, layout in layouts.items():
        for board_index, (tree, placements) in enumerate(zip(layout['roots'], layout['placements']), 1):
            sheets.append({
                'id': f'{thickness}T-{board_index:02d}',
                'thickness_mm': thickness,
                'parts': sorted(placements, key=lambda part: part['id']),
                'part_count': len(placements),
                'blank_area_mm2': clean_number(sum(
                    expected['blank_area_mm2']
                    for placement in placements
                    for expected in parts
                    if expected['id'] == placement['id']
                )),
                'usable_area_utilization': round(
                    sum(placement['w_mm'] * placement['h_mm'] for placement in placements)
                    / (USABLE_W * USABLE_H), 6
                ),
                'cut_pattern': tree,
                'cut_sequence': cut_sequence(tree),
            })
    validation = validate(parts, sheets)
    assert validation['passed'], validation
    total_lower_bound = sum(layout['area_lower_bound'] for layout in layouts.values())
    total_sheets = len(sheets)
    result = {
        'schema_version': 1,
        'status': 'nesting_verified_cutting_hold',
        'cutting_release': {
            'status': 'hold',
            'reason': '실제 재단 원도는 추정 결합부와 나뭇결 방향 확정 후 승인 필요',
        },
        'sheet_spec': {
            'width_mm': clean_number(SHEET_W),
            'height_mm': clean_number(SHEET_H),
            'border_mm': clean_number(BORDER),
            'kerf_mm': clean_number(KERF),
            'usable_width_mm': clean_number(USABLE_W),
            'usable_height_mm': clean_number(USABLE_H),
            'rotation_allowed_deg': [0, 90],
            'grain_constraint': 'unspecified',
            'rotation_90_rule': '(-v,u) then normalize minimum x/y to zero',
        },
        'optimization': {
            'method': 'recursive guillotine best-fit with deterministic seeded search',
            'blank_basis': 'outer polygon axis-aligned rectangular blank; complex polygons require later machining',
            'thickness_mixing': False,
            'one_unit_per_product': True,
            'total_sheet_count': total_sheets,
            'area_lower_bound_sheet_count': total_lower_bound,
            'minimum_proven': total_sheets == total_lower_bound,
            'by_thickness': {
                str(thickness): {
                    'part_count': sum(1 for part in parts if part['thickness_mm'] == thickness),
                    'blank_area_mm2': clean_number(layout['blank_area_mm2']),
                    'area_lower_bound_sheets': layout['area_lower_bound'],
                    'achieved_sheets': layout['board_count'],
                    'minimum_proven': layout['optimal_by_area_lower_bound'],
                    'search_seed': layout['seed'],
                    'heuristic_mode': layout['heuristic_mode'],
                }
                for thickness, layout in layouts.items()
            },
        },
        'sheets': sheets,
        'validation': validation,
    }
    RESULT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({
        'file': str(RESULT),
        'sheets': total_sheets,
        'by_thickness': {str(key): value['board_count'] for key, value in layouts.items()},
        'minimum_proven': result['optimization']['minimum_proven'],
        'validation': validation,
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

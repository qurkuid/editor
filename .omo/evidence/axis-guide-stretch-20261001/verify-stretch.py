import json, math, sys

def nodes(path):
    value = json.load(open(path))
    return value.get('graph', value)['nodes']

before, after = nodes(sys.argv[1]), nodes(sys.argv[2])
guide_id, side, distance = sys.argv[3], int(sys.argv[4]), float(sys.argv[5])
guide = before[guide_id]
axis = 0 if abs(guide['direction'][0]) < 1e-7 else 1
cut, delta = guide['origin'][axis], side * distance
level = guide['parentId']

def shifted(point):
    result = list(point)
    if side * (result[axis] - cut) > 1e-6:
        result[axis] += delta
    return result

def exact_point(actual, expected):
    assert math.dist(actual, expected) < 1e-7, (actual, expected)

assert set(before) == set(after), 'Node identities changed'
assert after[guide_id] == guide, 'Guide moved'
counts = dict(fixed=0, translated=0, stretched=0, openings=0, manualZones=0)
for key, node in before.items():
    other = after[key]
    if node['type'] == 'wall' and node['parentId'] == level:
        exact_point(other['start'], shifted(node['start']))
        exact_point(other['end'], shifted(node['end']))
        moving = [side * (node[end][axis] - cut) > 1e-6 for end in ['start', 'end']]
        kind = 'translated' if all(moving) else 'stretched' if any(moving) else 'fixed'
        counts[kind] += 1
        if kind != 'stretched':
            assert abs(math.dist(node['start'], node['end']) - math.dist(other['start'], other['end'])) < 1e-7
        for field in ['thickness', 'height', 'curveOffset', 'parentId', 'children', 'metadata']:
            assert node.get(field) == other.get(field), (key, field)
    elif node['type'] in ['door', 'window']:
        def center(opening, source):
            wall = source[opening['wallId']]
            t = opening['position'][0] / math.dist(wall['start'], wall['end'])
            return [wall['start'][i] + t * (wall['end'][i] - wall['start'][i]) for i in range(2)]
        old_center = center(node, before)
        host = before[node['wallId']]
        expected = shifted(old_center) if host['parentId'] == level else old_center
        exact_point(center(other, after), expected)
        for field in ['width', 'height', 'side', 'rotation', 'hingesSide', 'swingDirection', 'parentId', 'wallId', 'metadata']:
            assert node.get(field) == other.get(field), (key, field)
        assert other['id'] in after[other['wallId']]['children']
        counts['openings'] += 1
    elif node['type'] == 'zone' and not node.get('autoFromWalls') and node['parentId'] == level:
        assert len(node['polygon']) == len(other['polygon'])
        for old, new in zip(node['polygon'], other['polygon']):
            exact_point(new, shifted(old))
        assert node['metadata'] == other['metadata']
        counts['manualZones'] += 1
    elif node['parentId'] != level and node['type'] not in ['door', 'window']:
        assert node == other, key
print(json.dumps({'axis': axis, 'cut': cut, 'delta': delta, **counts}, ensure_ascii=False))

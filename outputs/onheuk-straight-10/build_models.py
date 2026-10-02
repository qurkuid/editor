import ctypes as C
import json
import math
import re
import unicodedata
from pathlib import Path


OUT = Path(__file__).resolve().parent
CATALOG = OUT / 'catalog.json'
API = C.CDLL('/Applications/SketchUp 2026/SketchUp.app/Contents/Frameworks/SketchUpAPI.framework/SketchUpAPI')
MM_PER_INCH = 25.4
TOLERANCE_MM = 1e-5


class Ref(C.Structure):
    _fields_ = [('ptr', C.c_void_p)]


class Point(C.Structure):
    _fields_ = [('x', C.c_double), ('y', C.c_double), ('z', C.c_double)]


class Color(C.Structure):
    _fields_ = [('r', C.c_ubyte), ('g', C.c_ubyte), ('b', C.c_ubyte), ('a', C.c_ubyte)]


class Transformation(C.Structure):
    _fields_ = [('values', C.c_double * 16)]


R, P, N = Ref, C.POINTER, C.c_size_t
SIGNATURES = {
    'SUModelCreate': [P(R)],
    'SUModelRelease': [P(R)],
    'SUModelGetEntities': [R, P(R)],
    'SUModelSaveToFile': [R, C.c_char_p],
    'SUModelCreateFromFile': [P(R), C.c_char_p],
    'SUModelSetName': [R, C.c_char_p],
    'SUModelSetDescription': [R, C.c_char_p],
    'SUGroupCreate': [P(R)],
    'SUGroupGetEntities': [R, P(R)],
    'SUGroupSetName': [R, C.c_char_p],
    'SUGroupSetTransform': [R, P(Transformation)],
    'SUEntitiesAddGroup': [R, R],
    'SULoopInputCreate': [P(R)],
    'SULoopInputAddVertexIndex': [R, N],
    'SUGeometryInputCreate': [P(R)],
    'SUGeometryInputRelease': [P(R)],
    'SUGeometryInputSetVertices': [R, N, P(Point)],
    'SUGeometryInputAddFace': [R, P(R), P(N)],
    'SUGeometryInputFaceAddInnerLoop': [R, N, P(R)],
    'SUEntitiesFill': [R, R, C.c_bool],
    'SUEntitiesGetNumFaces': [R, P(N)],
    'SUEntitiesGetNumGroups': [R, P(N)],
    'SUEntitiesGetGroups': [R, N, P(R), P(N)],
    'SUEntitiesGetFaces': [R, N, P(R), P(N)],
    'SUMaterialCreate': [P(R)],
    'SUMaterialSetName': [R, C.c_char_p],
    'SUMaterialSetColor': [R, P(Color)],
    'SUModelAddMaterials': [R, N, P(R)],
    'SUFaceSetFrontMaterial': [R, R],
    'SUFaceSetBackMaterial': [R, R],
    'SUCameraCreate': [P(R)],
    'SUCameraSetOrientation': [R, P(Point), P(Point), P(Point)],
    'SUCameraSetPerspective': [R, C.c_bool],
    'SUCameraSetOrthographicFrustumHeight': [R, C.c_double],
    'SUModelSetCamera': [R, P(R)],
}
for function_name, argument_types in SIGNATURES.items():
    function = getattr(API, function_name)
    function.argtypes = argument_types
    function.restype = C.c_int


def call(name, *args):
    result = getattr(API, name)(*args)
    if result != 0:
        raise RuntimeError(f'{name}: SUResult={result}')


def create(name):
    ref = R()
    call(name, C.byref(ref))
    return ref


def loop(indices):
    ref = create('SULoopInputCreate')
    for index in indices:
        call('SULoopInputAddVertexIndex', ref, index)
    return ref


def slug(value):
    ascii_name = unicodedata.normalize('NFKD', value).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '-', ascii_name.lower()).strip('-')


def cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def on_segment(a, b, p):
    return (
        abs(cross(a, b, p)) <= TOLERANCE_MM
        and min(a[0], b[0]) - TOLERANCE_MM <= p[0] <= max(a[0], b[0]) + TOLERANCE_MM
        and min(a[1], b[1]) - TOLERANCE_MM <= p[1] <= max(a[1], b[1]) + TOLERANCE_MM
    )


def segments_intersect(a, b, c, d):
    turns = (cross(a, b, c), cross(a, b, d), cross(c, d, a), cross(c, d, b))
    if (turns[0] > TOLERANCE_MM and turns[1] < -TOLERANCE_MM or
            turns[0] < -TOLERANCE_MM and turns[1] > TOLERANCE_MM) and (
            turns[2] > TOLERANCE_MM and turns[3] < -TOLERANCE_MM or
            turns[2] < -TOLERANCE_MM and turns[3] > TOLERANCE_MM):
        return True
    return any((
        abs(turns[0]) <= TOLERANCE_MM and on_segment(a, b, c),
        abs(turns[1]) <= TOLERANCE_MM and on_segment(a, b, d),
        abs(turns[2]) <= TOLERANCE_MM and on_segment(c, d, a),
        abs(turns[3]) <= TOLERANCE_MM and on_segment(c, d, b),
    ))


def validate_ring(ring, label):
    assert len(ring) >= 3, f'{label}: polygon needs at least three vertices'
    points = [tuple(float(value) for value in point) for point in ring]
    assert all(len(point) == 2 and all(math.isfinite(value) for value in point) for point in points), label
    edges = list(zip(points, points[1:] + points[:1]))
    assert all(math.dist(start, end) > TOLERANCE_MM for start, end in edges), f'{label}: zero-length edge'
    area_twice = sum(start[0] * end[1] - end[0] * start[1] for start, end in edges)
    assert abs(area_twice) > TOLERANCE_MM, f'{label}: zero-area polygon'
    for first_index, (a, b) in enumerate(edges):
        for second_index, (c, d) in enumerate(edges[first_index + 1:], first_index + 1):
            adjacent = second_index == first_index + 1 or (first_index == 0 and second_index == len(edges) - 1)
            assert adjacent or not segments_intersect(a, b, c, d), f'{label}: self-intersection'
    return points


def validate_catalog(data):
    products = data['products']
    assert len(products) == 10, f'expected 10 products, got {len(products)}'
    assert len({product['id'] for product in products}) == 10, 'product ids must be unique'
    for product in products:
        size = product['size_mm']
        assert len(size) == 3 and all(math.isfinite(value) and value > 0 for value in size), product['id']
        assert product['thickness_mm'] > 0, product['id']
        assert product['parts'], f"{product['id']}: no parts"
        for part in product['parts']:
            label = f"{product['id']}/{part['name']}"
            assert part['plane'] in {'xy', 'xz', 'yz'}, label
            assert len(part['origin_mm']) == 3 and all(math.isfinite(value) for value in part['origin_mm']), label
            assert math.isfinite(part['thickness_mm']) and part['thickness_mm'] > 0, label
            part['outer_mm'] = validate_ring(part['outer_mm'], f'{label}/outer')
            part['holes_mm'] = [validate_ring(hole, f'{label}/hole') for hole in part.get('holes_mm', [])]
    return products


def add_group(parent_entities, name):
    group = create('SUGroupCreate')
    call('SUEntitiesAddGroup', parent_entities, group)
    call('SUGroupSetName', group, name.encode())
    entities = R()
    call('SUGroupGetEntities', group, C.byref(entities))
    return group, entities


def translation(x, y, z=0):
    return Transformation((C.c_double * 16)(
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        x / MM_PER_INCH, y / MM_PER_INCH, z / MM_PER_INCH, 1,
    ))


def part_vertices(part):
    origin = part['origin_mm']
    thickness = float(part['thickness_mm'])
    if part['plane'] == 'xy':
        mapper = lambda u, v: (origin[0] + u, origin[1] + v, origin[2])
        vector = (0, 0, thickness)
    elif part['plane'] == 'xz':
        mapper = lambda u, v: (origin[0] + u, origin[1], origin[2] + v)
        vector = (0, thickness, 0)
    else:
        mapper = lambda u, v: (origin[0], origin[1] + u, origin[2] + v)
        vector = (thickness, 0, 0)
    rings = [part['outer_mm'], *part['holes_mm']]
    vertices = [mapper(*point) for ring in rings for point in ring]
    return rings, vertices + [tuple(point[index] + vector[index] for index in range(3)) for point in vertices], vector


def extrude(parent_entities, part, black):
    _, entities = add_group(parent_entities, part['name'])
    rings, vertices, vector = part_vertices(part)
    ring_indices = []
    cursor = 0
    for ring in rings:
        ring_indices.append(list(range(cursor, cursor + len(ring))))
        cursor += len(ring)
    base_count = cursor
    a, b, c = vertices[:3]
    first = tuple(b[index] - a[index] for index in range(3))
    second = tuple(c[index] - b[index] for index in range(3))
    normal = (
        first[1] * second[2] - first[2] * second[1],
        first[2] * second[0] - first[0] * second[2],
        first[0] * second[1] - first[1] * second[0],
    )
    forward = sum(normal[index] * vector[index] for index in range(3)) > 0
    geometry = create('SUGeometryInputCreate')
    points = (Point * len(vertices))(*(Point(*(value / MM_PER_INCH for value in vertex)) for vertex in vertices))
    call('SUGeometryInputSetVertices', geometry, len(points), points)
    for offset, reverse in ((0, forward), (base_count, not forward)):
        cap_loops = [[index + offset for index in indices][::(-1 if reverse else 1)] for indices in ring_indices]
        face_index = N()
        outer_loop = loop(cap_loops[0])
        call('SUGeometryInputAddFace', geometry, C.byref(outer_loop), C.byref(face_index))
        for indices in cap_loops[1:]:
            inner_loop = loop(indices)
            call('SUGeometryInputFaceAddInnerLoop', geometry, face_index, C.byref(inner_loop))
    for indices in ring_indices:
        for start, end in zip(indices, indices[1:] + indices[:1]):
            side_indices = [start, end, end + base_count, start + base_count]
            if not forward:
                side_indices.reverse()
            face_index = N()
            side_loop = loop(side_indices)
            call('SUGeometryInputAddFace', geometry, C.byref(side_loop), C.byref(face_index))
    call('SUEntitiesFill', entities, geometry, True)
    call('SUGeometryInputRelease', C.byref(geometry))
    face_count, returned = N(), N()
    call('SUEntitiesGetNumFaces', entities, C.byref(face_count))
    faces = (R * face_count.value)()
    call('SUEntitiesGetFaces', entities, face_count, faces, C.byref(returned))
    assert returned.value == face_count.value and face_count.value >= 5, part['name']
    for face in faces:
        call('SUFaceSetFrontMaterial', face, black)
        call('SUFaceSetBackMaterial', face, black)
    return vertices, face_count.value


def add_black_material(model):
    black = create('SUMaterialCreate')
    call('SUMaterialSetName', black, '오늑 먹빛'.encode())
    call('SUMaterialSetColor', black, C.byref(Color(32, 33, 34, 255)))
    call('SUModelAddMaterials', model, 1, (R * 1)(black))
    return black


def bounds(vertices):
    return [
        max(vertex[axis] for vertex in vertices) - min(vertex[axis] for vertex in vertices)
        for axis in range(3)
    ]


def assert_target_bounds(product, actual):
    target = [float(value) for value in product['size_mm']]
    assert all(abs(actual[axis] - target[axis]) <= TOLERANCE_MM for axis in range(3)), (
        product['id'], actual, target
    )
    return target


def set_camera(model, minimum, maximum, gallery=False):
    center = [(minimum[axis] + maximum[axis]) / 2 for axis in range(3)]
    span = max(maximum[axis] - minimum[axis] for axis in range(3))
    distance = max(span * 2.2, 1000)
    eye = Point((center[0] + distance) / MM_PER_INCH, (center[1] - distance) / MM_PER_INCH,
                (center[2] + distance * 0.8) / MM_PER_INCH)
    target = Point(*(value / MM_PER_INCH for value in center))
    up = Point(0, 0, 1)
    camera = create('SUCameraCreate')
    call('SUCameraSetOrientation', camera, C.byref(eye), C.byref(target), C.byref(up))
    call('SUCameraSetPerspective', camera, False)
    frustum = max((maximum[2] - minimum[2]) * 1.5, span * (1.05 if gallery else 1.35), 500)
    call('SUCameraSetOrthographicFrustumHeight', camera, frustum / MM_PER_INCH)
    call('SUModelSetCamera', model, C.byref(camera))


def count_groups(entities):
    count = N()
    call('SUEntitiesGetNumGroups', entities, C.byref(count))
    return count.value


def reload_group_counts(path, nested=False):
    model = R()
    call('SUModelCreateFromFile', C.byref(model), str(path).encode())
    try:
        root = R()
        call('SUModelGetEntities', model, C.byref(root))
        root_count = count_groups(root)
        result = {'root_groups': root_count}
        if nested:
            groups, returned = (R * root_count)(), N()
            call('SUEntitiesGetGroups', root, root_count, groups, C.byref(returned))
            assert returned.value == root_count
            nested_counts = []
            for group in groups:
                entities = R()
                call('SUGroupGetEntities', group, C.byref(entities))
                nested_counts.append(count_groups(entities))
            result['panel_groups'] = nested_counts
        return result
    finally:
        call('SUModelRelease', C.byref(model))


def product_description(product):
    return f"Source: {product['source']}\nDimensions status: {product['dimensions_status']}"


def build_individual(product, index):
    model = create('SUModelCreate')
    try:
        root = R()
        call('SUModelGetEntities', model, C.byref(root))
        black = add_black_material(model)
        vertices, parts = [], []
        for part in product['parts']:
            part_points, face_count = extrude(root, part, black)
            vertices.extend(part_points)
            parts.append({'name': part['name'], 'faces': face_count})
        actual_bounds = bounds(vertices)
        target = assert_target_bounds(product, actual_bounds)
        minimum = [min(vertex[axis] for vertex in vertices) for axis in range(3)]
        maximum = [max(vertex[axis] for vertex in vertices) for axis in range(3)]
        call('SUModelSetName', model, product['name'].encode())
        call('SUModelSetDescription', model, product_description(product).encode())
        set_camera(model, minimum, maximum)
        assert count_groups(root) == len(parts)
        filename = f"{index:02d}-{slug(product['name']) or slug(product['id']) or f'product-{index}'}.skp"
        path = OUT / filename
        call('SUModelSaveToFile', model, str(path).encode())
    finally:
        call('SUModelRelease', C.byref(model))
    reload_counts = reload_group_counts(path)
    assert reload_counts['root_groups'] == len(parts)
    return {
        'id': product['id'],
        'name': product['name'],
        'file': filename,
        'source': product['source'],
        'dimensions_status': product['dimensions_status'],
        'parts': parts,
        'part_count': len(parts),
        'bounds_mm': actual_bounds,
        'target_size_mm': target,
        'straight_only': True,
        'reload_counts': reload_counts,
    }


def build_gallery(products):
    model = create('SUModelCreate')
    gallery_vertices = []
    expected_panel_counts = []
    try:
        root = R()
        call('SUModelGetEntities', model, C.byref(root))
        black = add_black_material(model)
        for zero_index, product in enumerate(products):
            product_group, product_entities = add_group(root, f"{zero_index + 1:02d} {product['name']}")
            offset = ((zero_index % 5) * 1800, (zero_index // 5) * 2200, 0)
            transform = translation(*offset)
            call('SUGroupSetTransform', product_group, C.byref(transform))
            local_vertices = []
            for part in product['parts']:
                part_points, _ = extrude(product_entities, part, black)
                local_vertices.extend(part_points)
            assert_target_bounds(product, bounds(local_vertices))
            gallery_vertices.extend(
                (vertex[0] + offset[0], vertex[1] + offset[1], vertex[2]) for vertex in local_vertices
            )
            expected_panel_counts.append(len(product['parts']))
        call('SUModelSetName', model, '오늑 직선 가구 10선 갤러리'.encode())
        description = '\n'.join(
            [f"{index:02d}. {product['name']} | Source: {product['source']} | Dimensions status: {product['dimensions_status']}"
             for index, product in enumerate(products, 1)]
        )
        call('SUModelSetDescription', model, description.encode())
        minimum = [min(vertex[axis] for vertex in gallery_vertices) for axis in range(3)]
        maximum = [max(vertex[axis] for vertex in gallery_vertices) for axis in range(3)]
        set_camera(model, minimum, maximum, gallery=True)
        assert count_groups(root) == len(products)
        path = OUT / 'onheuk-straight-10-gallery.skp'
        call('SUModelSaveToFile', model, str(path).encode())
    finally:
        call('SUModelRelease', C.byref(model))
    reload_counts = reload_group_counts(path, nested=True)
    assert reload_counts['root_groups'] == 10
    assert reload_counts['panel_groups'] == expected_panel_counts
    return {
        'file': path.name,
        'layout': {'columns': 5, 'rows': 2, 'x_spacing_mm': 1800, 'y_spacing_mm': 2200},
        'product_count': 10,
        'bounds_mm': bounds(gallery_vertices),
        'straight_only': True,
        'reload_counts': reload_counts,
    }


def main():
    products = validate_catalog(json.loads(CATALOG.read_text(encoding='utf-8')))
    report = {'product_count': len(products), 'straight_only': True, 'products': [], 'gallery': None}
    API.SUInitialize()
    try:
        report['products'] = [build_individual(product, index) for index, product in enumerate(products, 1)]
        report['gallery'] = build_gallery(products)
    finally:
        API.SUTerminate()
    (OUT / 'export-verification.json').write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

import ctypes as C
import json
import math
from pathlib import Path

OUT = Path(__file__).resolve().parent
API = C.CDLL('/Applications/SketchUp 2026/SketchUp.app/Contents/Frameworks/SketchUpAPI.framework/SketchUpAPI')

class Ref(C.Structure):
    _fields_ = [('ptr', C.c_void_p)]

class Point(C.Structure):
    _fields_ = [('x', C.c_double), ('y', C.c_double), ('z', C.c_double)]

class Color(C.Structure):
    _fields_ = [('r', C.c_ubyte), ('g', C.c_ubyte), ('b', C.c_ubyte), ('a', C.c_ubyte)]

R, P, N = Ref, C.POINTER, C.c_size_t
signatures = {
    'SUModelCreate': [P(R)], 'SUModelRelease': [P(R)],
    'SUModelGetEntities': [R, P(R)], 'SUModelSaveToFile': [R, C.c_char_p],
    'SUModelCreateFromFile': [P(R), C.c_char_p],
    'SUModelSetName': [R, C.c_char_p], 'SUModelSetDescription': [R, C.c_char_p],
    'SUGroupCreate': [P(R)], 'SUGroupGetEntities': [R, P(R)],
    'SUGroupSetName': [R, C.c_char_p], 'SUEntitiesAddGroup': [R, R],
    'SULoopInputCreate': [P(R)], 'SULoopInputAddVertexIndex': [R, N],
    'SUGeometryInputCreate': [P(R)], 'SUGeometryInputRelease': [P(R)],
    'SUGeometryInputSetVertices': [R, N, P(Point)],
    'SUGeometryInputAddFace': [R, P(R), P(N)],
    'SUGeometryInputFaceAddInnerLoop': [R, N, P(R)],
    'SUEntitiesFill': [R, R, C.c_bool],
    'SUEntitiesGetNumFaces': [R, P(N)], 'SUEntitiesGetNumGroups': [R, P(N)],
    'SUEntitiesGetFaces': [R, N, P(R), P(N)],
    'SUMaterialCreate': [P(R)], 'SUMaterialSetName': [R, C.c_char_p],
    'SUMaterialSetColor': [R, P(Color)], 'SUModelAddMaterials': [R, N, P(R)],
    'SUFaceSetFrontMaterial': [R, R], 'SUFaceSetBackMaterial': [R, R],
    'SUCameraCreate': [P(R)], 'SUCameraSetOrientation': [R, P(Point), P(Point), P(Point)],
    'SUCameraSetPerspective': [R, C.c_bool],
    'SUCameraSetOrthographicFrustumHeight': [R, C.c_double],
    'SUModelSetCamera': [R, P(R)],
}
for name, args in signatures.items():
    getattr(API, name).argtypes = args
    getattr(API, name).restype = C.c_int

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
    for i in indices:
        call('SULoopInputAddVertexIndex', ref, i)
    return ref

def rectangle(w, h):
    return [(0, 0), (w, 0), (w, h), (0, h)]

def arc(cx, cy, radius, start, end):
    return [(cx + radius * math.cos(math.radians(start + (end-start)*i/8)),
             cy + radius * math.sin(math.radians(start + (end-start)*i/8))) for i in range(9)]

records = []
all_vertices = []

def extrude(name, outer, holes, mapper, vector):
    group = create('SUGroupCreate')
    call('SUEntitiesAddGroup', root, group)
    call('SUGroupSetName', group, name.encode())
    entities = R()
    call('SUGroupGetEntities', group, C.byref(entities))
    rings = [outer] + holes
    vertices, ring_indices = [], []
    for ring in rings:
        ring_indices.append(list(range(len(vertices), len(vertices)+len(ring))))
        vertices.extend(mapper(*p) for p in ring)
    n = len(vertices)
    vertices += [tuple(p[i]+vector[i] for i in range(3)) for p in vertices]
    a, b, c = [vertices[i] for i in range(3)]
    u, v = [b[i]-a[i] for i in range(3)], [c[i]-b[i] for i in range(3)]
    normal = (u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0])
    forward = sum(normal[i]*vector[i] for i in range(3)) > 0
    geometry = create('SUGeometryInputCreate')
    points = (Point * len(vertices))(*(Point(*(c/25.4 for c in p)) for p in vertices))
    call('SUGeometryInputSetVertices', geometry, len(points), points)
    for offset, reverse in [(0, forward), (n, not forward)]:
        loops = [[i+offset for i in ids][::(-1 if reverse else 1)] for ids in ring_indices]
        face_index = N()
        outer_loop = loop(loops[0])
        call('SUGeometryInputAddFace', geometry, C.byref(outer_loop), C.byref(face_index))
        for ids in loops[1:]:
            inner = loop(ids)
            call('SUGeometryInputFaceAddInnerLoop', geometry, face_index, C.byref(inner))
    for ids in ring_indices:
        for i, j in zip(ids, ids[1:]+ids[:1]):
            face_index = N()
            indices = [i, j, j+n, i+n]
            if not forward:
                indices.reverse()
            side = loop(indices)
            call('SUGeometryInputAddFace', geometry, C.byref(side), C.byref(face_index))
    call('SUEntitiesFill', entities, geometry, True)
    call('SUGeometryInputRelease', C.byref(geometry))
    count, returned = N(), N()
    call('SUEntitiesGetNumFaces', entities, C.byref(count))
    faces = (R * count.value)()
    call('SUEntitiesGetFaces', entities, count, faces, C.byref(returned))
    assert returned.value == count.value and count.value >= 6
    for face in faces:
        call('SUFaceSetFrontMaterial', face, black)
        call('SUFaceSetBackMaterial', face, black)
    records.append({'part': name, 'faces': count.value})
    all_vertices.extend(vertices)

API.SUInitialize()
model = create('SUModelCreate')
try:
    root = R()
    call('SUModelGetEntities', model, C.byref(root))
    black = create('SUMaterialCreate')
    call('SUMaterialSetName', black, '오늑 먹빛 · 자작합판 15T'.encode())
    call('SUMaterialSetColor', black, C.byref(Color(32, 33, 34, 255)))
    call('SUModelAddMaterials', model, 1, (R * 1)(black))
    front = [(0,0),(350,0),(350,435),(179,435)] + arc(175,44,4,0,-180) + [(171,435),(0,435)]
    slot = arc(175,44,4,0,-180) + arc(175,506,4,180,0)
    extrude('01 앞판 350×435×15 · 중앙 슬롯', front, [], lambda x,z:(x,0,z), (0,15,0))
    extrude('02 뒤판·등받이 350×570×15 · 중앙 슬롯', rectangle(350,570), [slot], lambda x,z:(x,350,z), (0,15,0))
    for x, label in [(0,'좌'),(179,'우')]:
        extrude(f'03 좌면 {label} 171×350×15', rectangle(171,350), [], lambda a,b,x=x:(a+x,b,435), (0,0,15))
    for x, label in [(0,'좌'),(335,'우')]:
        extrude(f'04 하부 보강재 {label} 15×335×60', rectangle(15,335), [], lambda a,b,x=x:(a+x,b+15,375), (0,0,60))
    call('SUModelSetName', model, '오늑 라인 체어'.encode())
    description = 'Source: https://store.ohou.se/goods/2692901\nConfirmed: W350 D365 H570, seat H450, birch plywood 15mm.\nPhoto estimates: slot width 8mm, bottom 40mm, rear slot top 510mm, side rails height 60mm. Reconstructed reference model; concealed joinery is not specified.'
    call('SUModelSetDescription', model, description.encode())
    camera = create('SUCameraCreate')
    eye, target, up = Point(1000/25.4,-1250/25.4,1000/25.4), Point(175/25.4,182.5/25.4,290/25.4), Point(0,0,1)
    call('SUCameraSetOrientation', camera, C.byref(eye), C.byref(target), C.byref(up))
    call('SUCameraSetPerspective', camera, False)
    call('SUCameraSetOrthographicFrustumHeight', camera, 850/25.4)
    call('SUModelSetCamera', model, C.byref(camera))
    bounds = [max(p[i] for p in all_vertices)-min(p[i] for p in all_vertices) for i in range(3)]
    assert bounds == [350,365,570], bounds
    group_count = N()
    call('SUEntitiesGetNumGroups', root, C.byref(group_count))
    assert group_count.value == 6
    path = OUT/'onheuk-line-chair-350x365x570mm.skp'
    call('SUModelSaveToFile', model, str(path).encode())
    check = R()
    call('SUModelCreateFromFile', C.byref(check), str(path).encode())
    check_entities, check_count = R(), N()
    call('SUModelGetEntities', check, C.byref(check_entities))
    call('SUEntitiesGetNumGroups', check_entities, C.byref(check_count))
    assert check_count.value == 6
    call('SUModelRelease', C.byref(check))
    report = {'file': str(path), 'source': 'https://store.ohou.se/goods/2692901', 'bounds_mm': bounds, 'seat_height_mm':450, 'plywood_mm':15, 'groups':records, 'reload_verified':True, 'estimated':{'slot_width_mm':8,'slot_bottom_mm':40,'rear_slot_top_mm':510,'rail_height_mm':60}}
    (OUT/'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
finally:
    call('SUModelRelease', C.byref(model))
    API.SUTerminate()

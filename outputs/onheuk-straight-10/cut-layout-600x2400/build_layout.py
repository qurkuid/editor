import ctypes as C
import importlib.util
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('source_builder', OUT.parent / 'build_models.py')
b = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b)
COLORS = [(166,196,203),(213,178,138),(171,188,145),(143,170,201),(196,168,188),(212,193,129),(147,188,170),(210,163,151),(163,160,198),(199,188,164)]


def material(model, name, rgb):
    ref = b.create('SUMaterialCreate')
    b.call('SUMaterialSetName', ref, name.encode())
    b.call('SUMaterialSetColor', ref, C.byref(b.Color(*rgb,255)))
    b.call('SUModelAddMaterials', model, 1, (b.R * 1)(ref))
    return ref


def placed_ring(ring, part, placement):
    original = part['outer_mm']
    if placement['rotation_deg'] == 0:
        rotate = lambda u,v:(u,v)
    elif placement['rotation_deg'] == 90:
        rotate = lambda u,v:(-v,u)
    else:
        raise AssertionError('Unsupported rotation')
    rotated = [rotate(*point) for point in original]
    xmin=min(p[0] for p in rotated); ymin=min(p[1] for p in rotated)
    result=[]
    for point in ring:
        u,v=rotate(*point)
        x=placement['x_mm']+u-xmin; y=placement['y_mm']+v-ymin
        result.append([y,600-x])
    return result


def main():
    data=json.loads((OUT/'nesting.json').read_text())
    catalog=json.loads((OUT.parent/'catalog.json').read_text())['products']
    b.API.SUInitialize()
    model=b.create('SUModelCreate')
    try:
        root=b.R(); b.call('SUModelGetEntities',model,C.byref(root))
        materials=[material(model,f'P{i+1:02d} {p["name"]}',COLORS[i]) for i,p in enumerate(catalog)]
        stock_material=material(model,'온장 배경 - 재단 부품 제외',(239,229,206))
        for si,sheet in enumerate(data['sheets']):
            group,entities=b.add_group(root,sheet['id'])
            b.call('SUGroupSetTransform',group,C.byref(b.translation((si%2)*2800,(si//2)*1000)))
            t=sheet['thickness_mm']
            b.extrude(entities,{'name':'온장 600×2400 - 배경','plane':'xy','origin_mm':[0,0,-t-1], 'outer_mm':[[0,0],[2400,0],[2400,600],[0,600]],'holes_mm':[],'thickness_mm':t},stock_material)
            for placement in sheet['parts']:
                pi=placement['product_index']-1; pj=placement['part_index']-1
                part=catalog[pi]['parts'][pj]
                flat={'name':placement['id'],'plane':'xy','origin_mm':[0,0,0], 'thickness_mm':part['thickness_mm'], 'outer_mm':placed_ring(part['outer_mm'],part,placement), 'holes_mm':[placed_ring(h,part,placement) for h in part.get('holes_mm',[])]}
                assert b.bounds([(x,y,0) for x,y in flat['outer_mm']])[:2]==[placement['h_mm'],placement['w_mm']]
                b.extrude(entities,flat,materials[pi])
        b.call('SUModelSetName',model,'오늑 10종 600×2400 온장 배치 - 치수 확정 전 재단 보류'.encode())
        b.call('SUModelSetDescription',model,'제품별 1대. 사진 기반 제작 검토 모델 부품. 톱날 4mm / 판 여유 10mm / 90도 회전 허용. 모든 부품의 결합 치수는 미확정이므로 재단 보류. 원본 조립 모델은 별도 보존.'.encode())
        b.set_camera(model,[0,0,0],[5200,2600,15],True)
        b.call('SUModelSaveToFile',model,str(OUT/'onheuk-10-cut-layout-600x2400.skp').encode())
    finally:
        b.call('SUModelRelease',C.byref(model)); b.API.SUTerminate()
    print('SketchUp layout exported:',len(data['sheets']),'sheets /',sum(len(s['parts']) for s in data['sheets']),'parts')


if __name__=='__main__':
    main()

# -*- coding: utf-8 -*-
import base64
import csv
import html
import importlib.util
import json
import math
import zipfile
from pathlib import Path

OUT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('layout_builder',OUT/'build_layout.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
CAT=json.loads((OUT.parent/'catalog.json').read_text())['products']
DATA=json.loads((OUT/'nesting.json').read_text())
ESC=html.escape


def area(r):
    return abs(sum(p[0]*r[(i+1)%len(r)][1]-r[(i+1)%len(r)][0]*p[1] for i,p in enumerate(r)))/2


def free_rectangles(node):
    if node['type']=='free':
        yield node['rect_mm']
    for child in node.get('children',[]):
        yield from free_rectangles(child)
    if 'child' in node:
        yield from free_rectangles(node['child'])


def svg(sheet):
    shapes=['<svg xmlns="http://www.w3.org/2000/svg" viewBox="-70 -100 2530 830" role="img" aria-label="'+sheet['id']+' 온장 부품 배치"><style>text{font-family:Arial,sans-serif;fill:#243139}.part{cursor:pointer}.part:hover polygon{stroke:#d74a26;stroke-width:4}</style>', '<rect width="2400" height="600" fill="#f8f3e5" stroke="#243139" stroke-width="2"/>','<rect x="10" y="10" width="2380" height="580" fill="none" stroke="#928778" stroke-dasharray="6 5"/>','<text x="0" y="-62" font-size="25">'+sheet['id']+' · '+str(sheet['thickness_mm'])+'T · '+str(len(sheet['parts']))+'부품</text>','<text x="0" y="-25" font-size="18">왼쪽 위 (X0,Y0) · X: 짧은 변 아래 방향 / Y: 긴 변 오른쪽 방향</text>']
    for p in sheet['parts']:
        src=CAT[p['product_index']-1]['parts'][p['part_index']-1]
        ring=b.placed_ring(src['outer_mm'],src,p)
        points=' '.join(f'{x:g},{600-y:g}' for x,y in ring)
        color='rgb('+','.join(map(str,b.COLORS[p['product_index']-1]))+')'
        x=p['y_mm'];y=p['x_mm'];w=p['h_mm'];h=p['w_mm']
        desc=f"{p['id']} {CAT[p['product_index']-1]['name']} / {src['name']} / 블랭크 {p['w_mm']}×{p['h_mm']} mm / X{p['x_mm']} Y{p['y_mm']} / 재단 보류"
        shapes.append(f'<g class="part" data-part="{p["id"]}" tabindex="0"><title>{ESC(desc)}</title><rect x="{x}" y="{y}" width="{w}" height="{h}" fill="none" stroke="#647079" stroke-width="0.8"/><polygon points="{points}" fill="{color}" stroke="#243139" stroke-width="1.3"/>')
        cx=x+w/2;cy=y+h/2
        rotation=f' transform="rotate(-90 {cx} {cy})"' if w<h else ''
        if min(w,h)>=100:
            shapes.append(f'<text x="{cx}" y="{cy-4}" text-anchor="middle" font-size="21"{rotation}>{p["id"]}</text><text x="{cx}" y="{cy+19}" text-anchor="middle" font-size="17"{rotation}>{p["w_mm"]} × {p["h_mm"]}</text>')
        else:
            shapes.append(f'<text x="{cx}" y="{cy+5}" text-anchor="middle" font-size="16"{rotation}>{p["id"]}</text>')
        shapes.append('</g>')
    shapes.extend(['<text x="1200" y="645" text-anchor="middle" font-size="24">2400 mm（Y）</text>','<text x="-25" y="300" text-anchor="middle" font-size="20" transform="rotate(-90 -25 300)">600 mm（X）</text>','<text x="0" y="700" font-size="19" fill="#b33528">사진 추정 치수 · 재단 보류 / 톱날 4mm · 가장자리 10mm · 결 방향 제한 없이 90° 회전 허용</text>','</svg>'])
    return ''.join(shapes)


def main():
    assert DATA['validation']['passed']
    assert len(DATA['sheets'])==6 and sum(len(s['parts']) for s in DATA['sheets'])==89
    profile={}
    for prod in CAT:
        for p in prod['parts']:
            t=p['thickness_mm'];profile[t]=profile.get(t,0)+area(p['outer_mm'])-sum(area(h) for h in p.get('holes_mm',[]))
    assert profile[15]>4*600*2400 and profile[12]>0
    cut_rows=[];part_rows=[];remainder_rows=[];sections=[]
    for sheet in DATA['sheets']:
        diagram=svg(sheet)
        (OUT/f'{sheet["id"]}.svg').write_text(diagram)
        rows=[]
        for p in sheet['parts']:
            prod=CAT[p['product_index']-1];src=prod['parts'][p['part_index']-1]
            part_rows.append([sheet['id'],sheet['thickness_mm'],p['id'],prod['name'],src['name'],*p['original_blank_mm'],p['x_mm'],p['y_mm'],p['w_mm'],p['h_mm'],p['rotation_deg'],'사진 추정 치수 — 재단 보류'])
            rows.append(f'<tr id="{p["id"]}"><td><b>{p["id"]}</b></td><td>{ESC(prod["name"])}<br>{ESC(src["name"])}</td><td>{p["original_blank_mm"][0]} × {p["original_blank_mm"][1]}</td><td>{p["x_mm"]}</td><td>{p["y_mm"]}</td><td>{p["w_mm"]} × {p["h_mm"]}</td><td>{p["rotation_deg"]}°</td></tr>')
        cuts=[]
        for c in sheet['cut_sequence']:
            axis='X' if c['direction']=='vertical' else 'Y'
            parent=c['parent_rect_mm'];key='x_mm' if axis=='X' else 'y_mm'
            offset=c['cut_position_mm']-parent[key]
            side='−'+axis if c.get('trim_side') in ('left','bottom') else '+'+axis
            cut_type={'border_trim':'테두리 정리','edge_trim':'잔여 폭 정리','cut':'부품 분할'}[c['type']]
            cut_rows.append([sheet['id'],c['order'],cut_type,axis,c['cut_position_mm'],offset,c['span_start_mm'],c['span_end_mm'],parent['x_mm'],parent['y_mm'],parent['w_mm'],parent['h_mm'],side,4,'재단 보류'])
            cuts.append(f'<tr><td>{c["order"]}</td><td>{cut_type}</td><td>({parent["x_mm"]}, {parent["y_mm"]})<br>{parent["w_mm"]} × {parent["h_mm"]}</td><td>{axis} = {c["cut_position_mm"]}</td><td>{offset:g}</td><td>{c["span_start_mm"]} → {c["span_end_mm"]}</td><td>{side}</td></tr>')
        remains=sorted(free_rectangles(sheet['cut_pattern']),key=lambda r:r['w_mm']*r['h_mm'],reverse=True)
        remrows=[]
        for ri,r in enumerate(remains,1):
            remainder_rows.append([sheet['id'],sheet['thickness_mm'],ri,r['x_mm'],r['y_mm'],r['w_mm'],r['h_mm'],r['w_mm']*r['h_mm']])
            remrows.append(f'<tr><td>{ri}</td><td>{r["w_mm"]} × {r["h_mm"]}</td><td>{r["x_mm"]}, {r["y_mm"]}</td></tr>')
        sections.append(f'<section id="{sheet["id"]}"><h2>{sheet["id"]} · {sheet["thickness_mm"]}T</h2><p>{len(sheet["parts"])}부품 / 테두리를 뺀 면적 기준 블랭크 사용률 {sheet["usable_area_utilization"]*100:.1f}%</p><div class="diagram">{diagram}</div><p class="small">색은 제품 구분입니다. 윤곽선은 최종 부품 모양, 사각형 테두리는 먼저 잘라낼 블랭크입니다. 부품을 누르면 치수표로 이동합니다.</p><div class="scroll"><table><thead><tr><th>번호</th><th>제품 / 부품</th><th>원본 블랭크<br>가로×세로</th><th>X 위치</th><th>Y 위치</th><th>판 위 X폭×Y길이</th><th>회전</th></tr></thead><tbody>{"".join(rows)}</tbody></table></div><details><summary>직선 재단 순서 ({len(cuts)}회)</summary><p>대상 잔판만 순서대로 자릅니다. 좌표는 모두 원판 기준입니다. 상대 위치는 해당 잔판의 X/Y 시작점에서 남길 경계까지의 거리입니다. 톱날 중심으로 맞추면 안 됩니다. 표의 손실 방향 쪽으로 4mm 톱날을 두어 치수 경계를 보존합니다. 홈·경사·계단 모양의 2차 가공은 이 표에 포함되지 않습니다.</p><div class="scroll"><table><thead><tr><th>순서</th><th>가공</th><th>대상 잔판 (X,Y)<br>X폭×Y길이</th><th>원판 기준 경계</th><th>잔판 기준 거리</th><th>절단 범위</th><th>톱날 손실 방향</th></tr></thead><tbody>{"".join(cuts)}</tbody></table></div></details><details><summary>남는 직사각형 자재 ({len(remains)}개)</summary><p>홈·경사 내부에서 생기는 작은 조각과 테두리 폐재는 제외했습니다.</p><table><thead><tr><th>번호</th><th>X폭×Y길이</th><th>X,Y 위치</th></tr></thead><tbody>{"".join(remrows)}</tbody></table></details></section>')
    files=[('parts-review.csv',['판','두께T','부품번호','제품','부품','원본가로mm','원본세로mm','Xmm','Ymm','배치X폭mm','배치Y길이mm','회전도','재단상태'],part_rows),('cut-sequence-review.csv',['판','순서','가공','축','원판경계mm','잔판상대거리mm','범위시작mm','범위끝mm','잔판Xmm','잔판Ymm','잔판X폭mm','잔판Y길이mm','톱날손실방향','톱날mm','재단상태'],cut_rows),('remainders.csv',['판','두께T','번호','Xmm','Ymm','X폭mm','Y길이mm','면적mm2'],remainder_rows)]
    for filename,headers,rows in files:
        with (OUT/filename).open('w',encoding='utf-8-sig',newline='') as f:
            writer=csv.writer(f);writer.writerow(headers);writer.writerows(rows)
    colors=''.join(f'<span style="border-left:12px solid rgb({",".join(map(str,b.COLORS[i]))})">P{i+1:02d} {ESC(prod["name"])}</span>' for i,prod in enumerate(CAT))
    nav=''.join(f'<a href="#{s["id"]}">{s["id"]}</a>' for s in DATA['sheets'])
    preview=base64.b64encode((OUT/'layout-preview.png').read_bytes()).decode()
    doc='''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>오늑 10종 온장 배치 검토</title><style>*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",Arial,sans-serif;max-width:1280px;margin:auto;padding:28px;color:#243139;background:#f7f7f2;line-height:1.6}h1{font-size:32px;margin:0}h2{margin:0 0 8px}a{color:#126175}nav{display:flex;gap:12px;flex-wrap:wrap;margin:22px 0}nav a{padding:6px 12px;border:1px solid #bac8ca;background:white;border-radius:7px}section{background:white;border:1px solid #d7dfdd;padding:22px;margin:24px 0;border-radius:12px}.hold{background:#fff0df;border-left:5px solid #be6129;padding:18px}.stats{display:flex;gap:24px;flex-wrap:wrap;margin:24px 0}.stats div{background:#e6edeb;padding:16px 24px;border-radius:8px}.stats b{font-size:28px;display:block}.legend{display:flex;gap:12px;flex-wrap:wrap;font-size:14px}.legend span{padding:0 8px}.diagram{overflow:auto}.diagram svg{width:100%;min-width:950px;height:auto}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{border-bottom:1px solid #dce2e0;text-align:left;padding:9px;white-space:nowrap}th{background:#ecf1ef;position:sticky;top:0}tr.selected{background:#fff0c9}.small{font-size:13px;color:#64716f}details{margin-top:20px}summary{font-weight:700;cursor:pointer;padding:12px;background:#edf2ef}img{max-width:100%}@media print{body{background:white;padding:0}nav,.actions{display:none}section{break-before:page;border:0;padding:0}.diagram svg{min-width:0}th{position:static}details{display:none}h1{font-size:24px}.hold{border:2px solid #be6129}.small{font-size:10px}}</style><h1>오늑 10종 · 600×2400 온장 배치</h1><p>제품별 1대, 총 89부품. 15T와 12T를 별도 판에 혼합 제품으로 배치했습니다. 원본 조립 모델의 부품 모양과 부피를 보존했습니다.</p><div class="hold"><b>치수·결합부 확정 전 재단 보류</b><br>이 자료는 사진을 참고한 기존 모델의 부품 배치입니다. 상품 전체 크기와 명목 판두께는 확인했지만 내부 부품 치수·홈·결합은 추정입니다. 특히 로우 체어02의 15T 좌판과 15mm 홈은 가공 여유가 0mm이며, 벼루 선반의 교차판은 상·하 두 부품으로 추정되어 있습니다. 실제 합판 두께, 결 방향, 접합 방식과 부품 치수가 확정되어야 재단 도면으로 쓸 수 있습니다.</div><div class="stats"><div><b>15T 5장</b>80부품</div><div><b>12T 1장</b>9부품</div><div><b>총 6장</b>현재 부품 기준 최소 장수</div><div><b>겹침 0</b>누락·판 밖 배치 0</div></div><p>톱날 손실 4mm · 판 가장자리 각각 10mm · 결 방향 제약 없이 90° 회전 허용. 먼저 직사각형 블랭크를 분리하고 홈·계단·경사선은 후가공하는 배치입니다. 나뭇결 방향을 고정하면 재배치가 필요합니다.</p><p>15T 실부품 면적은 5,905,685mm²로 4온장 전체 면적 5,760,000mm²보다 큽니다. 따라서 다각형을 맞물려도 15T는 최소 5장이 필요하며, 실제 5장에 배치했습니다. 두께가 다른 12T는 1장이 필요합니다. 현재 부품 치수와 두께 구분에서 6장이 최소입니다.</p><p class="actions"><a href="onheuk-10-cut-layout-600x2400.skp">SketchUp 온장 배치 모델</a> · <a href="parts-review.csv">부품 치수표</a> · <a href="cut-sequence-review.csv">재단 순서표</a> · <a href="remainders.csv">남는 자재 목록</a></p>'''+f'<nav>{nav}</nav><div class="legend">{colors}</div>'+''.join(sections)+f'<section><h2>SketchUp 실제 배치 확인</h2><img alt="SketchUp에서 검증한 6온장 배치" src="data:image/png;base64,{preview}"><p>SketchUp 실제 모델에서 89개 부품의 솔리드·크기·두께·체적·위치·4mm 간격을 검증했습니다. 이 검증은 원본 추정 모델과 배치가 일치한다는 뜻이며 조립 치수나 구조 강도를 확정하지 않습니다.</p></section>'+'''<script>document.querySelectorAll('.part').forEach(g=>{g.addEventListener('click',()=>{document.querySelectorAll('tr.selected').forEach(r=>r.classList.remove('selected'));const r=document.getElementById(g.dataset.part);r.classList.add('selected');r.scrollIntoView({block:'center',behavior:'smooth'});});g.addEventListener('keydown',e=>{if(e.key==='Enter')g.dispatchEvent(new Event('click'));});});</script></html>'''
    (OUT/'cut-layout-review.html').write_text(doc,encoding='utf-8')
    archive=OUT/'onheuk-10-cut-layout-review.zip'
    deliverables=['onheuk-10-cut-layout-600x2400.skp','cut-layout-review.html','parts-review.csv','cut-sequence-review.csv','remainders.csv','nesting.json','native-verification.json','layout-preview.png']+[f'{s["id"]}.svg' for s in DATA['sheets']]
    with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
        for name in deliverables:z.write(OUT/name,name)
    with zipfile.ZipFile(archive) as z:assert z.testzip() is None
    assert len(part_rows)==89 and len({p[2] for p in part_rows})==89
    assert len(remainder_rows)>0 and len(cut_rows)==sum(len(s['cut_sequence']) for s in DATA['sheets'])
    print(json.dumps({'parts':len(part_rows),'sheets':len(DATA['sheets']),'cut_steps':len(cut_rows),'rectangular_remainders':len(remainder_rows),'profile_areas_mm2':profile,'minimum_sheet_count':6,'archive':str(archive),'status':'재단 보류'},ensure_ascii=False))


if __name__=='__main__':main()

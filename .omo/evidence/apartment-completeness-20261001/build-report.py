import base64, html, json
from pathlib import Path

root=Path(__file__).resolve().parent
reports=json.loads((root/'summary.json').read_text())
def esc(x):return html.escape(str(x))
def image(path):return 'data:image/jpeg;base64,'+base64.b64encode(path.read_bytes()).decode()
notes={
'jangjeon':[
'원본은 안방 3·욕실 2·현관 1·거실 1·부엌 1·발코니 2의 10개 의미 공간으로 판독했습니다.',
'생성 존은 9개입니다. 거실과 부엌 기준점이 모두 r5 한 존에 들어가며 이름과 용도가 발코니로 저장됐습니다.',
'거실·부엌은 열린 생활 공간이므로 물리적으로 이어지는 것 자체는 오류가 아닙니다. 서로 다른 용도의 존이 사라지고 발코니로 분류되는 것이 오류입니다.',
'선정한 벽 구간 5개는 통과했고 미접합 끝점과 외부 연결은 발견되지 않았습니다. 이 도면의 주요 결함은 의미 공간 분류입니다.'],
'haeundae':[
'원본은 안방 3·욕실 2·부엌 1·드레스룸 1·현관 1·거실 1·발코니 3의 12개 공간입니다.',
'생성 존은 13개입니다. 12개 기준점의 이름·용도는 맞지만 우측 욕실 가장자리의 r4를 0.21㎡ 추가 욕실 존으로 분리했습니다.',
'좌측 하부 안방의 상부 출입문 호스트가 빠져 안방과 거실이 같은 물리 영역으로 이어집니다. 상부 안방·드레스룸 접합부도 끊겼습니다. 벽 끝점의 순수 틈은 각각 약 96cm와 20cm입니다.',
'우측 욕실 앞 열린 복도에 도면에 없는 긴 창 호스트가 생겨 통로를 가릅니다. 원본 복도 기준 구간 9개 표본 모두 호스트 벽과 겹칩니다.'],
'hwmyeong':[
'원본은 안방 4·욕실 2·부엌 1·드레스룸 1·현관 1·거실 1·발코니 4의 14개 공간입니다.',
'생성 개수도 14개지만 내용은 다릅니다. 거실과 현관이 r9 발코니 존 하나로 합쳐지고, 드레스룸은 r8·r10의 방 2개로 나뉩니다. 14개 기준점 중 이름·용도 일치는 11개뿐입니다.',
'현관 상부 대각 외벽·문 호스트가 빠집니다. 좌측 욕실 외벽 접합부도 약 12cm 열려, 실제 벽 두께로 검사했을 때 욕실·현관·거실 기준점이 외부와 연결됩니다.',
'상부 좌측 안방–발코니와 부엌–상부 중앙 발코니의 호스트 경계도 닫히지 않았습니다. 하부 우측 안방–발코니의 o12 개구부는 벽에 배치되지 않아 자동 모델에서 제외됐습니다.']}
colors={'bedroom':'#b97724','bath':'#287eab','balcony':'#867320','living':'#705ab1','kitchen':'#3c8775','dress':'#a34888','entrance':'#a55032'}

def overlay(r):
    folder=root/r['case']['key']
    api=json.loads((folder/'api.json').read_text())['data']
    scene=json.loads((folder/'scene.json').read_text())
    aw,ah=api['imageSize']; sw,sh=1242,828;m=api['mmPerPx']/1000
    def point(p):return [(p[0]+aw*m/2)/(aw/sw*m),(p[1]+ah*m/2)/(ah/sh*m)]
    out=[f'<svg viewBox="0 0 {sw} {sh}" role="img" aria-label="원본 도면과 독립 기준점 및 저장된 존 경계"><image href="{image(folder/"source.jpg")}" width="{sw}" height="{sh}"/>']
    out.append('<g class="zone-layer">')
    for z in scene['graph']['nodes'].values():
        if z['type']!='zone':continue
        pts=[point(v) for v in z['polygon']]
        col=colors.get(z['metadata']['cls'],'#666')
        out.append('<polygon points="'+' '.join(f'{x:.2f},{y:.2f}' for x,y in pts)+f'" fill="{col}" fill-opacity=".23" stroke="{col}" stroke-width="2"><title>{esc(z["metadata"]["sourceRoomId"]+" "+z["name"])}</title></polygon>')
    out.append('</g><g class="wall-layer">')
    for w in scene['graph']['nodes'].values():
        if w['type']!='wall':continue
        a,b=point(w['start']),point(w['end'])
        out.append(f'<line x1="{a[0]:.2f}" y1="{a[1]:.2f}" x2="{b[0]:.2f}" y2="{b[1]:.2f}" stroke="#1d57cc" stroke-width="3"><title>{esc(w["id"])}</title></line>')
    for end in r['danglingEndpoints']:
        x,y=end['source'];out.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="10" fill="none" stroke="#ce3434" stroke-width="3"><title>미접합 끝점 {end["bodyGapM"]:.3f}m</title></circle>')
    out.append('</g><g class="probe-layer">')
    for i,p in enumerate(r['roomMatches'],1):
        x,y=p['source'];col='#237950' if p['pass'] else '#b92c32'
        out.append(f'<circle cx="{x}" cy="{y}" r="13" fill="{col}" stroke="white" stroke-width="2"/><text x="{x}" y="{y+5}" fill="white" text-anchor="middle" font-size="15" font-weight="700">{i}</text>')
    for w in r['wallProbes']:
        if w['pass']:continue
        a,b=w['a'],w['b'];out.append(f'<line x1="{a[0]}" y1="{a[1]}" x2="{b[0]}" y2="{b[1]}" stroke="#cc3232" stroke-width="6" stroke-dasharray="8 5"><title>{esc(w["label"])}</title></line>')
    out.append('</g></svg>')
    return ''.join(out)

summary_rows=[];sections=[]
for r in reports:
    c=r['case'];key=c['key']
    summary_rows.append(f'<tr><td><a href="#{key}">{esc(c["name"])} {esc(c["type"])}</a></td><td>{r["expectedRooms"]} / {r["actualZones"]}</td><td>{r["roomProbesPassed"]} / {r["roomProbesTotal"]}</td><td>{len(r["danglingEndpoints"])}</td><td>{len(r["exteriorConnectedProbes"])}</td><td><span class="fail">미통과</span></td></tr>')
    room_rows=[]
    for i,p in enumerate(r['roomMatches'],1):
        actual=' · '.join(v['sourceRoomId']+' '+v['name']+' ('+v['cls']+')' for v in p['matches']) or '존 없음'
        room_rows.append(f'<tr><td>{i}</td><td>{esc(p["label"])}</td><td>{esc(actual)}</td><td class="{("pass" if p["pass"] else "fail")}">{("일치" if p["pass"] else "불일치")}</td></tr>')
    wall_rows=[f'<tr><td>{esc(w["label"])}</td><td>{w["maxBodyDistanceM"]*100:.1f}cm</td><td class="{("pass" if w["pass"] else "fail")}">{("통과" if w["pass"] else "누락·불연결")}</td></tr>' for w in r['wallProbes']]
    source_openings=r['sourceOpeningTypes'];model_openings=r['modelOpeningTypes']
    sections.append(f'''<section id="{key}">
<div class="section-head"><div><p class="eyebrow">2D TEST · {esc(key.upper())}</p><h2>{esc(c["name"])} <span>{esc(c["type"])}</span></h2></div><a class="scene-link" href="http://localhost:3002/scene/{c["sceneId"]}" target="_blank">검수 장면 열기 ↗</a></div>
<div class="facts"><span>저장 버전 {r["sceneVersion"]}</span><span>벽 {r["counts"]["wall"]}개</span><span>존 {r["actualZones"]}개</span><span>브라우저 오류 0</span><span>좌표계 검증 통과</span></div>
<ol class="findings">{''.join('<li>'+esc(n)+'</li>' for n in notes[key])}</ol>
<div class="visual-grid"><figure>{overlay(r)}<figcaption>원본 도면 · 녹색은 용도 일치, 빨간색은 불일치. 빨간 점선은 호스트 누락 검사 구간입니다.</figcaption></figure><figure><img src="{image(root/key/"2d.jpg")}" alt="{esc(c["name"])} 실제 2D 자동 생성 결과"><figcaption>실제 편집기 2D 결과 · 수동 보정 없이 자동 생성 후 저장한 상태.</figcaption></figure></div>
<div class="details-grid"><div><h3>공간 대응</h3><table><thead><tr><th>점</th><th>원본 공간</th><th>저장된 존</th><th>판정</th></tr></thead><tbody>{''.join(room_rows)}</tbody></table></div><div><h3>벽·호스트 구간 검사</h3><p class="small">각 구간 13점. 벽 표면으로부터 최대 이격 6cm 이하를 통과 기준으로 사용했습니다.</p><table><thead><tr><th>원본 구간</th><th>최대 이격</th><th>판정</th></tr></thead><tbody>{''.join(wall_rows)}</tbody></table>
<h3>저장·데이터 검사</h3><ul><li>존 내부 중첩 {len(r["zoneGeometry"]["interiorOverlaps"])}건 · 무효 폴리곤 {len(r["zoneGeometry"]["invalidPolygons"])}건</li><li>부모 벽 참조 오류 {len(r["hostErrors"])}건 · 미배치 개구부 {len(r["importDiagnostics"]["unhostedOpeningIds"])}건</li><li>원본 분석 개구부: {esc(source_openings)}</li><li>저장 모델 개구부: {esc(model_openings)}</li></ul><p class="small">장면 ID: {c["sceneId"]}<br>도면 ID: {c["planId"]}<br>분석 문서 버전: {r["docVersion"]}</p></div></div></section>''')

document='''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>아파트 자동 모델링 2D 공간 완결성 검수</title><style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#21312f;background:#f4f6f4;font-size:16px;line-height:1.7}*{box-sizing:border-box}body{margin:0}main{max-width:1440px;margin:auto;padding:48px 40px 80px}h1{font-size:36px;line-height:1.35;margin:12px 0 18px;letter-spacing:-1.2px}h2{font-size:26px;line-height:1.4;margin:4px 0}h2 span{color:#64746e;font-size:19px}h3{font-size:18px;margin:22px 0 12px}.eyebrow{font-size:12px;letter-spacing:1.5px;font-weight:700;color:#537568;margin:0}.lead{max-width:920px;font-size:19px}.verdict{background:#fff0ec;border-left:5px solid #bb3636;padding:18px 24px;margin:24px 0}.verdict strong{font-size:23px;color:#a52c2c}section{background:white;border:1px solid #dee5df;border-radius:16px;padding:30px;margin-top:32px;scroll-margin-top:20px}.section-head{display:flex;align-items:center;justify-content:space-between;gap:16px}.scene-link{background:#e8f2ed;padding:8px 14px;border-radius:7px;white-space:nowrap}a{color:#22604c;text-decoration:none}a:hover{text-decoration:underline}nav{display:flex;gap:20px;flex-wrap:wrap;margin:20px 0}table{width:100%;border-collapse:collapse;background:white;font-size:14px}th{text-align:left;color:#53675e;background:#eef3ef;font-weight:700}th,td{padding:10px 13px;border-bottom:1px solid #e2e8e2;vertical-align:top}.pass{color:#237950;font-weight:700}.fail{color:#b52e32;font-weight:700}.facts{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.facts span{font-size:13px;background:#f0f3f0;border-radius:6px;padding:4px 10px}.findings{padding-left:23px;margin:20px 0}.findings li{padding:4px 0}.visual-grid,.details-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px;align-items:start}figure{margin:0;background:#f8faf8;border:1px solid #e0e7e0;border-radius:10px;overflow:hidden}figure img,figure svg{display:block;width:100%;height:auto}figcaption{font-size:13px;color:#53675e;padding:12px 16px;line-height:1.6}.controls{display:flex;gap:20px;flex-wrap:wrap;background:#eaf0eb;padding:12px 18px;border-radius:9px;margin:22px 0;font-size:14px}.controls input{accent-color:#306f55}.zone-layer,.wall-layer{display:none}.show-zones .zone-layer,.show-walls .wall-layer{display:block}.hide-probes .probe-layer{display:none}.small{font-size:13px;color:#5d6c64;line-height:1.6}.method{margin:32px 0;padding:24px;background:#e9eeea;border-radius:12px}.method p{margin:8px 0}code{font-size:13px;background:#f2f5f2;padding:2px 5px;border-radius:4px}footer{color:#6b786f;font-size:13px;margin-top:28px}
@media(max-width:900px){main{padding:24px 16px}h1{font-size:27px}.visual-grid,.details-grid{grid-template-columns:1fr}section{padding:20px 16px}.section-head{display:block}.scene-link{display:inline-block;margin-top:14px}th,td{padding:8px;font-size:12px}}
@media print{body{background:white}main{padding:0}section{break-before:page;border:0;padding:0}.controls,nav,.scene-link{display:none}.visual-grid{grid-template-columns:1fr 1fr}.details-grid{display:block}table{font-size:11px}.show-zones .zone-layer{display:block}}
</style><main><p class="eyebrow">PASCAL EDITOR · LOCAL QA · 2026-10-01</p><h1>아파트 자동 모델링<br>2D 공간 완결성 검수</h1><p class="lead">서로 다른 단지 3곳을 새로 분석하고 별도 검수 장면에서 직접 자동 생성했습니다. 원본 도면의 의미 공간과 저장된 존을 대조하고, 실제 벽 두께·개구부 호스트를 포함한 연결성을 검사했습니다.</p><div class="verdict"><strong>공간 완결성 통과 0 / 3</strong><br>존 생성과 저장은 성공했으나 공간 병합·오분할, 벽 호스트 누락, 도면에 없는 통로 차단이 남아 있습니다. 독립 기준점 36개 중 31개가 올바른 이름·용도의 존에 대응했습니다.</div><nav><a href="#jangjeon">래미안장전</a><a href="#haeundae">해운대자이2차</a><a href="#hwmyeong">화명롯데캐슬카이저</a><a href="#method">검수 방법·한계</a></nav><table><thead><tr><th>단지·도면</th><th>원본 공간 / 생성 존</th><th>공간 용도 일치</th><th>미접합 끝점</th><th>외부 연결 기준점</th><th>완결성</th></tr></thead><tbody>'''
document+=''.join(summary_rows)+'''</tbody></table><div class="controls"><label><input type="checkbox" id="zones"> 원본 위에 저장된 존 경계 표시</label><label><input type="checkbox" id="walls"> 원본 위에 모델 벽 중심선·미접합 끝점 표시</label><label><input type="checkbox" id="probes" checked> 독립 공간 기준점·누락 구간 표시</label></div>'''
document+=''.join(sections)+'''<div class="method" id="method"><h3>검수 방법과 판정 범위</h3><p>같은 단지의 평형만 바꾸지 않고 서로 다른 단지 3곳을 골랐습니다. 기존 수정 도면인 더샵센트럴스타는 이번 표본에 포함하지 않았습니다. 원본의 침실·욕실·거실·부엌·현관·드레스룸·발코니를 육안으로 판독한 뒤 10 / 12 / 14개의 기준점을 지정했습니다. 기준점은 자동 출력에서 가져오지 않았습니다.</p><p>세 분석 API를 refresh=1로 새로 실행했습니다. 분석 시간은 래미안장전 20.33초, 해운대자이2차 16.57초, 화명롯데캐슬 20.73초입니다. 편집기에서 아파트 검색 → 지정 평형 → 자동 모델링을 직접 클릭하고, 2D 모드로 원본을 겹쳐 검수했습니다. 저장된 장면의 존·벽·개구부를 API로 다시 읽었습니다.</p><p>원본–모델 좌표계는 참조 이미지의 크기·배율·원점으로 검증했습니다. 존은 이름·용도·독립 기준점의 일대일 대응, 유한 좌표·퇴화·교차, 내부 겹침을 검사했습니다. 폴리곤 자체가 닫힌다는 것만으로 공간의 벽이 완결됐다고 판단하지 않았습니다.</p><p>벽은 실제 두께로 원본 분석 해상도에 그려 4방향 연결을 검사했습니다. 문·창은 벽 내부를 파는 모델이므로 연결 검사에서는 연속 호스트를 포함합니다. 의도된 통로는 누락 벽으로 판정하지 않았고, 도면상 분리되는 문·창 호스트가 사라져 방과 다른 공간이 합쳐지는 경우를 따로 검사했습니다. 미접합 끝점은 인접 벽들의 실제 두께를 제외한 틈이 2cm를 넘는 후보이며, 원본 대조 결과로 해석했습니다.</p><p>공간 기준점 통과는 전체 폴리곤 경계의 정확도를 보장하지 않습니다. 이번 검수는 이미 확인한 실패를 근거로 미통과 판정을 내리는 것이며, 다른 도면에 대한 통과율이나 실측 치수 정확도를 일반화하지 않습니다. 브라우저 오류는 세 장면 모두 0건이었으며, 문제가 없는 것은 렌더링·저장 경로이지 공간 인식 결과가 아닙니다.</p><p><strong>후속 수정 우선순위:</strong> ① 외곽·문/창 호스트의 공간 폐합 ② 호스트 병합이 열린 복도를 가로막는 경우 차단 ③ OCR 명칭과 용도 분류의 충돌 해소 ④ 열린 거실·부엌의 의미 존 구분과 작은 가짜 존 제거.</p><p class="small">재실행: <code>.omx/recovery-20260929/data/.venv312/bin/python .omo/evidence/apartment-completeness-20261001/verify-completeness.py</code><br>현재 결과는 검수 실패를 뜻하는 종료 코드 1입니다. 장면·도면 JSON, 독립 fixture.json, audit.json, 2D 화면, 브라우저 오류 기록을 같은 폴더에 보관했습니다.</p></div><footer>검수 수행: Codex root 직접 수행. 제품 코드 변경·수동 모델 보정 없이 현재 자동 생성 로직을 검증했습니다. 기존 사용자 장면은 변경하지 않았습니다. 이 파일은 모든 도면·스크린샷을 포함하는 독립 HTML 보고서입니다.</footer></main><script>document.getElementById('zones').addEventListener('change',e=>document.body.classList.toggle('show-zones',e.target.checked));document.getElementById('walls').addEventListener('change',e=>document.body.classList.toggle('show-walls',e.target.checked));document.getElementById('probes').addEventListener('change',e=>document.body.classList.toggle('hide-probes',!e.target.checked));</script></html>'''
(root/'report.html').write_text(document)
assert document.count('data:image/jpeg;base64,')==6
assert len(reports)==3 and sum(r['roomProbesTotal'] for r in reports)==36
assert sum(r['roomProbesPassed'] for r in reports)==31
print('PASS standalone report: 3 cases, 6 embedded images, 36 independent probes; 31 matched')

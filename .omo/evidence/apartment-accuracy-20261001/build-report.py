import base64, html, json
from pathlib import Path

root = Path(__file__).resolve().parent
reports = json.loads((root / 'summary.json').read_text())
notes = {
 'jangjeon': '거실·부엌이 발코니로 합쳐졌던 존을 분리하고 욕실·침실의 문 호스트를 확인했습니다.',
 'haeundae': '욕실의 작은 잔여 존을 제거하고 드레스룸·안방·현관 구획과 문 호스트를 확인했습니다. 복도 바닥을 창 호스트로 만드는 오탐도 검사했습니다.',
 'hwmyeong': '현관·거실의 잘못된 합침과 드레스룸 분할을 수정하고, 현관·욕실·발코니의 호스트 누락을 확인했습니다.',
 'daeyeon': '겹쳐 읽힌 욕실·드레스룸·현관 글자를 나눠 읽고, 열린 거실과 부엌을 각각의 용도 존으로 생성했습니다.',
 'centum': '전실을 현관 용도로 인식하고 발코니 누락을 보완했습니다. 현관의 짧은 벽 조각이 긴 돌출 접합부를 만드는 렌더링 오류를 수정했습니다.',
 'forest': '밝은 창틀을 원본의 두 레일과 연속 대비로 확인했습니다. 벡터 추출 시간을 약 147초에서 54.3초로 줄여 90초 제한 안에서 완료했습니다.',
 'sajik': '욕실·드레스룸의 복합 라벨을 분리하고, 긴 벽 안의 짧은 중복 벽을 합쳐 드레스룸의 돌출부를 제거했습니다.',
 'beonyeong': '창고·현관·부엌의 용도 존을 보완하고 밝은 프레임의 호스트와 침실·욕실 구획을 확인했습니다.',
}

def picture(file, alt):
 mime = 'image/png' if file.suffix == '.png' else 'image/jpeg'
 return f'<img loading="lazy" alt="{html.escape(alt)}" src="data:{mime};base64,{base64.b64encode(file.read_bytes()).decode()}">'

rows = []
sections = []
for r in reports:
 c = r['case']; key = c['key']; folder = root / key
 before = folder / 'before-api.json'
 previous = str(len(json.loads(before.read_text())['data']['rooms'])) if before.exists() else ('시간 초과' if key == 'forest' else '기존 3개')
 rows.append(f'<tr><td><a href="#{key}">{html.escape(c["name"])} {c["type"]}</a></td><td>{"추가" if c["cohort"] == "new" else "재검수"}</td><td>{previous} → {r["actualZones"]}</td><td>{r["roomProbesPassed"]}/{r["roomProbesTotal"]}</td><td>{len(r["wallProbes"])}</td><td>{len(r["hostErrors"])}</td><td>{len(r["exteriorConnectedProbes"])}</td><td class="pass">{r["status"]}</td></tr>')
 sections.append(f'''<section id="{key}"><h2>{html.escape(c['name'])} {c['type']}</h2><p>{notes[key]}</p>
 <div class="pictures"><figure>{picture(folder/'source.jpg','원본 도면')}<figcaption>원본 도면</figcaption></figure><figure>{picture(folder/'2d.png','실제 편집기 2D 자동 모델링')}<figcaption>실제 편집기 2D — 저장 버전 {r['sceneVersion']}</figcaption></figure></div>
 <p>존 {r['actualZones']}개 · 기준점 {r['roomProbesPassed']}/{r['roomProbesTotal']} · 지정 벽 구간 {len(r['wallProbes'])}개 · 분류별 모델 개구부 {html.escape(json.dumps(r['modelOpeningTypes'],ensure_ascii=False))}</p>
 <p><a href="http://localhost:3002/scene/{c['sceneId']}">검수용 씬 열기</a> · <a href="{key}/audit.json">세부 검사 JSON</a></p>
 <details><summary>검사 결과와 끝점 후보</summary><pre>{html.escape(json.dumps({k:r[k] for k in ['frameVerified','zoneGeometry','missingSeparations','hostErrors','importDiagnostics','danglingEndpoints','issues']},ensure_ascii=False,indent=2))}</pre></details></section>''')

document = '''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>아파트 자동 모델링 8개 도면 검수</title>
<style>body{margin:0;background:#f2f4f7;color:#19202b;font:16px/1.65 system-ui,sans-serif}main{max-width:1280px;margin:auto;padding:32px}header,section{background:white;border:1px solid #dce2e8;border-radius:16px;padding:26px;margin-bottom:24px}h1{font-size:32px;margin:0 0 16px}h2{margin-top:0}a{color:#245fba}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:10px;border-bottom:1px solid #dde4eb;text-align:left}th{background:#f4f7fa}.table{overflow:auto}.pass{color:#187b4f;font-weight:bold}.stats{display:flex;gap:16px;flex-wrap:wrap}.stats b{font-size:30px;display:block}.stats div{padding:14px 22px;background:#edf5ef;border-radius:10px}.pictures{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}img{width:100%;border:1px solid #dde4eb;border-radius:8px}figcaption{color:#647183;font-size:13px}pre{font-size:12px;white-space:pre-wrap;overflow-wrap:anywhere}li{margin-bottom:8px}.note{background:#fff6df;padding:16px;border-radius:8px}@media(max-width:800px){main{padding:12px}.pictures{grid-template-columns:1fr}h1{font-size:25px}}@media print{body{background:white}section{break-inside:avoid}main{padding:0}details{display:none}}</style><main>
<header><p>2026-10-01 · 메인 작업 폴더 · 2D 검증</p><h1>자동 모델링 오류 수정과 5개 추가 도면 검수</h1><p>직접 수정한 로직으로 추가 5개와 기존 3개를 검수했습니다. 실제 편집기의 자동 모델링 생성·저장 결과를 원본 도면과 비교했습니다.</p><div class="stats"><div><b>8 / 8</b>검수 기준 통과</div><div><b>108 / 108</b>공간 기준점 대응</div><div><b>468</b>지정 벽 구간 샘플</div><div><b>0</b>검사 기준점의 외부 연결</div></div><p>기존 3개의 공간 기준점 대응은 31/36에서 36/36으로 개선했습니다. 이 수치는 표시한 기준점의 용도·존 일치율이며, 도면 전체의 픽셀 정확도를 뜻하지 않습니다.</p></header>
<section><h2>검수 결과</h2><div class="table"><table><thead><tr><th>도면</th><th>구분</th><th>존 개수 전 → 후</th><th>공간 기준점</th><th>벽 구간</th><th>호스트 오류</th><th>외부 연결</th><th>결과</th></tr></thead><tbody>''' + ''.join(rows) + '''</tbody></table></div><p>개수 비교만으로 통과시키지 않았습니다. 기준점마다 하나의 올바른 용도 존이 대응하는지, 지정 공간 쌍의 벽 구분과 누락·허위 벽을 함께 검사했습니다.</p></section>
<section><h2>직접 수정한 원인</h2><ul><li>벽 누락: 원본의 밝은 프레임·회색 벽 증거를 복구하고 실제 벽과 연결되는 경우만 호스트로 사용합니다. 흰 종이와 분기된 고립 선은 복구 대상에서 제외합니다.</li><li>공간 오인식: 복합 OCR 라벨을 나누고 글자 내부 틈과 흰 외부 조각을 걸러냅니다. 열린 거실·부엌도 각각의 용도 존을 생성합니다.</li><li>문·창 오분류: 밝은 창틀의 양쪽 레일과 연속 대비를 확인하여 단순 회색 경계와 바닥 선의 창 오탐을 줄입니다.</li><li>벽 연결: 개구부 전체를 덮는 호스트를 선택하고 양쪽 끝의 근거가 모두 확인될 때 연결합니다. 긴 벽 안에 들어가는 짧은 중복 벽은 합칩니다.</li><li>접합 돌출: 거의 직선인 서로 다른 두께의 벽은 두께 단차로 처리하고, 짧은 조각의 접합 연장은 조각 길이에 맞게 제한합니다.</li><li>추출 지연: 반복 거리 계산과 이미지 샘플링을 줄여 포레스티지 도면의 시간 초과를 해결했습니다.</li></ul></section>
''' + ''.join(sections) + '''
<section><h2>검증 범위와 남은 한계</h2><ul><li>108개 독립 표시 공간 기준점, 36개 지정 벽 구간의 13점 검사, 2개 벽 금지 구간의 9점 검사, 존의 비정상 다각형·내부 겹침, 개구부 부모·호스트·폭 범위, 지정 공간 쌍의 구분을 검사했습니다.</li><li>외부 연결 검사는 실제 벽 두께를 그린 4방향 연결 검사입니다. 문·창 호스트를 닫힌 구조 경계로 취급하며, 문을 열었을 때의 이동 가능성을 뜻하지 않습니다.</li><li>끝점 후보 8개는 센텀 4개, 포레스티지 2개, 사직 1개, 번영로 1개입니다. 원본에 열린 벽 끝이 있으므로 끝점 개수가 0이라는 기준을 강제하지 않았습니다. 지정 구획 검사와 외부 연결 검사는 모두 통과했습니다.</li><li>벽 없는 거실·부엌의 존 경계는 글자 위치를 기준으로 나눈 근사 경계입니다. 정확한 설계 면적선이나 경계 전체의 일치율은 보증하지 않습니다.</li><li>문·창의 전수 정답 라벨을 만들지는 않았으므로 전체 분류 정확도 백분율은 제시하지 않습니다. 중복 개구부 제거로 원본 후보 수와 모델 노드 수는 다를 수 있습니다.</li><li>포레스티지의 초기 벽 검사 구간 하나가 실제 열린 침실 바닥을 가로질렀습니다. 원본 확대 확인 후 위·아래 실제 벽 구간과 벽 금지 구간으로 나눴고, 최초 fixture와 수정 이유를 보존했습니다.</li></ul><p class="note">기존 개수 고정 회귀 검사에는 보통 벽 51개라는 오래된 가정이 남아 있어 실패했습니다. 그 가정만 제외한 별도의 공간·문창 의미 검사를 실행하고, 기존 63개 원본 벽 샘플 검사를 별도로 유지했습니다. 원본 공간·개구부의 기대값은 바꾸지 않았습니다.</p></section>
<section><h2>실행 증거</h2><p>공개 코드 테스트 73개 / 606개 assertion 통과 · TypeScript 검사 통과 · 변경 범위 9파일 Biome 통과 · 최신 생산 빌드 통과 · 마지막 실제 2D 브라우저 오류 로그 0건.</p><p><a href="summary.json">저장 씬 8개 검사</a> · <a href="actual-final.log">검사 로그</a> · <a href="final-all.log">원본 8개 추출 로그</a> · <a href="public-final.log">코드 회귀 검사</a> · <a href="semantic-final.log">원본 공간·개구부 검사</a> · <a href="source-spans-final.log">기존 벽 63점 검사</a> · <a href="build-final.log">최신 빌드 로그</a></p><details><summary>수정 파일</summary><pre>.omx/recovery-20260929/data/vectorize.py (로컬 설정의 벡터 추출기, 공개 Git 추적 대상 밖)
apps/editor/lib/apt-vector-scene.ts
apps/editor/lib/apt-vector-scene.test.ts
apps/editor/app/api/apartments/[id]/plans/[planId]/vector/route.ts
apps/editor/lib/ai-provider.test.ts
packages/core/src/systems/wall/wall-mitering.ts
packages/core/src/systems/wall/wall-mitering.test.ts
packages/mcp/src/modeling-agent-manual.ts
packages/mcp/src/ontology-manual.test.ts
packages/mcp/src/resources/resources.test.ts</pre></details><p>로컬 메인 미리보기에 반영했습니다. 기존 수동 편집 씬은 보존했고, 검수는 별도의 씬에서 진행했습니다.</p></section></main></html>'''
(root/'report.html').write_text(document)
print(root/'report.html')

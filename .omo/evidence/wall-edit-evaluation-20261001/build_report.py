import base64,json,math
from pathlib import Path
from html import escape
p=Path(__file__).resolve().parent

def img(name,caption):
 data=base64.b64encode((p/name).read_bytes()).decode()
 return '<figure><img src="data:image/png;base64,'+data+'"><figcaption>'+caption+'</figcaption></figure>'
rows=[
('벽 추가·연속 그리기','통과','빈 씬에서 두 벽을 연속 생성하고 Escape로 다음 그리기를 종료.'),
('공유 끝점 드래그','통과','두 벽의 공유 끝점을 이동하면 연결된 벽도 함께 이동. 저장 좌표가 동일.'),
('숫자로 길이 수정','실패','12.828m → 10m 입력 시 선택한 벽만 줄어 연결된 벽과 2.828m 틈 발생.'),
('높이·두께 수정','통과','3000mm 높이·150mm 두께 입력 및 저장값 반영. 높이의 3D 형상은 이번 검수 범위 밖.'),
('벽 분리·합치기','조건부 통과','6000mm 위치 분리 후 다시 합쳐 원래 길이 복원. 속성 패널을 접어야 분리 UI 접근 가능.'),
('개구부를 가르는 분리','통과','창문 중앙에서 분리를 시도하면 거부. 오류 문구는 영어 내부 ID를 노출.'),
('개구부 호스트 축소','실패','7.412m 벽을 500mm로 축소해도 창문 2개가 기존 위치에 남아 호스트 범위 이탈.'),
('벽 삭제·개구부 정리','통과','실내 벽 1개 삭제 시 문 1개·창 1개 함께 제거. 창문 벽 삭제 시 창문 2개 함께 제거.'),
('실행 취소·다시 실행','통과','기본 벽 길이·분리·합치기 되돌리기/재실행 확인. 아파트 삭제 후 벽·문·창 복원 및 저장 데이터 일치.'),
('벽 편집 후 존 동기화','실패','방 경계 벽 삭제로 바닥/천장 구획 9개 → 7개. 존 13개의 전체 데이터는 변경 없이 유지.')]
tr=''.join('<tr><td>'+escape(a)+'</td><td class="'+('bad' if b=='실패' else 'ok' if b=='통과' else 'warn')+'">'+b+'</td><td>'+escape(c)+'</td></tr>' for a,b,c in rows)
html='''<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>벽 편집 2D 평가</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f4ef;color:#222;font:16px/1.65 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif}main{max-width:1100px;margin:auto;padding:40px 24px}h1{font-size:34px;line-height:1.25}h2{margin-top:40px}header,panel,section{display:block}header{background:#fff;padding:28px;border-radius:16px;border-top:6px solid #a93825}small{color:#626262}nav{display:flex;gap:20px;flex-wrap:wrap;margin:24px 0}a{color:#23648b}table{width:100%;border-collapse:collapse;background:white}th,td{text-align:left;padding:14px;border-bottom:1px solid #ddd;vertical-align:top}th{background:#ecebe5}td:first-child{min-width:165px}td:nth-child(2){white-space:nowrap;font-weight:700}.bad{color:#ae3122}.ok{color:#287346}.warn{color:#926316}figure{margin:24px 0;background:white;border:1px solid #ddd;border-radius:12px;overflow:hidden}img{width:100%;display:block}figcaption{padding:16px;color:#444}code{font-size:13px;overflow-wrap:anywhere}li{margin:9px 0}@media(max-width:600px){main{padding:20px 12px}h1{font-size:27px}table{font-size:13px}th,td{padding:9px}td:first-child{min-width:95px}}@media print{body{background:white}main{padding:0}nav{display:none}figure,tr{break-inside:avoid}}
</style><main><header><small>2026-10-01 · localhost:3002 · 직접 2D 실사용 검수</small><h1>기본 벽 편집은 가능하지만,<br>공간 완결성을 유지하는 편집은 미달</h1><p>벽 추가·삭제와 기본 실행 취소는 동작합니다. 숫자 길이 변경이 벽 연결과 개구부의 유효 범위를 보장하지 않으며, 벽 편집 후 존 경계가 갱신되지 않습니다. 정확한 공간 구획을 유지하려면 이 세 동작을 먼저 보완해야 합니다.</p><small>검수용 빈 씬과 번영로센텀파크에일린의뜰 81㎡ 복사 씬에서 확인. 사용자 원본 씬은 편집하지 않았습니다. 이번 평가에서 앱 코드는 변경하지 않았습니다.</small></header><nav><a href="#matrix">동작별 결과</a><a href="#issues">수정 우선순위</a><a href="#evidence">화면 증거</a><a href="#checks">검증 범위</a></nav><section id="matrix"><h2>동작별 결과</h2><table><thead><tr><th>동작</th><th>평가</th><th>실제 결과</th></tr></thead><tbody>'''+tr+'''</tbody></table></section><section id="issues"><h2>수정 우선순위</h2><ol><li><b>P1 · 숫자 길이 변경에서도 연결 유지.</b> 속성 패널은 선택 벽의 end만 갱신합니다. 드래그와 동일한 연결 처리 규칙을 적용해야 합니다. <code>packages/nodes/src/wall/panel.tsx:174–199</code></li><li><b>P1 · 문·창이 있는 벽의 길이 변경 검증.</b> 변경을 거부하거나 유효 범위 내 재배치 규칙을 적용해야 합니다. 저장된 호스트 범위 초과 2개를 확인했습니다.</li><li><b>P1 · 벽 편집 결과와 존 경계의 일치.</b> 자동 바닥/천장 구획은 갱신되지만 존은 그대로 남습니다. 자동 갱신 또는 불일치 안내와 재계산 동작이 필요합니다.</li><li><b>P2 · 분리 조작 UI의 겹침 해소.</b> 속성 패널 z-50이 분리 도우미 z-40을 가립니다. 현재는 패널을 접어야 접근할 수 있습니다. <code>panel-wrapper.tsx:217 / contextual-helper-panel.tsx:37</code></li></ol></section><section id="evidence"><h2>화면 증거</h2>'''
html+=img('03-length-breaks-join.png','① 길이 10000mm 입력 후 두 벽 사이 접합부가 끊어짐. 저장 좌표 기준 간격 2.828m. 우측 속성 패널이 분리 도우미도 가림.')
html+=img('08-window-host-shrink.png','② 7.412m 창문 호스트 벽을 500mm로 축소. 창문 2개는 벽 범위 밖에 남음. 도면 참조 이미지가 깔려 있어 화면만으로 오류를 놓칠 수 있으므로 저장 좌표도 함께 확인.')
html+=img('11-room-boundary-delete.png','③ 방 경계 벽 삭제 후 문·창도 정리되지만, 기존 존 경계와 면적은 변경되지 않음. 존 13개의 데이터가 삭제 전과 완전히 동일.')
html+=img('15-undo-restored.png','④ 실행 취소 후 아파트 벽·문·창 복원. 기준 상태와 벽 41개·문 8개·창 9개·존 13개의 데이터가 일치.')
html+='''</section><section id="checks"><h2>검증 범위와 증거</h2><p>2D 브라우저 실제 입력·드래그·버튼·단축키 동작과 저장 API의 그래프 데이터를 교차 확인했습니다. 관련 자동 테스트는 <b>39개 통과 / 0개 실패 / 118 assertions</b>입니다. 테스트 통과만으로 숫자 길이 변경·개구부·존 통합 동작까지 보장하지 않는다는 점이 이번 화면 검수에서 확인됐습니다.</p><p>아파트 검수 씬은 최종적으로 기준 벽·문·창·존 상태로 복원했습니다. 화면 조작 중 오류 콘솔 로그는 없었고, scene readiness timeout 경고는 기록됐습니다. 3D 메시, 곡선 벽, 내부 지점에 닿는 T자 접합 편집, 다수 벽 동시 이동, 처리 속도 수치는 이번 평가에서 별도로 검증하지 않았습니다.</p><p><a href="http://localhost:3002/scene/04760d4d358e">빈 씬 편집 검수</a> · <a href="http://localhost:3002/scene/796409ebb6bf">아파트 편집 검수</a></p><p><small>동일 폴더의 03-length-breaks-join.json, 08-window-host-shrink.json, 11-room-boundary-delete.json, 15-undo-restored.json 및 regression.log가 저장 데이터와 테스트 증거입니다.</small></p></section></main></html>'''
(p/'report.html').write_text(html)
print('report saved',len(html))

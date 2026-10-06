# 실제 아파트 도면 검증

Sol/high 검토(`zone_plan`)를 검증 계약으로 채택. Luna/max 역할이 실제 브라우저를 소유한다. 코드 변경 없는 검증이며 사용자 서버와 장면을 보존한다.

- 격리된 localhost:3008, 독립 QA DB와 데이터 캐시 사용. 원본 도면/API v13 자료 그대로 가져온다.
- 실제 3사례를 현재 buildVectorNodes/공간 탐지/경계 진단으로 분석: 래미안장전89B, 해운대자이2차109A, 화명롯데캐슬카이저177B.
- 주 UI 사례 화명177B: 실제 검색→도면→자동 모델링→2D Zones→20.301mm 열린 점 위치→연결. 벽61/opening21/zone14, closed spaces7→8, issues10→8, safe1→0, hosted window 보존.
- 단일 Undo/Redo와 저장·재열기에서 endpoint, host, Zone ID/status/provenance 정확 복원. 마커 클릭으로 벽 생성 없음.
- 단일 물리 공간의 여러 semantic zones는 원본을 보존하고 이름이 있는 검토 필요 상태를 유지. 모든 Zone이 닫혔다고 주장하지 않는다.
- 브라우저 스크린샷/AX/콘솔과 저장 graph를 증거로 수집. 실제 원본 source와 markers 비교. 격리 장면은 검토용으로 유지하거나 증거 후 정리한다.

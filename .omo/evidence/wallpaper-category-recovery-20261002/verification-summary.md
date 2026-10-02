# 벽지 분류 복구 — 운영 검증 완료

- 복구 대상: LX Z:IN(LX지인) 30개, 서울벽지 30개, categoryId 108.
- 공개 운영 카탈로그: 벽지 950 → 1,010개. production-api.json 전체 페이지 확인.
- 제품 목록, 60개 제품 record.list, NDJSON, SQLite category_id/list_json, state list_hash, 편집기 디스크 인덱스 복구.
- 상세 데이터, 자재 정보, 전체 19,161 SQLite 행의 비대상 필드와 60개 실제 이미지 SHA 보존. preservation.json.
- 자동 동기화 스크립트 두 복사본에 수신 단계 정규화. 이미 분류가 있는 제품은 보존.
- 백업: /Volumes/DATABASE/macodi-material-clone/state/wallpaper-category-recovery/20261002T084614Z (68개 파일).
- 동일 apt-subdomain 빌드 FcohPi3uE3mBIRUWgnWRW, 서비스 PID 36944 → 41794, 운영 /apt HTTP 200.
- 실제 Chrome 운영 장면 /scene/8552ea8b9254: 두 브랜드 표시, 각 30개 이미지 모두 로드, 첫 행 4개. 자재 적용/장면 수정 없음.
- 브라우저 오류 없음. 기존 THREE.Clock 사용 중단 예정 경고 1개.
- stdlib 검사: 정규화, 모의 동기화/내보내기, 복구 보존·재실행 멱등성·잠금 가드 통과.
- 앱 소스·배포 빌드 변경 없음; 운영 데이터와 동기화 도구만 수정.

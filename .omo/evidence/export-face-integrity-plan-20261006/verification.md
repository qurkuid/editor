# SketchUp용 DXF 면 무결성 검증 — 2026-10-06

기존 `prepareSceneForExport`의 벽 루트 전용 정합을 벽 소유 하위 메시에 확장했다. 등록된 문/창 등 별도 소유 노드에서는 탐색을 멈춘다. 기존 정합 알고리즘과 DXF 직렬화 형식은 그대로 사용한다.

## 실제 다운로드 비교

사용자 장면을 로컬 검증 DB에 복사하고 Chrome에서 동일한 `설정 → SketchUp용 DXF · 그룹/태그` 버튼을 눌렀다. 원본 장면 저장소는 수정하지 않았다. ZIP의 DXF `BLOCK/3DFACE`를 파싱하여 좌표를 0.0001mm 단위로 비교했다. 각 무방향 모서리에 방향이 반대인 두 삼각형이 연결되어야 닫힌 면으로 판정했다.

| 항목 | 수정 전 | 수정 후 |
|---|---:|---:|
| 벽 블록 | 42 | 42 |
| 닫힌 벽 | 0 | 42 |
| 연결 개수/방향이 잘못된 모서리 | 2,134 | 0 |
| 퇴화 삼각형 | 0 | 0 |

수정 전 ZIP SHA256: `2c4aa65f8ad1e46db2e770f1a8e0b9e5c8036285047e1e1b6d87c72201bdca88`

수정 후 ZIP SHA256: `47a3bfcf5844263b3e1ee65f98966ba3e0fe597bdaba0439a1c56edfe6ac1952`

다운로드 원본, 장면 JSON과 로컬 DB는 커밋하지 않는다. 같은 장면의 실제 CSG 생성 과정은 `replay.ts`와 검토된 기하 통계 `replay.json`에 기록했다.

## 실행 결과

- GLB/벽 topology/DXF/STL/SketchUp wall contract/존 도면 테스트: 48 pass, 0 fail, 4,658 assertions.
- `bun run --cwd packages/editor check-types`: exit 0.
- `bun run --cwd apps/editor check-types`: exit 0.
- 변경 소스/테스트 4개 Biome: 통과.
- `bun run --cwd apps/editor build`: exit 0. 별도 타입 검사도 통과했다.

## 검증 한계

SketchUp 네이티브 앱 제어 서비스의 연결 실패로 실제 SketchUp 가져오기와 면 선택은 검증하지 못했다. 작은 모서리에 대한 importer 동작은 남은 확인 항목이다. 로컬 Chrome에는 수정 전부터 WebGPU vertex-buffer 오류가 있었으며, DXF 다운로드와 topology 검증은 성공했다. 운영 배포는 이번 커밋·푸시 요청에 포함하지 않았다.

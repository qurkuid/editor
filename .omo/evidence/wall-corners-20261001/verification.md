# 모서리 벽 조각 수정 검증

- 운영 모델: https://apt.intm.kr/scene/8552ea8b9254
- 운영 소스 커밋: `42ee6342a10464f2ad9598a90ede3c34c7db1fa8`
- 원격 브랜치 최신 커밋: `7273f87110c4e6cfc3c4b8ee7df282e13bc90860`. 운영 커밋 이후 변경은 MCP 가이드 노출 테스트의 검증문 4개뿐이다.
- 운영 BUILD_ID: `s4bMeqvfAzTtsDfzVnvj5`, PM2 `apt-subdomain` online, PID 64305.
- 서버와 공개 import 번들 SHA256 일치: `e0353e71bd91bf58ce1191047a22a24406a81e27c5df053a04e447a56872cea4`.

## 수정

벽 두께가 겹치는 모서리 접점들을 묶어 중복 분할을 방지했다. 끝부분의 겹침은 실제 공통 접점까지 정리하며, 문·창 위치와 원래 필요한 짧은 벽은 보호한다. 양 끝이 같은 접점 묶음에 포함된 벽은 유지한다. 사용자가 직접 실행하는 접점 분리는 유지한다.

변경 파일: `apps/editor/lib/apt-vector-scene.ts`, 해당 테스트, `apps/editor/lib/ai-contract.test.ts`, `packages/mcp/src/modeling-agent-manual.ts`, `packages/mcp/src/ontology-manual.test.ts`, `packages/mcp/src/resources/resources.test.ts`.

## 증거

- 센텀리슈빌 113C 운영 UI에서 새 자동 모델링 실행: 벽 65→51개, 120mm 미만 조각 14→0개.
- 문·창 16개, 존 12개 유지. 자동 존 9개의 최종 벽 기반 경계 오차 0m. 나머지 수동 존 3개 유지.
- 로컬 문·창의 세계 좌표와 폭 유지, 부모/자식 연결 유효, 실행 취소 및 재실행의 전체 그래프 일치 확인.
- 범위 격리 테스트 102개 통과. 후속 MCP resource 테스트 11개 통과. 타입 검사, Biome, 프로덕션 빌드 통과.
- 운영 2D/3D 화면 확인, 수집된 운영 console error 없음.
- 두 커밋의 GitHub Actions 조회 결과는 빈 목록이므로 CI 성공으로 주장하지 않는다.

원본 사용자 모델은 변경하지 않았다. 이 생성 로직은 새 자동 모델링에 적용된다. 기존 모델을 반영하려면 자동 모델링을 다시 실행해야 한다.

관련 원본 증거: `production-scene.json`, `production-zones.json`, `runtime-proof.txt`, `release-tests-final.log`, `release-types-final.log`, `release-build-final.log`, `guide-resource-final.log`, `production-zone-corners-2d.png`, `production-corners-3d.png`.

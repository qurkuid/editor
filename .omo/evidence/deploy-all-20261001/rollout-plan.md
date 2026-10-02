# 전체 배포 완료

- 소스/원격: 33d05e5b3cf1641f5b47e0f1126fc97a50efb72e · qurkuid/editor deploy/floorplan
- 운영: https://apt.intm.kr · apt-subdomain :3024
- 런타임: /Volumes/DATABASE/floorplan-releases/20261001-33d05e5b/apps/editor
- BUILD_ID: 4KVOp6H___JQLAJQVjd4f
- 추출기: docVersion 13, 소스/운영 해시 일치
- 서버 백업: /Volumes/DATABASE/floorplan-deploy-backups/20261001-33d05e5b

기존 PM2 reload가 이전 실행 경로를 유지하여, apt-subdomain만 새 릴리스 구성으로 재등록하고 pm2 save 했습니다. 다른 앱은 변경하지 않았습니다.

8개 fresh 공개 API, 공개 JS 해시, 운영 2D 벽 추가/드래그/스냅/분리/합치기/삭제/Undo/새로고침 저장을 확인했습니다.

롤백은 백업 경로의 ecosystem-previous.config.cjs 및 vectorize-before.py를 사용합니다. 운영 DB 복원은 이후 변경 손실을 평가한 경우에만 수행합니다.

#!/usr/bin/env bash
set -euo pipefail

# CI 전용 격리 DB 사슬. 운영 주소를 받지 않고 이 프로세스가 띄운 Postgres만 쓴다.
pg_user=soran
pg_host=127.0.0.1
pg_port=54329
pg_db=soran_test
container=soran-stage-pg

cleanup() {
  docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT

DATABASE_URL="postgresql://${pg_user}@${pg_host}:${pg_port}/${pg_db}"
echo "::add-mask::$DATABASE_URL"
export DATABASE_URL
export DIRECT_URL="$DATABASE_URL"
export SORAN_ISOLATED_DB=yes-throwaway

cleanup
docker run -d --name "$container" -p "${pg_host}:${pg_port}:5432" \
  -e POSTGRES_USER="$pg_user" -e POSTGRES_DB="$pg_db" \
  -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17 >/dev/null

ready=0
for _ in $(seq 1 60); do
  if docker exec "$container" pg_isready -U "$pg_user" -d "$pg_db" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  echo 'isolated Postgres did not become ready'
  exit 1
fi

if ! npx prisma migrate deploy >/tmp/d100-ci-migrate.log 2>&1; then
  echo 'isolated DB migration failed (log omitted because it contains the address)'
  exit 1
fi

npm run stage:db-check
npm run stage:preflight-window-check
npm run stage:preflight-window-mutation
npm run ops:loop-db-check
npm run stage:evidence-db-check
npm run stage:proof-day-db-check
npm run auto-ready:db-check
npm run auto-ready:evidence-db-check
npm run auto-ready:quality-db-check
npm run publish:slot-db-check
npm run publish:heartbeat-db-check
npm run supply:stock-parity-db-check
npm run publish:lane-fairness-db-check
npm run supply:wip-contract-db-check
npm run supply:draft-deferral-e2e-db-check
npm run check:draft-life-gates-db
npm run auto-ready:audit-db-check
npm run auto-ready:audit-day-db-check
npm run auto-ready:defect-resolution-db-check
npm run check:comment-thread-db
npm run persona:comment-loop-db-check
npm run persona:followup-db-check
npm run persona:autogen-db-check
npm run persona:creative-db-check
npm run persona:remediation-db-check
npm run check:post-exposure-db
# 어드민 게시판 변경 — 자동 운영 글(Persona · Micro Seed · 오리지널 큐) · 열린 Persona 후보 차단과
# 자동 운영 기록 write 0 을 실제 트랜잭션으로 잰다. 판정표는 DB 없이 먼저 본다.
npm run check:board-move
npm run board-move:db-check

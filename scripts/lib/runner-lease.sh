#!/bin/sh
# 🔴 러너 공통 lease wrapper — 커널 잠금 fd 를 Node 본체가 **직접** 쥔다 (2026-10-11 Batch A4 P0 재보정)
#
#   /bin/sh scripts/lib/runner-lease.sh <잠금 파일> <lockf 경로> <명령> [인자 ...]
#
#   ① 잠금 파일을 fd 9 로 연다
#   ② `lockf -s -t 0 9` 로 그 fd 에 커널 잠금을 건다 — 못 얻으면 75(EX_TEMPFAIL)로 끝난다
#   ③ 표식 env 두 칸(잠금 파일 · fd 번호)을 넣고 인자 배열 그대로 명령을 `exec` 한다
#      → 같은 프로세스가 명령이 된다. fd 9 와 잠금이 그대로 넘어간다. 별도의 lockf 부모는 없다.
#      → 본체가 끝나거나 죽으면(SIGKILL 포함) 커널이 잠금을 푼다.
#
# 🔴 셸 문자열 조립 · eval 0. 인자는 "$@" 그대로 exec 한다. PID · 시각 기반 판정 0.
# 종료 코드 — 64 인자 부족 · 69 lockf 실행 불가 · 73 잠금 파일을 못 엶 · 75 이미 잠김 · 그 밖은 lockf 오류 또는 명령의 코드
set -u
if [ "$#" -lt 3 ]; then exit 64; fi
lock=$1
lockf=$2
shift 2
if [ ! -x "$lockf" ]; then exit 69; fi
exec 9>>"$lock" || exit 73
"$lockf" -s -t 0 9
rc=$?
if [ "$rc" -ne 0 ]; then exit "$rc"; fi
SORAN_RUNNER_LEASE_INNER=$lock
SORAN_RUNNER_LEASE_FD=9
export SORAN_RUNNER_LEASE_INNER SORAN_RUNNER_LEASE_FD
exec "$@"

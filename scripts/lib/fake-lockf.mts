/**
 * 🔴 **시험 전용 lockf 대역 — Linux CI 의 격리 DB e2e 만 쓴다** (2026-10-12 Batch C1)
 *
 *    공급 러너는 live 회차를 커널 lease(`/usr/bin/lockf` · macOS)로만 연다. Ubuntu CI 에는 그 실행 파일이 없어
 *    격리 DB e2e(실제 `supply-process.mts --live`)가 `LEASE_UNAVAILABLE` 로 끝난다(그것이 운영의 fail-closed 다).
 *    이 대역은 util-linux `flock(1)` 로 러너가 **쓰는 두 모양만** 흉내낸다:
 *      · `lockf -s -t 0 <fd>`              — 물려받은 fd 에 flock(2) 배타 잠금(같은 열린 파일이면 다시 얻어도 내 것)
 *      · `lockf -s -n -t 0 <파일> <명령>`  — 관측 probe(파일이 없으면 66 · 잠겨 있으면 75)
 *    잠금을 못 얻으면 75(EX_TEMPFAIL) — 진짜 lockf 와 같은 값이다.
 *
 * 🔴 **운영 경로에서는 쓰이지 않는다.** `supply-lease.supplyLockfPath` 는 가짜 provider 훅의 격리 표식(실제 유료 요청을
 *    보낼 수 없는 프로세스)이 있을 때만 `FAKE_RUNNER_LOCKF` 를 본다. macOS 에서는 대역을 만들지 않는다 — 진짜 lockf 로 돈다.
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { FAKE_LOCKF_ENV } from './supply-lease.mjs'

const SCRIPT = `#!/bin/sh
# 시험 전용 lockf 대역 (Linux · flock(1)) — scripts/lib/fake-lockf.mts
set -u
create=1
while [ "$#" -gt 0 ]; do
  case "$1" in
    -s|-k) shift ;;
    -n) create=0; shift ;;
    -t) shift 2 ;;
    *) break ;;
  esac
done
[ "$#" -ge 1 ] || exit 64
target=$1
shift
case "$target" in
  ''|*[!0-9]*)
    if [ "$create" -eq 0 ] && [ ! -e "$target" ]; then exit 66; fi
    exec flock -n -E 75 -x "$target" "$@" ;;
  *)
    exec flock -n -E 75 -x "$target" ;;
esac
`

/** 🔴 macOS 면 빈 env(진짜 lockf) · 그 밖이면 대역을 `dir` 에 쓰고 그 경로를 env 로 준다 */
export function fakeLockfEnv(dir: string): Record<string, string> {
  if (process.platform === 'darwin') return {}
  const path = join(dir, 'fake-lockf.sh')
  writeFileSync(path, SCRIPT, { mode: 0o755 })
  return { [FAKE_LOCKF_ENV]: path }
}

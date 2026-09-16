/**
 * launchd 진입점의 종료 코드 판정 — **순수 함수다.**
 *
 * 🔴 **왜 함수로 뺐나** (2026-09-15 복구).
 *    옛 `magazine-auto-register-run.mjs` 는 무조건 `process.exit(0)` 이었다.
 *    그래서 `launchctl print` 의 last exit status 가 언제나 0 이었고,
 *    PR 을 못 만든 회차와 정상 회차가 **구분되지 않았다.**
 *    이 판정이 스크립트 최상단에 인라인으로 있으면 회귀 테스트가 붙을 자리가 없다 —
 *    "write 실패인데 exit 0" 이 다시 들어와도 아무도 모른다. 그래서 여기 둔다.
 *
 * 🔴 dry-run 은 예전 그대로 0 이다.
 *    dry-run 의 BLOCKED 는 "오늘 태울 것이 없다" 와 같은 말이라 매일 나온다.
 *    그것으로 launchd 를 붉게 만들면 다음 날 판단이 흐려진다.
 *
 * 🔴 non-zero 는 **기록**이지 재시도 신호가 아니다. KeepAlive 는 넣지 않는다.
 */

/**
 * @param {{write: boolean, spawnError?: unknown, childStatus: number|null}} p
 * @returns {{code: number, reason: string}}
 */
export function exitCodeFor({ write, spawnError = null, childStatus }) {
  if (spawnError) {
    return write
      ? { code: 1, reason: '자식 프로세스를 띄우지 못했다 (write 회차 — launchd 에 실패로 넘긴다)' }
      : { code: 0, reason: '자식 프로세스를 띄우지 못했다 (dry-run — 리포트가 목적이다)' }
  }
  if (childStatus === 0) return { code: 0, reason: '진행 완료' }

  const status = typeof childStatus === 'number' ? childStatus : 1
  return write
    ? { code: status, reason: `BLOCKED 가 있었다 — 자식 종료 코드 ${status} 를 그대로 넘긴다` }
    : { code: 0, reason: `BLOCKED 가 있었다 (dry-run — 매일 나오는 정상 상태라 0 으로 넘긴다, 자식 ${status})` }
}

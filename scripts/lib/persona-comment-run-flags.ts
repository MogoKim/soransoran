/**
 * Queue CLI **모드 판정** — 🔴 순수 함수. argv 만 본다
 *
 * 🔴 스크립트 안에 `if` 로 두면 fixture 가 볼 수 없다. 플래그 조합이 계약이라면
 *    계약도 함수여야 한다 — 그래야 뒤집혔을 때 검사가 깨진다.
 */
export type QueueRunMode = 'inspect' | 'call' | 'call+apply'

export type QueueFlags = {
  ok: boolean
  mode: QueueRunMode
  /** provider 를 부를 수 있는가 */
  providerAllowed: boolean
  /** DB write 를 할 수 있는가 — 🔴 그래도 상한은 1건이다 */
  writeAllowed: boolean
  reason: string
}

/**
 * 🔴 **`--apply` 단독은 실패다.** 부르지 않고 적재할 후보 텍스트가 없다 —
 *    "적재만 해 달라" 는 요청은 성립하지 않으므로 조용히 dry-run 으로 낮추지 않고 막는다.
 */
export function judgeQueueFlags(argv: readonly string[]): QueueFlags {
  const call = argv.includes('--call')
  const apply = argv.includes('--apply')
  if (apply && !call) {
    return {
      ok: false, mode: 'inspect', providerAllowed: false, writeAllowed: false,
      reason: '--apply 는 --call 과 함께 써야 한다 — 부르지 않고 적재할 후보가 없다',
    }
  }
  if (apply) {
    return {
      ok: true, mode: 'call+apply', providerAllowed: true, writeAllowed: true,
      reason: 'provider 호출 · PENDING 최대 1건',
    }
  }
  if (call) {
    return {
      ok: true, mode: 'call', providerAllowed: true, writeAllowed: false,
      reason: 'provider 호출 · 🔴 DB write 0',
    }
  }
  return {
    ok: true, mode: 'inspect', providerAllowed: false, writeAllowed: false,
    reason: '대상 계산만 — 🔴 provider 0 · DB write 0',
  }
}

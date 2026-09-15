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

export type RunLimitVerdict =
  | { ok: true; value: number | null }
  | { ok: false; reason: string }

/**
 * 🔴 **이 회차에 몇 건까지 할 것인가** — `--run-limit=N` (2026-09-15).
 *
 * 🔴 **왜 필요한가.** 이 명령은 회차 상한을 예산에서 바로 가져온다. 그래서
 *    "한 건만 만들어 보자" 는 회차가 없다 — 실측(2026-09-15)에서 `--call --apply` 는
 *    **provider 5회 · 다른 글 4편 적재**로 이어졌다. 승인이 1건인데 명령이 5건이면
 *    사람이 할 수 있는 선택은 "전부" 아니면 "안 함" 뿐이다.
 *
 * 🔴 **줄이기만 한다.** 예산·일일 cap·역할 분산·대상 우선순위를 건드리지 않는다.
 *    생략하면 기존 동작 그대로다(`null`).
 *
 * 🔴 **정수 1 이상만 받는다.** `0`·음수·소수·문자는 **부르기도 쓰기도 전에** 막는다 —
 *    `0` 을 허용하면 "부르지 않는 회차" 가 두 가지 뜻이 되고, 소수는 조용히 잘린다.
 *
 * 🔴 `max` 를 주면 그 위도 막는다. 회차 상한은 예산에서 나오므로 그 값을 알게 된 뒤
 *    한 번 더 부른다 — **그래도 provider·DB 앞이다.**
 */
export function judgeRunLimit(argv: readonly string[], max: number | null = null): RunLimitVerdict {
  const found = argv.filter((a) => a === '--run-limit' || a.startsWith('--run-limit='))
  if (found.length === 0) return { ok: true, value: null }
  if (found.length > 1) {
    return { ok: false, reason: '--run-limit 이 두 번 넘어왔다 — 어느 것이 뜻인지 모른다' }
  }
  const raw = found[0]!.startsWith('--run-limit=') ? found[0]!.slice('--run-limit='.length) : ''
  if (raw.trim() === '') {
    return { ok: false, reason: '--run-limit=N 처럼 값을 함께 준다 (N 은 1 이상 정수)' }
  }
  // 🔴 `Number` 로 받고 정수인지 따로 본다 — `parseInt` 는 "1.9" 와 "1abc" 를 1 로 읽는다
  const n = Number(raw)
  if (!Number.isInteger(n)) {
    return { ok: false, reason: `--run-limit=${raw} 는 정수가 아니다 (1 이상 정수만)` }
  }
  if (n < 1) return { ok: false, reason: `--run-limit=${raw} 는 1 보다 작다 (1 이상 정수만)` }
  if (max !== null && n > max) {
    return { ok: false, reason: `--run-limit=${n} 이 이번 회차 상한 ${max} 보다 크다 — 늘리지 않는다` }
  }
  return { ok: true, value: n }
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

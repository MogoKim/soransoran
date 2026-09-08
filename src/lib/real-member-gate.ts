/**
 * 실회원 판별 — 🔴 **단일 정본. 순수 함수다** (2026-09-08)
 *
 * 🔴 왜 떼어냈나.
 *    같은 판정이 배정(`hardFilter`) · 발행(`judgePublish`) · micro-seed 발행(`verifyPublishAuthor`) ·
 *    복구(`recoveryProblemOf`) · persona 수정 스크립트에 흩어져 있었다.
 *    복붙하면 한쪽만 고쳐지는 날이 오고, 그날 남의 이름으로 글이 나간다.
 *
 * 🔴 **정본은 `Account` 다.**
 *    `User.providerId` 는 NextAuth adapter 가 채우지 않는다 —
 *    `src/lib/auth.ts` §signIn 이 *"Account 로 본다"* 고 적어 두었다.
 *    실측(2026-09-08): User 9명 전원 `providerId=null` 인데 Account 3건이었다.
 *    즉 실회원 3명이 있는데 `providerId` 만 보는 가드는 **한 번도 발동한 적이 없었다.**
 *
 * 🔴 **모르면 막는다(fail-closed).** 발행은 되돌릴 수 없다.
 */

export type RealMemberProbe = {
  /**
   * 🔴 **판별 정본** — 그 User 에 연결된 `Account` 행 수.
   *    `undefined` = select 하지 않음 · `null` = 조회했으나 알 수 없음.
   *    둘 다 **막는다** — "검사하지 않은 것" 은 "위반 없음" 이 아니다.
   */
  accountCount: number | null | undefined
  /**
   * 🔴 방어적 보조 — adapter 가 채우지 않지만, 누군가 수동으로 넣어 둔 값은 막아야 한다.
   *    `undefined` 는 select 누락이므로 역시 막는다.
   */
  providerId: string | null | undefined
}

export type RealMemberVerdict =
  | { real: false }
  | { real: true; reason: string; unknown: boolean }

/**
 * 🔴 이 persona/User 를 우리 이름으로 써도 되는가.
 *
 * `real: true` 면 **쓰면 안 된다**. `unknown: true` 는 "실회원이라 확정된 것은 아니지만
 * 확인하지 못했다" 는 뜻이고, 그래도 막는다 — 부르는 쪽이 사유를 구분해 보여줄 수 있게 나눠 둔다.
 */
/**
 * 값을 사람이 읽을 수 있게 — 🔴 `NaN` · `Infinity` 는 이름 그대로 보여야 한다.
 *    `JSON.stringify` 는 셋 다 `null` 로 찍는다.
 */
function describeCount(v: unknown): string {
  if (typeof v === 'number') {
    if (Number.isNaN(v)) return 'NaN'
    if (v === Number.POSITIVE_INFINITY) return 'Infinity'
    if (v === Number.NEGATIVE_INFINITY) return '-Infinity'
    return String(v)
  }
  if (typeof v === 'string') return `"${v}"`
  return String(v)
}

export function judgeRealMember(probe: RealMemberProbe): RealMemberVerdict {
  // ── ① 실측 누락 — 조회하지 않은 채 발행하지 않는다 ──
  if (probe.accountCount === undefined || probe.accountCount === null) {
    return {
      real: true, unknown: true,
      reason: 'Account 수를 실측하지 못했다 (fail-closed) — select 에 _count.accounts 가 필요하다',
    }
  }
  /**
   * 🔴 **DB count 가 될 수 없는 값은 전부 막는다.**
   *    `NaN` · `Infinity` · 음수 · 소수는 조회가 어긋났다는 신호다.
   *    특히 `NaN > 0` 은 `false` 라서, 검사 없이 두면 **조용히 통과한다** —
   *    실회원 여부를 모르는 채로 남의 이름으로 발행하게 된다.
   */
  if (typeof probe.accountCount !== 'number' || !Number.isInteger(probe.accountCount) || probe.accountCount < 0) {
    return {
      real: true, unknown: true,
      // 🔴 `JSON.stringify` 를 쓰지 않는다 — `NaN` · `±Infinity` 를 전부 `null` 로 찍어
      //    "모른다" 와 "조회가 깨졌다" 를 구별할 수 없게 만든다. 사람이 원인을 알아야 고친다
      reason: `Account 수가 유효한 count 가 아니다 (${describeCount(probe.accountCount)}) — 0 이상 정수여야 한다`,
    }
  }
  if (probe.providerId === undefined) {
    return { real: true, unknown: true, reason: 'providerId 를 실측하지 못했다 — select 에 providerId 가 필요하다' }
  }

  // ── ② 실회원 — 로그인 수단이 붙어 있다 ──
  if (probe.accountCount > 0) {
    return { real: true, unknown: false, reason: `Account ${probe.accountCount}건 — 로그인 수단이 붙은 계정이다` }
  }
  // ── ③ 방어적 — adapter 가 안 채울 뿐, 수동으로 넣어 둔 값도 막는다 ──
  if (probe.providerId !== null) {
    return { real: true, unknown: false, reason: 'providerId 가 있다' }
  }

  // 🟢 운영 persona — Account 0 · providerId null
  return { real: false }
}

/** 🔴 짧게 물을 때. 판정은 위 하나뿐이다 */
export function isRealMember(probe: RealMemberProbe): boolean {
  return judgeRealMember(probe).real
}

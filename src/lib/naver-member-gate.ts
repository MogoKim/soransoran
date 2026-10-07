/**
 * 네이버 카페 회원 가입 화면 · 세션 만료 예고 — 🔴 **순수 판정. 네트워크·파일·DB 없음**
 *
 * 🔴 **왜 생겼나 (2026-10-04~07 실측 사고).**
 *    10/3 23:56 에 재발급한 세션은 로그인 쿠키(`NID_AUT`·`NID_SES`)가 유효했지만
 *    두 카페가 그 계정을 회원으로 인정하지 않았다. 회원 전용 글을 열면 본문 자리에
 *    "가입이 필요합니다" 안내가 그려졌고, 수집기는 그것을 본문으로 저장했다.
 *      · 우아한 갱년기 — 12회 연속 공급 0, 안내 속 "체험단" 때문에 광고로 오판(hold)
 *      · 레몬테라스   — 46건이 "본문 244자 · 우리 말" 로 통과(pass), 25건이 유료 판정까지 갔다
 *    회차 기록은 전부 ok 였다. 쿠키 검사는 "로그인 쿠키가 있는가" 만 보고
 *    "카페 글이 실제로 열리는가" 는 보지 않기 때문이다.
 *
 * 🔴 이 파일은 쿠키 **값**을 다루지 않는다. 이름과 만료 시각만 본다.
 */

/**
 * 가입 안내 화면 문구 — 🔴 실측 원문(2026-10-07)에서 뽑았다.
 *    우아한 갱년기형은 "가입이 필요합니다" 없이 "카페에 가입하면 바로…" 로 시작한다.
 */
export const MEMBER_GATE_MARKERS: readonly RegExp[] = [
  /게시물을 확인하기 위해서는 가입이 필요합니다/,
  /이 카페의 멤버가 되어보세요/,
  /카페에 가입하면 바로 글을 볼 수 있어요/,
  // 🔴 두 레이아웃 모두 앞쪽에 있다 — 우아한 갱년기형(206자)은 다른 고정 문구가 맨 앞·맨 뒤에만 있다
  /[\d.,]+만명의 멤버와 함께하는 .{1,80}에 가입해 보세요/,
  /10초 만에 가입하기/,
]

/**
 * 🔴 **문구 둘 이상이어야 가입 화면이다.** 실제 글이 그 문구 하나를 인용할 수 있다.
 *    앞부분만 남은 사본에서도 두 레이아웃 모두 둘 이상이 남는다(실측).
 */
export function isMemberGateText(text: string): boolean {
  const t = text.replace(/\s+/g, ' ')
  return MEMBER_GATE_MARKERS.filter((m) => m.test(t)).length >= 2
}

export type CafeMembership = 'member' | 'nonMember' | 'unknown'

/**
 * 카페 홈 화면 글자 → 회원인가 — 🔴 2026-10-07 실측(두 카페 동일):
 *    회원(저장 세션)은 "카페 글쓰기" 만, 비회원·로그아웃은 "카페 가입하기" 가 보인다.
 *    🔴 가입 버튼이 보이는 한 회원이 아니다. 아무 신호도 없으면 unknown — 회원으로 치지 않는다.
 */
export function judgeCafeMembership(pageText: string): CafeMembership {
  if (pageText.includes('카페 가입하기')) return 'nonMember'
  if (pageText.includes('카페 글쓰기')) return 'member'
  return 'unknown'
}

/** 만료 예고 기준 — 이 날수 안에 만료되는 인증 쿠키가 있으면 알린다 */
export const SESSION_EXPIRY_WARN_DAYS = 7
/** 🔴 `collect-run-record.AUTH_COOKIE_NAMES` 와 같은 이름 — 만료 판정과 예고가 같은 쿠키를 본다 */
const AUTH_NAMES: readonly string[] = ['NID_AUT', 'NID_SES']

export type ExpiryVerdict = {
  warn: boolean
  /** 가장 먼저 만료되는 인증 쿠키 — 만료 시각이 없는(세션) 쿠키는 빼고 센다 */
  soonest: { name: string; expiresAt: string; daysLeft: number } | null
}

export function judgeSessionExpiry(
  cookies: readonly { name: string; expires?: number }[],
  nowMs: number,
  warnDays: number = SESSION_EXPIRY_WARN_DAYS,
): ExpiryVerdict {
  const dated = cookies
    .filter((c) => AUTH_NAMES.includes(c.name) && typeof c.expires === 'number' && c.expires > 0)
    .sort((a, b) => a.expires! - b.expires!)
  const first = dated[0]
  if (first === undefined) return { warn: false, soonest: null }
  const leftMs = first.expires! * 1000 - nowMs
  const daysLeft = Math.floor(leftMs / 86_400_000)
  return {
    warn: leftMs <= warnDays * 86_400_000,
    soonest: { name: first.name, expiresAt: new Date(first.expires! * 1000).toISOString(), daysLeft },
  }
}

/**
 * 🔴 **같은 알림은 하루 한 번.** 회차마다 울리면 소음이 되어 아무도 보지 않는다.
 *    `sent` 는 알림 열쇠 → 마지막으로 보낸 KST 날짜(YYYY-MM-DD).
 */
export function alertDueToday(sent: Readonly<Record<string, string>>, key: string, todayKst: string): boolean {
  return sent[key] !== todayKst
}

/** 알림이 사람에게 시키는 일 — 🔴 회원 여부까지 setup 이 확인한다 */
export const SESSION_REISSUE_COMMAND = 'npm run navercafe:session-setup -- --open'

/**
 * 카페 홈 주소 — 🔴 회원 확인(세션 발급 · 수집 회차 시작)이 같은 주소를 쓴다. 글·목록 주소가 아니다.
 */
export const CAFE_HOME_URL = (cafeId: string): string => `https://cafe.naver.com/${cafeId}`

// ─────────────────────────────────────────────────────────
// 수집 회차 종료 판정 — 🔴 2026-10-07 15:30 실측
//    비밀번호 변경으로 로그아웃된 세션은 쿠키 만료일 검사를 통과했다. 회차는 상세 16건을 열고
//    본문 0건을 얻었는데 `status:ok` 로 끝났다(가입 안내 문구도 없어 MEMBER_GATE 도 못 잡았다).
// ─────────────────────────────────────────────────────────

export type SessionFailureCode = 'MEMBER_GATE' | 'MEMBER_STATUS_UNKNOWN' | 'BODY_EMPTY'

/**
 * 회차 시작 전 카페 홈 판정 → 실패 코드. 🔴 회원이 아니면 상세를 열지 않는다.
 *    unknown 은 회원이 아니다 — 성공으로 진행하지 않고 따로 부른다(원인이 다를 수 있다).
 */
export function membershipFailureCode(m: CafeMembership): SessionFailureCode | null {
  if (m === 'member') return null
  return m === 'nonMember' ? 'MEMBER_GATE' : 'MEMBER_STATUS_UNKNOWN'
}

/**
 * 상세 루프가 끝난 뒤 이 회차가 성공인가 — 🔴 **연 것과 읽은 것은 다르다.**
 *    · 본문 자리에 가입 안내 → MEMBER_GATE
 *    · 상세를 1건 이상 열었는데 본문 0건 → BODY_EMPTY (인증이라고 단정하지 않는다 — 셀렉터·로그아웃·차단 모두 가능)
 *    · 본문이 1건이라도 있으면 부분 성공이다 — 막지 않는다
 *    · 상세를 열지 않은 회차(새 글 없음)는 정상 무작업이다
 */
export function judgeCollectTerminal(input: {
  memberGateId: string | null
  detailRequests: number
  bodyRows: number
}): SessionFailureCode | null {
  if (input.memberGateId !== null) return 'MEMBER_GATE'
  if (input.detailRequests > 0 && input.bodyRows === 0) return 'BODY_EMPTY'
  return null
}

/** 🔴 사람이 구분할 수 있는 알림 — 사유마다 제목과 할 일이 다르다 */
export const SESSION_ALERT: Readonly<Record<SessionFailureCode, { severity: 'BLOCKED'; title: string; why: string }>> = {
  MEMBER_GATE: {
    severity: 'BLOCKED',
    title: '네이버 카페 수집 중단 — 카페 회원으로 인정되지 않음',
    why: '로그인은 됐지만 카페가 이 계정을 회원으로 보지 않는다(가입 안내 · 카페 가입하기)',
  },
  MEMBER_STATUS_UNKNOWN: {
    severity: 'BLOCKED',
    title: '네이버 카페 수집 중단 — 회원 상태 확인 불가',
    why: '카페 홈에서 회원·비회원 신호를 모두 찾지 못했다(로그아웃 · 화면 변경 · 차단 가능)',
  },
  BODY_EMPTY: {
    severity: 'BLOCKED',
    title: '네이버 카페 수집 실패 — 상세를 열었지만 본문 0건',
    why: '글은 열었지만 본문을 하나도 읽지 못했다(로그아웃 · 셀렉터 변경 · 접근 제한 가능)',
  },
}

/**
 * 🔴 **실패 기록이 먼저, 알림은 그 뒤.** 알림 설정이 없거나 전송이 실패해도(던져도)
 *    회차는 이미 failed 로 남아 있고 exit 는 0 이 아니다. 앞판은 알림을 먼저 보냈다.
 */
export async function concludeFailedRun(
  code: SessionFailureCode,
  fx: { finish: (code: SessionFailureCode) => boolean; notify: (code: SessionFailureCode) => Promise<void>; exit: (n: number) => void },
): Promise<{ recorded: boolean; notified: boolean }> {
  const recorded = fx.finish(code)
  let notified = false
  try { await fx.notify(code); notified = true } catch { /* 알림 실패는 회차 결과를 바꾸지 않는다 */ }
  fx.exit(1)
  return { recorded, notified }
}

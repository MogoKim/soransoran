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

#!/usr/bin/env tsx
/**
 * GA4 참여 계측 가드
 *
 * 정본: src/lib/analytics/{events,track,write-auth-marker}.ts
 *
 * 이 검사가 존재하는 이유:
 *   계측은 틀려도 화면이 멀쩡하다. 이벤트가 두 번 나가거나, 실패한 글이 성공으로 세지거나,
 *   보내면 안 되는 값이 하나 섞여도 사용자는 아무것도 못 느낀다.
 *   사람이 알아채는 유일한 순간은 **그 숫자로 판단을 내린 뒤**다. 그래서 기계가 본다.
 *
 * ── 이 검사가 보장하는 것 ──
 *   · 왕복 표식은 한 번만 소비된다 (같은 복원을 두 번 세지 않는다)
 *   · 표식은 30분에 만료되고, 만료된 것은 지워진다
 *   · 게시판이 다르면 표식을 가져가지 않고 **남긴다** (`?board=` 유실 복귀 경로 보호)
 *   · 깨진 값·저장소 차단은 예외를 밖으로 던지지 않는다
 *   · 표식에 담기는 키는 boardSlug·expiresAt 둘뿐이다
 *   · trackEvent 는 gtag 가 없으면 아무 일도 하지 않고, 전송이 던져도 새지 않는다
 *   · send_to 를 붙이지 않는다 (태그가 하나라 config 대상으로 그대로 간다)
 *   · 6종 이벤트가 **허용된 파라미터만** 보낸다 — 금지 키가 하나도 섞이지 않는다
 *   · magazine·best 는 계측 board_slug 로 통과하지 못한다 (아래 @ts-expect-error)
 *
 * ── 🔴 보장하지 못하는 것 (과장하지 않는다) ──
 *   · **이벤트가 실제 화면에서 그 자리에 붙어 있는지는 보지 못한다.** 호출부를 지우면
 *     이 검사는 그대로 통과한다. 그건 Preview 의 gtag 스텁 계수와 Production 의
 *     /g/collect 계수가 본다.
 *   · GA4 콘솔 설정(향상된 측정·맞춤 측정기준·원치 않는 추천)은 저장소 밖이라 보지 못한다.
 *
 * 🔴 DB·네트워크·env 를 건드리지 않는다. 가짜 localStorage 와 가짜 gtag 만 쓴다.
 */
import { COMMUNITY_BOARD_SLUGS, type CommunityBoardSlug } from '../src/lib/board-registry'
import type { SoranEventMap, SoranEventName } from '../src/lib/analytics/events'

// ── 타입 차단 (컴파일 시점) ───────────────────────────────
/**
 * 🔴 아래 @ts-expect-error 들이 이 파일의 절반이다.
 *    타입이 느슨해져 magazine 이 통과하게 되면 "기대한 오류가 없다" 며 tsc 가 실패한다.
 *    즉 이 블록은 npm run typecheck:ops 가 강제한다 — 런타임이 아니라 컴파일이 지킨다.
 */
const typeGuardSamples: string[] = []
{
  const okSlug: CommunityBoardSlug = 'menopause'
  const okSlug2: CommunityBoardSlug = 'free'
  // @ts-expect-error magazine 은 콘텐츠 영역이라 글쓰기·계측 board_slug 로 올 수 없다
  const blockedMagazine: CommunityBoardSlug = 'magazine'
  // @ts-expect-error best 는 모아보기 영역이라 글쓰기·계측 board_slug 로 올 수 없다
  const blockedBest: CommunityBoardSlug = 'best'
  typeGuardSamples.push(okSlug, okSlug2, blockedMagazine, blockedBest)

  const okEvent: SoranEventMap['post_publish'] = { board_slug: 'free' }
  // @ts-expect-error 이벤트 파라미터에도 magazine 이 오면 안 된다
  const badEvent: SoranEventMap['post_publish'] = { board_slug: 'magazine' }
  /* 🔴 한 줄로 적는다. 초과 프로퍼티 오류는 **그 프로퍼티의 위치**에 달리므로
        여러 줄로 쓰면 지시자가 선언 줄만 덮고 title 줄의 오류를 놓친다. */
  const extraKey: SoranEventMap['comment_publish'] =
    // @ts-expect-error 자유 문자열(제목·본문 등)을 실을 자리를 두지 않는다
    { member_type: 'guest', is_reply: false, title: '보내면 안 되는 값' }
  typeGuardSamples.push(okEvent.board_slug, badEvent.board_slug, extraKey.member_type)
}

/** 이벤트 이름이 6종 그대로인지 — 늘거나 줄면 컴파일이 깨진다 */
type ExpectedEventName =
  | 'write_login_prompt'
  | 'write_auth_start'
  | 'sign_up'
  | 'write_draft_restored'
  | 'post_publish'
  | 'comment_publish'
type EventNamesAreExact = [SoranEventName] extends [ExpectedEventName]
  ? [ExpectedEventName] extends [SoranEventName]
    ? true
    : false
  : false
const eventNamesAreExact: EventNamesAreExact = true

// ── 가짜 브라우저 ─────────────────────────────────────────
const store = new Map<string, string>()
let storageBlocked = false

const g = globalThis as unknown as Record<string, unknown>
g.localStorage = {
  getItem: (k: string) => {
    if (storageBlocked) throw new Error('storage blocked')
    return store.has(k) ? store.get(k)! : null
  },
  setItem: (k: string, v: string) => {
    if (storageBlocked) throw new Error('storage blocked')
    store.set(k, v)
  },
  removeItem: (k: string) => {
    if (storageBlocked) throw new Error('storage blocked')
    store.delete(k)
  },
}
g.window = g

type GtagCall = [string, string, Record<string, unknown>]
let calls: GtagCall[] = []
const recordingGtag = (...a: unknown[]) => void calls.push(a as GtagCall)

/* 🔴 import 는 끌어올려진다. 가짜 전역을 먼저 깔아야 모듈이 그것을 본다 */
const marker = await import('../src/lib/analytics/write-auth-marker')
const { trackEvent } = await import('../src/lib/analytics/track')

// ── 검사 ─────────────────────────────────────────────────
const results: Array<[string, boolean]> = []
const check = (why: string, ok: boolean) => void results.push([why, ok])

const NOW = 1_000_000
const reset = () => {
  storageBlocked = false
  store.clear()
  calls = []
  g.gtag = recordingGtag
}

// 1. 표식 — 없으면 못 가져간다 (일반 새로고침 = 이벤트 0건)
reset()
check('표식이 없으면 가져가지 못한다 — 일반 새로고침은 0건', marker.takeWriteAuthMarker('free', NOW) === false)

// 2. 표식 — 한 번만 소비된다
reset()
marker.markWriteAuthStart('free', NOW)
check('심은 표식을 같은 게시판이 가져간다', marker.takeWriteAuthMarker('free', NOW + 1_000) === true)
check('두 번째는 가져가지 못한다 — 1회 소비', marker.takeWriteAuthMarker('free', NOW + 2_000) === false)

// 3. 표식 — 게시판이 다르면 남긴다
reset()
marker.markWriteAuthStart('free', NOW)
check('게시판이 다르면 가져가지 않는다', marker.takeWriteAuthMarker('menopause', NOW + 1_000) === false)
check('  그때 표식은 남아 있다 — 이어서 쓰기 경로 보호', marker.takeWriteAuthMarker('free', NOW + 1_000) === true)

// 4. 표식 — 만료
reset()
marker.markWriteAuthStart('free', NOW)
check(
  '만료 직전은 유효하다',
  marker.takeWriteAuthMarker('free', NOW + marker.WRITE_AUTH_MARKER_TTL_MS - 1) === true,
)
reset()
marker.markWriteAuthStart('free', NOW)
check(
  '만료 시각에 닿으면 가져가지 못한다 (30분)',
  marker.takeWriteAuthMarker('free', NOW + marker.WRITE_AUTH_MARKER_TTL_MS) === false,
)
check('  만료된 표식은 지워진다', store.size === 0)

// 5. 표식 — 담기는 키
reset()
marker.markWriteAuthStart('menopause', NOW)
const stored = JSON.parse([...store.values()][0]!) as Record<string, unknown>
check(
  '표식에 담기는 키는 boardSlug·expiresAt 둘뿐',
  Object.keys(stored).sort().join(',') === 'boardSlug,expiresAt',
)
check('  만료 시각은 심은 때 + 30분', stored.expiresAt === NOW + marker.WRITE_AUTH_MARKER_TTL_MS)

// 6. 표식 — 깨진 값·차단된 저장소
reset()
store.set('soran-write-auth-return', '{{{깨진 값')
check('깨진 값은 없는 것으로 본다', marker.takeWriteAuthMarker('free', NOW) === false)
reset()
store.set('soran-write-auth-return', JSON.stringify({ boardSlug: 'free' }))
check('expiresAt 이 없으면 없는 것으로 본다', marker.takeWriteAuthMarker('free', NOW) === false)
reset()
storageBlocked = true
let markerThrew = false
try {
  marker.markWriteAuthStart('free', NOW)
  marker.takeWriteAuthMarker('free', NOW)
  marker.clearWriteAuthMarker()
} catch {
  markerThrew = true
}
check('저장소가 막혀도 예외를 밖으로 던지지 않는다', markerThrew === false)

// 7. 등록 성공 뒤 표식 정리
reset()
marker.markWriteAuthStart('free', NOW)
marker.clearWriteAuthMarker()
check('clear 하면 남지 않는다 — 글 등록 성공 뒤', store.size === 0)

// 8. trackEvent — gtag 가 없을 때 / 던질 때
reset()
delete g.gtag
trackEvent('post_publish', { board_slug: 'free' })
check('gtag 가 없으면 아무 일도 하지 않는다 — preview 기본값', calls.length === 0)
reset()
g.gtag = () => {
  throw new Error('전송 실패')
}
let trackThrew = false
try {
  trackEvent('sign_up', { method: 'kakao' })
} catch {
  trackThrew = true
}
check('전송이 던져도 화면으로 새지 않는다', trackThrew === false)

// 9. trackEvent — 6종이 허용된 파라미터만 보낸다
/** 보내면 절대 안 되는 키. 하나라도 payload 에 있으면 실패한다 */
const BANNED_KEYS = [
  'title',
  'content',
  'comment',
  'nickname',
  'guestNickname',
  'email',
  'userId',
  'user_id',
  'postId',
  'post_id',
  'commentId',
  'comment_id',
  'callbackUrl',
  'callback_url',
  'destination',
  'url',
  'marketing',
]

const CASES: Array<{ name: SoranEventName; params: Record<string, unknown>; keys: string[] }> = [
  {
    name: 'write_login_prompt',
    params: { board_slug: 'free', draft_saved: true } satisfies SoranEventMap['write_login_prompt'],
    keys: ['board_slug', 'draft_saved'],
  },
  {
    name: 'write_auth_start',
    params: { board_slug: 'menopause', method: 'kakao' } satisfies SoranEventMap['write_auth_start'],
    keys: ['board_slug', 'method'],
  },
  {
    name: 'sign_up',
    params: { method: 'kakao' } satisfies SoranEventMap['sign_up'],
    keys: ['method'],
  },
  {
    name: 'write_draft_restored',
    params: {
      board_slug: 'free',
      logged_in: true,
    } satisfies SoranEventMap['write_draft_restored'],
    keys: ['board_slug', 'logged_in'],
  },
  {
    name: 'post_publish',
    params: { board_slug: 'menopause' } satisfies SoranEventMap['post_publish'],
    keys: ['board_slug'],
  },
  {
    name: 'comment_publish',
    params: {
      member_type: 'guest',
      is_reply: false,
    } satisfies SoranEventMap['comment_publish'],
    keys: ['member_type', 'is_reply'],
  },
]

check('검사하는 이벤트가 6종 전부다', CASES.length === 6)

for (const c of CASES) {
  reset()
  // 위 satisfies 로 타입은 이미 검증됐다. 전송 경로만 확인한다.
  trackEvent(c.name as 'sign_up', c.params as SoranEventMap['sign_up'])

  check(`${c.name} — 1건만 보낸다`, calls.length === 1)
  const [command, sentName, payload] = calls[0] ?? ['', '', {}]
  check(`${c.name} — command 는 event`, command === 'event')
  check(`${c.name} — 이름이 그대로 간다`, sentName === c.name)
  check(`${c.name} — send_to 를 붙이지 않는다`, !('send_to' in payload))
  check(
    `${c.name} — 허용 파라미터만 간다 (${c.keys.join(', ')})`,
    Object.keys(payload).sort().join(',') === [...c.keys].sort().join(','),
  )
  check(
    `${c.name} — 금지 키가 하나도 없다`,
    BANNED_KEYS.every((k) => !(k in payload)),
  )
}

// 10. 커뮤니티 게시판 목록 (magazine·best 가 섞이면 board_slug 타입이 넓어진다)
check(
  '커뮤니티 게시판은 menopause·free 둘뿐',
  [...COMMUNITY_BOARD_SLUGS].sort().join(',') === 'free,menopause',
)
check(
  '  magazine·best 는 커뮤니티 목록에 없다',
  !COMMUNITY_BOARD_SLUGS.includes('magazine' as CommunityBoardSlug) &&
    !COMMUNITY_BOARD_SLUGS.includes('best' as CommunityBoardSlug),
)
check('이벤트 이름 6종이 그대로다 (타입 대조)', eventNamesAreExact === true)
check('타입 차단 표본이 전부 살아 있다', typeGuardSamples.length === 7)

// ── 보고 ─────────────────────────────────────────────────
const failed = results.filter(([, ok]) => !ok)
for (const [why, ok] of results) console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${why}`)
console.log('')

if (failed.length) {
  console.error(`🔴 GA4 참여 계측 가드 실패 — ${failed.length}/${results.length}\n`)
  for (const [why] of failed) console.error(`  ${why}`)
  process.exit(1)
}

console.log(`GA4 참여 계측 가드 통과 — ${results.length}건`)
console.log('')
console.log('🔴 이 검사는 모듈의 약속만 본다 —')
console.log('   이벤트가 화면의 그 자리에 실제로 붙어 있는지는 보지 못한다.')
console.log('   그건 Preview 의 gtag 스텁 계수와 Production 의 /g/collect 계수가 본다.')
console.log('   magazine·best 타입 차단은 @ts-expect-error 라 typecheck:ops 가 강제한다.')

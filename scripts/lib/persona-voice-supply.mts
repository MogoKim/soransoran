/**
 * Persona **말투 근거 공급** — 공개 출처 댓글 → 익명 화자 묶음 → 새 코드 배정 (2026-09-29, Lane 3)
 *
 * 🔴 **왜 있는가.** 정본 말투 자산(`corpus.json`)의 3건↑ 안전 화자 18명이 운영 고정 배정
 *    (`stableAssignment`)으로 P01~P19 에 전부 쓰였다. P20~P25 와 P26 이후는 말투 근거가 없어
 *    자동 확장(#623)이 전원 `NO_VOICE_EVIDENCE` 로 격리된다. 이 파일은 **공급 파이프라인이 이미
 *    모은 공개 댓글**에서 새 화자를 세우는 한 줄기다.
 *
 * 한 줄기 (전부 순수 · 🔴 DB · 네트워크 · LLM · 파일 쓰기 없음)
 *   ① screenPublicComments   작성자 → 불투명 speakerId(저장하지 않는 salt) · 개인정보 · 안전 ·
 *                            닉네임 혼입 · 식별자 유출 · 실회원 화자 · 경험형 · 길이 밴드를 **한 자리에서** 거른다
 *   ② rekeyByContent         salt 로 만든 id 를 **내용 digest** 로 바꾼다 — 회차마다 salt 가 달라도
 *                            같은 화자는 같은 순서에 선다(배정이 회차마다 흔들리지 않게)
 *   ③ dropDuplicateSpeakers  정본 코퍼스 · 다른 공급 화자와 댓글이 겹치는 화자를 뺀다(정규화 비교)
 *   ④ planSupplyBundles      운영 `planBundles` **그대로** — 대상 코드는 "정본 배정이 없는 운영 코드
 *                            (P20~P25) → 새 코드(P26~)" 순이다
 *   ⑤ 합친 배정에서 운영 `referenceSeedShareCount` 가 **1** 이어야 한다 — 아니면 격리
 *   ⑥ assignmentBytes        P01~P19 묶음을 **바이트 그대로** digest 로 남겨, 전후가 같은지 본다
 *
 * 🔴 **새 판정을 만들지 않는다.** 개인정보·안전은 `checkContent`(글쓰기 가드) · `safetyFilter`
 *    (공급 안전 필터) · 실회원은 Gate ⑥-B `checkNameCollision` · 닉네임 혼입은 ⑥-A 와 같은 본문 포함 대조 ·
 *    식별자 유출은 `identityLeakCheck` · 경험형은 `carriesExperience` · 묶음은 `planBundles` ·
 *    검증은 `judgeReferenceBundle` 이다. 새로 적은 규칙은 **이메일 꼴**과 **말투 근거 전용 개인정보 한 겹**
 *    (`voiceEvidencePii` — 가린 숫자·링크·가린 이메일·메신저 ID·주소·@멘션)뿐이다. 둘 다 이 줄기에만 걸린다.
 *
 * 🔴 **작성자 이름은 ① 밖으로 나가지 않는다.** 반환 타입에 작성자 칸이 없다.
 *    원문 댓글은 메모리에만 있다 — Git · DB 로 옮기지 않는다. 보고는 개수·코드만 한다.
 */
import { createHash, randomUUID } from 'node:crypto'

import { checkContent } from '../../src/lib/content-guard'
import { REFERENCE_MAX_CHARS, REFERENCE_MIN_CHARS, type VoiceReferenceBundle } from '../../src/lib/persona-voice-reference'
import { checkNameCollision, normalizeN2 } from './persona-gate-name-collision.mjs'
import { safetyFilter } from './micro-seed-safety-filter.mjs'
import {
  ANCHOR_MIN_COMMENTS, carriesExperience, identityLeakCheck, planBundles, referenceSeedShareCount,
  type LocalComment,
} from './persona-reference-store.mjs'

// ─────────────────────────────────────────────────────────
// 입력 — 공개 출처 댓글 한 줄
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **공개 출처 댓글 한 줄.** 수집기가 준 모양을 이 모양으로 옮겨서만 들어온다.
 *    `author` 는 공개 화면의 작성자 표시다 — **① 안에서만** 쓰이고 곧바로 불투명 id 가 된다.
 */
export type PublicCommentRow = {
  /** 출처 — `navercafe:remonterrace` · `82cook` 처럼. 🔴 같은 이름도 출처가 다르면 다른 사람이다 */
  source: string
  articleId: string
  author: string | null
  text: string
}

/** 댓글 한 건이 빠진 이유 */
export const COMMENT_DROP_CODES = [
  'UNATTRIBUTED',        // 작성자 표시가 없다 — 한 사람으로 묶을 수 없다
  'OUT_OF_BAND',         // 말투 근거 길이 밴드 밖 (`REFERENCE_MIN_CHARS`~`REFERENCE_MAX_CHARS`)
  'PII',                 // 연락처·외부 ID·이메일·개인정보 노출
  'UNSAFE',              // 공급 안전 필터·글쓰기 가드 비통과 (정치·욕설·광고·의료 단정 등)
  'IDENTITY_LEAK',       // 본문이 작성자 표시와 같다
  'NICKNAME_LEAK',       // 본문에 다른 작성자 표시나 회원 표시명이 섞였다 (⑥-A 와 같은 뜻)
  'EXPERIENCE',          // 남의 경험을 담았다 (창업자 판정 B — 운영 묶음과 같은 규칙)
  'REAL_MEMBER_SPEAKER', // 이 화자의 작성자 표시가 회원·Persona 표시명과 부딪힌다
  'REAL_MEMBER_UNMEASURED', // 회원 표시명 집합을 읽지 못했다 — 🔴 모르면 통과가 아니다
] as const
export type CommentDropCode = (typeof COMMENT_DROP_CODES)[number]

/** 화자 한 명(또는 배정 한 칸)이 빠지거나 격리된 이유 */
export const SPEAKER_BLOCK_CODES = [
  'SPEAKER_THIN',        // 남은 댓글이 3건 미만
  'DUPLICATE_SPEAKER',   // 정본 코퍼스·다른 공급 화자와 댓글이 겹친다 (정규화 비교)
  'SHARED_SEED',         // 합친 배정에서 운영 `referenceSeedShareCount` 가 1 이 아니다
  'NO_TARGET_CODE',      // 화자는 섰지만 줄 코드가 없다
] as const
export type SpeakerBlockCode = (typeof SPEAKER_BLOCK_CODES)[number]

/**
 * 🔴 **이메일 꼴** — 기존 가드(`checkContent` · `safetyFilter`)에 없는 유일한 개인 식별자라 여기 둔다.
 *    전화번호·메신저 ID·주민/계좌번호·신상 표현은 기존 가드가 본다(다시 적지 않는다).
 */
const EMAIL_LIKE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i

/**
 * 🔴 **말투 근거 전용 개인정보 한 겹** (2026-09-29, #624 실측 보정).
 *
 *    합성 변형으로 재 보니 기존 가드 둘(`checkContent` · `safetyFilter`)은 **사람이 쓰는 글쓰기 가드**라
 *    오탐을 피하려고 좁게 잡혀 있었다 — 전각·원문자·이모지 숫자 · 한글 숫자 · 띄어 쓴 숫자 · 유선·국제번호 ·
 *    계좌 숫자 · `open.kakao.com` 링크 · URL · 가린 이메일 · 한글 메신저 ID · 주소 · `@멘션` 이 전부 통과했다.
 *    말투 근거는 **90일 저장**되고, 한 건 덜 모아도 잃는 것이 없다 — 그래서 여기서는 넓게 버린다.
 *    🔴 글쓰기 가드(`content-guard`)는 바꾸지 않는다 — 실회원 글을 막게 되기 때문이다.
 *
 *    숫자 규칙은 **9자리↑ 숫자 열**(공백 · `-` · `.` 만 끼어 있어도 이어 본다)이다.
 *    날짜 `2026.09.29`(8자리) · 금액 `1,000,000`(쉼표는 잇지 않는다)은 걸리지 않는다.
 */
const KO_DIGIT: Record<string, string> = {
  공: '0', 영: '0', 일: '1', 이: '2', 삼: '3', 사: '4', 오: '5', 육: '6', 륙: '6', 칠: '7', 팔: '8', 구: '9',
}
const LONG_DIGIT_RUN = /\d(?:[\s.\-]{0,2}\d){8,}/
const VOICE_PII_PATTERNS: readonly RegExp[] = [
  // 링크 — 오픈채팅 · 블로그 · 단축 URL 은 곧 사람을 찾아가는 길이다
  /https?:\/\/|www\.|open\.kakao|\b[a-z0-9-]{2,}\.(?:com|net|org|kr|co|me|ly|io|us|gl|to)\b/i,
  // 가린 이메일 — 골뱅이 · (at) · 띄어 쓴 @ · 메일 도메인 이름
  /골뱅이|[([]\s*at\s*[)\]]|\s@\s|(?:naver|daum|hanmail|gmail|nate|kakao)\s*(?:[.·]|dot|닷|점)\s*(?:com|net)/i,
  // @멘션 — 누군가를 부르는 표시는 말투가 아니라 식별자다
  /@\S/,
  // 메신저 · SNS 아이디 — 한글 아이디 · 띄어 쓴 `카 톡` · 초성 `ㅋㅌ` 까지
  /아이디(?!어)|\bid\s*[:：]|카\s+톡|ㅋㅌ|오픈\s*톡|인스타|instagram|라인\s*(?:아이디|id)|밴드\s*주소|블로그\s*주소/i,
  // 주소 — 동·호 · 번지 · 광역 이름으로 시작하는 행정 구역 두 단계(`서울시 강남구 역삼동`)
  /\d{1,4}\s*동\s*\d{1,4}\s*호|\d+\s*번지/,
  /(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|전북|전남|경북|경남|제주)[가-힣]*\s+[가-힣]{1,5}(?:시|군|구)\s+[가-힣]{1,6}(?:구|동|읍|면|로|길)/,
  // 전화 앞자리를 글자로 가린 꼴 — `010-l234-5678`
  /01[016789]\s*[-.]\s*[0-9lIoO]{3,4}\s*[-.]\s*[0-9lIoO]{4}/,
]
/** 🔴 전각 · 원문자 · 이모지 숫자를 보통 숫자로 — 가리려고 바꾼 꼴을 되돌린다 */
const foldDigits = (text: string): string => text.normalize('NFKC').replace(/[️⃣]/g, '')
export function voiceEvidencePii(text: string): boolean {
  const t = foldDigits(text)
  if (LONG_DIGIT_RUN.test(t)) return true
  // 🔴 한글 숫자는 `공일공`(010) 꼴이 있을 때만 바꾼다 — `이`·`사`·`오` 는 보통 낱말에 너무 흔하다
  if (/[공영0]\s*[일1]\s*[공영0]/.test(t)
    && LONG_DIGIT_RUN.test(t.replace(/[공영일이삼사오육륙칠팔구]/g, (c) => KO_DIGIT[c] ?? c))) return true
  // 🔴 NFKC 는 `ㅋㅌ`(호환 자모)를 조합형으로 바꾼다 — 원문과 접은 꼴 둘 다 본다
  return VOICE_PII_PATTERNS.some((re) => re.test(t) || re.test(text))
}

/** 이름 대조에 쓰는 최소 길이 — 한 글자 이름은 본문 어디에나 있어 대조가 성립하지 않는다 */
const NAME_MATCH_MIN = 2

const sha = (s: string, n = 16): string => createHash('sha256').update(s).digest('hex').slice(0, n)

// ─────────────────────────────────────────────────────────
// ① 거르기 · 익명화
// ─────────────────────────────────────────────────────────

export type ScreenResult = {
  /** 🔴 작성자 칸이 없다 — speakerId 는 저장하지 않는 salt 로 만든 불투명 값이다 */
  kept: LocalComment[]
  dropped: Record<CommentDropCode, number>
  /** 실회원 화자로 막힌 화자 수 */
  realMemberSpeakers: number
  /** 운영 `identityLeakCheck` — 남긴 본문 대 작성자 표시. 🔴 hits 는 0 이어야 한다 */
  identityLeak: { ran: boolean; hits: number }
  input: number
}

const emptyDrops = (): Record<CommentDropCode, number> =>
  Object.fromEntries(COMMENT_DROP_CODES.map((c) => [c, 0])) as Record<CommentDropCode, number>

/** 🔴 개인 식별자 — 이메일 꼴 + 말투 근거 전용 한 겹 + 기존 가드 둘. 무엇이 걸렸는지 문자열은 돌려주지 않는다 */
export function piiOrUnsafe(text: string): CommentDropCode | null {
  if (EMAIL_LIKE.test(text)) return 'PII'
  if (voiceEvidencePii(text)) return 'PII'
  const g =checkContent(text, { audience: 'bot' })
  if (!g.ok) {
    const code = g.issue?.code
    return code === 'CONTACT_PHONE' || code === 'CONTACT_EXTERNAL_ID' ? 'PII' : 'UNSAFE'
  }
  const s = safetyFilter({ title: '', body: text })
  if (s.reasons.some((r) => r.code === 'personalIdentity')) return 'PII'
  if (s.verdict !== 'pass') return 'UNSAFE'
  return null
}

/**
 * 🔴 **실회원 화자인가** — Gate ⑥-B 를 작성자 표시에 그대로 건다.
 *    회원(B1)·Persona(B3) 표시명과 부딪히는 것만 본다. 크롤 author(B2)·작명 규칙(B4~B6)은
 *    "이 사람이 우리 회원인가" 와 다른 물음이라 보지 않는다.
 */
export function isRealMemberSpeaker(author: string, sets: { memberNames: readonly string[]; personaNames?: readonly string[] }): boolean {
  const v = checkNameCollision(author, { memberNames: sets.memberNames, personaNames: sets.personaNames ?? [] })
  return v.hits.some((h) => h.kind === 'B1_MEMBER' || h.kind === 'B3_PERSONA')
}

/**
 * 🔴 **공개 댓글을 거르고 익명화한다.** 작성자 표시는 이 함수 밖으로 나가지 않는다.
 *
 * @param members  회원·Persona 표시명. 🔴 `null` 이면 **재지 못한 것**이다 — 전부 막는다(빈 배열과 다르다)
 * @param salt     저장하지 않는 salt. 시험만 넘긴다 — 운영은 프로세스마다 새로 만든다
 * @param idOf     작성자 → 불투명 id. 🔴 수집 시점 말투 근거(`voice-evidence-capture`)만 넘긴다 —
 *                 비밀 salt 의 HMAC 으로 **저장해도 되는** id 를 만든다. 없으면 위 salt 로 만든 회차 한정 id 다
 */
export function screenPublicComments(
  rows: readonly PublicCommentRow[],
  members: { memberNames: readonly string[]; personaNames?: readonly string[] } | null,
  salt: string = randomUUID(),
  idOf?: (source: string, author: string) => string,
): ScreenResult {
  const dropped = emptyDrops()
  const kept: LocalComment[] = []
  const drop = (c: CommentDropCode): void => { dropped[c] += 1 }

  // 🔴 본문 대조용 이름 — 같은 출처 작성자 표시 전부 + 회원 표시명
  const authorsBySource = new Map<string, Set<string>>()
  for (const r of rows) {
    const a = (r.author ?? '').trim()
    if (a === '') continue
    const set = authorsBySource.get(r.source) ?? new Set<string>()
    set.add(a)
    authorsBySource.set(r.source, set)
  }
  const memberNames = (members?.memberNames ?? []).map((n) => n.trim()).filter((n) => [...n].length >= NAME_MATCH_MIN)

  const namesBySource = new Map<string, string[]>()
  const realMemberCache = new Map<string, boolean>()
  const realMemberSpeakerIds = new Set<string>()
  const allAuthors: string[] = []
  for (const set of authorsBySource.values()) allAuthors.push(...set)

  for (const r of rows) {
    const author = (r.author ?? '').trim()
    const text = r.text.trim()
    if (author === '') { drop('UNATTRIBUTED'); continue }
    if (members === null) { drop('REAL_MEMBER_UNMEASURED'); continue }
    const n = [...text].length
    if (n < REFERENCE_MIN_CHARS || n > REFERENCE_MAX_CHARS) { drop('OUT_OF_BAND'); continue }

    // 🔴 실회원 화자 — 한 명이라도 걸리면 그 화자의 댓글 전부를 버린다
    const key = `${r.source}\u0000${author}`
    let real = realMemberCache.get(key)
    if (real === undefined) {
      real = isRealMemberSpeaker(author, members)
      realMemberCache.set(key, real)
    }
    const speakerId = idOf !== undefined ? idOf(r.source, author) : sha(`${salt}\u0000${r.source}\u0000${author}`, 12)
    if (real) { drop('REAL_MEMBER_SPEAKER'); realMemberSpeakerIds.add(speakerId); continue }

    // 🔴 식별자 유출 — 본문이 작성자 표시 그 자체
    if (allAuthors.includes(text)) { drop('IDENTITY_LEAK'); continue }
    // 🔴 닉네임 혼입 — 같은 출처 작성자 표시(본인 포함)나 회원 표시명이 본문에 있다
    let sourceNames = namesBySource.get(r.source)
    if (sourceNames === undefined) {
      sourceNames = [...(authorsBySource.get(r.source) ?? [])].filter((a) => [...a].length >= NAME_MATCH_MIN)
      namesBySource.set(r.source, sourceNames)
    }
    if (sourceNames.some((a) => text.includes(a)) || memberNames.some((m) => text.includes(m))) {
      drop('NICKNAME_LEAK'); continue
    }
    const pii = piiOrUnsafe(text)
    if (pii !== null) { drop(pii); continue }
    if (carriesExperience(text)) { drop('EXPERIENCE'); continue }
    kept.push({ speakerId, text })
  }

  // 🔴 운영 식별자 유출 검사를 **남긴 것 전체**에 한 번 더 — 위 규칙이 바뀌어도 여기서 걸린다
  const leak = identityLeakCheck({ texts: kept.map((k) => k.text), authors: allAuthors })
  return {
    kept,
    dropped,
    realMemberSpeakers: realMemberSpeakerIds.size,
    identityLeak: { ran: leak.ran, hits: leak.hits },
    input: rows.length,
  }
}

// ─────────────────────────────────────────────────────────
// ② 내용 digest 로 다시 이름 붙이기
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **salt id → 내용 digest id.** 운영 `planBundles` 는 동수를 speakerId 순으로 세운다.
 *    salt 가 회차마다 바뀌면 동수 화자의 순서가 흔들리고, 그러면 P20 이 회차마다 다른 사람을 받는다.
 *    묶음 내용의 digest 는 회차가 달라도 같다 — 그리고 닉네임으로 되돌릴 수 없다.
 */
export function rekeyByContent(rows: readonly LocalComment[]): LocalComment[] {
  const bySpeaker = new Map<string, string[]>()
  for (const r of rows) {
    const cur = bySpeaker.get(r.speakerId) ?? []
    if (!cur.includes(r.text)) cur.push(r.text)
    bySpeaker.set(r.speakerId, cur)
  }
  const out: LocalComment[] = []
  for (const texts of bySpeaker.values()) {
    const id = sha(`speaker\u0000${[...texts].sort().join('\u0001')}`, 12)
    for (const t of texts) out.push({ speakerId: id, text: t })
  }
  return out
}

// ─────────────────────────────────────────────────────────
// ③ 중복 화자
// ─────────────────────────────────────────────────────────

/** 🔴 비교 키 — Gate ⑥-B 의 N2 정규화(소문자·공백·기호 제거) 그대로 */
export const dupKeyOf = (text: string): string => normalizeN2(text)

/**
 * 🔴 **중복 화자를 뺀다.**
 *
 *    · 정본 코퍼스(배정 여부와 무관하게 전부)와 댓글 하나라도 겹치면 — 이미 있는 화자일 수 있다
 *    · 다른 공급 화자와 겹치면 — **먼저 선 화자**(댓글 많은 순 · 동수는 id 순)만 남긴다
 *
 *    겹침은 **정규화 키**로 본다. 띄어쓰기·문장부호만 다른 같은 댓글을 다른 사람으로 세지 않는다.
 *    🔴 정확히 같은 문장의 공유는 뒤의 `referenceSeedShareCount` 가 한 번 더 본다(두 겹).
 */
export function dropDuplicateSpeakers(
  rows: readonly LocalComment[],
  canonTexts: readonly string[],
): { rows: LocalComment[]; duplicateSpeakers: number } {
  const canon = new Set(canonTexts.map(dupKeyOf).filter((k) => k !== ''))
  const bySpeaker = new Map<string, string[]>()
  for (const r of rows) {
    const cur = bySpeaker.get(r.speakerId) ?? []
    cur.push(r.text)
    bySpeaker.set(r.speakerId, cur)
  }
  const order = [...bySpeaker.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  const seen = new Set<string>()
  const keep = new Set<string>()
  let dup = 0
  for (const [id, texts] of order) {
    const keys = texts.map(dupKeyOf).filter((k) => k !== '')
    if (keys.some((k) => canon.has(k) || seen.has(k))) { dup += 1; continue }
    for (const k of keys) seen.add(k)
    keep.add(id)
  }
  return { rows: rows.filter((r) => keep.has(r.speakerId)), duplicateSpeakers: dup }
}

// ─────────────────────────────────────────────────────────
// ④ 대상 코드 · 배정 · ⑤ seed 공유
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **대상 코드 순서** — 정본 배정이 없는 운영 코드(P20~P25)가 먼저, 새 코드(P26~)가 다음.
 *    운영 active 인데 말투가 없는 사람을 두고 새 사람을 먼저 만들지 않는다.
 */
export function supplyTargetCodes(input: {
  productionCodes: readonly string[]
  baseAssigned: ReadonlySet<string>
  newCodes: readonly string[]
}): string[] {
  const first = input.productionCodes.filter((c) => !input.baseAssigned.has(c))
  const rest = input.newCodes.filter((c) => !input.productionCodes.includes(c))
  return [...new Set([...first, ...rest])].sort()
}

export type SupplySlot = {
  code: string
  bundle: VoiceReferenceBundle
  /** 운영 `referenceSeedShareCount` — 정본 배정과 합친 지도에서 센다 */
  seedShareCount: number | null
  /** 🔴 1 이 아니면 격리 */
  blocks: SpeakerBlockCode[]
}

/**
 * 🔴 **정본 배정 뒤에 덧붙인다 — 정본 배정은 한 칸도 건드리지 않는다.**
 *    묶음은 운영 `planBundles` 가 만든다(경험형 제외 · 3건↑ · 상한 8 · `judgeReferenceBundle`).
 *    합친 지도(정본 ∪ 공급)에서 운영 `referenceSeedShareCount` 가 1 이 아닌 칸은 `SHARED_SEED` 다.
 */
export function planSupplyBundles(input: {
  rows: readonly LocalComment[]
  targets: readonly string[]
  base: ReadonlyMap<string, VoiceReferenceBundle>
}): { slots: SupplySlot[]; speakers: number; blocks: SpeakerBlockCode[]; planBlocks: string[] } {
  const speakers = countSpeakers(input.rows)
  const blocks: SpeakerBlockCode[] = []
  if (input.targets.length === 0) {
    if (speakers > 0) blocks.push('NO_TARGET_CODE')
    return { slots: [], speakers, blocks, planBlocks: [] }
  }
  const plan = planBundles({ rows: input.rows, personaCodes: input.targets })
  if (speakers > input.targets.length) blocks.push('NO_TARGET_CODE')
  const combined = new Map<string, VoiceReferenceBundle>(input.base)
  for (const b of plan.bundles) {
    // 🔴 정본 배정이 있는 코드를 덮지 않는다 — 대상 목록이 틀렸어도 여기서 멈춘다
    if (!combined.has(b.personaCode)) combined.set(b.personaCode, b)
  }
  const slots: SupplySlot[] = plan.bundles
    .filter((b) => !input.base.has(b.personaCode))
    .map((b) => {
      const share = referenceSeedShareCount(combined, b.personaCode)
      return { code: b.personaCode, bundle: b, seedShareCount: share, blocks: share === 1 ? [] : ['SHARED_SEED'] }
    })
  return { slots, speakers, blocks, planBlocks: plan.blocks }
}

/** 3건↑ 화자 수 — 🔴 운영 `planBundles` 와 같은 조건(경험형은 ①에서 이미 빠졌다) */
export function countSpeakers(rows: readonly LocalComment[]): number {
  const by = new Map<string, Set<string>>()
  for (const r of rows) {
    if (r.speakerId === '') continue
    const s = by.get(r.speakerId) ?? new Set<string>()
    s.add(r.text)
    by.set(r.speakerId, s)
  }
  return [...by.values()].filter((s) => s.size >= ANCHOR_MIN_COMMENTS).length
}

// ─────────────────────────────────────────────────────────
// ⑥ 운영 배정 바이트 불변
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **P01~P19 묶음을 바이트 그대로 digest 로.** 텍스트만이 아니라 길이 분포·문체 좌표·anchor 까지
 *    전부 `JSON.stringify` 한 값이다 — 한 바이트라도 바뀌면 다른 값이 된다.
 */
export function assignmentBytes(
  byCode: ReadonlyMap<string, VoiceReferenceBundle>,
  codes: readonly string[],
): Map<string, string> {
  return new Map(codes.map((c) => {
    const b = byCode.get(c)
    return [c, b === undefined ? '∅' : sha(JSON.stringify(b), 32)]
  }))
}

/** 전후 digest 가 다른 코드 — 🔴 비어 있어야 한다 */
export function bytesDrift(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  const codes = [...new Set([...before.keys(), ...after.keys()])].sort()
  return codes.filter((c) => before.get(c) !== after.get(c))
}

// ─────────────────────────────────────────────────────────
// 한 줄기 — ①~⑥
// ─────────────────────────────────────────────────────────

export type VoiceSupplyPlan = {
  screen: Omit<ScreenResult, 'kept'> & { kept: number }
  duplicateSpeakers: number
  /** 3건↑ 안전 · 중복 아님 화자 수 — 🔴 이 PR 의 측정 대상 */
  availableSpeakers: number
  targets: string[]
  slots: SupplySlot[]
  blocks: SpeakerBlockCode[]
  /** 🔴 운영 배정 바이트 drift — 비어 있어야 한다 */
  drift: string[]
  ok: boolean
}

/**
 * 🔴 **공개 댓글 → 코드별 말투 묶음.** 정본 배정(`base`)은 읽기만 한다.
 *    `baseAfter` 는 부르는 쪽이 **이 계획을 세운 뒤 다시 읽은** 정본 배정이다 — 같아야 한다.
 */
export function planVoiceSupply(input: {
  rows: readonly PublicCommentRow[]
  members: { memberNames: readonly string[]; personaNames?: readonly string[] } | null
  canonTexts: readonly string[]
  base: ReadonlyMap<string, VoiceReferenceBundle>
  baseAfter: () => ReadonlyMap<string, VoiceReferenceBundle>
  productionCodes: readonly string[]
  newCodes: readonly string[]
  salt?: string
}): VoiceSupplyPlan {
  const assigned = [...input.base.keys()].filter((c) => input.productionCodes.includes(c)).sort()
  const before = assignmentBytes(input.base, assigned)
  const screen = screenPublicComments(input.rows, input.members, input.salt)
  const rekeyed = rekeyByContent(screen.kept)
  const dedup = dropDuplicateSpeakers(rekeyed, input.canonTexts)
  const targets = supplyTargetCodes({
    productionCodes: input.productionCodes, baseAssigned: new Set(input.base.keys()), newCodes: input.newCodes,
  })
  const planned = planSupplyBundles({ rows: dedup.rows, targets, base: input.base })
  const drift = bytesDrift(before, assignmentBytes(input.baseAfter(), assigned))
  const blocks = [...planned.blocks]
  if (countSpeakers(rekeyed) > countSpeakers(dedup.rows)) blocks.push('DUPLICATE_SPEAKER')
  return {
    screen: { ...screen, kept: screen.kept.length },
    duplicateSpeakers: dedup.duplicateSpeakers,
    availableSpeakers: planned.speakers,
    targets,
    slots: planned.slots,
    blocks: [...new Set(blocks)],
    drift,
    ok: drift.length === 0 && screen.identityLeak.hits === 0,
  }
}

// ─────────────────────────────────────────────────────────
// 입력 어댑터 — 🔴 공급 파이프라인이 이미 가진 모양만 읽는다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **`MicroSeedRawContent.rawComments`** — 스키마 주석의 형태 `[{ id?, contentHash?, body, at? }]`.
 *    작성자 칸(`author`)이 있을 때만 화자로 묶인다. 없으면 `UNATTRIBUTED` 로 세어진다(버리는 것을 숨기지 않는다).
 */
export function rowsFromRawContent(rows: readonly {
  sourceSite: string
  sourceArticleId: string
  rawComments: unknown
}[]): PublicCommentRow[] {
  const out: PublicCommentRow[] = []
  for (const r of rows) {
    if (!Array.isArray(r.rawComments)) continue
    for (const c of r.rawComments) {
      if (c === null || typeof c !== 'object') continue
      const o = c as { body?: unknown; author?: unknown }
      if (typeof o.body !== 'string') continue
      out.push({
        source: r.sourceSite, articleId: r.sourceArticleId,
        author: typeof o.author === 'string' ? o.author : null, text: o.body,
      })
    }
  }
  return out
}

/**
 * 🔴 **수집 산출물(jsonl) 한 줄** — `comments: [{ author, content }]` 꼴만 받는다.
 *    맨 문자열 배열은 작성자를 알 수 없어 `UNATTRIBUTED` 다(정본 로더의 `content` 만 받는 규칙과 같다).
 */
export function rowsFromCollectLine(line: unknown): PublicCommentRow[] {
  if (line === null || typeof line !== 'object') return []
  const o = line as { comments?: unknown; sourceSite?: unknown; sourceArticleId?: unknown }
  if (!Array.isArray(o.comments)) return []
  const source = typeof o.sourceSite === 'string' ? o.sourceSite : ''
  const articleId = typeof o.sourceArticleId === 'string' ? o.sourceArticleId : ''
  if (source === '') return []
  const out: PublicCommentRow[] = []
  for (const c of o.comments) {
    if (typeof c === 'string') { out.push({ source, articleId, author: null, text: c }); continue }
    if (c === null || typeof c !== 'object') continue
    const x = c as { author?: unknown; content?: unknown }
    if (typeof x.content !== 'string') continue
    out.push({ source, articleId, author: typeof x.author === 'string' ? x.author : null, text: x.content })
  }
  return out
}

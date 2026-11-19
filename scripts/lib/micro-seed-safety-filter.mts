/**
 * 결정적 안전 필터 — 🔴 **source-agnostic 순수 판정. 발행하지 않는다**
 *
 * 🔴 **낱말로 소재를 막지 않는다.** 글을 막는 사유는 모델 판정의 넷(위기 신호 · 특정인 괴롭힘/위협 ·
 *    위험한 의료 지시 · 광고)이다(`micro-seed-auto-judge` `JUDGE_RISKS`). 의료 · 광고 낱말로 보류하던 칸은 지웠다 —
 *    "처방" "계좌" 한 낱말이 갱년기 경험담을 판정에 가기도 전에 막았고, 같은 함수가 초안 · 적재 · 공개 · 감사에서 다시 걸렸다.
 *    여기 남은 것은 모델에게 물을 필요가 없는 결정적인 것뿐이다:
 *      버림   연락처·식별번호 패턴 · 고정 슬롯(공지) · 한자 · 보호 대상 집단 비하어 · 사진 없이는 못 읽는 글
 *      보류   위기 신호 낱말(사람이 본다)
 *      못 읽음
 *
 * 🔴 **이 모듈이 하는 일은 "위험한가" 를 답하는 것뿐이다.**
 *    자동 발행 · 자동 상세 fetch · DB write · Sheet · LLM · Raw Vault 적재 — **어느 것도 하지 않는다.**
 *
 * 🔴 **네이버 전용 DOM · URL 에 의존하지 않는다.**
 *    입력은 제목 · 본문 · 이미 계산된 메타(qualityFlags · rowLabel 등)뿐이다.
 *    네이버와 82cook 이 같은 입력을 주면 **같은 결과가 나온다** (§4-U ①).
 */
import { findCjkIdeograph } from '../../src/lib/cjk-ideograph'
// 🔴 위기 신호의 정본은 순수 판정 하나다 — 여기서 정규식을 다시 적으면 초안 쪽 판정과 갈라진다
import { judgeCrisisSignal } from '../../src/lib/micro-seed-safety-signals'

/** 🔴 판정 5종. `pass` 만 다음 단계로 간다 */
export type SafetyVerdict = 'pass' | 'hold' | 'drop' | 'access' | 'hardExclude'

/**
 * 🔴 사유 코드.
 *    `volatile` 은 사유이지 제외가 아니다 — 아래 VOLATILE 주석 참조.
 */
export type SafetyReasonCode =
  | 'noticeSlot'          // 공지 · 필독 · 추천 고정 슬롯
  | 'personalIdentity'    // 연락처 · 식별번호 패턴
  | 'hostility'           // 보호 대상 집단 비하어
  | 'visualDependent'     // 이미지 의존
  | 'access'              // Access · deletedOrExpired
  | 'volatile'            // 🟡 펑 · 삭제예정 — Drop 이 아니다
  /** 🔴 자해 · 자살 위기 신호 — 버리지 않고 사람에게 넘긴다 */
  | 'crisisSignal'
  /** 🔴 실제 한자 문자 — 언어 핏 */
  | 'hanjaLanguageFit'

export type SafetyReason = { code: SafetyReasonCode; note: string }

export type SafetyResult = {
  verdict: SafetyVerdict
  reasons: SafetyReason[]
  /** 사람이 읽는 한 줄. 🔴 원문을 담지 않는다 — 사유 라벨만 */
  summary: string
}

/**
 * 🔴 **저장할 수 없는 사유의 자리 표시** — 판정기(`readReasons`)가 모르는 코드라 `unknownReason`(HOLD)으로 읽는다.
 *    잘못된 사유를 지우면 조용히 통과하고, 지어내면 거짓 근거가 된다 — 둘 다 하지 않는다(fail-closed).
 */
export const INVALID_SAFETY_REASON_CODE = 'invalidSafetyReason'

/**
 * 🔴 **thin 행에 저장하는 안전 사유 — 정본 식별자 `code` 만** (2026-10-10 P0).
 *    앞판 세 생산 경로(82cook thin · 네이버 collector · 네이버 thin)는 `String(reason)` 으로 객체를
 *    `"[object Object]"` 로 저장했다 — 2026-09-07 부터 362행. 판정기가 그 글자를 모르는 사유로 읽어
 *    안전 pass 원천까지 HOLD 됐고, 실제 사유는 지워졌다.
 *    · `note` · 원문 · URL · 작성자는 싣지 않는다
 *    · 순서를 지킨다(사람이 읽는 순서 = 판정 순서)
 *    · code 가 비었거나 문자열이 아니거나 하류 구분자(`|` `:` 공백)를 담으면 `INVALID_SAFETY_REASON_CODE`
 */
export function safetyReasonCodes(reasons: readonly unknown[]): string[] {
  return reasons.map((r) => {
    const code = r !== null && typeof r === 'object' ? (r as { code?: unknown }).code : undefined
    return typeof code === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(code) ? code : INVALID_SAFETY_REASON_CODE
  })
}

/**
 * 🔴 **입력은 전부 옵션이다.** 목록 단계에서는 본문이 없다.
 *    없는 것을 근거로 판정하지 않는다 — "모르면 0 이 아니라 없음" 이다.
 */
export type SafetyInput = {
  title: string
  body?: string
  /** 댓글 텍스트. 있으면 광고·적대 신호를 함께 본다 */
  comments?: readonly string[]
  /** 목록 행 라벨 (공지 · 필독 · 추천). 소스마다 추출 방식이 다르므로 **문자열로 받는다** */
  sourceRowLabel?: string | null
  sourcePinned?: boolean
  /** 수집기가 이미 내린 단일 제외 판정 (PR-S2-b-8) */
  /** 저장된 행의 값 — `pinned` 면 고정 슬롯이다 */
  sourceExcludeReason?: string | null
  qualityFlags?: readonly string[]
  /** 상세 열람 결과. 못 읽었으면 이유를 준다 */
  accessStatus?: 'ok' | 'deletedOrExpired' | 'permissionDenied' | 'renderFailed' | 'unknown'
  /** 본문 안 이미지 수 (상세 단계에서만 안다) */
  imageCount?: number
}

// ─────────────────────────────────────────────────────────
// 어휘 — 여기서 정의한다
// ─────────────────────────────────────────────────────────

/** ② 고정 슬롯 라벨. 🔴 navercafe 의 ROW_LABELS 와 같아야 한다 (fixture 가 대조한다) */
export const NOTICE_LABELS: readonly string[] = ['공지', '필독', '추천'] as const
const NOTICE_TITLE = /^\s*[[(【]?\s*(공지|필독|추천|안내|이벤트 안내)\s*[\])】]?/

/**
 * 연락처 · 식별번호 — 🔴 **낱말이 아니라 번호 모양을 본다.**
 *    "계좌번호" "주민번호" 라는 낱말이 나왔다는 것만으로는 버리지 않는다(축의금 계좌 이야기는 생활 글이다).
 *    실제 번호가 적혔을 때만이다 — 남의 번호를 우리 글감으로 들이지 않는다.
 *      · 주민등록번호 `######-#######`
 *      · 휴대전화 `01x-xxxx-xxxx` — 본문은 수집 때 마스킹(`[연락처]`)되므로 그 자리표도 같이 본다
 *      · 카드 `####-####-####-####`
 *      · 계좌 — 붙임표로 이은 숫자 묶음 셋 이상 · 숫자 10자리 이상
 */
const RESIDENT_NUMBER = /(?<!\d)\d{6}\s?-\s?[1-4]\d{6}(?!\d)/
const MOBILE_NUMBER = /(?<!\d)01[016-9][-.\s]?\d{3,4}[-.\s]?\d{4}(?!\d)|\[연락처\]/
const CARD_NUMBER = /(?<!\d)\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{4}(?!\d)/
const ACCOUNT_LIKE = /(?<![\d-])\d{2,6}(?:-\d{2,8}){2,3}(?![\d-])/g
const ACCOUNT_MIN_DIGITS = 10

export function hasContactOrIdNumber(text: string): boolean {
  if (RESIDENT_NUMBER.test(text) || MOBILE_NUMBER.test(text) || CARD_NUMBER.test(text)) return true
  return (text.match(ACCOUNT_LIKE) ?? []).some((m) => m.replace(/\D/g, '').length >= ACCOUNT_MIN_DIGITS)
}

/**
 * **보호 대상 집단 비하어 — 문맥 없이도 명백한 것만.**
 *    나이(틀딱) · 성별/양육(맘충 · 한남 · 김치녀) · 장애(병신) 를 낮잡는 집단 비하어만 결정적으로 버린다.
 *    모델 판정의 넷에는 이 칸이 없다(특정인 괴롭힘만 본다) — 그래서 여기 남는다.
 *    🔴 일반 욕설 · 거친 감탄(시발 · 지랄 · 미친 · 꺼져) · 작품 비판은 낱말 하나로 버리지 않는다 — 주관적 의견이다.
 *    🔴 특정인 공격 동원 · 위협 · 신상 털기는 모델 판정(`targetedHarassmentOrThreat`)이 막는다 — 여기서 낱말로 흉내 내지 않는다.
 */
const HOSTILITY =
  /틀딱|맘충|한남|김치녀|병신/

/** 이미지 의존 — 사진 없이는 읽히지 않는 글이다. 우리는 사진을 가져오지 않는다 */
const VISUAL_DEPENDENT =
  /글씨체|폰트|이 ?사진|사진 ?속|사진 ?좀|이미지|그림 ?속|무슨 ?글씨|이거 ?뭔지|이게 ?뭔지|사진 ?참고|아래 ?사진|첨부 ?사진/

/**
 * 🟡 **volatile — Drop 신호가 아니다** (§4-T · §4-U ⑤).
 *    "곧 지울 글" 이라는 뜻이고, 좋은 글이면 **빨리 확인하라**는 신호다.
 *    reason 으로만 남기고 verdict 를 낮추지 않는다.
 */
const VOLATILE = /펑예|펑\s*(예정|할|합니다|해요)|곧 ?펑|삭제 ?예정|삭제예정|곧 ?삭제|잠시 ?올려|잠깐 ?올려/

const has = (re: RegExp, ...texts: (string | undefined)[]): string | null => {
  for (const t of texts) {
    if (!t) continue
    const m = re.exec(t)
    if (m) return m[0]
  }
  return null
}

/** 🔴 verdict 우선순위. 숫자가 클수록 강하다 */
const RANK: Record<SafetyVerdict, number> = { pass: 0, hold: 1, drop: 2, access: 3, hardExclude: 4 }
const stronger = (a: SafetyVerdict, b: SafetyVerdict): SafetyVerdict => (RANK[b] > RANK[a] ? b : a)

/**
 * 결정적 안전 필터.
 *
 * 🔴 **이 함수는 발행을 승인하지 않는다.** 위험 여부만 답한다.
 */
export function safetyFilter(input: SafetyInput): SafetyResult {
  const { title } = input
  const body = input.body ?? ''
  const comments = input.comments ?? []
  const flags = input.qualityFlags ?? []
  const cmtText = comments.join(' ')
  const reasons: SafetyReason[] = []
  let verdict: SafetyVerdict = 'pass'
  const add = (code: SafetyReasonCode, note: string, v: SafetyVerdict): void => {
    reasons.push({ code, note })
    verdict = stronger(verdict, v)
  }

  // Access — 🔴 못 읽은 것은 판정이 아니다. 가장 먼저 가른다
  if (input.accessStatus && input.accessStatus !== 'ok') {
    add('access', `읽지 못함(${input.accessStatus})`, 'access')
  }

  // 언어 핏 — 🔴 사용자에게 보이는 제목 · 본문의 실제 한자 문자
  const hanja = findCjkIdeograph(title) ?? findCjkIdeograph(body)
  if (hanja !== null) add('hanjaLanguageFit', `한자 문자(${hanja})`, 'drop')

  // 공지 · 필독 · 추천 고정 슬롯 — 회원 글이 아니다
  const label = (input.sourceRowLabel ?? '').trim()
  if (input.sourcePinned === true || input.sourceExcludeReason === 'pinned'
    || NOTICE_LABELS.includes(label) || NOTICE_TITLE.test(title)) {
    add('noticeSlot', label !== '' ? `고정 슬롯(${label})` : '공지·필독·추천', 'hardExclude')
  }

  // 연락처 · 식별번호 — 번호 모양이 실제로 적힌 글은 버린다(낱말만으로는 버리지 않는다)
  if ([title, body, cmtText].some(hasContactOrIdNumber)) add('personalIdentity', '연락처·식별번호', 'drop')

  // 보호 대상 집단 비하어 — 🔴 커뮤니티 성격을 바꾼다. 쓰지 않는다(거친 말 · 작품 비판은 여기 아니다)
  const hostile = has(HOSTILITY, title, body, cmtText)
  if (hostile) add('hostility', '보호 대상 집단 비하', 'drop')

  // 이미지 의존 — 🔴 이미지 없이는 재사용이 안 된다
  //    본문이 거의 없고 이미지만 있는 경우도 같다
  const visual = has(VISUAL_DEPENDENT, title, body)
  const imageOnly = (input.imageCount ?? 0) > 0 && body.trim().length > 0 && body.trim().length < 30
  if (visual || imageOnly || flags.includes('imageLikelyBody')) {
    add('visualDependent', visual ? '이미지 의존 표현' : '본문이 거의 없고 이미지 중심', 'drop')
  }

  // 위기 신호 — 버리지 않고 **사람에게 넘긴다**(hold). 판정은 `judgeCrisisSignal` 하나가 한다
  const crisis = judgeCrisisSignal({ title, body, comments })
  if (crisis !== null) add(crisis.code, crisis.note, 'hold')

  // 🟡 volatile — 🔴 verdict 를 바꾸지 않는다. 사유로만 남긴다
  const vol = has(VOLATILE, title, body)
  if (vol) reasons.push({ code: 'volatile', note: `휘발 신호(${vol}) — Drop 아님. 빨리 확인할 신호` })

  const summary = verdict === 'pass'
    ? (reasons.length > 0 ? `통과 · 참고: ${reasons.map((r) => r.code).join(', ')}` : '통과')
    : `${verdict} · ${reasons.filter((r) => r.code !== 'volatile').map((r) => r.note).join(' / ')}`

  return { verdict, reasons, summary }
}

/** 🟢 편의: 다음 단계로 보낼 수 있는가 */
export function passesSafety(r: SafetyResult): boolean {
  return r.verdict === 'pass'
}

/** 🟡 편의: 휘발 신호가 붙었는가 (우선순위 판단용 · 제외용이 아니다) */
export function isVolatile(r: SafetyResult): boolean {
  return r.reasons.some((x) => x.code === 'volatile')
}

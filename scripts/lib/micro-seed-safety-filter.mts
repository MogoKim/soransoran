/**
 * 안전 · 브랜드 필터 8종 — 🔴 **source-agnostic 순수 판정. 발행하지 않는다**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-U ⑤ · §4-X ⑦ · §4-Y ⑤
 *
 * 🔴 **이 모듈이 하는 일은 "위험한가" 를 답하는 것뿐이다.**
 *    자동 발행 · 자동 상세 fetch · DB write · Sheet · LLM · Raw Vault 적재 ·
 *    noindex 발행 — **어느 것도 하지 않는다.** §4-X · §4-Y 가 "이것이 코드로 서 있어야
 *    자동 발행을 연다" 고 한 그 게이트를 만드는 것이고, 문을 여는 것은 별개 작업이다.
 *
 * 🔴 **네이버 전용 DOM · URL 에 의존하지 않는다.**
 *    입력은 제목 · 본문 · 이미 계산된 메타(qualityFlags · rowLabel 등)뿐이다.
 *    네이버와 82cook 이 같은 입력을 주면 **같은 결과가 나온다** (§4-U ①).
 *
 * 🔴 **정치 판정을 여기서 다시 만들지 않는다.**
 *    `findPoliticalTopicHit` 하나를 쓴다 — 두 곳에서 판정하면 언젠가 갈라진다 (§4-K).
 */
import { findPoliticalFigureHits, findPoliticalTopicHit } from './micro-seed-quality.mjs'
import { isPoliticsExcludeReason } from '../../src/lib/political-flags'
// 🔴 위기 신호·의료 판단 요청·건강 효능 주장의 정본은 순수 판정 하나다 —
//    여기서 정규식을 다시 적으면 semantic 판정과 갈라진다
import { judgeSafetySignals } from '../../src/lib/micro-seed-safety-signals'

/** 🔴 판정 5종. `pass` 만 다음 단계로 간다 */
export type SafetyVerdict = 'pass' | 'hold' | 'drop' | 'access' | 'hardExclude'

/**
 * 🔴 사유 코드. **정치는 hardExclude 고 나머지와 급이 다르다** (§4-K).
 *    `volatile` 은 사유이지 제외가 아니다 — 아래 VOLATILE 주석 참조.
 */
export type SafetyReasonCode =
  | 'politics'            // ① 정치 hard block
  | 'noticeSlot'          // ② 공지 · 필독 · 추천 고정 슬롯
  | 'personalIdentity'    // ③ 실명 · 개인정보
  | 'medicalClaim'        // ④ 의료 처방 · 효능 단정
  | 'promotion'           // ⑤ 광고 · 홍보
  | 'hostility'           // ⑥ 욕설 · 혐오 · 분쟁 유도
  | 'visualDependent'     // ⑦ 이미지 의존
  | 'access'              // ⑧ Access · deletedOrExpired
  | 'volatile'            // 🟡 펑 · 삭제예정 — Drop 이 아니다
  /**
   * 🔴 ⑨ 자해 · 자살 위기 신호 — 정본 §4 가 **선행 차단**으로 못박은 축이다.
   *    2026-09-16 까지 코드에 한 줄도 없었다.
   */
  | 'crisisSignal'
  /** 🔴 ⑩ 치료·기기·약물의 부작용·교체·중단·계속 사용 판단을 커뮤니티에 요청 */
  | 'medicalDecisionRequest'
  /** 🔴 ⑪ 건강 효능 주장 — 전언형(*"~라고 한다"*)도 면제하지 않는다 */
  | 'healthEfficacyClaim'

export type SafetyReason = { code: SafetyReasonCode; note: string }

export type SafetyResult = {
  verdict: SafetyVerdict
  reasons: SafetyReason[]
  /** 사람이 읽는 한 줄. 🔴 원문을 담지 않는다 — 사유 라벨만 */
  summary: string
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
  /** 🔴 저장된 행의 값 — 옛 사유(`publicFigure`)는 정치로 읽는다(`isPoliticsExcludeReason`) */
  sourceExcludeReason?: string | null
  qualityFlags?: readonly string[]
  /** 상세 열람 결과. 못 읽었으면 이유를 준다 */
  accessStatus?: 'ok' | 'deletedOrExpired' | 'permissionDenied' | 'renderFailed' | 'unknown'
  /** 본문 안 이미지 수 (상세 단계에서만 안다) */
  imageCount?: number
}

// ─────────────────────────────────────────────────────────
// 어휘 — 🔴 정치만 quality lib 을 재사용한다. 나머지는 여기서 정의한다
// ─────────────────────────────────────────────────────────

/** ② 고정 슬롯 라벨. 🔴 navercafe 의 ROW_LABELS 와 같아야 한다 (fixture 가 대조한다) */
export const NOTICE_LABELS: readonly string[] = ['공지', '필독', '추천'] as const
const NOTICE_TITLE = /^\s*[[(【]?\s*(공지|필독|추천|안내|이벤트 안내)\s*[\])】]?/

/** ③ 실명 · 개인정보 — 🔴 "누가" 가 아니라 "무엇이 노출되는가" 를 본다 */
const PERSONAL_IDENTITY =
  /주민(등록)?번호|계좌번호|카드번호|여권번호|전화번호 ?(알려|드릴|공유)|010-?\d{3,4}-?\d{4}|[가-힣]{2,3} ?(씨|님) ?(연락처|주소|직장)|실명 ?(공개|까)|신상 ?(털|공개)/

/**
 * ④ 의료 — 🔴 **주제를 막는 것이 아니다** (§4-J).
 *    당뇨 · 혈압 · 갱년기 · 관절 · 질유산균은 타겟 핏이 높은 생활 주제다.
 *    막는 것은 **처방 · 치료 선택 · 효능 단정 · 시술 유도**다.
 */
const MEDICAL_CLAIM =
  /처방|복용법|용량|투약|완치|특효|즉효|낫는다|낫습니다|효과 ?(직빵|확실|보장)|부작용 ?없|도수치료|물리치료|레이저 ?시술|시술 ?(받|하시|추천)|수술 ?(받|하시|추천)|주사 ?(맞|추천)|한약 ?(지어|추천)/

/** ⑤ 광고 · 홍보 */
const PROMOTION =
  /협찬|공구|공동구매|체험단|서포터즈|할인코드|쿠폰코드|추천인|링크 ?(타고|클릭)|구매 ?링크|카톡 ?문의|디엠 ?문의|DM ?문의|문의 ?주세요|판매합니다|팝니다|분양|입금|계좌/

/** ⑥ 욕설 · 혐오 · 분쟁 유도 */
const HOSTILITY =
  /[시씨]발|개[새쉐]끼|병신|지랄|미친년|미친놈|꺼져|죽어라|틀딱|맘충|한남|김치녀|일베|메갈|찢[재짜]|쥐박|극혐|패[죽]|고소각|박제/

/** ⑦ 이미지 의존 — 🔴 이미지를 가져오겠다는 뜻이 아니다. **쓸 수 없다는 표시**다 */
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
 * 안전 · 브랜드 필터 8종.
 *
 * 🔴 **이 함수는 발행을 승인하지 않는다.** 위험 여부만 답한다.
 *    100자 미만 여부(§4-Y)도, 레인 배정(§4-U)도 여기서 하지 않는다.
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

  // ⑧ Access — 🔴 못 읽은 것은 판정이 아니다. 가장 먼저 가른다 (§4-W ⑥)
  if (input.accessStatus && input.accessStatus !== 'ok') {
    add('access', `읽지 못함(${input.accessStatus})`, 'access')
  }

  // ① 정치 — 🔴 hardExclude. 어디에도 가지 않는다 (§4-K)
  // 🔴 정치 주제(본문까지) + 제목의 정치 인물(P0-3) — 82cook · 네이버카페가 같은 판정을 지난다. 연예 · 방송 이름은 보지 않는다
  const politicsHit = findPoliticalTopicHit(title) ?? findPoliticalTopicHit(body) ?? findPoliticalFigureHits(title)[0] ?? null
  if (isPoliticsExcludeReason(input.sourceExcludeReason) || politicsHit) {
    add('politics', politicsHit ? `정치 키워드(${politicsHit})` : '수집기 정치 판정', 'hardExclude')
  }

  // ② 공지 · 필독 · 추천 고정 슬롯 — 🔴 조회수가 압도적이라 점수로는 못 막는다
  const label = (input.sourceRowLabel ?? '').trim()
  if (input.sourcePinned === true || input.sourceExcludeReason === 'pinned'
    || NOTICE_LABELS.includes(label) || NOTICE_TITLE.test(title)) {
    add('noticeSlot', label !== '' ? `고정 슬롯(${label})` : '공지·필독·추천', 'hardExclude')
  }

  // ③ 개인정보 — 🔴 **비공개 개인이 특정되는 것만 본다** (2026-09-13 정정)
  //    옛 판은 `publicFigure` · `publicFigureMention` 도 같은 사유로 hold 했다.
  //    그건 위해가 아니라 **소재**다 — 공개 인물 이름이 나왔다는 사실뿐이고,
  //    그 이름이 제목에 남아 있어야 사람이 검색으로 들어온다.
  //    `PERSONAL_IDENTITY` 는 주민번호·계좌·연락처·신상털기만 잡는다. 그것이 위해다.
  const ident = has(PERSONAL_IDENTITY, title, body, cmtText)
  if (ident) add('personalIdentity', '개인정보 노출 표현', 'hold')

  // ④ 의료 — 🔴 주제가 아니라 단정·시술 유도를 본다 (§4-J)
  //    🔴 `medicalOrAdLikely` 플래그만으로는 막지 않는다 (2026-09-13 정정).
  //    그 플래그는 "의료 **또는** 광고" 라서 갱년기·불면 경험담까지 물었다.
  //    광고는 아래 ⑤ PROMOTION 이 따로 본다.
  const med = has(MEDICAL_CLAIM, title, body, cmtText)
  if (med) add('medicalClaim', `의료 단정·시술(${med})`, 'hold')

  // ⑤ 광고 · 홍보
  const promo = has(PROMOTION, title, body, cmtText)
  if (promo) add('promotion', `광고·홍보 표현(${promo})`, 'hold')

  // ⑥ 욕설 · 혐오 · 분쟁 유도 — 🔴 커뮤니티 성격을 바꾼다. 쓰지 않는다
  const hostile = has(HOSTILITY, title, body, cmtText)
  if (hostile) add('hostility', '욕설·혐오·분쟁 유도', 'drop')

  // ⑦ 이미지 의존 — 🔴 이미지 없이는 재사용이 안 된다 (§4-Q)
  //    본문이 거의 없고 이미지만 있는 경우도 같다
  const visual = has(VISUAL_DEPENDENT, title, body)
  const imageOnly = (input.imageCount ?? 0) > 0 && body.trim().length > 0 && body.trim().length < 30
  if (visual || imageOnly || flags.includes('imageLikelyBody')) {
    add('visualDependent', visual ? '이미지 의존 표현' : '본문이 거의 없고 이미지 중심', 'drop')
  }

  /**
   * ⑨⑩⑪ 🔴 **위기 신호 · 의료 판단 요청 · 건강 효능 주장** (2026-09-16 추가).
   *
   *    셋 다 `hold` 다 — 버리지 않고 **사람에게 넘긴다.** 정본 §4 의 `crisis_hold`
   *    가 "운영자 알림 → 필요 시 사람이 수동 대응" 이라고 적은 그 자리다.
   *    🔴 판정은 `judgeSafetySignals` 하나가 한다. 여기서 규칙을 다시 쓰지 않는다.
   */
  for (const sig of judgeSafetySignals({ title, body, comments })) {
    add(sig.code, sig.note, 'hold')
  }

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

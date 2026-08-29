/**
 * 창업자 수동 판정을 정책 데이터로 정규화한다 — **side effect 가 없는 순수 함수만** 둔다
 *
 * 🔴 왜 목적을 나누는가
 *    "학습 O" 와 "여성 화자" 는 같은 말이 아니다.
 *      - 대표20 "학습 O" · V40R2 "voice/style 학습 O"
 *        → 사람이 **말투까지** 학습 가능하다고 본 판정
 *      - speaker-b1 "여성 화자"
 *        → **화자 성별만** 확인한 판정. 말투 품질을 승인한 것이 아니다
 *    이 둘을 femaleVoice 하나로 뭉치면 **화자만 확인한 글을 말투 승인으로 착각한다.**
 *    실측으로도 갈린다 — humanVoiceApproved 63건 중 17건은 자동 기준으로 story_topic 이다.
 *
 * 🔴 왜 memo 를 커밋하지 않는가
 *    창업자 자유문에는 민감 표현이나 원문 조각이 섞일 수 있다.
 *    `reasonCodes` 로 정규화하고, 매핑에 없는 것은 `OTHER` 로 두고 **원문은 버린다.**
 *    fixture 가 커밋 파일에 memo · verdict 원문이 없는지 검사한다.
 */

/** 수동 판정 분류 — 🔴 목적별로 나눈다 */
export const MANUAL_CLASSES = [
  /** 사람이 **말투까지** 학습 가능하다고 본 판정 (대표20 "학습 O" · V40R2 "voice/style 학습 O") */
  'humanVoiceApproved',
  /** **화자 성별만** 확인한 판정 (speaker-b1 "여성 화자"). 말투 품질 승인이 아니다 */
  'speakerFemaleOnly',
  /** 남성 화자 — voice 계열 제외, 사건 구조는 사용 가능 */
  'male',
  /** 여성이나 말투가 부적합 — 사건 구조만 */
  'storyOnly',
  /** 불명확 · 보류 · 근거 애매 — 학습에 쓰지 않는다 */
  'held',
  /** 사람이 제외 — 자동 점수와 무관하게 모든 학습에서 뺀다 */
  'excluded_manual',
] as const
export type ManualClass = (typeof MANUAL_CLASSES)[number]

/**
 * 🔴 판정 근거 정규화 — 원본 자유문을 코드로 바꾼다.
 *    커밋되는 것은 이 코드뿐이고 원본 문자열은 저장하지 않는다.
 */
export const REASON_CODE_MAP: Readonly<Record<string, string>> = {
  '소란소란 톤 맞음': 'TONE_FIT',
  '소란소란 여성 말투 맞음': 'TONE_FIT',
  '사적인 경험이라 학습 가치 있음': 'PRIVATE_ASSET',
  '오타/줄바꿈/이모티콘 자연스러움': 'NATURAL_TYPING',
  '댓글 반응 구조 좋음': 'GOOD_ENGAGEMENT',
  '감정 강도 괜찮음': 'EMOTION_OK',
  '감정 강도 과함': 'EMOTION_OVER',
  '남성 화자': 'SPEAKER_MALE',
  '성별/화자 불일치': 'SPEAKER_MALE',
  '화자 불명확': 'SPEAKER_UNCLEAR',
  '연령대 불일치': 'AGE_MISMATCH',
  '식별 디테일 일반화 필요': 'IDENT_DETAIL',
  '식별 디테일 과다': 'IDENT_DETAIL',
  '원문 모방 위험': 'MIMICRY_RISK',
  '뉴스/광고/공고/UI/시 등 오염': 'CONTAMINATED',
  '광고/마케팅': 'CONTAMINATED',
  '카페 공지 잔여물': 'CAFE_NOTICE_LEFT',
  '영상/이미지 중심': 'MEDIA_CENTRIC',
  '판정 근거 애매': 'AMBIGUOUS',
}

/** 매핑에 없는 근거는 이 코드로 접고 **원본은 버린다** */
export const OTHER_REASON_CODE = 'OTHER'

/** 🔴 커밋 가능한 필드. 여기 없는 것은 정규화 결과에 담지 않는다 */
export const ALLOWED_DECISION_FIELDS = ['sourceRef', 'class', 'reasonCodes', 'source', 'speakerHint'] as const

/** 🔴 커밋 · 산출물 어디에도 나가면 안 되는 것 */
export const FORBIDDEN_DECISION_FIELDS = [
  'memo', 'verdict', 'sourceUrl', 'content', 'topComments', 'author', 'title', 'url', 'notes', 'body', 'comments',
] as const

/** 판정 파일 한 항목의 원본 형태 (세 파일의 스키마가 조금씩 다르다) */
export type RawDecisionItem = {
  sourceRef: string
  verdict?: string
  /** 대표20 · V40R2 는 reasons, speaker-b1 은 flags 로 같은 것을 담는다 */
  reasons?: string[]
  flags?: string[]
  isAnchor?: boolean
  memo?: string
}

export type NormalizedDecision = {
  sourceRef: string
  class: ManualClass
  reasonCodes: string[]
  source: string
  /** 🔴 held 로 흡수돼도 "남성이었다" 는 정보를 잃지 않는다 */
  speakerHint?: 'male'
}

const rawReasons = (i: RawDecisionItem): string[] => i.reasons ?? i.flags ?? []

/** 남성 단서 — verdict 뿐 아니라 reason 배열에서도 읽는다 */
export function hasMaleHint(i: RawDecisionItem): boolean {
  return i.verdict === '남성 화자'
    || rawReasons(i).includes('남성 화자')
    || rawReasons(i).includes('성별/화자 불일치')
}

/**
 * verdict → ManualClass.
 * 🔴 판정 순서가 곧 정책이다. 제외 · 보류가 화자 판정보다 앞선다.
 */
export function classifyDecision(i: RawDecisionItem): ManualClass | null {
  const v = i.verdict ?? ''
  if (v === '제외') return 'excluded_manual'
  if (v === '리뷰 보류' || v === '불명확') return 'held'
  if (hasMaleHint(i)) return 'male'
  if (v === 'story/topic만 O' || v === 'story_topic만 가능') return 'storyOnly'
  // 🔴 여기서 갈린다 — 말투 승인 vs 화자 확인
  if (v === '학습 O' || v === 'voice/style 학습 O') return 'humanVoiceApproved'
  if (v === '여성 화자') return 'speakerFemaleOnly'
  return null
}

/** 자유문 근거를 코드로 바꾼다. 🔴 원본 문자열은 반환하지 않는다 */
export function toReasonCodes(i: RawDecisionItem): string[] {
  const codes = new Set<string>()
  for (const r of rawReasons(i)) {
    codes.add(REASON_CODE_MAP[r] ?? OTHER_REASON_CODE)
  }
  return [...codes].sort()
}

/**
 * 여러 판정 파일을 하나로 병합한다.
 * 🔴 `sources` 는 **우선순위 순서**로 넘긴다 — 앞에 있는 것이 이긴다(나중 판정 우선).
 *    현재 충돌은 0건이지만, 배치를 더 진행하면 생길 수 있어 규칙을 명시해 둔다.
 */
export function normalizeDecisions(
  sources: ReadonlyArray<{ name: string; items: readonly RawDecisionItem[] }>,
): { decisions: Map<string, NormalizedDecision>; conflicts: Array<{ sourceRef: string; kept: string; dropped: string }> } {
  const decisions = new Map<string, NormalizedDecision>()
  const conflicts: Array<{ sourceRef: string; kept: string; dropped: string }> = []
  for (const src of sources) {
    for (const item of src.items) {
      // 🔴 앵커는 기준 확인용이지 데이터가 아니다
      if (item.isAnchor === true) continue
      const cls = classifyDecision(item)
      if (cls === null) continue
      const prev = decisions.get(item.sourceRef)
      if (prev !== undefined) {
        if (prev.class !== cls) conflicts.push({ sourceRef: item.sourceRef, kept: prev.class, dropped: cls })
        continue
      }
      const d: NormalizedDecision = {
        sourceRef: item.sourceRef, class: cls, reasonCodes: toReasonCodes(item), source: src.name,
      }
      if (hasMaleHint(item)) d.speakerHint = 'male'
      decisions.set(item.sourceRef, d)
    }
  }
  return { decisions, conflicts }
}

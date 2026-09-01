/**
 * 말투 샘플 선별 — 🔴 순수 함수. DB · 파일 IO · 네트워크 · LLM 없음
 *
 * 정본: docs/operations/2026-08-29-voice-m3-export-design.md
 *       docs/operations/decisions/ve-m3-manual-decisions.json (창업자 수동 판정)
 *
 * 🔴 **이 파일이 존재하는 이유**
 *    PR A 첫 판은 MicroSeedRawContent 하나만 보고 글을 썼다. 그래서 나온 것이
 *    "소란소란 회원 글" 이 아니라 "AI 재작성 글" 이었다. 원문 하나가
 *    **소재와 말투를 겸했기 때문**이다.
 *
 *    voice engine 은 이미 9,674건을 분석했고 사람이 3,093건을 판단했다.
 *    그 산출물이 생성기에 한 줄도 연결돼 있지 않았다 —
 *    `voice-m3-provider` 는 이름만 voice 일 뿐 **API 호출 통로**다.
 *    이 파일이 그 연결선이다.
 *
 * 🔴 **본문을 다루지 않는다.**
 *    입력도 출력도 sourceRef 와 신호뿐이다. 산출물 jsonl 에 애초에 본문이 없고
 *    (26키 전부 신호), 본문은 우나어 DB 에서 읽는다.
 *    여기서 본문을 만지면 "선별 규칙" 과 "본문 조달" 이 한 파일에 섞여
 *    fixture 가 DB 없이 규칙을 검증할 수 없게 된다.
 *
 * 🔴 **사람 판정이 자동 점수를 이긴다.**
 *    select-learning 이 이미 그렇게 정했다(§6). 여기서도 같다 —
 *    점수가 아무리 좋아도 사람이 뺀 것은 뺀다.
 */

/** voice-m3-learning 산출물 jsonl 한 줄에서 이 파일이 보는 것만 */
export type VoiceLearningRow = {
  sourceRef: string
  sourceSite?: string
  bucket?: string
  /** 🟢 높을수록 좋다 */
  naturalnessScore?: number | null
  voiceRetention?: number | null
  originalityDelta?: number | null
  /** 🔴 낮을수록 좋다 */
  overSanitizedRisk?: number | null
  overMimicryRisk?: number | null
  expressionRisk?: number | null
  sequenceSimilarityRisk?: number | null
  /** 🔴 있으면 제외 — 샘플로 쓰면 식별 정보가 생성물로 흘러갈 수 있다 */
  hasIdentifyingDetail?: boolean | null
  isPrivateTopic?: boolean | null
  /** 사람이 화자를 확인했는가 */
  speakerVerified?: boolean | null
  manualClass?: string | null
  speakerHint?: string | null
  originalLength?: number | null
  cleanedLength?: number | null
}

/** ve-m3-manual-decisions.json 한 줄 — 🔴 파일명을 여기서 짓지 않는다. 호출부가 찾아 넘긴다 */
export type ManualDecisionRow = {
  sourceRef: string
  class: string
  speakerHint?: string | null
}

// ─────────────────────────────────────────────────────────
// 기준값 — 🔴 여기서 새로 정하지 않는다. voice-m3-export 가 이미 쓰는 값이다
// ─────────────────────────────────────────────────────────

/**
 * 🟢 높아야 하는 신호의 하한.
 * voice-m3-export.mts 의 "초안 조건" 과 같은 값이다 —
 * 두 곳이 다른 눈금을 쓰면 "export 는 통과인데 생성기는 제외" 가 생긴다.
 */
export const MIN_NATURALNESS = 70
export const MIN_VOICE_RETENTION = 70
export const MIN_ORIGINALITY_DELTA = 60
/** 🔴 낮아야 하는 위험 4종의 상한 */
export const MAX_RISK = 30

export const HIGH_SIGNAL_KEYS = ['naturalnessScore', 'voiceRetention', 'originalityDelta'] as const
export const RISK_KEYS = [
  'overSanitizedRisk', 'overMimicryRisk', 'expressionRisk', 'sequenceSimilarityRisk',
] as const

/**
 * 🔴 사람이 뺀 것 — 자동 점수와 무관하게 제외한다.
 *
 * `male` 은 화자가 남성이라 **말투** 로 쓸 수 없다(사건 구조는 story_topic 으로 따로 쓴다).
 * `held` 는 근거가 애매해 보류된 것이고, 보류를 통과로 읽으면 보류의 의미가 없어진다.
 */
export const EXCLUDED_MANUAL_CLASSES: readonly string[] = ['male', 'held', 'excluded_manual']

/** 🔴 말투 샘플로 쓸 수 있는 bucket. story_topic 은 **말투가 아니다** — 화자 성별 무관이다 */
export const VOICE_BUCKETS: readonly string[] = ['voice_gold', 'voice_silver']

export type ExclusionCode =
  | 'MANUAL_EXCLUDED'
  | 'MALE_HINT'
  | 'BUCKET_NOT_VOICE'
  | 'IDENTIFYING_DETAIL'
  | 'PRIVATE_TOPIC'
  | 'SIGNAL_MISSING'
  | 'SIGNAL_BELOW_MIN'
  | 'RISK_ABOVE_MAX'

export type SampleCandidate = {
  sourceRef: string
  bucket: string
  /** 사람이 말투까지 승인한 건 — 정렬에서 앞에 온다 */
  humanApproved: boolean
  speakerVerified: boolean
  /** 정렬용 합산 점수. 🔴 판정이 아니라 순서다 */
  score: number
}

export type SelectPlan = {
  /** 🔴 sourceRef 만. 본문은 여기 없다 */
  picked: readonly SampleCandidate[]
  /** 왜 빠졌는가 — 코드별 건수. 사람이 "왜 이 글이 없나" 를 물을 자리다 */
  excluded: Readonly<Record<ExclusionCode, number>>
  /** 검토 대상 총 건수 */
  considered: number
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

/**
 * 한 행이 말투 샘플로 쓸 수 있는지 — 🔴 제외 사유를 **하나만** 돌려준다.
 *
 * 전부 모으지 않는 이유: 이건 사람에게 보여줄 목록이 아니라 집계다.
 * 첫 번째 사유만 세면 "가장 먼저 걸린 관문" 별로 분포가 나오고,
 * 그게 기준을 조일지 풀지 판단하는 데 필요한 값이다.
 */
export function excludeReason(
  row: VoiceLearningRow,
  manual: ManualDecisionRow | undefined,
): ExclusionCode | null {
  // 🔴 사람 판정이 먼저다. 점수보다 앞에서 본다
  if (manual !== undefined && EXCLUDED_MANUAL_CLASSES.includes(manual.class)) return 'MANUAL_EXCLUDED'
  if (manual?.speakerHint === 'male' || row.speakerHint === 'male') return 'MALE_HINT'
  if (row.manualClass !== null && row.manualClass !== undefined
      && EXCLUDED_MANUAL_CLASSES.includes(row.manualClass)) return 'MANUAL_EXCLUDED'

  if (!VOICE_BUCKETS.includes(row.bucket ?? '')) return 'BUCKET_NOT_VOICE'

  // 🔴 식별 디테일·민감 주제는 샘플로 넣는 순간 생성물로 흘러갈 길이 열린다
  if (row.hasIdentifyingDetail === true) return 'IDENTIFYING_DETAIL'
  if (row.isPrivateTopic === true) return 'PRIVATE_TOPIC'

  for (const k of HIGH_SIGNAL_KEYS) if (num(row[k]) === null) return 'SIGNAL_MISSING'
  for (const k of RISK_KEYS) if (num(row[k]) === null) return 'SIGNAL_MISSING'

  if ((num(row.naturalnessScore) ?? 0) < MIN_NATURALNESS) return 'SIGNAL_BELOW_MIN'
  if ((num(row.voiceRetention) ?? 0) < MIN_VOICE_RETENTION) return 'SIGNAL_BELOW_MIN'
  if ((num(row.originalityDelta) ?? 0) < MIN_ORIGINALITY_DELTA) return 'SIGNAL_BELOW_MIN'
  for (const k of RISK_KEYS) if ((num(row[k]) ?? 100) > MAX_RISK) return 'RISK_ABOVE_MAX'

  return null
}

const emptyExcluded = (): Record<ExclusionCode, number> => ({
  MANUAL_EXCLUDED: 0, MALE_HINT: 0, BUCKET_NOT_VOICE: 0, IDENTIFYING_DETAIL: 0,
  PRIVATE_TOPIC: 0, SIGNAL_MISSING: 0, SIGNAL_BELOW_MIN: 0, RISK_ABOVE_MAX: 0,
})

/**
 * 말투 샘플을 고른다.
 *
 * 🔴 정렬이 결정적이어야 한다. 부를 때마다 샘플이 바뀌면
 *    "프롬프트를 고쳤더니 좋아졌다" 와 "샘플이 바뀌어 좋아졌다" 를 구분할 수 없다.
 *    사람 승인 → 화자 확인 → 점수 → sourceRef 순으로 완전히 고정한다.
 */
export function selectVoiceSamples(input: {
  rows: readonly VoiceLearningRow[]
  decisions: readonly ManualDecisionRow[]
  limit: number
}): SelectPlan {
  const byRef = new Map(input.decisions.map((d) => [d.sourceRef, d]))
  const excluded = emptyExcluded()
  const picked: SampleCandidate[] = []
  const seen = new Set<string>()

  for (const row of input.rows) {
    // 🔴 같은 글이 gold 와 silver 양쪽 파일에 있을 수 있다. 한 번만 센다
    if (seen.has(row.sourceRef)) continue
    seen.add(row.sourceRef)

    const manual = byRef.get(row.sourceRef)
    const reason = excludeReason(row, manual)
    if (reason !== null) {
      excluded[reason] += 1
      continue
    }
    const humanApproved =
      manual?.class === 'humanVoiceApproved' || row.manualClass === 'humanVoiceApproved'
    picked.push({
      sourceRef: row.sourceRef,
      bucket: row.bucket ?? '',
      humanApproved,
      speakerVerified: row.speakerVerified === true,
      score: (num(row.naturalnessScore) ?? 0) + (num(row.voiceRetention) ?? 0)
        + (num(row.originalityDelta) ?? 0),
    })
  }

  // 🔴 사람이 말투까지 승인한 것이 가장 앞이다. 점수는 그 다음이다 —
  //    자동 점수는 "AI 가 보기에 자연스럽다" 이고, 사람 승인은 "사람이 읽어 봤다" 다
  picked.sort((a, b) =>
    Number(b.humanApproved) - Number(a.humanApproved)
    || Number(b.speakerVerified) - Number(a.speakerVerified)
    || (VOICE_BUCKETS.indexOf(a.bucket) - VOICE_BUCKETS.indexOf(b.bucket))
    || b.score - a.score
    || a.sourceRef.localeCompare(b.sourceRef))

  return {
    picked: picked.slice(0, Math.max(0, input.limit)),
    excluded,
    considered: seen.size,
  }
}

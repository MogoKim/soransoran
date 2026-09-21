/**
 * 자동 판정 Shadow — 🔴 **사람 판정을 사칭하지 않는다** (§4-AR)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AR
 *
 * 🔴 **이 파일이 내리는 결정은 사람의 결정이 아니다.**
 *    사람이 검수 화면에서 찍는 값은 `SEED` · `RAW` · `ADOPT` · `SAVE` 이고,
 *    그 글은 `human-curated` · `founder` 로 기록된다. **여기서는 그 값을 절대 쓰지 않는다.**
 *    기계 판정에는 `AUTO_` 접두가 붙은 별도 값과 provenance 를 쓴다.
 *
 *    왜 이게 중요한가: 자동 발행(§4-AL)은 *"사람이 고른 글"* 이라는 전제 위에 서 있다.
 *    기계 판정이 사람 판정과 같은 값으로 기록되면 **그 전제가 조용히 무너지고,
 *    나중에 어느 글이 사람 손을 거쳤는지 아무도 구분할 수 없게 된다.**
 *
 * 🔴 **보수적으로 짠다.** 애매하면 통과가 아니라 `AUTO_HOLD` 다.
 *    `AUTO_HOLD` 는 실패가 아니라 **자동 격리** — "기계가 판단하지 않기로 했다" 는 뜻이다.
 *    위험한 글이 통과하는 것(false pass)은 0이어야 하고,
 *    통과했어야 할 글이 HOLD 로 가는 것(false hold)은 비용일 뿐이다.
 *
 * 🔴 **같은 판단을 새로 쓰지 않는다.** 정치·안전·축 판정은 이미 정본이 있다.
 *    여기서는 그 결과를 **읽어서 조합만** 한다 — 새 정규식을 만들지 않는다.
 */

/** 🔴 사람 값과 절대 겹치지 않는 이름 */
export const AUTO_DECISIONS = ['AUTO_SEED', 'AUTO_RAW', 'AUTO_HOLD', 'AUTO_DROP'] as const
export type AutoDecision = (typeof AUTO_DECISIONS)[number]

/** 🔴 사람이 쓰는 값 — 기계가 이 값을 내면 안 된다. fixture 가 검사한다 */
export const HUMAN_DECISIONS = ['SEED', 'RAW', 'ADOPT', 'SAVE', 'HOLD', 'DROP', 'REVISE'] as const
export const HUMAN_PROVENANCE = ['human-curated', 'founder'] as const

/** 규칙을 고치면 올린다 — 어느 판이 내린 결정인지 나중에 알 수 있어야 한다 */
// 🔴 v2 — Semantic Shadow. v1 결과와 섞이지 않게 판을 올린다
// 🔴 v3 — 정책 taxonomy 가 모델 decision 을 이긴다. v2 캐시와 섞이지 않는다
export const RULE_VERSION = 'auto-judge-v3'
/** 프롬프트를 고치면 올린다 — 같은 규칙판이라도 물음이 달라지면 답이 달라진다 */
/**
 * 🔴 **v2c** (2026-09-16) — 위해 축에 `crisisSignal` · `medicalDecisionRequest` ·
 *    `healthEfficacyClaim` 셋을 더했다. 프롬프트가 바뀌었으므로 판을 올린다 —
 *    올리지 않으면 옛 판정이 캐시에서 그대로 hit 된다.
 */
export const PROMPT_VERSION = 'semantic-shadow-v2c'

/** 🔴 이 값으로 기록한다. 사람 것과 한 글자도 겹치지 않는다 */
export const AUTO_PROVENANCE = 'machine-shadow'

export type ReasonCode =
  | 'axisSeed' | 'axisRaw'
  | 'notEligibleAxis' | 'accessNotOk' | 'safetyNotPass'
  | 'noArticleId' | 'noBodyLength'
  | 'politics' | 'personalIdentity' | 'medicalClaim' | 'promotion'
  | 'hostility' | 'visualDependent' | 'noticeSlot' | 'volatile'
  | 'unknownReason' | 'hardExclude' | 'dropAxis'
  | 'laneNotProven' | 'assetHealth'
  | 'medicalOrAd' | 'noTitle' | 'noBodyHead' | 'bodyHeadTooLong'
  | 'semanticUnavailable' | 'lowConfidence' | 'semanticDrop' | 'semanticHold' | 'semanticFailed'
  | 'unexplainedModelDrop' | 'axisMismatch'
  | SemanticRisk

export const REASON_LABEL: Record<ReasonCode, string> = {
  axisSeed: '축이 seedOriginality 다',
  axisRaw: '축이 rawOriginality 다',
  notEligibleAxis: '통과 축이 아니다 (seedOriginality · rawOriginality 만)',
  accessNotOk: '읽지 못한 글이다',
  safetyNotPass: 'safety 가 pass 가 아니다',
  noArticleId: '글 id 가 없다',
  noBodyLength: '본문 길이가 없다',
  politics: '🔴 정치 · 진영',
  personalIdentity: '🔴 실명 · 개인정보',
  medicalClaim: '🔴 의료 처방 · 효능 단정',
  promotion: '🔴 광고 · 홍보',
  hostility: '🔴 욕설 · 혐오 · 분쟁',
  visualDependent: '이미지 의존',
  noticeSlot: '공지 · 고정 슬롯',
  volatile: '펑 · 삭제 예정',
  unknownReason: '🔴 모르는 사유 — 규칙이 아직 이걸 다루지 않는다',
  hardExclude: '🔴 hardExclude',
  dropAxis: '축이 drop 이다',
  laneNotProven: '사람이 통과시킨 적 없는 lane 이다',
  assetHealth: '몸·건강 소재다 — 진단·처방으로 흐를 수 있다 (§4-J)',
  medicalOrAd: '의료 또는 광고성 플래그 — 🔴 둘 중 어느 쪽인지는 이 신호로 알 수 없다',
  noTitle: '제목이 없다 — 의미를 볼 수 없다',
  noBodyHead: '본문 머리가 없다 — 의미를 볼 수 없다',
  bodyHeadTooLong: '🔴 bodyHead 가 300자를 넘는다 — 전문이 섞였을 수 있다',
  semanticUnavailable: '의미 판정을 받지 못했다 (타임아웃 · 파싱 실패 · 키 없음)',
  lowConfidence: '모델이 확신하지 못했다',
  semanticDrop: '🔴 의미 판정이 버리라고 했다',
  semanticHold: '의미 판정이 사람에게 넘겼다',
  purchaseOrSellerRequest: '🔴 구매처 · 판매처를 묻는 글',
  brandListBait: '🔴 댓글이 브랜드 나열로 흐를 소재',
  insufficientContext: '판단할 만큼 내용이 없다',
  identifiablePrivatePerson: '🔴 비공개 개인을 알아볼 수 있다 (공인은 해당하지 않는다)',
  unverifiedDefamation: '🔴 확인되지 않은 범죄 · 불륜 · 질병을 사실로 단정한다',
  targetedHarassmentOrThreat: '🔴 특정인을 향한 위협 · 괴롭힘 · 혐오 선동',
  dangerousMedicalInstruction: '🔴 약 · 용량 · 진단 · 치료를 확정적으로 지시한다 (경험담은 해당하지 않는다)',
  politicalCampaigning: '🔴 정치 · 진영 선동 (§4-K)',
  semanticFailed: '의미 판정 호출이 실패했다',
  unexplainedModelDrop: '🔴 모델이 버리라 했는데 버릴 사유를 대지 못했다 — 사람에게 넘긴다',
  axisMismatch: '모델이 다른 축을 말했다 — 축은 우리가 정한다',
  // 🔴 2026-09-16 — 정본 §4 위기 신호 · §5 조언 제한을 코드로 세운 축
  crisisSignal: '자해·자살 위기 신호 — 재생성하지 않고 사람이 본다 (정본 §4)',
  medicalDecisionRequest: '치료·기기·약물의 부작용·교체·중단·계속 사용 판단을 요청한다',
  healthEfficacyClaim: '건강 효능 주장 — 전언형이어도 통과시키지 않는다',
}

/**
 * 🔴 **통과를 막는 사유.** 하나라도 있으면 AUTO_PASS 가 아니다.
 *    정치·실명·의료·광고·적대는 `AUTO_DROP` 으로 확실히 버린다.
 */
export const HARD_BLOCK: readonly ReasonCode[] = [
  'politics', 'personalIdentity', 'medicalClaim', 'promotion', 'hostility',
  'hardExclude', 'dropAxis',
  'semanticDrop',
  'identifiablePrivatePerson', 'unverifiedDefamation',
  'targetedHarassmentOrThreat', 'dangerousMedicalInstruction', 'politicalCampaigning',
] as const

/**
 * 🟡 **격리 사유.** 버릴 만큼 확실하지도, 통과시킬 만큼 깨끗하지도 않다.
 *    사람이 보면 통과할 수도 있는 것들이라 버리지 않고 HOLD 로 남긴다.
 */
export const HOLD_REASONS: readonly ReasonCode[] = [
  'visualDependent', 'noticeSlot', 'volatile', 'unknownReason',
  'accessNotOk', 'safetyNotPass', 'noBodyLength',
  'laneNotProven', 'assetHealth',
  'medicalOrAd', 'noTitle', 'noBodyHead', 'bodyHeadTooLong',
  'semanticUnavailable', 'lowConfidence', 'semanticHold', 'semanticFailed',
  'unexplainedModelDrop', 'axisMismatch',
  'purchaseOrSellerRequest', 'brandListBait', 'insufficientContext',
] as const

/**
 * 🔴 **사람이 통과시킨 적 있는 lane 만.** 실측 근거다 —
 *    사람이 고른 9건은 전부 `originalRaw` · `microSeedQuestion` 이었고,
 *    `infoSeed` · `participationSeed` 는 **한 건도 통과된 적이 없다**(막힌 12건에만 있다).
 *    근거 없는 lane 을 기계가 처음 통과시키게 두지 않는다.
 */
export const PROVEN_LANES: readonly string[] = ['originalRaw', 'microSeedQuestion'] as const

/**
 * 🔴 **소재 축으로 격리하지 않는다** (2026-09-13, 창업자 결정).
 *
 *    옛 판은 `몸·건강` 축이 붙었다는 이유만으로 HOLD 했다.
 *    갱년기 · 불면 · 관절은 우리 고객이 가장 많이 쓰는 이야기다 —
 *    그 축을 통째로 격리하면 타겟 핏이 가장 높은 소재가 통째로 사라진다.
 *    위험한 것은 **약·용량·진단·치료를 확정적으로 지시하는 것**이고,
 *    그건 `dangerousMedicalInstruction` 이 본다.
 */
export const HOLD_ASSET_AXES: readonly string[] = [] as const

/**
 * 🔴 **v1 의 오진 기록 (2026-09-07).**
 *
 * 첫 판에서 회귀 false pass 4건이 나오자 `ALLOW_AUTO_PASS = false` 로 전역을 닫았다.
 * **그 진단이 틀렸다.** "자동 신호가 없다" 가 아니라 **판정 입력에 제목과 본문 머리를
 * 넣지 않았던 것**이다. 이미 저장돼 있던 `title` · `bodyHead` 300자를 안 봤으니
 * "구매처 문의" · "브랜드 나열 유도" · "약 추천" 을 구분할 방법이 없는 게 당연했다.
 *
 * 전역 스위치로 막는 것은 문제를 고치는 게 아니라 **수동 병목을 코드에 고정하는 것**이다.
 * v2 는 제목 + `bodyHead` 로 의미를 본다.
 */

/**
 * 🔴 위험 축 — semantic judge 가 이 이름으로 답한다.
 *
 * 🔴 **주제를 막지 않는다. 위해 행동을 막는다** (2026-09-13, 창업자 결정).
 *
 *    옛 판은 `celebrityOrBroadcast` · `healthScheduleOrMedicalAdvice` 처럼
 *    **소재 자체**를 위험으로 봤다. 그래서 이런 글이 전부 막혔다 —
 *      "미우새 보다가 남편이랑 또 말다툼했어요"
 *      "갱년기 때문에 잠을 못 자는데 다들 어떤가요"
 *      "스케일링 몇 년에 한 번씩 받으세요?"
 *    전부 40~60대 여성이 실제로 쓰는 글이고, 검색으로 사람이 들어오는 글이다.
 *    막을 이유가 없는 것을 막으면 남는 것은 **안전하지만 아무도 안 읽는 글**뿐이다.
 *
 *    바꾼 기준은 하나다 — **누군가에게 해가 되는가.**
 *      · 비공개 개인이 특정되는가
 *      · 확인되지 않은 것을 사실로 단정해 명예를 훼손하는가
 *      · 특정인을 향한 위협·괴롭힘·혐오 선동인가
 *      · 약·용량·진단·치료를 확정적으로 지시하는가
 *
 * 🔴 **정치는 그대로 막는다.** 허용 목록에 없고 헌법(§4-K)이 hardExclude 로 둔다.
 *    다만 옛 `politicsOrPublicFigure` 는 정치와 **공인 언급**을 한 이름에 묶고 있었다 —
 *    공인 이름이 나왔다는 이유로 막히던 것이 이 축이다. 둘을 갈랐다.
 */
export const SEMANTIC_RISKS = [
  'purchaseOrSellerRequest',
  'brandListBait',
  'insufficientContext',
  // 🔴 여기부터가 **위해** 축이다. 소재가 아니라 행동을 본다
  'identifiablePrivatePerson',
  'unverifiedDefamation',
  'targetedHarassmentOrThreat',
  'dangerousMedicalInstruction',
  'politicalCampaigning',
  /**
   * 🔴 **deterministic 판정과 같은 이름을 쓴다** (2026-09-16).
   *    `micro-seed-safety-signals` 의 `SAFETY_SIGNAL_CODES` 와 짝이다 —
   *    두 단계가 다른 이름을 쓰면 언젠가 한쪽만 고쳐진다.
   */
  'crisisSignal',
  'medicalDecisionRequest',
  'healthEfficacyClaim',
] as const
export type SemanticRisk = (typeof SEMANTIC_RISKS)[number]

/**
 * 🔴 **버리는 위험과 격리하는 위험.**
 *
 * 앞 다섯은 사람이 실제로 그 이유로 막았다(2026-09-07 memo 실측).
 * `insufficientContext` 는 "모르겠다" 이므로 버리지 않고 사람에게 남긴다.
 */
/** 🔴 **위해다. 버린다.** 소재가 무엇이든 여기 걸리면 쓰지 않는다 */
export const SEMANTIC_DROP: readonly SemanticRisk[] = [
  'identifiablePrivatePerson', 'unverifiedDefamation',
  'targetedHarassmentOrThreat', 'dangerousMedicalInstruction',
  'politicalCampaigning',
] as const
/** 🟡 위해는 아니지만 그대로 쓰기 어려운 것 — 사람에게 넘긴다 */
export const SEMANTIC_HOLD: readonly SemanticRisk[] = [
  'purchaseOrSellerRequest', 'brandListBait', 'insufficientContext',
  /**
   * 🔴 **위기 신호는 버리지 않고 사람에게 넘긴다** (정본 §4).
   *    `crisis_hold` 로 남기고 운영자가 본다 — 재생성하지 않는다(§8).
   *    의료 판단 요청 · 건강 효능 주장도 소재 자체는 우리 주제라 버리지 않는다.
   */
  'crisisSignal', 'medicalDecisionRequest', 'healthEfficacyClaim',
] as const

/**
 * 🔴 **초안 검수에서 묻는 위해 축** (2026-09-16).
 *
 *    버리는 축(`SEMANTIC_DROP`)에 **안전 신호 축 3종**을 더한 것이다.
 *    목록을 새로 만들지 않는다 — 두 정본을 이어 붙이기만 한다.
 *    🔴 DROP 인지 HOLD 인지는 여기서 정하지 않는다. `SEMANTIC_DROP` 소속 여부가 정한다.
 */
export const DRAFT_HARM_AXES: readonly SemanticRisk[] = [
  ...SEMANTIC_DROP, 'crisisSignal', 'medicalDecisionRequest', 'healthEfficacyClaim',
] as const

/** 🔴 이 아래면 통과시키지 않는다 — 모델이 스스로 흔들린다고 말한 것이다 */
export const MIN_CONFIDENCE = 0.7

/** 🔴 우리가 아는 safety 사유 코드 — 여기 없는 것이 오면 `unknownReason` 이다 */
export const KNOWN_SAFETY_CODES: readonly string[] = [
  'politics', 'noticeSlot', 'personalIdentity', 'medicalClaim',
  'promotion', 'hostility', 'visualDependent', 'access', 'volatile',
  // 🔴 2026-09-16 추가 — 여기 없으면 `unknownReason` 으로 잡힌다
  'crisisSignal', 'medicalDecisionRequest', 'healthEfficacyClaim',
] as const

export const SEED_AXIS = 'seedOriginality'
export const RAW_AXIS = 'rawOriginality'

export type JudgeInput = {
  sourceArticleId?: string
  /** 🔴 v1 이 빠뜨렸던 것 — 이게 없으면 의미를 볼 수 없다 */
  title?: string
  /** 🔴 마스킹 후 앞 300자. **전문이 아니다** (§4-AF ⑤) */
  bodyHead?: string
  commentCount?: number
  axis?: string
  /** 목록·상세가 붙인 레인 힌트 */
  lane?: string
  /** 사연 축 — `|` 또는 쉼표로 이은 값 */
  assetAxes?: string
  /** 화면에 따라 키가 다르다 — 호출부가 맞춰서 넣는다 */
  access?: string
  safetyVerdict?: string
  /** `|` 로 이은 사유 코드. 비어 있으면 사유 없음 */
  safetyReasons?: string
  bodyLength?: number
  /** 목록 단계에서 붙은 품질 플래그 */
  qualityFlags?: readonly string[]
}

/**
 * 🔴 **실패를 한 덩어리로 세지 않는다.**
 *
 * v2 첫 판에서 `semanticUnavailable` 9건이 나왔는데, 타임아웃인지 HTTP 오류인지
 * 토큰 상한인지 JSON 파싱 실패인지 구분할 수 없었다. **원인이 다르면 대응도 다르다** —
 * 타임아웃은 재시도가 듣고, 파싱 실패는 형식을 고쳐 다시 묻고,
 * 키가 없는 것은 재시도해도 소용없다.
 */
export const SEMANTIC_STATUSES = [
  'ok', 'skipped', 'noKey', 'timeout', 'httpError', 'maxTokens', 'parseError',
] as const
export type SemanticStatus = (typeof SEMANTIC_STATUSES)[number]

/**
 * 🔴 **상세 한 줄 → 판정 입력.** 두 화면의 키 이름이 다르다 —
 *    `detail` 은 `access`, `raw-detail` 은 `accessStatus` 다.
 *    🔴 **이 변환은 저장소에 하나뿐이다.** 판정기도 작업 묶음도 이것만 부른다 —
 *       흉내 낸 파서를 두 벌 두면 한쪽이 정상 원천을 `accessNotOk` 로 덮는다
 *       (2026-09-20 검토에서 잡힌 결함).
 */
export function normalizeJudgeRow(
  raw: Record<string, unknown>, kind: 'detail' | 'raw-detail',
): JudgeInput | null {
  const id = S(raw.sourceArticleId)
  if (id === '') return null
  return {
    sourceArticleId: id,
    axis: S(raw.axis),
    // 🔴 키 이름이 화면마다 다르다. 여기서 맞춘다
    access: kind === 'detail' ? S(raw.access) : S(raw.accessStatus),
    title: S(raw.title), bodyHead: S(raw.bodyHead),
    commentCount: Number(raw.commentCount ?? 0),
    lane: S(raw.lane), assetAxes: S(raw.assetAxes),
    safetyVerdict: S(raw.safetyVerdict), safetyReasons: S(raw.safetyReasons),
    bodyLength: Number(raw.bodyLength ?? 0),
    qualityFlags: Array.isArray(raw.qualityFlags) ? raw.qualityFlags.map(String) : [],
  }
}

/**
 * 🔴 **원천 하나로 합친다.** `detail` 이 먼저, `raw-detail` 은 축이 `rawOriginality`
 *    일 때만 덮어쓴다 — 그 축이 더 최신 판정을 들고 있다.
 *    🔴 그 조건이 없으면 raw 행이 정상 detail 행을 지워 버린다.
 */
export function mergeJudgeRows(
  entries: readonly { kind: 'detail' | 'raw-detail'; row: Record<string, unknown> }[],
): JudgeInput[] {
  const byId = new Map<string, JudgeInput>()
  for (const e of entries.filter((x) => x.kind === 'detail')) {
    const v = normalizeJudgeRow(e.row, 'detail')
    if (v !== null) byId.set(S(v.sourceArticleId), v)
  }
  for (const e of entries.filter((x) => x.kind === 'raw-detail')) {
    const v = normalizeJudgeRow(e.row, 'raw-detail')
    if (v === null) continue
    const id = S(v.sourceArticleId)
    if (!byId.has(id) || S(v.axis) === RAW_AXIS) byId.set(id, v)
  }
  return [...byId.values()]
}

export type Judgement = {
  sourceArticleId: string
  decision: AutoDecision
  reasonCodes: ReasonCode[]
  ruleVersion: string
  provenance: string
  decidedAt: string
  // ── 아래는 판정 근거 추적용. 🔴 원문 · title · bodyHead 는 없다 ──
  model: string
  promptVersion: string
  /** 입력 지문 — 같은 입력을 두 번 묻지 않기 위한 것. 🔴 원문을 복원할 수 없다 */
  inputHash: string
  confidence: number | null
  semanticRisks: string[]
  communityAngle: string
  attemptCount: number
  semanticStatus: SemanticStatus
  providerErrorCode: string | null
}

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * 입력 지문 — 🔴 **같은 입력을 두 번 묻지 않기 위한 것이지 저장이 아니다.**
 *
 * 32비트 해시 둘을 이어 붙인다. 원문을 복원할 수 없고, 캐시 키로만 쓴다.
 * (암호학적 용도가 아니므로 crypto 를 끌어오지 않는다 — 이 파일은 순수해야 한다)
 */
export function inputHashOf(input: JudgeInput): string {
  const src = [
    S(input.title), S(input.bodyHead), S(input.axis), S(input.lane), S(input.assetAxes),
  ].join('\u0001')
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < src.length; i += 1) {
    const c = src.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193) >>> 0
    b = Math.imul(b + c, 0x85ebca6b) >>> 0
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`
}

/**
 * safety 사유를 코드로 읽는다 — 🔴 **모르는 것을 조용히 넘기지 않는다.**
 *
 * 새 사유 코드가 생겼는데 이 목록에 없으면 `unknownReason` 이 되고, 그 글은 HOLD 로 간다.
 * 그래야 **규칙이 모르는 위험이 통과하지 않는다.**
 */
export function readReasons(raw: string): ReasonCode[] {
  const out: ReasonCode[] = []
  for (const part of raw.split('|').map((x) => x.trim()).filter((x) => x !== '')) {
    // `code` 또는 `code:note` 두 모양을 다 받는다
    const code = part.split(':')[0]!.trim()
    if (code === 'access') { out.push('accessNotOk'); continue }
    if (KNOWN_SAFETY_CODES.includes(code)) { out.push(code as ReasonCode); continue }
    out.push('unknownReason')
  }
  return out
}

/** 목록 플래그 → 사유 코드. 🔴 여기서 새 규칙을 만들지 않고 이름만 옮긴다 */
export function readFlags(flags: readonly string[]): ReasonCode[] {
  const out: ReasonCode[] = []
  for (const f of flags) {
    if (f === 'politicalOrPublicFigure') out.push('politics')
    // 🔴 `medicalOrAdLikely` 는 이름 그대로 **의료 또는 광고**다. 둘을 가르는 정보가
    //    이 플래그에 없는데 v1 이 `medicalClaim` 으로 단정했다 — 사유를 왜곡한 것이다.
    //    이제 별도 코드로 남기고, 의료인지 광고인지는 semantic judge 가 본다.
    else if (f === 'medicalOrAdLikely') out.push('medicalOrAd')
    // 그 외 플래그(clickbaitTitle 등)는 통과를 막지 않는다 — 사람도 그걸로 버리지 않는다
  }
  return out
}

/** 🔴 semantic judge 가 돌려주는 것 — 모양이 어긋나면 HOLD 다 */
export type SemanticVerdict = {
  decision: AutoDecision
  confidence: number
  risks: SemanticRisk[]
  communityAngle: string
}

/**
 * 모델 응답을 읽는다 — 🔴 **모르는 것은 통과가 아니라 HOLD 다.**
 *
 * JSON 파싱 실패 · 없는 필드 · 모르는 값이 오면 `null` 이고, 호출부가 HOLD 로 보낸다.
 * 여기서 기본값을 지어내면 **모델이 답하지 못한 것이 통과가 된다.**
 */
export function parseSemantic(rawText: string): SemanticVerdict | null {
  let j: Record<string, unknown>
  try {
    const t = rawText.trim()
    j = JSON.parse(t.startsWith('{') ? t : `{${t}`) as Record<string, unknown>
  } catch { return null }
  const d = String(j.decision ?? '')
  if (!(AUTO_DECISIONS as readonly string[]).includes(d)) return null
  const conf = Number(j.confidence ?? NaN)
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) return null
  const rawRisks = Array.isArray(j.risks) ? j.risks.map(String)
    : Array.isArray(j.reasonCodes) ? j.reasonCodes.map(String) : []
  // 🔴 모르는 위험 이름이 오면 버리지 않고 남긴다 — insufficientContext 로 읽는다
  const risks: SemanticRisk[] = []
  for (const r of rawRisks) {
    if ((SEMANTIC_RISKS as readonly string[]).includes(r)) risks.push(r as SemanticRisk)
    else risks.push('insufficientContext')
  }
  return {
    decision: d as AutoDecision, confidence: conf,
    risks: [...new Set(risks)],
    communityAngle: String(j.communityAngle ?? '').slice(0, 120),
  }
}

/**
 * 🔴 **묻기 전에 이미 HOLD 인 것** (2026-09-20 정리)
 *
 *    `decide` 가 모델 답을 받고 나서 보던 격리 사유를 **한 함수로 모았다.**
 *    작업 묶음 선택도 같은 함수를 부른다 — 두 곳이 따로 판단하면
 *    결과가 정해진 원천에 판정 예산을 쓰고, 언젠가 한쪽만 고쳐진다.
 *
 * 🔴 규칙을 새로 만들지 않았다. `decide` 가 쓰던 그 목록·그 순서 그대로다.
 */
export function holdBeforeAsking(input: JudgeInput): ReasonCode[] {
  const out = [
    ...hardGate(input).filter((c) => HOLD_REASONS.includes(c)),
    ...preSemanticGate(input),
  ]
  const lane = S(input.lane)
  if (lane !== '' && !PROVEN_LANES.includes(lane)) out.push('laneNotProven')
  if (HOLD_ASSET_AXES.some((a) => S(input.assetAxes).includes(a))) out.push('assetHealth')
  return out
}

/**
 * ① deterministic hard gate — 🔴 **여기서 막히면 모델을 부르지도 않는다.**
 *
 * 돈이 아니라 순서의 문제다. 모델에게 물어본 뒤 막으면, 언젠가 모델 답이
 * 이 판정을 덮는 코드가 생긴다. **막을 것은 묻기 전에 막는다.**
 */
export function hardGate(input: JudgeInput): ReasonCode[] {
  const codes: ReasonCode[] = []
  const id = S(input.sourceArticleId)
  const axis = S(input.axis)
  if (id === '') codes.push('noArticleId')
  if (axis === 'drop') codes.push('dropAxis')
  if (S(input.safetyVerdict) === 'hardExclude') codes.push('hardExclude')
  codes.push(...readReasons(S(input.safetyReasons)))
  codes.push(...readFlags(input.qualityFlags ?? []))
  return dedupe(codes)
}

/** ② 모델에 물어볼 자격 — 🔴 못 물어보면 통과가 아니라 HOLD 다 */
export function preSemanticGate(input: JudgeInput): ReasonCode[] {
  const codes: ReasonCode[] = []
  if (S(input.access) !== 'ok') codes.push('accessNotOk')
  if (S(input.safetyVerdict) !== 'pass') codes.push('safetyNotPass')
  if (!(Number(input.bodyLength ?? 0) > 0)) codes.push('noBodyLength')
  const axis = S(input.axis)
  if (axis !== SEED_AXIS && axis !== RAW_AXIS) codes.push('notEligibleAxis')
  if (S(input.title) === '') codes.push('noTitle')
  const head = S(input.bodyHead)
  if (head === '') codes.push('noBodyHead')
  // 🔴 전문이 섞여 들어오면 여기서 멈춘다 — 입력에도 전문을 받지 않는다
  if (head.length > BODY_HEAD_MAX) codes.push('bodyHeadTooLong')
  return dedupe(codes)
}

/** 🔴 입력으로 받을 수 있는 본문 머리 상한. 저장 계약과 같은 값이다 */
export const BODY_HEAD_MAX = 300

/**
 * ③ deterministic post-gate — 🔴 **모델이 hardExclude 를 되돌릴 수 없다.**
 *
 * 모델이 `AUTO_SEED` 라고 답해도 위 두 게이트가 막았으면 막힌 채로다.
 * 이 순서가 뒤집히면 "모델이 괜찮다고 했다" 가 안전장치를 이기는 날이 온다.
 */
export type SemanticOutcome = {
  verdict: SemanticVerdict | null
  status: SemanticStatus
  attemptCount: number
  providerErrorCode: string | null
  model: string
}

export const SKIPPED: SemanticOutcome = {
  verdict: null, status: 'skipped', attemptCount: 0, providerErrorCode: null, model: '',
}

export function judgeOne(
  input: JudgeInput, now: string, outcome: SemanticOutcome = SKIPPED,
): Judgement {
  const id = S(input.sourceArticleId)
  const semantic = outcome.verdict
  const base = {
    sourceArticleId: id, ruleVersion: RULE_VERSION,
    provenance: AUTO_PROVENANCE, decidedAt: now,
    model: outcome.model, promptVersion: PROMPT_VERSION,
    inputHash: inputHashOf(input),
    confidence: semantic === null ? null : semantic.confidence,
    semanticRisks: semantic === null ? [] : [...semantic.risks],
    communityAngle: semantic === null ? '' : semantic.communityAngle,
    attemptCount: outcome.attemptCount,
    semanticStatus: outcome.status,
    providerErrorCode: outcome.providerErrorCode,
  }

  // ① 확실히 버릴 것 — 모델 답과 무관하다
  const hard = hardGate(input)
  const blocked = hard.filter((c) => HARD_BLOCK.includes(c))
  if (blocked.length > 0 || id === '') {
    return { ...base, decision: 'AUTO_DROP', reasonCodes: hard }
  }

  // ② 물어볼 자격
  // 🔴 hardGate 가 낸 것 중 **버리진 않지만 격리해야 하는 사유**도 여기서 받는다.
  //    안 받으면 volatile · unknownReason · medicalOrAd 가 조용히 통과한다.
  const pre = holdBeforeAsking(input)
  if (pre.length > 0) {
    return { ...base, decision: 'AUTO_HOLD', reasonCodes: dedupe([...hard, ...pre]) }
  }

  // ③ 모델 답이 없으면 통과가 아니다 — 🔴 왜 없는지를 사유로 남긴다
  if (semantic === null) {
    const why: ReasonCode = outcome.status === 'skipped' || outcome.status === 'noKey'
      ? 'semanticUnavailable' : 'semanticFailed'
    return { ...base, decision: 'AUTO_HOLD', reasonCodes: dedupe([...hard, why]) }
  }

  // 🔴 **최종 결정은 모델의 decision 문자열이 아니라 정책 taxonomy 가 내린다.**
  //
  //    v2 는 `drops.length > 0 || semantic.decision === 'AUTO_DROP'` 로 둘을 섞었다.
  //    그래서 모델이 AUTO_DROP 이라 답하면 위험 축이 무엇이든 버려졌고,
  //    447520(연예 소재)이 **Growth Issue 레인 후보로 보존되지 못하고 폐기**됐다(§4-C).
  //    모델은 위험을 **알려주는** 쪽이고, 그 위험을 어떻게 다룰지는 **정책이 정한다.**
  const risks = semantic.risks
  const drops = risks.filter((r) => SEMANTIC_DROP.includes(r))
  if (drops.length > 0) {
    return { ...base, decision: 'AUTO_DROP', reasonCodes: dedupe([...risks, 'semanticDrop']) }
  }
  const holds = risks.filter((r) => SEMANTIC_HOLD.includes(r))
  if (holds.length > 0) {
    return { ...base, decision: 'AUTO_HOLD', reasonCodes: dedupe([...risks, 'semanticHold']) }
  }
  // 🔴 모델이 버리라 했는데 **버릴 사유를 대지 못했다.** 버리지 않고 사람에게 넘긴다 —
  //    근거 없는 폐기는 되돌릴 방법이 없고, 그 글이 왜 사라졌는지 아무도 모르게 된다
  if (semantic.decision === 'AUTO_DROP') {
    return { ...base, decision: 'AUTO_HOLD', reasonCodes: dedupe([...risks, 'unexplainedModelDrop']) }
  }
  if (semantic.decision === 'AUTO_HOLD') {
    return { ...base, decision: 'AUTO_HOLD', reasonCodes: dedupe([...risks, 'semanticHold']) }
  }
  if (semantic.confidence < MIN_CONFIDENCE) {
    return { ...base, decision: 'AUTO_HOLD', reasonCodes: dedupe([...risks, 'lowConfidence']) }
  }

  // 🔴 위험 0 · 확신 충분 · 모델도 통과라 했다. 축은 여전히 우리가 정한다
  const axis = S(input.axis)
  const want: AutoDecision = axis === SEED_AXIS ? 'AUTO_SEED' : 'AUTO_RAW'
  if (semantic.decision !== want) {
    return { ...base, decision: 'AUTO_HOLD', reasonCodes: ['axisMismatch'] }
  }
  return { ...base, decision: want, reasonCodes: [axis === SEED_AXIS ? 'axisSeed' : 'axisRaw'] }
}

function dedupe(xs: readonly ReasonCode[]): ReasonCode[] {
  return [...new Set(xs)]
}

export type Summary = {
  total: number
  AUTO_SEED: number
  AUTO_RAW: number
  AUTO_HOLD: number
  AUTO_DROP: number
  /** 사유별 건수 — 왜 그렇게 됐는지 */
  byReason: Record<string, number>
}

export function summarize(js: readonly Judgement[]): Summary {
  const byReason: Record<string, number> = {}
  for (const j of js) for (const c of j.reasonCodes) byReason[c] = (byReason[c] ?? 0) + 1
  return {
    total: js.length,
    AUTO_SEED: js.filter((j) => j.decision === 'AUTO_SEED').length,
    AUTO_RAW: js.filter((j) => j.decision === 'AUTO_RAW').length,
    AUTO_HOLD: js.filter((j) => j.decision === 'AUTO_HOLD').length,
    AUTO_DROP: js.filter((j) => j.decision === 'AUTO_DROP').length,
    byReason,
  }
}

/**
 * 회귀 대조 — 🔴 **7건으로 정확도를 주장하지 않는다.**
 *
 * 사람이 이미 판정한 것과 기계 판정을 맞춰 보되, 이건 **표본이지 증명이 아니다.**
 * 여기서 보는 것은 하나뿐이다: **사람이 버린 것을 기계가 통과시켰는가.**
 * 그 반대(사람이 채택한 것을 기계가 HOLD)는 보수적이라 허용된다.
 */
export type RegressionRow = {
  sourceArticleId: string
  humanDecision: string
  autoDecision: AutoDecision
}

export function checkRegression(rows: readonly RegressionRow[]): {
  falsePass: RegressionRow[]
  conservative: RegressionRow[]
  agree: RegressionRow[]
} {
  const passed = (d: AutoDecision): boolean => d === 'AUTO_SEED' || d === 'AUTO_RAW'
  const humanKept = (d: string): boolean => ['SEED', 'RAW', 'ADOPT', 'SAVE'].includes(d)
  return {
    // 🔴 사람이 안 고른 것을 기계가 통과시켰다 — 이것이 0이어야 한다
    falsePass: rows.filter((r) => passed(r.autoDecision) && !humanKept(r.humanDecision)),
    // 🟡 사람은 골랐는데 기계는 안 골랐다 — 보수적인 쪽이라 괜찮다
    conservative: rows.filter((r) => !passed(r.autoDecision) && humanKept(r.humanDecision)),
    agree: rows.filter((r) => passed(r.autoDecision) === humanKept(r.humanDecision)),
  }
}

/** 🔴 기록 직전 관문 — 사람 값을 사칭하지 않았는지 */
export function violatesProvenance(row: Record<string, unknown>): string[] {
  const bad: string[] = []
  const d = String(row.decision ?? '')
  if (!(AUTO_DECISIONS as readonly string[]).includes(d)) {
    bad.push(`🔴 decision ${d} 은 AUTO_ 값이 아니다`)
  }
  if ((HUMAN_DECISIONS as readonly string[]).includes(d)) {
    bad.push(`🔴 decision ${d} 은 사람이 쓰는 값이다 — 사칭이다`)
  }
  const p = String(row.provenance ?? '')
  if ((HUMAN_PROVENANCE as readonly string[]).includes(p)) {
    bad.push(`🔴 provenance ${p} 은 사람 것이다 — 사칭이다`)
  }
  if (p !== AUTO_PROVENANCE) bad.push(`🔴 provenance 가 ${AUTO_PROVENANCE} 가 아니다`)
  for (const k of ['ruleVersion', 'decidedAt', 'sourceArticleId'] as const) {
    if (String(row[k] ?? '') === '') bad.push(`🔴 ${k} 가 비었다`)
  }
  if (!Array.isArray(row.reasonCodes)) bad.push('🔴 reasonCodes 가 배열이 아니다')
  return bad
}

/**
 * 오리지널 초안 판정 게이트 (originality gate)
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2-1 · §12-2
 *
 * 초안 하나에 **PASS · HOLD · BLOCK** 을 붙인다.
 *
 * 🔴 **새 규칙을 만들지 않는다.** 이미 main 에 있는 계측(analyzeDraft)을
 *    판정으로 묶을 뿐이다. 규칙을 여기서 새로 세우면 계측과 판정이 갈라지고,
 *    그렇게 갈라져 있어서 7판에 "계측은 잡는데 저장은 통과" 가 났다.
 *
 * 🔴 **순수 함수다.** DB 도 LLM 도 파일도 없다 —
 *    fixture 가 48건 전량을 네트워크 없이 다시 판정할 수 있어야 한다.
 *
 * 🔴 **저장하지 않는다.** 판정 결과는 화면과 검수 HTML 에만 나온다.
 *    OriginalPostRecord 는 sourceRawContentId · title · body 세 키 그대로다 —
 *    판정을 파일에 적기 시작하면 "판정이 곧 승인" 으로 읽히고,
 *    사람이 초안을 보는 단계가 슬그머니 사라진다.
 *
 * 세 등급이 갈리는 자리
 *   BLOCK  계약 위반. 사람이 봐도 살릴 수 없다 — 원문 유출 · 출처 · 금지어 · 실패 표현
 *   HOLD   신호 이상. 사람이 읽고 정한다 — 질문 과부족 · 어절 밴드 · 팽창/압축 · 디테일
 *   PASS   위 어느 것에도 걸리지 않음. **승인이 아니라 "검수 대기열로 보내도 된다"** 는 뜻이다
 */
import type { DraftSignals } from './original-post-prompt'
import type { ClosingIntent } from './source-profile'

export const GATE_VERDICTS = ['PASS', 'HOLD', 'BLOCK'] as const
export type GateVerdict = (typeof GATE_VERDICTS)[number]

/**
 * 🔴 어절 공유율은 **상한만 두면 안 된다.**
 *
 * 상한(35%)은 원문에 너무 붙은 글을 잡는다. 그런데 14판 #47·#48 이 3.7% · 6.1% 로
 * 나왔다 — 원문 122·173자를 2배로 부풀리면서 **원문에서 멀어진 채 분량만 채운** 신호다.
 * 낱말 대조로는 새 인물도 새 사건도 안 나오는데 값만 비정상으로 낮다.
 *
 * 🔴 상한 35% 는 실측으로 정했다. 창업자가 "완성도가 높다" 고 한 #25 가 32.3% 다 —
 *    20% 로 잡았으면 그 글이 HOLD 가 됐다. 기준은 판정을 따라가야지 그 반대가 아니다.
 */
export const WORD_SHARE_MIN = 0.08
export const WORD_SHARE_MAX = 0.35

/**
 * 🔴 팽창·압축 배율 = 초안 본문 길이 / 원문 본문 길이.
 *
 * PROMPT_BODY_MIN_CHARS 가 300 이라 122자 원문은 구조적으로 2배 넘게 부푼다.
 * 그 자체가 실패는 아니지만(#48 은 새 인물·사건 0), **읽어봐야 하는 자리**다.
 */
export const EXPAND_MAX = 2.5
export const COMPRESS_MIN = 0.30

/** 필수 디테일 보존율 하한. 원문 핵심이 이만큼은 남아야 한다 */
export const MUST_KEEP_MIN_RATIO = 0.8

/** BLOCK 사유 코드 — 문자열을 흩뿌리지 않는다. fixture 가 이 목록을 잠근다 */
export const BLOCK_REASONS = [
  'SOURCE_ECHO', 'ORIGIN_URL', 'ORIGIN_TRACE', 'EXTERNAL_ADDRESS',
  'BANNED_TERM', 'CRITIQUE_PHRASE', 'FORCED_CTA',
] as const
export type BlockReason = (typeof BLOCK_REASONS)[number]

/** HOLD 사유 코드 */
export const HOLD_REASONS = [
  'QUESTION_MISSING', 'QUESTION_OVERUSE', 'WORD_SHARE_HIGH', 'WORD_SHARE_LOW',
  'OVER_EXPANDED', 'OVER_COMPRESSED', 'MUST_KEEP_SHORT', 'WATCH_PHRASE',
  'CLICHE_OPENER', 'STRUCTURE_TRACE', 'CTA_IN_ASKING_POST',
] as const
export type HoldReason = (typeof HOLD_REASONS)[number]

export type GateFinding = {
  code: BlockReason | HoldReason
  /** 사람이 읽을 한 줄. 🔴 원문·초안 본문을 담지 않는다 — 세어 본 값만 */
  detail: string
}

export type GateResult = {
  verdict: GateVerdict
  blocks: readonly GateFinding[]
  holds: readonly GateFinding[]
}

export type GateInput = {
  signals: DraftSignals
  /** 원문이 어떻게 닫히는가. 🔴 FORCED_CTA 판정이 이 값으로 갈린다 */
  closingIntent: ClosingIntent
  /** 원문 본문 길이(자). 배율 판정에 쓴다 */
  sourceBodyLength: number
  /** 살려야 할 필수 디테일 수 */
  mustKeepTotal: number
  /** 그중 초안에 남은 수 */
  mustKeepFound: number
}

/**
 * 🔴 판정한다. 저장도 발행도 하지 않는다 — 부르는 쪽의 일이다.
 *
 * BLOCK 이 하나라도 있으면 BLOCK 이다. HOLD 는 BLOCK 이 없을 때만 등급이 된다 —
 * 다만 **holds 배열은 BLOCK 이어도 채워서 돌려준다.** 막힌 글에도
 * 무엇이 더 문제였는지가 보여야 다음 판에서 고칠 수 있다.
 */
export function gateDraft(input: GateInput): GateResult {
  const s = input.signals
  const blocks: GateFinding[] = []
  const holds: GateFinding[] = []

  // ── BLOCK ─────────────────────────────────────────────
  // 🔴 임계가 없다. 1건이라도 있으면 막는다. 이건 정도의 문제가 아니라 계약이다.
  if (s.sourceEchoCount > 0) {
    blocks.push({ code: 'SOURCE_ECHO', detail: `원문 연속 20자 ${s.sourceEchoCount}조각` })
  }
  if (s.originUrlHits.length > 0) {
    // 🔴 허용된 소재 링크(유튜브 정본)는 contentUrlHits 로 빠져 여기 오지 않는다(PR #295)
    blocks.push({ code: 'ORIGIN_URL', detail: `출처 링크 ${s.originUrlHits.length}건` })
  }
  if (s.originTraceHits.length > 0) {
    blocks.push({ code: 'ORIGIN_TRACE', detail: `출처 흔적 ${s.originTraceHits.join(' · ')}` })
  }
  if (s.externalAddressHits.length > 0) {
    blocks.push({ code: 'EXTERNAL_ADDRESS', detail: `외부 호칭 ${s.externalAddressHits.join(' · ')}` })
  }
  if (s.bannedTerms.length > 0) {
    blocks.push({ code: 'BANNED_TERM', detail: `금지 낱말 ${s.bannedTerms.join(' · ')}` })
  }
  if (s.critiqueHits.length > 0) {
    blocks.push({ code: 'CRITIQUE_PHRASE', detail: `실패 표현 ${s.critiqueHits.join(' · ')}` })
  }

  /**
   * 🔴 **같은 패턴이 어떤 글에서는 위반이고 어떤 글에서는 정상이다.**
   *
   * "조언 좀 부탁드려요" 는 원문이 조언을 청하는 글이면 **살려야 하는 말**이다.
   * 48건 시뮬레이션에서 #28 · #33 (둘 다 advice_request) 이 이 패턴으로 잡혔는데
   * 둘 다 정상이었다. closingIntent 를 보지 않고 막으면 멀쩡한 글이 차단된다.
   *
   * 🔴 막는 것은 **원문이 아무도 부르지 않는데 끝에 부른 경우**뿐이다.
   *    실제 위반이었던 #29 · #31 은 no_call 이라 그대로 걸린다.
   */
  if (s.closingCtaHits.length > 0) {
    if (input.closingIntent === 'no_call') {
      blocks.push({ code: 'FORCED_CTA', detail: `no_call 인데 마무리 호출 ${s.closingCtaHits.length}건` })
    } else {
      holds.push({ code: 'CTA_IN_ASKING_POST', detail: `마무리 호출 ${s.closingCtaHits.length}건 (원문 ${input.closingIntent})` })
    }
  }

  // ── HOLD ──────────────────────────────────────────────
  if (s.questionVerdict === 'missing') {
    holds.push({ code: 'QUESTION_MISSING', detail: '묻는 글인데 물음표가 없다' })
  }
  if (s.questionVerdict === 'overuse') {
    holds.push({ code: 'QUESTION_OVERUSE', detail: `물음표 ${s.questionMarkCount}개` })
  }
  if (s.sharedWordRatio > WORD_SHARE_MAX) {
    holds.push({ code: 'WORD_SHARE_HIGH', detail: `어절 공유 ${pct(s.sharedWordRatio)} (상한 ${pct(WORD_SHARE_MAX)})` })
  }
  if (s.sharedWordRatio < WORD_SHARE_MIN) {
    holds.push({ code: 'WORD_SHARE_LOW', detail: `어절 공유 ${pct(s.sharedWordRatio)} (하한 ${pct(WORD_SHARE_MIN)})` })
  }

  // 🔴 원문 길이를 모르면 배율을 판정하지 않는다. 0으로 나누지 않고, 넘겨짚지도 않는다
  if (input.sourceBodyLength > 0) {
    const ratio = s.bodyLength / input.sourceBodyLength
    if (ratio > EXPAND_MAX) {
      holds.push({ code: 'OVER_EXPANDED', detail: `원문의 ${ratio.toFixed(2)}배 (상한 ${EXPAND_MAX})` })
    }
    if (ratio < COMPRESS_MIN) {
      holds.push({ code: 'OVER_COMPRESSED', detail: `원문의 ${ratio.toFixed(2)}배 (하한 ${COMPRESS_MIN})` })
    }
  }

  // 🔴 필수 디테일이 0건인 원문은 보존율을 따지지 않는다 — 지킬 것이 없으면 실패도 없다
  if (input.mustKeepTotal > 0) {
    const keep = input.mustKeepFound / input.mustKeepTotal
    if (keep < MUST_KEEP_MIN_RATIO) {
      holds.push({
        code: 'MUST_KEEP_SHORT',
        detail: `필수 디테일 ${input.mustKeepFound}/${input.mustKeepTotal} (${pct(keep)})`,
      })
    }
  }

  if (s.critiqueWatchHits.length > 0) {
    holds.push({ code: 'WATCH_PHRASE', detail: `경계 표현 ${s.critiqueWatchHits.join(' · ')}` })
  }
  if (s.clicheOpener !== null) {
    holds.push({ code: 'CLICHE_OPENER', detail: `상투 시작 "${s.clicheOpener}"` })
  }
  if (s.structureFlags.length > 0) {
    holds.push({ code: 'STRUCTURE_TRACE', detail: `구조 흔적 ${s.structureFlags.join(' · ')}` })
  }

  const verdict: GateVerdict = blocks.length > 0 ? 'BLOCK' : holds.length > 0 ? 'HOLD' : 'PASS'
  return { verdict, blocks, holds }
}

const pct = (v: number): string => `${(v * 100).toFixed(1)}%`

/** 화면 한 줄 요약. 🔴 본문을 담지 않는다 */
export function formatGate(g: GateResult): string {
  const mark = g.verdict === 'PASS' ? '✅' : g.verdict === 'HOLD' ? '🟡' : '🔴'
  const parts = [
    ...g.blocks.map((b) => `${b.code}(${b.detail})`),
    ...g.holds.map((h) => `${h.code}(${h.detail})`),
  ]
  return `${mark} ${g.verdict}${parts.length === 0 ? '' : ` — ${parts.join(' · ')}`}`
}

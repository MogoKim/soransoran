/**
 * Persona 목소리 댓글 — 순수 판정 (DB · 세션 · 네트워크 없음) · 정책 정본
 *
 * 창업자가 운영 레인에서 Persona 의 이름으로 댓글을 쓴다(2026-11-16 창업자 결정 ②).
 * 저장은 운영자 댓글과 같은 모양이다 — commentOrigin=OPERATOR · personaId 없음 · 작성자 = 그 Persona 의 User ·
 * 작성자 행 = 그 Persona 전용 `PV<번호>` OperatorWriter 행. 그래서 자동 레인(D100)의 예산·비율·단계 증거는 이 댓글을 보지 않는다.
 *
 * 정책
 *   R2  실회원 글 · 운영자 이름 글 → 바로 쓸 수 있다(자동 레인이 붙지 않는 글이다).
 *   R3  Persona 자동 글 → 공개 뒤 25시간이 지나야 쓸 수 있다(자동 첫 댓글·추가 댓글 창과 그 글의 증명일이 모두 닫힌 뒤).
 *   R4  Micro Seed 글 · 매거진 · 공개되지 않은 글 · 작성자를 판정할 수 없는 글 → 쓸 수 없다.
 *   R5  활동 중(active) Persona 만.
 *   R6  그 Persona 계정이 쓴 글·댓글에 처리 대기(PENDING) 신고가 있으면 쓸 수 없다 — 처리하면 다시 된다.
 *   R7  06:30~08:30 KST 는 쉰다(임시 — kst-write-quiet-window.ts).
 *   R8  글쓴이가 그 Persona 를 차단했으면 쓸 수 없다 — 글쓴이에게 보이지 않는 댓글은 답이 아니다.
 *   R9  댓글만(최상위). 글 · 작성자 대댓글은 Persona 목소리로 쓰지 않는다.
 *   개수 상한 · 공개 고지 · 혼잣말 금지는 없다(창업자 결정).
 *
 * 🔴 이 파일은 운영 레인 소유다(파일 이름에 persona- 접두사를 쓰지 않는다 — 그 접두사는 D100 레인 규칙과 가드의 대상이다).
 * 🔴 D100 모듈을 import 하지 않는다. 25시간은 아래 상수로 두고, 자동 레인 상수와의 관계는 시험
 *    (scripts/operator-persona-voice-check.mts)이 D100 정본 상수를 읽어 확인한다 — 그쪽이 바뀌면 시험이 깨진다.
 */
import { belongsToMicroSeedLane, type PostVisibilityInput } from './post-visibility'
import { judgeRealMember } from './real-member-gate'

const HOUR_MS = 3_600_000

/**
 * Persona 자동 글에 Persona 목소리를 쓸 수 있는 최소 나이 = 25시간.
 * = 자동 레인이 그 글에 마지막으로 쓸 수 있는 나이(추가 댓글 24시간 — 첫 댓글 60분보다 길다) + 첫 댓글 창 1시간.
 *   추가 댓글은 생성·발행 둘 다 나이 24시간을 넘으면 멈춘다(지터는 그 안에서만 밀린다).
 */
export const PERSONA_VOICE_AUTO_POST_MIN_AGE_MS = 25 * HOUR_MS

const PERSONA_CODE = /^P(\d+)$/
/** Persona 코드 → 그 Persona 전용 운영 작성자 행 코드 ('P07' → 'PV07'). 형식 밖이면 null */
export function pvCodeOf(personaCode: string): string | null {
  const m = PERSONA_CODE.exec(personaCode)
  return m ? `PV${m[1]}` : null
}

// ─────────────────────────────────────────────────────────
// 대상 글
// ─────────────────────────────────────────────────────────

export type PersonaVoiceTargetFacts = PostVisibilityInput & {
  boardType: string
  /** 자동 Persona 글이면 그 Persona id */
  personaId: string | null
  /** 운영자 이름 글이면 그 작성자 행 id */
  operatorWriterId: string | null
  /** 공개 시각 = publishAt ?? createdAt (추가 댓글 레인과 같은 식) */
  publishedAt: Date | null
  /** 글쓴이 계정 실측 — 실회원 판정 정본(judgeRealMember) 입력. 모르면 null/undefined */
  authorAccountCount: number | null | undefined
  authorProviderId: string | null | undefined
}

export type PersonaVoiceTargetKind = 'member' | 'operator' | 'persona'
export type PersonaVoiceTargetBlock = 'NOT_PUBLIC' | 'NOT_BOARD' | 'MICRO_SEED' | 'TOO_EARLY' | 'UNKNOWN_AUTHOR'

export type PersonaVoiceTargetVerdict =
  | { ok: true; kind: PersonaVoiceTargetKind }
  | { ok: false; code: PersonaVoiceTargetBlock; reason: string; opensAtMs?: number }

const VOICE_BOARDS: ReadonlySet<string> = new Set(['MENOPAUSE', 'FREE'])

/**
 * 이 글에 Persona 목소리로 댓글을 달아도 되는가.
 * 순서가 곧 우선순위다: 공개·게시판 → Micro Seed → Persona 자동 글 나이 → 운영자 이름 글 → 실회원 글 → 그 밖(거절).
 */
export function judgePersonaVoiceTarget(f: PersonaVoiceTargetFacts, nowMs: number): PersonaVoiceTargetVerdict {
  if (f.status !== 'PUBLISHED') return { ok: false, code: 'NOT_PUBLIC', reason: '공개된 글이 아닙니다.' }
  if (!VOICE_BOARDS.has(f.boardType)) return { ok: false, code: 'NOT_BOARD', reason: '갱년기톡 · 자유게시판 글에만 씁니다.' }
  // 🔴 Persona 가 올린 글이라도 본문이 남의 원문(Micro Seed)이면 쓰지 않는다 — Persona 판정보다 먼저 본다
  if (belongsToMicroSeedLane(f)) return { ok: false, code: 'MICRO_SEED', reason: '외부 원문 글에는 쓰지 않습니다.' }
  if (f.personaId !== null) {
    if (f.publishedAt === null) return { ok: false, code: 'TOO_EARLY', reason: '공개 시각을 알 수 없습니다.' }
    const opensAtMs = f.publishedAt.getTime() + PERSONA_VOICE_AUTO_POST_MIN_AGE_MS
    if (nowMs < opensAtMs) {
      return { ok: false, code: 'TOO_EARLY', reason: 'Persona 자동 글은 공개 25시간 뒤부터 씁니다(자동 댓글이 끝난 뒤).', opensAtMs }
    }
    return { ok: true, kind: 'persona' }
  }
  if (f.operatorWriterId !== null) return { ok: true, kind: 'operator' }
  // 🔴 실회원 판정은 단일 정본 — 모르면 막는다(어느 레인의 글인지 모르는 글에 Persona 가 말하지 않는다)
  const real = judgeRealMember({ accountCount: f.authorAccountCount, providerId: f.authorProviderId })
  if (real.real && !real.unknown) return { ok: true, kind: 'member' }
  return { ok: false, code: 'UNKNOWN_AUTHOR', reason: '글쓴이를 판정할 수 없는 글에는 쓰지 않습니다.' }
}

// ─────────────────────────────────────────────────────────
// 말하는 Persona
// ─────────────────────────────────────────────────────────

export type PersonaVoiceSpeakerFacts = {
  code: string
  status: string | null
  /** 그 Persona 계정이 쓴 글·댓글의 PENDING 신고 수. 못 셌으면 null */
  pendingReports: number | null
}

export type PersonaVoiceSpeakerBlock = 'NOT_ACTIVE' | 'PENDING_REPORT' | 'BAD_CODE'

export type PersonaVoiceSpeakerVerdict =
  | { ok: true; pvCode: string }
  | { ok: false; code: PersonaVoiceSpeakerBlock; reason: string }

export function judgePersonaVoiceSpeaker(f: PersonaVoiceSpeakerFacts): PersonaVoiceSpeakerVerdict {
  if (f.status !== 'active') return { ok: false, code: 'NOT_ACTIVE', reason: `활동 중인 Persona 만 씁니다(status=${String(f.status)}).` }
  // 🔴 못 셌으면(null) 막는다 — 신고를 모르는 채로 말하게 하지 않는다
  if (f.pendingReports !== 0) {
    return { ok: false, code: 'PENDING_REPORT', reason: '이 Persona 에 처리하지 않은 신고가 있습니다. 신고를 먼저 처리해 주세요.' }
  }
  const pvCode = pvCodeOf(f.code)
  if (pvCode === null) return { ok: false, code: 'BAD_CODE', reason: `Persona 코드 형식이 다릅니다(${f.code}).` }
  return { ok: true, pvCode }
}

// ─────────────────────────────────────────────────────────
// 말투 카드 — 읽기 전용 참고
// ─────────────────────────────────────────────────────────

export type PersonaCard = { label: string; value: string }[]

const CARD_FIELDS: readonly { label: string; get: (p: PersonaCardSource) => unknown }[] = [
  { label: '나이대', get: (p) => p.ageBand },
  { label: '지역', get: (p) => p.region },
  { label: '생활 단계', get: (p) => p.lifeStage },
  { label: '일', get: (p) => objOf(p.identity).workStatus },
  { label: '성격', get: (p) => objOf(p.identity).personality },
  { label: '갱년기', get: (p) => objOf(p.identity).menopauseStatus },
  { label: '말 길이', get: (p) => objOf(p.voiceCore).length },
  { label: '말투', get: (p) => objOf(p.voiceCore).register },
  { label: '말끝', get: (p) => objOf(p.voiceCore).ending },
  { label: '이모티콘', get: (p) => objOf(p.voiceCore).emoji },
  { label: '피하는 주제', get: (p) => p.noGoTopics },
  { label: '피하는 표현', get: (p) => p.noGoExpressions },
]

export type PersonaCardSource = {
  ageBand: string | null
  region: string | null
  lifeStage: string | null
  identity: unknown
  voiceCore: unknown
  noGoTopics: string[]
  noGoExpressions: string[]
}

function objOf(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function show(v: unknown): string {
  if (typeof v === 'string') return v.trim() === '' ? '—' : v
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'boolean') return v ? '예' : '아니오'
  if (Array.isArray(v)) {
    const items = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
    return items.length === 0 ? '—' : items.join(' · ')
  }
  return '—'
}

/** 🔴 모르는 키·타입은 '—' 로 둔다 — 카드 때문에 화면이 깨지지 않게. 원본 JSON 을 그대로 내보내지 않는다 */
export function personaCardOf(p: PersonaCardSource): PersonaCard {
  return CARD_FIELDS.map((f) => ({ label: f.label, value: show(f.get(p)) }))
}

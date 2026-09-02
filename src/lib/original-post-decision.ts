/**
 * 오리지널 초안 대기열 결정 규칙 — 🔴 순수 함수. DB · 세션 · 네트워크 · 파일 IO 없음
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2-1 · §12-2
 *
 * 파이프라인에서 이 파일이 채우는 자리
 *   [생성] ──▶ [판정 gate] ──▶ [적재 enqueue] ──▶ **[결정]** ──▶ [발행 · 아직 없음]
 *                                                    ↑ 여기
 *
 * 🔴 규칙을 스크립트 안에 두지 않는다.
 *    거기 두면 DB 없이는 검증할 수 없고, 검증할 수 없는 규칙은 조용히 깨진다.
 *    여기 있으면 fixture 가 전이표를 **전수로** 확인한다.
 *    persona-candidate-rules.ts 와 같은 이유이고, 같은 모양이다.
 *
 * 🔴 이 파일이 scripts/lib 이 아니라 src/lib 에 있는 이유
 *    gate · queue 는 어드민이 읽지 않아 scripts/lib 에 있다. 폐기 사유 라벨은
 *    결국 검수 화면에 뜬다 — 화면이 읽어야 하는 규칙은 src/lib 에 둔다.
 *    🔴 고객 경로에서는 import 되지 않는다.
 *
 * 🔴 **승인은 발행이 아니다.** 여기서 나오는 상태는 APPROVED · DECLINED · EDITED 뿐이다.
 *    PUBLISHED 는 발행 성공을 확인한 경로만 설정할 수 있다(MicroSeed · Persona 와 같은 원칙).
 */

/** 대기열 상태 — Prisma enum OriginalPostCandidateStatus 와 같은 값 */
export const ORIGINAL_POST_STATUSES = [
  'PENDING', 'APPROVED', 'EDITED', 'DECLINED', 'PUBLISHED', 'EXPIRED',
] as const
export type OriginalPostStatus = (typeof ORIGINAL_POST_STATUSES)[number]

/** 사람이 내리는 결정 — 🔴 publish 는 여기 없다 */
export const ORIGINAL_POST_DECISIONS = ['approve', 'decline', 'edit'] as const
export type OriginalPostDecision = (typeof ORIGINAL_POST_DECISIONS)[number]

/** 결정이 도달할 수 있는 상태 — 🔴 PUBLISHED · EXPIRED 는 없다 */
export type DecidedStatus = Extract<OriginalPostStatus, 'APPROVED' | 'DECLINED' | 'EDITED'>

/**
 * 결정자.
 *
 * 🔴 스크립트에는 세션이 없다. 그래서 사람이 인자로 준다 —
 *    지어내면 "누가 정했나" 가 거짓이 된다.
 * 🔴 자유 텍스트가 아니라 목록인 이유는 폐기 사유와 같다. 오타로 만들어진
 *    'Founder' · 'founder ' 가 섞이면 집계가 무너진다.
 */
export const DECIDED_BY_VALUES = ['founder'] as const
export type DecidedBy = (typeof DECIDED_BY_VALUES)[number]

const DECIDED_BY_SET: ReadonlySet<string> = new Set(DECIDED_BY_VALUES)

export const isDecidedBy = (v: unknown): v is DecidedBy =>
  typeof v === 'string' && DECIDED_BY_SET.has(v)

/**
 * 폐기 사유 코드.
 *
 * 🔴 자유 텍스트가 아니라 코드인 이유 — 집계되지 않으면 개선 근거가 되지 못한다.
 *    특히 앞의 둘은 **"gate 가 통과시켰는데 사람이 걸러낸 것"** 이라
 *    그대로 gate 보강 대상이 된다. 대기열이 계측 장치인 이유가 여기 있다.
 *
 * 🔴 persona 의 7종을 재사용하지 않는다. 저쪽은 댓글용이다 —
 *    'CONTEXT_MISMATCH'(글 맥락과 안 맞음) 는 글 자체에는 뜻이 없다.
 */
export const DECLINE_REASONS = [
  { code: 'GATE_MISS_SOURCE_ECHO', label: 'gate 통과했으나 원문 냄새가 남음' },
  { code: 'GATE_MISS_AI_TONE', label: 'gate 통과했으나 AI 티 — 사람 글로 안 읽힘' },
  { code: 'TITLE_WEAK', label: '제목이 재료를 못 살림' },
  { code: 'VOICE_MISMATCH', label: '우리 또래 목소리가 아님' },
  { code: 'TOPIC_UNFIT', label: '커뮤니티에 맞지 않는 소재' },
  { code: 'LOW_VALUE', label: '틀리진 않으나 굳이 올릴 필요 없음' },
  { code: 'OTHER', label: '기타' },
] as const

export type DeclineReasonCode = (typeof DECLINE_REASONS)[number]['code']

const DECLINE_CODE_SET: ReadonlySet<string> = new Set(DECLINE_REASONS.map((r) => r.code))

export const isDeclineReasonCode = (v: unknown): v is DeclineReasonCode =>
  typeof v === 'string' && DECLINE_CODE_SET.has(v)

/** 수정본 — 🔴 CLI 인자가 아니라 파일로 받는다. 본문이 셸 이력에 남지 않게 한다 */
export type EditedDraft = { title: string; body: string; note: string }

/**
 * 무엇을 왜 고쳤나.
 *
 * 🔴 본문을 담지 않는다. 바뀌었는지 여부 · 증감 · 사람이 쓴 한 줄뿐이다 —
 *    수정본 전문은 editedTitle · editedBody 에 이미 있고, 두 벌 두지 않는다.
 */
export type EditDiff = {
  titleChanged: boolean
  bodyChanged: boolean
  /** 초안 본문 대비 글자 수 증감 */
  charDelta: number
  note: string
}

/** 🔴 note 상한. 이력 한 줄이지 두 번째 본문이 아니다 */
export const MAX_EDIT_NOTE_CHARS = 200

export type DecisionInput = {
  status: OriginalPostStatus
  /** 🔴 발행된 글의 결정은 뒤집지 않는다. status 와 무관하게 본다 */
  createdPostId: string | null
  draftTitle: string
  draftBody: string
  decision: OriginalPostDecision
  declineReason?: string | null
  edited?: EditedDraft | null
}

export type DecisionPlan =
  | {
      ok: true
      nextStatus: DecidedStatus
      declineReason: DeclineReasonCode | null
      edited: EditedDraft | null
      editDiff: EditDiff | null
    }
  | { ok: false; error: string }

/**
 * 🔴 PENDING 만 결정할 수 있다.
 *
 *    이미 결정된 것을 다시 뒤집으면 decidedAt 이 덮어써져
 *    "언제 누가 정했나" 가 사라진다. 되돌리기가 필요하면 그건 별도 기능이지
 *    같은 명령이 아니다.
 */
export const canDecide = (status: OriginalPostStatus): boolean => status === 'PENDING'

/** 🔴 본문을 담지 않는다 — 바뀌었는지와 얼마나만 센다 */
export function buildEditDiff(
  draftTitle: string,
  draftBody: string,
  edited: EditedDraft,
): EditDiff {
  return {
    titleChanged: edited.title !== draftTitle,
    bodyChanged: edited.body !== draftBody,
    charDelta: [...edited.body].length - [...draftBody].length,
    note: edited.note.trim(),
  }
}

/**
 * 결정을 검사하고 다음 상태를 낸다.
 *
 * 🔴 순서가 규칙이다. 발행 여부를 **가장 먼저** 본다 —
 *    status 가 어떤 값이든(원장이 어긋나 PENDING 으로 남아 있어도)
 *    createdPostId 가 있으면 그 글은 이미 세상에 나갔다.
 */
export function planDecision(input: DecisionInput): DecisionPlan {
  // ── ① 🔴 발행된 것은 건드리지 않는다 (status 무관) ──
  if (input.createdPostId !== null && input.createdPostId.trim() !== '') {
    return {
      ok: false,
      error: '이미 발행된 초안입니다. 발행된 글의 결정은 뒤집지 않습니다.',
    }
  }

  // ── ② PENDING 만 ──
  if (!canDecide(input.status)) {
    return { ok: false, error: `대기(PENDING) 상태만 결정할 수 있습니다. 현재 ${input.status}` }
  }

  const reason = (input.declineReason ?? '').trim()
  const edited = input.edited ?? null

  // ── ③ 인자가 결정과 맞는가 — 🔴 섞여 들어오면 무엇이 의도인지 모른다 ──
  if (input.decision !== 'decline' && reason !== '') {
    return { ok: false, error: `폐기가 아닌데 폐기 사유가 들어왔습니다 (${input.decision}).` }
  }
  if (input.decision !== 'edit' && edited !== null) {
    return { ok: false, error: `수정 승인이 아닌데 수정본이 들어왔습니다 (${input.decision}).` }
  }

  // ── ④ 결정별 ──
  if (input.decision === 'approve') {
    // 🔴 승인은 발행이 아니다. APPROVED 에 머문다
    return { ok: true, nextStatus: 'APPROVED', declineReason: null, edited: null, editDiff: null }
  }

  if (input.decision === 'decline') {
    if (reason === '') return { ok: false, error: '폐기 사유가 필요합니다.' }
    // 🔴 코드가 아니면 받지 않는다. 자유 텍스트를 허용하면 집계가 무너진다
    if (!isDeclineReasonCode(reason)) return { ok: false, error: `알 수 없는 폐기 사유입니다: ${reason}` }
    return { ok: true, nextStatus: 'DECLINED', declineReason: reason, edited: null, editDiff: null }
  }

  // ── ⑤ 수정 후 승인 ──
  if (edited === null) {
    return { ok: false, error: '수정본이 없습니다. --edited-file 로 주세요.' }
  }
  const title = edited.title.trim()
  const body = edited.body.trim()
  const note = edited.note.trim()
  if (title === '') return { ok: false, error: '수정본 제목이 비어 있습니다.' }
  if (body === '') return { ok: false, error: '수정본 본문이 비어 있습니다.' }
  // 🔴 무엇을 왜 고쳤나가 수정 승인의 값어치다. 그게 없으면 다음 판의 재료가 되지 못한다
  if (note === '') return { ok: false, error: '무엇을 왜 고쳤는지(note) 가 필요합니다.' }
  if ([...note].length > MAX_EDIT_NOTE_CHARS) {
    return {
      ok: false,
      error: `note 가 깁니다 (${[...note].length}자 · 상한 ${MAX_EDIT_NOTE_CHARS}자). 이력 한 줄이지 두 번째 본문이 아닙니다.`,
    }
  }
  // 🔴 고치지 않았는데 EDITED 로 남기면 이력이 거짓이 된다
  if (title === input.draftTitle && body === input.draftBody) {
    return { ok: false, error: '초안과 같습니다. 고친 것이 없으면 --approve 를 쓰세요.' }
  }

  const normalized: EditedDraft = { title, body, note }
  return {
    ok: true,
    nextStatus: 'EDITED',
    declineReason: null,
    edited: normalized,
    editDiff: buildEditDiff(input.draftTitle, input.draftBody, normalized),
  }
}

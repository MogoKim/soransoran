/**
 * 운영자 직접 작성 — 🔴 **순수 판정. DB · 세션 · 네트워크 없음**
 *
 * 창업자가 관리자 로그인 하나로 운영용 닉네임을 골라 **직접** 글·댓글을 쓰는 레인의 정본이다.
 *
 * 🔴 **자동 Persona 를 수동 조작하는 기능이 아니다.**
 *    자동 레인(생성 → Gate → 대기열 → 발행)은 이 파일을 지나지 않고,
 *    이 레인은 provider 를 부르지 않는다. 두 레인은 표부터 갈라져 있다
 *    (`OperatorWriter` ≠ `Persona`) — 그래서 "제외 필터를 빠뜨렸다" 가 생길 수 없다.
 *
 * 🔴 **왜 여기에 판정을 모으는가.** 작성·수정·삭제 세 경로가 같은 질문을 한다 —
 *    *이 작성자를 써도 되는가* · *이 글이 이 도구의 것인가*. 경로마다 적으면
 *    한쪽만 고쳐지는 날이 오고, 그날 회원 글이 운영 도구로 지워진다.
 *
 * 🔴 이 파일은 고객 화면에서 import 되지 않는다.
 */

import { OPERATOR_POST_VISIBILITY_FLAGS } from './post-visibility'
import { MAX_POST_TITLE_LENGTH, MIN_POST_TITLE_LENGTH } from './post-policy'
// 🔴 실회원 판별은 단일 정본이다. 여기서 `accountCount > 0` 을 다시 적지 않는다
import { judgeRealMember } from './real-member-gate'

// ─────────────────────────────────────────────────────────
// ① 작성자 자격 — 고를 수 있는 사람인가
// ─────────────────────────────────────────────────────────

/** 판정에 필요한 것만. 🔴 닉네임·메모를 받지 않는다 — 자격과 표시는 다른 질문이다 */
export type OperatorWriterFacts = {
  /** OperatorWriterStatus. 모르면 null */
  status: string | null
  /**
   * 🔴 이 작성자의 User 에 붙은 Account 수. `judgeRealMember` 와 같은 정본을 본다.
   *    실측하지 못했으면 null 이고, 그때는 **막는다**.
   */
  accountCount: number | null | undefined
  /** 🔴 방어적 보조. `undefined` 는 select 누락이므로 역시 막는다 */
  providerId: string | null | undefined
  /**
   * 🔴 이 User 에 자동 Persona 가 붙어 있는가. 붙어 있으면 **막는다** —
   *    한 사람이 두 레인에서 말하면 자동 여력 계산과 30% 비율이 동시에 어긋난다.
   */
  hasPersona: boolean | null | undefined
}

export type WriterBlockCode =
  | 'NOT_FOUND'
  | 'NOT_ACTIVE'
  | 'REAL_MEMBER'
  | 'ALSO_PERSONA'
  | 'UNKNOWN_ACCOUNT'

export type WriterVerdict =
  | { ok: true }
  | { ok: false; code: WriterBlockCode; reason: string }

/** 사람이 읽을 문장. 🔴 화면마다 다시 적지 않는다 */
export const WRITER_BLOCK_LABEL: Record<WriterBlockCode, string> = {
  NOT_FOUND: '그 작성자를 찾을 수 없습니다.',
  NOT_ACTIVE: '지금은 쓸 수 없는 작성자입니다.',
  REAL_MEMBER: '🔴 실회원 계정입니다 — 회원 이름으로 글을 쓰지 않습니다.',
  ALSO_PERSONA: '🔴 자동 페르소나가 함께 붙어 있습니다 — 두 레인이 같은 이름을 쓰지 않습니다.',
  UNKNOWN_ACCOUNT: '🔴 계정 정보를 확인하지 못했습니다.',
}

/**
 * 이 작성자 이름으로 써도 되는가.
 *
 * 🔴 **모르면 막는다(fail-closed).** 공개된 글은 되돌릴 수 없다 —
 *    `judgeRealMember` 가 같은 이유로 같은 모양을 하고 있다.
 */
export function judgeOperatorWriter(f: OperatorWriterFacts | null): WriterVerdict {
  if (f === null) {
    return { ok: false, code: 'NOT_FOUND', reason: WRITER_BLOCK_LABEL.NOT_FOUND }
  }
  if (f.status !== 'active') {
    return {
      ok: false,
      code: 'NOT_ACTIVE',
      reason: `${WRITER_BLOCK_LABEL.NOT_ACTIVE} (status=${String(f.status)})`,
    }
  }
  if (f.hasPersona === true) {
    return { ok: false, code: 'ALSO_PERSONA', reason: WRITER_BLOCK_LABEL.ALSO_PERSONA }
  }
  if (f.hasPersona !== false) {
    return {
      ok: false,
      code: 'UNKNOWN_ACCOUNT',
      reason: `${WRITER_BLOCK_LABEL.UNKNOWN_ACCOUNT} (페르소나 연결 여부 미실측)`,
    }
  }
  /**
   * 🔴 실회원 판정은 **단일 정본**을 그대로 쓴다. 여기서 `accountCount > 0` 을
   *    다시 적지 않는다 — 그 비교가 두 곳에 있으면 한쪽만 고쳐진다.
   *    `NaN`·`Infinity`·소수·select 누락까지 그 함수가 막는다.
   */
  const real = judgeRealMember({ accountCount: f.accountCount, providerId: f.providerId })
  if (real.real) {
    return real.unknown
      ? { ok: false, code: 'UNKNOWN_ACCOUNT', reason: `${WRITER_BLOCK_LABEL.UNKNOWN_ACCOUNT} ${real.reason}` }
      : { ok: false, code: 'REAL_MEMBER', reason: `${WRITER_BLOCK_LABEL.REAL_MEMBER} ${real.reason}` }
  }
  return { ok: true }
}

// ─────────────────────────────────────────────────────────
// ② 쓸 수 있는 게시판 — 🔴 매거진·베스트는 게시판이 아니다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 IA 정본: 갱년기톡 · 자유게시판만 게시판이다.
 *    매거진은 콘텐츠 영역이고 베스트는 모아보기다 — 글쓰기 진입점이 없다.
 *    `board-registry` 의 `isCommunity` 와 같은 뜻이지만, 여기서는 **값으로** 못박는다:
 *    레지스트리에 게시판이 하나 늘어도 운영 직접 작성이 자동으로 따라 열리지 않는다.
 */
export const OPERATOR_BOARDS = ['MENOPAUSE', 'FREE'] as const
export type OperatorBoard = (typeof OPERATOR_BOARDS)[number]

export function isOperatorBoard(v: string): v is OperatorBoard {
  return (OPERATOR_BOARDS as readonly string[]).includes(v)
}

// ─────────────────────────────────────────────────────────
// ③ 저장 직전에 박는 값
// ─────────────────────────────────────────────────────────

export type OperatorPostInput = {
  boardType: OperatorBoard
  title: string
  content: string
  /** 🔴 선택된 운영용 작성자의 User.id — 로그인한 관리자의 id 가 아니다 */
  authorId: string
  /** 🔴 OperatorWriter.id — "누가 썼나" 의 정본 */
  operatorWriterId: string
}

/**
 * 글 생성 데이터.
 *
 * 🔴 **`personaId` 를 담지 않는다.** 타입에 자리를 두지 않는 것이 첫 번째 방어다 —
 *    호출부가 실수로 넘길 자리 자체가 없다. 두 축이 함께 채워지면
 *    30% 비율 판정이 모순으로 보고 자동 레인의 집계를 통째로 멈춘다.
 *
 * 🔴 **출처 필드도 없다.** 이 글은 어디서 가져온 것이 아니다.
 *
 * 🔴 `source` 는 `USER` 다. 사람이 직접 썼기 때문이다 —
 *    `SYSTEM` 으로 두면 `judgePostAuthor` 가 자동 생성물로 읽고,
 *    "창업자가 쓴 글" 과 "기계가 만든 글" 이 한 값에 섞인다.
 */
export function buildOperatorPostData(input: OperatorPostInput) {
  return {
    boardType: input.boardType,
    title: input.title,
    content: input.content,
    authorId: input.authorId,
    operatorWriterId: input.operatorWriterId,
    status: 'PUBLISHED',
    source: 'USER',
    // 🔴 예약 발행을 쓰지 않는다. 쓴 순간 올라간다
    publishAt: null,
    // 🔴 항상 마지막. 위에서 무엇이 왔든 이 값이 이긴다
    ...OPERATOR_POST_VISIBILITY_FLAGS,
  }
}

/** 🔴 이 레인의 글에 붙으면 안 되는 필드 */
export const FORBIDDEN_OPERATOR_POST_KEYS: readonly string[] = [
  'personaId',
  'sourceUrl',
  'sourceArticleId',
  'sheetCandidateId',
  'sourceSite',
  'sourceCapturedAt',
  'category',
]

/**
 * 반드시 있어야 하는 필드.
 * 🔴 3축 이름을 여기 적지 않고 게이트 상수에서 **파생**한다 (C-2).
 */
export const REQUIRED_OPERATOR_POST_KEYS: readonly string[] = [
  'boardType', 'title', 'content', 'authorId', 'operatorWriterId', 'status', 'source',
  ...Object.keys(OPERATOR_POST_VISIBILITY_FLAGS),
]

/**
 * 🔴 create 직전 실측 방어.
 *    함수가 있다는 것과 그 함수만 쓰인다는 것은 다르다 —
 *    original-post · micro-seed 가 같은 이유로 같은 방어를 둔다.
 */
export function assertOperatorPostData(data: Record<string, unknown>): void {
  for (const key of FORBIDDEN_OPERATOR_POST_KEYS) {
    if (key in data) {
      throw new Error(
        `운영 작성 데이터에 ${key} 가 있다. 직접 작성 글은 자동 레인의 축을 갖지 않는다.`,
      )
    }
  }
  for (const key of REQUIRED_OPERATOR_POST_KEYS) {
    if (!(key in data)) throw new Error(`운영 작성 데이터에 ${key} 가 없다`)
  }
  for (const [key, expected] of Object.entries(OPERATOR_POST_VISIBILITY_FLAGS)) {
    if (data[key] !== expected) {
      throw new Error(
        `${key}=${JSON.stringify(data[key])} (기대 ${JSON.stringify(expected)}) — 3축은 게이트에서만 온다`,
      )
    }
  }
  if (data.source !== 'USER') throw new Error(`source=${JSON.stringify(data.source)}`)
  if (data.status !== 'PUBLISHED') throw new Error(`status=${JSON.stringify(data.status)}`)
  if (!isOperatorBoard(String(data.boardType))) {
    throw new Error(`boardType=${JSON.stringify(data.boardType)} — 게시판이 아닌 곳에 쓰지 않는다`)
  }
  for (const key of ['authorId', 'operatorWriterId'] as const) {
    const v = data[key]
    if (typeof v !== 'string' || v.trim() === '') {
      throw new Error(`${key} 가 비어 있다 — "누가 썼나" 가 반쪽이면 저장하지 않는다`)
    }
  }
}

export type OperatorCommentInput = {
  postId: string
  content: string
  authorId: string
  operatorWriterId: string
}

/**
 * 댓글 생성 데이터.
 *
 * 🔴 **세 축을 전부 명시한다.** `commentOrigin` 을 기본값에 맡기면 `MEMBER` 로 적재되고,
 *    그 순간 30% 비율의 **분모가 부풀어** 자동 댓글 상한이 근거 없이 열린다.
 *    `persona-publish-tx` 가 같은 이유로 같은 주석을 달고 있다.
 *
 * 🔴 `personaId` 는 타입에 자리가 없다. `commentOrigin=OPERATOR` 인데 `personaId` 가
 *    붙으면 `classifyComment` 가 **모순**으로 보고 집계를 멈춘다.
 *
 * 🔴 `parentId` 도 없다. 첫 판은 최상위 댓글만 쓴다 — 답글은 범위 밖이다.
 */
export function buildOperatorCommentData(input: OperatorCommentInput) {
  return {
    postId: input.postId,
    authorId: input.authorId,
    content: input.content,
    operatorWriterId: input.operatorWriterId,
    source: 'USER',
    commentOrigin: 'OPERATOR',
  }
}

export function assertOperatorCommentData(data: Record<string, unknown>): void {
  if ('personaId' in data) {
    throw new Error('운영 댓글에 personaId 가 있다 — 레인이 섞이면 비율 집계가 멈춘다')
  }
  if ('parentId' in data) {
    throw new Error('운영 댓글은 최상위만 쓴다 — 답글은 이 도구의 범위가 아니다')
  }
  if (data.commentOrigin !== 'OPERATOR') {
    throw new Error(`commentOrigin=${JSON.stringify(data.commentOrigin)} — OPERATOR 여야 한다`)
  }
  if (data.source !== 'USER') throw new Error(`source=${JSON.stringify(data.source)}`)
  for (const key of ['postId', 'authorId', 'operatorWriterId'] as const) {
    const v = data[key]
    if (typeof v !== 'string' || v.trim() === '') throw new Error(`${key} 가 비어 있다`)
  }
}

// ─────────────────────────────────────────────────────────
// ④ 대화 맥락 — 🔴 자동 생성이 **참고**하는 것과 **자산으로 삼는** 것의 경계
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **운영 댓글은 자동 생성의 맥락으로 참고된다** (2026-09-17 · 창업자 결정).
 *
 *    한때 이 레인은 "운영 댓글을 프롬프트에서 뺀다" 였다. 그 판단을 철회했다 —
 *    창업자가 남긴 말만 빼 놓으면 모델이 그 말을 못 본 채 같은 말을 다시 하거나
 *    대화를 끊는다. 자연스럽게 이어 가는 것이 그 목록이 있는 이유다.
 *
 * 🔴 **그래서 지켜야 할 경계가 어디인지 여기 적어 둔다.** 막는 코드가 아니라
 *    **표의 모양**이 지키고 있다는 사실을 잃지 않기 위해서다.
 *
 *      허용 — 그 글의 대화 맥락      `Post.comments` (글에 달린 모든 댓글)
 *             발췌 길이·유출 대조는 다른 댓글과 **같은 것**이 걸린다
 *
 *      금지 — Persona 의 말투·경험   `Persona.comments` (personaId 관계)
 *             ⑧ seed 표본 · voice 근거 · seedUseCount 가 전부 이 관계에서 온다
 *             운영 댓글은 `personaId` 가 **null** 이라 구조적으로 들어갈 수 없다
 *
 *      금지 — Persona 의 기억 자산   `PersonaSelfMemory` 등 memory 표
 *             이 레인은 그 표에 한 줄도 쓰지 않는다
 *
 * 🔴 **학습 방지 장치를 새로 만들지 않는다.** 위 세 줄은 이미 그렇게 되어 있고,
 *    새 게이트를 하나 더 만드는 것은 언제나 쉽고 그래서 늘 그쪽으로 기운다.
 *    확인은 fixture 가 한다 — `operator:compose-check` §⑦.
 */
export const OPERATOR_COMMENT_CONTEXT_POLICY =
  '운영 댓글은 그 글의 대화 맥락으로 참고된다. Persona 의 말투·경험·기억 자산에는 '
  + 'personaId 관계가 아니라서 들어가지 않는다 — 막는 필터가 아니라 표의 모양이 답한다.'

// ─────────────────────────────────────────────────────────
// ⑤ 수정·삭제 권한 — 🔴 이 도구의 것만 손댄다
// ─────────────────────────────────────────────────────────

export type OwnershipFacts = {
  /** 대상 행의 `operatorWriterId`. 회원·Persona 글은 null 이다 */
  operatorWriterId: string | null | undefined
  /** 대상 행의 `personaId`. 🔴 붙어 있으면 자동 레인의 것이다 */
  personaId?: string | null
}

export type OwnershipVerdict =
  | { ok: true; operatorWriterId: string }
  | { ok: false; reason: string }

/**
 * 이 글·댓글을 운영 도구로 고치거나 지워도 되는가.
 *
 * 🔴 **회원 콘텐츠는 건드리지 않는다.** 이 도구의 수정·삭제는 어드민의 신고 조치와 다르다 —
 *    저쪽은 "가린다"(status/isDeleted)이고 이쪽은 "내가 쓴 것을 고친다" 다.
 *    자기 글이 아닌 것에 그 권한을 주면 두 조치가 한 화면에서 구분되지 않는다.
 *
 * 🔴 **`undefined` 는 통과가 아니다.** select 에서 빠뜨린 것이고, 그 상태의 판정은 근거가 없다.
 */
export function judgeOperatorOwnership(f: OwnershipFacts | null): OwnershipVerdict {
  if (f === null) return { ok: false, reason: '대상을 찾을 수 없습니다.' }
  if (f.operatorWriterId === undefined) {
    return { ok: false, reason: '작성 경로를 확인하지 못했습니다 — 손대지 않습니다.' }
  }
  if (f.operatorWriterId === null || f.operatorWriterId.trim() === '') {
    return { ok: false, reason: '🔴 이 도구로 쓴 글이 아닙니다 — 회원·자동 레인의 글은 여기서 고치지 않습니다.' }
  }
  if (f.personaId !== null && f.personaId !== undefined && f.personaId !== '') {
    return { ok: false, reason: '🔴 자동 페르소나가 붙어 있습니다 — 자동 레인의 것은 여기서 고치지 않습니다.' }
  }
  return { ok: true, operatorWriterId: f.operatorWriterId }
}

// ─────────────────────────────────────────────────────────
// ⑥ 입력 길이 — 회원 글쓰기와 같은 정책을 쓴다
// ─────────────────────────────────────────────────────────

/**
 * 🔴 **새 금지 규칙을 만들지 않는다.** 길이·금칙어·개인정보 검사는 회원 글쓰기가
 *    이미 쓰는 것(`post-policy` · `comment-policy` · `checkContent`)을 그대로 재사용한다.
 *    운영자만 다른 규칙을 쓰면 "회원에게는 막히는 말이 운영 글에서는 나간다" 가 된다.
 */
export function judgeOperatorTitle(title: string): string | null {
  const t = title.trim()
  if (t.length < MIN_POST_TITLE_LENGTH) return '제목을 조금만 더 적어 주세요.'
  if (t.length > MAX_POST_TITLE_LENGTH) return `제목은 ${MAX_POST_TITLE_LENGTH}자까지 쓸 수 있어요.`
  return null
}

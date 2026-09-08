/**
 * Original Post 발행 데이터 조립 · 저장 직전 검증
 *
 * 정본: docs/operations/2026-09-02-original-post-lane-strategy.md §4 ·
 *       docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §10-5
 *
 * 🔴 **이 레인은 검색에 노출된다.** 세 축이 전부 false 인 유일한 레인이고,
 *    여기서 나간 글은 sitemap 에 실린다. micro-seed-write-guard 와 같은 구조를 쓰되
 *    막는 것이 정반대다 — 저쪽은 "index 로 새지 않게", 이쪽은 "원문이 새지 않게".
 *
 * 🔴 **작성자는 페르소나다.** authorId 는 matchedPersona.userId 이지 시스템 계정이 아니다.
 *    헌법 §12 M4 — *"시스템 User 1개를 쓰면 같은 작성자의 글이 반복 노출된다."*
 *
 * 🔴 **출처를 담지 않는다.** sourceUrl · sourceArticleId · sheetCandidateId ·
 *    sourceSite · sourceCapturedAt 어느 것도 쓰지 않는다 —
 *    색인되는 글에 82cook 원문 주소를 붙이지 않는다. 추적은 대기열이 한다
 *    (OriginalPostApprovalQueue.sourceRawContentId).
 *    🔴 Micro Seed 는 반대다. 저쪽은 takedown 역조회를 위해 반드시 채운다(§6-6) —
 *    저쪽은 noindex 라서 붙일 수 있고, 이쪽은 index 라서 붙이면 안 된다.
 */

// 🔴 실회원 판별은 단일 정본이다. 여기서 다시 쓰지 않는다
import { judgeRealMember } from './real-member-gate'
import { ORIGINAL_POST_VISIBILITY_FLAGS } from './post-visibility'

/**
 * 발행 시 고정되는 값.
 *
 * 🔴 3축은 post-visibility.ts 에서 가져온다. 여기서 리터럴로 적지 않는다 (C-2).
 * 🔴 source 는 여기 둔다 — "내부 공급인가" 는 "보이는가" 와 다른 축이라
 *    게이트에 넣으면 한 필드가 두 질문에 답하려다 실패한다.
 * 🔴 status 는 PUBLISHED 로 시작한다. 입력으로 뒤집을 수 없다.
 */
export const ORIGINAL_POST_FLAGS = {
  ...ORIGINAL_POST_VISIBILITY_FLAGS,
  source: 'SYSTEM',
  status: 'PUBLISHED',
} as const

/** 🔴 이 레인은 자유게시판에만 나간다 */
export const ORIGINAL_POST_BOARD = 'FREE'

export type OriginalPostInput = {
  title: string
  content: string
  /** 🔴 matchedPersona.userId — 시스템 계정이 아니다 */
  authorId: string
  /** 🔴 matchedPersona.id — "누가 썼나" 의 정본 */
  personaId: string
}

/**
 * 🔴 **출처 필드가 없다.** 타입에 자리를 두지 않는 것이 첫 번째 방어다 —
 *    호출부가 실수로 넘길 자리 자체가 없다.
 */
export function buildOriginalPostData(input: OriginalPostInput) {
  return {
    boardType: ORIGINAL_POST_BOARD,
    title: input.title,
    content: input.content,
    authorId: input.authorId,
    personaId: input.personaId,
    // 🔴 예약 발행을 쓰지 않는다. 속도는 cap 이 제한한다
    publishAt: null,
    // 🔴 항상 마지막. 위에서 무엇이 왔든 이 값이 이긴다
    ...ORIGINAL_POST_FLAGS,
  }
}

/** 🔴 색인되는 글에 붙으면 안 되는 필드 */
export const FORBIDDEN_POST_KEYS: readonly string[] = [
  'sourceUrl', 'sourceArticleId', 'sheetCandidateId', 'sourceSite', 'sourceCapturedAt',
]

/**
 * 발행 데이터에 반드시 있어야 하는 필드.
 *
 * 🔴 3축 이름을 여기 적지 않고 게이트에서 **파생**한다.
 *    이름을 적으면 check:visibility 가 "게이트 밖에서 3축을 다룬다" 로 잡고(C-2),
 *    무엇보다 축이 하나 늘었을 때 이 목록이 따라오지 않는다.
 */
export const REQUIRED_POST_KEYS: readonly string[] = [
  'boardType', 'title', 'content', 'authorId', 'personaId', 'status', 'source',
  ...Object.keys(ORIGINAL_POST_VISIBILITY_FLAGS),
]

/**
 * 🔴 create 직전 실측 방어.
 *    함수가 있다는 것과 그 함수만 쓰인다는 것은 다르다 — micro-seed 가 같은 이유로
 *    assertMicroSeedPostData 를 둔다(§6-9-C).
 */
export function assertOriginalPostData(data: Record<string, unknown>): void {
  // 🔴 출처가 섞였는가 — 색인되는 글에 원문 주소를 붙이지 않는다
  for (const key of FORBIDDEN_POST_KEYS) {
    if (key in data) {
      throw new Error(
        `발행 데이터에 ${key} 가 있다. 색인되는 글에 원문 출처를 붙이지 않는다 —\n` +
          '  추적은 OriginalPostApprovalQueue.sourceRawContentId 가 한다.',
      )
    }
  }
  for (const key of REQUIRED_POST_KEYS) {
    if (!(key in data)) throw new Error(`발행 데이터에 ${key} 가 없다`)
  }
  // 🔴 3축이 게이트 값과 같은가. 다르면 어딘가에서 덮어썼다는 뜻이다
  for (const [key, expected] of Object.entries(ORIGINAL_POST_VISIBILITY_FLAGS)) {
    if (data[key] !== expected) {
      throw new Error(`${key}=${JSON.stringify(data[key])} (기대 ${JSON.stringify(expected)}) — 3축은 게이트에서만 온다`)
    }
  }
  if (data.source !== ORIGINAL_POST_FLAGS.source) throw new Error(`source=${JSON.stringify(data.source)}`)
  if (data.status !== ORIGINAL_POST_FLAGS.status) throw new Error(`status=${JSON.stringify(data.status)}`)
  if (data.boardType !== ORIGINAL_POST_BOARD) throw new Error(`boardType=${JSON.stringify(data.boardType)}`)
  // 🔴 작성자와 페르소나가 함께 있어야 한다. 하나만 있으면 "누가 썼나" 가 반쪽이 된다
  for (const key of ['authorId', 'personaId'] as const) {
    const v = data[key]
    if (typeof v !== 'string' || v.trim() === '') throw new Error(`${key} 가 비어 있다`)
  }
  for (const key of ['title', 'content'] as const) {
    const v = data[key]
    if (typeof v !== 'string' || v.trim() === '') throw new Error(`${key} 가 비어 있다`)
  }
}

// ─────────────────────────────────────────────────────────
// 발행 자격 — 🔴 순수 함수
// ─────────────────────────────────────────────────────────

/** 🔴 발행할 수 있는 대기열 상태 */
export const PUBLISHABLE_STATUSES: readonly string[] = ['APPROVED', 'EDITED']

/** 🔴 첫 발행은 gate=PASS 만. HOLD 는 사람이 한 번 더 본 뒤다 */
export const FIRST_PUBLISH_VERDICT = 'PASS'

/** 하루 전역 상한 — 🔴 색인되는 첫 글들이다. 문제가 생겨도 원인을 가릴 수 있어야 한다 */
export const DAILY_PUBLISH_CAP = 1

export const PUBLISH_BLOCK_CODES = [
  'KILL_SWITCH', 'NOT_PUBLISHABLE', 'ALREADY_PUBLISHED', 'NO_MATCH',
  'PERSONA_NOT_ACTIVE', 'REAL_MEMBER', 'GATE_NOT_PASS', 'DAILY_CAP',
] as const
export type PublishBlockCode = (typeof PUBLISH_BLOCK_CODES)[number]

export const PUBLISH_BLOCK_LABEL: Record<PublishBlockCode, string> = {
  KILL_SWITCH: '🔴 전체 중지가 켜져 있다',
  NOT_PUBLISHABLE: '발행할 수 있는 상태가 아니다 (APPROVED · EDITED 만)',
  ALREADY_PUBLISHED: '🔴 이미 발행됐다',
  NO_MATCH: '배정된 페르소나가 없다 — 억지로 배정하지 않는다',
  PERSONA_NOT_ACTIVE: '페르소나가 active 가 아니다',
  REAL_MEMBER: '🔴 실회원 계정이다 — 실회원 이름으로 발행하지 않는다',
  GATE_NOT_PASS: '첫 발행은 gate=PASS 만 (HOLD 는 다음 판단)',
  DAILY_CAP: `오늘 상한 ${DAILY_PUBLISH_CAP}건을 채웠다`,
}

export type PublishCandidate = {
  status: string
  createdPostId: string | null
  gateVerdict: string
  matchedPersonaCode: string | null
  personaStatus: string | null
  /** 🔴 방어적 보조 — adapter 가 채우지 않는다. 정본은 `personaAccountCount` 다 */
  personaProviderId: string | null
  /**
   * 🔴 **실회원 판별 정본** — persona User 의 `Account` 행 수.
   *    `null` 은 "모른다" 이고 **막는다**. 발행은 되돌릴 수 없으므로 fail-closed 다.
   */
  personaAccountCount: number | null
}

export type PublishVerdict =
  | { ok: true }
  | { ok: false; code: PublishBlockCode; detail: string }

/**
 * 발행해도 되는가.
 *
 * 🔴 순서가 규칙이다. 발행 여부를 **가장 먼저** 본다 —
 *    status 가 어떤 값이든 createdPostId 가 있으면 그 글은 이미 세상에 나갔다.
 */
export function judgePublish(
  c: PublishCandidate,
  ctx: { killSwitchEnabled: boolean; publishedToday: number },
): PublishVerdict {
  if (c.createdPostId !== null && c.createdPostId.trim() !== '') {
    return { ok: false, code: 'ALREADY_PUBLISHED', detail: PUBLISH_BLOCK_LABEL.ALREADY_PUBLISHED }
  }
  if (c.status === 'PUBLISHED') {
    return { ok: false, code: 'ALREADY_PUBLISHED', detail: PUBLISH_BLOCK_LABEL.ALREADY_PUBLISHED }
  }
  // 🔴 멈춰 있는 동안 새 글을 내보내지 않는다
  if (ctx.killSwitchEnabled) return { ok: false, code: 'KILL_SWITCH', detail: PUBLISH_BLOCK_LABEL.KILL_SWITCH }
  if (!PUBLISHABLE_STATUSES.includes(c.status)) {
    return { ok: false, code: 'NOT_PUBLISHABLE', detail: `${PUBLISH_BLOCK_LABEL.NOT_PUBLISHABLE} — 현재 ${c.status}` }
  }
  // 🔴 배정이 없으면 발행하지 않는다. 억지로 작성자를 정하지 않는다
  if (c.matchedPersonaCode === null || c.matchedPersonaCode.trim() === '') {
    return { ok: false, code: 'NO_MATCH', detail: PUBLISH_BLOCK_LABEL.NO_MATCH }
  }
  // 🔴 배정 후 페르소나가 멈췄을 수 있다. 발행 직전에 다시 본다
  if (c.personaStatus !== 'active') {
    return { ok: false, code: 'PERSONA_NOT_ACTIVE', detail: `${PUBLISH_BLOCK_LABEL.PERSONA_NOT_ACTIVE} (${c.personaStatus ?? '—'})` }
  }
  // 🔴 실회원 이름으로 발행되면 신뢰 사고다. 되돌리기 어렵다.
  //    정본은 `Account` 이고, 모르면 막는다 — 발행 직전 게이트라 fail-closed 여야 한다
  //    🔴 판정은 `judgeRealMember` 하나뿐이다 — 여기서 다시 쓰면 배정과 발행이 다른 말을 한다
  const real = judgeRealMember({ accountCount: c.personaAccountCount, providerId: c.personaProviderId })
  if (real.real) {
    return { ok: false, code: 'REAL_MEMBER', detail: `${PUBLISH_BLOCK_LABEL.REAL_MEMBER} — ${real.reason}` }
  }
  if (c.gateVerdict !== FIRST_PUBLISH_VERDICT) {
    return { ok: false, code: 'GATE_NOT_PASS', detail: `${PUBLISH_BLOCK_LABEL.GATE_NOT_PASS} — 현재 ${c.gateVerdict}` }
  }
  if (ctx.publishedToday >= DAILY_PUBLISH_CAP) {
    return { ok: false, code: 'DAILY_CAP', detail: `${PUBLISH_BLOCK_LABEL.DAILY_CAP} (${ctx.publishedToday}/${DAILY_PUBLISH_CAP})` }
  }
  return { ok: true }
}

/** KST 자정 (UTC 기준 Date). 🔴 cap 은 하루 단위라 경계가 정확해야 한다 */
export function kstDayStart(now: Date): Date {
  const kst = new Date(now.getTime() + 9 * 3600e3)
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600e3)
}

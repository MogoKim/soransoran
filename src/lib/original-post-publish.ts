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

import { derive, SAFEST_PROFILE } from './scale-profile'

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
/**
 * 🔴 **이 값은 "가장 안전한 기본값" 이다** (2026-09-08 개정).
 *
 *    예전에는 이 상수를 env 에서 파생시켰다. 그런데 ESM 은 정적 import 를 모듈 본문보다
 *    먼저 평가하므로, 운영 스크립트가 `loadEnvLocal()` 로 `.env.local` 을 읽기 **전에**
 *    이 값이 굳어 버렸다 — 설정은 반영되지 않는데 화면만 반영됐다고 말했다.
 *
 *    🔴 그래서 실제 상한은 **러너가 주입한다**(`judgePublish` 의 `ctx.dailyCap`).
 *       주입을 잊으면 이 상수(=1)로 떨어진다 — 조용히 10건이 나가지 않는다.
 */
export const DAILY_PUBLISH_CAP = derive(SAFEST_PROFILE).dailyPublishCap

/**
 * 🔴 **수동 발행기의 상한** — 환경과 무관하게 항상 가장 안전한 값이다 (2026-09-08, Codex P0).
 *
 *    수동 도구(`original-post-publish-live`)는 준비도 시뮬레이션을 돌리지 않는다.
 *    거기에 env 를 그대로 적용하면 `SORAN_RELEASE_STAGE=d10` 에서 사람이
 *    `--apply --limit=10` 을 쳐서 **감속을 손으로 우회**할 수 있다.
 *    d3·d5·d10 확장은 준비도를 계산하는 자동 레인만 허용한다.
 */
export const MANUAL_PUBLISH_CAP = derive(SAFEST_PROFILE).dailyPublishCap

/** 🔴 수동 발행 `--limit` 판정 — **write 전에** 막는다 */
export function judgeManualLimit(limit: number | null): { ok: boolean; reason: string } {
  if (limit === null || !Number.isInteger(limit) || limit < 1) {
    return { ok: false, reason: `--limit=N (1 이상 정수) 이 필요하다 (받은 값 ${limit ?? '없음'})` }
  }
  if (limit > MANUAL_PUBLISH_CAP) {
    return {
      ok: false,
      reason: `--limit ${limit} 이 이 도구의 상한 ${MANUAL_PUBLISH_CAP}건을 넘는다`
        + ` — 수동 도구는 긴급 단건 발행 전용이다. 여러 건은 original-post-auto-publish 경로를 쓴다`,
    }
  }
  return { ok: true, reason: '' }
}

export const PUBLISH_BLOCK_CODES = [
  'KILL_SWITCH', 'NOT_PUBLISHABLE', 'ALREADY_PUBLISHED', 'NO_MATCH',
  'PERSONA_NOT_ACTIVE', 'REAL_MEMBER', 'GATE_NOT_PASS', 'DAILY_CAP',
  /** 🔴 자동 도장 행을 트랜잭션 안에서 다시 봤더니 내보낼 수 없다 */
  'AUTO_READY_RECHECK',
  /** 🔴 자동 행에 계획한 Persona 를 트랜잭션 안에서 다시 판정했더니 탈락했다 */
  'AUTO_ASSIGN_STALE',
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
  DAILY_CAP: '오늘 상한을 채웠다',
  AUTO_READY_RECHECK: '🔴 자동 도장 행을 발행 직전에 다시 봤더니 내보낼 수 없다 — 스위치·도장·경고·결함',
  AUTO_ASSIGN_STALE: '🔴 계획한 Persona 를 발행 직전에 다시 판정했더니 탈락했다 — 말투·생활사·실회원·주간 상한·최소 간격',
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
  /**
   * 🔴 `dailyCap` 은 **필수 주입**이다. 모듈 상수를 읽지 않는다 —
   *    읽으면 `.env.local`·GHA vars 로 정한 단계가 쓰기 경로에 도달하지 못한다.
   */
  ctx: { killSwitchEnabled: boolean; publishedToday: number; dailyCap: number },
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
  // 🔴 주입값이 이상하면 **가장 안전한 상수**로 떨어진다 (fail-closed)
  const cap = Number.isInteger(ctx.dailyCap) && ctx.dailyCap > 0 ? ctx.dailyCap : DAILY_PUBLISH_CAP
  if (ctx.publishedToday >= cap) {
    return { ok: false, code: 'DAILY_CAP', detail: `${PUBLISH_BLOCK_LABEL.DAILY_CAP} (${ctx.publishedToday}/${cap})` }
  }
  return { ok: true }
}

/** KST 자정 (UTC 기준 Date). 🔴 cap 은 하루 단위라 경계가 정확해야 한다 */
export function kstDayStart(now: Date): Date {
  const kst = new Date(now.getTime() + 9 * 3600e3)
  return new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - 9 * 3600e3)
}

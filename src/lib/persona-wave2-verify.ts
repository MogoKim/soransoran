/**
 * Persona 2차 확장 — **DB 에 저장된 값**의 정합 판정. 🔴 순수 함수다
 *
 * 🔴 왜 떼어냈나.
 *    "seed 가 됐는가" 를 각 스크립트가 따로 판단하면, `seed --check` 는 통과했는데
 *    `activate` 는 다른 기준으로 통과시키는 날이 온다. 그날 **절반만 채워진 사람**이 켜진다.
 *
 * 🔴 **입력 파일이 아니라 DB 값을 본다.** 파일은 적용 뒤 바뀔 수 있고,
 *    실제로 켜지는 것은 DB 에 들어간 값이다.
 */

import { verifySeedCard, type SeedCard } from './persona-card-verify'
import type { PoolCard } from './persona-pool-card'
import { judgeRealMember } from './real-member-gate'

/** DB 에서 읽은 한 행 — 🔴 `select` 가 빠뜨린 필드는 `undefined` 로 와야 한다 */
export type PersonaDbRow = {
  code: string
  status: string
  nickname: string | null
  accountCount: number | null
  providerId: string | null
  ageBand: string | null
  region: string | null
  lifeStage: string | null
  identity: unknown
  voiceCore: unknown
  voiceVariations: unknown
  activityRhythm: unknown
  noGoTopics: unknown
  noGoExpressions: unknown
  forbiddenReactionRoles: unknown
  dailyCap: unknown
  weeklyCap: unknown
  silenceRate: unknown
  /** 🔴 **이 persona 한 명 기준**으로 몇 건인가. 전체 합계로 세면 한 명에 몰려도 통과한다 */
  auditCreated: number
  auditNameAssigned: number
  /**
   * 🔴 `status_changed` 기록 — 🔴 켜진 흔적이다.
   *    `status` 만 손으로 `active` 로 바꾼 행은 여기가 비어 있다.
   */
  auditStatusChanged: readonly {
    fromStatus: string | null
    toStatus: string | null
    actorUserId: string | null
    reason: string | null
  }[]
}

/**
 * DB 행 → `verifySeedCard` 가 아는 모양.
 *
 * 🔴 `silenceRate` 는 Prisma `Decimal` 로 온다. `Number()` 로 바꾸지 않으면
 *    범위 검사가 통과해 버린다 — 검사하지 않은 것은 위반 없음이 아니다.
 */
export function dbRowToSeedCard(r: PersonaDbRow): SeedCard {
  return {
    ageBand: r.ageBand, region: r.region, lifeStage: r.lifeStage,
    identity: r.identity, voiceCore: r.voiceCore,
    voiceVariations: r.voiceVariations, activityRhythm: r.activityRhythm,
    noGoTopics: r.noGoTopics, noGoExpressions: r.noGoExpressions,
    forbiddenReactionRoles: r.forbiddenReactionRoles,
    dailyCap: typeof r.dailyCap === 'object' && r.dailyCap !== null ? Number(r.dailyCap) : r.dailyCap,
    weeklyCap: typeof r.weeklyCap === 'object' && r.weeklyCap !== null ? Number(r.weeklyCap) : r.weeklyCap,
    silenceRate: r.silenceRate === null || r.silenceRate === undefined ? r.silenceRate : Number(r.silenceRate),
  } as SeedCard
}

export type SeedVerdict = { complete: boolean; problems: string[] }

/**
 * 🔴 **seed 가 정말 다 됐는가** — 생활사 5축만 보지 않는다.
 *
 *    `verifySeedCard` 가 필수 축 · 제어값 · 자녀 정합 · 길이 · cap · **정본 일치**까지 본다.
 *    Pool 카드를 못 찾으면 그것도 문제다 — 정본 없는 사람을 켤 수는 없다.
 */
export function verifyPersonaSeed(row: PersonaDbRow, poolCard: PoolCard | null): SeedVerdict {
  const problems = verifySeedCard(row.code, dbRowToSeedCard(row), poolCard)
  return { complete: problems.length === 0, problems }
}

export type PreflightVerdict = { ok: boolean; problems: string[] }

/**
 * 🔴 켜기 직전(또는 트랜잭션 안에서) 다시 보는 것 — **네 가지가 전부** 맞아야 한다.
 *
 *    `expectStatus` 를 받는 이유: 트랜잭션 안에서 다시 부를 때, 읽은 시점과 쓰는 시점 사이에
 *    누가 `status` 를 바꿨는지 확인해야 한다(TOCTOU).
 */
export function preflightPersona(input: {
  row: PersonaDbRow
  poolCard: PoolCard | null
  expectStatus: string
}): PreflightVerdict {
  const { row, poolCard, expectStatus } = input
  const problems: string[] = []

  if (row.status !== expectStatus) {
    problems.push(`${row.code}: status=${row.status} — ${expectStatus} 여야 한다 (읽은 뒤 바뀌었을 수 있다)`)
  }
  if ((row.nickname ?? '').trim() === '') problems.push(`${row.code}: 닉네임이 없다`)

  // 🔴 실회원 판별은 정본 하나뿐이다
  const real = judgeRealMember({ accountCount: row.accountCount, providerId: row.providerId })
  if (real.real) problems.push(`${row.code}: ${real.reason}`)

  // 🔴 seed 는 **전체**를 본다 — 일부만 채워진 사람을 켜면 매칭이 잘못 판정한다
  const seed = verifyPersonaSeed(row, poolCard)
  if (!seed.complete) problems.push(`${row.code}: seed 미완 — ${seed.problems.join(' / ')}`)

  // 🔴 감사 기록 — 만든 흔적이 없으면 어디서 온 사람인지 말할 수 없다.
  //    🔴 **이 persona 기준**이다. 전체 합계로 세면 한 명에 두 번 남고 다른 한 명은 없어도 통과한다
  if (row.auditCreated !== 1) problems.push(`${row.code}: AuditLog created ${row.auditCreated}건 (1이어야 한다)`)
  if (row.auditNameAssigned !== 1) problems.push(`${row.code}: AuditLog display_name_assigned ${row.auditNameAssigned}건 (1이어야 한다)`)

  // 🔴 active 를 기대할 때는 **켜진 흔적**까지 본다.
  //    status 만 손으로 바꾼 행은 여기가 비어 있고, 그러면 누가 왜 켰는지 말할 수 없다
  if (expectStatus === 'active') problems.push(...verifyActivationAudit(row))

  return { ok: problems.length === 0, problems }
}

/**
 * 🔴 켜진 흔적 — `status_changed` 가 **정확히 1건**이고 그 내용이 맞아야 한다.
 *    `fromStatus=draft` · `toStatus=active` · actor · reason 이 전부 채워져야 한다.
 */
export function verifyActivationAudit(row: PersonaDbRow): string[] {
  const problems: string[] = []
  const logs = row.auditStatusChanged
  if (logs.length !== 1) {
    problems.push(`${row.code}: AuditLog status_changed ${logs.length}건 (1이어야 한다)`)
    return problems
  }
  const l = logs[0]!
  if (l.fromStatus !== 'draft') problems.push(`${row.code}: status_changed fromStatus=${l.fromStatus ?? '—'} (draft 여야 한다)`)
  if (l.toStatus !== 'active') problems.push(`${row.code}: status_changed toStatus=${l.toStatus ?? '—'} (active 여야 한다)`)
  if ((l.actorUserId ?? '').trim() === '') problems.push(`${row.code}: status_changed actorUserId 가 비었다 — 누가 켰는지 남지 않았다`)
  if ((l.reason ?? '').trim() === '') problems.push(`${row.code}: status_changed reason 이 비었다`)
  return problems
}

/** 🔴 세 명 전부 통과해야 한다 — 하나라도 어긋나면 전부 멈춘다 */
export function preflightAll(inputs: readonly { row: PersonaDbRow; poolCard: PoolCard | null }[], expectStatus: string): PreflightVerdict {
  const problems = inputs.flatMap((x) => preflightPersona({ ...x, expectStatus }).problems)
  return { ok: problems.length === 0, problems }
}

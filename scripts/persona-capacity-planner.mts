#!/usr/bin/env tsx
/**
 * Persona 확장 planner — 🔴 **read-only. DB write 0 · 네트워크 0 · LLM 0 · 발행 0**
 *
 * 무엇을 답하는가: "M1 1/day 를 14일 지속하려면 정본 Pool 카드 중 **누구를** 켜야 하는가."
 *
 * 🔴 **새 판정을 만들지 않는다.**
 *    매칭은 `planBatch`, 예측은 `forecastPublishing`, 후보 선별은 `selectAutoTargets`,
 *    상한은 `POST_CAP_PER_WEEK`·`MIN_DAYS_BETWEEN_POSTS`·`DAILY_PUBLISH_CAP` 이 정한다.
 *    여기서 다시 구현하면 planner 가 러너와 다른 말을 하고, 그 위에서 persona 를 늘리게 된다.
 *
 * 🔴 **카드를 손으로 옮겨 적지 않는다.** `docs/operations/2026-08-30-persona-pool-design.md` §5 를
 *    그대로 읽는다 (`parsePoolDoc`). 옮겨 적는 순간 존재하지 않는 사람을 놓고 계산하게 된다.
 *
 * 사용법
 *   npx tsx scripts/persona-capacity-planner.mts              # 화면
 *   npx tsx scripts/persona-capacity-planner.mts -- --json    # 같은 결과를 JSON 으로
 *   npx tsx scripts/persona-capacity-planner.mts -- --size=3  # 조합 크기 (기본 3)
 */
import { readFileSync } from 'node:fs'

import { forecastPublishing, type PersonaHistory } from '../src/lib/supply-capacity-forecast'
import { selectAutoTargets } from '../src/lib/original-post-auto-publish'
import { DAILY_PUBLISH_CAP } from '../src/lib/original-post-publish'
import { parsePoolDoc, cardToPersona, type PoolCard } from '../src/lib/persona-pool-card'
import type { BatchDraft, PersonaForMatch } from '../src/lib/original-post-persona-match'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const SIZE = Number((argv.find((a) => a.startsWith('--size=')) ?? '--size=3').split('=')[1])
const DAYS = 14
const POOL_DOC = 'docs/operations/2026-08-30-persona-pool-design.md'

/** 🔴 목표는 여기 하나뿐이다 — 화면과 JSON 이 같은 값을 본다 */
const GOAL = { in7: 7, in14: 14, gaps: 0 } as const

/**
 * 🔴 **재고가 목표보다 적으면 결과는 확정값이 아니다** (2026-09-08).
 *
 *    14일에 14건을 내려면 후보가 14건 있어야 한다. 13건이면 아무리 사람을 늘려도 13건이
 *    상한이다 — 그때 나온 "이 조합이 최선" 은 persona 가 아니라 **재고가 정한 답**이다.
 *    그 사실을 화면에 적지 않으면 사람은 확정된 결론으로 읽는다.
 */
const inventoryLimited = (queueCount: number): boolean => queueCount < GOAL.in14

const out: string[] = []
const say = (s = ''): void => { if (!JSON_OUT) console.log(s) }

await loadEnvLocal()
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()

// ── ① 실제 큐 — 🔴 러너가 보는 것과 같은 후보만 ──
const queueRows = await prisma.originalPostApprovalQueue.findMany({
  where: { status: { in: ['APPROVED', 'EDITED'] }, createdPostId: null },
  select: {
    id: true, status: true, createdPostId: true, gateVerdict: true, promptVersion: true,
    model: true, matchedPersonaId: true, draftTitle: true, draftBody: true,
    editedTitle: true, editedBody: true, gateResults: true, decidedAt: true, createdAt: true,
    rawContent: { select: { sourceSite: true } },
  },
  orderBy: { createdAt: 'asc' },
})
const { targets } = selectAutoTargets(
  queueRows.map((r) => ({
    id: r.id, status: r.status, createdPostId: r.createdPostId, gateVerdict: r.gateVerdict,
    promptVersion: r.promptVersion, model: r.model, matchedPersonaId: r.matchedPersonaId,
    gateResults: r.gateResults, title: r.editedTitle ?? r.draftTitle, body: r.editedBody ?? r.draftBody,
    sourceSite: r.rawContent.sourceSite, decidedAt: r.decidedAt, createdAt: r.createdAt,
  })),
  (t, b) => safetyFilter({ title: t, body: b }).verdict,
)

// ── ② 현재 active persona ──
const personaRows = await prisma.persona.findMany({
  where: { status: 'active' },
  select: {
    id: true, code: true, status: true, identity: true, voiceCore: true, noGoTopics: true,
    user: { select: { providerId: true, _count: { select: { accounts: true } } } },
  },
  orderBy: { code: 'asc' },
})
const codeOfPersonaId = new Map(personaRows.map((r) => [r.id, r.code]))

// 🔴 러너와 **같은 필드**를 넘긴다 — `childrenCount` 가 빠지면 전원 무자녀로 판정된다 (#468)
const active: PersonaForMatch[] = personaRows.map((r) => {
  const id = (r.identity ?? {}) as Record<string, unknown>
  const vc = (r.voiceCore ?? {}) as Record<string, unknown>
  return {
    code: r.code, status: r.status, providerId: r.user?.providerId ?? null,
    // 🔴 실회원 판별 정본. 넘기지 않으면 hardFilter 가 fail-closed 로 막는다
    accountCount: r.user?._count.accounts ?? null,
    maritalStatus: typeof id.maritalStatus === 'string' ? id.maritalStatus : null,
    childrenCount: typeof id.childrenCount === 'number' ? id.childrenCount : null,
    ...(Array.isArray(id.childrenAgeBands) ? { childrenAgeBands: id.childrenAgeBands as never } : {}),
    parentCare: typeof id.parentCare === 'string' ? id.parentCare : null,
    menopauseStatus: typeof id.menopauseStatus === 'string' ? id.menopauseStatus : null,
    workStatus: typeof id.workStatus === 'string' ? id.workStatus : null,
    economicStatus: typeof id.economicStatus === 'string' ? id.economicStatus : null,
    region: null, noGoTopics: r.noGoTopics,
    voiceLength: typeof vc.length === 'string' ? vc.length : null,
    postsThisWeek: 0, daysSinceLastPost: null,
  } as PersonaForMatch
})

// ── ③ 이력 ──
const logs = await prisma.personaActivityLog.findMany({
  where: { kind: 'post' }, select: { createdAt: true, persona: { select: { code: true } } },
})
const historyOf = (codes: readonly string[]): PersonaHistory[] =>
  codes.map((c) => ({ code: c, matchedAts: logs.filter((l) => l.persona?.code === c).map((l) => l.createdAt) }))

// ── ④ 예약 시각 — 🔴 러너의 다음 회차와 같아야 한다 ──
const { kstDayStart } = await import('../src/lib/original-post-publish')
const { nextScheduleAt, kstStamp } = await import('../src/lib/supply-capacity-forecast')
const now = new Date()
const todayCount = await prisma.personaActivityLog.count({
  where: { kind: 'post', createdAt: { gte: kstDayStart(now) } },
})
const startAt = nextScheduleAt({ now, publishedToday: todayCount, dailyCap: DAILY_PUBLISH_CAP })

await prisma.$disconnect()

// ── ⑤ Pool 카드 ──
const pool = parsePoolDoc(readFileSync(POOL_DOC, 'utf-8'))
const activeCodes = new Set(active.map((p) => p.code))
const notActive = pool.cards.filter((c) => !activeCodes.has(c.code))

/**
 * 🔴 **길이를 모르는 카드는 후보에서 뺀다** (2026-09-08).
 *
 *    `readLengthBand` 가 읽지 못하는 표현(`말끝 흐림` · `긴 문장` · `간결`)은 매칭에서 중립이다.
 *    시뮬레이션은 그 중립값으로 돌아가는데, 실제로 사람을 만들 때 seed 에는 **누군가 고른 길이**가
 *    들어간다. 그러면 시뮬레이션한 사람과 만들어질 사람이 다른 사람이 되고,
 *    "이 조합이면 7건" 이라는 결론이 검증되지 않은 값 위에 서게 된다.
 *
 *    🔴 사람이 추정한 기본값을 넣지 않는다. 정본이 보완되면 그때 후보로 돌아온다.
 */
const excludedNoLength = notActive.filter((c) => c.voiceLength === null)
const inactive = notActive.filter((c) => c.voiceLength !== null)

// ── ⑥ 큐 — 🔴 기존 배정은 정본이다 (러너·관제와 같다) ──
const queue: BatchDraft[] = targets.map((t) => ({
  queueId: t.id, title: t.title, body: t.body, gateVerdict: t.gateVerdict, createdAt: 0,
  assignedPersonaCode: t.matchedPersonaId === null
    ? null
    : (codeOfPersonaId.get(t.matchedPersonaId) ?? `__unknown:${t.matchedPersonaId}`),
}))

export type ComboResult = {
  codes: string[]
  in7: number
  in14: number
  gaps: number
  gapDates: string[]
  load: Record<string, number>
  meetsGoal: boolean
  recoveryBroken: number
}

/** 🔴 조합 하나를 정본 예측기로 돌린다. 여기에 계산이 없다 */
function run(cards: readonly PoolCard[]): ComboResult {
  const extra = cards.map(cardToPersona)
  const personas = [...active, ...extra]
  const f = forecastPublishing({
    queue, personas,
    history: [...historyOf(active.map((p) => p.code)), ...extra.map((p) => ({ code: p.code, matchedAts: [] }))],
    startAt, days: DAYS, dailyCap: DAILY_PUBLISH_CAP,
  })
  const load: Record<string, number> = {}
  for (const d of f.days) for (const p of d.published) load[p.persona] = (load[p.persona] ?? 0) + 1
  const gapDates = f.days.filter((d) => d.published.length === 0).map((d) => d.date)
  return {
    codes: cards.map((c) => c.code),
    in7: f.in7, in14: f.in14, gaps: gapDates.length, gapDates, load,
    meetsGoal: f.in7 >= GOAL.in7 && f.in14 >= GOAL.in14 && gapDates.length <= GOAL.gaps,
    recoveryBroken: f.recoveryBroken.length,
  }
}

/** 🔴 모든 조합을 본다 — 손으로 고른 몇 개만 돌리면 "최소" 를 말할 수 없다 */
function combinations<T>(xs: readonly T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (xs.length < k) return []
  const [head, ...rest] = xs
  return [...combinations(rest, k - 1).map((c) => [head!, ...c]), ...combinations(rest, k)]
}

const baseline = run([])
/** 🔴 크기 1부터 올라가며 **처음 목표를 채우는 크기**를 찾는다 — 그것이 최소다 */
let minSize: number | null = null
const bySize = new Map<number, ComboResult[]>()
for (let k = 1; k <= SIZE; k += 1) {
  const results = combinations(inactive, k).map(run)
  bySize.set(k, results)
  if (minSize === null && results.some((r) => r.meetsGoal)) minSize = k
}

/**
 * 🔴 얇은 축 — 그 축을 맡을 수 있는 사람이 몇 명인가. 1명이면 그 사람이 쉬는 날 큐가 막힌다.
 *
 * 🔴 **이미 켜진 사람은 DB 를 본다** (2026-09-08). 문서 카드로 세면 seed 이전이 문서를
 *    완전히 반영하지 않은 부분(실측: P15·P17 의 `noGoTopics`·금지 역할)이 가려진다.
 *    켜진 사람의 정본은 DB 다 — 매칭도 DB 를 읽는다. 아직 없는 사람만 문서를 본다.
 */
type AxisSubject = { code: string; childrenAgeBands: readonly string[]; maritalStatus: string | null; parentCare: string | null; menopauseStatus: string | null }
const activeSubjects: AxisSubject[] = active.map((p) => ({
  code: p.code,
  childrenAgeBands: (p as { childrenAgeBands?: readonly string[] }).childrenAgeBands ?? [],
  maritalStatus: p.maritalStatus ?? null,
  parentCare: p.parentCare ?? null,
  menopauseStatus: p.menopauseStatus ?? null,
}))
function axisCoverage(cards: readonly PoolCard[]): Record<string, string[]> {
  const subjects: AxisSubject[] = [
    ...activeSubjects,
    ...cards.map((c) => ({
      code: c.code, childrenAgeBands: c.childrenAgeBands,
      maritalStatus: c.maritalStatus, parentCare: c.parentCare, menopauseStatus: c.menopauseStatus,
    })),
  ]
  const pick = (f: (s: AxisSubject) => boolean): string[] => subjects.filter(f).map((s) => s.code)
  return {
    '자녀 중고등': pick((s) => s.childrenAgeBands.includes('중고등')),
    '자녀 초등': pick((s) => s.childrenAgeBands.includes('초등')),
    '자녀 대학·취준': pick((s) => s.childrenAgeBands.includes('대학·취준')),
    '자녀 성인': pick((s) => s.childrenAgeBands.includes('성인')),
    '현재형 배우자(기혼)': pick((s) => s.maritalStatus === '기혼'),
    '돌봄 상시': pick((s) => s.parentCare === '상시'),
    '갱년기 전': pick((s) => s.menopauseStatus === '전'),
  }
}

/**
 * 🔴 **얇은 축을 손으로 고르지 않는다.** 지금 맡을 사람이 2명 미만인 축이 곧 얇은 축이다.
 *    목록을 코드에 박으면, 사람이 고른 축만 두터워지고 나머지는 계속 1명으로 남는다.
 */
const BASE_COVERAGE = axisCoverage([])
const ALL_THIN = Object.entries(BASE_COVERAGE).filter(([, v]) => v.length < 2).map(([k]) => k)

/**
 * 🔴 **후보로 채울 수 없는 축은 순위에서 뺀다** (2026-09-08).
 *
 *    남은 후보를 전부 켜도 두께가 늘지 않는 축이 있으면, 모든 조합의 점수가 똑같이 바닥이라
 *    순위가 변별력을 잃는다 — 실측: `자녀 초등` 을 맡을 후보가 P02 하나뿐인데
 *    그 카드가 길이 미상으로 빠지자 어떤 조합도 그 축을 못 채웠다.
 *    채울 수 없는 축은 순위가 아니라 **보고**로 다룬다. 사람이 정본을 보완해야 풀린다.
 */
const MAX_COVERAGE = axisCoverage(inactive)
const UNFILLABLE = ALL_THIN.filter((a) => (MAX_COVERAGE[a] ?? []).length < 2)
const THIN_AXES = ALL_THIN.filter((a) => !UNFILLABLE.includes(a))

/** 얇은 축 중 **가장 얇은 축의 두께** — 이것을 먼저 올린다. 한 축만 몰아주면 소용없다 */
const thinFloor = (r: ComboResult): number => {
  if (THIN_AXES.length === 0) return Number.MAX_SAFE_INTEGER
  const cov = axisCoverage(inactive.filter((c) => r.codes.includes(c.code)))
  return Math.min(...THIN_AXES.map((a) => (cov[a] ?? []).length))
}
/** 동률이면 전체 두께 합 (2명까지만 센다 — 3명째는 더 얇은 축을 돕지 않는다) */
const thinSum = (r: ComboResult): number => {
  const cov = axisCoverage(inactive.filter((c) => r.codes.includes(c.code)))
  return THIN_AXES.reduce((n, a) => n + Math.min(2, (cov[a] ?? []).length), 0)
}
// 🔴 발행량 → 공백 적음 → 얇은 축 두터움 → 코드 순. 전부 결정적이다
const rank = (a: ComboResult, b: ComboResult): number =>
  b.in14 - a.in14 || a.gaps - b.gaps || b.in7 - a.in7
  || thinFloor(b) - thinFloor(a) || thinSum(b) - thinSum(a)
  || a.codes.join().localeCompare(b.codes.join())

const pickedFrom = minSize === null ? SIZE : minSize
const winners = [...(bySize.get(pickedFrom) ?? [])].filter((r) => minSize === null || r.meetsGoal).sort(rank)
const best = winners[0] ?? null

// ── 출력 ──
const payload = {
  checkedAt: now.toISOString(),
  startAtKst: kstStamp(startAt),
  days: DAYS,
  dailyCap: DAILY_PUBLISH_CAP,
  goal: GOAL,
  queueCount: queue.length,
  /** 🔴 재고가 목표보다 적어 결과가 재고에 묶였는가 */
  inventoryLimited: inventoryLimited(queue.length),
  /** 🔴 길이 미상으로 후보에서 뺀 카드 — 정본이 보완되면 돌아온다 */
  excludedNoLength: excludedNoLength.map((c) => c.code),
  combinationCount: combinations(inactive, SIZE).length,
  activeCodes: active.map((p) => p.code),
  inactiveCodes: inactive.map((c) => c.code),
  poolProblems: pool.problems,
  lengthUnknown: pool.cards.filter((c) => c.voiceLength === null).map((c) => c.code),
  baseline,
  minSizeMeetingGoal: minSize,
  best,
  axisCoverage: best === null ? BASE_COVERAGE : axisCoverage(inactive.filter((c) => best.codes.includes(c.code))),
  axisCoverageBaseline: BASE_COVERAGE,
  /** 🔴 지금 1명 이하인 축 — 자동 산출이다 */
  thinAxes: THIN_AXES,
  /** 🔴 남은 후보를 전부 켜도 2명이 안 되는 축 — 정본 보완이 필요하다 */
  unfillableAxes: UNFILLABLE,
  bySize: Object.fromEntries([...bySize].map(([k, v]) => [k, [...v].sort(rank).slice(0, 5)])),
}

if (JSON_OUT) {
  console.log(JSON.stringify(payload, null, 2))
} else {
  say('\n══ Persona 확장 planner — 🔴 read-only (DB write 0 · 발행 0) ══\n')
  say(`  큐 ${payload.queueCount}건 · active ${active.length}명 (${payload.activeCodes.join(' ')})`)
  say(`  Pool 미활성 ${notActive.length}명 → 후보 ${inactive.length}명 · 시작 ${payload.startAtKst} · ${DAYS}일 · 하루 ${DAILY_PUBLISH_CAP}건`)
  if (excludedNoLength.length > 0) {
    say(`  🔴 길이 미상으로 **후보 제외** ${excludedNoLength.length}명 (${excludedNoLength.map((c) => c.code).join(' ')})`)
    say('     — readLengthBand 가 읽지 못하는 표현이다. 사람이 추정한 기본값을 넣지 않는다.')
    say('     정본 카드의 voiceCore 가 보완되면 후보로 돌아온다.')
  }
  if (payload.inventoryLimited) {
    say(`\n  🔴 **inventory-limited** — 후보가 ${queue.length}건뿐이라 14일 ${GOAL.in14}건은 나올 수 없다.`)
    say(`     지금 결과는 persona 가 아니라 **재고가 정한 상한**이다. 확정값으로 쓰지 않는다.`)
    say(`     재고가 ${GOAL.in14}건으로 복구된 뒤 이 명령을 다시 돌려 최종 조합을 정한다.`)
  }
  say(`  목표 7일 ${GOAL.in7}건 · 14일 ${GOAL.in14}건 · 공백 ${GOAL.gaps}일`)
  if (pool.problems.length > 0) { say(`\n  🔴 카드 파싱 문제 ${pool.problems.length}건`); for (const p of pool.problems) say(`     ${p}`) }
  if (payload.lengthUnknown.length > 0) {
    say(`  🟡 길이 미상 ${payload.lengthUnknown.length}장 (${payload.lengthUnknown.join(' ')})`)
    say('     — readLengthBand 별칭에 없는 표현이다. 매칭은 중립으로 다룬다 (차단 아님)')
  }
  say(`\n① 현재 5명만 — 7일 ${baseline.in7}건 · 14일 ${baseline.in14}건 · 공백 ${baseline.gaps}일`)
  say('\n② 조합 크기별 상위 5')
  for (const [k, v] of bySize) {
    say(`\n   ── +${k}명 (조합 ${combinations(inactive, k).length}가지)`)
    for (const r of [...v].sort(rank).slice(0, 5)) {
      say(`      ${r.codes.join(' ').padEnd(12)} 7일 ${String(r.in7).padStart(2)}건 · 14일 ${String(r.in14).padStart(2)}건`
        + ` · 공백 ${r.gaps}일 ${r.meetsGoal ? '✅ 목표 달성' : ''}`)
    }
  }
  say(`\n③ 목표를 채우는 최소 인원: ${minSize === null ? `🔴 +${SIZE}명으로도 못 채운다` : `+${minSize}명`}`)
  if (best !== null) {
    say(`\n④ 권장 조합  ${best.codes.join(' ')}`)
    say(`   7일 ${best.in7}건 · 14일 ${best.in14}건 · 공백 ${best.gaps}일 · RECOVERY_BROKEN ${best.recoveryBroken}건`)
    say(`   14일 부하 ${Object.entries(best.load).sort().map(([k, v]) => `${k}:${v}`).join(' ')}`)
    say(`\n⑤ 얇은 축 이중화 (현재 → 권장 적용 후) — 🔴 얇은 축은 자동 산출: ${THIN_AXES.join(' · ') || '없음'}`)
    say('   현재 커버는 **DB 실제 identity** 기준이다 (문서가 아니라). 후보만 Pool 문서를 본다.')
    for (const [axis, after] of Object.entries(payload.axisCoverage)) {
      const before = payload.axisCoverageBaseline[axis] ?? []
      const mark = after.length >= 2 ? '✅' : after.length === 1 ? '🟡 1명뿐' : '🔴 0명'
      say(`   ${axis.padEnd(20)} ${before.length}명 → ${after.length}명  ${mark}  (${after.join(' ')})`)
    }
  }
  if (UNFILLABLE.length > 0) {
    say(`\n🔴 **남은 후보로 채울 수 없는 축 ${UNFILLABLE.length}개: ${UNFILLABLE.join(' · ')}**`)
    say('   어떤 조합을 골라도 2명이 되지 않는다. 순위에서 제외했고, 정본 카드 보완이 필요하다.')
    for (const a of UNFILLABLE) {
      const holders = (MAX_COVERAGE[a] ?? []).join(' ') || '없음'
      say(`   · ${a}: 전 후보를 켜도 ${holders}`)
    }
  }
  if (payload.inventoryLimited) {
    say(`\n🔴 **재고 ${queue.length}건 / 목표 ${GOAL.in14}건 — inventory-limited.** 위 조합은 잠정이다.`)
    say(`   재고가 ${GOAL.in14}건으로 찬 뒤 \`npm run persona:capacity-planner\` 를 다시 돌려 확정한다.`)
  }
  say('\n🔴 이 명령은 DB 를 쓰지 않는다. persona 생성·활성화·발행은 하지 않았다.\n')
}

#!/usr/bin/env tsx
/**
 * 🔴 **예약 발행 슬롯 — 트랜잭션 권한 실행 검사 (격리 Postgres 전용)** (2026-09-26 마스터 P0)
 *
 *   GitHub 예약은 110~408분 늦게 온다(실측 79회). 러너 밖의 판정은 그 순간의 사진이라,
 *   두 러너가 같은 "발행 0" 을 보고 순차로 들어오면 도래 슬롯 1건에 2건이 나갔다(재현).
 *   이 검사는 **실제 소비 경로**(`publishOriginalPostTx` · scheduled 모드)를 시계만 고정해 돌린다.
 *   판정 함수를 복제하지 않는다 — 트랜잭션이 부르는 `judgeCatchUp` 을 그대로 거친다.
 *
 * 🔴 운영 DB 에 절대 붙이지 않는다(sentinel · localhost · soran_test). 모델 호출 0.
 *
 *   npm run publish:slot-db-check
 */
import { PrismaClient } from '@prisma/client'

import { publishOriginalPostTx, type PlannedTarget, type PublishResult } from '../src/lib/original-post-publish-tx'

const URL = process.env.DATABASE_URL ?? ''
const problems: string[] = []
if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(URL)) problems.push('DATABASE_URL 이 localhost 주소가 아니다')
if (!/\/soran_test(\?|$)/.test(URL)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
if (problems.length > 0) {
  console.error('🔴 격리 DB 가 아니다. 멈춘다.')
  for (const p of problems) console.error(`   · ${p}`)
  process.exit(2)
}

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}

const prisma = new PrismaClient()
/** KST 벽시계 → Date */
const K = (s: string): Date => new Date(`${s}+09:00`)
const envOf = (stage: string): Record<string, string> => ({ SORAN_RELEASE_STAGE: stage, SORAN_CAPACITY_STAGE: stage })

let seq = 0
async function wipe(): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue","MicroSeedRawContent","Post","Persona","User" CASCADE')
}
/** 발행 가능한 사람 결정 후보 한 건 — Persona 도 각자 */
async function cand(): Promise<string> {
  seq += 1
  const u = await prisma.user.create({ data: { nickname: `슬롯${seq}` }, select: { id: true } })
  const p = await prisma.persona.create({ data: { code: `S${String(seq).padStart(3, '0')}`, userId: u.id, status: 'active' }, select: { id: true } })
  const raw = await prisma.microSeedRawContent.create({
    data: { origin: 'live', sourceSite: 'sheet:x', sourceUrl: `https://example.invalid/s${seq}`, sourceArticleId: `S${seq}`, sourceCapturedAt: new Date(), rawTitle: 't', rawBody: 'b' },
    select: { id: true },
  })
  const q = await prisma.originalPostApprovalQueue.create({
    data: {
      sourceRawContentId: raw.id, status: 'APPROVED', draftTitle: `평범한 하루 ${seq}`, draftBody: `아침에 산책을 다녀왔어요 ${seq}. 다들 어떻게 지내세요?`,
      gateVerdict: 'PASS', gateResults: { holds: [], blocks: [] } as never, promptVersion: 'p', model: 'm', decidedBy: 'founder',
      dedupKey: `slot-${seq}`, matchedPersonaId: p.id, matchedAt: new Date(),
    },
    select: { id: true },
  })
  return q.id
}
/** 🔴 선택기가 고른 순간의 스냅샷 — 러너가 `publishable-stock` 행에서 만드는 것과 같은 칸이다 */
const planOf = async (id: string): Promise<PlannedTarget> => {
  const r = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, createdPostId: true, updatedAt: true, decidedBy: true } })
  return { queueId: r.id, status: r.status, createdPostId: r.createdPostId, updatedAt: r.updatedAt, decidedBy: r.decidedBy }
}
/**
 * 🔴 예약 러너가 부르는 그대로 — 밖에서 센 발행 수와 계획 스냅샷을 넘긴다.
 *    스냅샷을 주지 않으면 **부르기 직전에** 뜬다(러너가 막 선택한 경우). 경합 반례는 미리 떠서 넘긴다.
 */
const scheduled = async (id: string, at: Date, stage: string, env: Record<string, string>, outsideSeen = 0, plan?: PlannedTarget): Promise<PublishResult> =>
  publishOriginalPostTx(prisma, {
    queueId: id, publishedToday: outsideSeen, mode: { kind: 'scheduled', releaseStage: stage, planned: plan ?? await planOf(id) }, autoReadyEnv: env,
  }, { now: () => at })
const posts = () => prisma.post.count()
const logs = () => prisma.personaActivityLog.count({ where: { kind: 'post' } })
const q = (id: string) => prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id }, select: { status: true, createdPostId: true } })

async function main(): Promise<void> {
  console.log('\n══ 예약 발행 슬롯 — 트랜잭션 권한 (격리 DB 전용 · 운영 DB 0) ══\n')

  console.log('① 🔴 🔴 08:10 d10 · 도래 1 · 두 러너가 밖에서 발행 0 을 봤다 — 순차')
  {
    await wipe()
    const [a, b] = [await cand(), await cand()]
    const ra = await scheduled(a, K('2026-10-01T08:10:00'), 'd10', envOf('d10'), 0)
    const rb = await scheduled(b, K('2026-10-01T08:12:00'), 'd10', envOf('d10'), 0)
    const qb = await q(b)
    check('🔴 🔴 **순차 실행 결과 Post 정확히 1**', ra.kind === 'published' && (await posts()) === 1, `${ra.kind}/${rb.kind}`)
    check('🔴 🔴 **패자 — SLOT_CONSUMED · Queue 변화 0 · ActivityLog 추가 0**',
      rb.kind === 'blocked' && rb.code === 'SLOT_CONSUMED' && qb.status === 'APPROVED' && qb.createdPostId === null && (await logs()) === 1, JSON.stringify(rb))
    // ③ 다음 슬롯 도래 후 두 번째 글
    const rc = await scheduled(b, K('2026-10-01T09:30:00'), 'd10', envOf('d10'), 1)
    check('🔴 🔴 **다음 슬롯(09:30) 도래 후 → 두 번째 글 발행**', rc.kind === 'published' && (await posts()) === 2, JSON.stringify(rc))
  }

  console.log('\n② 🔴 🔴 같은 입력 동시 실행 → Post 정확히 1 · 패자는 재시도 뒤 정상 무발행')
  {
    await wipe()
    const [a, b] = [await cand(), await cand()]
    const at = K('2026-10-01T08:10:00')
    const [r1, r2] = await Promise.all([scheduled(a, at, 'd10', envOf('d10')), scheduled(b, at, 'd10', envOf('d10'))])
    const loser = r1.kind === 'published' ? r2 : r1
    check('🔴 🔴 **서로 다른 후보 동시 — Post 정확히 1 · ActivityLog 1**', (await posts()) === 1 && (await logs()) === 1, `${r1.kind}/${r2.kind}`)
    check('🔴 🔴 **패자는 충돌 뒤 한 번 재시도 → 슬롯을 다시 세어 SLOT_CONSUMED (오류 아님)**',
      loser.kind === 'blocked' && loser.code === 'SLOT_CONSUMED', JSON.stringify(loser))
    await wipe()
    const c = await cand()
    const [s1, s2] = await Promise.all([scheduled(c, at, 'd10', envOf('d10')), scheduled(c, at, 'd10', envOf('d10'))])
    check('🔴 같은 후보 동시 — Post 정확히 1', (await posts()) === 1 && [s1, s2].filter((x) => x.kind === 'published').length === 1, `${s1.kind}/${s2.kind}`)
  }

  console.log('\n③ 🔴 단계별 첫 슬롯 — 도래 전 SLOT_CLOSED · 직후 발행')
  {
    const first: Record<string, string> = { d1: '09:30', d3: '09:30', d5: '08:10', d10: '08:10' }
    let day = 2
    for (const stage of ['d1', 'd3', 'd5', 'd10']) {
      await wipe()
      day += 1
      const date = `2026-10-${String(day).padStart(2, '0')}`
      const [hh, mm] = first[stage]!.split(':').map(Number) as [number, number]
      const before = `${String(mm === 0 ? hh - 1 : hh).padStart(2, '0')}:${String(mm === 0 ? 59 : mm - 1).padStart(2, '0')}`
      const id = await cand()
      const rb = await scheduled(id, K(`${date}T${before}:00`), stage, envOf(stage))
      const ra = await scheduled(id, K(`${date}T${first[stage]}:00`), stage, envOf(stage))
      check(`🔴 ${stage} — ${before} 도래 전 SLOT_CLOSED · ${first[stage]} 직후 발행`,
        rb.kind === 'blocked' && rb.code === 'SLOT_CLOSED' && ra.kind === 'published', `${rb.kind === 'blocked' ? rb.code : rb.kind}/${ra.kind}`)
    }
  }

  console.log('\n④ 🔴 22:00 경계 · 22:00 이후 · 자정 뒤 전날 backlog 0')
  {
    await wipe()
    const ids = [await cand(), await cand(), await cand()]
    // d10 · 하루 목표 10 · 22:00 에는 도래 10 — 오늘 9건을 이미 냈다고 둔다(ActivityLog 를 그 날짜로)
    const u = await prisma.user.create({ data: { nickname: '기록' }, select: { id: true } })
    const pz = await prisma.persona.create({ data: { code: 'SZ', userId: u.id, status: 'active' }, select: { id: true } })
    for (let k = 0; k < 9; k += 1) {
      await prisma.personaActivityLog.create({ data: { personaId: pz.id, kind: 'post', targetId: `seed-${k}`, gateStatus: 'PASS', decidedBy: 'operator', createdAt: K('2026-10-08T12:00:00') } })
    }
    const r22 = await scheduled(ids[0]!, K('2026-10-08T22:00:00'), 'd10', envOf('d10'), 9)
    check('🔴 🔴 **22:00 정각 — 창 안 · 도래 10 · 발행 9 → 10번째 발행**', r22.kind === 'published', JSON.stringify(r22))
    const r2201 = await scheduled(ids[1]!, K('2026-10-08T22:01:00'), 'd10', envOf('d10'), 9)
    check('🔴 🔴 **22:01 — 운영 창 밖 → SLOT_CLOSED · 쓰기 0**', r2201.kind === 'blocked' && r2201.code === 'SLOT_CLOSED' && (await q(ids[1]!)).status === 'APPROVED', JSON.stringify(r2201))
    // 자정 뒤 — 전날 밀린 슬롯을 메우지 않는다(새 날짜의 첫 슬롯 전)
    await wipe()
    const late = await cand()
    const r0054 = await scheduled(late, K('2026-10-09T00:54:00'), 'd10', envOf('d10'), 0)
    check('🔴 🔴 **자정 뒤 00:54 — 전날 backlog 0 · SLOT_CLOSED**', r0054.kind === 'blocked' && r0054.code === 'SLOT_CLOSED', JSON.stringify(r0054))
    const r0810 = await scheduled(late, K('2026-10-09T08:10:00'), 'd10', envOf('d10'), 0)
    check('🔴 새 날 첫 슬롯(08:10)에서 다시 1건', r0810.kind === 'published', JSON.stringify(r0810))
  }

  console.log('\n⑤ 🔴 🔴 호출자가 d10 · 거대 상한을 주장해도 env 천장이 d1 이면 d1')
  {
    await wipe()
    const [a, b] = [await cand(), await cand()]
    const env = {} // 천장 d1
    const r0810 = await scheduled(a, K('2026-10-10T08:10:00'), 'd10', env)
    check('🔴 🔴 **08:10 — d10 이면 도래 1이지만 d1 은 아직 0 → SLOT_CLOSED**', r0810.kind === 'blocked' && r0810.code === 'SLOT_CLOSED' && /^d1 /.test(r0810.detail), JSON.stringify(r0810))
    const huge = await publishOriginalPostTx(prisma, {
      queueId: a, publishedToday: 0, mode: { kind: 'scheduled', releaseStage: 'd10', dailyCap: 1e9, planned: await planOf(a) } as never, autoReadyEnv: env,
    }, { now: () => K('2026-10-10T09:30:00') })
    // 🔴 두 번째도 거대 상한을 끼워 넣는다 — 호출자 숫자가 권위면 여기서 2건째가 나간다
    const second = await publishOriginalPostTx(prisma, {
      queueId: b, publishedToday: 0, mode: { kind: 'scheduled', releaseStage: 'd10', dailyCap: 1e9, planned: await planOf(b) } as never, autoReadyEnv: env,
    }, { now: () => K('2026-10-10T13:30:00') })
    check('🔴 🔴 **거대 dailyCap 을 끼워 넣어도 무시 — 09:30 1건 · 13:30 두 번째는 SLOT_CONSUMED (d1 하루 1)**',
      huge.kind === 'published' && second.kind === 'blocked' && second.code === 'SLOT_CONSUMED' && (await posts()) === 1, `${huge.kind}/${JSON.stringify(second)}`)
  }

  console.log('\n⑥ 🔴 manual-live 경로 동작 불변 — 슬롯 게이트 없음 · 주입 상한')
  {
    await wipe()
    const [a, b] = [await cand(), await cand()]
    const at = K('2026-10-11T03:00:00') // 🔴 운영 창 밖 · 도래 슬롯 0 — 예약이면 막혔을 시각
    const m1 = await publishOriginalPostTx(prisma, { queueId: a, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 1 } }, { now: () => at })
    const m2 = await publishOriginalPostTx(prisma, { queueId: b, publishedToday: 1, mode: { kind: 'manual-live', dailyCap: 1 } }, { now: () => at })
    check('🔴 🔴 **manual-live — 창 밖에서도 1건 발행(슬롯 게이트 미적용) · 두 번째는 기존 DAILY_CAP**',
      m1.kind === 'published' && m2.kind === 'blocked' && m2.code === 'DAILY_CAP', `${m1.kind}/${JSON.stringify(m2)}`)
  }

  console.log('\n⑧ 🔴 🔴 같은 후보 경합 — 09:30 d10 · 도래 2 · 두 러너가 같은 후보를 골랐다')
  {
    await wipe()
    const [a, b] = [await cand(), await cand()]
    const at = K('2026-10-13T09:30:00')
    // 🔴 두 러너가 같은 순간 같은 후보를 골랐다 — 둘 다 이 행을 미발행으로 본 스냅샷을 들고 있다
    const [plan1, plan2] = [await planOf(a), await planOf(a)]
    const r1 = await scheduled(a, at, 'd10', envOf('d10'), 0, plan1)
    const r2 = await scheduled(a, K('2026-10-13T09:31:00'), 'd10', envOf('d10'), 0, plan2) // 같은 바깥 스냅샷(발행 0)
    const qa = await q(a)
    check('🔴 🔴 **순차 — Post 정확히 1 · Queue·ActivityLog 중복 0**',
      r1.kind === 'published' && (await posts()) === 1 && (await logs()) === 1 && r1.kind === 'published' && qa.createdPostId === r1.postId, `${r1.kind}/${r2.kind}`)
    check('🔴 🔴 **패자 — TARGET_RACE_LOST (정상 무발행 · ALREADY_PUBLISHED 아님)**',
      r2.kind === 'blocked' && r2.code === 'TARGET_RACE_LOST', JSON.stringify(r2))
    const r3 = await scheduled(b, K('2026-10-13T09:40:00'), 'd10', envOf('d10'), 1)
    check('🔴 🔴 **남은 두 번째 슬롯 — 다음 heartbeat 가 다른 후보로 소비**', r3.kind === 'published' && (await posts()) === 2, JSON.stringify(r3))

    await wipe()
    const c = await cand()
    const [pc1, pc2] = [await planOf(c), await planOf(c)]
    const [c1, c2] = await Promise.all([scheduled(c, at, 'd10', envOf('d10'), 0, pc1), scheduled(c, at, 'd10', envOf('d10'), 0, pc2)])
    const loser = c1.kind === 'published' ? c2 : c1
    check('🔴 🔴 **동시 — Post 정확히 1 · 패자는 재시도 뒤 TARGET_RACE_LOST**',
      (await posts()) === 1 && (await logs()) === 1 && [c1, c2].filter((x) => x.kind === 'published').length === 1
      && loser.kind === 'blocked' && loser.code === 'TARGET_RACE_LOST', `${c1.kind}/${JSON.stringify(loser)}`)

    // 🔴 선택기 결함은 여전히 실패다 — 전날 발행된 행을 오늘 골랐다
    await wipe()
    const [old, other] = [await cand(), await cand()]
    const y = await scheduled(old, K('2026-10-13T09:30:00'), 'd10', envOf('d10'), 0) // 전날 발행
    const t1 = await scheduled(other, K('2026-10-14T08:10:00'), 'd10', envOf('d10'), 0) // 오늘 다른 글 1
    const bug = await scheduled(old, K('2026-10-14T09:30:00'), 'd10', envOf('d10'), 0) // 밖 0 · 안 1 · 대상은 어제 발행
    check('🔴 🔴 **전날 발행된 행을 고른 선택기 결함 → ALREADY_PUBLISHED(실패) · 정상 무발행으로 숨기지 않는다**',
      y.kind === 'published' && t1.kind === 'published' && bug.kind === 'blocked' && bug.code === 'ALREADY_PUBLISHED', JSON.stringify(bug))
    const bug2 = await scheduled(old, K('2026-10-14T09:31:00'), 'd10', envOf('d10'), 1) // 밖 1 · 안 1 — 계획 뒤 변화 없음
    check('🔴 계획 뒤 발행 수가 늘지 않았으면 경합이 아니다 → ALREADY_PUBLISHED', bug2.kind === 'blocked' && bug2.code === 'ALREADY_PUBLISHED', JSON.stringify(bug2))
    // 🔴 오늘 발행된 행 — 러너가 밖에서 이미 그 발행을 보고도(밖 1 · 안 1) 그 행을 골랐다 → 선택기 결함
    await wipe()
    const td = await cand()
    const t0 = await scheduled(td, K('2026-10-15T08:10:00'), 'd10', envOf('d10'), 0)
    const seen = await scheduled(td, K('2026-10-15T09:30:00'), 'd10', envOf('d10'), 1)
    check('🔴 🔴 **오늘 발행된 행이지만 계획 때 이미 그 발행을 봤다(밖 1 = 안 1) → ALREADY_PUBLISHED(실패)**',
      t0.kind === 'published' && seen.kind === 'blocked' && seen.code === 'ALREADY_PUBLISHED', JSON.stringify(seen))
  }

  console.log('\n⑨ 🔴 🔴 [마스터 반례] A 는 오늘 이미 발행 · 계획은 A 포함 1 · stale plan 이 A 를 다시 고름 · 계획 뒤 무관한 B 발행')
  {
    await wipe()
    const [A, B] = [await cand(), await cand()]
    const pa = await scheduled(A, K('2026-10-16T08:10:00'), 'd10', envOf('d10'), 0) // A 오늘 발행
    const planA = await planOf(A) // 🔴 계획 — A 는 이미 발행된 채로 스냅샷에 들어 있다
    const pb = await scheduled(B, K('2026-10-16T09:30:00'), 'd10', envOf('d10'), 1) // 계획 뒤 무관한 B 발행 → 안 2
    const stale = await scheduled(A, K('2026-10-16T10:50:00'), 'd10', envOf('d10'), 1, planA) // 도래 3 · 안 2 · 밖 1
    check('🔴 🔴 **A 는 계획 뒤 발행된 것이 아니다 → ALREADY_PUBLISHED(실패) · TARGET_RACE_LOST 아님**',
      pa.kind === 'published' && pb.kind === 'published' && stale.kind === 'blocked' && stale.code === 'ALREADY_PUBLISHED', JSON.stringify(stale))
    // 🔴 스냅샷이 다른 행을 가리키면 경합이 아니다
    await wipe()
    const [X, Y] = [await cand(), await cand()]
    const planY = await planOf(Y)
    await scheduled(X, K('2026-10-17T08:10:00'), 'd10', envOf('d10'), 0)
    const wrong = await scheduled(X, K('2026-10-17T09:30:00'), 'd10', envOf('d10'), 0, planY)
    check('🔴 계획 스냅샷의 queueId 가 이 행이 아니면 경합이 아니다 → ALREADY_PUBLISHED', wrong.kind === 'blocked' && wrong.code === 'ALREADY_PUBLISHED', JSON.stringify(wrong))
    // 🔴 스냅샷이 "미발행" 이라 주장하지만 그 시각이 발행 뒤다 — 대상 자신의 전환이 계획 뒤가 아니다
    await wipe()
    const [F, G] = [await cand(), await cand()]
    await scheduled(F, K('2026-10-18T08:10:00'), 'd10', envOf('d10'), 0)
    await scheduled(G, K('2026-10-18T09:30:00'), 'd10', envOf('d10'), 1)
    const after = await planOf(F)
    const forged: PlannedTarget = { ...after, status: 'APPROVED', createdPostId: null }
    const fr = await scheduled(F, K('2026-10-18T10:50:00'), 'd10', envOf('d10'), 1, forged)
    check('🔴 🔴 **미발행이라 주장하는 스냅샷의 updatedAt 이 발행 뒤 → 경합 아님 · ALREADY_PUBLISHED**', fr.kind === 'blocked' && fr.code === 'ALREADY_PUBLISHED', JSON.stringify(fr))
  }

  console.log('\n⑦ 🔴 정상 발행 — Post · Queue · ActivityLog 원자적 정합')
  {
    await wipe()
    const a = await cand()
    const at = K('2026-10-12T08:10:00')
    const r = await scheduled(a, at, 'd10', envOf('d10'))
    const qa = await q(a)
    const log = await prisma.personaActivityLog.findFirst({ where: { kind: 'post' } })
    check('🔴 🔴 **Post 1 · Queue PUBLISHED(createdPostId=Post) · ActivityLog 1(createdAt=txNow)**',
      r.kind === 'published' && (await posts()) === 1 && qa.status === 'PUBLISHED' && qa.createdPostId === r.postId
      && (await logs()) === 1 && log?.targetId === r.postId && log.createdAt.getTime() === at.getTime(), JSON.stringify(r))
  }

  await wipe()
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 에서만 돌았다 — 운영 DB write 0 · 모델 호출 0\n')
  if (fail > 0) process.exit(1)
}

await main()

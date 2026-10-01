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
 *   ⑩ (2026-09-30 · source-slot-v1) 트랜잭션 시계 재판정 — 원천 가치가 사라진 행은 EXPIRED(사유 + 도장) · Post 0 ·
 *      같은 슬롯을 다음 후보가 채운다 · 두 번 불러도 한 번만 · 동시 두 러너도 전환 한 번 · 정상 발행에는 eligible 도장
 *
 *   ⑫ (2026-10-01) 두 번 연속 직렬화 충돌 — 결함 주입(`deps.fault`)으로 결정론 재현. 다시 읽어 소비 증거(SLOT_CONSUMED ·
 *      TARGET_RACE_LOST)일 때만 정상 무발행 · 증거 없음 · 선택기 결함 · 비직렬화 오류 · 커밋 전 실패는 error · 부분 write 0
 *
 *   ⑪ (2026-09-30 Lane B) 원천 기회 → 공개 글 **결정론적 전체 E2E** — `source-evidence-e2e-db-check.mts` 를 같은 격리 DB 로
 *      실행한다(목록 artifact → 증거 → JIT 생성(가짜 provider) → READY → 발행 직전 재검사 → 만료 → 교체 → 공개 글 · 도장).
 *
 *   npm run publish:slot-db-check
 */
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { Prisma, PrismaClient } from '@prisma/client'

import { publishOriginalPostTx, type PlannedTarget, type PublishResult } from '../src/lib/original-post-publish-tx'
import { NORMAL_NO_PUBLISH_CODES } from '../src/lib/original-post-publish'
import { publishEventAtOf, releaseStampStatusOf, RELEASE_STAMP_KEY, RELEASE_CONTRACT } from '../src/lib/source-slot-release'
import { fakeEvidenceGate } from './lib/fake-source-evidence.mjs'
import { markedStageEnv } from './lib/stage-decision-fixture'

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
const envOf = (stage: string): Record<string, string> => markedStageEnv({ SORAN_RELEASE_STAGE: stage, SORAN_CAPACITY_STAGE: stage })

let seq = 0
/**
 * 🔴 원문 증거 기준 시각 — 그 절의 KST 자정. 게시는 6시간 앞(전날 18시)이라 그날 · 다음 날 아침까지 72h 안이다.
 *    `evidence: 'old'` 는 기준보다 80시간 앞 게시(슬롯에서 72h 초과) · `'none'` 은 증거 칸 없음.
 */
let evidenceAt = K('2026-10-01T00:00:00')
async function wipe(): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue","MicroSeedRawContent","Post","Persona","User" CASCADE')
}
/** 발행 가능한 사람 결정 후보 한 건 — Persona 도 각자 */
async function cand(evidence: 'fresh' | 'old' | 'none' = 'fresh'): Promise<string> {
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
      gateVerdict: 'PASS', gateResults: {
        holds: [], blocks: [],
        ...(evidence === 'none' ? {} : fakeEvidenceGate(evidenceAt, { id: `slot-${seq}`, ...(evidence === 'old' ? { ageH: 80 } : {}) })),
      } as never, promptVersion: 'p', model: 'm', decidedBy: 'founder',
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
    queueId: id, publishedToday: outsideSeen, mode: { kind: 'scheduled', releaseStage: stage, planned: plan ?? await planOf(id), unattended: false }, autoReadyEnv: env,
  }, { now: () => at })
const posts = () => prisma.post.count()
const logs = () => prisma.personaActivityLog.count({ where: { kind: 'post' } })
const q = (id: string) => prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id }, select: { status: true, createdPostId: true } })

async function main(): Promise<void> {
  console.log('\n══ 예약 발행 슬롯 — 트랜잭션 권한 (격리 DB 전용 · 운영 DB 0) ══\n')

  console.log('① 🔴 🔴 08:10 d10 · 도래 1 · 두 러너가 밖에서 발행 0 을 봤다 — 순차')
  {
    await wipe()
    evidenceAt = K('2026-10-01T00:00:00')
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
    evidenceAt = K('2026-10-01T00:00:00')
    const [a, b] = [await cand(), await cand()]
    const at = K('2026-10-01T08:10:00')
    const [r1, r2] = await Promise.all([scheduled(a, at, 'd10', envOf('d10')), scheduled(b, at, 'd10', envOf('d10'))])
    const loser = r1.kind === 'published' ? r2 : r1
    check('🔴 🔴 **서로 다른 후보 동시 — Post 정확히 1 · ActivityLog 1**', (await posts()) === 1 && (await logs()) === 1, `${r1.kind}/${r2.kind}`)
    check('🔴 🔴 **패자는 충돌 뒤 한 번 재시도 → 슬롯을 다시 세어 SLOT_CONSUMED (오류 아님)**',
      loser.kind === 'blocked' && loser.code === 'SLOT_CONSUMED', JSON.stringify(loser))
    await wipe()
    evidenceAt = K('2026-10-01T00:00:00')
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
      evidenceAt = K(`${date}T00:00:00`)
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
    evidenceAt = K('2026-10-08T00:00:00')
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
    evidenceAt = K('2026-10-09T00:00:00')
    const late = await cand()
    const r0054 = await scheduled(late, K('2026-10-09T00:54:00'), 'd10', envOf('d10'), 0)
    check('🔴 🔴 **자정 뒤 00:54 — 전날 backlog 0 · SLOT_CLOSED**', r0054.kind === 'blocked' && r0054.code === 'SLOT_CLOSED', JSON.stringify(r0054))
    const r0810 = await scheduled(late, K('2026-10-09T08:10:00'), 'd10', envOf('d10'), 0)
    check('🔴 새 날 첫 슬롯(08:10)에서 다시 1건', r0810.kind === 'published', JSON.stringify(r0810))
  }

  console.log('\n⑤ 🔴 🔴 호출자가 d10 · 거대 상한을 주장해도 env 천장이 d1 이면 d1')
  {
    await wipe()
    evidenceAt = K('2026-10-10T00:00:00')
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
    evidenceAt = K('2026-10-11T00:00:00')
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
    evidenceAt = K('2026-10-13T00:00:00')
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
    evidenceAt = K('2026-10-13T00:00:00')
    const c = await cand()
    const [pc1, pc2] = [await planOf(c), await planOf(c)]
    const [c1, c2] = await Promise.all([scheduled(c, at, 'd10', envOf('d10'), 0, pc1), scheduled(c, at, 'd10', envOf('d10'), 0, pc2)])
    const loser = c1.kind === 'published' ? c2 : c1
    check('🔴 🔴 **동시 — Post 정확히 1 · 패자는 재시도 뒤 TARGET_RACE_LOST**',
      (await posts()) === 1 && (await logs()) === 1 && [c1, c2].filter((x) => x.kind === 'published').length === 1
      && loser.kind === 'blocked' && loser.code === 'TARGET_RACE_LOST', `${c1.kind}/${JSON.stringify(loser)}`)

    // 🔴 선택기 결함은 여전히 실패다 — 전날 발행된 행을 오늘 골랐다
    await wipe()
    evidenceAt = K('2026-10-13T00:00:00')
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
    evidenceAt = K('2026-10-15T00:00:00')
    const td = await cand()
    const t0 = await scheduled(td, K('2026-10-15T08:10:00'), 'd10', envOf('d10'), 0)
    const seen = await scheduled(td, K('2026-10-15T09:30:00'), 'd10', envOf('d10'), 1)
    check('🔴 🔴 **오늘 발행된 행이지만 계획 때 이미 그 발행을 봤다(밖 1 = 안 1) → ALREADY_PUBLISHED(실패)**',
      t0.kind === 'published' && seen.kind === 'blocked' && seen.code === 'ALREADY_PUBLISHED', JSON.stringify(seen))
  }

  console.log('\n⑨ 🔴 🔴 [마스터 반례] A 는 오늘 이미 발행 · 계획은 A 포함 1 · stale plan 이 A 를 다시 고름 · 계획 뒤 무관한 B 발행')
  {
    await wipe()
    evidenceAt = K('2026-10-16T00:00:00')
    const [A, B] = [await cand(), await cand()]
    const pa = await scheduled(A, K('2026-10-16T08:10:00'), 'd10', envOf('d10'), 0) // A 오늘 발행
    const planA = await planOf(A) // 🔴 계획 — A 는 이미 발행된 채로 스냅샷에 들어 있다
    const pb = await scheduled(B, K('2026-10-16T09:30:00'), 'd10', envOf('d10'), 1) // 계획 뒤 무관한 B 발행 → 안 2
    const stale = await scheduled(A, K('2026-10-16T10:50:00'), 'd10', envOf('d10'), 1, planA) // 도래 3 · 안 2 · 밖 1
    check('🔴 🔴 **A 는 계획 뒤 발행된 것이 아니다 → ALREADY_PUBLISHED(실패) · TARGET_RACE_LOST 아님**',
      pa.kind === 'published' && pb.kind === 'published' && stale.kind === 'blocked' && stale.code === 'ALREADY_PUBLISHED', JSON.stringify(stale))
    // 🔴 스냅샷이 다른 행을 가리키면 경합이 아니다
    await wipe()
    evidenceAt = K('2026-10-17T00:00:00')
    const [X, Y] = [await cand(), await cand()]
    const planY = await planOf(Y)
    await scheduled(X, K('2026-10-17T08:10:00'), 'd10', envOf('d10'), 0)
    const wrong = await scheduled(X, K('2026-10-17T09:30:00'), 'd10', envOf('d10'), 0, planY)
    check('🔴 계획 스냅샷의 queueId 가 이 행이 아니면 경합이 아니다 → ALREADY_PUBLISHED', wrong.kind === 'blocked' && wrong.code === 'ALREADY_PUBLISHED', JSON.stringify(wrong))
    // 🔴 스냅샷이 "미발행" 이라 주장하지만 그 시각이 발행 뒤다 — 대상 자신의 전환이 계획 뒤가 아니다
    await wipe()
    evidenceAt = K('2026-10-18T00:00:00')
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
    evidenceAt = K('2026-10-12T00:00:00')
    const a = await cand()
    const at = K('2026-10-12T08:10:00')
    const r = await scheduled(a, at, 'd10', envOf('d10'))
    const qa = await q(a)
    const log = await prisma.personaActivityLog.findFirst({ where: { kind: 'post' } })
    check('🔴 🔴 **Post 1 · Queue PUBLISHED(createdPostId=Post) · ActivityLog 1(createdAt=txNow)**',
      r.kind === 'published' && (await posts()) === 1 && qa.status === 'PUBLISHED' && qa.createdPostId === r.postId
      && (await logs()) === 1 && log?.targetId === r.postId && log.createdAt.getTime() === at.getTime(), JSON.stringify(r))
  }


  console.log('\n⑩ 🔴 🔴 트랜잭션 시계 재판정 — 원천 가치가 사라진 행은 EXPIRED · 슬롯은 다음 후보가 채운다 (source-slot-v1)')
  {
    await wipe()
    evidenceAt = K('2026-10-20T00:00:00')
    const [old, none, fresh] = [await cand('old'), await cand('none'), await cand('fresh')]
    const at = K('2026-10-20T08:10:00')
    const rOld = await scheduled(old, at, 'd10', envOf('d10'))
    const qOld = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: old }, select: { status: true, createdPostId: true, declineReason: true, gateResults: true, matchedPersonaId: true, matchedAt: true } })
    const stamp = (qOld.gateResults as Record<string, unknown>)[RELEASE_STAMP_KEY] as Record<string, unknown> | undefined
    check('🔴 🔴 **게시 80h 원문 → expired(SOURCE_TOO_OLD_AT_SLOT) · Queue EXPIRED · 사유 코드 · 도장(ineligible)**',
      rOld.kind === 'expired' && rOld.reasons.includes('SOURCE_TOO_OLD_AT_SLOT') && qOld.status === 'EXPIRED'
      && qOld.createdPostId === null && (qOld.declineReason ?? '').startsWith('RELEASE_EXPIRED:SOURCE_TOO_OLD_AT_SLOT')
      && stamp?.contract === RELEASE_CONTRACT && stamp?.verdict === 'ineligible', `${JSON.stringify(rOld)} ${qOld.status} ${qOld.declineReason}`)
    check('🔴 🔴 **만료는 배정을 풀어 준다 — 나가지 않은 행이 Persona 주간 사용량 · 최소 간격을 먹지 않는다**',
      qOld.matchedPersonaId === null && qOld.matchedAt === null)
    check('🔴 🔴 **만료는 Post 0 · ActivityLog 0 · 원래 증거는 그대로 남는다**',
      (await posts()) === 0 && (await logs()) === 0 && (qOld.gateResults as Record<string, unknown>).sourceEvidence !== undefined)
    const rNone = await scheduled(none, K('2026-10-20T08:11:00'), 'd10', envOf('d10'))
    check('🔴 증거가 없는 행 → expired(EVIDENCE_MISSING) — 모름은 eligible 이 아니다',
      rNone.kind === 'expired' && rNone.reasons.includes('EVIDENCE_MISSING') && (await q(none)).status === 'EXPIRED', JSON.stringify(rNone))
    const rFresh = await scheduled(fresh, K('2026-10-20T08:12:00'), 'd10', envOf('d10'))
    const qFresh = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: fresh }, select: { status: true, createdPostId: true, gateResults: true } })
    check('🔴 🔴 **같은 슬롯(08:10 도래 1)을 다음 후보가 채운다 — 만료는 슬롯을 소비하지 않았다**',
      rFresh.kind === 'published' && (await posts()) === 1 && (await logs()) === 1 && qFresh.status === 'PUBLISHED' && qFresh.createdPostId === rFresh.postId,
      JSON.stringify(rFresh))
    const freshLogs = qFresh.createdPostId === null ? [] : await prisma.personaActivityLog.findMany({
      where: { kind: 'post', targetId: qFresh.createdPostId }, select: { publishedAt: true, createdAt: true } })
    check('🔴 🔴 **정상 발행 행에 지금 계약 eligible 도장이 남는다 — 도장 시각 = 발행 기록 시각(같은 사건) (증거 조항 ⑦ 입력)**',
      releaseStampStatusOf(qFresh.gateResults, publishEventAtOf(freshLogs)) === 'STAMPED_ELIGIBLE'
      && publishEventAtOf(freshLogs)?.toISOString() === K('2026-10-20T08:12:00').toISOString())
    // 멱등 — 이미 만료된 행을 다시 불러도 두 번째 전환 · 쓰기가 없다
    const before = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: old }, select: { updatedAt: true } })
    const again = await scheduled(old, K('2026-10-20T09:30:00'), 'd10', envOf('d10'), 1)
    const after = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: old }, select: { status: true, updatedAt: true } })
    check('🔴 🔴 **이미 만료된 행을 다시 불러도 쓰기 0 — blocked · EXPIRED 그대로 · updatedAt 불변**',
      again.kind === 'blocked' && after.status === 'EXPIRED' && after.updatedAt.getTime() === before.updatedAt.getTime() && (await posts()) === 1,
      JSON.stringify(again))

    // 경합 — 같은 만료 대상을 두 러너가 동시에 — 전환은 한 번 · Post 0
    await wipe()
    evidenceAt = K('2026-10-21T00:00:00')
    const race = await cand('old')
    const [p1, p2] = [await planOf(race), await planOf(race)]
    const rat = K('2026-10-21T08:10:00')
    const [x1, x2] = await Promise.all([scheduled(race, rat, 'd10', envOf('d10'), 0, p1), scheduled(race, rat, 'd10', envOf('d10'), 0, p2)])
    const kinds = [x1, x2].map((r) => (r.kind === 'blocked' ? r.code : r.kind))
    check('🔴 🔴 **동시 두 러너 — 만료 전환 정확히 한 번 · 다른 쪽은 쓰기 없이 blocked · Post 0**',
      kinds.filter((k) => k === 'expired').length === 1 && [x1, x2].some((r) => r.kind === 'blocked')
      && (await q(race)).status === 'EXPIRED' && (await posts()) === 0 && (await logs()) === 0, kinds.join(','))

    // 🔴 만료가 오늘 발행 수에 들어가지 않는다 — 같은 날 슬롯 계산이 그대로다
    await wipe()
    evidenceAt = K('2026-10-22T00:00:00')
    const [o2, f2, f3] = [await cand('old'), await cand('fresh'), await cand('fresh')]
    const e1 = await scheduled(o2, K('2026-10-22T08:10:00'), 'd10', envOf('d10'))
    const e2 = await scheduled(f2, K('2026-10-22T08:10:30'), 'd10', envOf('d10'))
    const e3 = await scheduled(f3, K('2026-10-22T08:11:00'), 'd10', envOf('d10'), 1)
    check('🔴 만료 뒤 발행 1 → 같은 슬롯에서 세 번째는 SLOT_CONSUMED (만료가 발행으로 세이지 않고, 발행은 한 번만)',
      e1.kind === 'expired' && e2.kind === 'published' && e3.kind === 'blocked' && e3.code === 'SLOT_CONSUMED' && (await posts()) === 1,
      `${e1.kind}/${e2.kind}/${JSON.stringify(e3)}`)
  }

  console.log('\n⑫ 🔴 🔴 두 번 연속 직렬화 충돌 — 다시 읽어 소비 증거가 있을 때만 정상 무발행 (2026-10-01 · PR #647 CI ⑧)')
  {
    /**
     * 🔴 결정론 반례 — 패자의 write 시도 1 · 2 에 P2034 를 넣는다(`deps.fault` · 검사 전용 주입점).
     *    시도 1 의 트랜잭션 안(첫 읽기 전 · 잠금 0)에서 승자가 **실제로** 같은 후보를 발행하고 커밋한다.
     *    앞판: 두 번째 충돌 = 무조건 error → 러너 exit 1(CI 실패 그대로). 지금: 새 스냅샷으로 다시 읽어 소비 증거면 정상 무발행.
     */
    const p2034 = (): Error => new Prisma.PrismaClientKnownRequestError(
      'Transaction failed due to a write conflict or a deadlock. Please retry your transaction', { code: 'P2034', clientVersion: 'fixture' })
    type FaultAt = { attempt: 1 | 2; point: 'begin' | 'written' }
    const withFault = async (id: string, at: Date, stage: string, outsideSeen: number, plan: PlannedTarget, fault: (f: FaultAt) => Promise<void>): Promise<PublishResult> =>
      publishOriginalPostTx(prisma, {
        queueId: id, publishedToday: outsideSeen, mode: { kind: 'scheduled', releaseStage: stage, planned: plan, unattended: true }, autoReadyEnv: envOf(stage),
      }, { now: () => at, fault })
    const normal = (r: PublishResult): boolean => r.kind === 'blocked' && (NORMAL_NO_PUBLISH_CODES as readonly string[]).includes(r.code)

    // (a) 같은 후보 · 도래 1(d10 08:10) — 승자가 시도 1 도중 발행 → 패자 두 번 충돌 → SLOT_CONSUMED
    for (const [label, at, code] of [
      ['도래 1(08:10) → SLOT_CONSUMED', K('2026-10-23T08:10:00'), 'SLOT_CONSUMED'],
      ['도래 2(09:30) → TARGET_RACE_LOST', K('2026-10-23T09:30:00'), 'TARGET_RACE_LOST'],
    ] as const) {
      await wipe()
      evidenceAt = K('2026-10-23T00:00:00')
      const a = await cand()
      const [planW, planL] = [await planOf(a), await planOf(a)]
      let winner: PublishResult | null = null
      const calls: string[] = []
      const loser = await withFault(a, at, 'd10', 0, planL, async (f) => {
        calls.push(`${f.attempt}:${f.point}`)
        if (f.point !== 'begin') return
        if (f.attempt === 1) winner = await scheduled(a, at, 'd10', envOf('d10'), 0, planW)
        throw p2034()
      })
      const w = winner as PublishResult | null
      const qa = await q(a)
      check(`🔴 🔴 **[반례] 두 번 연속 P2034 · 승자 실제 발행 — ${label} · 정상 무발행(러너 exit 0 코드) · Post 1 · ActivityLog 1 · Queue = 승자 글**`,
        w?.kind === 'published' && loser.kind === 'blocked' && loser.code === code && normal(loser)
        && (await posts()) === 1 && (await logs()) === 1 && qa.status === 'PUBLISHED' && qa.createdPostId === (w?.kind === 'published' ? w.postId : '?'),
        `${JSON.stringify(w)} / ${JSON.stringify(loser)}`)
      check('🔴 write 시도는 정확히 2 — 다시 읽기는 세 번째 write 시도가 아니다(주입점 호출 1:begin · 2:begin 뿐)',
        calls.join(',') === '1:begin,2:begin', calls.join(','))
    }

    // (b) 두 번 연속 충돌 · 아무도 발행하지 않았다 → 소비 증거 없음 → error · write 0
    await wipe()
    evidenceAt = K('2026-10-23T00:00:00')
    const b = await cand()
    const rb = await withFault(b, K('2026-10-23T08:10:00'), 'd10', 0, await planOf(b), async (f) => { if (f.point === 'begin') throw p2034() })
    check('🔴 🔴 **[반례] 두 번 연속 충돌 · 소비 증거 없음(다시 읽으니 낼 수 있다) → error · Post 0 · ActivityLog 0 · Queue 그대로**',
      rb.kind === 'error' && /소비 증거가 없다/.test(rb.message) && (await posts()) === 0 && (await logs()) === 0 && (await q(b)).status === 'APPROVED', JSON.stringify(rb))

    // (c) 도래 2 · 승자는 **다른** 후보를 냈다 — 슬롯도 이 후보도 소비되지 않았다 → error
    await wipe()
    evidenceAt = K('2026-10-23T00:00:00')
    const [c1, c2] = [await cand(), await cand()]
    const at2 = K('2026-10-23T09:30:00')
    const rc = await withFault(c1, at2, 'd10', 0, await planOf(c1), async (f) => {
      if (f.point !== 'begin') return
      if (f.attempt === 1) await scheduled(c2, at2, 'd10', envOf('d10'), 0)
      throw p2034()
    })
    check('🔴 🔴 **[반례] 다른 후보 발행 · 도래 2 중 1 소비 → 이 회차의 소비 증거 아님 → error (정상 무발행으로 숨기지 않는다)**',
      rc.kind === 'error' && (await posts()) === 1 && (await q(c1)).status === 'APPROVED', JSON.stringify(rc))

    // (d) 선택기 결함 — 전날 발행된 행을 오늘 골랐다 + 두 번 연속 충돌 → ALREADY_PUBLISHED 를 정상으로 바꾸지 않는다
    await wipe()
    evidenceAt = K('2026-10-23T00:00:00')
    const [old, other] = [await cand(), await cand()]
    const y = await scheduled(old, K('2026-10-23T09:30:00'), 'd10', envOf('d10'), 0)
    const t1 = await scheduled(other, K('2026-10-24T08:10:00'), 'd10', envOf('d10'), 0)
    const rd = await withFault(old, K('2026-10-24T09:30:00'), 'd10', 0, await planOf(old), async (f) => { if (f.point === 'begin') throw p2034() })
    check('🔴 🔴 **[반례] 선택기 결함(전날 발행 행) + 두 번 연속 충돌 → error(ALREADY_PUBLISHED) · 정상 무발행 아님**',
      y.kind === 'published' && t1.kind === 'published' && rd.kind === 'error' && /ALREADY_PUBLISHED/.test(rd.message) && (await posts()) === 2, JSON.stringify(rd))

    // (e) 직렬화가 아닌 DB 오류 — 재시도도 다시 읽기도 없이 error
    await wipe()
    evidenceAt = K('2026-10-23T00:00:00')
    const e = await cand()
    const ecalls: string[] = []
    const re = await withFault(e, K('2026-10-23T08:10:00'), 'd10', 0, await planOf(e), async (f) => {
      ecalls.push(`${f.attempt}:${f.point}`)
      if (f.point === 'begin') throw new Prisma.PrismaClientKnownRequestError('connection reset', { code: 'P1017', clientVersion: 'fixture' })
    })
    check('🔴 🔴 **[반례] P2034 아닌 DB 오류 → error · 재시도 0 · Post 0**',
      re.kind === 'error' && ecalls.join(',') === '1:begin' && (await posts()) === 0 && (await logs()) === 0, `${JSON.stringify(re)} ${ecalls.join(',')}`)

    // (f) 부분 write — 세 write 뒤 커밋 전 실패: 충돌 2회든 일반 오류든 Post · Queue · ActivityLog 전부 되돌아간다
    for (const kind of ['P2034', 'other'] as const) {
      await wipe()
      evidenceAt = K('2026-10-23T00:00:00')
      const f0 = await cand()
      const rf = await withFault(f0, K('2026-10-23T08:10:00'), 'd10', 0, await planOf(f0), async (f) => {
        if (f.point === 'written') throw kind === 'P2034' ? p2034() : new Error('boom')
      })
      const qf = await q(f0)
      check(`🔴 🔴 **[반례] 세 write 뒤 커밋 전 실패(${kind}) → error · Post 0 · ActivityLog 0 · Queue APPROVED(부분 write 없음)**`,
        rf.kind === 'error' && (await posts()) === 0 && (await logs()) === 0 && qf.status === 'APPROVED' && qf.createdPostId === null, JSON.stringify(rf))
    }
  }

  await wipe()
  await prisma.$disconnect()

  console.log('\n⑪ 🔴 🔴 원천 기회 → 공개 글 결정론적 전체 E2E — 검사 파일을 같은 격리 DB 로 실행한다')
  {
    // 🔴 같은 격리 가드를 그 파일도 다시 본다(sentinel · localhost · soran_test) · 부모 env 의 격리 주소 그대로
    const r = spawnSync(join(process.cwd(), 'node_modules/.bin/tsx'), [join(process.cwd(), 'scripts/source-evidence-e2e-db-check.mts')],
      { encoding: 'utf-8', timeout: 1_800_000, env: process.env })
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
    const tail = out.trim().split('\n').filter((l) => /pass ·/.test(l)).pop() ?? '(요약 없음)'
    check(`🔴 🔴 **source-evidence-e2e-db-check 통과** — ${tail.trim()}`, r.status === 0)
    if (r.status !== 0) console.log(out.split('\n').filter((l) => /❌|Error|중단/.test(l)).slice(0, 20).map((l) => `    ${l}`).join('\n'))
  }

  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 에서만 돌았다 — 운영 DB write 0 · 모델 호출 0\n')
  if (fail > 0) process.exit(1)
}

await main()

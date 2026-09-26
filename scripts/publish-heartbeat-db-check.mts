#!/usr/bin/env tsx
/**
 * 🔴 **발행 heartbeat — 트랜잭션 권한 실행 검사 (격리 Postgres 전용)** (2026-09-26)
 *
 *   heartbeat 는 **깨우기만** 한다. 이 검사는 그 말이 사실인지를 실제 소비 경로
 *   (`publishOriginalPostTx` · scheduled)로 본다 — 시계만 고정하고 판정 함수를 복제하지 않는다.
 *
 *     ① 10분마다 깨우는 하루(00:00~23:50 · 144틱) — 첫 슬롯 전 0 · 누적 ≤ 도래 수 · 천장까지 · 지연 0
 *     ② 절전 뒤 wake — 같은 날짜 · 운영 창 안에서만 한 틱 1건씩 메운다 · 다음 날로 넘기지 않는다
 *     ③ 기간 변수가 없는 로컬 env — 러너가 더 높은 단계를 넘겨도 로컬 천장(d1 · 하루 1)을 넘지 않는다
 *     ④ 로컬 heartbeat + GitHub 예약(실측 지연 110~408분) — 순차 · 동시 · 같은 후보 · 틱 잠금 없이도 중복 0
 *     ⑤ 러너 프로세스 자체 — 같은 틱 두 wake 동시 → 하나만 선택 단계로 · 창 밖/트리거 오용 처리
 *
 * 🔴 운영 DB 에 절대 붙이지 않는다(sentinel · localhost · soran_test). 모델 호출 0 · launchctl 0.
 *
 *   npm run publish:heartbeat-db-check
 */
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import { publishOriginalPostTx, type PlannedTarget, type PublishResult } from '../src/lib/original-post-publish-tx'
import { catchUpDailyCeiling, dueCountAt, kstMinuteOfDay } from '../src/lib/publish-slot-catchup'
import { PROFILES, RELEASE_STAGES, minuteOfDay } from '../src/lib/scale-profile'
import { heartbeatWakeTimes, PUBLISH_HEARTBEAT_ARGS } from './lib/original-post-runner-template'
import { heartbeatInWindow, heartbeatTickKey } from './lib/publish-heartbeat-tick.mjs'

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
const K = (s: string): Date => new Date(`${s}+09:00`)
const at = (day: string, m: number): Date =>
  K(`${day}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`)
const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const envOf = (stage: string): Record<string, string> => ({ SORAN_RELEASE_STAGE: stage, SORAN_CAPACITY_STAGE: stage })
/** 🔴 운영 로컬 정본과 같은 모양 — 기간 변수 없음 */
const LOCAL_ENV = { SORAN_CAPACITY_STAGE: 'd5', SORAN_RELEASE_STAGE: 'd1' }
/** 🔴 GitHub Variables 와 같은 모양 — 기간 d3 (2026-09-23~29) */
const GITHUB_ENV = {
  ...LOCAL_ENV, SORAN_RELEASE_WINDOW_STAGE: 'd3', SORAN_RELEASE_WINDOW_FROM: '2026-09-23', SORAN_RELEASE_WINDOW_UNTIL: '2026-09-29',
}

let seq = 0
async function wipe(): Promise<void> {
  await prisma.$executeRawUnsafe('TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue","MicroSeedRawContent","Post","Persona","User" CASCADE')
}
/** 발행 가능한 사람 결정 후보 — `publish-slot-db-check` 와 같은 모양(Persona 각자) */
async function cand(): Promise<string> {
  seq += 1
  const u = await prisma.user.create({ data: { nickname: `박동${seq}` }, select: { id: true } })
  const p = await prisma.persona.create({ data: { code: `H${String(seq).padStart(4, '0')}`, userId: u.id, status: 'active' }, select: { id: true } })
  const raw = await prisma.microSeedRawContent.create({
    data: { origin: 'live', sourceSite: 'sheet:x', sourceUrl: `https://example.invalid/h${seq}`, sourceArticleId: `H${seq}`, sourceCapturedAt: new Date(), rawTitle: 't', rawBody: 'b' },
    select: { id: true },
  })
  const q = await prisma.originalPostApprovalQueue.create({
    data: {
      sourceRawContentId: raw.id, status: 'APPROVED', draftTitle: `평범한 하루 ${seq}`, draftBody: `아침에 산책을 다녀왔어요 ${seq}. 다들 어떻게 지내세요?`,
      gateVerdict: 'PASS', gateResults: { holds: [], blocks: [] } as never, promptVersion: 'p', model: 'm', decidedBy: 'founder',
      dedupKey: `hb-${seq}`, matchedPersonaId: p.id, matchedAt: new Date(),
    },
    select: { id: true },
  })
  return q.id
}
const planOf = async (id: string): Promise<PlannedTarget> => {
  const r = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id }, select: { id: true, status: true, createdPostId: true, updatedAt: true, decidedBy: true } })
  return { queueId: r.id, status: r.status, createdPostId: r.createdPostId, updatedAt: r.updatedAt, decidedBy: r.decidedBy }
}
const countToday = (d: Date): Promise<number> => {
  const start = new Date(Math.floor((d.getTime() + 9 * 3600e3) / 864e5) * 864e5 - 9 * 3600e3)
  return prisma.personaActivityLog.count({ where: { kind: 'post', createdAt: { gte: start, lt: new Date(start.getTime() + 864e5) } } })
}
/**
 * 🔴 **러너 한 회차와 같은 순서** — 밖에서 오늘 발행 수를 세고, 줄 맨 앞의 미발행 후보를 고르고,
 *    그 스냅샷을 트랜잭션에 넘긴다. 단계 이름과 env 는 그 트리거의 것이다.
 */
async function wake(now: Date, stage: string, env: Record<string, string>): Promise<{ r: PublishResult; id: string } | null> {
  const outside = await countToday(now)
  const row = await prisma.originalPostApprovalQueue.findFirst({
    where: { status: 'APPROVED', createdPostId: null }, orderBy: { dedupKey: 'asc' }, select: { id: true },
  })
  if (row === null) return null
  const plan = await planOf(row.id)
  const r = await publishOriginalPostTx(prisma, {
    queueId: row.id, publishedToday: outside, mode: { kind: 'scheduled', releaseStage: stage, planned: plan }, autoReadyEnv: env,
  }, { now: () => now })
  return { r, id: row.id }
}
/** 🔴 중복 0 — Post · ActivityLog · Queue 의 createdPostId 가 1:1:1 이고 후보 하나가 두 번 나가지 않았다 */
async function dupFree(): Promise<{ ok: boolean; detail: string }> {
  const posts = await prisma.post.count()
  const logs = await prisma.personaActivityLog.count({ where: { kind: 'post' } })
  const qs = await prisma.originalPostApprovalQueue.findMany({ where: { createdPostId: { not: null } }, select: { createdPostId: true } })
  const distinct = new Set(qs.map((q) => q.createdPostId)).size
  const targets = await prisma.personaActivityLog.findMany({ where: { kind: 'post' }, select: { targetId: true } })
  const distinctTargets = new Set(targets.map((t) => t.targetId)).size
  const ok = posts === logs && logs === qs.length && qs.length === distinct && distinct === distinctTargets
  return { ok, detail: `Post ${posts} · ActivityLog ${logs} · Queue 발행 ${qs.length}(고유 ${distinct}) · 로그 대상 고유 ${distinctTargets}` }
}
const TICKS_ALL_DAY = Array.from({ length: 144 }, (_, i) => i * 10)

async function main(): Promise<void> {
  console.log('\n══ 발행 heartbeat — 트랜잭션 권한 (격리 DB 전용 · 운영 DB 0) ══\n')

  console.log('① 🔴 🔴 10분마다 깨우는 하루 (00:00~23:50 · 144틱 · 창 밖 틱도 트랜잭션에 물어본다)')
  let day = 0
  for (const stage of RELEASE_STAGES) {
    await wipe()
    day += 1
    const date = `2026-10-${String(day).padStart(2, '0')}`
    for (let i = 0; i < PROFILES[stage].dailyTarget + 2; i += 1) await cand()
    const first = Math.min(...PROFILES[stage].slots.map(minuteOfDay))
    let early = 0
    let overDue = 0
    let badCode = 0
    const pubAt: string[] = []
    for (const m of TICKS_ALL_DAY) {
      const w = await wake(at(date, m), stage, envOf(stage))
      if (w === null) continue
      if (w.r.kind === 'published') { pubAt.push(hhmm(m)); if (m < first) early += 1 }
      else if (!(w.r.kind === 'blocked' && (w.r.code === 'SLOT_CLOSED' || w.r.code === 'SLOT_CONSUMED'))) badCode += 1
      if ((await countToday(at(date, m))) > Math.min(dueCountAt(stage, Math.min(m, 1320)), PROFILES[stage].dailyTarget)) overDue += 1
    }
    const want = [...PROFILES[stage].slots].map(minuteOfDay).sort((a, b) => a - b).map(hhmm)
    const d = await dupFree()
    check(`🔴 🔴 ${stage} — 첫 슬롯(${hhmm(first)}) 전 발행 0 · 누적 ≤ 도래 수 · 하루 ${pubAt.length}/${catchUpDailyCeiling(stage)} · 중복 0`,
      early === 0 && overDue === 0 && badCode === 0 && pubAt.length === catchUpDailyCeiling(stage) && d.ok,
      `early=${early} over=${overDue} bad=${badCode} pub=${pubAt.length} ${d.detail}`)
    check(`🔴 ${stage} — 발행 시각 = 슬롯 시각 (지연 0) ${pubAt.join(',')}`, pubAt.join(',') === want.join(','), `${pubAt.join(',')} vs ${want.join(',')}`)
  }

  console.log('\n② 🔴 절전 뒤 wake — 같은 날짜 · 운영 창 안에서만 · 한 틱 1건')
  {
    await wipe()
    for (let i = 0; i < 14; i += 1) await cand()
    const date = '2026-10-10'
    const awake = heartbeatWakeTimes().map(minuteOfDay).filter((m) => m < 9 * 60 || (m >= 15 * 60 + 10 && m < 18 * 60))
    const arrivals = [...awake, 15 * 60 + 7].sort((a, b) => a - b)
    const pub: string[] = []
    for (const m of arrivals) {
      const w = await wake(at(date, m), 'd10', envOf('d10'))
      if (w?.r.kind === 'published') pub.push(hhmm(m))
    }
    check('🔴 🔴 **09:00~15:00 절전 → 15:07 wake 부터 한 틱에 1건씩 메운다**',
      pub.slice(0, 6).join(',') === '08:10,15:07,15:10,15:20,15:30,15:40', pub.join(','))
    const late = await wake(at(date, 23 * 60 + 40), 'd10', envOf('d10'))
    const before = await countToday(at(date, 12 * 60))
    check('🔴 🔴 **18:00 부터 절전 → 23:40 wake — 밀린 슬롯(19:00·20:30)을 메우지 않는다(SLOT_CLOSED)**',
      late?.r.kind === 'blocked' && late.r.code === 'SLOT_CLOSED' && before === 8, `${JSON.stringify(late?.r)} · 오늘 ${before}`)
    const n1 = await wake(K('2026-10-11T07:50:00'), 'd10', envOf('d10'))
    const n2 = await wake(K('2026-10-11T08:10:00'), 'd10', envOf('d10'))
    const n3 = await wake(K('2026-10-11T08:20:00'), 'd10', envOf('d10'))
    check('🔴 🔴 **다음 날 — 전날 backlog 0 (07:50 CLOSED · 08:10 1건 · 08:20 CONSUMED)**',
      n1?.r.kind === 'blocked' && n1.r.code === 'SLOT_CLOSED' && n2?.r.kind === 'published'
      && n3?.r.kind === 'blocked' && n3.r.code === 'SLOT_CONSUMED' && (await countToday(K('2026-10-11T12:00:00'))) === 1,
      `${JSON.stringify(n1?.r)} / ${n2?.r.kind} / ${JSON.stringify(n3?.r)}`)
    check('🔴 중복 0', (await dupFree()).ok, (await dupFree()).detail)
  }

  console.log('\n③ 🔴 🔴 기간 변수 없는 로컬 env — 러너가 d3·d10 을 넘겨도 로컬 천장 d1 (하루 1)')
  for (const asked of ['d3', 'd10'] as const) {
    await wipe()
    for (let i = 0; i < 12; i += 1) await cand()
    const date = '2026-09-26' // GitHub 쪽 기간(09-23~29) 안의 날 — 로컬에는 그 변수가 없다
    const pub: string[] = []
    for (const m of heartbeatWakeTimes().map(minuteOfDay)) {
      const w = await wake(at(date, m), asked, LOCAL_ENV)
      if (w?.r.kind === 'published') pub.push(hhmm(m))
    }
    check(`🔴 🔴 **요청 ${asked} · 로컬 env(d5/d1 · 기간 없음) — 하루 ${pub.length}건 ${pub.join(',')} (천장 d1 = 1건 · 09:30)**`,
      pub.join(',') === '09:30', pub.join(','))
  }

  console.log('\n④ 🔴 🔴 로컬 heartbeat(d1 천장) + GitHub 예약(기간 d3 · 실측 지연 110~408분) — 중복 0')
  {
    await wipe()
    for (let i = 0; i < 16; i += 1) await cand()
    const date = '2026-09-26'
    const cronSlots = [490, 570, 650, 730, 810, 890, 970, 1050, 1140, 1230] // 08:10 … 20:30 (KST 분)
    const delays = [110, 150, 200, 260, 300, 350, 408, 120, 180, 240]
    type Ev = { t: Date; who: 'local' | 'github' }
    /** 🔴 자정을 넘긴 GitHub 도착은 **다음 날** 시각이다 — 같은 날 분으로 접지 않는다 */
    const evs: Ev[] = [
      ...heartbeatWakeTimes().map((w) => ({ t: at(date, minuteOfDay(w)), who: 'local' as const })),
      ...cronSlots.map((s, i) => ({ t: new Date(at(date, s).getTime() + delays[i]! * 60_000), who: 'github' as const })),
    ]
    // 🔴 같은 순간의 사건은 **동시에** 던진다 — 순차가 아니라 Promise.all
    const byTime = new Map<number, Ev[]>()
    for (const e of evs) byTime.set(e.t.getTime(), [...(byTime.get(e.t.getTime()) ?? []), e])
    let localPub = 0
    let githubPub = 0
    let localOver = 0
    let concurrent = 0
    const errs: string[] = []
    const githubLog: string[] = []
    for (const ms of [...byTime.keys()].sort((a, b) => a - b)) {
      const group = byTime.get(ms)!
      const t = new Date(ms)
      const m = kstMinuteOfDay(t)
      if (group.length > 1) concurrent += 1
      const beforeN = await countToday(t)
      const rs = await Promise.all(group.map((e) => wake(t, e.who === 'local' ? 'd1' : 'd3', e.who === 'local' ? LOCAL_ENV : GITHUB_ENV)
        .then((w) => ({ e, w }))))
      for (const { e, w } of rs) {
        if (w === null) continue
        const k = w.r.kind === 'published' ? 'published' : w.r.kind === 'blocked' ? w.r.code : 'error'
        if (e.who === 'github') githubLog.push(`${heartbeatTickKey(t).slice(5)}${group.length > 1 ? '(동시)' : ''}:${k}`)
        if (w.r.kind === 'published') {
          if (e.who === 'local') { localPub += 1; if (beforeN >= Math.min(dueCountAt('d1', m), 1)) localOver += 1 } else githubPub += 1
        } else if (w.r.kind === 'error') errs.push(`${hhmm(m)} ${e.who} ${w.r.message}`)
        else if (!['SLOT_CLOSED', 'SLOT_CONSUMED', 'TARGET_RACE_LOST'].includes(w.r.code)) errs.push(`${hhmm(m)} ${e.who} ${w.r.code}`)
      }
    }
    console.log(`     GitHub 도착 ${githubLog.join(' · ')}`)
    const d = await dupFree()
    check(`🔴 🔴 **순차·동시 섞인 하루(동시 분 ${concurrent}개) — 중복 0 · ${d.detail}**`, d.ok && concurrent > 0, d.detail)
    check(`🔴 🔴 **합계 ≤ GitHub 천장 d3(3) — 로컬 ${localPub} · GitHub ${githubPub}**`, localPub + githubPub <= 3 && localPub + githubPub === 3, `${localPub}+${githubPub}`)
    check('🔴 🔴 **로컬은 자기 천장(d1 · 도래 1)을 넘어 낸 적이 없다**', localOver === 0 && localPub <= 1, `over=${localOver} local=${localPub}`)
    check('🔴 비정상 무발행(오류·다른 차단) 0 — 정상 코드(SLOT_*·TARGET_RACE_LOST)만', errs.length === 0, errs.join(' | '))
  }

  console.log('\n④-b 🔴 🔴 같은 틱 잠금이 **없다고** 쳐도 — 같은 순간 로컬 wake 2 + GitHub 1 이 같은 후보를 노린다')
  {
    await wipe()
    for (let i = 0; i < 6; i += 1) await cand()
    const t = K('2026-09-26T09:30:00')
    const rs = await Promise.all([wake(t, 'd1', LOCAL_ENV), wake(t, 'd1', LOCAL_ENV), wake(t, 'd3', GITHUB_ENV)])
    const kinds = rs.map((w) => (w === null ? 'none' : w.r.kind === 'published' ? 'published' : w.r.kind === 'blocked' ? w.r.code : 'error'))
    const d = await dupFree()
    check(`🔴 🔴 **09:30 세 러너 동시 — Post 정확히 1 · 나머지 정상 무발행 (${kinds.join(' · ')})**`,
      d.ok && (await prisma.post.count()) === 1 && kinds.filter((k) => k === 'published').length === 1
      && kinds.filter((k) => k !== 'published').every((k) => k === 'SLOT_CONSUMED' || k === 'TARGET_RACE_LOST'), `${kinds.join(',')} ${d.detail}`)
    const t2 = K('2026-09-26T13:30:00')
    const rs2 = await Promise.all([wake(t2, 'd1', LOCAL_ENV), wake(t2, 'd3', GITHUB_ENV)])
    const k2 = rs2.map((w) => (w === null ? 'none' : w.r.kind === 'published' ? 'published' : w.r.kind === 'blocked' ? w.r.code : 'error'))
    check(`🔴 🔴 **13:30 로컬+GitHub 동시 — GitHub(d3 도래 2) 만 1건 · 로컬(d1)은 SLOT_CONSUMED (${k2.join(' · ')})**`,
      k2[0] === 'SLOT_CONSUMED' && k2[1] === 'published' && (await prisma.post.count()) === 2, k2.join(','))
  }

  console.log('\n⑤ 🔴 🔴 러너 프로세스 자체 — 같은 틱 두 wake 동시 (--heartbeat · 격리 DB · 빈 재고)')
  {
    await wipe()
    const tickDir = mkdtempSync(join(tmpdir(), 'soran-hb-db-'))
    /** 🔴 격리 DB 주소와 단계 키만 담은 새 env — 부모 env 를 상속하지 않는다 */
    const run = (args: readonly string[]): Promise<{ code: number; out: string }> => new Promise((resolve) => {
      const env: Record<string, string> = {
        PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '',
        DATABASE_URL: URL, DIRECT_URL: URL, ...LOCAL_ENV,
      }
      const c = spawn('npx', ['tsx', 'scripts/original-post-auto-publish.mts', ...args], { env })
      let out = ''
      c.stdout.on('data', (d: Buffer) => { out += d.toString() })
      c.stderr.on('data', (d: Buffer) => { out += d.toString() })
      c.on('close', (code) => resolve({ code: code ?? -1, out }))
    })
    /**
     * 🔴 러너는 진짜 시계를 쓴다. 두 wake 사이에 10분 경계를 넘으면 틱이 둘이라 판정이 성립하지 않는다 —
     *    그때는 **새 디렉터리로 한 번만** 다시 본다. 두 번 다 넘기면 미관측(실패)이다.
     */
    let args: string[] = []
    let now = new Date()
    let tick = ''
    let a = { code: -1, out: '' }
    let b = { code: -1, out: '' }
    let sameTick = false
    for (let attempt = 0; attempt < 2 && !sameTick; attempt += 1) {
      args = [...PUBLISH_HEARTBEAT_ARGS, `--heartbeat-tick-dir=${mkdtempSync(join(tickDir, 't-'))}`]
      now = new Date()
      tick = heartbeatTickKey(now)
      ;[a, b] = await Promise.all([run(args), run(args)])
      sameTick = heartbeatTickKey(new Date()) === tick
    }
    if (!heartbeatInWindow(now)) {
      check(`🔴 창 밖(${tick}) — 두 wake 모두 DB 0 으로 정상 종료`,
        a.code === 0 && b.code === 0 && [a, b].every((x) => x.out.includes('운영 창(08:00~22:00 KST) 밖 heartbeat')), `${a.code}/${b.code}`)
    } else if (!sameTick) {
      check(`🔴 틱 경계(${tick})를 넘겨 이번 회차는 미관측 — 통과로 세지 않는다`, false)
    } else {
      const claimed = [a, b].filter((x) => x.out.includes(`틱 차지 ${tick}`))
      const taken = [a, b].filter((x) => x.out.includes('TICK_TAKEN'))
      check(`🔴 🔴 **같은 틱(${tick}) 동시 두 wake — 하나만 선택 단계로 · 하나는 TICK_TAKEN · 둘 다 exit 0**`,
        claimed.length === 1 && taken.length === 1 && a.code === 0 && b.code === 0, `${a.code}/${b.code}\n${a.out.slice(-600)}\n---\n${b.out.slice(-600)}`)
      check('🔴 선택 단계로 간 쪽이 단계 입력을 값으로 남겼다 — 천장 d1 (기간 변수 없음)',
        claimed[0]?.out.includes('③-s 단계 입력  capacity=d5 · release=d1 · window=(없음)') === true
        && claimed[0]?.out.includes('천장 d1 (하루 1건)') === true, claimed[0]?.out.slice(0, 400) ?? '')
      check('🔴 TICK_TAKEN 쪽은 DB 에 붙기 전에 끝났다(재고 조립 줄이 없다)', taken[0]?.out.includes('① 대기열') === false)
      const c = await run(args)
      check('🔴 같은 틱의 세 번째 wake(끝난 뒤) — 표식이 남아 TICK_TAKEN', heartbeatTickKey(new Date()) !== tick || (c.code === 0 && c.out.includes('TICK_TAKEN')), c.out.slice(-300))
    }
    const wrong = await run(['--apply', '--limit=1', '--trigger=schedule', '--heartbeat', `--heartbeat-tick-dir=${tickDir}`])
    check('🔴 --heartbeat 를 --trigger=schedule 과 쓰면 실패한다(exit 1)', wrong.code === 1 && wrong.out.includes('--trigger=local 과만'), `${wrong.code}`)
    check('🔴 러너 회차가 쓴 글 0 (빈 재고)', (await prisma.post.count()) === 0)
    console.log(`     (관측 시각 ${tick} · KST 분 ${kstMinuteOfDay(now)})`)
  }

  await wipe()
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 에서만 돌았다 — 운영 DB write 0 · 모델 호출 0 · launchctl 0\n')
  if (fail > 0) process.exit(1)
}

await main()


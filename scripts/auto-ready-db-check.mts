#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY v2 — 실행 사슬 검사 (격리 Postgres 전용)** (2026-09-25)
 *
 *   후보 → 적격 판정 → auto-ready:v1 도장 → selector 수용
 *   → 발행 트랜잭션 내부 재검증(+ 자동 행 배정) → Post
 *   → 감사 선정(hash 묶음) → 독립 감사 회차 → 결과 저장 → 확정 결함이 다음 회차를 실제로 닫음
 *
 * 🔴 **운영 DB 에 절대 붙이지 않는다.** sentinel · localhost · 고정 DB 이름을 모두 요구하고,
 *    주소를 한 글자도 찍지 않는다.
 *
 * ── 격리 Postgres 세우는 법 ───────────────────────────────────────────
 *   export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH" LANG=C LC_ALL=C
 *   PGDIR=/tmp/soran-pg ; SOCK=/tmp/soran-sock ; rm -rf "$PGDIR" "$SOCK" ; mkdir -p "$PGDIR" "$SOCK"
 *   initdb -D "$PGDIR" -U soran --auth=trust -E UTF8 --locale=C
 *   pg_ctl -D "$PGDIR" -o "-p 54329 -k $SOCK -h 127.0.0.1" -l "$PGDIR/server.log" start
 *   psql -h 127.0.0.1 -p 54329 -U soran -d postgres -c "create database soran_test;"
 *   export DATABASE_URL=... DIRECT_URL=... SORAN_ISOLATED_DB=yes-throwaway
 *   npx prisma migrate deploy && npm run auto-ready:db-check
 */
import { PrismaClient } from '@prisma/client'

import {
  AUTO_DECIDER, HUMAN_DECIDER, AUTO_READY_RECORD_KEY, AUDIT_CONTRACT_VERSION,
  readStamp, makeStamp, digestOf, type AuditJudge,
} from '../src/lib/auto-ready-v2'
import {
  authoritativeGate, stampAutoReady, stampRound, selectAudits, recordAuditResult,
  confirmedDefectCount, runAuditRound,
} from '../src/lib/auto-ready-repo'
import { publishOriginalPostTx } from '../src/lib/original-post-publish-tx'
import {
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE,
} from '../src/lib/micro-seed-supply-autofill'
import { loadPublishableStock } from './lib/publishable-stock.mjs'
import { ruleAuditJudge } from './lib/auto-ready-rule-judge.mjs'

// ── 🔴 격리 가드 — 주소를 찍지 않는다 ──
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
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else {
    fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const NOW = new Date()
const CAP = new Date(NOW.getTime() - 2 * 864e5)
/** 🔴 스위치 — 검사가 env 를 **값으로** 넘긴다. 프로세스 env 는 건드리지 않는다 */
const ON = { SORAN_AUTO_READY_ENABLED: 'on' } as const
const OFF = {} as const
const GOOD_SR = {
  complete: true, deterministicPass: true,
  unsupportedAdditions: 0, lifeContradictions: 0, droppedFromSource: 0, confidence: 0.9,
}
const gate = (sr: unknown = GOOD_SR, holds: string[] = []) => ({
  holds, blocks: [], semanticReview: sr,
  autoDraft: {
    provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
    draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
  },
})

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 자동 READY v2 — 실행 사슬 (격리 DB 전용 · 운영 DB 0) ══')
  console.log('   격리 확인됨 (SORAN_ISOLATED_DB · localhost · soran_test)\n')

  const wipe = async (): Promise<void> => {
    // 🔴 검사 파일의 청소다 — 격리 DB 에서만 돈다. adapter 에는 삭제 경로가 없다
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue",'
      + '"MicroSeedRawContent","Post","Persona","User" CASCADE',
    )
  }
  await wipe()

  // ── 시드 ──
  const personas: { id: string; code: string }[] = []
  for (let i = 1; i <= 3; i += 1) {
    const u = await prisma.user.create({ data: { nickname: `자동${i}` }, select: { id: true } })
    personas.push(await prisma.persona.create({
      data: { code: `P0${i}`, userId: u.id, status: 'active' }, select: { id: true, code: true },
    }))
  }
  let seq = 0
  const raw = async () => {
    seq += 1
    return prisma.microSeedRawContent.create({
      data: {
        origin: 'live', sourceSite: `${MACHINE_SITE_PREFIX}navercafe:t`, sourceUrl: `https://example.invalid/${seq}`,
        sourceArticleId: `${1000 + seq}-abcd`, sourceCapturedAt: CAP, rawTitle: `원문 ${seq}`, rawBody: `원문 본문 ${seq}`,
      },
      select: { id: true },
    })
  }
  /** 기계 행 — persona 를 null 로 주면 배정 없는 행이다 */
  const machineRow = async (o: { sr?: unknown; persona?: string | null } = {}) => {
    const r = await raw()
    return prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'APPROVED', draftTitle: `평범한 하루 이야기 ${seq}`,
        draftBody: `아침에 산책을 다녀왔어요 ${seq}. 다들 어떻게 지내세요?`,
        gateVerdict: 'PASS', gateResults: gate(o.sr) as never,
        promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        decidedBy: 'machine:auto-draft-v5', dedupKey: `dk-${seq}`,
        matchedPersonaId: o.persona === null ? null : (o.persona ?? personas[seq % 3]!.id),
        matchedAt: o.persona === null ? null : NOW,
      },
      select: { id: true },
    })
  }
  const evidenceIds: string[] = []
  const evidenceRow = async (i: number) => {
    const r = await raw()
    const q = await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'PUBLISHED', draftTitle: `사람이 본 글 ${i}`, draftBody: `사람이 본 본문 ${i}`,
        gateVerdict: 'PASS', gateResults: gate() as never, promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        decidedBy: HUMAN_DECIDER, createdPostId: `evidence-post-${i}`, dedupKey: `ev-${i}`,
      },
      select: { id: true },
    })
    evidenceIds.push(q.id)
  }
  /** 🔴 증거를 한 건만 무너뜨린다 — 그 행에 경고를 얹어 적격에서 뺀다(30→29) */
  const breakOneEvidence = (on: boolean) => prisma.originalPostApprovalQueue.update({
    where: { id: evidenceIds[0]! }, data: { gateResults: gate(GOOD_SR, on ? ['BROKEN_FOR_TEST'] : []) as never },
  })
  /** 🔴 증거 검사를 우회해 도장만 직접 찍은 행 — 호출자가 게이트를 건너뛴 상황이다 */
  const forceStamp = async (id: string) => {
    const r = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id } })
    await prisma.originalPostApprovalQueue.update({
      where: { id },
      data: { decidedBy: AUTO_DECIDER, editDiff: { [AUTO_READY_RECORD_KEY]: makeStamp(r.draftTitle, r.draftBody, NOW) } as never },
    })
  }
  const postCount = () => prisma.post.count()
  check('기준선 — 시작할 때 founder 결정 0',
    await prisma.originalPostApprovalQueue.count({ where: { decidedBy: HUMAN_DECIDER } }) === 0)

  console.log('① 🔴 스위치 OFF — 도장 0 · selector 닫힘 · 감사 표를 읽지 않는다')
  {
    const m = await machineRow()
    await prisma.$executeRawUnsafe('ALTER TABLE "AutoReadyAudit" RENAME TO "AutoReadyAudit_hidden"')
    let threw = ''
    try {
      check('OFF 이면 닫힘', !(await authoritativeGate(prisma, OFF)).open)
      check('🔴 🔴 **OFF 이면 도장 0**', (await stampRound(prisma, { env: OFF, now: NOW })).size === 0)
      const s = await loadPublishableStock(prisma, NOW, { autoReadyOpen: false })
      check('🔴 기계 행은 여전히 사람 검토 대상이다', s.rejected.some((x) => x.id === m.id && x.code === 'HUMAN_REVIEW_REQUIRED'))
      check('🔴 감사 회차도 OFF 면 표를 읽지 않는다',
        (await runAuditRound(prisma, { env: OFF, judge: ruleAuditJudge, auditor: 'rule-auditor', now: NOW })).kind === 'off')
    } catch (e) { threw = String(e).slice(0, 120) }
    await prisma.$executeRawUnsafe('ALTER TABLE "AutoReadyAudit_hidden" RENAME TO "AutoReadyAudit"')
    check('🔴 🔴 **감사 표가 없어도 OFF 경로는 깨지지 않는다 (운영에 아직 표가 없다)**', threw === '', threw)
  }

  console.log('\n② 🔴 🔴 증거 0/30 인데 호출자가 "열림" 을 넘겨도 — 도장 0 · Post 0')
  {
    const r = await machineRow({ persona: personas[0]!.id })
    // 🔴 앞판 시그니처처럼 `open: { open: true }` 를 억지로 넘긴다 — 이제 받는 자리가 없다
    const o = await stampAutoReady(prisma, { queueId: r.id, env: ON, now: NOW, open: { open: true, reasons: [] } } as never)
    check('🔴 🔴 **증거 0/30 · 호출자 open:true → closed · 도장 0**',
      o.kind === 'closed' && o.reason.includes('0/30'), JSON.stringify(o))
    check('그 행은 기계 도장 그대로', (await prisma.originalPostApprovalQueue.findUnique({ where: { id: r.id } }))?.decidedBy === 'machine:auto-draft-v5')
    await forceStamp(r.id)
    const before = await postCount()
    const p = await publishOriginalPostTx(prisma, { queueId: r.id, publishedToday: 0, dailyCap: 100, autoReadyEnv: ON })
    check('🔴 🔴 **우회해 찍힌 도장도 발행 트랜잭션이 증거 0/30 으로 막는다 · Post 0**',
      p.kind === 'blocked' && p.code === 'AUTO_READY_RECHECK' && (await postCount()) === before, JSON.stringify(p))
  }

  for (let i = 0; i < 29; i += 1) await evidenceRow(i)
  console.log('\n③ 🔴 증거가 계약을 채워야 열린다 — 29 에서 닫히고 30 에서 열린다')
  const at29 = await authoritativeGate(prisma, ON)
  check('🔴 🔴 **증거 29/30 → 닫힘 (30 을 낮추지 않았다)**', !at29.open && at29.reasons.some((x) => x.includes('29/30')), at29.reasons.join(' · '))
  await evidenceRow(29)
  const founderBefore = await prisma.originalPostApprovalQueue.count({ where: { decidedBy: HUMAN_DECIDER } })
  const open = await authoritativeGate(prisma, ON)
  check('🔴 증거 30/30 · 결함 0 → 열림', open.open, open.reasons.join(' · '))

  console.log('\n④ 🔴 적격 판정 — 경고 행은 예외 묶음 · 도장 없음')
  {
    const bad = await machineRow({ sr: { ...GOOD_SR, confidence: 'high' } })
    check('🔴 🔴 **semanticReview 가 망가진 행 → exception**', (await stampAutoReady(prisma, { queueId: bad.id, env: ON, now: NOW })).kind === 'exception')
    const empty = await machineRow({ sr: {} })
    check('🔴 빈 semanticReview {} → exception', (await stampAutoReady(prisma, { queueId: empty.id, env: ON, now: NOW })).kind === 'exception')
  }

  console.log('\n⑤ 🔴 도장 — 조건부 · 본문 hash · founder 0 · 동시 도장 1회')
  const a = await machineRow({ persona: personas[0]!.id })
  {
    check('도장이 찍힌다', (await stampAutoReady(prisma, { queueId: a.id, env: ON, now: NOW })).kind === 'stamped')
    const row = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: a.id } })
    const st = readStamp(row.editDiff)
    check('🔴 🔴 **decidedBy 는 auto-ready:v1 · hash 가 실제 글과 같다**',
      row.decidedBy === AUTO_DECIDER && st !== null && st.bodyHash === digestOf(row.draftBody))
    const r = await machineRow({ persona: personas[1]!.id })
    const res = await Promise.all(Array.from({ length: 4 }, () => stampAutoReady(prisma, { queueId: r.id, env: ON, now: NOW })))
    check('🔴 🔴 **네 회차가 동시에 찍어도 도장은 정확히 한 번**',
      res.filter((x) => x.kind === 'stamped').length === 1, res.map((x) => x.kind).join(','))
  }

  console.log('\n⑥ 🔴 selector — 열림일 때만 · 도장이 지금 글과 같을 때만')
  {
    check('🔴 🔴 **열림 → 도장 행이 발행 대상에 들어온다**',
      (await loadPublishableStock(prisma, NOW, { autoReadyOpen: true })).targets.some((t) => t.id === a.id))
    check('🔴 닫힘 → AUTO_READY_CLOSED',
      (await loadPublishableStock(prisma, NOW, { autoReadyOpen: false })).rejected.some((x) => x.id === a.id && x.code === 'AUTO_READY_CLOSED'))
  }

  console.log('\n⑦ 🔴 🔴 선택 뒤 증거가 30→29 로 무너졌다 — Post 0')
  {
    const r = await machineRow({ persona: personas[2]!.id })
    await stampAutoReady(prisma, { queueId: r.id, env: ON, now: NOW })
    check('선택 시점에는 발행 대상이었다', (await loadPublishableStock(prisma, NOW, { autoReadyOpen: true })).targets.some((t) => t.id === r.id))
    await breakOneEvidence(true)
    const before = await postCount()
    const p = await publishOriginalPostTx(prisma, { queueId: r.id, publishedToday: 0, dailyCap: 100, autoReadyEnv: ON })
    check('🔴 🔴 **선택 뒤 증거 29/30 → 발행 트랜잭션이 막는다 · Post 0**',
      p.kind === 'blocked' && p.code === 'AUTO_READY_RECHECK' && p.detail.includes('29/30') && (await postCount()) === before,
      JSON.stringify(p))
    await breakOneEvidence(false)
    check('증거를 되돌리면 다시 열린다', (await authoritativeGate(prisma, ON)).open)
  }

  console.log('\n⑧ 🔴 🔴 자동 행 배정은 발행 트랜잭션 안에서 — 실패하면 배정도 불변')
  {
    const assignTo = { personaId: personas[1]!.id, matchedAt: NOW, matchMeta: { test: true } }
    const unassigned = async () => {
      const r = await machineRow({ persona: null })
      await stampAutoReady(prisma, { queueId: r.id, env: ON, now: NOW })
      return r.id
    }
    const untouched = async (id: string) => {
      const q = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id }, select: { matchedPersonaId: true, matchedAt: true, createdPostId: true } })
      return q.matchedPersonaId === null && q.matchedAt === null && q.createdPostId === null
    }
    const idA = await unassigned()
    await prisma.originalPostApprovalQueue.update({ where: { id: idA }, data: { editedBody: '도장 뒤에 바뀐 본문' } })
    check('🔴 🔴 **도장 뒤 본문이 바뀌면 selector 가 먼저 AUTO_READY_STALE 로 거절한다**',
      (await loadPublishableStock(prisma, NOW, { autoReadyOpen: true })).rejected.some((x) => x.id === idA && x.code === 'AUTO_READY_STALE'))
    const pa = await publishOriginalPostTx(prisma, { queueId: idA, publishedToday: 0, dailyCap: 100, autoReadyEnv: ON, autoAssign: assignTo })
    check('🔴 🔴 **재검증 실패(본문 변경) → Post 0 · matchedPersonaId/matchedAt 불변**',
      pa.kind === 'blocked' && pa.code === 'AUTO_READY_RECHECK' && await untouched(idA), JSON.stringify(pa))
    const idB = await unassigned()
    /**
     * 🔴 일 상한에 **실제로** 걸리게 한다. `dailyCap: 0` 은 "주입 안 됨" 으로 읽혀 가장 안전한
     *    상수 1 로 떨어지는 기존 계약이다(첫 판이 그 값을 넣어 오히려 발행됐다).
     *    격리 DB 에 오늘 발행 기록 1건을 두고 상한 1 을 준다.
     */
    await prisma.personaActivityLog.create({
      data: { personaId: personas[2]!.id, kind: 'post', targetId: 'cap-fixture', gateStatus: 'PASS', decidedBy: 'operator', publishedAt: new Date() },
    })
    const pb = await publishOriginalPostTx(prisma, { queueId: idB, publishedToday: 1, dailyCap: 1, autoReadyEnv: ON, autoAssign: assignTo })
    check('🔴 🔴 **발행 판정 실패(일 상한) → 배정 불변**',
      pb.kind === 'blocked' && pb.code === 'DAILY_CAP' && await untouched(idB), JSON.stringify(pb))
    const idC = await unassigned()
    await breakOneEvidence(true)
    const pc = await publishOriginalPostTx(prisma, { queueId: idC, publishedToday: 0, dailyCap: 100, autoReadyEnv: ON, autoAssign: assignTo })
    await breakOneEvidence(false)
    check('🔴 🔴 **증거 게이트 실패 → 배정 불변**', pc.kind === 'blocked' && await untouched(idC), JSON.stringify(pc))
    const pd = await publishOriginalPostTx(prisma, { queueId: idC, publishedToday: 0, dailyCap: 100, autoReadyEnv: OFF, autoAssign: assignTo })
    check('🔴 스위치 OFF → 배정 불변', pd.kind === 'blocked' && await untouched(idC))
    const pe = await publishOriginalPostTx(prisma, { queueId: idC, publishedToday: 0, dailyCap: 100, autoReadyEnv: ON, autoAssign: assignTo })
    const qe = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: idC } })
    check('🔴 🔴 **통과하면 한 트랜잭션에서 배정 + Post**',
      pe.kind === 'published' && pe.personaCode === personas[1]!.code && qe.matchedPersonaId === personas[1]!.id
      && qe.createdPostId !== null, JSON.stringify(pe))
    const hr = await raw()
    const human = await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: hr.id, status: 'APPROVED', draftTitle: '사람 글', draftBody: '사람이 고른 글',
        gateVerdict: 'PASS', gateResults: gate() as never, promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        decidedBy: HUMAN_DECIDER, dedupKey: `human-${seq}`,
      },
      select: { id: true },
    })
    const ph = await publishOriginalPostTx(prisma, { queueId: human.id, publishedToday: 0, dailyCap: 100, autoReadyEnv: ON, autoAssign: assignTo })
    check('🔴 사람 행은 autoAssign 을 쓰지 않는다 — 배정 없으면 기존처럼 NO_MATCH',
      ph.kind === 'blocked' && ph.code === 'NO_MATCH' && await untouched(human.id), JSON.stringify(ph))
  }

  console.log('\n⑨ 🔴 발행 — 스위치·동시성')
  {
    check('🔴 🔴 **스위치 OFF → 도장 행도 발행 안 됨**',
      (await publishOriginalPostTx(prisma, { queueId: a.id, publishedToday: 0, dailyCap: 100, autoReadyEnv: OFF })).kind === 'blocked')
    const before = await postCount()
    const [p1, p2] = await Promise.all([
      publishOriginalPostTx(prisma, { queueId: a.id, publishedToday: 0, dailyCap: 100, autoReadyEnv: ON }),
      publishOriginalPostTx(prisma, { queueId: a.id, publishedToday: 0, dailyCap: 100, autoReadyEnv: ON }),
    ])
    check('🔴 🔴 **같은 행을 동시에 발행해도 한 번만 나간다**',
      [p1, p2].filter((x) => x.kind === 'published').length === 1 && (await postCount()) === before + 1, `${p1.kind}/${p2.kind}`)
  }

  console.log('\n⑩ 🔴 감사 선정 — ceil(N×0.2) · 중복 0 · 무엇을 감사하는지 묶는다')
  {
    for (let i = 0; i < 9; i += 1) {
      const r = await machineRow({ persona: personas[i % 3]!.id })
      await stampAutoReady(prisma, { queueId: r.id, env: ON, now: NOW })
      await publishOriginalPostTx(prisma, { queueId: r.id, publishedToday: 0, dailyCap: 100, autoReadyEnv: ON })
    }
    const n = await prisma.originalPostApprovalQueue.count({ where: { decidedBy: AUTO_DECIDER, createdPostId: { not: null } } })
    const s1 = await selectAudits(prisma)
    check(`🔴 🔴 **자동 발행 ${n}건 → 감사 ceil(${n}×0.2)=${Math.ceil(n / 5)}건**`,
      s1.kind === 'ok' && s1.picked.length === Math.ceil(n / 5), JSON.stringify(s1))
    const s2 = await selectAudits(prisma)
    check('🔴 다시 돌려도 더 고르지 않는다', s2.kind === 'ok' && s2.picked.length === 0
      && await prisma.autoReadyAudit.count() === Math.ceil(n / 5))
    const au = await prisma.autoReadyAudit.findFirstOrThrow()
    const post = await prisma.post.findUniqueOrThrow({ where: { id: au.postId } })
    const q = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: au.queueId } })
    check('🔴 🔴 **고를 때 발행 글 hash 와 도장 계약 판을 묶었다**',
      au.publishedTitleHash === digestOf(post.title) && au.publishedBodyHash === digestOf(post.content)
      && au.stampContractDigest === readStamp(q.editDiff)?.contractDigest)
  }

  console.log('\n⑪ 🔴 🔴 결과 기록 — 잘못된 글·옛 판정·깨진 결과는 붙지 않는다')
  {
    const audits = await prisma.autoReadyAudit.findMany({ orderBy: { queueId: 'asc' } })
    const au = audits[0]!
    const post = await prisma.post.findUniqueOrThrow({ where: { id: au.postId } })
    const stampOf = async (id: string) => readStamp((await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id } })).editDiff)
    const good = await ruleAuditJudge({ queueId: au.queueId, postId: au.postId, title: post.title, body: post.content, stamp: await stampOf(au.queueId) })
    const rec = (v: typeof good, auditor = 'rule-auditor') => recordAuditResult(prisma, { queueId: au.queueId, verdict: v, auditor, now: NOW })
    check('🔴 🔴 **다른 감사 계약 판의 결과 → staleContract**', await rec({ ...good, contractVersion: 'auto-ready-audit-v0' }) === 'staleContract')
    check('🔴 🔴 **다른 글을 판정한 결과 → hashMismatch**', await rec({ ...good, judgedBodyHash: digestOf('다른 글') }) === 'hashMismatch')
    check('🔴 모델·프롬프트 판이 없는 결과 → badVerdict', await rec({ ...good, model: '' }) === 'badVerdict')
    check('🔴 🔴 **감사자 founder → rejectedAuditor**', await rec(good, 'founder') === 'rejectedAuditor')
    check('🔴 그 사이 아무것도 기록되지 않았다', (await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: au.queueId } })).defect === null)
    const other = audits[1]!
    const op = await prisma.post.findUniqueOrThrow({ where: { id: other.postId } })
    const ov = await ruleAuditJudge({ queueId: other.queueId, postId: other.postId, title: op.title, body: op.content, stamp: await stampOf(other.queueId) })
    await prisma.post.update({ where: { id: other.postId }, data: { content: `${op.content} (고른 뒤 수정)` } })
    check('🔴 🔴 **고른 뒤 글이 바뀌었다 → postChanged**',
      await recordAuditResult(prisma, { queueId: other.queueId, verdict: ov, auditor: 'rule-auditor', now: NOW }) === 'postChanged')
    await prisma.post.update({ where: { id: other.postId }, data: { content: op.content } })
    check('🔴 🔴 **정상 결과는 기록된다**', await rec(good) === 'recorded')
    const saved = await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: au.queueId } })
    check('기록에 감사 계약·모델·프롬프트가 남는다',
      saved.defect === 'no' && saved.auditContractVersion === AUDIT_CONTRACT_VERSION
      && saved.auditModel === good.model && saved.auditPromptVersion === good.promptVersion)
    let dbBlocked = false
    try {
      await prisma.$executeRawUnsafe(`UPDATE "AutoReadyAudit" SET "auditModel"=NULL WHERE "queueId"=$1`, au.queueId)
    } catch { dbBlocked = true }
    check('🔴 DB 제약도 판정에 출처가 빠지는 것을 막는다', dbBlocked)
  }

  console.log('\n⑫ 🔴 🔴 독립 감사 회차 → 결함 yes → 다음 자동 도장과 발행이 실제로 닫힌다')
  {
    const waiting = await machineRow({ persona: personas[0]!.id })
    check('결함 전 도장', (await stampAutoReady(prisma, { queueId: waiting.id, env: ON, now: NOW })).kind === 'stamped')
    check('판정 전 대기는 열림을 막지 않는다 (대기 개수 제한 없음)', (await authoritativeGate(prisma, ON)).open)
    // 🔴 규칙 감사자가 실제로 결함을 찾는 상황 — 발행된 글과 도장 기록이 어긋났다
    const target = (await prisma.autoReadyAudit.findMany({ where: { defect: null }, orderBy: { queueId: 'asc' } }))[0]!
    const tq = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: target.queueId } })
    const st = readStamp(tq.editDiff)!
    await prisma.originalPostApprovalQueue.update({
      where: { id: target.queueId },
      data: { editDiff: { [AUTO_READY_RECORD_KEY]: { ...st, bodyHash: digestOf('도장이 본 것은 다른 본문이었다') } } as never },
    })
    const pendingBefore = await prisma.autoReadyAudit.count({ where: { defect: null } })
    const round = await runAuditRound(prisma, { env: ON, judge: ruleAuditJudge, auditor: 'rule-auditor', now: NOW })
    check('🔴 🔴 **감사 회차가 판정 전 감사를 전부 판정했다 (개수 제한 없음)**',
      round.kind === 'ok' && round.pending === pendingBefore && (await prisma.autoReadyAudit.count({ where: { defect: null } })) === 0,
      round.kind === 'ok' ? `${round.pending}건 · ${[...round.tally].map(([k, v]) => `${k} ${v}`).join(' · ')}` : 'off')
    check('🔴 🔴 **규칙 감사자가 결함을 찾아 yes 로 기록했다**',
      (await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: target.queueId } })).defect === 'yes')
    check('확정 결함 ≥ 1', await confirmedDefectCount(prisma) >= 1)
    const next = await authoritativeGate(prisma, ON)
    check('🔴 🔴 **다음 회차 열림 판정 → 닫힘**', !next.open && next.reasons.some((x) => x.includes('확정 결함')))
    const fresh = await machineRow({ persona: personas[1]!.id })
    check('🔴 🔴 **다음 자동 도장 → closed · 도장 0**', (await stampAutoReady(prisma, { queueId: fresh.id, env: ON, now: NOW })).kind === 'closed'
      && (await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: fresh.id } })).decidedBy === 'machine:auto-draft-v5')
    const before = await postCount()
    const pw = await publishOriginalPostTx(prisma, { queueId: waiting.id, publishedToday: 0, dailyCap: 100, autoReadyEnv: ON })
    check('🔴 🔴 **결함 전에 찍힌 도장 행도 발행 트랜잭션에서 막힌다 · Post 0**',
      pw.kind === 'blocked' && pw.code === 'AUTO_READY_RECHECK' && (await postCount()) === before, JSON.stringify(pw))
    const noJudge: AuditJudge = async (i) => ({ ...(await ruleAuditJudge(i)), defect: 'no', reasons: [] })
    const tp = await prisma.post.findUniqueOrThrow({ where: { id: target.postId } })
    const vNo = await noJudge({ queueId: target.queueId, postId: target.postId, title: tp.title, body: tp.content, stamp: null })
    check('🔴 🔴 **yes → no 는 안 된다 (끈적하다)**',
      await recordAuditResult(prisma, { queueId: target.queueId, verdict: vNo, auditor: 'other-auditor', now: NOW }) === 'stickyYes')
  }

  console.log('\n⑫-b 🔴 🔴 같은 감사에 yes 와 no 가 동시에 들어와도 yes 가 사라지지 않는다')
  {
    // 판정 전 감사 하나를 새로 만든다 — 자동 발행을 늘리고 모자란 만큼 고른다
    let fresh: string | null = null
    for (let i = 0; i < 5 && fresh === null; i += 1) {
      const r = await machineRow({ persona: personas[i % 3]!.id })
      await prisma.originalPostApprovalQueue.update({ where: { id: r.id }, data: { decidedBy: AUTO_DECIDER } })
      const row = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: r.id } })
      await prisma.originalPostApprovalQueue.update({
        where: { id: r.id },
        data: { editDiff: { [AUTO_READY_RECORD_KEY]: makeStamp(row.draftTitle, row.draftBody, NOW) } as never },
      })
      // 🔴 확정 결함 때문에 자동 발행은 닫혀 있다 — 감사 대상을 만들려고 검사가 직접 Post 를 붙인다
      const u = await prisma.user.create({ data: { nickname: `감사대상${i}` }, select: { id: true } })
      const post = await prisma.post.create({
        data: { boardType: 'FREE', title: row.draftTitle, content: row.draftBody, authorId: u.id },
        select: { id: true },
      })
      await prisma.originalPostApprovalQueue.update({ where: { id: r.id }, data: { status: 'PUBLISHED', createdPostId: post.id } })
      const s = await selectAudits(prisma)
      if (s.kind === 'ok' && s.picked.length > 0) fresh = s.picked[0]!
    }
    check('동시 기록을 시험할 판정 전 감사가 있다', fresh !== null)
    if (fresh !== null) {
      const a2 = await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: fresh } })
      const p2 = await prisma.post.findUniqueOrThrow({ where: { id: a2.postId } })
      const base = await ruleAuditJudge({ queueId: fresh, postId: a2.postId, title: p2.title, body: p2.content, stamp: null })
      const [ry, rn] = await Promise.all([
        recordAuditResult(prisma, { queueId: fresh, verdict: { ...base, defect: 'yes' }, auditor: 'auditor-a', now: NOW }),
        recordAuditResult(prisma, { queueId: fresh, verdict: { ...base, defect: 'no', reasons: [] }, auditor: 'auditor-b', now: NOW }),
      ])
      const final = (await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: fresh } })).defect
      check('🔴 🔴 **yes 가 기록됐다고 답했으면 최종 값은 반드시 yes**',
        ry !== 'recorded' || final === 'yes', `yes=${ry} · no=${rn} · 최종=${String(final)}`)
      check('🔴 충돌은 예외가 아니라 값(race)으로 온다 — 조용히 잃지 않는다',
        ['recorded', 'stickyYes', 'race'].includes(ry) && ['recorded', 'stickyYes', 'race'].includes(rn), `${ry}/${rn}`)
    }
  }

  console.log('\n⑬ 🔴 founder 기록 0')
  {
    const founderAfter = await prisma.originalPostApprovalQueue.count({ where: { decidedBy: HUMAN_DECIDER } })
    // 사람 행 1건(⑧)은 검사가 직접 만든 사람 결정이다 — 사슬이 만든 것이 아니다
    check('🔴 🔴 **사슬 전체를 돌아도 사슬이 founder 결정을 만들지 않았다**',
      founderAfter === founderBefore + 1, `${founderBefore} → ${founderAfter} (검사가 직접 만든 사람 행 1)`)
    check('🔴 감사자 founder 0', await prisma.autoReadyAudit.count({ where: { auditor: HUMAN_DECIDER } }) === 0)
  }

  await wipe()
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 에서만 돌았다 — 운영 DB write 0 · 모델 호출 0\n')
  if (fail > 0) process.exit(1)
}

await main()

#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY v2 — 실행 사슬 검사 (격리 Postgres 전용)** (2026-09-25)
 *
 *   후보 → 적격 판정 → auto-ready:v1 도장 → selector 수용 → 발행 트랜잭션 내부 재검증
 *   → Post → 감사 선정·결과 DB 저장 → 확정 결함이 다음 회차를 실제로 닫음
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
  AUTO_DECIDER, HUMAN_DECIDER, AUTO_READY_RECORD_KEY, readStamp, digestOf,
} from '../src/lib/auto-ready-v2'
import {
  autoReadyOpenState, stampAutoReady, stampRound, selectAudits, recordAuditResult, confirmedDefectCount,
} from '../src/lib/auto-ready-repo'
import { publishOriginalPostTx } from '../src/lib/original-post-publish-tx'
import {
  MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE,
} from '../src/lib/micro-seed-supply-autofill'
import { loadPublishableStock } from './lib/publishable-stock.mjs'

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
const GOOD_SR = {
  complete: true, deterministicPass: true,
  unsupportedAdditions: 0, lifeContradictions: 0, droppedFromSource: 0, confidence: 0.9,
}
const gate = (sr: unknown = GOOD_SR) => ({
  holds: [], blocks: [], semanticReview: sr,
  autoDraft: {
    provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
    draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
  },
})

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 자동 READY v2 — 실행 사슬 (격리 DB 전용 · 운영 DB 0) ══')
  console.log('   격리 확인됨 (SORAN_ISOLATED_DB · localhost · soran_test)\n')

  // 🔴 검사 파일의 청소다 — 격리 DB 에서만 돈다. adapter 에는 삭제 경로가 없다
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue",'
    + '"MicroSeedRawContent","Post","Persona","User" CASCADE',
  )

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
  const machineRow = async (o: { sr?: unknown; body?: string; persona?: string } = {}) => {
    const r = await raw()
    return prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'APPROVED', draftTitle: `평범한 하루 이야기 ${seq}`,
        draftBody: o.body ?? `아침에 산책을 다녀왔어요 ${seq}. 다들 어떻게 지내세요?`,
        gateVerdict: 'PASS', gateResults: gate(o.sr) as never,
        promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        decidedBy: 'machine:auto-draft-v5', dedupKey: `dk-${seq}`,
        matchedPersonaId: o.persona ?? personas[seq % 3]!.id, matchedAt: NOW,
      },
      select: { id: true },
    })
  }
  // 🔴 증거 — 사람이 결정한 기계 후보(무수정). **먼저 29건만** 심는다 — 경계를 본다
  const evidenceRow = async (i: number) => {
    const r = await raw()
    await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'PUBLISHED', draftTitle: `사람이 본 글 ${i}`, draftBody: `사람이 본 본문 ${i}`,
        gateVerdict: 'PASS', gateResults: gate() as never, promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        decidedBy: HUMAN_DECIDER, createdPostId: `evidence-post-${i}`, dedupKey: `ev-${i}`,
      },
    })
  }
  for (let i = 0; i < 29; i += 1) await evidenceRow(i)

  console.log('① 🔴 스위치 OFF — 도장 0 · selector 닫힘 · 감사 표를 읽지 않는다')
  {
    const m = await machineRow()
    /** 🔴 표를 숨겨도 OFF 경로가 도는가 — 운영에는 이 표가 아직 없다 */
    await prisma.$executeRawUnsafe('ALTER TABLE "AutoReadyAudit" RENAME TO "AutoReadyAudit_hidden"')
    let threw = ''
    try {
      const off = await autoReadyOpenState(prisma, false)
      check('OFF 이면 닫힘', !off.open)
      const tally = await stampRound(prisma, { open: off, now: NOW })
      check('🔴 🔴 **OFF 이면 도장 0**', tally.size === 0)
      const s = await loadPublishableStock(prisma, NOW, { autoReadyOpen: off.open })
      check('🔴 기계 행은 여전히 사람 검토 대상이다', s.rejected.some((x) => x.id === m.id && x.code === 'HUMAN_REVIEW_REQUIRED'))
    } catch (e) { threw = String(e).slice(0, 120) }
    await prisma.$executeRawUnsafe('ALTER TABLE "AutoReadyAudit_hidden" RENAME TO "AutoReadyAudit"')
    check('🔴 🔴 **감사 표가 없어도 OFF 경로는 깨지지 않는다 (운영에 아직 표가 없다)**', threw === '', threw)
    check('행은 기계 도장 그대로', (await prisma.originalPostApprovalQueue.findUnique({ where: { id: m.id } }))?.decidedBy === 'machine:auto-draft-v5')
  }

  console.log('\n② 🔴 ON 이어도 증거가 계약을 채워야 열린다 — 29 에서 닫히고 30 에서 열린다')
  const at29 = await autoReadyOpenState(prisma, true)
  check('🔴 🔴 **증거 29/30 → 닫힘 (30 을 낮추지 않았다 · 실제 DB)**',
    !at29.open && at29.reasons.some((r) => r.includes('29/30')), at29.reasons.join(' · '))
  await evidenceRow(29)
  const founderBefore = await prisma.originalPostApprovalQueue.count({ where: { decidedBy: HUMAN_DECIDER } })
  const open = await autoReadyOpenState(prisma, true)
  check('🔴 증거 30/30 · 결함 0 → 열림', open.open, open.reasons.join(' · '))

  console.log('\n③ 🔴 적격 판정 — 경고 행은 예외 묶음 · 도장 없음')
  {
    const bad = await machineRow({ sr: { ...GOOD_SR, confidence: 'high' } })
    const o = await stampAutoReady(prisma, { queueId: bad.id, open, now: NOW })
    check('🔴 🔴 **semanticReview 가 망가진 행 → exception · 도장 없음**', o.kind === 'exception', JSON.stringify(o))
    check('그 행은 기계 도장 그대로', (await prisma.originalPostApprovalQueue.findUnique({ where: { id: bad.id } }))?.decidedBy === 'machine:auto-draft-v5')
    const empty = await machineRow({ sr: {} })
    check('🔴 빈 semanticReview {} → exception', (await stampAutoReady(prisma, { queueId: empty.id, open, now: NOW })).kind === 'exception')
  }

  console.log('\n④ 🔴 도장 — 조건부 · 본문 hash · founder 0')
  const a = await machineRow({ persona: personas[0]!.id })
  {
    const o = await stampAutoReady(prisma, { queueId: a.id, open, now: NOW })
    check('도장이 찍힌다', o.kind === 'stamped', JSON.stringify(o))
    const row = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: a.id } })
    const st = readStamp(row.editDiff)
    check('🔴 🔴 **decidedBy 는 auto-ready:v1 — founder 가 아니다**', row.decidedBy === AUTO_DECIDER)
    check('🔴 🔴 **본문·제목 hash 가 실제 글과 같다**',
      st !== null && st.bodyHash === digestOf(row.draftBody) && st.titleHash === digestOf(row.draftTitle))
    const again = await stampAutoReady(prisma, { queueId: a.id, open, now: NOW })
    check('🔴 이미 도장된 행은 다시 찍지 않는다', again.kind === 'skip', JSON.stringify(again))
  }

  console.log('\n⑤ 🔴 경쟁 — 같은 행을 동시에 도장')
  {
    const r = await machineRow({ persona: personas[1]!.id })
    const res = await Promise.all(Array.from({ length: 4 }, () => stampAutoReady(prisma, { queueId: r.id, open, now: NOW })))
    const stamped = res.filter((x) => x.kind === 'stamped').length
    check('🔴 🔴 **네 회차가 동시에 찍어도 도장은 정확히 한 번**', stamped === 1, res.map((x) => x.kind).join(','))
    check('🔴 진 회차는 race 또는 skip 이다 — 조용히 성공하지 않는다',
      res.filter((x) => x.kind !== 'stamped').every((x) => x.kind === 'race' || x.kind === 'skip'))
  }

  console.log('\n⑥ 🔴 selector — 열림일 때만 · 도장이 지금 글과 같을 때만')
  {
    const sOpen = await loadPublishableStock(prisma, NOW, { autoReadyOpen: true })
    check('🔴 🔴 **열림 → 도장 행이 발행 대상에 들어온다**', sOpen.targets.some((t) => t.id === a.id))
    const sClosed = await loadPublishableStock(prisma, NOW, { autoReadyOpen: false })
    check('🔴 닫힘 → AUTO_READY_CLOSED', sClosed.rejected.some((x) => x.id === a.id && x.code === 'AUTO_READY_CLOSED'))
  }

  console.log('\n⑦ 🔴 도장 뒤 본문이 바뀌었다 — selector 와 발행 트랜잭션이 모두 막는다')
  {
    const c = await machineRow({ persona: personas[2]!.id })
    await stampAutoReady(prisma, { queueId: c.id, open, now: NOW })
    // 🔴 도장 뒤 다른 경로가 본문을 바꾼 상황
    await prisma.originalPostApprovalQueue.update({ where: { id: c.id }, data: { editedBody: '도장 뒤에 바뀐 본문' } })
    const s = await loadPublishableStock(prisma, NOW, { autoReadyOpen: true })
    check('🔴 🔴 **selector → AUTO_READY_STALE**', s.rejected.some((x) => x.id === c.id && x.code === 'AUTO_READY_STALE'))
    const pr = await publishOriginalPostTx(prisma, { queueId: c.id, publishedToday: 0, dailyCap: 100, autoReadyEnabled: true })
    check('🔴 🔴 **발행 트랜잭션 → AUTO_READY_RECHECK · Post 0**',
      pr.kind === 'blocked' && pr.code === 'AUTO_READY_RECHECK', JSON.stringify(pr))
    check('그 행은 발행되지 않았다', (await prisma.originalPostApprovalQueue.findUnique({ where: { id: c.id } }))?.createdPostId === null)
  }

  console.log('\n⑧ 🔴 발행 — 스위치가 꺼져 있으면 막고, 켜져 있으면 나간다')
  {
    const off = await publishOriginalPostTx(prisma, { queueId: a.id, publishedToday: 0, dailyCap: 100, autoReadyEnabled: false })
    check('🔴 🔴 **스위치 OFF → 도장 행도 발행 안 됨**', off.kind === 'blocked' && off.code === 'AUTO_READY_RECHECK')
    const posts0 = await prisma.post.count()
    const [p1, p2] = await Promise.all([
      publishOriginalPostTx(prisma, { queueId: a.id, publishedToday: 0, dailyCap: 100, autoReadyEnabled: true }),
      publishOriginalPostTx(prisma, { queueId: a.id, publishedToday: 0, dailyCap: 100, autoReadyEnabled: true }),
    ])
    const ok = [p1, p2].filter((x) => x.kind === 'published').length
    check('🔴 🔴 **같은 행을 동시에 발행해도 한 번만 나간다**', ok === 1 && await prisma.post.count() === posts0 + 1,
      `${p1.kind}/${p2.kind}`)
    const row = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: a.id } })
    check('Post 가 만들어지고 큐는 PUBLISHED', row.status === 'PUBLISHED' && row.createdPostId !== null)
  }

  console.log('\n⑨ 🔴 감사 — 정확히 ceil(N×0.2) · 중복 없음 · DB 에 남는다')
  {
    // 자동 발행을 6건까지 늘린다
    for (let i = 0; i < 5; i += 1) {
      const r = await machineRow({ persona: personas[i % 3]!.id })
      await stampAutoReady(prisma, { queueId: r.id, open, now: NOW })
      const p = await publishOriginalPostTx(prisma, { queueId: r.id, publishedToday: 0, dailyCap: 100, autoReadyEnabled: true })
      if (p.kind !== 'published') console.log(`     (발행 실패 ${p.kind})`)
    }
    const n = await prisma.originalPostApprovalQueue.count({ where: { decidedBy: AUTO_DECIDER, createdPostId: { not: null } } })
    const s1 = await selectAudits(prisma)
    check(`🔴 🔴 **자동 발행 ${n}건 → 감사 ceil(${n}×0.2)=${Math.ceil(n / 5)}건 선정**`,
      s1.kind === 'ok' && s1.target === Math.ceil(n / 5) && s1.picked.length === Math.ceil(n / 5), JSON.stringify(s1))
    const s2 = await selectAudits(prisma)
    check('🔴 🔴 **다시 돌려도 더 고르지 않는다 — 중복 0**', s2.kind === 'ok' && s2.picked.length === 0)
    check('🔴 감사 기록이 DB 에 남는다', await prisma.autoReadyAudit.count() === Math.ceil(n / 5))
    /**
     * 🔴 동시 선정 — **목표가 실제로 늘어나는 경계**를 넘겨야 시험이 된다.
     *    6→10 은 목표가 2 그대로라 두 회차 모두 고를 것이 0 이다(첫 판이 그랬다).
     *    6→11 은 목표가 3 이 되어 두 회차가 **같은 1건**을 두고 다툰다.
     */
    for (let i = 0; i < 5; i += 1) {
      const r = await machineRow({ persona: personas[i % 3]!.id })
      await stampAutoReady(prisma, { queueId: r.id, open, now: NOW })
      await publishOriginalPostTx(prisma, { queueId: r.id, publishedToday: 0, dailyCap: 100, autoReadyEnabled: true })
    }
    const n2 = await prisma.originalPostApprovalQueue.count({ where: { decidedBy: AUTO_DECIDER, createdPostId: { not: null } } })
    const before = await prisma.autoReadyAudit.count()
    check('🔴 경계를 넘었다 — 동시 선정이 다툴 1건이 실제로 있다', Math.ceil(n2 / 5) - before === 1, `N=${n2} · 이미 ${before}`)
    const both = await Promise.all([selectAudits(prisma), selectAudits(prisma)])
    const total = await prisma.autoReadyAudit.count()
    check(`🔴 🔴 **두 회차가 동시에 골라도 합계는 정확히 ceil(${n2}×0.2)=${Math.ceil(n2 / 5)}**`,
      total === Math.ceil(n2 / 5), `${total}건 · ${both.map((x) => x.kind === 'ok' ? `ok+${x.picked.length}` : x.kind).join('/')}`)
    const dup = await prisma.$queryRawUnsafe<{ n: bigint }[]>('SELECT COUNT(*) - COUNT(DISTINCT "postId") AS n FROM "AutoReadyAudit"')
    check('🔴 같은 글이 두 번 골리지 않았다', Number(dup[0]?.n ?? 1) === 0)
  }

  console.log('\n⑩ 🔴 결과 기록 — yes 는 끈적하다 · founder 감사자 금지')
  const audited = (await prisma.autoReadyAudit.findFirstOrThrow({ select: { queueId: true } })).queueId
  {
    check('판정 전 대기는 열림을 막지 않는다', (await autoReadyOpenState(prisma, true)).open)
    check('🔴 🔴 **감사자 founder → 거절**',
      await recordAuditResult(prisma, { queueId: audited, defect: 'no', auditor: 'founder', now: NOW }) === 'rejectedAuditor')
    check('no 기록', await recordAuditResult(prisma, { queueId: audited, defect: 'no', auditor: 'codex-master', now: NOW }) === 'recorded')
    check('no → yes 는 된다', await recordAuditResult(prisma, { queueId: audited, defect: 'yes', auditor: 'codex-master', now: NOW }) === 'recorded')
    check('🔴 🔴 **yes → no 는 안 된다 (끈적하다)**',
      await recordAuditResult(prisma, { queueId: audited, defect: 'no', auditor: 'codex-master', now: NOW }) === 'stickyYes')
    check('값은 여전히 yes', (await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: audited } })).defect === 'yes')
    check('고르지 않은 글에는 기록할 수 없다',
      await recordAuditResult(prisma, { queueId: 'nope', defect: 'yes', auditor: 'codex-master', now: NOW }) === 'notSelected')
    let dbBlocked = false
    try {
      await prisma.$executeRawUnsafe(`UPDATE "AutoReadyAudit" SET "auditor"='founder' WHERE "queueId"=$1`, audited)
    } catch { dbBlocked = true }
    check('🔴 DB 제약도 감사자 founder 를 막는다', dbBlocked)
  }

  console.log('\n⑪ 🔴 확정 결함 → 다음 자동 회차가 실제로 닫힌다')
  {
    check('확정 결함 1건', await confirmedDefectCount(prisma) === 1)
    const next = await autoReadyOpenState(prisma, true)
    check('🔴 🔴 **다음 회차 열림 판정 → 닫힘**', !next.open && next.reasons.some((r) => r.includes('확정 결함')), next.reasons.join(' · '))
    const r = await machineRow({ persona: personas[0]!.id })
    check('🔴 🔴 **닫힌 회차는 도장을 찍지 않는다**', (await stampAutoReady(prisma, { queueId: r.id, open: next, now: NOW })).kind === 'closed')
    // 🔴 밖에서 "열림" 을 믿고 들어와도 트랜잭션 안에서 결함을 다시 센다
    const stale = await stampAutoReady(prisma, { queueId: r.id, open: { open: true, reasons: [] }, now: NOW })
    check('🔴 🔴 **밖의 열림을 믿어도 트랜잭션 안에서 닫힌다**', stale.kind === 'closed', JSON.stringify(stale))
    // 결함 전에 찍혀 대기 중이던 도장 행도 발행되지 않는다
    const waiting = await machineRow({ persona: personas[1]!.id })
    await prisma.originalPostApprovalQueue.update({
      where: { id: waiting.id },
      data: {
        decidedBy: AUTO_DECIDER,
        editDiff: { [AUTO_READY_RECORD_KEY]: (await import('../src/lib/auto-ready-v2')).makeStamp(
          (await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: waiting.id } })).draftTitle,
          (await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: waiting.id } })).draftBody, NOW) } as never,
      },
    })
    const pr = await publishOriginalPostTx(prisma, { queueId: waiting.id, publishedToday: 0, dailyCap: 100, autoReadyEnabled: true })
    check('🔴 🔴 **결함 전에 찍힌 도장 행도 발행 트랜잭션에서 막힌다**',
      pr.kind === 'blocked' && pr.code === 'AUTO_READY_RECHECK', JSON.stringify(pr))
  }

  console.log('\n⑫ 🔴 founder 기록 0')
  {
    const founderAfter = await prisma.originalPostApprovalQueue.count({ where: { decidedBy: HUMAN_DECIDER } })
    check('🔴 🔴 **사슬 전체를 돌아도 founder 결정 수가 늘지 않았다**', founderAfter === founderBefore, `${founderBefore} → ${founderAfter}`)
    check('🔴 감사자 founder 0', await prisma.autoReadyAudit.count({ where: { auditor: HUMAN_DECIDER } }) === 0)
  }

  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue",'
    + '"MicroSeedRawContent","Post","Persona","User" CASCADE',
  )
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB 에서만 돌았다 — 운영 DB write 0\n')
  if (fail > 0) process.exit(1)
}

await main()

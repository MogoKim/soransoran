#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 운영자 결함 신고 — 서버 경계 실제 HTTP 검사** (격리 DB + 로컬 `next start` 전용 · 2026-09-27)
 *
 *   화면이 부르는 것과 같은 `Next-Action` 요청을 실제 서버에 보낸다. 세션은 `@auth/core/jwt` 로 만든다
 *   (`auto-ready:evidence-http-check` 와 같은 방식).
 *   · 비로그인 · 비관리자 → DB write 0
 *   · 관리자 → 요청 본문의 신고자·시각·감사자 칸을 버리고 서버가 정한다
 *   · 감사로 뽑히지 않은 auto-ready:v1 글 → 감사 행을 지금 글·도장에 묶어 만들고 결함 yes
 *   · 기록 즉시 확정 결함 수가 늘고 다음 도장·발행이 실제로 닫힌다(격리 DB 에서 실행해 본다)
 *   · 뒤에 온 no(자동 감사 · repo 옛 경계)는 yes 를 덮지 못한다
 *   · 동시 신고 → 결과 정확히 하나
 *
 * 🔴 사람 기록(human:*)은 **관리자 서버 액션으로만** 만든다 — 열림 판정에 필요한 증거 30행의 사람 검토도
 *    증거 서버 액션(`submitEvidenceBatch`)으로 기록한다.
 * 🔴 운영 DB·외부 네트워크 0 — localhost 서버와 격리 Postgres(soran_test)만.
 *
 *   준비: 격리 Postgres · prisma migrate deploy · next build · next start (같은 DATABASE_URL · AUTH_SECRET)
 *   실행: BASE_URL=http://localhost:3995 DATABASE_URL=… SORAN_ISOLATED_DB=yes-throwaway AUTH_SECRET=… \
 *         npm run auto-ready:defect-http-check
 */
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { encode } from '@auth/core/jwt'
import { PrismaClient } from '@prisma/client'

import { digestOf, readStamp } from '../src/lib/auto-ready-v2'
import { authoritativeGate, confirmedDefectCount, recordAuditResult } from '../src/lib/auto-ready-repo'
import {
  ADMIN_DEFECT_AUDITOR, ADMIN_DEFECT_CONTRACT_VERSION, recordCombinedAudit, stampRoundAuditAware,
} from '../src/lib/auto-ready-audit-store'
import { SEMANTIC_AUDIT_MODEL, combineAuditVerdicts, judgeSemantic } from '../src/lib/auto-ready-semantic-audit'
import { publishOriginalPostTx } from '../src/lib/original-post-publish-tx'
import { ruleAuditJudge } from './lib/auto-ready-rule-judge.mjs'
import { makeAuditContextLoader } from './lib/auto-ready-audit-context.mjs'
import {
  requireIsolatedDb, wipeAuditFixtures, newFixture, seedEvidence, autoPublished, selectForAudit, machineRow, type AutoPost,
} from './lib/auto-ready-audit-fixtures.mjs'

requireIsolatedDb()
const BASE = process.env.BASE_URL ?? 'http://localhost:3995'
if (!/^http:\/\/localhost:\d+$/.test(BASE)) { console.error('\n🔴 localhost 가 아니다\n'); process.exit(2) }
const SECRET = process.env.AUTH_SECRET ?? ''
if (SECRET === '') { console.error('\n🔴 AUTH_SECRET 이 필요하다\n'); process.exit(2) }

/** 🔴 action id 는 빌드 산출물에서 찾는다 — 이름으로 계산한 id 가 manifest 에 실제로 있어야 한다 */
const manifest = JSON.parse(readFileSync('.next/server/server-reference-manifest.json', 'utf8')) as {
  node: Record<string, { workers: Record<string, unknown> }>
}
const actionIdOf = (file: string, name: string): string => createHash('sha1').update(`${resolve(file)}:${name}`).digest('hex')
const REPORT = actionIdOf('src/lib/actions/auto-ready-defect-report.ts', 'reportAutoReadyDefect')
const EVIDENCE = actionIdOf('src/lib/actions/auto-ready-evidence.ts', 'submitEvidenceBatch')
const pageIds = Object.entries(manifest.node).filter(([, v]) => Object.keys(v.workers).some((w) => w.includes('admin/auto-ready-defects'))).map(([k]) => k)
if (pageIds.length !== 1 || pageIds[0] !== REPORT) { console.error(`\n🔴 신고 화면의 서버 액션이 신고 하나가 아니다 (${pageIds.join(', ')})\n`); process.exit(2) }
if (manifest.node[EVIDENCE] === undefined) { console.error('\n🔴 증거 제출 액션을 빌드에서 찾지 못했다\n'); process.exit(2) }

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}
const prisma = new PrismaClient()
const ON = { SORAN_AUTO_READY_ENABLED: 'on' } as const
const cookieFor = async (userId: string): Promise<string> =>
  `authjs.session-token=${await encode({ token: { uid: userId, sub: userId }, secret: SECRET, salt: 'authjs.session-token' })}`

type Payload = { error?: string; result?: { result: string; why?: string; created?: boolean; queueId?: string }; results?: { result: string }[] }
const payloadOf = (text: string): Payload | null => {
  for (const line of text.split('\n')) {
    const m = /^[0-9a-f]+:(\{.*\})$/.exec(line)
    if (m === null) continue
    try {
      const v = JSON.parse(m[1]!) as Record<string, unknown>
      if ('result' in v || 'results' in v || 'error' in v) return v as Payload
    } catch { /* 다른 줄 */ }
  }
  return null
}
async function call(path: string, action: string, body: unknown, cookie: string | null): Promise<{ status: number; text: string; payload: Payload | null }> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Next-Action': action, 'Content-Type': 'text/plain;charset=UTF-8', ...(cookie === null ? {} : { cookie }) },
    body: JSON.stringify([body]), redirect: 'manual',
  })
  const text = await res.text()
  return { status: res.status, text, payload: payloadOf(text) }
}
const report = (body: unknown, cookie: string | null) => call('/admin/auto-ready-defects', REPORT, body, cookie)

async function main(): Promise<void> {
  console.log('\n══ 자동 READY 운영자 결함 신고 — 서버 경계 실제 HTTP (격리 DB · localhost) ══\n')
  await wipeAuditFixtures(prisma)
  const home = mkdtempSync(join(tmpdir(), 'soran-defect-http-'))
  const f = newFixture(prisma, home)
  const admin = await prisma.user.create({ data: { nickname: '신고관리자', isAdmin: true }, select: { id: true } })
  const plain = await prisma.user.create({ data: { nickname: '일반회원' }, select: { id: true } })
  const adminCookie = await cookieFor(admin.id)
  const auditOf = (queueId: string) => prisma.autoReadyAudit.findUnique({ where: { queueId } })

  console.log('① 기준선 — 증거 30행의 사람 검토를 증거 서버 액션으로 기록 → 열림')
  {
    const ev = await seedEvidence(f, 30, { reviewed: false })
    const bundleText = JSON.stringify({ items: ev.map((e) => ({ queueId: e.queueId, draft: { titleDigest: digestOf(e.title), bodyDigest: digestOf(e.body) } })) })
    const r = await call('/admin/auto-ready-evidence', EVIDENCE, { bundleText, entries: ev.map((e) => ({ queueId: e.queueId, hardDefect: 'no' })) }, adminCookie)
    const ok = r.payload?.results?.filter((x) => x.result === 'recorded').length ?? 0
    check('증거 서버 액션 — 30행 기록', r.status === 200 && ok === 30, r.text.slice(0, 300))
    const g = await authoritativeGate(prisma, ON)
    check('🔴 열림 판정 — 증거 30 · 결함 0 → 열림 (양성 대조)', g.open, g.reasons.join(' · '))
  }

  const A = await autoPublished(f, { personaCode: 'P01', title: '뽑히지 않은 글', body: '뽑히지 않은 글 이야기예요. 다들 어떠세요?', sourceTitle: 'a', sourceBody: 'a 이야기' })
  const B = await autoPublished(f, { personaCode: 'P02', title: '감사 대기 글', body: '감사 대기 글 이야기예요. 다들 어떠세요?', sourceTitle: 'b', sourceBody: 'b 이야기' })
  const C = await autoPublished(f, { personaCode: 'P04', title: '결함 없음 판정 글', body: '결함 없음 판정 글이에요. 다들 어떠세요?', sourceTitle: 'c', sourceBody: 'c 이야기' })
  const D = await autoPublished(f, { personaCode: 'P06', title: '동시 신고 글', body: '동시 신고 글 이야기예요. 다들 어떠세요?', sourceTitle: 'd', sourceBody: 'd 이야기' })
  await selectForAudit(f, B)
  await selectForAudit(f, C)
  const noJudge = async (p: AutoPost) => {
    const post = await prisma.post.findUniqueOrThrow({ where: { id: p.postId } })
    const q = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: p.queueId } })
    const rule = await ruleAuditJudge({ queueId: p.queueId, postId: p.postId, title: post.title, body: post.content, stamp: readStamp(q.editDiff) })
    const sem = await judgeSemantic(await makeAuditContextLoader(prisma, { artifactDir: f.artifactDir })({ queueId: p.queueId, postId: p.postId }), {
      model: SEMANTIC_AUDIT_MODEL, complete: async () => ({ ok: true, text: JSON.stringify({ unsupportedFacts: [], lifeContradictions: [], sourceDistortions: [], defect: 'no' }) }),
    })
    return combineAuditVerdicts(rule, sem)
  }
  check('선행 — C 는 자동 감사가 결함 없음(no)으로 기록', await recordCombinedAudit(prisma, { queueId: C.queueId, combined: await noJudge(C), auditor: 'model:semantic-audit:t', now: f.now }) === 'recorded')
  const w = await machineRow(f, 'W11')
  const st = await stampRoundAuditAware(prisma, { env: ON, now: f.now })
  check('선행 — 신고 전 도장 회차가 찍는다 (양성 대조)', (st.get('stamped') ?? 0) === 1, [...st].map(([k, v]) => `${k} ${v}`).join(' '))

  console.log('\n② 🔴 🔴 인증 경계 — 비로그인 · 비관리자 → write 0')
  {
    const page = await fetch(`${BASE}/admin/auto-ready-defects`)
    check('비로그인 화면 → 접근 권한 없음', (await page.text()).includes('접근 권한이 없습니다'))
    const body = { postId: A.postId, reasons: ['생활사 모순'] }
    const anon = await report(body, null)
    check('🔴 🔴 **비로그인 신고 → 감사 행 0 · 확정 결함 0**', (await auditOf(A.queueId)) === null && await confirmedDefectCount(prisma) === 0, `status ${anon.status}`)
    const non = await report(body, await cookieFor(plain.id))
    check('🔴 🔴 **비관리자 신고 → 권한 없음 · 감사 행 0 · 확정 결함 0**',
      (await auditOf(A.queueId)) === null && await confirmedDefectCount(prisma) === 0 && non.payload?.error === '권한이 없습니다.', non.text.slice(0, 200))
    const adminPage = await (await fetch(`${BASE}/admin/auto-ready-defects`, { headers: { cookie: adminCookie } })).text()
    check('관리자 화면 — 자동 발행 글과 신고 버튼이 보인다', adminPage.includes('뽑히지 않은 글') && adminPage.includes('결함 신고'))
  }

  console.log('\n③ 🔴 🔴 관리자 신고 — 뽑히지 않은 auto-ready:v1 글 → 감사 행 생성 · 결함 yes · 서버가 신고자를 정한다')
  {
    const forged = { postId: A.postId, reasons: ['남편 이야기 — 카드는 비혼'], auditor: 'founder', userId: plain.id, reviewer: 'human:founder', judgedAt: '2099-01-01T00:00:00Z', defect: 'no' }
    const t0 = Date.now()
    const r = await report(forged, adminCookie)
    const t1 = Date.now()
    const a = await auditOf(A.queueId)
    const post = await prisma.post.findUniqueOrThrow({ where: { id: A.postId } })
    const q = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: A.queueId } })
    check('🔴 🔴 **뽑히지 않은 글 → recorded · 감사 행을 새로 만들었다**', r.payload?.result?.result === 'recorded' && r.payload.result.created === true && a !== null, r.text.slice(0, 300))
    check('🔴 🔴 **결함 yes · 감사자 human:operator (요청의 founder 무시) · 신고자 = 관리자 세션 User.id (요청의 userId 무시)**',
      a?.defect === 'yes' && a.auditor === ADMIN_DEFECT_AUDITOR && (a.note ?? '').includes(`userId=${admin.id}`) && !(a.note ?? '').includes(plain.id), `${a?.defect} · ${a?.auditor} · ${a?.note}`)
    const at = a?.judgedAt?.getTime() ?? NaN
    check('🔴 🔴 **판정 시각 = 서버 시각 (요청의 2099 무시)**', at >= t0 - 1000 && at <= t1 + 1000, String(a?.judgedAt?.toISOString()))
    check('🔴 🔴 **지금 글 hash · 지금 도장 계약 판에 묶였다**', a?.postId === A.postId && a.publishedTitleHash === digestOf(post.title)
      && a.publishedBodyHash === digestOf(post.content) && a.stampContractDigest === readStamp(q.editDiff)?.contractDigest && a.auditContractVersion === ADMIN_DEFECT_CONTRACT_VERSION)
    check('🔴 🔴 **기록 즉시 확정 결함 수가 늘었다 (0 → 1)**', await confirmedDefectCount(prisma) === 1)
  }

  console.log('\n④ 🔴 🔴 다음 자동 회차가 실제로 닫힌다')
  {
    const g = await authoritativeGate(prisma, ON)
    check('🔴 🔴 **열림 판정 → 닫힘(확정 결함)**', !g.open && g.reasons.some((x) => x.includes('확정 결함')), g.reasons.join(' · '))
    const w2 = await machineRow(f, 'W12')
    const t = await stampRoundAuditAware(prisma, { env: ON, now: f.now })
    check('🔴 🔴 **다음 도장 회차 → 도장 0**', (t.get('stamped') ?? 0) === 0
      && (await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: w2.id } })).decidedBy === 'machine:auto-draft-v5')
    const before = await prisma.post.count()
    const p = await publishOriginalPostTx(prisma, { queueId: w.id, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })
    check('🔴 🔴 **신고 전에 찍힌 도장 행 → 발행 트랜잭션이 막는다 · Post 0**',
      p.kind === 'blocked' && p.code === 'AUTO_READY_RECHECK' && (await prisma.post.count()) === before, JSON.stringify(p))
  }

  console.log('\n⑤ 🔴 🔴 뒤에 온 no 는 yes 를 덮지 못한다 · no 는 yes 로 올린다')
  {
    const lateNo = await noJudge(A)
    check('🔴 🔴 **자동 감사의 no → alreadyJudged · yes 그대로**',
      await recordCombinedAudit(prisma, { queueId: A.queueId, combined: lateNo, auditor: 'model:semantic-audit:late', now: f.now }) === 'alreadyJudged' && (await auditOf(A.queueId))?.defect === 'yes')
    check('🔴 repo 옛 경계의 no → stickyYes · yes 그대로',
      await recordAuditResult(prisma, { queueId: A.queueId, verdict: lateNo.kind === 'final' ? lateNo.verdict : lateNo.rule, auditor: 'rule-auditor', now: f.now }) === 'stickyYes' && (await auditOf(A.queueId))?.defect === 'yes')
    const again = await report({ postId: A.postId, reasons: ['다시'] }, adminCookie)
    check('같은 글 재신고 → alreadyDefect · 기록 그대로', again.payload?.result?.result === 'alreadyDefect' && ((await auditOf(A.queueId))?.note ?? '').includes('카드는 비혼'))
    const up = await report({ postId: C.postId, reasons: ['원문에 없는 금액'] }, adminCookie)
    const c = await auditOf(C.queueId)
    check('🔴 🔴 **자동 감사가 no 로 기록한 글 → 운영자 신고가 yes 로 올린다**', up.payload?.result?.result === 'recorded' && c?.defect === 'yes' && c.auditor === ADMIN_DEFECT_AUDITOR, up.text.slice(0, 200))
    const pend = await report({ postId: B.postId, reasons: ['원문 왜곡'] }, adminCookie)
    check('감사 대기 글 → recorded(행 재사용) · yes', pend.payload?.result?.result === 'recorded' && pend.payload.result.created === false && (await auditOf(B.queueId))?.defect === 'yes')
  }

  console.log('\n⑥ 🔴 대상 · 근거')
  {
    const human = await prisma.originalPostApprovalQueue.findFirstOrThrow({ where: { decidedBy: 'founder', createdPostId: { not: null } } })
    const nr = await report({ postId: human.createdPostId, reasons: ['x'] }, adminCookie)
    check('🔴 🔴 **auto-ready:v1 글이 아니면 거절 · 감사 행 0**', nr.payload?.result?.result === 'reject' && (await auditOf(human.id)) === null, nr.text.slice(0, 200))
    const empty = await report({ postId: D.postId, reasons: [' '] }, adminCookie)
    check('🔴 근거가 비면 거절 · 감사 행 0', empty.payload?.result?.result === 'reject' && (await auditOf(D.queueId)) === null)
    const none = await report({ postId: 'no-such-post', reasons: ['x'] }, adminCookie)
    check('없는 글 → 거절', none.payload?.result?.result === 'reject')
  }

  console.log('\n⑦ 🔴 🔴 동시 신고 — 결과 정확히 하나')
  {
    const reqs = await Promise.all(Array.from({ length: 4 }, (_, i) => report({ postId: D.postId, reasons: [`동시 ${i}`] }, adminCookie)))
    const kinds = reqs.map((x) => x.payload?.result?.result ?? x.payload?.error ?? `status ${x.status}`)
    const rows = await prisma.autoReadyAudit.count({ where: { postId: D.postId } })
    const d = await auditOf(D.queueId)
    const winner = kinds.indexOf('recorded')
    check('🔴 🔴 **동시 네 신고(뽑히지 않은 글) → recorded 정확히 1 · 나머지 alreadyDefect · 감사 행 1 · 이긴 요청의 근거가 남는다**',
      kinds.filter((k) => k === 'recorded').length === 1 && kinds.filter((k) => k === 'alreadyDefect').length === 3 && rows === 1
      && d?.defect === 'yes' && (d.note ?? '').includes(`동시 ${winner}`), `${kinds.join(',')} · rows ${rows} · ${d?.note}`)
    check('🔴 감사 표의 사람 기록은 전부 서버 액션이 만든 것이다(human:operator · 관리자 userId)',
      (await prisma.autoReadyAudit.findMany({ where: { auditor: { startsWith: 'human:' } } })).every((x) => x.auditor === ADMIN_DEFECT_AUDITOR && (x.note ?? '').includes(`userId=${admin.id}`)))
  }

  await wipeAuditFixtures(prisma)
  await prisma.$disconnect()
  rmSync(home, { recursive: true, force: true })
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB · localhost 에서만 돌았다 — 운영 DB write 0\n')
  if (fail > 0) process.exit(1)
}

await main()

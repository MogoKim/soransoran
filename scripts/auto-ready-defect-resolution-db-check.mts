#!/usr/bin/env tsx
/**
 * 🔴 **확정 결함 해소 — 격리 Postgres 실행 검사** (2026-10-01 · Lane E)
 *
 *   운영과 같은 모양의 결함(옛 계약 행 · 기계 의미 감사 yes · 원문의 만남을 1인칭으로 옮긴 초안)을 만들고,
 *   정본 쓰기 경로(`planDefectResolution` → `applyDefectResolution`)와 운영 러너(`auto-ready-defect-resolve.mts`)를
 *   그대로 돌려 열림 게이트(`authoritativeGate`)와 결함 축(`unresolvedDefectCount`)을 본다.
 *   · 감사 행은 해소 전후로 한 칸도 바뀌지 않는다(행 전체 지문)
 *   · 미해소 결함은 닫는다 · 재검증 실패 · 다른 행 · 다른 digest · 불완전한 기록은 해소하지 못한다
 *   · 계획과 적용 사이에 바뀌면 write 0 · 두 번째 적용 write 0 · 동시 적용은 정확히 1
 *   · 지금 계약 행의 새 결함은 옛 해소와 무관하게 닫는다
 *
 * 🔴 운영 DB 에 붙지 않는다(sentinel · localhost · soran_test). 임시 HOME 아래 artifact 정본만 쓴다.
 *
 *   DATABASE_URL=… DIRECT_URL=… SORAN_ISOLATED_DB=yes-throwaway npm run auto-ready:defect-resolution-db-check
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient, type Prisma } from '@prisma/client'

import { AUDIT_CONTRACT_VERSION } from '../src/lib/auto-ready-v2'
import { authoritativeGate, unresolvedDefectCount } from '../src/lib/auto-ready-repo'
import { applyDefectResolution, planDefectResolution, type ResolutionPlan } from '../src/lib/auto-ready-defect-resolution-store'
import { DEFECT_RESOLUTION_KEY, auditFingerprintOf } from '../src/lib/auto-ready-defect-resolution'
import { SEMANTIC_AUDIT_CONTRACT_VERSION } from '../src/lib/auto-ready-semantic-audit'
import { QUALITY_CONTRACT_KEY, currentQualityContract } from '../src/lib/quality-contract'
import { applyApprovedDefectResolution } from './lib/defect-resolution-approval.mjs'
import { makeReverifyContextLoader } from './lib/defect-reverify-context.mjs'
import { LIFE_FIXTURES } from './lib/life-gate-fixtures.mjs'
import { FIXTURE_NOW } from './lib/draft-gate-fixtures.mjs'
import {
  requireIsolatedDb, wipeAuditFixtures, newFixture, seedEvidence, autoPublished, selectForAudit, flushArtifacts,
  type AutoPost, type Fixture,
} from './lib/auto-ready-audit-fixtures.mjs'

requireIsolatedDb()

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else { fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`) }
}
const ON = { SORAN_AUTO_READY_ENABLED: 'on' } as const
const ROOT = process.cwd()
const TSX = join(ROOT, 'node_modules/.bin/tsx')
const RUNNER = join(ROOT, 'scripts/auto-ready-defect-resolve.mts')
const SCRATCH = mkdtempSync(join(tmpdir(), 'soran-defect-resolve-'))
const LEGACY_MARK = { version: 'quality-v4', digest: '379bf6c61fe1431f928da2e44cde0731fdf1850a301b0c808378a6875be47daa' }
const BLOCKED = LIFE_FIXTURES.find((x) => x.queueId === 'counter-v6-peer-observation')!
const PASSING = LIFE_FIXTURES.find((x) => x.queueId === 'control-v6-peer-third-party')!

const rec = (v: unknown): Record<string, unknown> =>
  (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})
const stableJson = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x !== null && typeof x === 'object' && !Array.isArray(x)
    ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort()) : x))

/**
 * 🔴 **운영 결함과 같은 모양의 행** — 발행된 auto-ready:v1 글 · 감사 선정 · 기계 의미 감사 yes(측정됨).
 *    `legacy` 면 품질 계약 표식을 옛 판(v4)으로 둔다(운영 행과 같다). artifact 에 운영 계획 칸 · 생성 시각 · 후보 시각을 싣는다.
 */
async function defectRow(f: Fixture, fx: typeof BLOCKED, o: { legacy: boolean }): Promise<AutoPost> {
  const a = await autoPublished(f, { personaCode: 'P04', title: fx.draft.title, body: fx.draft.body, sourceTitle: fx.source.title, sourceBody: fx.source.body })
  const art = f.artifacts.find((x) => x.artifactId === a.artifactId)!
  art.plan = { personaCode: 'P04', stance: 'QUESTION', selfBasis: null, warrants: [], closingIntent: 'ask', contentRoles: ['conversationSpark'], protectedFacts: [] }
  art.generatedAt = FIXTURE_NOW.toISOString()
  const cand = f.candidates.find((x) => x.artifactId === a.artifactId)!
  cand.sourcePostedAt = FIXTURE_NOW.toISOString()
  cand.sourceCapturedAt = FIXTURE_NOW.toISOString()
  flushArtifacts(f)
  if (o.legacy) {
    const q = await f.prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: a.queueId }, select: { gateResults: true } })
    await f.prisma.originalPostApprovalQueue.update({
      where: { id: a.queueId }, data: { gateResults: { ...rec(q.gateResults), [QUALITY_CONTRACT_KEY]: LEGACY_MARK } as Prisma.InputJsonValue },
    })
  }
  await selectForAudit(f, a)
  await f.prisma.autoReadyAudit.update({
    where: { queueId: a.queueId },
    data: {
      defect: 'yes', judgedAt: f.now, auditor: 'model:semantic-audit:runner',
      note: `[${SEMANTIC_AUDIT_CONTRACT_VERSION} outcome=measured binding=fx artifact=${a.artifactId} persona=P04 card=fx] 결함 fixture`,
      auditContractVersion: AUDIT_CONTRACT_VERSION, auditModel: 'rule:integrity-safety-audit+claude-haiku-4.5',
      auditPromptVersion: 'integrity-safety-v1+semantic-audit-prompt-v1',
    },
  })
  return a
}

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 확정 결함 해소 — 격리 DB · 정본 쓰기 경로 · 운영 러너 ══\n')
  const home = join(SCRATCH, 'home')
  mkdirSync(home, { recursive: true })
  const auditTable = async (): Promise<string> => stableJson(await prisma.autoReadyAudit.findMany({ orderBy: { queueId: 'asc' } }))
  const fpOf = async (queueId: string): Promise<string> => auditFingerprintOf(await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId } }))
  const queueOf = (id: string) => prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id }, select: { editDiff: true, updatedAt: true, gateResults: true } })
  const gate = () => authoritativeGate(prisma, ON)

  await wipeAuditFixtures(prisma)
  const f = newFixture(prisma, home)
  const contextOf = makeReverifyContextLoader({ artifactDir: f.artifactDir })
  await seedEvidence(f, 30)
  check('기준선 — 결함 0 · 증거 30 → 열림', (await gate()).open && await unresolvedDefectCount(prisma) === 0, (await gate()).reasons.join(' · '))

  console.log('\n① 운영과 같은 결함 — 미해소면 닫힌다')
  const A = await defectRow(f, BLOCKED, { legacy: true })
  const g1 = await gate()
  check('🔴 🔴 **미해소 확정 결함 1 → 닫힘**', !g1.open && g1.reasons.some((r) => r.includes('미해소 확정 결함 1건')) && await unresolvedDefectCount(prisma) === 1, g1.reasons.join(' · '))

  console.log('\n② 계획(dry-run) — 쓰지 않는다')
  const before = await auditTable()
  const qBefore = await queueOf(A.queueId)
  const p1 = await planDefectResolution(prisma, { queueId: A.queueId, contextOf, now: new Date() })
  check('🔴 계획 — 지금 게이트가 저장 초안을 확정 차단(unwarrantedSelfClaim)', p1.kind === 'plan' && p1.plan.record.reverify.failureCodes.includes('unwarrantedSelfClaim'), JSON.stringify(p1).slice(0, 300))
  const qAfterPlan = await queueOf(A.queueId)
  check('🔴 계획은 write 0 — 큐 행 · 감사 표 그대로', stableJson(qAfterPlan) === stableJson(qBefore) && await auditTable() === before)
  check('계획만으로는 여전히 닫힘', !(await gate()).open)

  console.log('\n③ 계획과 적용 사이에 바뀌면 write 0')
  if (p1.kind === 'plan') {
    // 큐 행이 바뀌었다(다른 쓰기 — 배정 시각 갱신)
    await prisma.originalPostApprovalQueue.update({ where: { id: A.queueId }, data: { matchedAt: new Date() } })
    const qMid = await queueOf(A.queueId)
    const c1 = await applyDefectResolution(prisma, { plan: p1.plan, contextOf, now: new Date() })
    check('🔴 🔴 **계획 뒤 큐 행이 바뀌었다 → changed · write 0**', c1.kind === 'changed' && c1.written === 0 && stableJson(await queueOf(A.queueId)) === stableJson(qMid), JSON.stringify(c1))
    // 감사 행이 바뀌었다(격리 DB 에서 일부러 — 동시에 다른 쓰기가 감사 행을 건드린 상황)
    const p2 = await planDefectResolution(prisma, { queueId: A.queueId, contextOf, now: new Date() })
    const savedNote = (await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: A.queueId } })).note
    await prisma.autoReadyAudit.update({ where: { queueId: A.queueId }, data: { note: `${savedNote} (동시 변경)` } })
    const c2 = p2.kind === 'plan' ? await applyDefectResolution(prisma, { plan: p2.plan, contextOf, now: new Date() }) : null
    check('🔴 🔴 **계획 뒤 감사 행이 바뀌었다 → changed · write 0**', c2?.kind === 'changed' && c2.written === 0
      && resolutionsOf((await queueOf(A.queueId)).editDiff).length === 0, JSON.stringify(c2))
    await prisma.autoReadyAudit.update({ where: { queueId: A.queueId }, data: { note: savedNote } })
    // 원천 artifact 의 계획이 바뀌었다(재검증 입력이 다르다)
    const p3 = await planDefectResolution(prisma, { queueId: A.queueId, contextOf, now: new Date() })
    const art = f.artifacts.find((x) => x.artifactId === A.artifactId)!
    const savedPlan = art.plan
    art.plan = { ...rec(savedPlan), closingIntent: 'share' }
    flushArtifacts(f)
    const c3 = p3.kind === 'plan' ? await applyDefectResolution(prisma, { plan: p3.plan, contextOf, now: new Date() }) : null
    check('🔴 계획 뒤 재검증 입력이 바뀌었다 → changed · write 0', c3?.kind === 'changed' && c3.written === 0, JSON.stringify(c3))
    art.plan = savedPlan
    flushArtifacts(f)
  }

  console.log('\n④ 적용 — 기록하고 열린다 · 감사 행은 한 칸도 바뀌지 않는다')
  const auditBefore = await auditTable()
  const fpBefore = await fpOf(A.queueId)
  const p4 = await planDefectResolution(prisma, { queueId: A.queueId, contextOf, now: new Date() })
  const a4 = p4.kind === 'plan' ? await applyDefectResolution(prisma, { plan: p4.plan, contextOf, now: new Date() }) : null
  check('🟢 적용 → written 1', a4?.kind === 'written' && a4.written === 1, JSON.stringify(a4))
  check('🔴 🔴 **감사 표 전체가 그대로(행 전체 지문 · 원래 결함 기록 보존)**', await auditTable() === auditBefore && await fpOf(A.queueId) === fpBefore)
  const qA = await queueOf(A.queueId)
  const recs = resolutionsOf(qA.editDiff)
  check('🔴 기록 한 줄 — 지금 계약 · 이 감사 지문 · 차단 코드', recs.length === 1
    && stableJson(rec(recs[0]).qualityContract) === stableJson(currentQualityContract())
    && rec(rec(recs[0]).audit).fingerprint === fpBefore, stableJson(recs).slice(0, 300))
  check('🔴 큐 행의 도장 · 품질 표식은 그대로', stableJson(rec(qA.editDiff).autoReady) === stableJson(rec(qBefore.editDiff).autoReady)
    && stableJson(rec(qA.gateResults)[QUALITY_CONTRACT_KEY]) === stableJson(LEGACY_MARK))
  const g4 = await gate()
  check('🟢 🟢 **해소 → 결함 축 0 · 열림**', g4.open && await unresolvedDefectCount(prisma) === 0, g4.reasons.join(' · '))

  console.log('\n⑤ 두 번째 적용 · 다시 계획 → write 0')
  const qSnap = stableJson(await queueOf(A.queueId))
  const a5 = p4.kind === 'plan' ? await applyDefectResolution(prisma, { plan: p4.plan, contextOf, now: new Date() }) : null
  const p5 = await planDefectResolution(prisma, { queueId: A.queueId, contextOf, now: new Date() })
  check('🔴 🔴 **같은 계획을 두 번째 적용 → already · write 0**', a5?.kind === 'already' && a5.written === 0 && stableJson(await queueOf(A.queueId)) === qSnap, JSON.stringify(a5))
  check('🔴 다시 계획 → already(쓸 것이 없다)', p5.kind === 'already')

  console.log('\n⑥ 🔴 기록이 어긋나면 다시 닫힌다(fail-closed) — 격리 DB 에서 기록을 일부러 바꾼다')
  const original = (await queueOf(A.queueId)).editDiff
  const withRecord = async (mut: (r: Record<string, unknown>) => Record<string, unknown>): Promise<boolean> => {
    const r0 = rec(resolutionsOf(original)[0])
    await prisma.originalPostApprovalQueue.update({
      where: { id: A.queueId }, data: { editDiff: { ...rec(original), [DEFECT_RESOLUTION_KEY]: [mut(r0)] } as Prisma.InputJsonValue },
    })
    const open = (await gate()).open
    await prisma.originalPostApprovalQueue.update({ where: { id: A.queueId }, data: { editDiff: original as Prisma.InputJsonValue } })
    return open
  }
  check('🔴 다른 품질 계약 digest → 닫힘', !await withRecord((r) => ({ ...r, qualityContract: { ...rec(r.qualityContract), digest: 'b'.repeat(64) } })))
  check('🔴 다른 품질 계약 판 → 닫힘', !await withRecord((r) => ({ ...r, qualityContract: { ...rec(r.qualityContract), version: 'quality-v5' } })))
  check('🔴 불완전한 기록(재검증 칸 없음) → 닫힘', !await withRecord((r) => { const { reverify: _drop, ...rest } = r; return rest }))
  check('🔴 재검증 실패로 적힌 기록(failureCodes 0) → 닫힘', !await withRecord((r) => ({ ...r, reverify: { ...rec(r.reverify), failureCodes: [] } })))
  check('🔴 다른 감사 행 id → 닫힘', !await withRecord((r) => ({ ...r, audit: { ...rec(r.audit), queueId: 'other-queue' } })))
  check('대조 — 원래 기록으로 돌리면 열림', (await gate()).open)
  {
    const savedNote = (await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: A.queueId } })).note
    await prisma.autoReadyAudit.update({ where: { queueId: A.queueId }, data: { note: `${savedNote} (사후 변경)` } })
    check('🔴 🔴 **해소 뒤 감사 행이 바뀌면(지문 불일치) → 다시 닫힘**', !(await gate()).open)
    await prisma.autoReadyAudit.update({ where: { queueId: A.queueId }, data: { note: savedNote } })
    check('대조 — 감사 행을 되돌리면 열림', (await gate()).open)
  }

  console.log('\n⑦ 🔴 다른 행 · 재검증 실패 · 지금 계약의 새 결함')
  {
    const B = await defectRow(f, BLOCKED, { legacy: true })
    // A 의 기록을 B 에 그대로 옮긴다 — 다른 감사 행의 기록은 B 를 해소하지 못한다
    const qB = await queueOf(B.queueId)
    await prisma.originalPostApprovalQueue.update({
      where: { id: B.queueId }, data: { editDiff: { ...rec(qB.editDiff), [DEFECT_RESOLUTION_KEY]: resolutionsOf(original) } as Prisma.InputJsonValue },
    })
    check('🔴 🔴 **다른 감사 행(A)의 기록을 B 에 복사 → B 미해소 · 닫힘**', !(await gate()).open && await unresolvedDefectCount(prisma) === 1)
    const pB = await planDefectResolution(prisma, { queueId: B.queueId, contextOf, now: new Date() })
    const aB = pB.kind === 'plan' ? await applyDefectResolution(prisma, { plan: pB.plan, contextOf, now: new Date() }) : null
    check('🟢 B 도 자기 재검증으로 해소하면 열림 (복사된 줄은 남고 자기 줄이 덧붙는다)', aB?.kind === 'written' && (await gate()).open
      && resolutionsOf((await queueOf(B.queueId)).editDiff).length === 2, JSON.stringify(aB))

    const P = await defectRow(f, PASSING, { legacy: true })
    const before7 = stableJson(await queueOf(P.queueId))
    const pP = await planDefectResolution(prisma, { queueId: P.queueId, contextOf, now: new Date() })
    check('🔴 🔴 **재검증 실패(지금 게이트가 그 초안을 막지 않는다) → refuse NOT_BLOCKED · write 0 · 닫힘**',
      pP.kind === 'refuse' && pP.code === 'NOT_BLOCKED' && stableJson(await queueOf(P.queueId)) === before7 && !(await gate()).open, JSON.stringify(pP))
    const runP = spawnSync(TSX, [RUNNER, `--queue=${P.queueId}`, '--apply'], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' })
    check('🔴 운영 러너 --apply 도 재검증 실패면 write 0 · exit≠0', runP.status !== 0 && /refuse code=NOT_BLOCKED/.test(runP.stdout)
      && stableJson(await queueOf(P.queueId)) === before7, runP.stdout.slice(0, 200))
    // 재검증 실패 행을 치운다(격리 DB 고정물) — 다음 반례를 위해
    await prisma.autoReadyAudit.delete({ where: { queueId: P.queueId } })
    check('대조 — 재검증 실패 행을 치우면 열림', (await gate()).open)

    const N = await defectRow(f, BLOCKED, { legacy: false })
    check('🔴 🔴 **지금 계약 행의 새 결함 → 옛 해소와 무관하게 닫힘**', !(await gate()).open && await unresolvedDefectCount(prisma) === 1)
    const pN = await planDefectResolution(prisma, { queueId: N.queueId, contextOf, now: new Date() })
    check('🔴 지금 계약 행은 해소 대상이 아니다 → refuse NOT_RESOLVABLE · write 0', pN.kind === 'refuse' && pN.code === 'NOT_RESOLVABLE', JSON.stringify(pN))
    // 지금 계약 행에 "맞아 보이는" 기록을 손으로 넣어도 — 미해소
    const aN = await prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId: N.queueId } })
    const forged = { ...rec(resolutionsOf(original)[0]), audit: { queueId: N.queueId, postId: N.postId, fingerprint: auditFingerprintOf(aN) } }
    const qN = await queueOf(N.queueId)
    await prisma.originalPostApprovalQueue.update({
      where: { id: N.queueId }, data: { editDiff: { ...rec(qN.editDiff), [DEFECT_RESOLUTION_KEY]: [forged] } as Prisma.InputJsonValue },
    })
    check('🔴 🔴 **지금 계약 행에 맞춰 만든 기록을 넣어도 → 미해소 · 닫힘**', !(await gate()).open && await unresolvedDefectCount(prisma) === 1)
    await prisma.autoReadyAudit.delete({ where: { queueId: N.queueId } })
  }

  console.log('\n⑧ 동시 적용 — 정확히 1')
  {
    const D = await defectRow(f, BLOCKED, { legacy: true })
    const pD = await planDefectResolution(prisma, { queueId: D.queueId, contextOf, now: new Date() })
    if (pD.kind === 'plan') {
      const outs = await Promise.all([0, 1, 2].map(() => applyDefectResolution(prisma, { plan: pD.plan as ResolutionPlan, contextOf, now: new Date() })))
      const written = outs.reduce((s, o) => s + o.written, 0)
      check('🔴 🔴 **세 적용이 동시에 → 합계 write 정확히 1 · 기록 1줄**', written === 1 && resolutionsOf((await queueOf(D.queueId)).editDiff).length === 1,
        outs.map((o) => o.kind).join(','))
    } else check('동시 적용 계획', false, JSON.stringify(pD))
  }

  console.log('\n⑨ 운영 러너 — dry-run 기본 · 운영 주소 --apply 거절 · 격리 DB --apply')
  {
    const E = await defectRow(f, BLOCKED, { legacy: true })
    const snap = stableJson(await queueOf(E.queueId))
    const dry = spawnSync(TSX, [RUNNER, `--queue=${E.queueId}`], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' })
    check('🔴 dry-run(기본) → exit 0 · written=0 · 큐 그대로', dry.status === 0 && /RESOLVE_APPLY skipped \(dry-run\) written=0/.test(dry.stdout)
      && stableJson(await queueOf(E.queueId)) === snap, dry.stdout.slice(0, 300) + dry.stderr.slice(0, 200))
    const prod = spawnSync(TSX, [RUNNER, `--queue=${E.queueId}`, '--apply'], {
      cwd: ROOT, encoding: 'utf8',
      env: { ...process.env, HOME: home, DATABASE_URL: 'postgresql://u@db.example.invalid:5432/postgres', DIRECT_URL: 'postgresql://u@db.example.invalid:5432/postgres', SORAN_ISOLATED_DB: '' },
    })
    check('🔴 🔴 **운영 주소로 --apply → exit 2 · 접속 전 거절(write 0)**', prod.status === 2 && /운영 적용은 범위 밖/.test(prod.stderr)
      && stableJson(await queueOf(E.queueId)) === snap, `${prod.status} ${prod.stderr.slice(0, 200)}`)
    const ap = spawnSync(TSX, [RUNNER, `--queue=${E.queueId}`, '--apply'], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' })
    check('🟢 격리 DB --apply → written=1', ap.status === 0 && /RESOLVE_APPLY written written=1/.test(ap.stdout), ap.stdout.slice(0, 300))
    const ap2 = spawnSync(TSX, [RUNNER, `--queue=${E.queueId}`, '--apply'], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' })
    check('🔴 다시 --apply → already · 기록 1줄', ap2.status === 0 && /RESOLVE_PLAN already/.test(ap2.stdout)
      && resolutionsOf((await queueOf(E.queueId)).editDiff).length === 1, ap2.stdout.slice(0, 300))
    check('🟢 모든 결함이 지금 계약으로 해소됐다 → 열림', (await gate()).open && await unresolvedDefectCount(prisma) === 0)
  }

  console.log('\n⑩ 운영 승인 결속(Phase G) — digest · expect · reason · 원본 불변 · 재실행 no-op · 동시 1')
  {
    const F = await defectRow(f, BLOCKED, { legacy: true })
    const fullQueue = (id: string) => prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id } })
    const postOf = (id: string) => prisma.post.findUniqueOrThrow({ where: { id } })
    const snapAll = async (): Promise<string> => stableJson({ audit: await auditTable(), q: await fullQueue(F.queueId), post: await postOf(F.postId) })
    const dryOf = () => spawnSync(TSX, [RUNNER, `--queue=${F.queueId}`], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' })
    const approvalLine = (out: string): { digest: string; expect: string } | null => {
      const m = /RESOLVE_APPROVAL digest=([0-9a-f]{64}) expect=(\d+:\d+)/.exec(out)
      return m === null ? null : { digest: m[1]!, expect: m[2]! }
    }
    const d1 = approvalLine(dryOf().stdout)
    const d2 = approvalLine(dryOf().stdout)
    check('🔴 dry-run 이 결정적 digest · expect 를 낸다(두 번 같다 · 1:0)', d1 !== null && d2 !== null && d1.digest === d2.digest && d1.expect === '1:0', JSON.stringify([d1, d2]))
    const s0 = await snapAll()
    const ap = (digest: string, before: number, after: number, reason = 'phase-g db-check') =>
      applyApprovedDefectResolution(prisma, { queueId: F.queueId, approval: { digest, expected: { before, after }, reason }, contextOf, now: new Date() })
    const wrongDigest = await ap('0'.repeat(64), 1, 0)
    check('🔴 다른 digest → PLAN_STALE · write 0', wrongDigest.kind === 'refuse' && wrongDigest.code === 'PLAN_STALE' && await snapAll() === s0)
    for (const [b, a] of [[1, 1], [0, 0], [2, 1]] as const) {
      const r = await ap(d1!.digest, b, a)
      check(`🔴 다른 expect ${b}:${a} → EXPECTATION_MISMATCH · write 0`, r.kind === 'refuse' && r.code === 'EXPECTATION_MISMATCH' && await snapAll() === s0)
    }
    const noReason = await ap(d1!.digest, 1, 0, '  ')
    check('🔴 빈 reason → write 0', noReason.kind === 'refuse' && await snapAll() === s0)
    // 계획 뒤 큐 행이 바뀌었다 → 승인 digest 가 낡았다
    await prisma.originalPostApprovalQueue.update({ where: { id: F.queueId }, data: { matchedAt: new Date() } })
    const s1 = await snapAll()
    const stale = await ap(d1!.digest, 1, 0)
    check('🔴 계획 뒤 바뀜 → PLAN_STALE · write 0', stale.kind === 'refuse' && stale.code === 'PLAN_STALE' && await snapAll() === s1)
    const fresh = approvalLine(dryOf().stdout)!
    const qPrev = await fullQueue(F.queueId)
    const auditPrev = await auditTable()
    const postPrev = stableJson(await postOf(F.postId))
    const ok = await ap(fresh.digest, 1, 0)
    check('🟢 fresh digest · 1:0 · reason → written 1 · 미해소 0', ok.kind === 'written' && ok.after === 0 && await unresolvedDefectCount(prisma) === 0, JSON.stringify(ok))
    const qNow = await fullQueue(F.queueId)
    const strays = Object.keys(qPrev).filter((k) => k !== 'editDiff' && k !== 'updatedAt'
      && stableJson((qPrev as Record<string, unknown>)[k]) !== stableJson((qNow as Record<string, unknown>)[k]))
    const edPrev = rec(qPrev.editDiff)
    const edNow = rec(qNow.editDiff)
    const otherKeys = Object.keys({ ...edPrev, ...edNow }).filter((k) => k !== DEFECT_RESOLUTION_KEY
      && stableJson(edPrev[k]) !== stableJson(edNow[k]))
    const prevArr = resolutionsOf(qPrev.editDiff)
    const nowArr = resolutionsOf(qNow.editDiff)
    check(`🔴 🔴 **원본 불변 — 감사 표 · 글 · 큐의 다른 칸(${strays.length}) · editDiff 다른 키(${otherKeys.length}) 그대로**`,
      await auditTable() === auditPrev && stableJson(await postOf(F.postId)) === postPrev && strays.length === 0 && otherKeys.length === 0, [...strays, ...otherKeys].join(','))
    check('🔴 🔴 **해소 기록은 append-only — 앞 기록 그대로 + 정확히 1줄 추가**',
      nowArr.length === prevArr.length + 1 && stableJson(nowArr.slice(0, prevArr.length)) === stableJson(prevArr))
    const s2 = await snapAll()
    const again = await ap(fresh.digest, 1, 0)
    check('🔴 같은 승인 재실행 → no-op · write 0', again.kind === 'noop' && again.written === 0 && await snapAll() === s2, JSON.stringify(again))

    const G = await defectRow(f, BLOCKED, { legacy: true })
    const gLine = approvalLine(spawnSync(TSX, [RUNNER, `--queue=${G.queueId}`], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' }).stdout)!
    const [ex0, ex1] = gLine.expect.split(':').map(Number)
    const outs = await Promise.all([0, 1, 2].map(() => applyApprovedDefectResolution(prisma, {
      queueId: G.queueId, approval: { digest: gLine.digest, expected: { before: ex0!, after: ex1! }, reason: 'phase-g 동시' }, contextOf, now: new Date(),
    })))
    check('🔴 🔴 **승인 적용 셋이 동시에 → write 정확히 1 · 기록 1줄**', outs.reduce((n, o) => n + o.written, 0) === 1
      && resolutionsOf((await queueOf(G.queueId)).editDiff).length === 1, outs.map((o) => o.kind).join(','))

    // 운영 플래그 — 격리 env 가 켜져 있거나 SHA 가 다르면 DB 에 붙기 전에 거부
    const H = await defectRow(f, BLOCKED, { legacy: true })
    const hLine = approvalLine(spawnSync(TSX, [RUNNER, `--queue=${H.queueId}`], { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' }).stdout)!
    const sH = stableJson(await fullQueue(H.queueId))
    const prodArgs = [RUNNER, `--queue=${H.queueId}`, '--apply', '--production', `--target=${'a'.repeat(40)}`, `--digest=${hLine.digest}`, `--expect=${hLine.expect}`, '--reason=db-check']
    const p1r = spawnSync(TSX, prodArgs, { cwd: ROOT, env: { ...process.env, HOME: home }, encoding: 'utf8' })
    check('🔴 운영 플래그 + 격리 env → exit 2 · write 0', p1r.status === 2 && /SORAN_ISOLATED_DB/.test(p1r.stderr) && stableJson(await fullQueue(H.queueId)) === sH, p1r.stderr.slice(0, 200))
    const p2r = spawnSync(TSX, prodArgs, { cwd: ROOT, env: { ...process.env, HOME: home, SORAN_ISOLATED_DB: '' }, encoding: 'utf8' })
    check('🔴 운영 플래그 + SHA 불일치 → exit 2 · write 0', p2r.status === 2 && /≠ target|읽지 못했다/.test(p2r.stderr) && stableJson(await fullQueue(H.queueId)) === sH, p2r.stderr.slice(0, 300))
    for (const bad of [
      [RUNNER, `--queue=${H.queueId}`, '--apply', '--production', `--digest=${hLine.digest}`, `--expect=${hLine.expect}`, '--reason=x'],
      [RUNNER, `--queue=${H.queueId}`, '--apply', '--production', `--target=${'a'.repeat(40)}`, `--expect=${hLine.expect}`, '--reason=x'],
      [RUNNER, `--queue=${H.queueId}`, '--apply', '--production', `--target=${'a'.repeat(40)}`, `--digest=${hLine.digest}`, '--reason=x'],
      [RUNNER, `--queue=${H.queueId}`, '--apply', '--production', `--target=${'a'.repeat(40)}`, `--digest=${hLine.digest}`, `--expect=${hLine.expect}`],
      [RUNNER, `--queue=${H.queueId}`, '--production', `--target=${'a'.repeat(40)}`],
    ]) {
      const r = spawnSync(TSX, bad, { cwd: ROOT, env: { ...process.env, HOME: home, SORAN_ISOLATED_DB: '' }, encoding: 'utf8' })
      check(`🔴 운영 인자 누락(${bad.slice(2).map((a) => a.split('=')[0]).join(' ')}) → exit 2 · write 0`, r.status === 2 && stableJson(await fullQueue(H.queueId)) === sH, r.stderr.slice(0, 160))
    }
  }

  await wipeAuditFixtures(prisma)
  await prisma.$disconnect()
  rmSync(SCRATCH, { recursive: true, force: true })
  console.log(`\n결과: ${pass} 통과 · ${fail} 실패\n`)
  process.exit(fail === 0 ? 0 : 1)
}

function resolutionsOf(editDiff: unknown): unknown[] {
  const v = rec(editDiff)[DEFECT_RESOLUTION_KEY]
  return Array.isArray(v) ? v : []
}

main().catch((e: unknown) => { console.error(e); process.exit(1) })

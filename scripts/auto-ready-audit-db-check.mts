#!/usr/bin/env tsx
/**
 * 🔴 **자동 READY 독립 감사 루프 — 격리 Postgres 실행 검사** (2026-09-27)
 *
 *   발행된 auto-ready:v1 글 → 감사 선정 → **실제 감사 러너 프로세스**(규칙 + 의미 · 공급 장부 · 가짜 제공사)
 *   → 결과 저장 → 결함 yes → 다음 도장(`stampRoundAuditAware`)·발행(`publishOriginalPostTx`)이 닫힌다.
 *   판정 대기 시한 초과도 도장·발행을 닫고, 감사가 끝나면 다시 연다.
 *
 * 🔴 러너는 **운영 스크립트 그대로** 띄운다(`scripts/auto-ready-audit.mts --apply`). 가짜는 네트워크 한 곳
 *    (`fake-provider-hook` 이 `fetch` 를 가로챈다)뿐이다 — 장부·예산·정산은 실제 코드가 돈다.
 *    임시 HOME — artifact 정본 · 잠금 · 장부가 전부 그 아래다. 운영 자산·장부 0.
 * 🔴 운영 DB 에 붙지 않는다(sentinel · localhost · soran_test). 주소를 찍지 않는다.
 * 🔴 사람 기록(human:*)을 감사 표에 만들지 않는다 — 운영자 신고는 `auto-ready:defect-http-check` 가 서버 액션으로 본다.
 *
 *   DATABASE_URL=… DIRECT_URL=… SORAN_ISOLATED_DB=yes-throwaway npm run auto-ready:audit-db-check
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PrismaClient } from '@prisma/client'

import { AUDIT_CONTRACT_VERSION, AUTO_DECIDER, digestOf, readStamp, type AuditVerdict } from '../src/lib/auto-ready-v2'
import { authoritativeGate, confirmedDefectCount, recordAuditResult, selectAudits } from '../src/lib/auto-ready-repo'
import {
  AUDIT_OVERDUE_MS, auditAwareGate, recordCombinedAudit, runCombinedAuditRound, stampRoundAuditAware,
} from '../src/lib/auto-ready-audit-store'
import {
  SEMANTIC_AUDIT_MODEL, SEMANTIC_AUDIT_CONTRACT_VERSION, SEMANTIC_AUDIT_PROMPT_VERSION, bindingDigestOf,
  combineAuditVerdicts, judgeSemantic, semanticBindingOf, type SemanticAuditProvider, type SemanticVerdict,
} from '../src/lib/auto-ready-semantic-audit'
import { publishOriginalPostTx } from '../src/lib/original-post-publish-tx'
import { ruleAuditJudge } from './lib/auto-ready-rule-judge.mjs'
import { makeAuditContextLoader } from './lib/auto-ready-audit-context.mjs'
import { AUDIT_LOCK_FILE, auditLockDir } from './lib/auto-ready-audit-template'
import { BUDGET_ENV } from './lib/supply-llm-call.mjs'
import {
  requireIsolatedDb, wipeAuditFixtures, newFixture, seedEvidence, autoPublished, selectForAudit, machineRow,
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
const HOOK = join(ROOT, 'scripts/lib/fake-provider-hook.mjs')
const RUNNER = join(ROOT, 'scripts/auto-ready-audit.mts')
const SCRATCH = mkdtempSync(join(tmpdir(), 'soran-audit-db-'))

type RunOut = { code: number; out: string; paid: number; count: number; bodies: string[] }

/**
 * 🔴 **운영 러너를 그대로 띄운다.** 임시 HOME · 임시 cwd · 가짜 키 · 가짜 네트워크.
 *    `paid: false` 면 유료 스위치를 주지 않는다(운영 기본값).
 */
function runRunner(home: string, o: { paid?: boolean; budget?: boolean; env?: Record<string, string>; enabled?: boolean } = {}): Promise<RunOut> {
  const log = join(home, `fake-${Date.now()}-${Math.random().toString(16).slice(2)}.log`)
  const bodyLog = `${log}.bodies`
  const cwd = join(home, 'cwd')
  mkdirSync(cwd, { recursive: true })
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? '', HOME: home,
    DATABASE_URL: process.env.DATABASE_URL ?? '', DIRECT_URL: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
    ...(o.enabled === false ? {} : { SORAN_AUTO_READY_ENABLED: 'on' }),
    NODE_OPTIONS: `--import=${HOOK}`, FAKE_PROVIDER_LOG: log, FAKE_PROVIDER_BODY_LOG: bodyLog,
    ANTHROPIC_API_KEY: 'fixture-fake-key',
    ...(o.paid === false ? {} : { SORAN_AUTO_READY_SEMANTIC_PAID: 'on' }),
    ...(o.budget === false ? {} : { [BUDGET_ENV.dailyUsd]: '5', [BUDGET_ENV.runRequestCap]: '200', [BUDGET_ENV.headroomMultiplier]: '1.5' }),
    ...(o.env ?? {}),
  }
  return new Promise((resolve) => {
    const c = spawn(TSX, [RUNNER, '--apply'], { cwd, env })
    let out = ''
    c.stdout.on('data', (d: Buffer) => { out += d.toString() })
    c.stderr.on('data', (d: Buffer) => { out += d.toString() })
    c.on('close', (code) => {
      const lines = existsSync(log) ? readFileSync(log, 'utf-8').split('\n').filter((l) => l !== '') : []
      const bodies = existsSync(bodyLog) ? readFileSync(bodyLog, 'utf-8').split('\n').filter((l) => l !== '') : []
      resolve({ code: code ?? -1, out, paid: lines.filter((l) => l.startsWith('paid')).length, count: lines.filter((l) => l.startsWith('count')).length, bodies })
    })
  })
}
const roundOf = (out: string): Record<string, number> => {
  const m = /AUDIT_ROUND pending=(\d+) semanticCalls=(\d+) · (.*)$/m.exec(out)
  if (m === null) return {}
  const r: Record<string, number> = { pending: Number(m[1]), semanticCalls: Number(m[2]) }
  for (const part of m[3]!.split(' · ')) { const [k, v] = part.trim().split(' '); if (k !== undefined && v !== undefined) r[k] = Number(v) }
  return r
}
const newHome = (tag: string): string => { const h = join(SCRATCH, tag); mkdirSync(h, { recursive: true }); return h }

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 자동 READY 독립 감사 루프 — 격리 DB · 실제 러너 프로세스 · 가짜 네트워크 ══\n')
  await wipeAuditFixtures(prisma)
  const home = newHome('main')
  const f: Fixture = newFixture(prisma, home)
  const audit = (queueId: string) => prisma.autoReadyAudit.findUniqueOrThrow({ where: { queueId } })
  const postCount = () => prisma.post.count()
  const pubTx = (queueId: string) => publishOriginalPostTx(prisma, { queueId, publishedToday: 0, mode: { kind: 'manual-live', dailyCap: 100 }, autoReadyEnv: ON })

  console.log('① 스위치 OFF · 판정 전 0 — 제공사 호출 0')
  {
    const off = await runRunner(newHome('off'), { enabled: false })
    check('🔴 스위치 OFF → exit 0 · 제공사 0 · 표를 읽지 않는다', off.code === 0 && off.paid === 0 && off.count === 0 && off.out.includes('꺼져 있다'), off.out.slice(0, 200))
    const zero = await runRunner(newHome('zero'))
    check('🔴 🔴 **판정 전 0 → exit 0 · 제공사 호출 0 (사전 계산 0 · 유료 0)**',
      zero.code === 0 && zero.paid === 0 && zero.count === 0 && zero.out.includes('판정 전 0건'), `${zero.code} · paid ${zero.paid} · count ${zero.count} · ${zero.out.slice(0, 200)}`)
    check('🔴 OFF 이면 회차 함수도 표를 읽지 않는다', (await runCombinedAuditRound(prisma, {
      env: {}, now: f.now, auditor: 'model:semantic-audit:t', ruleJudge: ruleAuditJudge,
      loadContext: async () => ({ ok: false, code: 'X', reason: 'x' }), provider: { model: SEMANTIC_AUDIT_MODEL, complete: async () => ({ ok: false, code: 'X', reason: 'x' }) },
    })).kind === 'off')
  }

  await seedEvidence(f)
  const g0 = await authoritativeGate(prisma, ON)
  check('기준선 — 증거 30 · 결함 0 → 열림', g0.open, g0.reasons.join(' · '))

  console.log('\n② 🔴 판정 대기 시한 — 감사 러너가 멈추면 도장·발행이 닫히고, 감사가 끝나면 다시 열린다')
  const w1 = await machineRow(f, 'W01')
  const w2 = await machineRow(f, 'W02')
  {
    const t0 = await stampRoundAuditAware(prisma, { env: ON, now: f.now })
    check('기준선 — 시한 초과 0 → 도장 회차가 찍는다 (기계 행 둘)', (t0.get('stamped') ?? 0) === 2, [...t0].map(([k, v]) => `${k} ${v}`).join(' '))
    const late = await autoPublished(f, { personaCode: 'P04', title: '장 보러 다녀온 이야기', body: '오늘은 시장에 다녀왔어요. 다들 장 보실 때 어디로 가세요?', sourceTitle: '시장 이야기', sourceBody: '요즘 시장 물가가 올랐다는 이야기' })
    await selectForAudit(f, late, new Date(f.now.getTime() - AUDIT_OVERDUE_MS - 3600_000))
    const w3 = await machineRow(f, 'W03')
    const ga = await auditAwareGate(prisma, ON, f.now)
    check('🔴 🔴 **시한을 넘긴 판정 대기 1건 → 열림 판정 닫힘(사유에 시한)**', !ga.open && ga.reasons.some((r) => r.includes('시간을 넘긴 감사 1건')), ga.reasons.join(' · '))
    check('🔴 정본 열림 판정(repo)은 그대로 열림 — 시한은 repo 밖에서 더한 판정이다', (await authoritativeGate(prisma, ON)).open)
    const t1 = await stampRoundAuditAware(prisma, { env: ON, now: f.now })
    check('🔴 🔴 **시한 초과 → 도장 회차 closed · 도장 0**',
      (t1.get('stamped') ?? 0) === 0 && (t1.get('closed') ?? 0) >= 1
      && (await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: w3.id } })).decidedBy === 'machine:auto-draft-v5',
      [...t1].map(([k, v]) => `${k} ${v}`).join(' '))
    const before = await postCount()
    const p1 = await pubTx(w1.id)
    check('🔴 🔴 **시한 초과 → 이미 찍힌 도장 행도 발행 트랜잭션이 막는다 · Post 0**',
      p1.kind === 'blocked' && p1.code === 'AUTO_READY_RECHECK' && p1.detail.includes('시간을 넘긴 감사') && (await postCount()) === before, JSON.stringify(p1))
    // 🔴 시한 안(1시간 전)으로 돌리면 다시 열린다 — 대기 자체는 막지 않는다(repo 계약 그대로)
    await prisma.autoReadyAudit.update({ where: { queueId: late.queueId }, data: { selectedAt: new Date(f.now.getTime() - 3600_000) } })
    const p2 = await pubTx(w2.id)
    check('🔴 **시한 안의 판정 대기는 막지 않는다 — 도장 행 발행 (양성 대조)**', p2.kind === 'published', JSON.stringify(p2))
    await prisma.autoReadyAudit.update({ where: { queueId: late.queueId }, data: { selectedAt: new Date(f.now.getTime() - AUDIT_OVERDUE_MS - 3600_000) } })
    // 🔴 감사 러너가 따라잡는다 — 실제 러너 프로세스
    const run = await runRunner(home)
    const la = await audit(late.queueId)
    check('감사 러너가 시한 초과 감사를 판정했다 (결함 없음)', run.code === 0 && la.defect === 'no', `${run.code} · ${la.defect} · ${la.note} · ${run.out.slice(-300)}`)
    check('🔴 🔴 **감사가 끝나면 다시 열린다 — 시한은 끈적하지 않다**', (await auditAwareGate(prisma, ON, f.now)).open)
    const p3 = await pubTx(w1.id)
    check('🔴 **다시 열린 뒤 이전에 막혔던 도장 행이 발행된다**', p3.kind === 'published', JSON.stringify(p3))
  }

  console.log('\n③ 🔴 🔴 실제 러너 — 규칙 + 의미 감사 · 원문 근거와 카드에 묶인 판정 · fail-closed')
  const posts: Record<string, AutoPost> = {}
  {
    posts.clean = await autoPublished(f, { personaCode: 'P01', title: '아침 산책', body: '아침에 공원을 한 바퀴 걸었어요. 다들 어떤 운동 하세요?', sourceTitle: '산책 이야기', sourceBody: '아침 산책이 좋다는 이야기' })
    posts.supported = await autoPublished(f, { personaCode: 'P02', title: '집값 이야기', body: '동네 집이 5억에 나왔대요. 다들 어떻게 생각하세요?', sourceTitle: '집값', sourceBody: '우리 동네 아파트가 5억 에 나왔다는 글' })
    posts.life = await autoPublished(f, { personaCode: 'P15', title: '저녁 이야기', body: '남편이 오늘 저녁을 차려 줬어요. 다들 저녁 뭐 드셨어요?', sourceTitle: '저녁 메뉴', sourceBody: '저녁 메뉴 고민' })
    posts.fact = await autoPublished(f, { personaCode: 'P06', title: '용돈 이야기', body: '아이 용돈으로 50만 원을 줬어요. 다들 얼마 주세요?', sourceTitle: '용돈', sourceBody: '아이 용돈을 얼마 줘야 할지 고민' })
    posts.noArtifact = await autoPublished(f, { personaCode: 'P07', title: '빨래 이야기', body: '오늘 빨래가 잘 말랐어요. 다들 건조기 쓰세요?', sourceTitle: '빨래', sourceBody: '빨래 이야기', artifact: 'missing' })
    posts.otherPersona = await autoPublished(f, { personaCode: 'P12', title: '화분 이야기', body: '베란다 화분에 꽃이 폈어요. 다들 식물 키우세요?', sourceTitle: '화분', sourceBody: '화분 이야기', artifact: 'otherPersona' })
    posts.noCard = await autoPublished(f, { personaCode: 'X99', title: '비 오는 날', body: '비가 와서 집에 있었어요. 다들 뭐 하세요?', sourceTitle: '비', sourceBody: '비 오는 날 이야기' })
    posts.noEvidence = await autoPublished(f, { personaCode: 'P13', title: '뜨개질', body: '뜨개질을 다시 시작했어요. 다들 취미 있으세요?', sourceTitle: '뜨개', sourceBody: '뜨개질', artifact: 'noEvidence' })
    for (const a of Object.values(posts)) await selectForAudit(f, a)
    // 🔴 실제 `selectAudits` 경로도 한 번 — 자동 발행 N 의 ceil(N×0.2) 까지(이미 고른 것 포함) 고르고 hash 를 묶는다
    const sel = await selectAudits(prisma)
    check('실제 selectAudits 도 같은 표에 선정을 남긴다(이미 고른 행은 다시 고르지 않는다)', sel.kind === 'ok' && sel.picked.every((q) => !Object.values(posts).some((p) => p.queueId === q)), JSON.stringify(sel))
    const pendingBefore = await prisma.autoReadyAudit.count({ where: { defect: null } })
    const run = await runRunner(home)
    const r = roundOf(run.out)
    check('러너 exit 0 · 판정 전 전부 기록', run.code === 0 && (await prisma.autoReadyAudit.count({ where: { defect: null } })) === 0, `${run.code} · ${run.out.slice(-400)}`)
    check('🔴 🔴 **의미 감사 유료 요청 = 문맥이 선 감사 수 (장부 경유 · 사전 계산 1:1)**',
      run.paid === pendingBefore - 4 && run.count === run.paid && r.semanticCalls === pendingBefore - 4, `paid ${run.paid} · count ${run.count} · pending ${pendingBefore} · ${JSON.stringify(r)}`)
    const ledgerDir = join(home, 'Library', 'Application Support', 'soransoran')
    const ledgerLines = readdirSync(ledgerDir, { recursive: true }).map(String).filter((x) => x.endsWith('.jsonl'))
      .flatMap((x) => readFileSync(join(ledgerDir, x), 'utf-8').split('\n').filter((l) => l !== ''))
    check('🔴 🔴 **요청은 공급 장부를 지났다 — semanticAudit 단계 · 정산 기록**',
      ledgerLines.some((l) => l.includes('"stage":"semanticAudit"') && l.includes('"status":"settled"')), `${ledgerLines.length}줄`)
    check('🔴 🔴 **나간 요청마다 원문 근거와 글쓴이 카드가 실렸다 (묶음이 요청에 있다)**',
      run.bodies.length > 0 && run.bodies.every((b) => b.includes('원문근거') && b.includes('글쓴이카드') && b.includes('maritalStatus')), `${run.bodies.length}건`)
    const c = await audit(posts.clean!.queueId)
    check('🔴 🔴 **깨끗한 글 → no · 모델·프롬프트 칸에 규칙 + 의미 둘 다 · 감사자는 사람이 아니다**',
      c.defect === 'no' && (c.auditModel ?? '').includes('rule:integrity-safety-audit') && (c.auditModel ?? '').includes(SEMANTIC_AUDIT_MODEL)
      && (c.auditPromptVersion ?? '').includes(SEMANTIC_AUDIT_PROMPT_VERSION) && !(c.auditor ?? '').startsWith('human:') && c.auditor !== 'founder',
      `${c.defect} · ${c.auditModel} · ${c.auditor}`)
    const ctx = await makeAuditContextLoader(prisma, { artifactDir: f.artifactDir })({ queueId: posts.clean!.queueId, postId: posts.clean!.postId })
    check('🔴 🔴 **결과 note 에 묶음 digest 가 전부 남는다 — 글 · 도장 · artifact 근거 · 카드에서 다시 계산한 값과 같다**',
      ctx.ok && (c.note ?? '').includes(`binding=${semanticBindingOf(ctx.ctx).digest}`), c.note ?? '')
    check('🔴 원문 근거에 있는 금액은 결함이 아니다 (가짜 모델이 요청의 원문 근거를 본다)', (await audit(posts.supported!.queueId)).defect === 'no', (await audit(posts.supported!.queueId)).note ?? '')
    const life = await audit(posts.life!.queueId)
    check('🔴 🔴 **Persona 카드와 생활사 모순(비혼 카드 · 남편) → yes**', life.defect === 'yes' && (life.note ?? '').includes('생활사 모순'), life.note ?? '')
    const fact = await audit(posts.fact!.queueId)
    check('🔴 🔴 **원문 근거에 없는 사실(금액) → yes**', fact.defect === 'yes' && (fact.note ?? '').includes('근거 없는 사실'), fact.note ?? '')
    for (const k of ['noArtifact', 'otherPersona', 'noCard', 'noEvidence'] as const) {
      const a = await audit(posts[k]!.queueId)
      check(`🔴 🔴 **[${k}] 문맥 결속 실패 → no 가 아니라 yes(측정 불가)**`, a.defect === 'yes' && (a.note ?? '').includes('측정 불가'), `${a.defect} · ${a.note}`)
    }
  }

  console.log('\n④ 🔴 🔴 결함 yes → 다음 도장·발행이 실제로 닫힌다')
  {
    check('확정 결함 ≥ 1', await confirmedDefectCount(prisma) >= 1)
    const g = await authoritativeGate(prisma, ON)
    check('🔴 🔴 **정본 열림 판정 → 닫힘(확정 결함)**', !g.open && g.reasons.some((x) => x.includes('확정 결함')), g.reasons.join(' · '))
    const fresh = await machineRow(f, 'W04')
    const t = await stampRoundAuditAware(prisma, { env: ON, now: f.now })
    check('🔴 🔴 **다음 도장 회차 → 도장 0**', (t.get('stamped') ?? 0) === 0
      && (await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: fresh.id } })).decidedBy === 'machine:auto-draft-v5', [...t].map(([k, v]) => `${k} ${v}`).join(' '))
    // 🔴 결함 전에 찍힌 도장 행 — ②에서 막혔던 w3 는 도장이 없다. 결함 전 찍힌 w2 는 발행됐다. 새로 하나를 결함 전 상태로 만든다
    const pre = await machineRow(f, 'W05')
    const row = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: pre.id } })
    const { makeStamp, AUTO_READY_RECORD_KEY } = await import('../src/lib/auto-ready-v2')
    await prisma.originalPostApprovalQueue.update({ where: { id: pre.id }, data: { decidedBy: AUTO_DECIDER, editDiff: { [AUTO_READY_RECORD_KEY]: makeStamp(row.draftTitle, row.draftBody, f.now) } as never } })
    const before = await postCount()
    const p = await pubTx(pre.id)
    check('🔴 🔴 **도장 행도 발행 트랜잭션에서 막힌다 · Post 0**', p.kind === 'blocked' && p.code === 'AUTO_READY_RECHECK' && p.detail.includes('확정 결함') && (await postCount()) === before, JSON.stringify(p))
  }

  console.log('\n⑤ 🔴 🔴 yes 는 끈적하다 · 결과는 감사마다 하나')
  const scripted = (text: string): SemanticAuditProvider => ({ model: SEMANTIC_AUDIT_MODEL, complete: async () => ({ ok: true, text }) })
  const CLEAN = JSON.stringify({ unsupportedFacts: [], lifeContradictions: [], sourceDistortions: [], defect: 'no' })
  const combinedFor = async (a: AutoPost, provider = scripted(CLEAN)) => {
    const post = await prisma.post.findUniqueOrThrow({ where: { id: a.postId } })
    const q = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: a.queueId } })
    const rule = await ruleAuditJudge({ queueId: a.queueId, postId: a.postId, title: post.title, body: post.content, stamp: readStamp(q.editDiff) })
    // 🔴 로더는 회차마다 새로 만든다(운영 러너도 회차마다 만든다) — 색인을 한 번 읽어 둔다
    const fresh = makeAuditContextLoader(prisma, { artifactDir: f.artifactDir })
    return combineAuditVerdicts(rule, await judgeSemantic(await fresh({ queueId: a.queueId, postId: a.postId }), provider))
  }
  {
    const life = posts.life!
    const lateNo = await combinedFor(posts.clean!)
    const r1 = await recordCombinedAudit(prisma, { queueId: life.queueId, combined: { ...lateNo, verdict: { ...lateNo.verdict, judgedTitleHash: digestOf(life.title), judgedBodyHash: digestOf(life.body) } }, auditor: 'model:semantic-audit:late', now: f.now })
    check('🔴 🔴 **뒤에 온 자동 no 는 yes 를 덮지 못한다 (alreadyJudged)**', r1 === 'alreadyJudged' && (await audit(life.queueId)).defect === 'yes', r1)
    const rule = await ruleAuditJudge({ queueId: life.queueId, postId: life.postId, title: life.title, body: life.body, stamp: readStamp((await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id: life.queueId } })).editDiff) })
    const r2 = await recordAuditResult(prisma, { queueId: life.queueId, verdict: { ...rule, defect: 'no', reasons: [] }, auditor: 'rule-auditor', now: f.now })
    check('🔴 repo 의 옛 저장 경계도 yes → no 를 거절한다 (stickyYes)', r2 === 'stickyYes' && (await audit(life.queueId)).defect === 'yes', r2)
    check('🔴 사람 종류 감사자는 자동 경로로 기록할 수 없다', await recordCombinedAudit(prisma, { queueId: life.queueId, combined: lateNo, auditor: 'human:operator', now: f.now }) === 'rejectedAuditor')

    // 동시 — 같은 감사에 다섯 회차가 동시에 쓴다
    const a = await autoPublished(f, { personaCode: 'P17', title: '가을 옷장', body: '옷장 정리를 했어요. 다들 가을옷 꺼내셨어요?', sourceTitle: '옷장', sourceBody: '옷장 정리' })
    await selectForAudit(f, a)
    const cmb = await combinedFor(a)
    const outs = await Promise.all(Array.from({ length: 5 }, (_, i) => recordCombinedAudit(prisma, { queueId: a.queueId, combined: cmb, auditor: `model:semantic-audit:c${i}`, now: new Date(f.now.getTime() + i) })))
    const saved = await audit(a.queueId)
    check('🔴 🔴 **동시 기록 다섯 → recorded 정확히 1 · 나머지는 alreadyJudged/race · 기록한 감사자 = 저장된 감사자**',
      outs.filter((o) => o === 'recorded').length === 1 && outs.every((o) => ['recorded', 'alreadyJudged', 'race'].includes(o))
      && saved.auditor === `model:semantic-audit:c${outs.indexOf('recorded')}`, `${outs.join(',')} · ${saved.auditor}`)

    // 동시 회차 둘(프로세스 안) — 판정 전 셋을 두 회차가 함께 본다
    const three: AutoPost[] = []
    for (const [i, code] of ['P18', 'P19', 'P20'].entries()) {
      const p = await autoPublished(f, { personaCode: code, title: `동시 이야기 ${i}`, body: `오늘 동시 이야기 ${i} 를 적어요. 다들 어떠세요?`, sourceTitle: '동시', sourceBody: '동시 이야기' })
      await selectForAudit(f, p); three.push(p)
    }
    const round = (tag: string) => runCombinedAuditRound(prisma, { env: ON, now: f.now, auditor: `model:semantic-audit:${tag}`, ruleJudge: ruleAuditJudge, loadContext: makeAuditContextLoader(prisma, { artifactDir: f.artifactDir }), provider: scripted(CLEAN) })
    const [ra, rb] = await Promise.all([round('A'), round('B')])
    const rec = (r: typeof ra) => (r.kind === 'ok' ? r.tally.get('recorded') ?? 0 : 0)
    check('🔴 🔴 **동시 회차 둘 → 감사마다 결과 정확히 하나 (recorded 합 = 3 · 판정 전 0)**',
      rec(ra) + rec(rb) === 3 && (await prisma.autoReadyAudit.count({ where: { queueId: { in: three.map((x) => x.queueId) }, defect: null } })) === 0,
      `A ${ra.kind === 'ok' ? [...ra.tally].join(' ') : 'off'} · B ${rb.kind === 'ok' ? [...rb.tally].join(' ') : 'off'}`)
  }

  console.log('\n⑥ 🔴 🔴 실제 러너 둘을 동시에 — 결과는 감사마다 하나 · 잠금이 두 번째를 물린다')
  {
    const four: AutoPost[] = []
    for (const [i, code] of ['P21', 'P22', 'P23', 'P24'].entries()) {
      const p = await autoPublished(f, { personaCode: code, title: `프로세스 이야기 ${i}`, body: `오늘 프로세스 이야기 ${i}. 다들 어떠세요?`, sourceTitle: '프로세스', sourceBody: '프로세스 이야기' })
      await selectForAudit(f, p); four.push(p)
    }
    // 🔴 잠금을 나누지 않는 두 러너(다른 HOME — artifact 정본은 같은 내용을 복사)
    const h2 = newHome('second')
    const art2 = join(h2, 'Library', 'Application Support', 'soransoran', 'microseed-data')
    mkdirSync(art2, { recursive: true })
    for (const n of readdirSync(f.artifactDir)) writeFileSync(join(art2, n), readFileSync(join(f.artifactDir, n)))
    const [x, y] = await Promise.all([runRunner(home), runRunner(h2)])
    const rx = roundOf(x.out)
    const ry = roundOf(y.out)
    const judged = await prisma.autoReadyAudit.findMany({ where: { queueId: { in: four.map((p) => p.queueId) } } })
    check('🔴 🔴 **다른 잠금의 두 러너 프로세스 동시 → recorded 합 = 4 · 판정 전 0 · 각 감사 기록 1**',
      x.code === 0 && y.code === 0 && (rx.recorded ?? 0) + (ry.recorded ?? 0) === 4 && judged.every((j) => j.defect !== null),
      `x ${JSON.stringify(rx)} · y ${JSON.stringify(ry)} · ${x.out.slice(-200)} · ${y.out.slice(-200)}`)
    // 🔴 같은 잠금 — 살아 있는 잠금이 있으면 뒤 회차는 DB·제공사 0 으로 물러난다
    const five = await autoPublished(f, { personaCode: 'P25', title: '잠금 이야기', body: '잠금 이야기를 적어요. 다들 어떠세요?', sourceTitle: '잠금', sourceBody: '잠금 이야기' })
    await selectForAudit(f, five)
    mkdirSync(auditLockDir(home), { recursive: true })
    writeFileSync(join(auditLockDir(home), AUDIT_LOCK_FILE), JSON.stringify({ token: 'other', pid: 1, at: new Date().toISOString() }))
    const held = await runRunner(home)
    check('🔴 🔴 **같은 잠금을 쥔 회차가 있으면 → LOCK_HELD · exit 0 · 제공사 0 · 기록 0**',
      held.code === 0 && held.out.includes('LOCK_HELD') && held.paid === 0 && held.count === 0 && (await audit(five.queueId)).defect === null, held.out.slice(0, 200))
    writeFileSync(join(auditLockDir(home), AUDIT_LOCK_FILE), JSON.stringify({ token: 'other', pid: 1, at: new Date(Date.now() - 3 * 3600_000).toISOString() }))
    const stale = await runRunner(home)
    check('🔴 죽은 잠금은 뺏지 않는다 — exit 1 · 기록 0 (사람이 치운다)', stale.code === 1 && (await audit(five.queueId)).defect === null, stale.out.slice(0, 200))
    rmSync(join(auditLockDir(home), AUDIT_LOCK_FILE))
    const after = await runRunner(home)
    check('잠금을 치우면 다음 회차가 판정한다 · 잠금이 남지 않는다', after.code === 0 && (await audit(five.queueId)).defect === 'no' && !existsSync(join(auditLockDir(home), AUDIT_LOCK_FILE)), after.out.slice(-200))
  }

  console.log('\n⑦ 🔴 🔴 모델 오류는 결코 no 가 아니다 — 실제 러너 · 모드별')
  {
    const cases: { tag: string; opt: Parameters<typeof runRunner>[1]; expectPaid: boolean }[] = [
      { tag: '유료 OFF(기본값)', opt: { paid: false }, expectPaid: false },
      { tag: '예산 env 없음 — 장부가 요청 전에 막음', opt: { budget: false }, expectPaid: false },
      { tag: 'HTTP 500', opt: { env: { FAKE_SEMANTIC_MODE: 'http-500' } }, expectPaid: true },
      { tag: '시간 초과', opt: { env: { FAKE_PROVIDER_MODE: 'timeout' } }, expectPaid: true },
      { tag: 'JSON 아님', opt: { env: { FAKE_SEMANTIC_MODE: 'garbage' } }, expectPaid: true },
      { tag: '발견이 있는데 defect=no (자기모순)', opt: { env: { FAKE_SEMANTIC_MODE: 'contradict' } }, expectPaid: true },
      { tag: '사용량 없음 — 정산 불가', opt: { env: { FAKE_PROVIDER_MODE: 'no-usage' } }, expectPaid: true },
    ]
    let i = 0
    for (const c of cases) {
      i += 1
      // 🔴 자기모순 모드는 발견이 있어야 모순이 된다 — 비혼 카드(P20)에 남편 글. 나머지는 깨끗한 글(기혼 P03)
      const contradict = c.tag.startsWith('발견')
      const body = contradict ? '남편이 오늘 설거지를 했어요. 다들 어떠세요?' : `오류 시험 ${i} 이야기예요. 다들 어떠세요?`
      const a = await autoPublished(f, { personaCode: contradict ? 'P20' : 'P03', title: `오류 시험 ${i}`, body, sourceTitle: '오류', sourceBody: '오류 시험 이야기' })
      await selectForAudit(f, a)
      const h = newHome(`err-${i}`)
      const art = join(h, 'Library', 'Application Support', 'soransoran', 'microseed-data')
      mkdirSync(art, { recursive: true })
      for (const n of readdirSync(f.artifactDir)) writeFileSync(join(art, n), readFileSync(join(f.artifactDir, n)))
      const run = await runRunner(h, c.opt)
      const saved = await audit(a.queueId)
      check(`🔴 🔴 **[${c.tag}] → yes(측정 불가) · no 아님**`, run.code === 0 && saved.defect === 'yes' && (saved.note ?? '').includes('측정 불가'),
        `${run.code} · ${saved.defect} · ${saved.note} · ${run.out.slice(-200)}`)
      check(`[${c.tag}] 유료 요청 ${c.expectPaid ? '있음(나갔고 실패)' : '0'}`, c.expectPaid ? run.paid >= 1 : run.paid === 0, `paid ${run.paid}`)
    }
  }

  console.log('\n⑧ 🔴 🔴 결과의 묶음이 이 글·이 도장이 아니면 → 무결성 yes')
  {
    const mk = async (code: string, tag: string) => {
      const p = await autoPublished(f, { personaCode: code, title: `묶음 ${tag}`, body: `묶음 시험 ${tag} 이야기예요. 다들 어떠세요?`, sourceTitle: '묶음', sourceBody: '묶음 시험' })
      await selectForAudit(f, p); return p
    }
    const base = await mk('P01', 'base')
    const other = await mk('P02', 'other')
    const cOther = await combinedFor(other)
    const cBase = await combinedFor(base)
    check('기준선 — 두 글 모두 측정된 의미 감사(no)와 묶음이 있다', cBase.semantic.measured && cOther.semantic.measured
      && cBase.semantic.binding !== null && cOther.semantic.binding !== null && cBase.verdict.defect === 'no', JSON.stringify(cBase.semantic.reasons))
    const withSem = (s: Partial<SemanticVerdict>) => ({ ...cBase, semantic: { ...cBase.semantic, ...s } })
    const tries: { tag: string; combined: typeof cBase }[] = [
      { tag: '다른 글에 묶인 의미 감사', combined: { ...cBase, semantic: cOther.semantic } },
      { tag: '묶음 digest 조작', combined: withSem({ binding: { ...cBase.semantic.binding!, digest: digestOf('조작') } }) },
      { tag: '다른 Persona 로 묶음 · digest 는 다시 계산', combined: withSem({ binding: (() => { const b = { ...cBase.semantic.binding!, personaCode: 'P09' }; return { ...b, digest: bindingDigestOf(b) } })() }) },
      { tag: '다른 artifact 로 묶음 · digest 는 다시 계산', combined: withSem({ binding: (() => { const b = { ...cBase.semantic.binding!, artifactId: 'fx-art-other' }; return { ...b, digest: bindingDigestOf(b) } })() }) },
      { tag: '도장 digest 가 지금 도장과 다르다', combined: withSem({ binding: (() => { const b = { ...cBase.semantic.binding!, stampDigest: digestOf('옛 도장') }; return { ...b, digest: bindingDigestOf(b) } })() }) },
      { tag: '규칙 감사가 다른 글을 판정(judged hash)', combined: { ...cBase, verdict: { ...cBase.verdict, judgedBodyHash: digestOf('다른 글') } } },
      { tag: '의미 감사 없이 no (binding 없음)', combined: withSem({ binding: null }) },
      { tag: '측정 안 된 의미 감사로 no', combined: withSem({ measured: false }) },
      { tag: '옛 의미 감사 계약 판', combined: withSem({ contractVersion: 'auto-ready-semantic-audit-v0' }) },
      { tag: '의미 yes 인데 최종 no', combined: { verdict: { ...cBase.verdict, defect: 'no' }, semantic: { ...cBase.semantic, defect: 'yes' } } },
    ]
    for (const t of tries) {
      await prisma.autoReadyAudit.update({ where: { queueId: base.queueId }, data: { defect: null, judgedAt: null, auditor: null, note: null, auditContractVersion: null, auditModel: null, auditPromptVersion: null } })
      const r = await recordCombinedAudit(prisma, { queueId: base.queueId, combined: t.combined, auditor: 'model:semantic-audit:t', now: f.now })
      const s = await audit(base.queueId)
      check(`🔴 🔴 **[${t.tag}] → integrityDefect · yes**`, r === 'integrityDefect' && s.defect === 'yes' && (s.note ?? '').includes('무결성'), `${r} · ${s.defect} · ${s.note}`)
    }
    await prisma.autoReadyAudit.update({ where: { queueId: base.queueId }, data: { defect: null, judgedAt: null, auditor: null, note: null, auditContractVersion: null, auditModel: null, auditPromptVersion: null } })
    check('대조 — 올바른 묶음의 no 는 기록된다', await recordCombinedAudit(prisma, { queueId: base.queueId, combined: cBase, auditor: 'model:semantic-audit:t', now: f.now }) === 'recorded')
    const late = await recordCombinedAudit(prisma, { queueId: base.queueId, combined: tries[0]!.combined, auditor: 'model:semantic-audit:late', now: f.now })
    const kept = await audit(base.queueId)
    check('🔴 🔴 **이미 판정된 감사에 깨진 묶음이 와도 덮지 않는다 — 결과는 첫 기록 하나(무결성 쓰기도 판정 전일 때만)**',
      late === 'alreadyJudged' && kept.defect === 'no' && kept.auditor === 'model:semantic-audit:t', `${late} · ${kept.defect} · ${kept.auditor}`)
    const bad: AuditVerdict = { ...cBase.verdict, contractVersion: 'auto-ready-audit-v0' }
    check('옛 감사 계약 판 → staleContract', await recordCombinedAudit(prisma, { queueId: other.queueId, combined: { ...cBase, verdict: bad }, auditor: 'model:semantic-audit:t', now: f.now }) === 'staleContract')
    check('감사 계약 판 상수는 repo 그대로다(품질 계약 digest 밖)', AUDIT_CONTRACT_VERSION === 'auto-ready-audit-v1' && (SEMANTIC_AUDIT_CONTRACT_VERSION as string) !== AUDIT_CONTRACT_VERSION)
  }

  await wipeAuditFixtures(prisma)
  await prisma.$disconnect()
  rmSync(SCRATCH, { recursive: true, force: true })
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB · 임시 HOME · 가짜 네트워크에서만 돌았다 — 운영 DB 0 · 운영 장부 0 · 실제 유료 호출 0\n')
  if (fail > 0) process.exit(1)
}

await main()

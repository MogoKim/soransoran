#!/usr/bin/env tsx
/**
 * 🔴 **적재 재시도 · 이월 — 실제 적재기 · 격리 Postgres** (2026-09-27)
 *
 *   `npm run check:draft-life-gates-db` 끝에서 함께 돈다(새 npm 명령 · 새 step 없음).
 *   단독으로도 돈다: `SORAN_ISOLATED_DB=yes-throwaway DATABASE_URL=… npx tsx scripts/supply-fill-retry-db-check.mts`
 *
 *   ① DB 끊김 → 재시도 → 정확히 한 번 적재
 *      첫 시도는 **닫힌 포트**로 부른다(실제 Prisma `Can't reach database server`) → transient 로 분류 →
 *      같은 인자로 다시 부른다 → 2건 적재. 대기는 주입(실제로 기다리지 않는다).
 *   ② 같은 입력을 다시 돌린다 → 0건 · `ALREADY` — 적재기의 dedup 이 중복을 막는다
 *   ③ 커밋 뒤 끊김 — 첫 시도가 **실제로 커밋한 뒤** 연결 끊김으로 끝났다고 치고 다시 부른다 → 중복 0
 *   ④ 이월 — 앞 회차 fill 실패 파일을 러너와 **같은 함수**(`planCarryOver` · `planBoundedCommonPhase` ·
 *      `resolveFillArgs` · `buildFillRecord`)로 고르고 먹인다. 상한 2 → 2건만 · 컷은 다음 회차가 이월로 받는다 ·
 *      끝낸 뒤에는 다시 얹지 않는다 · 전체 중복 0
 *   ⑤ 옛 계약 파일(digest 없음 · 다른 digest) → 이월에서 `CONTRACT` 로 빠진다.
 *      선택을 우회해 적재기에 직접 먹여도 적재기의 `CONTRACT` 관문이 막는다 → 0행
 *
 *   🔴 임시 cwd(`.microseed-data`) · 임시 HOME. 저장소 · 운영 장부 · 운영 자산 0. provider 0.
 *   🔴 운영 DB 에 절대 붙이지 않는다 — sentinel · localhost · 고정 DB 이름을 요구하고 주소를 찍지 않는다.
 *   🔴 SQL 을 쓰지 않는다 — 비우기는 Prisma `deleteMany` 다.
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { PrismaClient } from '@prisma/client'

type Check = (label: string, ok: boolean, detail?: string) => void

function isolatedUrlOrExit(): string {
  const url = process.env.DATABASE_URL ?? ''
  const problems: string[] = []
  if ((process.env.SORAN_ISOLATED_DB ?? '').trim() !== 'yes-throwaway') problems.push('SORAN_ISOLATED_DB=yes-throwaway 가 없다')
  if (!/^postgresql:\/\/[^@/]*@(127\.0\.0\.1|localhost):\d+\//.test(url)) problems.push('DATABASE_URL 이 localhost 주소가 아니다')
  if (!/\/soran_test(\?|$)/.test(url)) problems.push('DATABASE_URL 의 DB 이름이 soran_test 가 아니다')
  if (problems.length > 0) {
    console.error('🔴 격리 DB 가 아니다. 멈춘다.')
    for (const p of problems) console.error(`   · ${p}`)
    process.exit(2)
  }
  return url
}

const runIdOf = (ms: number): string => {
  const d = new Date(ms).toISOString()
  return `${d.slice(0, 10).replace(/-/g, '')}-${d.slice(11, 19).replace(/:/g, '')}`
}

export async function runFillRetryDbScenarios(check: Check, prisma: PrismaClient): Promise<void> {
  const URL = isolatedUrlOrExit()
  /** 🔴 닫힌 포트 — 실제 Prisma 가 `Can't reach database server` 를 낸다. 같은 DB 이름이라 격리 가드와 무관하다 */
  const DEAD_URL = URL.replace(/@(127\.0\.0\.1|localhost):\d+\//, '@127.0.0.1:1/')
  const REPO = process.cwd()

  const fxMod = await import('./lib/draft-gate-fixtures.mjs')
  const { runFixturePath, FIXTURE_NOW } = fxMod
  const { candidateEnvelope } = await import('./lib/candidate-envelope.mjs')
  const { STAGE_MODEL } = await import('./lib/content-core-run.mjs')
  const { DRAFT_RULE_VERSION, DRAFT_PROVENANCE } = await import('../src/lib/micro-seed-auto-draft')
  const { copiesSourceTitle, SOURCE_TITLE_CHECK_VERSION } = await import('../src/lib/draft-originality')
  const {
    runFillWithRetry, parseFillReport, resolveFillArgs, buildFillRecord, fillInputsOf,
  } = await import('../src/lib/supply-fill-retry')
  const { planBoundedCommonPhase, planCarryOverFill, runFileName } = await import('../src/lib/supply-process')
  const { planCarryOver } = await import('./lib/fill-carry-over.mjs')

  console.log('\n══ 적재 재시도 · 이월 — 실제 적재기 (격리 DB · 임시 cwd · provider 0) ══\n')

  // ── 후보 — 🔴 러너와 같은 경로(runContentCore → pickV2 → candidateEnvelope)로 만든다 ──
  const controls = [...fxMod.FIXTURES, ...fxMod.REVIEW_FIXTURES].filter((f) => f.expect.length === 0)
  const adopted: { fx: (typeof controls)[number]; r: Awaited<ReturnType<typeof runFixturePath>> }[] = []
  for (const fx of controls) {
    const r = await runFixturePath(fx)
    if (r.pick?.decision === 'AUTO_ADOPT' && r.cand !== null) adopted.push({ fx, r })
  }
  check(`[FRDB] 대조군 채택 후보가 4건 이상 (${adopted.length})`, adopted.length >= 4)
  const nowIso = FIXTURE_NOW.toISOString()
  const envelopeOf = (items: typeof adopted): Record<string, unknown> => candidateEnvelope({
    generatedAt: nowIso, ruleVersion: DRAFT_RULE_VERSION, provenance: DRAFT_PROVENANCE, stageModels: STAGE_MODEL,
    items: items.map(({ fx, r }) => ({
      artifact: r.art, sourceArticleId: fx.source.id,
      meta: { site: 'navercafe:fixture', sourcePostedAt: '', sourceListedAt: '', sourceCapturedAt: '' },
      draft: {
        title: r.cand!.title, body: r.cand!.body, safetyVerdict: r.cand!.safetyVerdict,
        originality: r.cand!.originality, generatedAt: r.cand!.generatedAt,
      },
      sourceTitleCopied: copiesSourceTitle(fx.source.title, r.art.draft!.title),
      sourceTitleCheckVersion: SOURCE_TITLE_CHECK_VERSION,
      autoJudge: { ruleVersion: 'fixture', promptVersion: 'fixture', model: 'fixture', inputHash: `h-${fx.source.id}`, provenance: 'machine-shadow' },
      ruleVersion: DRAFT_RULE_VERSION, provenance: DRAFT_PROVENANCE, reviewedAt: nowIso,
      lifeReview: r.pick!.lifeReview ?? null,
    })),
  }) as Record<string, unknown>

  // ── 임시 cwd — 러너가 쓰는 자리 그대로 ──
  const T = realpathSync(mkdtempSync(join(tmpdir(), 'soran-fillretry-cwd-')))
  const H = realpathSync(mkdtempSync(join(tmpdir(), 'soran-fillretry-home-')))
  for (const x of ['scripts', 'src', 'package.json', 'tsconfig.json']) cpSync(join(REPO, x), join(T, x), { recursive: true })
  symlinkSync(realpathSync(join(REPO, 'node_modules')), join(T, 'node_modules'))
  const DATA_REL = '.microseed-data'
  const DATA = join(T, DATA_REL)
  mkdirSync(DATA, { recursive: true })
  writeFileSync(join(DATA, 'held-candidates.json'), JSON.stringify({ held: [] }))
  const candRel = (rid: string): string => `${DATA_REL}/auto-draft-${rid}.candidates.json`
  const writeCand = (rid: string, env: Record<string, unknown>): void => {
    writeFileSync(join(T, candRel(rid)), `${JSON.stringify(env, null, 2)}\n`)
  }
  const writeRun = (rec: Record<string, unknown> & { runId: string }): void => {
    writeFileSync(join(DATA, runFileName(rec.runId)), `${JSON.stringify(rec, null, 2)}\n`)
  }
  const stages = (fill: string): { stage: string; status: string }[] =>
    [{ stage: 'judge', status: 'ok' }, { stage: 'draft', status: 'ok' }, ...(fill === '' ? [] : [{ stage: 'fill', status: fill }])]

  /** 🔴 실제 적재기 — 러너의 `run()` 과 같은 명령(tsx scripts/micro-seed-supply-autofill.mts …), cwd 만 임시다 */
  const loader = async (args: readonly string[], url: string): Promise<{ code: number | null; out: string; spawnError: string }> => {
    const res = spawnSync(process.execPath, [join(T, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
      join(T, 'scripts', 'micro-seed-supply-autofill.mts'), ...args], {
      cwd: T, encoding: 'utf-8', env: { ...process.env, HOME: H, DATABASE_URL: url, DIRECT_URL: url },
    })
    return { code: res.status, out: `${res.stdout ?? ''}${res.stderr ?? ''}`, spawnError: res.error === undefined ? '' : res.error.message }
  }
  const reset = async (): Promise<void> => {
    await prisma.autoReadyAudit.deleteMany({})
    await prisma.originalPostApprovalQueue.deleteMany({})
    await prisma.microSeedRawContent.deleteMany({})
  }
  const qCount = (): Promise<number> => prisma.originalPostApprovalQueue.count()
  const titlesDistinct = async (): Promise<boolean> => {
    const rows = await prisma.originalPostApprovalQueue.findMany({ select: { draftTitle: true } })
    return new Set(rows.map((r) => r.draftTitle)).size === rows.length
  }
  const nowMs = Date.now()

  try {
    // ── ① 끊김 → 재시도 → 정확히 한 번 ──
    console.log('① DB 끊김 → 재시도 → 정확히 한 번')
    await reset()
    const r1 = runIdOf(nowMs - 60 * 60_000)
    writeCand(r1, envelopeOf(adopted.slice(0, 2)))
    const waits: number[] = []
    const o1 = await runFillWithRetry({
      runOnce: (i) => loader(['--apply', `--input=${candRel(r1)}`, '--up-to=5'], i === 1 ? DEAD_URL : URL),
      sleep: async (ms) => { waits.push(ms) }, nowMs: () => Date.now(),
    })
    check('[FRDB] 🔴 첫 시도 — 실제 Prisma 연결 실패가 transient/P1001 로 분류된다',
      o1.attempts[0]?.kind === 'transient' && o1.attempts[0]?.code === 'P1001', JSON.stringify(o1.attempts))
    check('[FRDB] 🔴 같은 인자로 다시 불러 성공한다 (2회 · 대기 30초 1번)',
      o1.ok && o1.attempts.length === 2 && waits.join(',') === '30000', JSON.stringify(o1.attempts))
    check('[FRDB] 🔴 정확히 2행 — 후보 2건이 한 번씩', (await qCount()) === 2 && o1.loadedAcrossAttempts === 2)
    const rp1 = parseFillReport(o1.final.out)
    check('[FRDB] 보고 — 적재 2 · 컷 0', rp1?.loaded === 2 && rp1?.files[0]?.cut === 0, JSON.stringify(rp1))

    // ── ② 다시 돌려도 0건 ──
    console.log('\n② 같은 입력을 다시 — 중복 0')
    const again = await loader(['--apply', `--input=${candRel(r1)}`, '--up-to=5'], URL)
    const rp2 = parseFillReport(again.out)
    check('[FRDB] 🔴 두 번째 실행 — 0건 적재 · ALREADY 2', again.code === 0 && rp2?.loaded === 0 && rp2?.skipped.ALREADY === 2,
      `exit ${String(again.code)} · ${JSON.stringify(rp2)}`)
    check('[FRDB] 🔴 행 수 그대로 2 — 중복 0', (await qCount()) === 2 && await titlesDistinct())

    // ── ③ 커밋 뒤 끊김 ──
    console.log('\n③ 커밋한 뒤 연결이 끊긴 시도 — 다시 불러도 중복 0')
    const r3 = runIdOf(nowMs - 50 * 60_000)
    writeCand(r3, envelopeOf(adopted.slice(2, 3)))
    const o3 = await runFillWithRetry({
      runOnce: async (i) => {
        const r = await loader(['--apply', `--input=${candRel(r3)}`, '--up-to=5'], URL)
        if (i > 1) return r
        // 🔴 실제로 커밋했다 — 보고 줄 전에 연결이 끊겼다고 친다(적재기 출력에서 보고 줄만 뺀다)
        return { code: 1, out: `${r.out.split('\n').filter((l) => !l.startsWith('FILL_REPORT ')).join('\n')}\nError: Server has closed the connection.`, spawnError: '' }
      },
      sleep: async () => undefined, nowMs: () => Date.now(),
    })
    const rp3 = parseFillReport(o3.final.out)
    check('[FRDB] 첫 시도는 실제로 1건을 커밋했고 transient/P1017 로 분류됐다',
      o3.attempts[0]?.loaded === 1 && o3.attempts[0]?.code === 'P1017', JSON.stringify(o3.attempts))
    check('[FRDB] 🔴 🔴 **재시도는 그 건을 ALREADY 로 뺀다 — 중복 0**',
      o3.ok && rp3?.loaded === 0 && rp3?.skipped.ALREADY === 1 && (await qCount()) === 3 && await titlesDistinct(),
      `${JSON.stringify(rp3)} · 행 ${await qCount()}`)

    // ── ④ 이월 ──
    console.log('\n④ 회차 사이 이월 — 러너와 같은 함수')
    await reset()
    rmSync(DATA, { recursive: true, force: true })
    mkdirSync(DATA, { recursive: true })
    writeFileSync(join(DATA, 'held-candidates.json'), JSON.stringify({ held: [] }))
    const A = runIdOf(nowMs - 3 * 3_600_000)
    const B = runIdOf(nowMs - 2 * 3_600_000)
    const C = runIdOf(nowMs - 1 * 3_600_000)
    const Dn = runIdOf(nowMs - 30 * 60_000)
    // A: fill 이 끊김으로 실패한 앞 회차(옛 기록 모양 — 이 PR 전 러너가 쓴 것과 같다)
    writeCand(A, envelopeOf(adopted.slice(0, 3)))
    writeRun({ runId: A, status: 'failed', stages: stages('failed') })
    // B: 이번 회차 — 자기 후보 1건 · 상한(묶음 크기) 2
    writeCand(B, envelopeOf(adopted.slice(3, 4)))
    writeRun({ runId: B, status: 'running', stages: stages('') })
    const selB = planCarryOver({ dataDir: DATA, currentRunId: B, nowMs })
    check('[FRDB] B 회차 — A 를 이월로 고른다', selB.picked.map((x) => x.runId).join(',') === A, JSON.stringify(selB))
    const pending = { rawCafe: {}, thin: {}, detail: ['x.detail.jsonl'], shadow: [], candidates: [`auto-draft-${B}.candidates.json`] }
    const policy = { llm: true, fill: true, upTo: 688, reason: '' }
    const carryB = selB.picked.map((x) => `${DATA_REL}/${x.name}`)
    const planB = planBoundedCommonPhase(pending, policy, { kind: 'ready', snapshotPath: 's', runId: B }, {
      manifestPath: 'w', shadowPath: 's', candidatesPath: candRel(B), limit: 2, perStage: { judge: 2, draft: 6 },
      carryOverPaths: carryB,
    }).find((p) => p.stage === 'fill')!
    const resB = resolveFillArgs(planB.args, (p) => existsSync(join(T, p)))
    const oB = await runFillWithRetry({ runOnce: () => loader(resB.args, URL), sleep: async () => undefined, nowMs: () => Date.now() })
    const recB = buildFillRecord({ args: resB.args, missing: resB.missing, carryOverPaths: carryB, carryRejected: selB.rejected, outcome: oB })
    check('[FRDB] 🔴 🔴 **이월이 있어도 상한 2 — 2행만**',
      oB.ok && (await qCount()) === 2 && planB.args.includes('--up-to=2'), `행 ${await qCount()} · ${planB.args.join(' ')}`)
    check('[FRDB] 먹인 파일 = 이번 회차 + 이월 A', fillInputsOf(resB.args).length === 2 && recB.carriedOver.join(',') === `auto-draft-${A}.candidates.json`)
    check('[FRDB] 상한 컷 2건이 보고에 남는다 (끝나지 않았다)', recB.report?.cut === 2, JSON.stringify(recB.report))
    writeRun({ runId: B, status: 'done', stages: stages('ok'), fill: recB })

    // C: 새 묶음이 없는 회차 — 이월만
    const selC = planCarryOver({ dataDir: DATA, currentRunId: C, nowMs })
    const cutNames = (recB.report?.files ?? []).filter((f) => f.cut > 0).map((f) => f.name).sort()
    check('[FRDB] 🔴 C 회차 — 컷이 남은 파일만 다시 고른다',
      selC.picked.map((x) => x.name).sort().join(',') === cutNames.join(','), `${JSON.stringify(selC.picked)} · 컷 ${cutNames.join(',')}`)
    const carryC = selC.picked.map((x) => `${DATA_REL}/${x.name}`)
    const planC = planCarryOverFill(policy, carryC, 5)[0]!
    const oC = await runFillWithRetry({ runOnce: () => loader(planC.args, URL), sleep: async () => undefined, nowMs: () => Date.now() })
    const recC = buildFillRecord({ args: planC.args, missing: [], carryOverPaths: carryC, carryRejected: selC.rejected, outcome: oC })
    /** C 가 먹인 파일에 들어 있던, B 가 이미 넣은 건 — 이것들은 ALREADY 로 빠져야 한다 */
    const alreadyExpected = (recB.report?.files ?? []).filter((f) => f.cut > 0).reduce((n, f) => n + f.loaded, 0)
    check(`[FRDB] 🔴 C 회차 — 남은 2건을 넣어 전체 4행 · 중복 0 · B 가 넣은 ${alreadyExpected}건은 ALREADY`,
      oC.ok && (await qCount()) === 4 && await titlesDistinct() && recC.report?.loaded === 2
      && (recC.report?.skipped.ALREADY ?? 0) === alreadyExpected,
      `행 ${await qCount()} · ${JSON.stringify(recC.report)}`)
    writeRun({ runId: C, status: 'done', stages: stages('ok'), fill: recC })
    const selD = planCarryOver({ dataDir: DATA, currentRunId: Dn, nowMs })
    check('[FRDB] 🔴 D 회차 — 끝낸 파일을 다시 얹지 않는다 (이월 0)',
      selD.picked.length === 0 && selD.rejected.filter((r) => r.code === 'COMPLETED').length === 2, JSON.stringify(selD))

    // ── ⑤ 옛 계약 파일 ──
    console.log('\n⑤ 옛 계약 파일 — 이월에서도 적재기에서도 막힌다')
    await reset()
    const O1 = runIdOf(nowMs - 20 * 60_000)
    const O2 = runIdOf(nowMs - 15 * 60_000)
    const oldEnv = envelopeOf(adopted.slice(0, 2))
    delete oldEnv.qualityContractDigest
    writeCand(O1, oldEnv)
    writeRun({ runId: O1, status: 'failed', stages: stages('failed') })
    writeCand(O2, { ...envelopeOf(adopted.slice(0, 2)), qualityContractDigest: '0'.repeat(64) })
    writeRun({ runId: O2, status: 'failed', stages: stages('failed') })
    const selO = planCarryOver({ dataDir: DATA, currentRunId: runIdOf(nowMs), nowMs })
    const codeOf = (rid: string): string | undefined => selO.rejected.find((r) => r.name === `auto-draft-${rid}.candidates.json`)?.code
    check('[FRDB] 🔴 digest 없는 파일(b7d90c4 이전) — 이월 CONTRACT', codeOf(O1) === 'CONTRACT', String(codeOf(O1)))
    check('[FRDB] 🔴 다른 digest 파일 — 이월 CONTRACT', codeOf(O2) === 'CONTRACT', String(codeOf(O2)))
    check('[FRDB] 둘 다 고르지 않는다', !selO.picked.some((x) => x.runId === O1 || x.runId === O2))
    const forced = await loader(['--apply', `--input=${candRel(O1)},${candRel(O2)}`, '--up-to=5'], URL)
    const rpO = parseFillReport(forced.out)
    check('[FRDB] 🔴 🔴 **선택을 우회해 직접 먹여도 적재기 CONTRACT 가 막는다 — 0행**',
      forced.code === 0 && rpO?.skipped.CONTRACT === 4 && rpO?.loaded === 0 && (await qCount()) === 0,
      `exit ${String(forced.code)} · ${JSON.stringify(rpO)} · 행 ${await qCount()}`)
    check('[FRDB] 🔴 공급은 발행하지 않는다 — Post 0', (await prisma.post.count()) === 0)
  } finally {
    rmSync(T, { recursive: true, force: true })
    rmSync(H, { recursive: true, force: true })
  }
}

const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) {
  isolatedUrlOrExit()
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  let pass = 0
  let fail = 0
  try {
    await runFillRetryDbScenarios((n, ok, d = '') => {
      if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  ❌ ${n}${d === '' ? '' : ` — ${d}`}`) }
    }, prisma)
  } finally { await prisma.$disconnect() }
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB · 임시 cwd · 임시 HOME · 가짜 provider · 운영 장부 0\n')
  process.exit(fail === 0 ? 0 : 1)
}

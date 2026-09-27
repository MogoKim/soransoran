#!/usr/bin/env tsx
/**
 * 🔴 **초안 게이트 → 적재 실제 경로** (2026-09-26 · 격리 Postgres 전용)
 *
 *   운영 기계 초안 4편은 semanticReview `clean` · machineOutcome `adopt` 로 **DB 큐 행(APPROVED ·
 *   machine:auto-draft-v5)** 이 되어 사람 검토를 기다렸다. 이 검사는 같은 원문·계획·초안·카드로
 *   **적재까지 실제로 돌린다**:
 *
 *     runContentCore(가짜 provider · 운영 답 그대로) → pickV2(러너가 넘기는 칸 그대로)
 *       → 후보 봉투(`candidateEnvelope` · 러너와 같은 함수) → **실제 `micro-seed-supply-autofill --apply`**
 *       → 격리 DB 의 `OriginalPostApprovalQueue`
 *
 *   기대: 반례 4편은 큐 행 0 · 대조 2편(P13 · P19)만 APPROVED 로 들어간다.
 *   재검토 반례(2026-09-26): 남의 집안 3편 · `돼서 요즘` 1편은 들어가고, 맨 `남편이` · `되면` 2편은 막힌다.
 *
 *   🔴 임시 cwd(`.microseed-data` · 보류 목록)와 임시 HOME 에서 돈다. 저장소 · 운영 장부 · 운영 자산 0.
 *   🔴 운영 DB 에 절대 붙이지 않는다 — sentinel · localhost · 고정 DB 이름을 요구하고 주소를 찍지 않는다.
 *   🔴 provider 0 — `runContentCore` 는 주입한 가짜 ask 만 부른다.
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

const REPO = process.cwd()
const { PrismaClient } = await import('@prisma/client')
const fxMod = await import('./lib/draft-gate-fixtures.mjs')
const { runFixturePath, FIXTURE_NOW } = fxMod
/** 🔴 운영 실측 6 + 마스터 재검토 반례 6(남의 집안 3 · 맨 남편 · 돼서 지금 · 되면 미래) */
const FIXTURES = [...fxMod.FIXTURES, ...fxMod.REVIEW_FIXTURES]
const { candidateEnvelope } = await import('./lib/candidate-envelope.mjs')
const { STAGE_MODEL } = await import('./lib/content-core-run.mjs')
const { DRAFT_RULE_VERSION, DRAFT_PROVENANCE } = await import('../src/lib/micro-seed-auto-draft')
const { copiesSourceTitle, SOURCE_TITLE_CHECK_VERSION } = await import('../src/lib/draft-originality')
const { MACHINE_DECIDED_BY } = await import('../src/lib/micro-seed-supply-autofill')

async function main(): Promise<void> {
  console.log('\n══ 초안 게이트 → 적재 실제 경로 (격리 DB · 임시 cwd · provider 0) ══\n')
  const prisma = new PrismaClient()
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue",'
    + '"MicroSeedRawContent","Post","Persona","User" CASCADE',
  )

  console.log('① runContentCore → pickV2 — 러너 채택 루프와 같은 칸')
  const nowIso = FIXTURE_NOW.toISOString()
  const adopted: { fx: (typeof FIXTURES)[number]; r: Awaited<ReturnType<typeof runFixturePath>> }[] = []
  for (const fx of FIXTURES) {
    const r = await runFixturePath(fx)
    console.log(`   · ${fx.card.code} → ${r.pick?.decision ?? '(초안 없음)'} · ${r.pick?.reason ?? r.art.review.machineReason}`)
    if (r.pick?.decision === 'AUTO_ADOPT') adopted.push({ fx, r })
    /**
     * 🔴 **큐에 없다는 것만으로는 부족하다** — 게이트 하나가 빠져도 다른 게이트가 막으면 큐는 같다.
     *    기대한 사유가 **전부** pick 에 남았는지 본다(재검토 2차: C 가 빠지고 B 만 남은 경우).
     */
    if (fx.expect.length > 0) {
      const got = (r.pick?.rejected ?? []).map((x) => x.reason as string)
      check(`🔴 ${fx.label} — pick AUTO_HOLD · 사유 ${fx.expect.join('+')} 전부`,
        r.pick?.decision === 'AUTO_HOLD' && fx.expect.every((c) => got.includes(c)), `${r.pick?.decision} · ${got.join(',')}`)
    }
  }

  // ── 임시 cwd — 러너가 쓰는 자리 그대로(.microseed-data) ──
  const T = realpathSync(mkdtempSync(join(tmpdir(), 'soran-draftgate-cwd-')))
  const H = realpathSync(mkdtempSync(join(tmpdir(), 'soran-draftgate-home-')))
  for (const x of ['scripts', 'src', 'package.json', 'tsconfig.json']) cpSync(join(REPO, x), join(T, x), { recursive: true })
  symlinkSync(realpathSync(join(REPO, 'node_modules')), join(T, 'node_modules'))
  const DATA = join(T, '.microseed-data')
  mkdirSync(DATA, { recursive: true })
  // 🔴 "없다" 와 "비었다" 는 다르다 — 적재기는 보류 목록 파일이 없으면 멈춘다
  writeFileSync(join(DATA, 'held-candidates.json'), JSON.stringify({ held: [] }))
  const rid = '20260926-draftgate'
  // 🔴 봉투는 러너와 **같은 함수**가 조립한다 — 손으로 축약하지 않는다
  writeFileSync(join(DATA, `auto-draft-${rid}.candidates.json`), JSON.stringify(candidateEnvelope({
    generatedAt: nowIso, ruleVersion: DRAFT_RULE_VERSION, provenance: DRAFT_PROVENANCE, stageModels: STAGE_MODEL,
    items: adopted.map(({ fx, r }) => ({
      artifact: r.art,
      sourceArticleId: fx.source.id,
      meta: { site: 'navercafe:fixture', sourcePostedAt: '', sourceListedAt: '', sourceCapturedAt: '' },
      // 🔴 채택 판정이 본 후보 그대로 — 안전·독창성을 여기서 지어내지 않는다
      draft: {
        title: r.cand!.title, body: r.cand!.body, safetyVerdict: r.cand!.safetyVerdict,
        originality: r.cand!.originality, generatedAt: r.cand!.generatedAt,
      },
      sourceTitleCopied: copiesSourceTitle(fx.source.title, r.art.draft!.title),
      sourceTitleCheckVersion: SOURCE_TITLE_CHECK_VERSION,
      autoJudge: { ruleVersion: 'fixture', promptVersion: 'fixture', model: 'fixture', inputHash: `h-${fx.source.id}`, provenance: 'machine-shadow' },
      ruleVersion: DRAFT_RULE_VERSION, provenance: DRAFT_PROVENANCE, reviewedAt: nowIso,
    })),
  }), null, 2))

  console.log('\n② 실제 supply-autofill --apply — 임시 cwd · 격리 DB')
  const res = spawnSync(process.execPath, [join(T, 'node_modules', 'tsx', 'dist', 'cli.mjs'),
    join(T, 'scripts', 'micro-seed-supply-autofill.mts'), '--apply', '--up-to=10'], {
    cwd: T, encoding: 'utf-8',
    env: { ...process.env, HOME: H, DATABASE_URL: URL, DIRECT_URL: URL },
  })
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`
  check('적재기가 정상 종료한다 (exit 0)', res.status === 0, `exit ${String(res.status)} · ${out.split('\n').filter((l) => /🔴|Error/.test(l)).slice(0, 3).join(' | ')}`)
  check('🔴 적재기가 실제로 돌았다 (보충 머리말이 찍혔다)', out.includes('실제 보충 (--apply)'), `출력 ${out.length}자`)

  console.log('\n③ 격리 DB 의 큐 — 반례 0 · 대조만')
  const rows = await prisma.originalPostApprovalQueue.findMany({
    select: { draftTitle: true, status: true, decidedBy: true },
  })
  const titles = rows.map((x) => x.draftTitle)
  for (const fx of FIXTURES) {
    const inQueue = titles.includes(fx.draft.title)
    if (fx.expect.length === 0) {
      check(`🟢 ${fx.label} — 큐 행이 된다 (APPROVED · ${MACHINE_DECIDED_BY})`,
        inQueue && rows.some((x) => x.draftTitle === fx.draft.title && x.status === 'APPROVED' && x.decidedBy === MACHINE_DECIDED_BY))
    } else {
      check(`🔴 🔴 **${fx.label} — 큐 행이 되지 않는다**`, !inQueue, inQueue ? '큐에 들어갔다' : '')
    }
  }
  check(`큐 행 수 = 대조군 수 (${FIXTURES.filter((f) => f.expect.length === 0).length})`, rows.length === FIXTURES.filter((f) => f.expect.length === 0).length, `${rows.length}행`)
  check('🔴 공급은 발행하지 않는다 — Post 0', (await prisma.post.count()) === 0)

  /**
   * 🔴 **적재 재시도 · 이월** (2026-09-27) — 같은 실제 적재기 경로다. 새 npm 명령 · 새 step 없이 여기서 함께 돈다.
   *    DB 끊김 → 재시도 → 정확히 한 번 · 다시 돌려도 중복 0 · 이월 상한 · 옛 계약 파일 0행.
   *    같은 격리 DB 를 스스로 비우고 쓴다(Prisma deleteMany).
   */
  const { runFillRetryDbScenarios } = await import('./supply-fill-retry-db-check.mjs')
  await runFillRetryDbScenarios(check, prisma)

  await prisma.$disconnect()
  rmSync(T, { recursive: true, force: true })
  rmSync(H, { recursive: true, force: true })
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB · 임시 cwd · 임시 HOME · 가짜 provider · 운영 장부 0\n')
  if (fail > 0) process.exit(1)
}

await main()

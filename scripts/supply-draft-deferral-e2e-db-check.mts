#!/usr/bin/env tsx
/**
 * 🔴 **부모(공급 러너) → 자식(생성 러너) 실제 경로 — 회차 시각 하나 · Persona 여력 대기** (2026-09-26 · 격리 Postgres 전용)
 *
 *   ① 회차 시각을 **Persona 생일 전날 KST 23:59:59.5** 로 넣는다 — KST 자정과 생일 경계가 한 점에서 겹친다.
 *      부모 모듈이 그 값(`RUN_AT`)을 읽고, 부모의 `writeSpeakerLoad` 가 화자 여력 파일을 적고,
 *      부모의 `run()` 이 **실제 `micro-seed-auto-draft.mts` 를 자식 프로세스로** 띄운다(계획은 부모의
 *      `planBoundedCommonPhase` 가 만든 draft 인자 그대로).
 *      → 파일 `writtenAt` · 지평 첫날 · 자식의 회차 시각 · 자식이 본 후보 풀 지문(나이 포함)이
 *        **모두 같은 한 시각**에서 나왔는지 대조한다. 그 시각은 벽시계와 한 달 넘게 떨어져 있다 —
 *        자식이 제 시계로 여력 파일을 검증하면 "미래 기록" 으로 멈춘다.
 *   ② 화자 여력이 **전원 0** 인 회차 — AUTO_SEED 3건
 *      → provider 호출 0(장부 0줄) · picks 3건 전부 `personaCapacityDeferred` · `noDraft` 0 · artifact 0.
 *
 *   🔴 임시 디렉터리에서 돈다: cwd(`.microseed-data`)와 HOME(장부 · 말투 자산)이 모두 mkdtemp 안이다.
 *      저장소 · 운영 장부 · 운영 말투 자산을 건드리지 않는다. 말투 자산은 **합성**이다(실제 댓글 0).
 *      provider 키는 가짜 값이다 — 호출이 났다면 장부에 줄이 남는다(그것을 센다).
 *   🔴 운영 DB 에 절대 붙이지 않는다 — sentinel · localhost · 고정 DB 이름을 요구하고 주소를 찍지 않는다.
 */
import { createHash } from 'node:crypto'
import {
  chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync,
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
const POOL_DOC = 'docs/operations/2026-08-30-persona-pool-design.md'

/**
 * 🔴 **경계 시각** — 정본 카드 첫 사람의 생일 **전날 KST 23:59:59.5**.
 *    다음 생일이 벽시계보다 뒤인 해를 고른다(벽시계와 떨어져 있어야 자식 시계 결함이 드러난다).
 */
const firstBirth = /^birthDate (\d{4})-(\d{2})-(\d{2})/m.exec(readFileSync(join(REPO, POOL_DOC), 'utf-8'))
if (firstBirth === null) { console.error('🔴 정본 카드에서 birthDate 를 찾지 못했다'); process.exit(1) }
const [, , bm, bd] = firstBirth
const wall = Date.now()
let year = new Date(wall).getUTCFullYear()
const birthdayKst = (y: number): number => Date.parse(`${y}-${bm}-${bd}T00:00:00+09:00`)
while (birthdayKst(year) - wall < 7 * 864e5) year += 1
const RUN_AT = new Date(birthdayKst(year) - 500)
const AFTER = new Date(birthdayKst(year) + 500)

// ── 🔴 임시 cwd · 임시 HOME — import 전에 세운다(말투 자산 · 장부 경로가 import 때 굳는다) ──
/**
 * 🔴 **실제 경로로 만든다** — macOS 의 `/var` 는 `/private/var` 의 링크다. 자식의 직접 실행 가드는
 *    `argv[1]` 과 `import.meta.url`(실제 경로)을 비교하므로, 링크 경로로 띄우면 **main 이 돌지 않고
 *    exit 0** 으로 끝난다(이 검사가 처음에 그렇게 거짓 초록을 냈다). 코드도 링크가 아니라 **복사본**이다.
 */
const T = realpathSync(mkdtempSync(join(tmpdir(), 'soran-deferral-cwd-')))
const H = realpathSync(mkdtempSync(join(tmpdir(), 'soran-deferral-home-')))
for (const x of ['scripts', 'src', 'package.json', 'tsconfig.json']) cpSync(join(REPO, x), join(T, x), { recursive: true })
mkdirSync(join(T, 'docs', 'operations'), { recursive: true })
cpSync(join(REPO, POOL_DOC), join(T, POOL_DOC))
// 의존성만 링크다 — 코드가 아니다
symlinkSync(realpathSync(join(REPO, 'node_modules')), join(T, 'node_modules'))
const DATA = join(T, '.microseed-data')
mkdirSync(DATA, { recursive: true })

/** 🔴 합성 말투 자산 — 실제 댓글이 아니다. 화자 30명 × 4건 · 경험 서술 없음 */
const refDir = join(H, 'Library', 'Application Support', 'soransoran', 'persona-reference')
mkdirSync(refDir, { recursive: true })
chmodSync(refDir, 0o700)
const comments: { speakerId: string; content: string }[] = []
for (let i = 0; i < 30; i += 1) {
  const sid = createHash('sha256').update(`fixture-speaker-${i}`).digest('hex').slice(0, 12)
  for (let k = 0; k < 4; k += 1) comments.push({ speakerId: sid, content: `그렇죠 맞는 말씀이에요 ${i}-${k}` })
}
const corpusRaw = JSON.stringify({ version: 1, comments })
writeFileSync(join(refDir, 'corpus.json'), corpusRaw, { mode: 0o600 })
writeFileSync(join(refDir, 'manifest.json'), JSON.stringify({
  sourceDigest: createHash('sha256').update(corpusRaw).digest('hex').slice(0, 16),
}), { mode: 0o600 })

process.env.HOME = H
process.env.SORAN_RUN_AT = RUN_AT.toISOString()
process.env.SORAN_RELEASE_STAGE = 'd1'
process.env.SORAN_CAPACITY_STAGE = 'd1'
process.chdir(T)

const { PrismaClient } = await import('@prisma/client')
const { writeSpeakerLoad, buildSpeakerLoad, run, STAGE_SCRIPT, RUN_AT: PARENT_RUN_AT, RUN_CLOCK } = await import('./supply-process.mjs')
const { planBoundedCommonPhase } = await import('../src/lib/supply-process')
const { buildQueueSnapshot, queueSnapshotFileName } = await import('../src/lib/supply-queue-snapshot')
const { currentContractBase } = await import('./lib/generation-contract.mjs')
const { loadVoice } = await import('./lib/voice-runtime.mjs')
const { resolveScale } = await import('../src/lib/scale-runtime')
const { horizonStart } = await import('../src/lib/scale-profile')
const { kstDateString } = await import('../src/lib/release-canary')
const { PROVIDER_KEY_ENV } = await import('./lib/voice-m3-provider.mjs')
const { MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE } = await import('../src/lib/micro-seed-supply-autofill')

async function main(): Promise<void> {
  console.log('\n══ 부모 → 자식 실제 경로 · 회차 시각 하나 · Persona 여력 대기 (격리 DB · 임시 디렉터리) ══')
  console.log(`   회차 시각 ${RUN_AT.toISOString()} (생일 ${year}-${bm}-${bd} KST 직전 0.5초)\n`)
  const prisma = new PrismaClient()
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue",'
    + '"MicroSeedRawContent","Post","Persona","User" CASCADE',
  )

  console.log('① 경계가 실제로 있다 · 부모가 그 시각을 읽었다')
  const before = currentContractBase(RUN_AT).personaPoolDigest
  const after = currentContractBase(AFTER).personaPoolDigest
  check('합성 말투 자산으로 후보 풀이 선다', before !== '' && loadVoice(RUN_AT).candidates.length > 0,
    loadVoice(RUN_AT).describe.trim().slice(0, 120))
  check('🔴 1초 사이에 후보 풀 지문이 바뀐다 — 생일 경계가 실제로 계약을 가른다', before !== after)
  check('🔴 KST 날짜도 바뀐다 — 자정 경계다', kstDateString(RUN_AT) !== kstDateString(AFTER))
  check('🔴 부모 `RUN_AT` 이 주입한 시각이다 (자기 시계 아님)',
    PARENT_RUN_AT.getTime() === RUN_AT.getTime() && RUN_CLOCK.from === 'parent')

  // ── 시드 — 정본 후보 코드로 active Persona ──
  const codes = loadVoice(RUN_AT).candidates.map((c) => c.code)
  for (const code of codes) {
    const u = await prisma.user.create({ data: { nickname: `경계${code}` }, select: { id: true } })
    await prisma.persona.create({ data: { code, userId: u.id, status: 'active' } })
  }
  /**
   * 🔴 **여력 0 을 만든다** — capacity d1 이면 지평 7일에 자리가 7개다. 자리를 받은 화자마다
   *    사람 검토 대기 기계 초안 1건(WIP)을 둔다. 그러면 전원 `열린날 − WIP = 0` 이다.
   */
  const scale = resolveScale(process.env)
  const probe = await buildSpeakerLoad(prisma, 'probe', { env: process.env, now: RUN_AT, scale })
  const opened = Object.entries(probe.byCode).filter(([, r]) => r.openDays > 0).map(([c]) => c)
  let seq = 0
  for (const code of opened) {
    seq += 1
    const r = await prisma.microSeedRawContent.create({
      data: {
        origin: 'live', sourceSite: `${MACHINE_SITE_PREFIX}navercafe:t`, sourceUrl: `https://example.invalid/d${seq}`,
        sourceArticleId: `${9000 + seq}-dd`, sourceCapturedAt: new Date(RUN_AT.getTime() - 864e5), rawTitle: `원문 ${seq}`, rawBody: `원문 ${seq}`,
      },
      select: { id: true },
    })
    await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'APPROVED', draftTitle: `대기 글 ${seq}`, draftBody: `대기 본문 ${seq}. 다들 어떠세요?`,
        gateVerdict: 'PASS', promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        gateResults: { holds: [], blocks: [], autoDraft: {
          provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
          draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion, voice: { personaCode: code, bundleDigest: `bd-${code}`, comments: 3 },
        } } as never,
        decidedBy: 'machine:auto-draft-v5', dedupKey: `dd-${seq}`,
      },
    })
  }

  console.log('\n② 부모가 여력 파일을 적는다 — 회차 시각으로')
  const rid = `${RUN_AT.toISOString().slice(0, 10).replace(/-/g, '')}-e2e`
  const load = await writeSpeakerLoad(prisma, rid, scale)
  const file = JSON.parse(readFileSync(join(DATA, 'speaker-load.json'), 'utf-8')) as {
    writtenAt: string; runId: string; byDate: { date: string }[]; byCode: Record<string, { openDays: number; readyCount: number }>
  }
  check('🔴 🔴 **writtenAt = 회차 시각** (벽시계 아님)', file.writtenAt === RUN_AT.toISOString(), file.writtenAt)
  check('🔴 지평 첫날 = 회차 시각의 지평 시작', file.byDate[0]?.date === kstDateString(horizonStart(RUN_AT)),
    `${file.byDate[0]?.date} · 기대 ${kstDateString(horizonStart(RUN_AT))}`)
  const remaining = Object.values(file.byCode).map((r) => Math.max(0, r.openDays - r.readyCount))
  check('여력 있는 화자 0명 (자리 받은 사람마다 WIP 1)', opened.length > 0 && remaining.every((n) => n === 0),
    `열린 ${opened.length} · WIP ${load.wip.total}`)

  // ── 판정 파일 · 검수용 상세 · 큐 스냅샷 — 부모가 넘기는 모양 그대로 ──
  const shadowPath = join('.microseed-data', `auto-judge-${rid}.shadow.jsonl`)
  const seeds = ['e2e-1001', 'e2e-1002', 'e2e-1003']
  writeFileSync(join(T, shadowPath), seeds.map((id) => JSON.stringify({
    sourceArticleId: id, decision: 'AUTO_SEED', semanticRisks: [], semanticStatus: 'ok',
    ruleVersion: 'fixture', promptVersion: 'fixture', model: 'fixture', inputHash: `h-${id}`, provenance: 'machine-shadow',
  })).join('\n') + '\n')
  writeFileSync(join(DATA, `fixture-${rid}.detail.jsonl`), seeds.map((id, i) => JSON.stringify({
    sourceArticleId: id, title: `동네 산책길에 핀 꽃 ${i}`, bodyHead: '요즘 아침마다 동네를 걷는데 꽃이 피었어요',
    sourceSite: 'navercafe:fixture', axis: 'daily', lane: 'life',
  })).join('\n') + '\n')
  const snapPath = join('.microseed-data', queueSnapshotFileName(rid))
  writeFileSync(join(T, snapPath), JSON.stringify(buildQueueSnapshot({ runId: rid, takenAt: new Date(), rows: [] })))

  console.log('\n③ 부모가 자식을 띄운다 — 부모의 draft 계획 · 부모의 run()')
  const plans = planBoundedCommonPhase(
    { rawCafe: {}, thin: {}, detail: [], shadow: [shadowPath], candidates: [] } as never,
    { llm: true, fill: false, upTo: 0, reason: 'e2e' } as never,
    { kind: 'ready', snapshotPath: snapPath, runId: rid },
    { manifestPath: '', shadowPath, candidatesPath: '', limit: 5, perStage: { judge: 5, draft: 15 } },
  )
  const draft = plans.find((p) => p.stage === 'draft')
  check('부모 계획에 draft 단계가 있다', draft !== undefined)
  /** 🔴 가짜 키 · 실제 예산 모양 — 호출이 났다면 장부(임시 HOME)에 남는다 */
  const fakeKeys = Object.fromEntries([...new Set(Object.values(PROVIDER_KEY_ENV as Record<string, string>))].map((k) => [k, 'fixture-not-a-key']))
  const res = await run(STAGE_SCRIPT[draft!.stage], draft!.args, {
    ...(draft!.env ?? {}), ...fakeKeys,
    SORAN_LLM_DAILY_BUDGET_USD: '0.30', SORAN_LLM_RESERVE_HEADROOM: '1.2', SORAN_LLM_RUN_REQUEST_CAP: '15',
    HOME: H,
  })
  check('자식이 정상 종료한다 (exit 0)', res.code === 0, `exit ${String(res.code)} ${res.spawnError}`)
  // 🔴 조용한 no-op 을 통과로 세지 않는다 — 자식이 실제로 main 을 돌았는가
  check('🔴 자식이 실제로 돌았다 (생성 러너 머리말이 찍혔다)', res.out.includes('AUTO_SEED 3건'), `출력 ${res.out.length}자`)
  check('🔴 🔴 **자식이 부모가 준 회차 시각을 쓴다**',
    res.out.includes(`회차 시각 ${RUN_AT.toISOString()} (부모가 준 SORAN_RUN_AT)`))
  const childDigest = /후보 풀 지문 (\S+) \(회차 시각 (\S+) 기준\)/.exec(res.out)
  check('🔴 🔴 **자식이 본 후보 풀 지문(나이 포함) = 부모 계약** — 생일 경계를 같은 쪽에서 봤다',
    childDigest !== null && childDigest[1] === before && childDigest[1] !== after && childDigest[2] === RUN_AT.toISOString(),
    childDigest === null ? '지문 줄 없음' : `${childDigest[1]} · 부모 ${before} · 경계 뒤 ${after}`)
  check('🔴 자식이 부모 여력 파일을 받아들였다 (미래·낡음·다른 회차 아님)',
    !/사유 코드 (stale|runMismatch|missing|malformed)/.test(res.out) && /화자 여력 계획 — 여력 있는 화자 0명/.test(res.out))

  console.log('\n④ 빈 화자 묶음 → provider 0 → personaCapacityDeferred → noDraft 0')
  const ledgerDir = join(H, 'Library', 'Application Support', 'soransoran', 'llm-ledger')
  const ledgerRows = existsSync(ledgerDir)
    ? readdirSync(ledgerDir).filter((f) => f.endsWith('.jsonl'))
      .flatMap((f) => readFileSync(join(ledgerDir, f), 'utf-8').split('\n').filter((l) => l.trim() !== ''))
    : []
  check('🔴 🔴 **provider 요청 0** — 장부 0줄 (사전 계산 포함)', ledgerRows.length === 0, `${ledgerRows.length}줄`)
  const picksPath = join(DATA, `auto-draft-${rid}.picks.jsonl`)
  const picks = existsSync(picksPath)
    ? readFileSync(picksPath, 'utf-8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as { sourceArticleId: string; reason: string; decision: string; decidedAt: string })
    : []
  check('picks 3건 — AUTO_SEED 3건 전부 기록됐다', picks.length === 3 && same(picks.map((p) => p.sourceArticleId), seeds),
    picks.map((p) => p.sourceArticleId).join(','))
  check('🔴 🔴 **전부 personaCapacityDeferred**', picks.length > 0 && picks.every((p) => p.reason === 'personaCapacityDeferred' && p.decision === 'AUTO_HOLD'),
    picks.map((p) => p.reason).join(','))
  check('🔴 🔴 **noDraft 0건**', picks.filter((p) => p.reason === 'noDraft').length === 0)
  check('🔴 기록 시각도 회차 시각이다', picks.length > 0 && picks.every((p) => p.decidedAt === RUN_AT.toISOString()))
  // 🔴 파일이 없으면(자식이 중간에 멈췄다) 죽지 않고 실패로 적는다
  const readJson = <T,>(f: string): T | null => {
    const path = join(DATA, f)
    return existsSync(path) ? JSON.parse(readFileSync(path, 'utf-8')) as T : null
  }
  const arts = readJson<unknown[]>(`auto-draft-${rid}.artifacts.json`)
  const cands = readJson<{ candidates: unknown[] }>(`auto-draft-${rid}.candidates.json`)
  check('artifact 0 · candidate 0 — 만들지 않았다 (파일은 있다)',
    arts !== null && cands !== null && arts.length === 0 && cands.candidates.length === 0,
    arts === null ? '파일 없음 — 자식이 끝까지 가지 않았다' : '')
  check('🔴 화면이 초안 실패가 아니라 여력 대기라고 적는다',
    /Persona 여력 대기로 미룬 원천 3건 — AI 를 부르지 않았다 · 초안 실패 아님/.test(res.out))

  await prisma.$disconnect()
  process.chdir(REPO)
  rmSync(T, { recursive: true, force: true })
  rmSync(H, { recursive: true, force: true })
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB · 임시 cwd · 임시 HOME · 합성 말투 자산 · provider 0 · 운영 장부 0\n')
  if (fail > 0) process.exit(1)
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
}

await main()

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
 *   ⑤ 부모 러너 `main --live` 를 **실제로** 돌린다 (2026-09-28 축별 자리) — seed 6 · raw 4(댓글이 더 많다) ·
 *      격리 DB 큐에 형제 1건 → 러너가 적은 묶음이 raw 2 · seed 5 (묶음 10) 이고 판정이 그 묶음만 봤는지 대조한다.
 *   ⑥ 부모 러너를 **두 회차** 돌린다 (2026-09-28 공급 가속 P0) — 발행된 형제 · 거절된 형제 · 옛 글의 원천은
 *      묶음에 들지 않고, 1회차가 적재한 원천은 2회차에 다시 뽑히지 않으며(중복 Queue 0 · Post 불변),
 *      장부의 judge ≤ 10 · draft ≤ 30 을 센다.
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
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LAST_SLOT_SCHEDULED_ENV } from './lib/fake-scheduled-slot-env.mjs'
import { fakeEvidenceGate } from './lib/fake-source-evidence.mjs'
import { markedStageEnv } from './lib/stage-decision-fixture'

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
/**
 * 🔴 (2026-09-30 · source-slot-v1) 원천 시각은 회차 시각 기준이다 — 게시 6h 전 · 목록 관측 5h 전 · 수집 4.9h 전.
 *    고정 날짜(2026-09-27)를 쓰면 회차가 그 72h 뒤일 때 원천이 전부 SOURCE_TOO_OLD_AT_SLOT 이 되어
 *    생성 전 판정이 묶음을 비운다(이 검사가 보려는 여력 대기 경로에 닿지 않는다).
 */
const SRC_POSTED = new Date(RUN_AT.getTime() - 6 * 3_600_000).toISOString()
const SRC_LISTED = new Date(RUN_AT.getTime() - 5 * 3_600_000).toISOString()
const SRC_CAPTURED = new Date(RUN_AT.getTime() - 4.9 * 3_600_000).toISOString()
/** 🔴 목록 관측 파일 — 원천 상대 표본(sourceStats)의 재료. 러너가 읽는 이름 모양 그대로(`navercafe-<카페>-<RUN>.list.jsonl`) */
const writeListObs = (dir: string, rows: readonly { id: string; site: string; c: number }[]): void => {
  const t = new Date(RUN_AT.getTime() - 5 * 3_600_000).toISOString().replace(/[-:]/g, '').slice(0, 15).replace('T', '-')
  const bySite = new Map<string, typeof rows[number][]>()
  for (const r of rows) bySite.set(r.site, [...(bySite.get(r.site) ?? []), r])
  for (const [site, rs] of bySite) {
    const cafe = site.split(':')[1] ?? 'x'
    /**
     * 🔴 (2026-09-30 Lane B) 목록 회차에는 후보 말고도 **같은 카페의 다른 글**이 찍힌다 — 그것이 비교 표본이다.
     *    앞판 fixture 는 카페마다 후보 줄만 두어, 한 건뿐인 카페(dupx)는 **자기 자신과 비교해** 0.5 를 받았다.
     *    이제 자기 제외 · 한 점 분포는 정규화되지 않는다(UNKNOWN) — 실제 목록처럼 다른 글 넷을 함께 둔다.
     */
    const population = [0, 1, 3, 8].map((c, k) => ({ id: `${cafe}-pop-${k}`, site, c }))
    writeFileSync(join(dir, `navercafe-${cafe}-${t}.list.jsonl`), `${[...rs, ...population].map((r) => JSON.stringify({
      sourceSite: site, sourceArticleId: r.id, sourcePostedAt: SRC_POSTED, sourceListedAt: SRC_LISTED,
      sourceCommentCount: r.c, sourceViewCount: r.c * 10,
    })).join('\n')}\n`)
  }
}
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
/**
 * 🔴 검토 대기 기계 초안은 적재기가 남기는 **지금 품질 계약** 표식을 가진다(`buildQueuePayload`) —
 *    그래야 화자 WIP 다. 옛 계약 행은 WIP 가 아니다(2026-09-28 · `supply:wip-contract-db-check`).
 */
const { currentQualityContract, QUALITY_CONTRACT_KEY } = await import('../src/lib/quality-contract')

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
        }, [QUALITY_CONTRACT_KEY]: currentQualityContract(), ...fakeEvidenceGate(RUN_AT, { id: `dd-${seq}` }) } as never,
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

  await worksetAxisRunner(prisma, codes)
  await duplicateSourceRunner(prisma)

  await prisma.$disconnect()
  process.chdir(REPO)
  rmSync(T, { recursive: true, force: true })
  rmSync(H, { recursive: true, force: true })
  console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
  console.log('🔴 격리 DB · 임시 cwd · 임시 HOME · 합성 말투 자산 · provider 0 · 운영 장부 0\n')
  if (fail > 0) process.exit(1)
}

/**
 * ⑤ 🔴 🔴 **부모 러너 `main --live` 를 실제로 돌려 묶음을 본다** (2026-09-28 축별 자리).
 *
 *    순수 검사(`supply:workset-check` ⑩)는 `selectWorkset` 이 옳다는 것만 증명한다.
 *    러너가 **그 함수의 결과로** 묶음 파일을 쓰는지는 러너를 돌려야 안다 — 그래서 여기서 돈다.
 *    · 큐 스냅샷은 **이 격리 DB** 에서 러너가 직접 읽는다 (같은 원문의 미발행 형제 1건을 넣어 둔다)
 *    · fixture 는 raw 의 댓글 수가 더 크다 — 옛 규칙이면 raw 4 · seed 1 이다
 *    · provider 는 가짜다(`fake-provider-hook`) — 네트워크 0 · 운영 장부 0
 *    🔴 임시 cwd 는 ①~④ 와 **따로** 만든다 — 앞 절의 파일이 이 회차 입력에 섞이지 않게.
 */
async function worksetAxisRunner(
  prisma: InstanceType<typeof import('@prisma/client').PrismaClient>, codes: readonly string[],
): Promise<void> {
  console.log('\n⑤ 🔴 🔴 부모 러너(main --live)가 축별 자리로 묶음을 고른다 — 격리 DB 큐 · 가짜 provider')
  const { PROVEN_LANES, SEED_AXIS, RAW_AXIS } = await import('../src/lib/micro-seed-auto-judge')
  const T2 = realpathSync(mkdtempSync(join(tmpdir(), 'soran-wsaxis-cwd-')))
  for (const x of ['scripts', 'src', 'package.json', 'tsconfig.json']) cpSync(join(REPO, x), join(T2, x), { recursive: true })
  mkdirSync(join(T2, 'docs', 'operations'), { recursive: true })
  cpSync(join(REPO, POOL_DOC), join(T2, POOL_DOC))
  symlinkSync(realpathSync(join(REPO, 'node_modules')), join(T2, 'node_modules'))
  const D2 = join(T2, '.microseed-data')
  mkdirSync(D2, { recursive: true })

  /** seed 6건(댓글 10~5) · raw 4건(댓글 50~47) — 모양은 adapt 가 내는 `detail`/`raw-detail` 쌍 그대로 */
  const src = [
    ...[10, 9, 8, 7, 6, 5].map((c, i) => ({ id: `wsxs${i + 1}`, c, axis: SEED_AXIS })),
    ...[50, 49, 48, 47].map((c, i) => ({ id: `wsxw${i + 1}`, c, axis: RAW_AXIS })),
  ]
  const common = (x: { id: string; c: number; axis: string }) => ({
    runId: 'wsaxis-1', sourceArticleId: x.id, sourceSite: 'navercafe:wgang',
    axis: x.axis, lane: PROVEN_LANES[0] ?? '', safetyVerdict: 'pass', safetyReasons: '',
    title: `우리 나이 이야기 ${x.id}`,
    bodyHead: `${x.id} 원문 머리입니다. 사람들이 반응한 이야기이고 질문으로 끝납니다. 다들 어떠세요?`,
    commentCount: x.c, bodyLength: 300, assetAxes: 'sleep|work', qualityFlags: [],
    sourcePostedAt: SRC_POSTED, sourceListedAt: SRC_LISTED, sourceCapturedAt: SRC_CAPTURED,
  })
  writeFileSync(join(D2, 'wsaxis-1.detail.jsonl'),
    `${src.map((x) => JSON.stringify({ ...common(x), access: 'ok', imageCount: 0 })).join('\n')}\n`)
  writeFileSync(join(D2, 'wsaxis-1.raw-detail.jsonl'),
    `${src.map((x) => JSON.stringify({ ...common(x), accessStatus: 'ok' })).join('\n')}\n`)
  writeListObs(D2, src.map((x) => ({ id: x.id, site: 'navercafe:wgang', c: x.c })))

  // 🔴 같은 원문의 미발행 형제 — 러너가 **이 DB 를 읽어야만** wsxs1 을 뺄 수 있다.
  //    적재 행의 id 는 `<원문id>-<해시8>` 이다(`baseArticleId` 가 뒤를 뗀다) — 그 모양 그대로 넣는다
  const raw = await prisma.microSeedRawContent.create({
    data: {
      origin: 'live', sourceSite: `${MACHINE_SITE_PREFIX}navercafe:wgang`, sourceUrl: 'https://example.invalid/wsxs1',
      sourceArticleId: 'wsxs1-0000beef', sourceCapturedAt: new Date(RUN_AT.getTime() - 864e5), rawTitle: '형제 원문', rawBody: '형제 원문',
    },
    select: { id: true },
  })
  await prisma.originalPostApprovalQueue.create({
    data: {
      sourceRawContentId: raw.id, status: 'APPROVED', draftTitle: '형제 글', draftBody: '형제 본문. 다들 어떠세요?',
      gateVerdict: 'PASS', promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
      gateResults: { holds: [], blocks: [], autoDraft: {
        provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
        draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion, voice: { personaCode: codes[0] ?? 'P01', bundleDigest: 'bd-wsx', comments: 3 },
      }, [QUALITY_CONTRACT_KEY]: currentQualityContract(), ...fakeEvidenceGate(RUN_AT, { id: 'wsx-dd-1' }) } as never,
      decidedBy: 'machine:auto-draft-v5', dedupKey: 'wsx-dd-1',
    },
  })

  const fakeLog = join(T2, 'fake-provider.log')
  writeFileSync(fakeLog, '')
  const fakeKeys = Object.fromEntries([...new Set(Object.values(PROVIDER_KEY_ENV as Record<string, string>))].map((k) => [k, 'fixture-not-a-key']))
  const child = spawnSync(join(REPO, 'node_modules', '.bin', 'tsx'), [join(T2, 'scripts', 'supply-process.mts'), '--live'], {
    cwd: T2, encoding: 'utf-8', timeout: 600_000,
    env: {
      ...process.env, ...fakeKeys, HOME: H,
      SORAN_SUPPLY_PROCESS_ENABLED: 'true',
      NODE_OPTIONS: `--import=${join(REPO, 'scripts', 'lib', 'fake-provider-hook.mjs')}`,
      // 🔴 러너는 마지막 정기 슬롯 회차로 뜬다 — 정기 회차 몫 보호가 이 시험을 시각에 따라 막지 않게(2026-09-29)
      ...LAST_SLOT_SCHEDULED_ENV,
      FAKE_PROVIDER_LOG: fakeLog,
    },
  })
  const out = `${child.stdout ?? ''}${child.stderr ?? ''}`
  const wsFile = readdirSync(D2).find((f) => /^supply-workset-.*\.json$/.test(f))
  const ws = wsFile === undefined ? null
    : JSON.parse(readFileSync(join(D2, wsFile), 'utf-8')) as { runId: string; sourceIds: string[] }
  check('🔴 러너가 실제로 돌아 묶음 파일을 적었다', ws !== null, `출력 끝: ${out.slice(-600)}`)
  const got = ws?.sourceIds.join(',') ?? ''
  // 🔴 묶음 10 (2026-09-28) — raw 자리 2 · seed 는 형제를 뺀 5건 전부. 옛 규칙(댓글 순)이면 raw 4 가 먼저 든다
  check('🔴 🔴 **러너가 적은 묶음 = raw 2 (댓글 상위) + seed 5 (형제 뺀 전부)** — raw 는 최대 2 · 빈 자리를 raw 로 채우지 않는다',
    got === 'wsxw1,wsxw2,wsxs2,wsxs3,wsxs4,wsxs5,wsxs6', got)
  check('🔴 🔴 **러너가 격리 DB 큐를 읽어 형제를 뺐다** — wsxs1 없음 · 제외 사유 1건',
    ws !== null && !ws.sourceIds.includes('wsxs1') && /같은 원문의 미발행 형제가 큐에 있다 1/.test(out))
  check('🔴 러너 로그가 축별 자리를 적는다 (정본 plan.axis)',
    /축 {2}seed 적격 5 · 자리 5 · 고름 5 {2}\| {2}raw 적격 4 · 자리 2 · 고름 2/.test(out),
    (/축 .*/.exec(out) ?? [''])[0])
  const shadowFile = ws === null ? '' : join(D2, `auto-judge-${ws.runId}.shadow.jsonl`)
  const judged = shadowFile !== '' && existsSync(shadowFile)
    ? readFileSync(shadowFile, 'utf-8').split('\n').filter((l) => l.trim() !== '')
      .map((l) => (JSON.parse(l) as { sourceArticleId: string }).sourceArticleId)
    : []
  check('🔴 🔴 **판정 단계가 그 묶음만 판정했다** — 묶음 밖 raw 2건 · 형제 0건',
    ws !== null && same(judged, ws.sourceIds), `판정 ${judged.join(',')}`)
  rmSync(T2, { recursive: true, force: true })
}

/**
 * ⑥ 🔴 🔴 **같은 원문으로 두 번째 글을 만들지 않는다 · 요청 상한 10/30** (2026-09-28 공급 가속 P0).
 *
 *    부모 러너 `main --live` 를 **두 회차** 돌린다 — 격리 DB · 가짜 provider · 임시 cwd.
 *    · 1회차 전: 큐에 **발행된** 형제(PUBLISHED + Post) · 거절된 형제 · 옛 글(Post 의 원천 칸)이 있다
 *      → 셋 다 묶음에 들지 않는다(앞판은 미발행만 막아 발행된 원천이 다시 뽑혔다)
 *      → 다른 카페의 같은 글 번호는 다른 원천이다 — 막지 않는다
 *    · 1회차가 적재한 원천은 2회차 묶음에 들지 않는다 — 큐 행이 생겼기 때문이다
 *    · 원천마다 큐 행 ≤ 1 · Post 는 러너가 늘리지 않는다
 *    · 장부 — judge ≤ 10 · draft ≤ 30 (단계 env 상한)
 */
async function duplicateSourceRunner(
  prisma: InstanceType<typeof import('@prisma/client').PrismaClient>,
): Promise<void> {
  console.log('\n⑥ 🔴 🔴 같은 원문 두 번째 글 금지 · 요청 상한 — 부모 러너 두 회차 (격리 DB · 가짜 provider)')
  const { PROVEN_LANES, SEED_AXIS } = await import('../src/lib/micro-seed-auto-judge')
  const { originalSourceOf } = await import('../src/lib/supply-workset')
  const T3 = realpathSync(mkdtempSync(join(tmpdir(), 'soran-dupsrc-cwd-')))
  for (const x of ['scripts', 'src', 'package.json', 'tsconfig.json']) cpSync(join(REPO, x), join(T3, x), { recursive: true })
  mkdirSync(join(T3, 'docs', 'operations'), { recursive: true })
  cpSync(join(REPO, POOL_DOC), join(T3, POOL_DOC))
  symlinkSync(realpathSync(join(REPO, 'node_modules')), join(T3, 'node_modules'))
  const D3 = join(T3, '.microseed-data')
  mkdirSync(D3, { recursive: true })
  // 🔴 적재기는 보류 목록 파일이 없으면 멈춘다 — "없다" 와 "비었다" 는 다르다
  writeFileSync(join(D3, 'held-candidates.json'), '{"held":[]}\n')

  const src = [
    { id: 'dup1', site: 'navercafe:wgang', c: 40 },          // 발행된 형제 (PUBLISHED + Post)
    { id: 'dup2', site: 'navercafe:wgang', c: 39 },          // 거절된 형제 (DECLINED)
    { id: 'dup3', site: 'navercafe:wgang', c: 38 },          // 옛 글 — Post 의 원천 칸
    { id: 'dupx', site: 'navercafe:remonterrace', c: 37 },   // 다른 카페 · 같은 글 번호 모양 — 막지 않는다
    ...Array.from({ length: 12 }, (_, i) => ({ id: `dupf${String(i + 1).padStart(2, '0')}`, site: 'navercafe:wgang', c: 30 - i })),
  ]
  const common = (x: { id: string; site: string; c: number }) => ({
    runId: 'dupsrc-1', sourceArticleId: x.id, sourceSite: x.site,
    axis: SEED_AXIS, lane: PROVEN_LANES[0] ?? '', safetyVerdict: 'pass', safetyReasons: '',
    title: `우리 나이 이야기 ${x.id}`,
    bodyHead: `${x.id} 원문 머리입니다. 사람들이 반응한 이야기이고 질문으로 끝납니다. 다들 어떠세요?`,
    commentCount: x.c, bodyLength: 300, assetAxes: 'sleep|work', qualityFlags: [],
    sourcePostedAt: SRC_POSTED, sourceListedAt: SRC_LISTED, sourceCapturedAt: SRC_CAPTURED,
  })
  writeFileSync(join(D3, 'dupsrc-1.detail.jsonl'),
    `${src.map((x) => JSON.stringify({ ...common(x), access: 'ok', imageCount: 0 })).join('\n')}\n`)
  writeFileSync(join(D3, 'dupsrc-1.raw-detail.jsonl'),
    `${src.map((x) => JSON.stringify({ ...common(x), accessStatus: 'ok' })).join('\n')}\n`)
  writeListObs(D3, src)

  // ── 큐 · 글 — 🔴 원천 칸만 의미가 있다. 적재 행의 id 는 `<원문id>-<해시8>` 모양 그대로 ──
  const u = await prisma.user.create({ data: { nickname: '중복검사' }, select: { id: true } })
  const post1 = await prisma.post.create({ data: { boardType: 'FREE', title: '발행된 형제', content: '발행된 형제 본문', authorId: u.id }, select: { id: true } })
  const mkQueue = async (id: string, status: 'PUBLISHED' | 'DECLINED', createdPostId: string | null): Promise<void> => {
    const raw = await prisma.microSeedRawContent.create({
      data: {
        origin: 'live', sourceSite: `${MACHINE_SITE_PREFIX}navercafe:wgang`, sourceUrl: `https://example.invalid/${id}`,
        sourceArticleId: `${id}-0000beef`, sourceCapturedAt: new Date(RUN_AT.getTime() - 864e5), rawTitle: '형제 원문', rawBody: '형제 원문',
      },
      select: { id: true },
    })
    await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: raw.id, status, draftTitle: `형제 글 ${id}`, draftBody: '형제 본문. 다들 어떠세요?',
        gateVerdict: 'PASS', promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL, gateResults: { holds: [], blocks: [] } as never,
        decidedBy: 'machine:auto-draft-v5', dedupKey: `dup-dd-${id}`, createdPostId,
      },
    })
  }
  await mkQueue('dup1', 'PUBLISHED', post1.id)
  await mkQueue('dup2', 'DECLINED', null)
  await prisma.post.create({
    data: { boardType: 'FREE', title: '옛 글', content: '옛 글 본문', authorId: u.id, sourceSite: 'navercafe:wgang', sourceArticleId: 'navercafe:wgang:dup3' },
  })

  const fakeKeys = Object.fromEntries([...new Set(Object.values(PROVIDER_KEY_ENV as Record<string, string>))].map((k) => [k, 'fixture-not-a-key']))
  const runOnce = (runAt: Date): { out: string; ws: { runId: string; sourceIds: string[] } | null } => {
    const child = spawnSync(join(REPO, 'node_modules', '.bin', 'tsx'), [join(T3, 'scripts', 'supply-process.mts'), '--live'], {
      cwd: T3, encoding: 'utf-8', timeout: 600_000,
      env: {
        ...process.env, ...fakeKeys, HOME: H,
        // 🔴 ⑤ 와 장부 회차 id 가 겹치지 않게 회차 시각을 따로 준다(회차 요청 상한은 장부 id 로 센다)
        SORAN_RUN_AT: runAt.toISOString(),
        SORAN_SUPPLY_PROCESS_ENABLED: 'true',
        // 🔴 결정이 넣은 모양(표식 포함) — 표식 없는 손 env 는 d1 이다(Lane A)
        ...markedStageEnv({ SORAN_CAPACITY_STAGE: 'd10', SORAN_RELEASE_STAGE: 'd10' }),
        SORAN_LLM_DAILY_BUDGET_USD: '1000', SORAN_LLM_RESERVE_HEADROOM: '1.5',
        // 🔴 운영과 같은 env 상한(20) — 러너가 단계마다 10 · 30 으로 덮는다
        SORAN_LLM_RUN_REQUEST_CAP: '20',
        FAKE_PROVIDER_JUDGE_DECISION: 'AUTO_SEED',
        NODE_OPTIONS: `--import=${join(REPO, 'scripts', 'lib', 'fake-provider-hook.mjs')}`,
        // 🔴 러너는 마지막 정기 슬롯 회차로 뜬다 — 정기 회차 몫 보호가 이 시험을 시각에 따라 막지 않게(2026-09-29)
        ...LAST_SLOT_SCHEDULED_ENV,
      },
    })
    const out = `${child.stdout ?? ''}${child.stderr ?? ''}`
    const rid = `${runAt.toISOString().slice(0, 10).replace(/-/g, '')}-${runAt.toISOString().slice(11, 19).replace(/:/g, '')}`
    const f = join(D3, `supply-workset-${rid}.json`)
    return { out, ws: existsSync(f) ? JSON.parse(readFileSync(f, 'utf-8')) as { runId: string; sourceIds: string[] } : null }
  }
  const postBefore = await prisma.post.count()
  const r1At = new Date(RUN_AT.getTime() + 2 * 3600e3)
  const r1 = runOnce(r1At)
  check('🔴 1회차가 돌아 묶음 파일을 적었다', r1.ws !== null, r1.out.slice(-800))
  const ids1 = r1.ws?.sourceIds ?? []
  check('🔴 🔴 **발행된 형제 · 거절된 형제 · 옛 글의 원천은 묶음에 없다** (dup1 · dup2 · dup3)',
    ids1.length > 0 && !ids1.some((x) => ['dup1', 'dup2', 'dup3'].includes(x)), ids1.join(','))
  // 🔴 거절된 형제(dup2)는 `createdPostId` 가 비어 앞판 규칙(미발행 형제)이 먼저 잡는다 — 발행된 것 · 옛 글 둘이 새 규칙 몫이다
  check('🔴 🔴 **러너 로그가 그 셋을 제외 사유로 센다 — 미발행 형제 1 · 이미 큐·글에 있는 원천 2**',
    /같은 원문의 미발행 형제가 큐에 있다 1 · 같은 원문으로 이미 큐 행이나 글이 있다 \(발행된 것 포함 — 두 번째 글을 만들지 않는다\) 2/.test(r1.out),
    (/제외 .*/.exec(r1.out) ?? [''])[0])
  check('🔴 다른 카페의 같은 번호 모양(dupx)은 막지 않는다 · 묶음은 10건', ids1.includes('dupx') && ids1.length === 10, ids1.join(','))

  // ── 장부 — 단계 상한 ──
  const ledgerDir = join(H, 'Library', 'Application Support', 'soransoran', 'llm-ledger')
  const ledger = (): Record<string, unknown>[] => (existsSync(ledgerDir) ? readdirSync(ledgerDir) : [])
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => readFileSync(join(ledgerDir, f), 'utf-8').split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Record<string, unknown>))
  const paid = (runId: string): number => {
    const last = new Map<string, Record<string, unknown>>()
    for (const r of ledger()) if (r.runId === runId) last.set(String(r.attemptId), r)
    return [...last.values()].filter((r) => r.stage !== 'countTokens' && r.status === 'settled').length
  }
  const rid1 = r1.ws?.runId ?? ''
  check('🔴 🔴 **장부 — judge ≤ 10 · draft ≤ 30 · 둘 다 실제로 불렸다**',
    paid(`${rid1}-j`) > 0 && paid(`${rid1}-j`) <= 10 && paid(`${rid1}-d`) > 0 && paid(`${rid1}-d`) <= 30,
    `judge ${paid(`${rid1}-j`)} · draft ${paid(`${rid1}-d`)}`)
  check('🔴 🔴 **러너가 단계 env 상한 10 · 30 을 실었다** (자식 로그)',
    /회차 요청 상한 10/.test(r1.out) && /회차 요청 상한 30/.test(r1.out))

  // ── 큐 · 글 중복 ──
  const perSource = async (): Promise<Map<string, number>> => {
    const rows = await prisma.originalPostApprovalQueue.findMany({ select: { rawContent: { select: { sourceSite: true, sourceArticleId: true } } } })
    const m = new Map<string, number>()
    for (const r of rows) {
      const o = originalSourceOf(r.rawContent?.sourceSite, r.rawContent?.sourceArticleId)
      if (o === null || !o.id.startsWith('dup')) continue
      const k = `${o.site}|${o.id}`
      m.set(k, (m.get(k) ?? 0) + 1)
    }
    return m
  }
  const q1 = await perSource()
  const loaded1 = [...q1.entries()].filter(([k]) => !/\|dup[123]$/.test(k)).map(([k]) => k.split('|')[1]!)
  check('🔴 1회차가 후보를 실제로 적재했다 (가짜 provider · 격리 DB)', loaded1.length > 0, [...q1.entries()].map(([k, n]) => `${k}:${n}`).join(' '))
  check('🔴 🔴 **원천마다 큐 행 ≤ 1 — 중복 0**', [...q1.values()].every((n) => n === 1), [...q1.entries()].map(([k, n]) => `${k}:${n}`).join(' '))

  const r2At = new Date(r1At.getTime() + 4 * 3600e3)
  const r2 = runOnce(r2At)
  const ids2 = r2.ws?.sourceIds ?? []
  check('🔴 🔴 **2회차 묶음에 1회차가 적재한 원천이 없다** — 재시도로도 다시 뽑히지 않는다',
    loaded1.every((x) => !ids2.includes(x)), `적재 ${loaded1.join(',')} · 2회차 ${ids2.join(',')}`)
  const q2 = await perSource()
  check('🔴 🔴 **2회차 뒤에도 원천마다 큐 행 ≤ 1 — 중복 Queue 0**', [...q2.values()].every((n) => n === 1),
    [...q2.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k}:${n}`).join(' '))
  check('🔴 🔴 **러너는 Post 를 만들지 않았다 — 중복 Post 0**', (await prisma.post.count()) === postBefore)
  rmSync(T3, { recursive: true, force: true })
}

function same(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|')
}

await main()

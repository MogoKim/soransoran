#!/usr/bin/env tsx
/**
 * 🔴 **공급 자동 READY 마감 — 격리 Postgres 전용** (2026-10-27)
 *
 *   06:15 공급이 적재한 자동 적격 행을 같은 lease 안에서 정본 도장 회차(`stampRoundAuditAware`)로 도장해
 *   07:00 controller 전에 재고 상태를 확정한다. 실제 러너(`supply-process.mts`)를 임시 cwd · 임시 HOME 에서
 *   자식 프로세스로 돌리고, 변이는 **임시 복사본**에만 건다(저장소 파일은 건드리지 않는다).
 *
 *   A 미도장 적격 3 → 마감 → cohort 모름 3→0 · 수율 구간이 닫힌다(마감 전 = 마감 제거와 같은 상태 = 모름 3)
 *   B 자동 부적격(HOLD · gate FAIL · 의미 경고)은 미도장 · READY 분자 제외
 *   C 옛 품질 계약 · 스위치 OFF · 감사 닫힘 → 도장 0
 *   D 적재 commit 뒤 마감 실패 → exit 1 · 다음 live NO_INPUT 회차가 복구
 *   E dry-run · kill 닫힘 · lease 증명 없음 → Queue write 0
 *   F 동시 마감 · 발행 러너 도장 경쟁 → 행마다 도장 한 번
 *   G Post · Persona · PersonaActivityLog write 0
 *   H 공급 마감이 실패해도 발행 러너 도장(회복 경로)이 남는다
 *   I 연결 제거 · 게이트 뒤집기 · 실패 삼킴 · 순서 뒤집기 변이 — 자식이 실제로 돈(적재 성공) 변이만 센다
 *   R race 재시도 — race 0 → 1회 · race 뒤 성공 → 2회 done · 계속 race → 2회 failed(회차 failed)
 *     · 재시도 제거 · persistent race 성공 처리 변이 · 정본 replenishmentOf/judgeAgainst 로 실측 구간(UNKNOWN → ok)
 *
 * ── 격리 Postgres 세우는 법 ── `scripts/auto-ready-db-check.mts` 머리말과 같다.
 *   export DATABASE_URL=postgresql://soran@127.0.0.1:<port>/soran_test DIRECT_URL=$DATABASE_URL SORAN_ISOLATED_DB=yes-throwaway
 *   npx prisma migrate deploy && npm run supply:auto-ready-finalize-db-check
 *   🔴 D · H · I 는 읽기 전용 역할(`soran_ro`)을 만들어 도장 write 를 실제로 실패시킨다(격리 DB 안에서만).
 */
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PrismaClient } from '@prisma/client'

import { AUTO_DECIDER, HUMAN_DECIDER, eligibilityOf } from '../src/lib/auto-ready-v2'
import { authoritativeGate } from '../src/lib/auto-ready-repo'
import { RETRYABLE_NOTE_PREFIX, stampRoundAuditAware } from '../src/lib/auto-ready-audit-store'
import { closeRunStatus, finalizeAutoReady, mayFinalizeAutoReady } from '../src/lib/supply-process'
import { judgeAgainst, replenishmentOf, type ReadyCohortFact } from '../src/lib/stage-ladder-generic'
import { MACHINE_PROMPT_VERSION, MACHINE_MODEL, MACHINE_SITE_PREFIX, MACHINE_PROFILE } from '../src/lib/micro-seed-supply-autofill'
import { fakeEvidenceGate } from './lib/fake-source-evidence.mjs'
import { currentQualityContract, QUALITY_CONTRACT_KEY } from '../src/lib/quality-contract'
import { EVIDENCE_REVIEW_KEY, EVIDENCE_REVIEW_CONTRACT, bindingOf, digestOf as evDigest } from '../src/lib/auto-ready-evidence'
import { WORKSET_KIND, WORKSET_VERSION_JIT, SUPPLY_JIT_CONTRACT, SUPPLY_INTENT_KEY, worksetFileName } from '../src/lib/supply-workset'
import { articleIdHashOf } from '../src/lib/source-slot-release'
import { readReadyCohort } from './lib/stage-preflight-facts.mjs'
import { fakeLockfEnv } from './lib/fake-lockf.mjs'

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
/** 🔴 같은 격리 DB 의 읽기 전용 역할 — 도장 UPDATE 가 권한 오류로 throw 한다 */
const RO_URL = URL.replace(/^postgresql:\/\/[^@/]*@/, 'postgresql://soran_ro@')

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else {
    fail += 1; console.log(`  ❌ ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const REPO = realpathSync(join(dirname(fileURLToPath(import.meta.url)), '..'))
const NOW = new Date()
const ON = { SORAN_AUTO_READY_ENABLED: 'on' } as const
const GOOD_SR = { complete: true, deterministicPass: true, unsupportedAdditions: 0, lifeContradictions: 0, droppedFromSource: 0, confidence: 0.9 }
const QUALITY = currentQualityContract()
const RUN = `${NOW.toISOString().slice(0, 10).replace(/-/g, '')}-061500`
const SLOT_ISO = new Date(NOW.getTime() + 3 * 3_600_000).toISOString()
const SITE = `${MACHINE_SITE_PREFIX}navercafe:fin`

const gate = (o: { sr?: unknown; holds?: string[]; legacy?: boolean; id: string; intent?: boolean }): Record<string, unknown> => ({
  holds: o.holds ?? [], blocks: [], semanticReview: o.sr ?? GOOD_SR,
  ...fakeEvidenceGate(NOW, { site: SITE, id: o.id }),
  ...(o.legacy === true ? {} : { [QUALITY_CONTRACT_KEY]: QUALITY }),
  autoDraft: {
    provenance: MACHINE_PROFILE.envelopeProvenance, sourceDecision: MACHINE_PROFILE.sourceDecision,
    draftRuleVersion: MACHINE_PROFILE.envelopeRuleVersion,
  },
  // 🔴 적재기가 묶음에서 옮겨 적는 공급 의도 — cohort 가 이 행을 이 회차 원천으로 센다
  ...(o.intent === false ? {} : {
    [SUPPLY_INTENT_KEY]: {
      contract: SUPPLY_JIT_CONTRACT, runId: RUN, sourceHash: articleIdHashOf(SITE, o.id),
      intendedSlotAt: SLOT_ISO, ageAtSlotH: 5, qualityContract: QUALITY,
    },
  }),
})

const humanReviewed = (title: string, body: string) => ({
  [EVIDENCE_REVIEW_KEY]: [{
    contract: EVIDENCE_REVIEW_CONTRACT, reviewer: 'human:founder', reviewerUserId: 'fixture-founder',
    ...bindingOf({ status: 'PUBLISHED', draftTitle: title, draftBody: body, editedTitle: null, editedBody: null, declineReason: null }),
    hardDefect: 'no', reasons: [], bundleDigest: evDigest('fixture-bundle'), reviewedAt: '2026-09-25T00:00:00Z',
  }],
})

async function main(): Promise<void> {
  const prisma = new PrismaClient()
  console.log('\n══ 공급 자동 READY 마감 (격리 DB 전용 · 운영 DB 0 · 임시 cwd/HOME · 변이는 임시 복사본) ══\n')
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AutoReadyAudit","PersonaActivityLog","OriginalPostApprovalQueue","MicroSeedRawContent","Post","Persona","User" CASCADE',
  )
  // 🔴 읽기 전용 역할 — 격리 DB 안에서만 만든다(D · H · I)
  await prisma.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'soran_ro') THEN CREATE ROLE soran_ro LOGIN; END IF; END $$`)
  await prisma.$executeRawUnsafe('GRANT USAGE ON SCHEMA public TO soran_ro')
  await prisma.$executeRawUnsafe('GRANT SELECT ON ALL TABLES IN SCHEMA public TO soran_ro')

  let seq = 0
  const raw = async (id: string) => prisma.microSeedRawContent.create({
    data: {
      origin: 'live', sourceSite: SITE, sourceUrl: `https://example.invalid/${id}`, sourceArticleId: id,
      sourceCapturedAt: new Date(NOW.getTime() - 2 * 864e5), rawTitle: `원문 ${id}`, rawBody: `원문 본문 ${id}`,
    },
    select: { id: true },
  })
  const machineRow = async (o: { sr?: unknown; holds?: string[]; legacy?: boolean; verdict?: string; intent?: boolean } = {}) => {
    seq += 1
    const id = `fin-${seq}`
    const r = await raw(id)
    return prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'APPROVED', draftTitle: `평범한 하루 이야기 ${seq}`,
        draftBody: `아침에 산책을 다녀왔어요 ${seq}. 다들 어떻게 지내세요?`,
        gateVerdict: o.verdict ?? 'PASS', gateResults: gate({ ...o, id }) as never,
        promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        decidedBy: 'machine:auto-draft-v5', dedupKey: `fin-dk-${seq}`,
      },
      select: { id: true },
    })
  }
  // ── 증거 30 — 정본 열림(지금 계약 · 사람 결함 0) ──
  const author = (await prisma.user.create({ data: { nickname: '증거작성' }, select: { id: true } })).id
  for (let i = 0; i < 30; i += 1) {
    const r = await raw(`ev-${i}`)
    const post = await prisma.post.create({
      data: { boardType: 'FREE', title: `사람이 본 글 ${i}`, content: `사람이 본 본문 ${i}`, authorId: author }, select: { id: true },
    })
    await prisma.originalPostApprovalQueue.create({
      data: {
        sourceRawContentId: r.id, status: 'PUBLISHED', draftTitle: `사람이 본 글 ${i}`, draftBody: `사람이 본 본문 ${i}`,
        gateVerdict: 'PASS', gateResults: gate({ id: `ev-${i}`, intent: false }) as never,
        promptVersion: MACHINE_PROMPT_VERSION, model: MACHINE_MODEL,
        decidedBy: HUMAN_DECIDER, createdPostId: post.id, dedupKey: `fin-ev-${i}`,
        editDiff: humanReviewed(`사람이 본 글 ${i}`, `사람이 본 본문 ${i}`) as never,
      },
    })
  }
  const open = await authoritativeGate(prisma, ON)
  check('전제 — 정본 열림(증거 30 · 결함 0)', open.open, open.reasons.join(' · '))

  // ── 오늘 형태: 적격 3 + 부적격 3(HOLD · gate FAIL · 의미 경고) + 옛 계약 1 ──
  const eligible = [await machineRow(), await machineRow(), await machineRow()]
  const hold = await machineRow({ holds: ['CONTENT_CORE_FORBIDDEN_PHRASE'] })
  const gateFail = await machineRow({ verdict: 'FAIL' })
  const semantic = await machineRow({ sr: { ...GOOD_SR, lifeContradictions: 1 }, holds: ['SEMANTIC_LIFE_CONTRADICTION:1'] })
  const legacy = await machineRow({ legacy: true, intent: false })
  const ineligible = [hold.id, gateFail.id, semantic.id]
  const fixtureIds = [...eligible.map((x) => x.id), ...ineligible, legacy.id]
  const rowsOf = async (ids: readonly string[]) => (await prisma.originalPostApprovalQueue.findMany({
    where: { id: { in: [...ids] } }, select: { id: true, decidedBy: true, updatedAt: true, editDiff: true }, orderBy: { id: 'asc' },
  })).map((r) => `${r.id}|${r.decidedBy}|${r.updatedAt.toISOString()}|${JSON.stringify(r.editDiff)}`).join('\n')
  const stampedOf = async (ids: readonly string[]): Promise<number> =>
    prisma.originalPostApprovalQueue.count({ where: { id: { in: [...ids] }, decidedBy: AUTO_DECIDER } })
  const unstamp = async (ids: readonly string[]): Promise<void> => {
    // 🔴 격리 DB fixture 되돌리기 — 변이가 찍은 도장을 지운다
    await prisma.originalPostApprovalQueue.updateMany({
      where: { id: { in: [...ids] } }, data: { decidedBy: 'machine:auto-draft-v5', decidedAt: null, editDiff: {} as never },
    })
  }
  for (const id of ineligible) {
    const r = await prisma.originalPostApprovalQueue.findUniqueOrThrow({ where: { id } })
    check(`전제 — 정본 eligibilityOf 가 ${id} 를 자동 부적격으로 본다`,
      !eligibilityOf({ gateVerdict: r.gateVerdict, gateResults: r.gateResults, title: r.draftTitle, body: r.draftBody }).auto)
  }

  // ── cohort — preflight 정본 판독기(readReadyCohort) 그대로 ──
  const wsDir = mkdtempSync(join(tmpdir(), 'fin-ws-'))
  writeFileSync(join(wsDir, worksetFileName(RUN)), JSON.stringify({
    kind: WORKSET_KIND, version: WORKSET_VERSION_JIT, contract: SUPPLY_JIT_CONTRACT, qualityContract: QUALITY, runId: RUN,
    takenAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(), limit: 10,
    sources: Array.from({ length: 10 }, (_, i) => ({
      sourceSite: SITE, sourceArticleId: i < 6 ? `fin-${i + 1}` : `fin-fill-${i}`, slotAt: SLOT_ISO, ageAtSlotH: 5,
    })),
  }))
  const cohort = () => readReadyCohort(prisma, {
    windowFrom: new Date(NOW.getTime() - 864e5), windowTo: new Date(NOW.getTime() + 864e5), dataDir: wsDir,
    matched: new Set(eligible.map((x) => x.id)), horizon: [new Date(SLOT_ISO)], now: NOW,
  })

  console.log('\nA·B 마감 전 — 오늘 형태')
  const c0 = await cohort()
  check('🔴 🔴 **마감 전(= 마감 제거 변이와 같은 상태): 미도장 자동 적격 3 = 모름 3 · 부적격 3 은 분자 제외**',
    c0.fates !== null && c0.fates.unknown === 3 && c0.autoIneligibleExcluded === 3 && c0.intentMismatches.length === 0,
    JSON.stringify({ f: c0.fates, ex: c0.autoIneligibleExcluded, m: c0.intentMismatches, n: c0.notes }))
  check('🔴 마감 전 수율 구간이 벌어져 있다(필요 READY 구간 = 모름이 키운다)',
    c0.yieldBounds !== null && c0.yieldBounds.high > c0.yieldBounds.low, JSON.stringify(c0.yieldBounds))

  // ── 임시 러너 트리 ──
  const mkTree = (): string => {
    const t = realpathSync(mkdtempSync(join(tmpdir(), 'fin-cwd-')))
    for (const x of ['scripts', 'src', 'package.json', 'tsconfig.json']) cpSync(join(REPO, x), join(t, x), { recursive: true })
    symlinkSync(realpathSync(join(REPO, 'node_modules')), join(t, 'node_modules'))
    mkdirSync(join(t, '.microseed-data'), { recursive: true })
    return t
  }
  const H = realpathSync(mkdtempSync(join(tmpdir(), 'fin-home-')))
  const T = mkTree()
  type Run = { code: number | null; out: string }
  const runner = (o: { tree?: string; live: boolean; kill: boolean; auto: boolean; url?: string }): Run => {
    const tree = o.tree ?? T
    const env: Record<string, string> = {
      ...Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined)),
      HOME: H, ...fakeLockfEnv(H), DATABASE_URL: o.url ?? URL, DIRECT_URL: o.url ?? URL,
      NODE_OPTIONS: `--import=${join(REPO, 'scripts', 'lib', 'fake-provider-hook.mjs')}`,
    }
    delete env.SORAN_SUPPLY_PROCESS_ENABLED
    delete env.SORAN_AUTO_READY_ENABLED
    if (o.kill) env.SORAN_SUPPLY_PROCESS_ENABLED = 'true'
    if (o.auto) env.SORAN_AUTO_READY_ENABLED = 'on'
    const r = spawnSync(join(REPO, 'node_modules', '.bin', 'tsx'), [join(tree, 'scripts', 'supply-process.mts'), ...(o.live ? ['--live'] : [])], {
      cwd: tree, encoding: 'utf-8', timeout: 300_000, env,
    })
    return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
  }
  const counts = async () => [await prisma.post.count(), await prisma.persona.count(), await prisma.personaActivityLog.count(), await prisma.user.count()].join(',')
  const baseCounts = await counts()
  const ran = (r: Run): boolean => /④ 돌지 않는다 — 미처리 입력이 없다/.test(r.out)

  console.log('\nE dry-run · kill 닫힘 · lease 증명 없음 → Queue write 0')
  {
    const before = await rowsOf(fixtureIds)
    const dry = runner({ live: false, kill: true, auto: true })
    check('🔴 dry-run(--live 없음) — 정상 no-op · Queue 불변', dry.code === 0 && ran(dry) && await rowsOf(fixtureIds) === before, dry.out.slice(-600))
    const noKill = runner({ live: true, kill: false, auto: true })
    check('🔴 --live 지만 kill 스위치 닫힘 — Queue 불변', noKill.code === 0 && ran(noKill) && await rowsOf(fixtureIds) === before, noKill.out.slice(-600))
    check('🔴 lease 증명 없음 · dry-run · kill 닫힘 → 마감하지 않는다(판정 함수)',
      !mayFinalizeAutoReady({ live: true, killOpen: true, leased: false }) && !mayFinalizeAutoReady({ live: false, killOpen: true, leased: true })
      && !mayFinalizeAutoReady({ live: true, killOpen: false, leased: true }) && mayFinalizeAutoReady({ live: true, killOpen: true, leased: true }))
  }

  console.log('\nC 스위치 OFF · 감사 닫힘 → 도장 0')
  {
    const before = await rowsOf(fixtureIds)
    const off = runner({ live: true, kill: true, auto: false })
    check('🔴 자동 READY 스위치 OFF — live NO_INPUT 회차가 돌아도 도장 0', off.code === 0 && ran(off) && /스위치 꺼짐/.test(off.out)
      && await rowsOf(fixtureIds) === before, off.out.slice(-600))
    const ev0 = await prisma.originalPostApprovalQueue.findFirstOrThrow({ where: { dedupKey: 'fin-ev-0' }, select: { id: true, createdPostId: true } })
    await prisma.autoReadyAudit.create({
      data: {
        queueId: ev0.id, postId: ev0.createdPostId!, selectedAtN: 1, selectedTarget: 1,
        publishedTitleHash: 'a'.repeat(64), publishedBodyHash: 'b'.repeat(64), stampContractDigest: 'fixture',
        note: `${RETRYABLE_NOTE_PREFIX}{"code":"TIMEOUT","at":"${NOW.toISOString()}","attempts":1,"reason":"fixture"}`,
      },
    })
    const closed = runner({ live: true, kill: true, auto: true })
    check('🔴 감사 재시도 가능 실패(닫힘) — 마감은 closed 로 끝나고(실패 아님 · exit 0) 도장 0',
      closed.code === 0 && /closed \d+/.test(closed.out) && await rowsOf(fixtureIds) === before, closed.out.slice(-600))
    await prisma.autoReadyAudit.deleteMany({})
  }

  console.log('\nD 마감 실패(DB 권한 오류) → exit 1 · 도장 0 — 성공으로 숨기지 않는다')
  {
    const before = await rowsOf(fixtureIds)
    const ro = runner({ live: true, kill: true, auto: true, url: RO_URL })
    check('🔴 🔴 **도장 throw(읽기 전용 역할의 UPDATE 권한 오류) → 자동 READY 마감 실패 · exit 1 · Queue 불변**',
      ro.code === 1 && /자동 READY 마감 실패/.test(ro.out) && /permission denied/i.test(ro.out) && await rowsOf(fixtureIds) === before,
      ro.out.slice(-800))
    check('🔴 live 회차 최종 상태 — 마감 실패 · 마감 없음은 성공이 아니다',
      closeRunStatus([], { status: 'failed', at: 'x', error: 'e' }) === 'failed' && closeRunStatus([], undefined) === 'failed'
      && closeRunStatus([], { status: 'done', at: 'x', tally: { closed: 3 } }) === 'done')
    const thrown = await finalizeAutoReady({ stamp: async () => { throw new Error('boom') }, now: () => 'x' })
    check('🔴 throw 는 failed 로 남는다(closed · exception 은 품질 결과 — done)', thrown.status === 'failed' && thrown.error === 'boom')
  }

  console.log('\nR race 재시도 — 딱 한 번 · 두 번째도 race 면 실패')
  {
    /**
     * 🔴 정본 `finalizeAutoReady` 를 가짜 도장 회차로 돌리는 probe — 원본 · 변이 복사본에 같은 판을 쓴다.
     *    한 줄 JSON 을 내야 "유효 실행" 이다(변이가 import · 실행을 깨뜨려 잡힌 것은 세지 않는다).
     */
    const PROBE = `import { closeRunStatus, finalizeAutoReady } from '../src/lib/supply-process'
const run = async (rounds: [string, number][][]) => {
  let calls = 0
  const fin = await finalizeAutoReady({ stamp: async () => new Map(rounds[Math.min(calls++, rounds.length - 1)]), now: () => 'x' })
  return { calls, fin, close: closeRunStatus([], fin) }
}
console.log('PROBE ' + JSON.stringify({
  race0: await run([[['stamped', 3], ['race', 0]]]),
  quality: await run([[['closed', 3], ['exception', 1], ['skip', 2]]]),
  raceThenOk: await run([[['stamped', 2], ['race', 1]], [['stamped', 1]]]),
  persistent: await run([[['stamped', 0], ['race', 2]]]),
}))
`
    type ProbeRun = { calls: number; fin: { status: string; tally?: Record<string, number>; attempts?: number; persistentRace?: number; error?: string }; close: string }
    type Probe = { race0: ProbeRun; quality: ProbeRun; raceThenOk: ProbeRun; persistent: ProbeRun }
    const probeOf = (tree: string): Probe | null => {
      writeFileSync(join(tree, 'scripts', 'fin-race-probe.mts'), PROBE)
      const r = spawnSync(join(REPO, 'node_modules', '.bin', 'tsx'), [join(tree, 'scripts', 'fin-race-probe.mts')], { cwd: tree, encoding: 'utf-8', timeout: 120_000 })
      const line = (r.stdout ?? '').split('\n').find((l) => l.startsWith('PROBE '))
      return r.status === 0 && line !== undefined ? JSON.parse(line.slice('PROBE '.length)) as Probe : null
    }
    const verdicts = (p: Probe): Record<string, boolean> => ({
      race0: p.race0.calls === 1 && p.race0.fin.status === 'done' && p.race0.fin.attempts === 1 && p.race0.fin.tally?.stamped === 3 && p.race0.close === 'done',
      quality: p.quality.calls === 1 && p.quality.fin.status === 'done' && p.quality.close === 'done'
        && JSON.stringify(p.quality.fin.tally) === JSON.stringify({ closed: 3, exception: 1, skip: 2 }),
      raceThenOk: p.raceThenOk.calls === 2 && p.raceThenOk.fin.status === 'done' && p.raceThenOk.fin.attempts === 2
        && p.raceThenOk.fin.tally?.stamped === 3 && p.raceThenOk.fin.tally?.race === 1 && p.raceThenOk.close === 'done',
      persistent: p.persistent.calls === 2 && p.persistent.fin.status === 'failed' && p.persistent.fin.persistentRace === 2
        && p.persistent.fin.attempts === 2 && /persistent race 2/.test(p.persistent.fin.error ?? '') && p.persistent.close === 'failed',
    })
    const base = probeOf(T)
    const v = base === null ? null : verdicts(base)
    check('전제 — probe 유효 실행(원본)', base !== null)
    check('🔴 race 0 → 도장 회차 1회 · done', v?.race0 === true, JSON.stringify(base?.race0))
    check('🔴 closed · exception · skip 은 품질 결과 — 1회 · done(실패로 올리지 않는다)', v?.quality === true, JSON.stringify(base?.quality))
    check('🔴 🔴 **race 뒤 성공 → 2회 · done · tally 키별 합 · attempts 2**', v?.raceThenOk === true, JSON.stringify(base?.raceThenOk))
    check('🔴 🔴 **계속 race → 2회에서 멈춤 · failed(persistentRace 2) · closeRunStatus failed**', v?.persistent === true, JSON.stringify(base?.persistent))

    const LIB = readFileSync(join(REPO, 'src', 'lib', 'supply-process.ts'), 'utf-8')
    const raceMutants: { name: string; from: string; to: string; caught: (x: Record<string, boolean>) => boolean }[] = [
      {
        name: 'race 재시도 제거', from: '} while (race > 0 && attempts < AUTO_READY_FINALIZE_MAX_ATTEMPTS)', to: '} while (false)',
        caught: (x) => !x.raceThenOk,
      },
      {
        name: 'persistent race 성공 처리', from: 'if (race > 0) {', to: 'if (race > 0 && false) {',
        caught: (x) => !x.persistent,
      },
    ]
    for (const m of raceMutants) {
      const hits = LIB.split(m.from).length - 1
      if (hits !== 1) { check(`변이 지점 ${m.name} — 정확히 1곳`, false, `${hits}곳`); continue }
      const t = mkTree()
      writeFileSync(join(t, 'src', 'lib', 'supply-process.ts'), LIB.replace(m.from, m.to))
      const p = probeOf(t)
      check(`🔴 변이 검출 — ${m.name} (유효 실행)`, p !== null && m.caught(verdicts(p)), JSON.stringify(p))
      rmSync(t, { recursive: true, force: true })
    }

    /**
     * 🔴 2026-10-27 실측 cohort — 정본 `replenishmentOf` · `judgeAgainst` 그대로(수치를 다시 계산하지 않는다).
     *    목표 10 · 용량 14. 마감 전 미도장 3 = 모름 → 구간 10~18 → UNKNOWN. 마감 뒤 예정 3 → 10 = 10 → ok.
     */
    const TARGET = 10
    const fits = (need: number): boolean => need <= 14
    const fact = (f: Omit<ReadyCohortFact, 'usdPerSlotValidResult'>): ReadyCohortFact => ({ ...f, usdPerSlotValidResult: null })
    const rawOf = (f: ReadyCohortFact): number => f.published + f.lost + f.scheduled + f.unknown
    const beforeF = fact({ sources: 35, published: 4, lost: 0, scheduled: 0, unknown: 3 })
    const afterF = fact({ sources: 35, published: 4, lost: 0, scheduled: 3, unknown: 0 })
    const rb = replenishmentOf(TARGET, beforeF)
    const ra = replenishmentOf(TARGET, afterF)
    check('🔴 🔴 **마감 전 실측(원천 35 · raw 7 · 공개 4 · 손실 0 · 예정 0 · 모름 3) → min 10 · max 18 · judge unknown**',
      rawOf(beforeF) === 7 && rb.min === 10 && rb.max === 18 && judgeAgainst(rb, fits) === 'unknown', JSON.stringify(rb))
    check('🔴 🔴 **마감 뒤 실측(원천 35 · raw 7 · 공개 4 · 손실 0 · 예정 3 · 모름 0) → min = max 10 · judge ok**',
      rawOf(afterF) === 7 && ra.min === 10 && ra.max === 10 && judgeAgainst(ra, fits) === 'ok', JSON.stringify(ra))
  }

  console.log('\nI 변이 — 임시 복사본만 · 자식이 실제로 돈 변이만 센다')
  {
    const SRC = readFileSync(join(REPO, 'scripts', 'supply-process.mts'), 'utf-8')
    const mutants: { name: string; from: string; to: string; probe: (t: string) => Promise<boolean> }[] = [
      {
        name: 'NO_INPUT 마감 연결 제거', from: 'const fin = await finalizeIfLeased()', to: 'const fin = null as AutoReadyFinalize | null',
        probe: async (t) => { const r = runner({ tree: t, live: true, kill: true, auto: true }); const n = await stampedOf(eligible.map((x) => x.id)); await unstamp(eligible.map((x) => x.id)); return ran(r) && n !== 3 },
      },
      {
        name: 'lease/live 게이트 뒤집기(dry-run 에서도 도장)', from: 'if (!mayFinalizeAutoReady({ live: LIVE, killOpen, leased })) return null',
        to: 'if (mayFinalizeAutoReady({ live: LIVE, killOpen, leased }) === null) return null',
        probe: async (t) => { const r = runner({ tree: t, live: false, kill: true, auto: true }); const n = await stampedOf(eligible.map((x) => x.id)); await unstamp(eligible.map((x) => x.id)); return ran(r) && n > 0 },
      },
      {
        name: '마감 실패 삼킴(exit 0)', from: "if (fin?.status === 'failed') {", to: "if (fin?.status === 'failed' && false) {",
        probe: async (t) => { const r = runner({ tree: t, live: true, kill: true, auto: true, url: RO_URL }); return ran(r) && r.code === 0 },
      },
    ]
    for (const m of mutants) {
      const hits = SRC.split(m.from).length - 1
      if (hits !== 1) { check(`변이 지점 ${m.name} — 정확히 1곳`, false, `${hits}곳`); continue }
      const t = mkTree()
      writeFileSync(join(t, 'scripts', 'supply-process.mts'), SRC.replace(m.from, m.to))
      check(`🔴 변이 검출 — ${m.name}`, await m.probe(t))
      rmSync(t, { recursive: true, force: true })
    }
  }

  console.log('\nA·D·G 마감 — live NO_INPUT 회차가 남은 미도장 행을 다시 집는다')
  {
    const ineligibleBefore = await rowsOf([...ineligible, legacy.id])
    const live = runner({ live: true, kill: true, auto: true })
    check('🔴 🔴 **새 입력 파일 없이 live 회차 — 적격 3행 도장 · exit 0**',
      live.code === 0 && ran(live) && await stampedOf(eligible.map((x) => x.id)) === 3 && /stamped 3/.test(live.out), live.out.slice(-800))
    check('🔴 🔴 **부적격 3 · 옛 계약 1 — 미도장 · 행 불변**', await rowsOf([...ineligible, legacy.id]) === ineligibleBefore)
    check('🔴 🔴 **Post · Persona · PersonaActivityLog · User write 0**', await counts() === baseCounts, `${baseCounts} → ${await counts()}`)
    const c1 = await cohort()
    check('🔴 🔴 **마감 뒤 cohort 모름 3 → 0 · 예정 3 · 부적격 분자 제외 3 그대로**',
      c1.fates !== null && c1.fates.unknown === 0 && c1.fates.scheduled === 3 && c1.autoIneligibleExcluded === 3,
      JSON.stringify({ f: c1.fates, ex: c1.autoIneligibleExcluded, n: c1.notes }))
    check('🔴 🔴 **수율 구간이 닫힌다(low = high) — 필요 READY 구간 상한이 모름으로 커지지 않는다**',
      c1.yieldBounds !== null && c1.yieldBounds.low === c1.yieldBounds.high && c1.yieldBounds.low === c0.yieldBounds!.high, JSON.stringify(c1.yieldBounds))
    const snap = await rowsOf(fixtureIds)
    const again = runner({ live: true, kill: true, auto: true })
    check('🔴 다시 돌아도 이미 도장된 행 write 0 (멱등)', again.code === 0 && await rowsOf(fixtureIds) === snap, again.out.slice(-400))
  }

  console.log('\nF 동시 마감 두 회차 + 발행 러너 도장 → 행마다 도장 한 번')
  {
    const many: string[] = []
    for (let i = 0; i < 25; i += 1) many.push((await machineRow({ intent: false })).id)
    const stamp = () => stampRoundAuditAware(prisma, { env: ON, now: new Date() })
    const [f1, f2, pub] = await Promise.all([
      finalizeAutoReady({ stamp, now: () => new Date().toISOString() }),
      finalizeAutoReady({ stamp, now: () => new Date().toISOString() }),
      stamp(),
    ])
    const reported = [f1, f2].reduce((n, f) => n + (f.status === 'done' ? (f.tally.stamped ?? 0) : 0), 0) + (pub.get('stamped') ?? 0)
    const actual = await stampedOf(many)
    check('🔴 🔴 **보고한 stamped 합 = 실제 도장 행 수 (중복 write 0)**', reported === actual && f1.status === 'done' && f2.status === 'done',
      `보고 ${reported} · 실제 ${actual}`)
    const rest = await stamp()
    check('🔴 진 묶음(race)은 다음 회차가 마저 찍는다 — 전부 정확히 한 번', await stampedOf(many) === many.length
      && actual + (rest.get('stamped') ?? 0) === many.length)
  }

  console.log('\nH 공급 마감 실패 → 발행 러너 도장(회복 경로)이 찍는다')
  {
    const left = [(await machineRow({ intent: false })).id, (await machineRow({ intent: false })).id]
    const ro = runner({ live: true, kill: true, auto: true, url: RO_URL })
    check('공급 마감 실패 — 2행 미도장', ro.code === 1 && await stampedOf(left) === 0)
    const pub = await stampRoundAuditAware(prisma, { env: ON, now: new Date() })
    check('🔴 🔴 **발행 러너와 같은 호출(stampRoundAuditAware)이 남은 2행을 찍는다**', await stampedOf(left) === 2 && pub.get('stamped') === 2)
    const src = readFileSync(join(REPO, 'scripts', 'original-post-auto-publish.mts'), 'utf-8')
    check('🔴 발행 러너의 도장 호출은 그대로다', /await stampRoundAuditAware\(prisma, \{ env: process\.env, now: RUN_AT \}\)/.test(src))
    check('🔴 Post · Persona · ActivityLog · User 불변(전 구간)', await counts() === baseCounts)
  }

  /**
   * ── 입력이 있는 live 경로 — 후보 파일 하나(빈 목록)로 공통 국면을 지나 마감까지 간다 ──
   *    회차 기록(`*.run.json`)의 최종 상태 · `autoReady` 칸을 본다.
   */
  console.log('\nD·I live(입력 있음) 경로 — 회차 기록 · 급사 · 순서 변이')
  {
    const SRC = readFileSync(join(REPO, 'scripts', 'supply-process.mts'), 'utf-8')
    const withInput = (src: string = SRC): string => {
      const t = mkTree()
      writeFileSync(join(t, 'scripts', 'supply-process.mts'), src)
      writeFileSync(join(t, '.microseed-data', 'auto-draft-20261027-000000.candidates.json'), '[]\n')
      return t
    }
    const runRecord = (t: string): { status?: string; autoReady?: { status?: string } } | null => {
      const dir = join(t, '.microseed-data')
      const f = readdirSync(dir).find((x) => /^supply-process-.*\.run\.json$/.test(x))
      return f === undefined ? null : JSON.parse(readFileSync(join(dir, f), 'utf-8'))
    }
    const liveRan = (r: Run): boolean => /⑤ 실행 — 기록/.test(r.out)
    const fresh = async (): Promise<string[]> => [(await machineRow({ intent: false })).id, (await machineRow({ intent: false })).id]

    const okRows = await fresh()
    const t1 = withInput()
    const ok = runner({ tree: t1, live: true, kill: true, auto: true })
    const rec1 = runRecord(t1)
    check('🔴 🔴 **입력 있는 live 회차 — 마감 도장 2 · 회차 done · autoReady done**',
      ok.code === 0 && liveRan(ok) && await stampedOf(okRows) === 2 && rec1?.status === 'done' && rec1.autoReady?.status === 'done',
      `${ok.out.slice(-500)} ${JSON.stringify(rec1?.autoReady)}`)

    const roRows = await fresh()
    const t2 = withInput()
    const ro = runner({ tree: t2, live: true, kill: true, auto: true, url: RO_URL })
    const rec2 = runRecord(t2)
    check('🔴 🔴 **적재 국면 뒤 마감 throw — 회차 failed · autoReady failed · exit 1 (성공 기록 금지)**',
      ro.code === 1 && liveRan(ro) && rec2?.status === 'failed' && rec2.autoReady?.status === 'failed' && await stampedOf(roRows) === 0,
      `${ro.out.slice(-500)} ${JSON.stringify(rec2)}`)

    // 🔴 급사 주입(변이 검출이 아니다) — 마감 직전 SIGKILL: 기록은 running 으로 남고 done 이 아니다
    const crash = 'record.autoReady = (await finalizeIfLeased()) ?? undefined'
    const t3 = withInput(SRC.replace(crash, `process.kill(process.pid, 'SIGKILL')\n  ${crash}`))
    const died = runner({ tree: t3, live: true, kill: true, auto: true })
    const rec3 = runRecord(t3)
    check('🔴 🔴 **적재 국면 뒤 마감 전 급사 — 회차 기록 running(성공 아님) · 도장 0**',
      SRC.split(crash).length === 2 && died.code !== 0 && liveRan(died) && rec3?.status === 'running' && await stampedOf(roRows) === 0,
      `${died.code} ${JSON.stringify(rec3)}`)
    const recover = runner({ live: true, kill: true, auto: true })
    check('🔴 🔴 **다음 live NO_INPUT 회차가 남은 행을 복구 — 도장 2**', recover.code === 0 && ran(recover) && await stampedOf(roRows) === 2)

    const liveMutants: { name: string; from: string; to: string; probe: (t: string) => Promise<boolean> }[] = [
      {
        name: 'live 마감 줄 제거', from: crash, to: 'record.autoReady = undefined',
        probe: async (t) => { const rows = await fresh(); const r = runner({ tree: t, live: true, kill: true, auto: true }); return liveRan(r) && (await stampedOf(rows) !== 2 || runRecord(t)?.status !== 'done') },
      },
      {
        name: '마감 실패를 회차 상태에서 무시', from: 'record.status = closeRunStatus(record.stages, record.autoReady)',
        to: "record.status = record.stages.some((o) => o.status === 'failed') ? 'failed' : 'done'",
        probe: async (t) => { const r = runner({ tree: t, live: true, kill: true, auto: true, url: RO_URL }); return liveRan(r) && runRecord(t)?.status === 'done' },
      },
      {
        name: '순서 뒤집기(상태를 마감 전에 확정)', from: `${crash}\n  record.status = closeRunStatus(record.stages, record.autoReady)`,
        to: `record.status = closeRunStatus(record.stages, record.autoReady)\n  ${crash}`,
        probe: async (t) => { const rows = await fresh(); const r = runner({ tree: t, live: true, kill: true, auto: true }); return liveRan(r) && await stampedOf(rows) === 2 && runRecord(t)?.status !== 'done' },
      },
    ]
    for (const m of liveMutants) {
      const hits = SRC.split(m.from).length - 1
      if (hits !== 1) { check(`변이 지점 ${m.name} — 정확히 1곳`, false, `${hits}곳`); continue }
      const t = withInput(SRC.replace(m.from, m.to))
      check(`🔴 변이 검출 — ${m.name}`, await m.probe(t))
      rmSync(t, { recursive: true, force: true })
    }
    for (const t of [t1, t2, t3]) rmSync(t, { recursive: true, force: true })
    check('🔴 Post · Persona · ActivityLog · User 불변(live 경로 포함)', await counts() === baseCounts)
  }

  rmSync(T, { recursive: true, force: true })
  rmSync(H, { recursive: true, force: true })
  rmSync(wsDir, { recursive: true, force: true })
  await prisma.$disconnect()
  console.log(`\n${fail === 0 ? '✅' : '❌'} PASS ${pass} · FAIL ${fail}\n`)
  process.exit(fail === 0 ? 0 : 1)
}

await main()

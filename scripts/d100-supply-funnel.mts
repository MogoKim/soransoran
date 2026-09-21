#!/usr/bin/env tsx
/**
 * 공급 깔때기 **재대조** — 🔴 read-only. DB write 0 · 네트워크 0 · provider 0 · 파일 쓰기 0
 *
 * 🔴 **왜 따로 만드는가.** 준비도 계기판(`d100:readiness`)은 "올려도 되는가" 에 답한다.
 *    이 명령은 다른 질문에 답한다 — **"어느 칸에서 끊겼는가."**
 *
 * 🔴 **섞지 않는다**
 *      · 목록 출현 수 ≠ 카페의 고유 신규 글 수 (회차마다 같은 글이 다시 잡힌다)
 *      · backlog ≠ 하루 유입
 *      · 한 번의 회차 ÷ 일수 ≠ 일간 처리량
 *      · 계약 불일치 ≠ 오래된 글
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import {
  PIPELINE_STAGES, STAGE_LABEL, buildStageFacts, firstBrokenStage,
  rateOf, showRate, describeBacklog,
  type PipelineStage, type StageEvidence,
} from '../src/lib/d100-supply-funnel'
import { scanArtifacts } from './lib/d100-artifact-scan.mjs'
import { readRunRecords } from './lib/collect-run-store.mjs'
import { isDetailSuccess } from '../src/lib/collect-run-record'
import { SOURCE_FACTS } from '../src/lib/collect-schedule'
import { profileOf, machineReviewedByHuman, type AutoRow } from '../src/lib/original-post-auto-publish'
import { MACHINE_MODEL, MACHINE_PROMPT_VERSION, MACHINE_SITE_PREFIX, machineGateOk } from '../src/lib/micro-seed-supply-autofill'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const JSON_OUT = process.argv.slice(2).includes('--json')
const WINDOW_DAYS = 14
const NOW = new Date()
const SINCE = new Date(NOW.getTime() - WINDOW_DAYS * 86_400_000)

const APP_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran')
const envText = existsSync(join(APP_DIR, 'env.local'))
  ? readFileSync(join(APP_DIR, 'env.local'), 'utf-8') : ''
const envFlag = (name: string): boolean => new RegExp(`^${name}=true\\s*$`, 'm').test(envText)

const sh = (cmd: string, args: readonly string[]): string => {
  try { return execFileSync(cmd, args, { encoding: 'utf-8' }).trim() } catch { return '' }
}
const loadedJobs = new Set(
  sh('launchctl', ['list']).split('\n')
    .map((l) => l.split('\t')[2] ?? '').filter((n) => n.startsWith('com.soransoran.')),
)
const plistInstalled = (label: string): boolean =>
  existsSync(join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`))

// 🔴 접속 주소만 채운다 — 값은 어디에도 찍지 않는다
await loadEnvLocal()
for (const line of envText.split('\n')) {
  const eq = line.indexOf('=')
  if (eq <= 0) continue
  const k = line.slice(0, eq).trim()
  if (k !== 'DATABASE_URL' && k !== 'DIRECT_URL') continue
  if ((process.env[k] ?? '') === '') process.env[k] = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
}

// ─────────────────────────────────────────────────────────
// ① 카페별 수집 재대조 — 🔴 칸마다 무엇을 센 것인지 이름을 남긴다
// ─────────────────────────────────────────────────────────
type CafeRow = {
  cafe: string
  /** 🔴 목록에 **나타난 횟수**(중복 포함). 고유 신규 글 수가 아니다 */
  listAppearances: number
  listFiles: number
  detailRequests: number
  bodyCaptured: number
  /** 🔴 1차 분류를 지나 새로 남은 고유 thin 원천 */
  newUniqueThin: number
  /** 이미 본 글이라 상세를 열지 않은 수 */
  skippedSeen: number
  /** 상세까지 열었는데 이미 있던 글 */
  repeated: number
  successRuns: number
  failedRuns: number
  /** 🔴 설정된 회차당 상세 상한 */
  configuredDetailPerRun: number | null
  adaptLines: number
  lastListAtMs: number | null
  lastThinAtMs: number | null
  lastAdaptAtMs: number | null
}

const CAFES = [
  { cafe: 'wgang', source: 'navercafe:wgang', job: 'com.soransoran.navercafe-collect-wgang-multi' },
  { cafe: 'remonterrace', source: 'navercafe:remonterrace', job: 'com.soransoran.navercafe-collect-remonterrace-multi' },
] as const

const cafeRows: CafeRow[] = CAFES.map((c) => {
  const runs = readRunRecords(c.source).filter((r) => {
    const t = Date.parse(r.startedAt)
    return Number.isFinite(t) && t >= SINCE.getTime()
  })
  const ok = runs.filter(isDetailSuccess)
  const list = scanArtifacts({ prefix: `navercafe-${c.cafe}-`, suffix: '.list.jsonl', sinceMs: SINCE.getTime() })
  const thin = scanArtifacts({ prefix: `navercafe-thin-${c.cafe}-`, suffix: '.thin-detail.jsonl', sinceMs: SINCE.getTime() })
  const adapt = scanArtifacts({ prefix: `82cook-adapt-${c.cafe}-`, suffix: '.detail.jsonl', sinceMs: SINCE.getTime() })
  const facts = SOURCE_FACTS.find((f) => f.id === c.source)
  const sum = (f: (r: typeof runs[number]) => number): number => runs.reduce((n, r) => n + f(r), 0)
  return {
    cafe: c.cafe,
    listAppearances: list.lines, listFiles: list.files,
    detailRequests: sum((r) => r.detailRequests ?? 0),
    bodyCaptured: sum((r) => r.bodyRows ?? 0),
    newUniqueThin: ok.reduce((n, r) => n + (r.newUniqueThinRows ?? 0), 0),
    skippedSeen: sum((r) => r.skippedSeen ?? 0),
    repeated: sum((r) => r.repeatedRows ?? 0),
    successRuns: ok.length, failedRuns: runs.filter((r) => r.status === 'failed').length,
    configuredDetailPerRun: facts?.detailPerRun ?? null,
    adaptLines: adapt.lines,
    lastListAtMs: list.lastAtMs, lastThinAtMs: thin.lastAtMs, lastAdaptAtMs: adapt.lastAtMs,
  }
})

// ─────────────────────────────────────────────────────────
// ② 큐 재대조 — 🔴 backlog 와 유입을 가른다
// ─────────────────────────────────────────────────────────
const prisma = new PrismaClient()
type QueueRead = {
  ok: boolean
  detail?: string
  total: number
  createdInWindow: number
  contractOk: number
  contractMismatch: number
  mismatchByField: Record<string, number>
  humanReviewed: number
  humanReviewedInWindow: number
  personaMatched: number
  publishedInWindow: number
  backlogUsable: number
  lastCreatedAtMs: number | null
  createdDays: number
}
let q: QueueRead = {
  ok: false, total: 0, createdInWindow: 0, contractOk: 0, contractMismatch: 0,
  mismatchByField: {}, humanReviewed: 0, humanReviewedInWindow: 0, personaMatched: 0,
  publishedInWindow: 0, backlogUsable: 0, lastCreatedAtMs: null, createdDays: 0,
}
try {
  const raw = await prisma.originalPostApprovalQueue.findMany({
    select: {
      id: true, status: true, createdPostId: true, gateVerdict: true, promptVersion: true,
      model: true, matchedPersonaId: true, gateResults: true, decidedBy: true, decidedAt: true,
      createdAt: true, draftTitle: true, draftBody: true, editedTitle: true, editedBody: true,
      rawContent: { select: { sourceSite: true } },
    },
  })
  const asRow = (r: typeof raw[number]): AutoRow => ({
    id: r.id, status: r.status, createdPostId: r.createdPostId, gateVerdict: r.gateVerdict,
    promptVersion: r.promptVersion, model: r.model, matchedPersonaId: r.matchedPersonaId,
    gateResults: r.gateResults, title: r.editedTitle ?? r.draftTitle,
    body: r.editedBody ?? r.draftBody, sourceSite: r.rawContent.sourceSite,
    decidedBy: r.decidedBy, decidedAt: r.decidedAt, createdAt: r.createdAt,
  })
  const win = raw.filter((r) => r.createdAt >= SINCE)
  const mismatch: Record<string, number> = {}
  for (const r of win) {
    if (profileOf(asRow(r)) !== null) continue
    const bad = [
      r.promptVersion === MACHINE_PROMPT_VERSION ? '' : 'promptVersion',
      r.model === MACHINE_MODEL ? '' : 'model',
      r.rawContent.sourceSite.startsWith(MACHINE_SITE_PREFIX) ? '' : 'sourceSite',
      machineGateOk(r.gateResults) ? '' : 'gateResults',
    ].filter(Boolean).join('+') || '(알 수 없음)'
    mismatch[bad] = (mismatch[bad] ?? 0) + 1
  }
  const kst = (d: Date): string => new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
  q = {
    ok: true,
    total: raw.length,
    createdInWindow: win.length,
    contractOk: win.filter((r) => profileOf(asRow(r)) !== null).length,
    contractMismatch: win.filter((r) => profileOf(asRow(r)) === null).length,
    mismatchByField: mismatch,
    humanReviewed: raw.filter((r) => machineReviewedByHuman(r.decidedBy)).length,
    humanReviewedInWindow: win.filter((r) => machineReviewedByHuman(r.decidedBy)).length,
    personaMatched: win.filter((r) => r.matchedPersonaId !== null).length,
    publishedInWindow: win.filter((r) => r.createdPostId !== null && r.createdPostId !== '').length,
    backlogUsable: raw.filter((r) => profileOf(asRow(r)) !== null
      && (r.createdPostId === null || r.createdPostId === '')).length,
    lastCreatedAtMs: raw.length === 0 ? null
      : Math.max(...raw.map((r) => r.createdAt.getTime())),
    /**
     * 🔴 **계약을 맞춘 행이 생긴 날 수**다 (2026-09-21 보정).
     *
     *    처음에는 "행이 하나라도 생긴 날 수" 를 셌다. 그러면 계약 맞는 3건이 **하루에**
     *    몰려 나왔는데도 "10회차 · 0.2/day" 로 적혀, 열흘 동안 꾸준히 나온 것처럼 읽혔다.
     *    일간 값을 말할 자격은 **그 값이 실제로 여러 날 관측됐을 때만** 생긴다.
     */
    createdDays: new Set(
      win.filter((r) => profileOf(asRow(r)) !== null).map((r) => kst(r.createdAt)),
    ).size,
  }
} catch (e) {
  q = { ...q, ok: false, detail: e instanceof Error ? e.message : '알 수 없음' }
} finally {
  await prisma.$disconnect()
}

// ─────────────────────────────────────────────────────────
// ③ 칸별 사실 — 🔴 가동/정지/미측정
// ─────────────────────────────────────────────────────────
const judgeArt = scanArtifacts({ prefix: 'auto-judge-', suffix: '.shadow.jsonl', sinceMs: SINCE.getTime() })
const draftArt = scanArtifacts({ prefix: 'auto-draft-', suffix: '.picks.jsonl', sinceMs: SINCE.getTime() })
/**
 * 🔴 **JSON 파일의 줄 수는 건수가 아니다.** 보기 좋게 들여 쓴 파일은 한 건이 수십 줄이다 —
 *    실제로 `candidates.json` 을 줄로 세자 85,799 이 나왔다. 그래서 세지 않고
 *    **마지막 산출 시각만** 쓴다.
 */
const draftCand = scanArtifacts({ prefix: 'auto-draft-', suffix: '.candidates.json', sinceMs: SINCE.getTime() })
const supplyOff = !envFlag('SORAN_SUPPLY_PROCESS_ENABLED')
const sumCafe = (f: (c: CafeRow) => number): number => cafeRows.reduce((n, c) => n + f(c), 0)
const maxOrNull = (xs: readonly (number | null)[]): number | null => {
  const ok = xs.filter((x): x is number => x !== null)
  return ok.length === 0 ? null : Math.max(...ok)
}

const evidence: StageEvidence[] = [
  {
    stage: 'sourceList', lastAtMs: maxOrNull(cafeRows.map((c) => c.lastListAtMs)),
    recentCount: sumCafe((c) => c.listAppearances),
    unit: '🔴 목록 출현 수(중복 포함) — 고유 신규 글 수가 아니다',
    switchedOff: null, staleAfterDays: 1,
  },
  {
    stage: 'sourceDetail', lastAtMs: maxOrNull(cafeRows.map((c) => c.lastThinAtMs)),
    recentCount: sumCafe((c) => c.newUniqueThin),
    unit: '신규 고유 thin 원천', switchedOff: null, staleAfterDays: 1,
  },
  {
    stage: 'adapt', lastAtMs: maxOrNull(cafeRows.map((c) => c.lastAdaptAtMs)),
    recentCount: sumCafe((c) => c.adaptLines), unit: 'adapt 산출 줄',
    switchedOff: supplyOff, staleAfterDays: 1,
  },
  {
    stage: 'workset', lastAtMs: judgeArt.lastAtMs, recentCount: null,
    unit: '🔴 작업 묶음 파일을 따로 남기지 않는다 — judge 산출로 갈음할 수 없다',
    switchedOff: supplyOff, staleAfterDays: 1,
  },
  {
    stage: 'judge', lastAtMs: judgeArt.lastAtMs, recentCount: judgeArt.lines,
    unit: 'judge shadow 줄', switchedOff: supplyOff, staleAfterDays: 1,
  },
  {
    stage: 'draft', lastAtMs: draftCand.lastAtMs, recentCount: draftArt.lines,
    unit: 'draft picks 줄 — 🔴 candidates.json 은 줄로 세지 않는다(한 건이 수십 줄이다)',
    switchedOff: supplyOff, staleAfterDays: 1,
  },
  {
    stage: 'semanticReview', lastAtMs: draftArt.lastAtMs, recentCount: null,
    unit: '🔴 검수 결과만 따로 담는 산출물이 없다 — draft 산출로 갈음하지 않는다',
    switchedOff: supplyOff, staleAfterDays: 1,
  },
  {
    stage: 'candidate', lastAtMs: q.lastCreatedAtMs,
    recentCount: q.ok ? q.createdInWindow : null, unit: '큐 적재 행',
    switchedOff: supplyOff, staleAfterDays: 1,
  },
  {
    stage: 'humanReady', lastAtMs: q.lastCreatedAtMs,
    recentCount: q.ok ? q.humanReviewedInWindow : null, unit: '사람이 검토 완료한 행',
    switchedOff: null, staleAfterDays: 2,
  },
  {
    stage: 'personaMatch', lastAtMs: q.lastCreatedAtMs,
    recentCount: q.ok ? q.personaMatched : null, unit: 'Persona 배정된 행',
    switchedOff: null, staleAfterDays: 2,
  },
  {
    stage: 'publish', lastAtMs: q.lastCreatedAtMs,
    recentCount: q.ok ? q.publishedInWindow : null, unit: '발행된 행',
    switchedOff: !(plistInstalled('com.soransoran.original-post-runner')
      && loadedJobs.has('com.soransoran.original-post-runner')),
    staleAfterDays: 2,
  },
  {
    stage: 'comment', lastAtMs: null, recentCount: null,
    unit: '🔴 댓글 러너가 등록되어 있지 않다 — 셀 산출물이 없다',
    switchedOff: !plistInstalled('com.soransoran.persona-comment-runner'),
    staleAfterDays: 2,
  },
]

const reasons: Partial<Record<PipelineStage, string>> = {}
/**
 * 🔴 **스위치가 꺼져 있는데 산출물이 최근인 경우**를 그냥 "정지" 라고만 적지 않는다.
 *    예약으로 돈 것이 아니라 사람이 한 번 돌린 회차라는 뜻이고, 둘은 다른 사실이다.
 */
if (supplyOff) {
  const fresh = maxOrNull([judgeArt.lastAtMs, draftArt.lastAtMs, draftCand.lastAtMs])
  const note = fresh !== null && NOW.getTime() - fresh <= 2 * 86_400_000
    ? '스위치가 꺼져 있다 — 🔴 최근 산출물은 예약이 아니라 손으로 돌린 회차다'
    : '스위치가 꺼져 있다'
  for (const st of ['adapt', 'workset', 'judge', 'draft', 'semanticReview'] as const) {
    reasons[st] = note
  }
}
if (q.ok && q.contractMismatch > 0) {
  reasons.candidate = `큐에는 들어갔지만 ${q.contractMismatch}건이 발행 계약과 어긋난다`
    + ` (${Object.entries(q.mismatchByField).map(([k, v]) => `${k} ${v}건`).join(' · ')})`
}
const facts = buildStageFacts({ evidence, nowMs: NOW.getTime(), reasons })
const broken = firstBrokenStage(facts)

// 🔴 유입률 — 회차가 하나뿐이면 일간 값을 내지 않는다
const queueInflow = rateOf({
  count: q.contractOk, runs: q.createdDays, days: WINDOW_DAYS,
  lastAt: q.lastCreatedAtMs === null ? null
    : new Date(q.lastCreatedAtMs + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' '),
})

const ts = (ms: number | null): string => ms === null ? '(없음)'
  : new Date(ms + 9 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')

if (JSON_OUT) {
  console.log(JSON.stringify({
    window: { days: WINDOW_DAYS, since: SINCE.toISOString(), now: NOW.toISOString() },
    cafes: cafeRows, queue: q, stages: facts,
    firstBroken: broken === null ? null : broken.stage,
    queueInflow,
  }, null, 2))
} else {
  console.log('\n══ D100 공급 깔때기 재대조 (read-only · DB write 0 · 네트워크 0) ══')
  console.log(`  창 ${WINDOW_DAYS}일 · 기준시각 ${ts(NOW.getTime())} KST (모든 칸이 같은 시각을 본다)\n`)

  console.log('① 카페별 수집 — 🔴 칸 이름이 곧 무엇을 센 것인지다')
  for (const c of cafeRows) {
    console.log(`  ${c.cafe}`)
    console.log(`    목록 출현 수(중복 포함)  ${String(c.listAppearances).padStart(6)}  (파일 ${c.listFiles}개)`)
    console.log('      🔴 이 수는 **카페의 고유 신규 글 수가 아니다** — 회차마다 같은 글이 다시 잡힌다')
    console.log(`    상세 요청                ${String(c.detailRequests).padStart(6)}`)
    console.log(`    본문 확보                ${String(c.bodyCaptured).padStart(6)}`)
    console.log(`    신규 고유 thin 원천      ${String(c.newUniqueThin).padStart(6)}`)
    console.log(`    이미 본 글(건너뜀)       ${String(c.skippedSeen).padStart(6)}`
      + `   상세 열었는데 중복 ${c.repeated}`)
    console.log(`    성공 회차 ${c.successRuns} · 실패 회차 ${c.failedRuns}`
      + ` · 설정된 회차당 상세 상한 ${c.configuredDetailPerRun ?? 'unmeasured'}`)
    console.log(`    adapt 산출 줄            ${String(c.adaptLines).padStart(6)}`)
    console.log(`    최근  목록 ${ts(c.lastListAtMs)} · thin ${ts(c.lastThinAtMs)} · adapt ${ts(c.lastAdaptAtMs)}`)
  }
  console.log('\n  🔴 82cook — 회차 기록 0건. 이번 PR 에서 호출·등록하지 않는다(필수 공급원이지만 지금은 아니다)')

  console.log('\n② 큐 재대조 — 🔴 backlog 와 유입을 가른다')
  if (!q.ok) console.log(`  🔴 읽지 못했다 — ${q.detail}`)
  else {
    for (const l of describeBacklog({
      backlog: q.total, backlogUsable: q.backlogUsable,
      backlogContractMismatch: q.contractMismatch, inflow: queueInflow,
    })) console.log(`  ${l}`)
    console.log(`  창 안 적재 ${q.createdInWindow}건 → 계약 맞음 ${q.contractOk}건`
      + ` · 🔴 계약 어긋남 ${q.contractMismatch}건`)
    for (const [k, v] of Object.entries(q.mismatchByField)) {
      console.log(`      어긋난 칸: ${k}  ${v}건`)
    }
    console.log(`  사람 검토 완료 — 전체 ${q.humanReviewed}건 · 창 안 ${q.humanReviewedInWindow}건`)
    console.log(`  Persona 배정 ${q.personaMatched}건 · 발행 ${q.publishedInWindow}건`)
    console.log('  🔴 `readyQualifiedPerDay` 의 분자는 **계약을 맞추고 사람 검토까지 끝난 행**이다.')
    console.log('     공급기가 멎어 있던 기간의 그 수를 14 로 나눈 값은')
    console.log('     **정상 가동 AI 생산율도, 수집→READY 전환율도 아니다.**')
  }

  console.log('\n③ 칸별 상태 — 🔴 가동 / 정지 / 미측정')
  console.log('  칸                 상태        최근 실측량   못 넘어간 이유')
  for (const f of facts) {
    const mark = f.status === 'running' ? '🟢' : f.status === 'stopped' ? '🔴' : '⬚'
    const amount = f.recentCount === null ? 'unmeasured' : String(f.recentCount)
    console.log(`  ${mark} ${STAGE_LABEL[f.stage].padEnd(16)} ${f.status.padEnd(10)} ${amount.padStart(10)}`
      + `   ${f.blockedReason ?? ''}`)
    console.log(`       센 것: ${f.unit} · 최근 ${ts(f.lastAtMs)}`)
  }

  console.log('\n④ D1 GO/NO-GO — 🔴 추천만 한다. 이 PR 에서 실행하지 않는다')
  if (broken === null) console.log('  🟢 끊긴 칸이 없다')
  else {
    console.log(`  🔴 가장 위에서 끊긴 칸: **${STAGE_LABEL[broken.stage]}**`)
    console.log(`     이유: ${broken.blockedReason ?? '(없음)'}`)
  }
  console.log('\n  🔴 추정 전환율을 적지 않는다 — 자료가 없는 칸은 unmeasured 다')
  console.log('  🔴 목표 정본: 자연스러운 커뮤니티 원천 기반 Persona 글 3→5→10→…→100편/day')
  console.log('     SEO 정보형 글 레인을 만들지 않는다')
  console.log('\n🔴 이 명령은 아무것도 바꾸지 않았다 — DB write 0 · 파일 쓰기 0 · 네트워크 0 · LLM 0\n')
}

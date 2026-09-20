#!/usr/bin/env tsx
/**
 * 작업 묶음 **실제 연결** 검사 — 🔴 소스 문자열이 아니라 **돌려 보고** 값을 읽는다 (2026-09-20)
 *
 * 🔴 임시 디렉터리 · 임시 HOME · 가짜 provider 로 **실제 러너 두 개**를 띄운다.
 *    `micro-seed-auto-judge.mts` 와 `micro-seed-auto-draft.mts` 는 운영이 쓰는 그 파일이다.
 *
 * 🔴 **DB 를 읽지 않는다 · 실제 provider 를 부르지 않는다 · 운영 데이터를 건드리지 않는다.**
 *    큐 스냅샷은 정본 `buildQueueSnapshot` 으로 손수 만들어 넣는다(러너가 DB 를 안 읽는 계약).
 */
import { spawnSync } from 'node:child_process'
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildQueueSnapshot, queueSnapshotFileName } from '../src/lib/supply-queue-snapshot'
import { SEED_AXIS, mergeJudgeRows } from '../src/lib/micro-seed-auto-judge'
import {
  judgeStageBudget, selectWorkset, terminalSourceIds, worksetFileName, type WorksetRow,
} from '../src/lib/supply-workset'
import { ledgerRunIdOf } from '../src/lib/supply-process'
import { artifactRetryable } from '../src/lib/content-core/review'
// 🔴 합성 말투 자산 — 회원 댓글이 아니다. 없으면 생성기가 호출 전에 멈춘다
import { writeFakePersonaAsset } from './lib/fake-persona-asset.mjs'

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

const ROOT = process.cwd()
const HOOK = join(ROOT, 'scripts/lib/fake-provider-hook.mjs')
const TSX = join(ROOT, 'node_modules/.bin/tsx')
const RUN = '20260920-999999'

/** 🔴 한 회차용 세상 하나 — 운영 데이터와 완전히 분리된다 */
function makeWorld(): { root: string; dd: string; home: string } {
  /**
   * 🔴 **실경로로 푼다.** macOS 의 `/var` 는 `/private/var` 심볼릭 링크라
   *    자식의 `process.cwd()` 와 인자 경로가 달라진다 — 러너가 "데이터 폴더 밖" 으로 본다.
   *    🔴 운영 러너는 **상대 경로**(`.microseed-data/…`)를 넘기므로 이 문제가 없다.
   */
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'workset-e2e-')))
  const dd = join(root, '.microseed-data')
  mkdirSync(dd, { recursive: true })
  const home = join(root, 'home')
  mkdirSync(join(home, 'Library', 'Application Support', 'soransoran'), { recursive: true })
  writeFakePersonaAsset({ home })
  symlinkSync(join(ROOT, 'docs'), join(root, 'docs'))
  return { root, dd, home }
}

/** adapt 가 낸 모양 그대로 — 🔴 `detail` 과 `raw-detail` **쌍**으로 낸다 */
function writeAdaptPair(dd: string, rows: { id: string; comments: number; posted: string }[]): void {
  const detail = rows.map((r) => JSON.stringify({
    runId: 'adapt-1', sourceArticleId: r.id, sourceSite: 'navercafe:wgang',
    axis: SEED_AXIS, lane: 'seed', access: 'ok', safetyVerdict: 'pass', safetyReasons: '',
    title: `우리 나이 이야기 ${r.id}`,
    bodyHead: `${r.id} 원문 머리입니다. 사람들이 반응한 이야기이고 질문으로 끝납니다. 다들 어떠세요?`,
    commentCount: r.comments, bodyLength: 300, imageCount: 0, assetAxes: '',
    qualityFlags: [], sourcePostedAt: r.posted, sourceListedAt: r.posted, sourceCapturedAt: r.posted,
  })).join('\n')
  writeFileSync(join(dd, 'adapt-1.detail.jsonl'), `${detail}\n`, 'utf-8')
  /**
   * 🔴 **같은 원천의 raw 쌍.** 키 이름이 `accessStatus` 다 — 정규화를 두 벌로 두면
   *    이 파일이 정상 원천을 `accessNotOk` 로 덮어쓴다 (2026-09-20 검토 결함).
   */
  const raw = rows.map((r) => JSON.stringify({
    runId: 'adapt-1', sourceArticleId: r.id, sourceSite: 'navercafe:wgang',
    axis: SEED_AXIS, lane: 'seed', accessStatus: 'ok', safetyVerdict: 'pass', safetyReasons: '',
    title: `우리 나이 이야기 ${r.id}`,
    bodyHead: `${r.id} 원문 머리입니다. 사람들이 반응한 이야기이고 질문으로 끝납니다. 다들 어떠세요?`,
    commentCount: r.comments, bodyLength: 300, assetAxes: '', qualityFlags: [],
    sourcePostedAt: r.posted, sourceListedAt: r.posted,
  })).join('\n')
  writeFileSync(join(dd, 'adapt-1.raw-detail.jsonl'), `${raw}\n`, 'utf-8')
}

/** 🔴 러너가 읽는 그대로 — `mergeJudgeRows` 정본을 지난다 */
function rowsOf(dd: string): WorksetRow[] {
  const entries: { kind: 'detail' | 'raw-detail'; row: Record<string, unknown> }[] = []
  const meta = new Map<string, { posted: string }>()
  for (const f of readdirSync(dd)) {
    const kind = f.endsWith('.raw-detail.jsonl') ? 'raw-detail' as const
      : f.endsWith('.detail.jsonl') ? 'detail' as const : null
    if (kind === null) continue
    for (const line of readFileSync(join(dd, f), 'utf-8').split('\n')) {
      if (line.trim() === '') continue
      const row = JSON.parse(line) as Record<string, unknown>
      entries.push({ kind, row })
      meta.set(String(row.sourceArticleId), { posted: String(row.sourcePostedAt ?? '') })
    }
  }
  return mergeJudgeRows(entries).map((input) => ({
    sourceArticleId: String(input.sourceArticleId ?? ''), sourceSite: 'navercafe:wgang',
    commentCount: Number(input.commentCount ?? 0),
    sourcePostedAt: meta.get(String(input.sourceArticleId))?.posted ?? '',
    sourceListedAt: '', input,
  }))
}

type Spawned = { code: number | null; out: string }
const runStage = (o: {
  script: string; args: string[]; world: { root: string; home: string }
  cap: string; bodyLog?: string
}): Spawned => {
  const r = spawnSync(TSX, [join(ROOT, o.script), ...o.args], {
    cwd: o.world.root, encoding: 'utf-8',
    env: {
      ...process.env, HOME: o.world.home,
      ANTHROPIC_API_KEY: 'fixture-fake-key', GEMINI_API_KEY: 'fixture-fake-gemini-key',
      NODE_OPTIONS: `--import=${HOOK}`,
      ...(o.bodyLog === undefined ? {} : { FAKE_PROVIDER_BODY_LOG: o.bodyLog }),
      SORAN_LLM_DAILY_BUDGET_USD: '1000',
      SORAN_LLM_RESERVE_HEADROOM: '1.5',
      SORAN_LLM_RUN_REQUEST_CAP: o.cap,
    },
  })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const ledgerRows = (home: string): Record<string, unknown>[] => {
  const dir = join(home, 'Library', 'Application Support', 'soransoran', 'llm-ledger')
  let files: string[] = []
  try { files = readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)) } catch { return [] }
  return files.flatMap((f) => readFileSync(join(dir, f), 'utf-8').split('\n')
    .filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Record<string, unknown>))
}

// ─────────────────────────────────────────────────────────
console.log('\n① 🔴 🔴 adapt 쌍 → 묶음 5건 → judge → draft 가 실제로 이어진다')
// ─────────────────────────────────────────────────────────
const w = makeWorld()
{
  // adapt 가 8건을 냈다 — 묶음은 5건이어야 한다
  writeAdaptPair(w.dd, Array.from({ length: 8 }, (_, i) => ({
    id: `e${i}`, comments: 30 - i, posted: `2026-09-1${i % 10}T00:00:00Z`,
  })))
  const rows = rowsOf(w.dd)
  check('🔴 🔴 **detail/raw 쌍이 정상 원천을 덮어쓰지 않는다**',
    rows.length === 8 && rows.every((r) => r.input.access === 'ok'),
    `${rows.length}건 · access=${[...new Set(rows.map((r) => r.input.access))].join(',')}`)

  const budget = judgeStageBudget(5)
  if (!budget.ok) throw new Error(budget.reason)
  const plan = selectWorkset({
    rows, humanDecided: new Set(), queuePending: new Set(), terminal: new Set(),
    limit: 5, runId: RUN, takenAt: new Date(),
  })
  check('🔴 🔴 **묶음 5건 · 나머지 3건은 남는다**',
    plan.picked.length === 5 && plan.deferred === 3)
  check('🔴 댓글 수 상위 5건이다',
    plan.workset.sourceIds.join(',') === 'e0,e1,e2,e3,e4', plan.workset.sourceIds.join(','))

  const wsPath = join(w.dd, worksetFileName(RUN))
  writeFileSync(wsPath, `${JSON.stringify(plan.workset, null, 2)}\n`, 'utf-8')
  const shadowPath = join(w.dd, `auto-judge-${RUN}.shadow.jsonl`)
  // 🔴 러너가 넘기는 모양 그대로 — `.microseed-data/…` 상대 경로다
  const rel = (p: string): string => p.slice(w.root.length + 1)

  // ── judge — 같은 파이프라인 runId · 장부 id 만 j ──
  const jLog = join(w.root, 'judge-body.log')
  writeFileSync(jLog, '', 'utf-8')
  const j = runStage({
    script: 'scripts/micro-seed-auto-judge.mts', world: w, cap: String(budget.perStage.judge),
    bodyLog: jLog,
    args: ['--call', '--apply', `--run-id=${RUN}`,
      `--ledger-run-id=${ledgerRunIdOf(RUN, 'judge')}`,
      `--workset=${rel(wsPath)}`, `--shadow-out=${rel(shadowPath)}`],
  })
  check('🟢 🔴 **judge 가 같은 파이프라인 runId 로 manifest 를 통과한다**',
    j.code === 0 && j.out.includes('작업 묶음 5건만 판정한다'), `code=${j.code}\n${j.out.slice(-900)}`)
  const jPaid = readFileSync(jLog, 'utf-8').split('\n').filter((l) => l.trim() !== '').length
  check('🔴 🔴 **judge 유료 요청 ≤ 5**', jPaid <= 5, `${jPaid}회`)
  const shadow = readFileSync(shadowPath, 'utf-8').split('\n').filter((l) => l.trim() !== '')
  check('🔴 🔴 **그 5건만 판정 파일에 있다** — backlog 3건은 판정하지 않았다',
    shadow.length === 5, `${shadow.length}건`)

  /**
   * ── draft — 같은 파이프라인 runId 로 큐 스냅샷을 통과해야 한다 ──
   *
   * 🔴 **판정 결과를 여기서 AUTO_SEED 로 바꿔 넣는다.** 가짜 provider 는 한 가지
   *    응답 모양만 낸다(생성·검수 schema). 그래서 위 judge 실행은 **묶음 필터와
   *    호출 수**를 증명하고, 아래 draft 실행은 **같은 회차 id 로 스냅샷·입력이
   *    이어지는가**를 증명한다. 🔴 원천 id 는 그 5건 그대로다 — 연결을 바꾸지 않는다.
   */
  const seeded = plan.workset.sourceIds.map((id) => JSON.stringify({
    sourceArticleId: id, ruleVersion: 'auto-judge-v3', provenance: 'machine-shadow',
    decidedAt: new Date().toISOString(), model: 'claude-haiku-4.5',
    promptVersion: 'semantic-shadow-v2c', inputHash: 'fixture00000000',
    confidence: 0.9, semanticRisks: [], communityAngle: `${id} 이야기`,
    attemptCount: 1, semanticStatus: 'ok', providerErrorCode: null,
    decision: 'AUTO_SEED', reasonCodes: ['axisSeed'],
  })).join('\n')
  writeFileSync(shadowPath, `${seeded}\n`, 'utf-8')


  const snapPath = join(w.dd, queueSnapshotFileName(RUN))
  writeFileSync(snapPath, `${JSON.stringify(buildQueueSnapshot({
    runId: RUN, takenAt: new Date(), rows: [],
  }), null, 2)}\n`, 'utf-8')
  const dLog = join(w.root, 'draft-body.log')
  writeFileSync(dLog, '', 'utf-8')
  const d = runStage({
    script: 'scripts/micro-seed-auto-draft.mts', world: w, cap: String(budget.perStage.draft),
    bodyLog: dLog,
    args: ['--call', '--apply', `--run-id=${RUN}`,
      `--ledger-run-id=${ledgerRunIdOf(RUN, 'draft')}`,
      `--queue-snapshot=${rel(snapPath)}`, '--require-queue-snapshot', `--input=${rel(shadowPath)}`],
  })
  check('🟢 🔴 **draft 가 같은 파이프라인 runId 로 스냅샷을 통과한다** — RUN_MISMATCH 0',
    d.code === 0 && !d.out.includes('RUN_MISMATCH'), `code=${d.code}\n${d.out.slice(-900)}`)
  const dPaid = readFileSync(dLog, 'utf-8').split('\n').filter((l) => l.trim() !== '').length
  check('🔴 🔴 **draft 유료 요청 ≤ 15**', dPaid <= 15, `${dPaid}회`)
  check('🔴 🔴 **그 회차 shadow 만 읽었다** — 과거 판정 파일을 훑지 않았다',
    d.out.includes(shadowPath.split('/').pop() ?? '?') || d.out.includes('AUTO_SEED 5건'),
    d.out.slice(-500))

  // ── 장부 id 만 j/d 로 갈렸는가 ──
  const led = ledgerRows(w.home)
  const ids = [...new Set(led.map((r) => String(r.runId)))].sort()
  check('🔴 🔴 **장부 회차 id 만 j/d 로 갈린다**',
    ids.length === 2 && ids.includes(`${RUN}-j`) && ids.includes(`${RUN}-d`), ids.join(','))
  check('🔴 🔴 **파이프라인 id 그대로인 장부 줄은 없다**', !ids.includes(RUN))
  check('🔴 미정산·예약 초과 0',
    led.every((r) => r.status !== 'usageUnknown')
    && led.filter((r) => r.status === 'settled' && r.stage !== 'countTokens').length > 0)

  // ── 후보 파일과 Queue 상한 ──
  const cands = readdirSync(w.dd).filter((f) => /\.candidates\.json$/.test(f))
  check('🔴 🔴 **후보 파일 이름이 파이프라인 회차 id 다** — 러너가 경로를 안다',
    cands.length === 1 && cands[0] === `auto-draft-${RUN}.candidates.json`, cands.join(','))
  const cand = JSON.parse(readFileSync(join(w.dd, cands[0] ?? 'x'), 'utf-8')) as
    { candidates: unknown[] }
  check('🔴 🔴 **후보는 묶음 크기를 넘지 않는다 (≤5)**',
    cand.candidates.length <= 5, `${cand.candidates.length}건`)
  check('🔴 🔴 **Post 를 쓰지 않았다 · DB 를 읽지 않았다**',
    !d.out.includes('prisma') && !j.out.includes('prisma'))
}

// ─────────────────────────────────────────────────────────
console.log('\n② 🔴 🔴 스냅샷이 없으면 유료 호출 0')
// ─────────────────────────────────────────────────────────
{
  const w2 = makeWorld()
  writeAdaptPair(w2.dd, [{ id: 'n1', comments: 9, posted: '2026-09-19T00:00:00Z' }])
  const log = join(w2.root, 'b.log')
  writeFileSync(log, '', 'utf-8')
  const d = runStage({
    script: 'scripts/micro-seed-auto-draft.mts', world: w2, cap: '15', bodyLog: log,
    args: ['--call', '--apply', `--run-id=${RUN}`,
      `--ledger-run-id=${ledgerRunIdOf(RUN, 'draft')}`,
      `--queue-snapshot=${join(w2.dd, queueSnapshotFileName(RUN))}`, '--require-queue-snapshot'],
  })
  const paid = readFileSync(log, 'utf-8').split('\n').filter((l) => l.trim() !== '').length
  check('🔴 🔴 **큐 스냅샷이 없으면 유료 호출 0**', paid === 0, `${paid}회`)
  check('🔴 그리고 멈춘다', d.code !== 0 || d.out.includes('보류'), `code=${d.code}`)
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 🔴 🔴 두 회차 연속 — 앞 회차가 끝낸 것이 다음을 굶기지 않는다')
// ─────────────────────────────────────────────────────────
{
  const rows = rowsOf(w.dd)
  /**
   * 🔴 **1회차가 terminal 로 끝난 상황을 세운다.** 판정이 정상으로 끝났는데
   *    HOLD/DROP 이면 다시 물어도 같은 답이다 — 다음 회차의 상위 자리를 비켜야 한다.
   *    🔴 무의미한 통과를 막으려고 terminal 이 **비어 있지 않은지 먼저 본다.**
   */
  const firstIds = ['e0', 'e1', 'e2', 'e3', 'e4']
  const terminal = terminalSourceIds({
    judgements: firstIds.map((id, i) => ({
      sourceArticleId: id,
      decision: i % 2 === 0 ? 'AUTO_HOLD' : 'AUTO_DROP',
      semanticStatus: 'ok',
    })),
    artifacts: [],
  })
  check('🔴 terminal 집합이 비어 있지 않다 — 이 시험이 헛돌지 않는다',
    terminal.size === 5, `${terminal.size}건`)

  const second = selectWorkset({
    rows, humanDecided: new Set(), queuePending: new Set(), terminal,
    limit: 5, runId: `${RUN}-2`, takenAt: new Date(),
  })
  check('🔴 🔴 **2회차는 1회차가 끝낸 원천을 보지 않는다**',
    second.workset.sourceIds.every((id) => !terminal.has(id)), second.workset.sourceIds.join(','))
  check('🔴 🔴 **남아 있던 backlog 가 올라온다**',
    second.workset.sourceIds.join(',') === 'e5,e6,e7', second.workset.sourceIds.join(','))
  check('🔴 1회차가 끝낸 5건은 제외 사유로 세어진다', second.dropped.terminal === 5)

  /** 🔴 3회차 — 남은 것도 끝나면 고를 것이 없다. 같은 것을 다시 돌지 않는다 */
  const allDone = terminalSourceIds({
    judgements: rows.map((r) => ({
      sourceArticleId: r.sourceArticleId, decision: 'AUTO_HOLD', semanticStatus: 'ok',
    })),
    artifacts: [],
  })
  const third = selectWorkset({
    rows, humanDecided: new Set(), queuePending: new Set(), terminal: allDone,
    limit: 5, runId: `${RUN}-3`, takenAt: new Date(),
  })
  check('🔴 🔴 **전부 끝나면 고를 것이 0건이다** — 같은 것을 되풀이하지 않는다',
    third.picked.length === 0 && third.deferred === 0)

  check('🔴 🔴 **재시도해야 하는 것은 영구 제외하지 않는다**', (() => {
    const retryTerminal = terminalSourceIds({
      // 🔴 물어보지 못한 판정 · 예산에 막힌 생성 — 둘 다 결론이 아니다
      judgements: [{ sourceArticleId: 'r1', decision: 'AUTO_HOLD', semanticStatus: 'truncated' }],
      artifacts: [{ sourceArticleId: 'r2', outcome: 'hold', retryable: true }],
    })
    return retryTerminal.size === 0
  })())
  check('🔴 🔴 **생성이 끝까지 가서 막힌 것은 terminal 이다**', (() => {
    const t = terminalSourceIds({
      judgements: [],
      artifacts: [{ sourceArticleId: 'h1', outcome: 'hold', retryable: false }],
    })
    return t.has('h1')
  })())
  check('🔴 🔴 **artifactRetryable 은 예산 사유만 재시도로 본다**',
    artifactRetryable({ semanticCompletion: { complete: false, reason: 'budgetBlocked' } })
    && !artifactRetryable({ semanticCompletion: { complete: true, reason: null } })
    && !artifactRetryable({ semanticCompletion: { complete: false, reason: 'truncated' } }))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 가짜 provider · 임시 HOME · 임시 디렉터리다 — 운영 데이터 · DB · 실제 모델 0.')
if (fail > 0) process.exit(1)

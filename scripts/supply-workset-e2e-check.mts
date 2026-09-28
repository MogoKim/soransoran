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
  cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildQueueSnapshot, queueSnapshotFileName } from '../src/lib/supply-queue-snapshot'
import {
  SEED_AXIS, RAW_AXIS, inputHashOf, mergeJudgeRows, PROMPT_VERSION, PROVEN_LANES, RULE_VERSION,
} from '../src/lib/micro-seed-auto-judge'
import { JUDGE_MODEL } from './micro-seed-auto-judge.mjs'
import { ARTIFACT_VERSION } from '../src/lib/content-core/artifact'
import {
  attemptedOutcomes, concludedSourceIds, judgeStageBudget, latestOutcomes, selectWorkset,
  worksetFileName, WORKSET_KIND, WORKSET_VERSION, type WorksetPlan, type WorksetRow,
} from '../src/lib/supply-workset'
import { readPriorOutcomes } from './lib/prior-outcomes.mjs'
import { missingCandidateKeys } from './lib/candidate-envelope.mjs'
import { SPEAKER_LOAD_FILE } from '../src/lib/content-core/speaker-load-file'
import {
  RETRYABLE_CAUSES, INCOMPLETE_CAUSE_LABEL,
} from '../src/lib/content-core/review'
import type { PriorOutcome } from '../src/lib/supply-workset'
import type { ContractBase } from '../src/lib/content-core/pipeline'
import { ledgerRunIdOf } from '../src/lib/supply-process'
// 🔴 합성 말투 자산 — 회원 댓글이 아니다. 없으면 생성기가 호출 전에 멈춘다
import { writeFakePersonaAsset } from './lib/fake-persona-asset.mjs'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'

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
/** 🔴 판정기가 물어볼 자격을 인정하는 lane — 아니면 묻기 전에 HOLD 다 */
const PROVEN_LANE = PROVEN_LANES[0] ?? ''

/** 🔴 한 회차용 세상 하나 — 운영 데이터와 완전히 분리된다 */
function makeWorld(
  o: {
    copyDocs?: boolean
    speakerLoad?: 'fresh' | 'stale' | 'malformed' | 'none'
    /** 🔴 생성이 쓸 회차 id — 파일은 **그 회차의 것**이어야 한다 */
    speakerLoadRunId?: string
  } = {},
): { root: string; dd: string; home: string } {
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
  /**
   * 🔴 기본은 링크다 — 운영 문서를 건드리지 않는다.
   *    문서를 고쳐 보는 검사만 **복사본**을 쓴다.
   */
  if (o.copyDocs === true) cpSync(join(ROOT, 'docs'), join(root, 'docs'), { recursive: true })
  else symlinkSync(join(ROOT, 'docs'), join(root, 'docs'))
  /**
   * 🔴 **공급 러너가 적는 화자 여력 파일** (2026-09-22).
   *
   *    운영에서는 `supply-process` 가 DB 를 읽어 이 파일을 적고, 생성 러너가 읽는다.
   *    🔴 파일이 없으면 **유료 생성이 멈춘다** — 전체 후보로 되돌아가면
   *    같은 화자에 몰아주기가 그대로 재현되기 때문이다.
   *    여기서는 그 배선을 이어 붙인다. `o.speakerLoad: 'none'` 이면 일부러 빼서
   *    **막히는 것**을 값으로 확인한다.
   */
  if (o.speakerLoad !== 'none') {
    writeSpeakerLoadFile(dd, o.speakerLoad ?? 'fresh', o.speakerLoadRunId ?? RUN)
  }
  return { root, dd, home }
}

/** 🔴 fixture 가 쓰는 여력 파일 — 운영 파일과 **같은 계약**이다 */
function writeSpeakerLoadFile(
  dd: string, kind: 'fresh' | 'stale' | 'malformed', runId = 'fixture-run',
): void {
  if (kind === 'malformed') {
    writeFileSync(join(dd, SPEAKER_LOAD_FILE), JSON.stringify({ writtenAt: 1, runId, byCode: {} }))
    return
  }
  const writtenAt = kind === 'stale'
    ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    : new Date().toISOString()
  const byCode: Record<string, { openDays: number; readyCount: number }> = {}
  // 🔴 가짜 말투 자산이 세우는 코드에 넉넉한 여력을 준다
  for (let i = 1; i <= 24; i += 1) {
    byCode[`P${String(i).padStart(2, '0')}`] = { openDays: 7, readyCount: 0 }
  }
  writeFileSync(join(dd, SPEAKER_LOAD_FILE),
    JSON.stringify({ writtenAt, runId, horizonDays: 7, byCode }, null, 2))
}

/** adapt 가 낸 모양 그대로 — 🔴 `detail` 과 `raw-detail` **쌍**으로 낸다 */
function writeAdaptPair(
  dd: string,
  rows: { id: string; comments: number; posted: string; lane?: string; axis?: string
    /** 🔴 합성 원문의 머리를 바꾼다 — 화자 자신의 나이가 든 원문을 만들 때 쓴다 */
    head?: string }[],
  runId = 'adapt-1',
): void {
  const detail = rows.map((r) => JSON.stringify({
    runId, sourceArticleId: r.id, sourceSite: 'navercafe:wgang',
    axis: r.axis ?? SEED_AXIS, lane: r.lane ?? PROVEN_LANE, access: 'ok', safetyVerdict: 'pass', safetyReasons: '',
    title: `우리 나이 이야기 ${r.id}`,
    bodyHead: r.head ?? `${r.id} 원문 머리입니다. 사람들이 반응한 이야기이고 질문으로 끝납니다. 다들 어떠세요?`,
    commentCount: r.comments, bodyLength: 300, imageCount: 0,
    // 🔴 빈 값이 아니어야 한다 — 지문에서 이 칸이 빠진 것을 검사가 볼 수 있다
    assetAxes: 'sleep|work',
    qualityFlags: [], sourcePostedAt: r.posted, sourceListedAt: r.posted, sourceCapturedAt: r.posted,
  })).join('\n')
  writeFileSync(join(dd, `${runId}.detail.jsonl`), `${detail}\n`, 'utf-8')
  /**
   * 🔴 **같은 원천의 raw 쌍.** 키 이름이 `accessStatus` 다 — 정규화를 두 벌로 두면
   *    이 파일이 정상 원천을 `accessNotOk` 로 덮어쓴다 (2026-09-20 검토 결함).
   */
  const raw = rows.map((r) => JSON.stringify({
    runId, sourceArticleId: r.id, sourceSite: 'navercafe:wgang',
    axis: r.axis ?? SEED_AXIS, lane: r.lane ?? PROVEN_LANE, accessStatus: 'ok', safetyVerdict: 'pass', safetyReasons: '',
    title: `우리 나이 이야기 ${r.id}`,
    bodyHead: r.head ?? `${r.id} 원문 머리입니다. 사람들이 반응한 이야기이고 질문으로 끝납니다. 다들 어떠세요?`,
    commentCount: r.comments, bodyLength: 300, assetAxes: 'sleep|work', qualityFlags: [],
    sourcePostedAt: r.posted, sourceListedAt: r.posted,
  })).join('\n')
  writeFileSync(join(dd, `${runId}.raw-detail.jsonl`), `${raw}\n`, 'utf-8')
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
  /** 🔴 가짜 provider 가 돌려줄 판정 — 회차마다 다른 결론을 실제로 만들어 본다 */
  judgeDecision?: string
  /** 🔴 원문에 든 화자 자신의 나이 — 주면 계획이 그 값을 화자 상대 사실로 적어 낸다 */
  selfAge?: string
  /** 🔴 그 나이의 materiality — 기본 incidental */
  selfAgeRole?: 'incidental' | 'loadBearing'
  /** 🔴 요청의 1인칭 금지를 따르는 모델인가 */
  obeyForbid?: boolean
  /** 🔴 초안이 나이 문장을 통째로 뺀다 */
  dropAge?: boolean
}): Spawned => {
  const r = spawnSync(TSX, [join(ROOT, o.script), ...o.args], {
    cwd: o.world.root, encoding: 'utf-8',
    env: {
      ...process.env, HOME: o.world.home,
      ANTHROPIC_API_KEY: 'fixture-fake-key', GEMINI_API_KEY: 'fixture-fake-gemini-key',
      NODE_OPTIONS: `--import=${HOOK}`,
      ...(o.bodyLog === undefined ? {} : { FAKE_PROVIDER_BODY_LOG: o.bodyLog }),
      ...(o.judgeDecision === undefined ? {} : { FAKE_PROVIDER_JUDGE_DECISION: o.judgeDecision }),
      ...(o.selfAge === undefined ? {} : { FAKE_PROVIDER_SELF_AGE: o.selfAge }),
      ...(o.selfAgeRole === undefined ? {} : { FAKE_PROVIDER_SELF_AGE_ROLE: o.selfAgeRole }),
      ...(o.obeyForbid !== true ? {} : { FAKE_PROVIDER_OBEY_FORBID: '1' }),
      ...(o.dropAge !== true ? {} : { FAKE_PROVIDER_DROP_AGE: '1' }),
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
    rows, humanDecided: new Set(), queuePending: new Set(),
    // 🔴 첫 회차다 — 지난 결과가 없다
    concluded: new Set(), attempted: new Map(),
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
    bodyLog: jLog, judgeDecision: 'AUTO_SEED',
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

  check('🔴 🔴 **판정 러너가 실제로 AUTO_SEED 를 냈다** — 손으로 넣은 값이 아니다',
    shadow.every((l) => {
      const r = JSON.parse(l) as { decision?: string; semanticStatus?: string; inputHash?: string }
      return r.decision === 'AUTO_SEED' && r.semanticStatus === 'ok'
    }), shadow.map((l) => String((JSON.parse(l) as { decision?: string }).decision)).join(','))
  check('🔴 🔴 **판정이 적은 지문이 지금 입력의 지문과 같다**', (() => {
    const hash = new Map(rows.map((r) => [r.sourceArticleId, inputHashOf(r.input)]))
    return shadow.every((l) => {
      const r = JSON.parse(l) as { sourceArticleId?: string; inputHash?: string }
      return r.inputHash === hash.get(String(r.sourceArticleId))
    })
  })())

  // ── draft — 같은 파이프라인 runId 로 큐 스냅샷을 통과해야 한다 ──
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
  /**
   * 🔴 **실제로 나간 요청 본문으로 확인한다.** 회차 안에서만 존재하는 값이 실려 나가면
   *    계약과 실제 입력이 어긋난다 — 그 값은 다음 회차가 다시 만들 수 없다.
   */
  {
    const sent = readFileSync(dLog, 'utf-8').split('\n').filter((l) => l.trim() !== '')
      .map((l) => String((JSON.parse(l) as { body?: string }).body ?? ''))
    check('🔴 🔴 **나간 요청 어디에도 맡은 수가 없다**',
      sent.length > 0 && sent.every((b) => !b.includes('맡은 수')), `${sent.length}건`)
    check('🔴 후보 목록은 실제로 실려 나갔다',
      sent.some((b) => b.includes('나이대') && b.includes('하는 일')))
  }
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
console.log('\n③ 🔴 🔴 실제 생성된 파일을 다시 읽어 다음 회차를 고른다')
// ─────────────────────────────────────────────────────────
const rows = rowsOf(w.dd)
const hashOf = new Map(rows.map((r) => [r.sourceArticleId, inputHashOf(r.input)]))
const CANON = { ruleVersion: RULE_VERSION, promptVersion: PROMPT_VERSION, judgeModel: JUDGE_MODEL }
/**
 * 🔴 **그 세상의 생성 계약을 그 세상에서 구한다.** 자산 경로는 모듈을 읽을 때
 *    `homedir()` 로 굳으므로, 이 프로세스에서 부르면 **운영 HOME** 의 값이 나온다.
 *    러너와 같은 조건을 만들려면 임시 HOME 을 가진 **다른 프로세스**로 물어야 한다.
 */
function contractBaseOf(world: { root: string; home: string }): ContractBase {
  const probe = join(world.root, 'contract-probe.mts')
  writeFileSync(probe, [
    `import { currentContractBase } from '${join(ROOT, 'scripts/lib/generation-contract.mjs')}'`,
    // 🔴 **러너와 같은 방식으로 시각을 준다** — 없이 부르면 age=∅ 계약이 나온다
    'process.stdout.write(JSON.stringify(currentContractBase(new Date())))',
  ].join('\n'), 'utf-8')
  const r = spawnSync(TSX, [probe], {
    cwd: world.root, encoding: 'utf-8', env: { ...process.env, HOME: world.home },
  })
  if (r.status !== 0) throw new Error(`계약 조회 실패: ${r.stderr ?? ''}`)
  return JSON.parse(r.stdout) as ContractBase
}
const BASE = contractBaseOf(w)
/** 🔴 뒤 절이 같은 세상을 이어 본다 — 큐에 들어간 id 는 계속 형제로 걸린다 */
const NEXT: { queued: ReadonlySet<string> } = { queued: new Set() }
const outcomesOf = (world: { dd: string }, base: ContractBase = BASE) => readPriorOutcomes({
  dataDir: world.dd, hashOf, canon: CANON, base, artifactVersion: ARTIFACT_VERSION,
})

{
  check('🔴 🔴 **말투 자산 판이 계약에 실제로 담겼다**',
    BASE.voiceAssetDigest !== '' && BASE.personaPoolDigest !== ''
    && BASE.planPromptDigest !== '',
    `voice=${BASE.voiceAssetDigest} pool=${BASE.personaPoolDigest}`)

  const artFiles = readdirSync(w.dd).filter((f) => /\.artifacts\.json$/.test(f))
  check('🔴 1회차 draft 가 artifact 를 남겼다', artFiles.length === 1, artFiles.join(','))
  const arts = JSON.parse(readFileSync(join(w.dd, artFiles[0] ?? 'x'), 'utf-8')) as
    Record<string, unknown>[]
  const contracts = arts.map((a) => (a.contract ?? {}) as Record<string, unknown>)
  check('🔴 🔴 **artifact 가 계약을 적었다** — 판·프롬프트·단계 모델·자산 판',
    contracts.length > 0 && contracts.every((c) =>
      c.pipelineVersion === BASE.pipelineVersion && c.promptVersion === BASE.promptVersion
      && c.voiceAssetDigest === BASE.voiceAssetDigest
      && c.speakerPlanVersion === BASE.speakerPlanVersion
      && c.reviewVersion === BASE.reviewVersion
      && c.planPromptDigest === BASE.planPromptDigest
      && c.stageMaxOutputLabel === BASE.stageMaxOutputLabel
      && c.personaPoolDigest === BASE.personaPoolDigest
      && JSON.stringify(c.stageModels) === JSON.stringify(BASE.stageModels)),
    Object.keys(BASE).filter((k) => JSON.stringify((contracts[0] ?? {})[k])
      !== JSON.stringify((BASE as unknown as Record<string, unknown>)[k]))
      .map((k) => `${k}: ${JSON.stringify((contracts[0] ?? {})[k])} vs ${JSON.stringify((BASE as unknown as Record<string, unknown>)[k])}`).join(' | '))
  check('🔴 🔴 **artifact 의 원천 지문이 공급 러너가 쓰는 지문과 같다** — 칸이 빠지면 영영 다르다',
    arts.every((a) => {
      const c = (a.contract ?? {}) as Record<string, unknown>
      return c.sourceInputHash === hashOf.get(String(a.sourceArticleId))
    }),
    arts.map((a) => `${String(a.sourceArticleId)}:${String(((a.contract ?? {}) as Record<string, unknown>).sourceInputHash)}`).join(' '))
  check('🔴 🔴 **artifact 계약에 원문이 없다** — 지문 한 칸뿐',
    contracts.every((c) => !('title' in c) && !('bodyHead' in c) && !('maskedBody' in c)))
  check('🔴 명시 시각이 있다', arts.every((a) => String(a.generatedAt ?? '') !== ''))

  // ── 실제 파일만으로 상태를 만든다 ──
  const got = outcomesOf(w)
  const stages = new Set(got.map((o) => o.stage))
  check('🔴 🔴 **판정 파일과 artifact 를 둘 다 읽었다**',
    stages.has('judge') && stages.has('draft'), [...stages].join(','))
  check('🔴 🔴 **같은 회차 SEED 뒤 artifact 가 최신이다** — 단계 순위가 정한다',
    [...latestOutcomes(got).values()].every((o) => o.stage === 'draft'),
    [...latestOutcomes(got).values()].map((o) => `${o.sourceArticleId}:${o.stage}:${o.state}`).join(' '))

  const terminal = concludedSourceIds(got)
  check('🔴 🔴 **채택된 원천은 terminal 이 아니다** — 결론이 아니라 큐로 가는 것이다',
    terminal.size === 0 && [...latestOutcomes(got).values()].every((o) => o.state === 'candidate'),
    [...latestOutcomes(got).values()].map((o) => o.state).join(','))

  /**
   * 🔴 **적재된 원천은 큐 형제로 걸린다.** 적재 단계가 후보를 Queue 에 넣으므로
   *    다음 회차 스냅샷에 이 id 가 들어 있다. 🔴 DB 를 읽지 않으니 **그 회차가 실제로
   *    낸 후보 파일**에서 가져온다. 채택되지 못한 나머지는 큐에 없다 — 다시 볼 수 있다.
   */
  const candFile = readdirSync(w.dd).filter((f) => /\.candidates\.json$/.test(f))[0] ?? 'x'
  const queued = new Set(((JSON.parse(readFileSync(join(w.dd, candFile), 'utf-8')) as
    { candidates: { sourceArticleId?: string }[] }).candidates)
    .map((c) => String(c.sourceArticleId ?? '')))
  check('🔴 후보 파일에서 적재 대상이 나온다', queued.size >= 1, [...queued].join(','))
  NEXT.queued = queued

  /** 🔴 지금 데이터 폴더의 **실제 파일**만 보고 다음 묶음을 고른다 */
  const selectAt = (tag: string): WorksetPlan => {
    const now = outcomesOf(w)
    return selectWorkset({
      rows, humanDecided: new Set(), queuePending: queued,
      concluded: concludedSourceIds(now), attempted: attemptedOutcomes(now),
      limit: 5, runId: tag, takenAt: new Date(),
    })
  }
  /** 🔴 실제 판정 러너를 한 회차 돌린다 — 가짜 provider · 임시 HOME */
  const rel = (path: string): string => path.slice(w.root.length + 1)
  const judgeRound = (tag: string, plan: WorksetPlan, cap: number): {
    code: number | null; out: string; ids: string[]; paid: number
  } => {
    const ws = join(w.dd, worksetFileName(tag))
    writeFileSync(ws, `${JSON.stringify(plan.workset, null, 2)}\n`, 'utf-8')
    const shadow = join(w.dd, `auto-judge-${tag}.shadow.jsonl`)
    const log = join(w.root, `judge-${tag}.log`)
    writeFileSync(log, '', 'utf-8')
    const r = runStage({
      script: 'scripts/micro-seed-auto-judge.mts', world: w, cap: String(cap), bodyLog: log,
      args: ['--call', '--apply', `--run-id=${tag}`,
        `--ledger-run-id=${ledgerRunIdOf(tag, 'judge')}`,
        `--workset=${rel(ws)}`, `--shadow-out=${rel(shadow)}`],
    })
    const ids = readFileSync(shadow, 'utf-8').split('\n').filter((l) => l.trim() !== '')
      .map((l) => String((JSON.parse(l) as { sourceArticleId?: string }).sourceArticleId ?? ''))
    return {
      code: r.code, out: r.out, ids,
      paid: readFileSync(log, 'utf-8').split('\n').filter((l) => l.trim() !== '').length,
    }
  }

  // ── 2회차 — 한 번도 안 본 backlog 가 먼저 올라온다 ──
  const attempted1 = attemptedOutcomes(outcomesOf(w))
  check('🔴 1회차가 본 원천은 5건이다', attempted1.size === 5, `${attempted1.size}건`)
  const second = selectAt(`${RUN}-2`)
  check('🔴 🔴 **적재된 원천을 다시 고르지 않는다**',
    second.workset.sourceIds.every((id) => !queued.has(id)), second.workset.sourceIds.join(','))
  check('🔴 🔴 **한 번도 안 본 backlog 가 앞자리다** — 결론 안 난 것이 자리를 점유하지 못한다',
    second.workset.sourceIds.slice(0, 3).join(',') === 'e5,e6,e7',
    second.workset.sourceIds.join(','))
  check('🔴 적재분이 제외 사유로 세어진다',
    second.dropped.queueSibling === queued.size, `${second.dropped.queueSibling}/${queued.size}`)

  const r2 = judgeRound(`${RUN}-2`, second, second.picked.length)
  check('🔴 🔴 **2회차 judge 는 그 묶음만 판정한다**',
    r2.code === 0 && r2.ids.slice().sort().join(',')
      === second.workset.sourceIds.slice().sort().join(','),
    `code=${r2.code} · ${r2.ids.join(',')}`)
  check('🔴 🔴 **2회차 유료 요청이 묶음 크기를 넘지 않는다**',
    r2.paid <= second.picked.length, `${r2.paid}회 / ${second.picked.length}`)

  // ── 3회차 — 2회차가 낸 결론은 빠지고 남은 것만 오른다 ──
  const t2 = concludedSourceIds(outcomesOf(w))
  const newlyJudged = second.workset.sourceIds.filter((id) => !attempted1.has(id))
  check('🔴 🔴 **2회차에 처음 본 원천은 그 판정으로 끝났다**',
    newlyJudged.length === 3 && newlyJudged.every((id) => t2.has(id)),
    `${newlyJudged.join(',')} / terminal ${[...t2].join(',')}`)
  check('🔴 🔴 **한 회차 만에 모든 원천이 한 번씩은 올라갔다** — 굶은 원천 0',
    rows.every((r) => attempted1.has(r.sourceArticleId)
      || second.workset.sourceIds.includes(r.sourceArticleId)),
    `${rows.length}건 중 남은 것 ${rows.filter((r) => !attempted1.has(r.sourceArticleId)
      && !second.workset.sourceIds.includes(r.sourceArticleId)).length}`)

  const third = selectAt(`${RUN}-3`)
  check('🔴 🔴 **끝난 원천을 되풀이해 고르지 않는다**',
    third.workset.sourceIds.every((id) => !t2.has(id)), third.workset.sourceIds.join(','))
  /**
   * 🔴 **결론이 안 난 원천은 다시 올라온다** — 그것이 옳다. 판정은 AUTO_SEED 였는데
   *    초안이 중복으로 걸려 큐까지 못 간 원천이다. 🔴 다만 **공짜여야 한다** —
   *    입력도 계약도 그대로이므로 판정 캐시가 받는다. 그렇지 않으면 회차마다 돈이 샌다.
   */
  const r3 = judgeRound(`${RUN}-3`, third, Math.max(1, third.picked.length))
  check('🔴 🔴 **결론 안 난 원천을 다시 물어도 유료 호출 0** — 같은 입력·같은 계약이다',
    r3.code === 0 && r3.paid === 0, `${r3.paid}회 · code=${r3.code}`)
  check('🔴 그래도 그 묶음만 본다',
    r3.ids.slice().sort().join(',') === third.workset.sourceIds.slice().sort().join(','),
    r3.ids.join(','))

  // ── 되풀이가 멈추는가 ──
  const fourth = selectAt(`${RUN}-4`)
  check('🔴 🔴 **회차가 늘어도 끝난 원천은 영영 돌아오지 않는다**',
    fourth.workset.sourceIds.every((id) => !t2.has(id)), fourth.workset.sourceIds.join(','))
  check('🔴 🔴 **고르는 수가 늘지 않는다** — backlog 가 되살아나지 않는다',
    fourth.picked.length <= third.picked.length,
    `${third.picked.length} → ${fourth.picked.length}`)
  const seenAll = new Set([
    ...attempted1.keys(), ...second.workset.sourceIds, ...third.workset.sourceIds,
  ])
  check('🔴 🔴 **8건 전부 한 번씩은 끝까지 갔다** — 영구 제외도, 굶김도 없다',
    rows.every((r) => seenAll.has(r.sourceArticleId)), `${seenAll.size}/${rows.length}`)
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 🔴 🔴 계약이 바뀌면 끝난 것도 다시 본다')
// ─────────────────────────────────────────────────────────
{
  const before = concludedSourceIds(outcomesOf(w))
  check('🔴 이 시험이 헛돌지 않는다 — 바꾸기 전 terminal 이 있다', before.size > 0, `${before.size}건`)

  for (const [name, patch] of [
    ['생성 파이프라인 판', { pipelineVersion: 'content-core-v9' }],
    ['생성 프롬프트 판', { promptVersion: '다른-프롬프트' }],
    ['말투 자산 판', { voiceAssetDigest: '다른자산' }],
    ['Persona 후보 풀 판', { personaPoolDigest: '다른풀' }],
    ['출력 상한', { stageMaxOutputLabel: 'speakerPlan=1,draftGen=1,semanticReview=1' }],
    ['검수 판', { reviewVersion: 'review-v0' }],
    ['화자 계획 판', { speakerPlanVersion: 'speaker-plan-v0' }],
    ['계획 프롬프트', { planPromptDigest: '다른계획' }],
    ['단계 모델', { stageModels: { ...BASE.stageModels, draftGen: 'other-model' } }],
  ] as const) {
    const got = outcomesOf(w, { ...BASE, ...patch })
    check(`🔴 🔴 **${name}이 바뀌면 그 artifact 를 결론으로 쓰지 않는다**`,
      got.every((o) => o.stage === 'judge'),
      got.filter((o) => o.stage === 'draft').length === 0 ? '' : 'draft 결과가 남았다')
  }

  /** 🔴 판정 계약이 바뀌면 판정 결과도 쓰지 않는다 */
  for (const [name, patch] of [
    ['judge 규칙 판', { ruleVersion: 'auto-judge-v0' }],
    ['judge 프롬프트 판', { promptVersion: 'old-prompt' }],
    ['judge 모델', { judgeModel: 'other-model' }],
  ] as const) {
    const got = readPriorOutcomes({
      dataDir: w.dd, hashOf, canon: { ...CANON, ...patch }, base: BASE,
      artifactVersion: ARTIFACT_VERSION,
    })
    check(`🔴 🔴 **${name}이 바뀌면 그 판정을 결론으로 쓰지 않는다**`,
      got.every((o) => o.stage === 'draft'))
  }

  /** 🔴 원문이 바뀌면(지문이 달라지면) 전부 다시 본다 */
  const changed = readPriorOutcomes({
    dataDir: w.dd, hashOf: new Map([...hashOf].map(([id]) => [id, '바뀐지문'])),
    canon: CANON, base: BASE, artifactVersion: ARTIFACT_VERSION,
  })
  check('🔴 🔴 **원문 지문이 바뀌면 지난 결과가 하나도 남지 않는다**',
    changed.length === 0, `${changed.length}건`)
  check('🔴 스키마 판이 다르면 artifact 를 쓰지 않는다',
    readPriorOutcomes({
      dataDir: w.dd, hashOf, canon: CANON, base: BASE, artifactVersion: 'human-review-v0',
    }).every((o) => o.stage === 'judge'))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 🔴 🔴 말투 자산을 **실제로 바꾸고** 다시 돌린다')
// ─────────────────────────────────────────────────────────
{
  // 🔴 합성 자산을 다른 모양으로 다시 쓴다 — digest 가 달라진다
  writeFakePersonaAsset({ home: w.home, speakers: 21 })
  const after = contractBaseOf(w)
  check('🔴 🔴 **자산을 바꾸면 계약의 자산 판이 달라진다**',
    after.voiceAssetDigest !== BASE.voiceAssetDigest && after.voiceAssetDigest !== '',
    `${BASE.voiceAssetDigest} → ${after.voiceAssetDigest}`)
  const got = outcomesOf(w, after)
  check('🔴 🔴 **바뀐 자산으로는 지난 artifact 가 결론이 아니다**',
    got.every((o) => o.stage === 'judge'))
  // 🔴 원래대로 되돌린다 — 뒤 절이 같은 세상을 쓴다
  writeFakePersonaAsset({ home: w.home })
  check('🔴 되돌리면 계약도 되돌아온다',
    contractBaseOf(w).voiceAssetDigest === BASE.voiceAssetDigest)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 🔴 🔴 깨진 파일은 건너뛸 뿐 원천을 영영 굶기지 않는다')
// ─────────────────────────────────────────────────────────
{
  const before = concludedSourceIds(outcomesOf(w))
  writeFileSync(join(w.dd, 'auto-judge-broken.shadow.jsonl'),
    '{ 이건 JSON 이 아니다\n{"sourceArticleId":"e0"}\n', 'utf-8')
  writeFileSync(join(w.dd, 'auto-draft-broken.artifacts.json'), '{"nope":', 'utf-8')
  writeFileSync(join(w.dd, 'auto-draft-notarray.artifacts.json'), '{"a":1}', 'utf-8')
  const after = concludedSourceIds(outcomesOf(w))
  check('🔴 🔴 **깨진 파일이 terminal 집합을 바꾸지 않는다**',
    after.size === before.size && [...before].every((id) => after.has(id)),
    `${before.size} → ${after.size}`)

  // 🔴 모르는 상태값이 영구 제외가 되지 않는다
  writeFileSync(join(w.dd, 'auto-judge-unknown.shadow.jsonl'), `${JSON.stringify({
    sourceArticleId: 'e5', inputHash: hashOf.get('e5'), ruleVersion: RULE_VERSION,
    promptVersion: PROMPT_VERSION, model: JUDGE_MODEL, decision: '처음 보는 값',
    semanticStatus: 'ok', decidedAt: '2099-01-01T00:00:00.000Z',
  })}\n`, 'utf-8')
  const un = outcomesOf(w).filter((o) => o.sourceArticleId === 'e5')
  check('🔴 🔴 **모르는 판정은 unknown 이고 terminal 이 아니다**',
    un.some((o) => o.state === 'unknown') && !concludedSourceIds(outcomesOf(w)).has('e5'),
    un.map((o) => `${o.state}@${o.atMs}`).join(' '))
  const openAgain = selectWorkset({
    rows, humanDecided: new Set(), queuePending: NEXT.queued,
    concluded: concludedSourceIds(outcomesOf(w)), attempted: attemptedOutcomes(outcomesOf(w)),
    limit: 5, runId: `${RUN}-5`, takenAt: new Date(),
  })
  check('🔴 🔴 **그 원천은 다음 회차에 다시 올라온다**',
    openAgain.workset.sourceIds.includes('e5'), openAgain.workset.sourceIds.join(','))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ 🔴 🔴 묻기 전에 HOLD 인 원천에는 유료 요청이 나가지 않는다')
// ─────────────────────────────────────────────────────────
{
  const w3 = makeWorld()
  writeAdaptPair(w3.dd, [
    { id: 'h1', comments: 20, posted: '2026-09-19T00:00:00Z', lane: '아직-증명되지-않은-lane' },
  ])
  /**
   * 🔴 묶음 선택은 이 원천을 애초에 빼지만, **묶음에 들어왔다 해도** 판정기가
   *    돈을 쓰면 안 된다. 그래서 manifest 를 손으로 써서 러너에 강제로 넣는다.
   */
  const tag = '20260920-777777'
  writeFileSync(join(w3.dd, worksetFileName(tag)), `${JSON.stringify({
    kind: WORKSET_KIND, version: WORKSET_VERSION, runId: tag,
    takenAt: new Date().toISOString(), limit: 5, sourceIds: ['h1'],
  }, null, 2)}\n`, 'utf-8')
  const shadow = join(w3.dd, `auto-judge-${tag}.shadow.jsonl`)
  const log = join(w3.root, 'h.log')
  writeFileSync(log, '', 'utf-8')
  const r = runStage({
    script: 'scripts/micro-seed-auto-judge.mts', world: w3, cap: '5', bodyLog: log,
    judgeDecision: 'AUTO_SEED',
    args: ['--call', '--apply', `--run-id=${tag}`,
      `--ledger-run-id=${ledgerRunIdOf(tag, 'judge')}`,
      `--workset=${worksetFileName(tag).replace(/^/, '.microseed-data/')}`,
      `--shadow-out=.microseed-data/auto-judge-${tag}.shadow.jsonl`],
  })
  const paid = readFileSync(log, 'utf-8').split('\n').filter((l) => l.trim() !== '').length
  check('🔴 🔴 **결과가 정해진 원천에 유료 요청 0**', r.code === 0 && paid === 0,
    `${paid}회 · code=${r.code}\n${r.out.slice(-400)}`)
  const line = readFileSync(shadow, 'utf-8').split('\n').filter((l) => l.trim() !== '')[0] ?? '{}'
  const row = JSON.parse(line) as { decision?: string; reasonCodes?: string[] }
  check('🔴 🔴 **그래도 판정은 남는다 — AUTO_HOLD · 사유는 lane**',
    row.decision === 'AUTO_HOLD' && (row.reasonCodes ?? []).includes('laneNotProven'),
    `${String(row.decision)} · ${(row.reasonCodes ?? []).join(',')}`)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 🔴 🔴 AUTO_RAW — 한 번 판정되면 이 레인에서 끝이다')
// ─────────────────────────────────────────────────────────
{
  const w4 = makeWorld()
  /** 🔴 원문 그대로 레인의 축이어야 판정기가 AUTO_RAW 를 낸다 — 축은 우리가 정한다 */
  writeAdaptPair(w4.dd, [
    { id: 'raw1', comments: 30, posted: '2026-09-19T00:00:00Z', axis: RAW_AXIS, lane: 'originalRaw' },
    { id: 'raw2', comments: 20, posted: '2026-09-18T00:00:00Z', axis: RAW_AXIS, lane: 'originalRaw' },
  ])
  const rows4 = rowsOf(w4.dd)
  const hash4 = new Map(rows4.map((r) => [r.sourceArticleId, inputHashOf(r.input)]))
  const canon4 = { ruleVersion: RULE_VERSION, promptVersion: PROMPT_VERSION, judgeModel: JUDGE_MODEL }
  const base4 = contractBaseOf(w4)
  const out4 = (): PriorOutcome[] => readPriorOutcomes({
    dataDir: w4.dd, hashOf: hash4, canon: canon4, base: base4, artifactVersion: ARTIFACT_VERSION,
  })
  const tag = '20260920-888888'
  const first = selectWorkset({
    rows: rows4, humanDecided: new Set(), queuePending: new Set(),
    concluded: new Set(), attempted: new Map(), limit: 5, runId: tag, takenAt: new Date(),
  })
  /**
   * 🔴 **raw 는 상한 5 에서 한 회차 1 건이다** (2026-09-28 축별 자리). seed 가 없어도
   *    묶음을 raw 로 채우지 않는다 — 그래서 raw 두 건은 **두 회차에 걸쳐** 판정된다.
   */
  check('🔴 🔴 **seed 가 없어도 raw 는 한 회차 1 건 — 나머지 자리는 비운다**',
    first.workset.sourceIds.join(',') === 'raw1' && first.axis.quota.raw === 1,
    `${first.workset.sourceIds.join(',')} · raw 자리 ${first.axis.quota.raw}`)
  const ws = join(w4.dd, worksetFileName(tag))
  writeFileSync(ws, `${JSON.stringify(first.workset, null, 2)}\n`, 'utf-8')
  const log = join(w4.root, 'raw.log')
  writeFileSync(log, '', 'utf-8')
  const r = runStage({
    script: 'scripts/micro-seed-auto-judge.mts', world: w4, cap: '5', bodyLog: log,
    judgeDecision: 'AUTO_RAW',
    args: ['--call', '--apply', `--run-id=${tag}`,
      `--ledger-run-id=${ledgerRunIdOf(tag, 'judge')}`,
      `--workset=.microseed-data/${worksetFileName(tag)}`,
      `--shadow-out=.microseed-data/auto-judge-${tag}.shadow.jsonl`],
  })
  const shadow = readFileSync(join(w4.dd, `auto-judge-${tag}.shadow.jsonl`), 'utf-8')
    .split('\n').filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as { sourceArticleId: string; decision: string })
  check('🔴 🔴 **판정 러너가 실제로 AUTO_RAW 를 냈다 — 묶음의 1 건만**',
    r.code === 0 && shadow.length === 1 && shadow.every((x) => x.decision === 'AUTO_RAW'),
    `code=${r.code} · ${shadow.map((x) => x.decision).join(',')}\n${r.out.slice(-400)}`)

  const states = [...latestOutcomes(out4()).values()].map((o) => o.state)
  check('🔴 🔴 **AUTO_RAW 는 unknown 이 아니라 rawLane 이다**',
    states.length === 1 && states.every((x) => x === 'rawLane'), states.join(','))
  const next = selectWorkset({
    rows: rows4, humanDecided: new Set(), queuePending: new Set(),
    concluded: concludedSourceIds(out4()), attempted: attemptedOutcomes(out4()),
    limit: 5, runId: `${tag}-2`, takenAt: new Date(),
  })
  // 🔴 판정이 끝난 raw1 은 빠지고, 기다리던 raw2 가 그 raw 자리를 받는다 — raw 는 굶지 않는다
  check('🔴 🔴 **다음 회차에 다시 올라오지 않는다 — 다음 raw 가 차례를 받는다**',
    next.workset.sourceIds.join(',') === 'raw2' && next.dropped.terminal === 1,
    `${next.workset.sourceIds.join(',')} · 제외 ${next.dropped.terminal}`)

  // 🔴 생성 러너가 AUTO_RAW 를 초안 대상으로 집지 않는다 — 유료 호출 0
  const snap = join(w4.dd, queueSnapshotFileName(tag))
  writeFileSync(snap, `${JSON.stringify(buildQueueSnapshot({
    runId: tag, takenAt: new Date(), rows: [],
  }), null, 2)}\n`, 'utf-8')
  const dLog = join(w4.root, 'raw-draft.log')
  writeFileSync(dLog, '', 'utf-8')
  const d = runStage({
    script: 'scripts/micro-seed-auto-draft.mts', world: w4, cap: '15', bodyLog: dLog,
    args: ['--call', '--apply', `--run-id=${tag}`,
      `--ledger-run-id=${ledgerRunIdOf(tag, 'draft')}`,
      `--queue-snapshot=.microseed-data/${queueSnapshotFileName(tag)}`, '--require-queue-snapshot',
      `--input=.microseed-data/auto-judge-${tag}.shadow.jsonl`],
  })
  const dPaid = readFileSync(dLog, 'utf-8').split('\n').filter((l) => l.trim() !== '').length
  check('🔴 🔴 **AUTO_RAW 는 draft 슬롯을 쓰지 않는다 — 유료 호출 0**',
    dPaid === 0, `${dPaid}회 · code=${d.code}\n${d.out.slice(-300)}`)
  check('🔴 후보 파일도 만들지 않는다',
    readdirSync(w4.dd).filter((f) => /\.candidates\.json$/.test(f)).length === 0)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑨ 🔴 🔴 신규가 계속 들어와도 재시도가 굶지 않는다 (실제 파일)')
// ─────────────────────────────────────────────────────────
{
  const w5 = makeWorld()
  const base5 = contractBaseOf(w5)
  const canon5 = { ruleVersion: RULE_VERSION, promptVersion: PROMPT_VERSION, judgeModel: JUDGE_MODEL }
  /** 🔴 실제 판정 파일 한 줄 — 못 물어본 회차다(재시도) */
  const writeRetryShadow = (id: string, hash: string, at: string): void => {
    writeFileSync(join(w5.dd, `auto-judge-retry-${id}.shadow.jsonl`), `${JSON.stringify({
      sourceArticleId: id, ruleVersion: RULE_VERSION, promptVersion: PROMPT_VERSION,
      model: JUDGE_MODEL, inputHash: hash, decision: 'AUTO_HOLD', semanticStatus: 'timeout',
      decidedAt: at, provenance: 'machine-shadow', reasonCodes: ['semanticFailed'],
    })}\n`, 'utf-8')
  }
  writeAdaptPair(w5.dd, [{ id: 'old-retry', comments: 1, posted: '2026-09-01T00:00:00Z' }])
  writeRetryShadow('old-retry', inputHashOf(rowsOf(w5.dd)[0]!.input), '2026-09-01T00:00:00.000Z')

  let everPicked = 0
  for (let round = 1; round <= 10; round += 1) {
    const fresh = Array.from({ length: 5 }, (_, i) => ({
      id: `r${round}-${i}`, comments: 50 + i, posted: `2026-09-1${round % 10}T00:00:00Z`,
    }))
    const detail = fresh.map((f) => JSON.stringify({
      runId: `adapt-new-${round}`, sourceArticleId: f.id, sourceSite: 'navercafe:wgang',
      axis: SEED_AXIS, lane: PROVEN_LANE, access: 'ok', safetyVerdict: 'pass', safetyReasons: '',
      title: `우리 나이 이야기 ${f.id}`,
      bodyHead: `${f.id} 원문 머리입니다. 사람들이 반응한 이야기이고 질문으로 끝납니다. 다들 어떠세요?`,
      commentCount: f.comments, bodyLength: 300, imageCount: 0, assetAxes: 'sleep|work',
      qualityFlags: [], sourcePostedAt: f.posted, sourceListedAt: f.posted,
      sourceCapturedAt: f.posted,
    })).join('\n')
    writeFileSync(join(w5.dd, `adapt-new-${round}.detail.jsonl`), `${detail}\n`, 'utf-8')

    const rows5 = rowsOf(w5.dd)
    const hash5 = new Map(rows5.map((r) => [r.sourceArticleId, inputHashOf(r.input)]))
    const got = readPriorOutcomes({
      dataDir: w5.dd, hashOf: hash5, canon: canon5, base: base5,
      artifactVersion: ARTIFACT_VERSION,
    })
    const plan = selectWorkset({
      rows: rows5, humanDecided: new Set(), queuePending: new Set(),
      concluded: concludedSourceIds(got), attempted: attemptedOutcomes(got),
      limit: 5, runId: `w5-${round}`, takenAt: new Date(`2026-09-2${round % 10}T00:00:00.000Z`),
    })
    if (plan.workset.sourceIds.includes('old-retry')) everPicked += 1
  }
  check('🔴 🔴 **실제 판정 파일로도 재시도가 매 회차 자리를 얻는다**',
    everPicked === 10, `${everPicked}/10`)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑩ 🔴 🔴 문서 오탈자 한 줄로 전량 다시 만들지 않는다')
// ─────────────────────────────────────────────────────────
{
  const w6 = makeWorld({ copyDocs: true })
  const doc = join(w6.root, PERSONA_POOL_DOC)
  const before = contractBaseOf(w6)
  check('🔴 후보 풀 지문이 실제로 잡힌다', before.personaPoolDigest !== '')

  // 🔴 뜻이 바뀌지 않는 한 줄 — 주석
  writeFileSync(doc, `${readFileSync(doc, 'utf-8')}\n<!-- 오탈자 한 줄 고침 -->\n`, 'utf-8')
  check('🔴 🔴 **뜻 없는 문서 수정은 계약을 바꾸지 않는다** — 전량 miss 되지 않는다',
    contractBaseOf(w6).personaPoolDigest === before.personaPoolDigest)

  /**
   * 🔴 **생활사 한 줄이 바뀌면 계약이 바뀐다.** 나이대는 생성·검수 프롬프트에
   *    그대로 실린다 — 바뀌었는데 옛 결과를 결론으로 쓰면 안 된다.
   */
  const aged = readFileSync(doc, 'utf-8').replace('ageBand 40대 후반', 'ageBand 50대 초반')
  check('🔴 문서에서 그 줄을 실제로 찾았다', aged !== readFileSync(doc, 'utf-8'))
  writeFileSync(doc, aged, 'utf-8')
  check('🔴 🔴 **카드의 나이대가 바뀌면 계약이 바뀐다**',
    contractBaseOf(w6).personaPoolDigest !== before.personaPoolDigest)

  // 🔴 후보 자체가 바뀌어도 계약이 바뀐다
  writeFileSync(doc, readFileSync(doc, 'utf-8').replaceAll('P01', 'P99'), 'utf-8')
  check('🔴 🔴 **후보 풀이 실제로 바뀌면 계약도 바뀐다**',
    contractBaseOf(w6).personaPoolDigest !== before.personaPoolDigest)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑳ 🔴 🔴 화자 여력 파일 — 공급 러너 → 파일 → 생성 러너 → artifact')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **연결해서 본다.** 순수 함수 검사만으로는 "유료 생성이 조용히 전체 후보로
   *    되돌아가지 않는다" 를 말할 수 없다 — 실제 러너가 그 파일을 읽고 멈추는지를
   *    봐야 한다. 아래는 같은 세계에서 **파일만 바꿔** FAIL → PASS 를 보인다.
   */
  const seeds = Array.from({ length: 5 }, (_, i) => ({
    id: `sl-${i}`, comments: 12, posted: '2026-09-18T00:00:00.000Z',
  }))
  const draftRun = (kind: 'none' | 'stale' | 'malformed' | 'fresh') => {
    const tagForLoad = `20260922-${kind}`
    const w = makeWorld({ speakerLoad: kind, speakerLoadRunId: tagForLoad })
    const rel = (p: string): string => p.slice(w.root.length + 1)
    writeAdaptPair(w.dd, seeds)
    const tag = `20260922-${kind}`
    // 🔴 묶음은 **정본이 만든다** — 손으로 적으면 계약이 어긋나 판정이 0건이 된다
    const plan2 = selectWorkset({
      rows: rowsOf(w.dd), humanDecided: new Set(), queuePending: new Set(),
      concluded: new Set(), attempted: new Map(),
      limit: 5, runId: tag, takenAt: new Date(),
    })
    const wsPath = join(w.dd, worksetFileName(tag))
    writeFileSync(wsPath, `${JSON.stringify(plan2.workset, null, 2)}\n`, 'utf-8')
    const jr = runStage({
      script: 'scripts/micro-seed-auto-judge.mts', world: w, cap: '5', judgeDecision: 'AUTO_SEED',
      args: ['--call', '--apply', `--run-id=${tag}`,
        `--ledger-run-id=${ledgerRunIdOf(tag, 'judge')}`,
        `--workset=${rel(wsPath)}`, `--shadow-out=${rel(join(w.dd, `auto-judge-${tag}.shadow.jsonl`))}`],
    })
    const dr = runStage({
      script: 'scripts/micro-seed-auto-draft.mts', world: w, cap: '15',
      args: ['--call', '--apply', `--run-id=${tag}`,
        `--ledger-run-id=${ledgerRunIdOf(tag, 'draft')}`, `--workset=${rel(wsPath)}`],
    })
    return { w, jr, dr }
  }

  // ── 🔴 파일이 없으면 유료 생성이 멈춘다 ──
  for (const kind of ['none', 'stale', 'malformed'] as const) {
    const { w, dr } = draftRun(kind)
    const arts = readdirSync(w.dd).filter((x) => /\.artifacts\.json$/.test(x))
    check(`🔴 🔴 **여력 파일 ${kind} — 유료 생성이 멈춘다 (exit≠0)**`,
      dr.code !== 0 && /화자 여력을 쓸 수 없다/.test(dr.out),
      `code=${dr.code} ${dr.out.slice(-260)}`)
    check(`🔴 ${kind} — artifact 도 후보 파일도 만들지 않았다`,
      arts.length === 0
      && readdirSync(w.dd).filter((x) => /\.candidates\.json$/.test(x)).length === 0,
      arts.join(','))
  }

  // ── 🔴 같은 세계에 파일이 있으면 통과한다 ──
  {
    const { w, dr } = draftRun('fresh')
    const arts = readdirSync(w.dd).filter((x) => /\.artifacts\.json$/.test(x))
    check('🔴 🔴 **여력 파일이 있으면 생성이 돈다 — 같은 배선에서 FAIL → PASS**',
      dr.code === 0 && arts.length === 1, `code=${dr.code} arts=${arts.length}`)
    check('🔴 러너가 여력을 읽었다고 적는다',
      /화자 여력 \d+명/.test(dr.out), dr.out.slice(-220))

    /** 🔴 **artifact 의 화자가 서로 다르다** — 한 회차가 한 사람에게 몰아주지 않는다 */
    const parsed = JSON.parse(readFileSync(join(w.dd, arts[0]!), 'utf-8')) as
      Record<string, { plan?: { personaCode?: string } }>
    const codes = Object.values(parsed).map((a) => a.plan?.personaCode ?? '')
      .filter((c) => c !== '')
    check('🔴 🔴 **한 회차의 artifact 화자가 서로 겹치지 않는다**',
      codes.length >= 2 && new Set(codes).size === codes.length, codes.join(','))

    /** 🔴 **다음 묶음**이 그 결과를 읽는다 — 채택된 것은 결론이 아니다 */
    /**
     * 🔴 **다음 단계로 이어진다.** 채택된 것은 후보 파일로 나가고,
     *    멈춘 것은 artifact 에 **사유 값**으로 남아 다음 묶음이 읽는다.
     */
    const candFiles = readdirSync(w.dd).filter((x) => /\.candidates\.json$/.test(x))
    check('🔴 채택된 것이 후보 파일로 나간다', candFiles.length === 1, candFiles.join(','))
    const causes = Object.values(parsed)
      .map((a) => (a as { review?: { semanticCompletion?: { cause?: string | null } } })
        .review?.semanticCompletion?.cause ?? null)
    check('🔴 🔴 **멈춘 것이 있다면 사유가 값으로 남는다 — `speakerUnqualified` 로 뭉개지 않는다**',
      causes.every((c) => c === null || c !== 'speakerUnqualified'
        || codes.length === 0),
      causes.map((c) => String(c)).join(','))
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n㉑ 🔴 🔴 좁힌 묶음 탓 HOLD 는 다음 회차에 다시 본다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **결론과 재시도를 가른다.** 좁힌 묶음에 맞는 사람이 없어 멈춘 것은
   *    `speakerSlotNarrowed` 이고 **다시 본다**. 전체 후보에서도 자격이 없는 것은
   *    `speakerUnqualified` 이고 **결론**이다. 섞으면 정상 원천이 영구 제외된다.
   */
  check('🔴 🔴 **`speakerSlotNarrowed` 는 다시 시도한다**',
    (RETRYABLE_CAUSES as readonly string[]).includes('speakerSlotNarrowed'))
  check('🔴 🔴 **`speakerUnqualified` 는 그대로 결론이다**',
    !(RETRYABLE_CAUSES as readonly string[]).includes('speakerUnqualified'))
  check('🔴 두 값은 서로 다른 이름이다',
    INCOMPLETE_CAUSE_LABEL.speakerSlotNarrowed !== INCOMPLETE_CAUSE_LABEL.speakerUnqualified)

  /** 🔴 생성 러너가 좁혀졌을 때만 그 값을 쓴다 */
  const runSrc = readFileSync('scripts/lib/content-core-run.mts', 'utf-8')
  check('🔴 🔴 **좁혀졌을 때만 재시도 값으로 적는다**',
    /input\.personas\.length < input\.personaPoolSize/.test(runSrc)
    && /narrowed \? 'speakerSlotNarrowed' as const : 'speakerUnqualified' as const/.test(runSrc))
}

// ─────────────────────────────────────────────────────────
console.log('\n㉒ 🔴 🔴 재계획 — 실제 러너로 세 갈래를 값으로 본다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **실제 `micro-seed-auto-draft.mts` 를 같은 세계에서 거듭 spawn 한다.**
   *    러너가 앞 회차 artifact 를 스스로 읽고 무엇을 바꾸는지 **파일로** 확인한다.
   *
   * 🔴 세 갈래를 가른다 (2026-09-23 마스터 P0-1):
   *    ⓐ 사람을 바꾸면 될 수 있는 실패 → **사람이 실제로 바뀐다**
   *    ⓑ 사람을 바꿔도 소용없는 실패(load-bearing) → **사람을 태우지 않는다**
   *    ⓒ 자리를 바꾸면 되는 경우 → **자리가 바뀌어 통과한다**
   */
  const SELF_AGE = '44'
  const mk = (tagBase: string) => {
    const w = makeWorld({ speakerLoad: 'fresh', speakerLoadRunId: `${tagBase}-0` })
    const rel = (p: string): string => p.slice(w.root.length + 1)
    writeAdaptPair(w.dd, [{
      id: 'rp-0', comments: 21, posted: '2026-09-18T00:00:00.000Z',
      head: `제가 ${SELF_AGE}인데 요즘 부쩍 그런 생각이 들어요. 다들 어떠세요?`,
    }])
    const plan = selectWorkset({
      rows: rowsOf(w.dd), humanDecided: new Set(), queuePending: new Set(),
      concluded: new Set(), attempted: new Map(),
      limit: 5, runId: `${tagBase}-ws`, takenAt: new Date(),
    })
    const wsPath = join(w.dd, worksetFileName(`${tagBase}-ws`))
    writeFileSync(wsPath, `${JSON.stringify(plan.workset, null, 2)}\n`, 'utf-8')
    runStage({
      script: 'scripts/micro-seed-auto-judge.mts', world: w, cap: '5', judgeDecision: 'AUTO_SEED',
      args: ['--call', '--apply', `--run-id=${tagBase}-ws`,
        `--ledger-run-id=${ledgerRunIdOf(`${tagBase}-ws`, 'judge')}`,
        `--workset=${rel(wsPath)}`,
        `--shadow-out=${rel(join(w.dd, `auto-judge-${tagBase}-ws.shadow.jsonl`))}`],
    })
    return { w, rel, wsPath }
  }
  type Shot = { out: string; picked: string[]; stances: string[]; causes: string[] }
  const draftOnce = (
    world: { w: { dd: string; root: string; home: string }; rel: (p: string) => string; wsPath: string },
    tag: string,
    knobs: { selfAgeRole?: 'incidental' | 'loadBearing'; obeyForbid?: boolean; dropAge?: boolean },
  ): Shot => {
    // 🔴 여력 파일은 **그 회차의 것**이어야 한다 — 운영에서도 회차마다 적는다
    writeSpeakerLoadFile(world.w.dd, 'fresh', tag)
    const r = runStage({
      script: 'scripts/micro-seed-auto-draft.mts', world: world.w, cap: '15',
      selfAge: SELF_AGE, ...knobs,
      args: ['--call', '--apply', `--run-id=${tag}`,
        `--ledger-run-id=${ledgerRunIdOf(tag, 'draft')}`, `--workset=${world.rel(world.wsPath)}`],
    })
    const f = readdirSync(world.w.dd).filter((x) => x === `auto-draft-${tag}.artifacts.json`)
    const arts = f.length === 0 ? [] : JSON.parse(readFileSync(join(world.w.dd, f[0]!), 'utf-8')) as
      Record<string, unknown>[]
    const planOf = (a: Record<string, unknown>) => (a.plan ?? {}) as Record<string, unknown>
    const causeOf = (a: Record<string, unknown>): string => {
      const rev = a.review as Record<string, unknown> | undefined
      const c = rev?.semanticCompletion as Record<string, unknown> | undefined
      return String(c?.cause ?? '')
    }
    return {
      out: r.out,
      picked: arts.map((a) => String(planOf(a).personaCode ?? '')),
      stances: arts.map((a) => String(planOf(a).stance ?? '')),
      causes: arts.map(causeOf),
    }
  }

  // ── ⓐ 사람을 바꾸면 될 수 있는 실패 — 초안이 나이를 통째로 뺀다 ──
  {
    const world = mk('20260922-ra')
    const r1 = draftOnce(world, '20260922-ra1', { dropAge: true })
    check('🔴 🔴 **ⓐ 초안이 나이를 빼면 `personaTransformFailed` 다 — 사람을 바꿔 볼 값이 있다**',
      r1.causes.join(',') === 'personaTransformFailed' && r1.picked[0] !== '',
      `${r1.picked.join(',')} · ${r1.causes.join(',')}`)
    const r2 = draftOnce(world, '20260922-ra2', { dropAge: true })
    check('🔴 🔴 **ⓐ 다음 회차에 실제로 다른 사람이 나간다**',
      r2.picked.length === 1 && r2.picked[0] !== '' && r2.picked[0] !== r1.picked[0],
      `1회차 ${r1.picked.join(',')} → 2회차 ${r2.picked.join(',')}`)
  }

  /**
   * ── ⓑ 🔴 **사람을 바꿔도 소용없는 실패** ──
   *    원문 44 가 결론을 바꾼다. 후보 중 44 인 사람이 없다 —
   *    앞판은 여기서 **세 명을 차례로 태웠다.** 지금은 태우지 않는다.
   */
  {
    const world = mk('20260922-rb')
    const r1 = draftOnce(world, '20260922-rb1', { selfAgeRole: 'loadBearing' })
    check('🔴 🔴 **ⓑ 만족하는 후보가 없으면 `loadBearingSelfImpossible` 이다**',
      r1.causes.join(',') === 'loadBearingSelfImpossible',
      `${r1.picked.join(',')} · ${r1.causes.join(',')}`)
    const r2 = draftOnce(world, '20260922-rb2', { selfAgeRole: 'loadBearing' })
    check('🔴 🔴 **ⓑ 그 사람을 태우지 않는다 — 다음 회차도 같은 사람이다**',
      r2.picked.length === 1 && r2.picked[0] === r1.picked[0],
      `1회차 ${r1.picked.join(',')} → 2회차 ${r2.picked.join(',')}`)
    check('🔴 🔴 **ⓑ 지시를 무시하고 또 1인칭이면 `meaningUnpreservable` — 한 번에 결론이다**',
      r2.causes.join(',') === 'meaningUnpreservable', r2.causes.join(','))
    const r3 = draftOnce(world, '20260922-rb3', { selfAgeRole: 'loadBearing' })
    check('🔴 🔴 **ⓑ 결론 뒤에는 만들지 않는다 — 세 번째 유료 시도가 없다**',
      r3.picked.length === 0 && /CONCLUDED/.test(r3.out),
      `${r3.picked.join(',')} · ${r3.out.slice(-200)}`)
    /**
     * 🔴 **운영 경로에서도 결론이다.** 공급 러너는 `concludedSourceIds` 로 먼저 거른다 —
     *    러너 안의 방어와 **따로** 확인한다. 한쪽만 보면 다른 쪽이 조용히 열려 있어도 모른다.
     */
    check('🔴 🔴 **ⓑ 공급 러너의 묶음 선택에서도 빠진다 — 같은 원천을 다시 사지 않는다**', (() => {
      const outcomes = readPriorOutcomes({
        dataDir: world.w.dd,
        hashOf: new Map(rowsOf(world.w.dd).map((r) => [r.sourceArticleId, inputHashOf(r.input)])),
        canon: CANON, base: contractBaseOf(world.w), artifactVersion: ARTIFACT_VERSION,
      })
      const done = concludedSourceIds(outcomes)
      const next = selectWorkset({
        rows: rowsOf(world.w.dd), humanDecided: new Set(), queuePending: new Set(),
        concluded: done, attempted: new Map(),
        limit: 5, runId: '20260922-rb-next', takenAt: new Date(),
      })
      return done.has('rp-0') && !next.workset.sourceIds.includes('rp-0')
    })())
  }

  /**
   * ── ⓒ 🔴 **자리를 바꾸면 된다** ──
   *    계획기가 요청의 1인칭 금지를 읽고 QUESTION 으로 바꾼다 — 실제 모델이 하는 일이다.
   */
  {
    const world = mk('20260922-rc')
    const r1 = draftOnce(world, '20260922-rc1', { selfAgeRole: 'loadBearing', obeyForbid: true })
    check('🔴 🔴 **ⓒ 1회차는 1인칭이라 멈춘다**',
      r1.causes.join(',') === 'loadBearingSelfImpossible' && r1.stances.join(',') === 'SELF_EXPERIENCE',
      `${r1.stances.join(',')} · ${r1.causes.join(',')}`)
    const r2 = draftOnce(world, '20260922-rc2', { selfAgeRole: 'loadBearing', obeyForbid: true })
    check('🔴 🔴 **ⓒ 2회차는 자리가 바뀐다 — 금지가 요청에 실제로 실렸다**',
      r2.stances.join(',') !== 'SELF_EXPERIENCE' && r2.stances[0] !== undefined,
      `${r1.stances.join(',')} → ${r2.stances.join(',')}`)
    check('🔴 🔴 **ⓒ 그 회차는 load-bearing 으로 멈추지 않는다 — 의미가 보존됐다**',
      !['loadBearingSelfImpossible', 'meaningUnpreservable', 'loadBearingMismatch']
        .includes(r2.causes[0] ?? ''),
      `${r2.causes.join(',')} · ${r2.out.slice(-160)}`)
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n㉓ 🔴 🔴 회차 시각 하나 — 부모가 준 값을 자식이 그대로 쓴다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **자식의 벽시계를 부모와 다르게 만들어 본다.** 앞판은 부모·자식이 각자
   *    `new Date()` 를 만들었다 — KST 자정이나 Persona 생일 경계를 사이에 두면
   *    **다른 날**을 보고 계약(`personaPoolDigest`)이 갈렸다. 그러면 끝난 원천이
   *    terminal 로 인정되지 않아 같은 원천을 유료로 되풀이한다.
   *
   * 🔴 탐침을 **자식처럼** 띄워, 부모가 준 `SORAN_RUN_AT` 만으로 값이 정해지는지 본다.
   */
  const w = makeWorld({})
  const probe = join(w.root, 'clock-probe.mts')
  writeFileSync(probe, [
    `import { currentContractBase } from '${join(ROOT, 'scripts/lib/generation-contract.mjs')}'`,
    `import { runClockFrom } from '${join(ROOT, 'scripts/lib/run-clock.mjs')}'`,
    `import { materializePersonaAt } from '${join(ROOT, 'src/lib/persona-birth-anchor')}'`,
    'const c = runClockFrom(process.env)',
    "const at = materializePersonaAt({ card: { code: 'P02', birthDate: '1979-06-20', ageBand: '40대 후반' }, now: c.at })",
    'process.stdout.write(JSON.stringify({',
    '  from: c.from, iso: c.at.toISOString(),',
    '  pool: currentContractBase(c.at).personaPoolDigest,',
    "  age: at.ok ? at.at.exactAge : null, band: at.ok ? at.at.effectiveAgeBand : null,",
    '}))',
  ].join('\n'), 'utf-8')
  const ask = (runAt: string | undefined, tz: string): Record<string, unknown> => {
    const env: Record<string, string> = { ...process.env as Record<string, string>, HOME: w.home, TZ: tz }
    if (runAt === undefined) delete env.SORAN_RUN_AT
    else env.SORAN_RUN_AT = runAt
    const r = spawnSync(TSX, [probe], { cwd: w.root, encoding: 'utf-8', env })
    if (r.status !== 0) throw new Error(`탐침 실패: ${r.stderr ?? ''}`)
    return JSON.parse(r.stdout) as Record<string, unknown>
  }

  /**
   * 🔴 KST 자정 경계 — 같은 순간을 서로 **다른 시간대**의 자식이 받는다.
   *    부모가 준 값을 쓰면 두 자식의 결과가 같아야 한다.
   */
  const PARENT = '2026-09-23T15:00:00.000Z'   // KST 2026-09-24 00:00
  const a = ask(PARENT, 'Asia/Seoul')
  const b = ask(PARENT, 'America/Los_Angeles')
  check('🔴 🔴 **① 부모가 준 시각을 썼다고 값으로 말한다**',
    a.from === 'parent' && b.from === 'parent', JSON.stringify({ a: a.from, b: b.from }))
  check('🔴 🔴 **① 자식 시간대가 달라도 같은 순간이다**', a.iso === PARENT && b.iso === PARENT,
    `${String(a.iso)} vs ${String(b.iso)}`)
  check('🔴 🔴 **① 후보 풀 지문이 같다 — 계약이 갈리지 않는다**',
    a.pool === b.pool && String(a.pool) !== '', `${String(a.pool)} vs ${String(b.pool)}`)
  check('🔴 🔴 **① exactAge · effectiveAgeBand 가 같다**',
    a.age === b.age && a.band === b.band,
    `${String(a.age)}/${String(a.band)} vs ${String(b.age)}/${String(b.band)}`)

  /**
   * 🔴 ② **생일 경계** — 부모가 생일 하루 전/당일을 주면 자식은 그대로 다른 나이를 낸다.
   *    (시각이 실제로 쓰인다는 반례다 — 안 쓰면 둘이 같아진다)
   */
  const before = ask('2026-06-19T12:00:00.000Z', 'Asia/Seoul')
  const after = ask('2026-06-20T12:00:00.000Z', 'Asia/Seoul')
  check('🔴 🔴 **② 생일 경계에서 부모가 준 날짜대로 나이가 갈린다 — 주입된 값이 실제로 쓰인다**',
    typeof before.age === 'number' && typeof after.age === 'number'
    && (after.age as number) === (before.age as number) + 1,
    `${String(before.age)} → ${String(after.age)}`)

  /** 🔴 ③ 부모가 주지 않으면 자기 시계다 — 단독 실행은 막지 않는다 */
  check('🔴 🔴 **③ 부모가 없으면 자기 시계라고 값으로 말한다**',
    ask(undefined, 'Asia/Seoul').from === 'self')

  /** 🔴 ④ 모양이 틀린 값은 조용히 자기 시계로 돌아가지 않는다 — 던진다 */
  check('🔴 🔴 **④ 모양이 틀린 시각은 조용히 무시되지 않는다 (fail-closed)**', (() => {
    const env: Record<string, string> = {
      ...process.env as Record<string, string>, HOME: w.home, SORAN_RUN_AT: 'not-a-time',
    }
    const r = spawnSync(TSX, [probe], { cwd: w.root, encoding: 'utf-8', env })
    return r.status !== 0 && /SORAN_RUN_AT/.test(`${r.stderr ?? ''}`)
  })())

  /** 🔴 ⑤ 부모가 실제로 그 env 를 자식에게 싣는가 — 배선 검사 */
  const parentSrc = readFileSync(join(ROOT, 'scripts/supply-process.mts'), 'utf-8')
  check('🔴 🔴 **⑤ 부모가 회차 시각을 자식 env 에 싣는다**',
    /\[RUN_AT_ENV\]: RUN_AT\.toISOString\(\)/.test(parentSrc)
    && /env: \{ \.\.\.process\.env, \.\.\.withClock \}/.test(parentSrc))
  check('🔴 🔴 **⑤ 부모의 회차 시각은 하나다 — 두 번 만들지 않는다**',
    // 🔴 2026-09-26 — 부모도 `runClockFrom` 으로 **한 번** 만든다. main 도 그 값을 쓴다
    (parentSrc.match(/export const RUN_AT = RUN_CLOCK\.at/g) ?? []).length === 1
    && /export const RUN_CLOCK = runClockFrom\(process\.env\)/.test(parentSrc)
    && !/const RUN_AT = new Date\(\)/.test(parentSrc)
    && /const now = RUN_AT\n/.test(parentSrc)
    && /const runAt = RUN_AT/.test(parentSrc))
  const childSrc = readFileSync(join(ROOT, 'scripts/micro-seed-auto-draft.mts'), 'utf-8')
  check('🔴 🔴 **⑤ 자식은 자기 `new Date()` 로 회차 시각을 만들지 않는다**',
    /const RUN_CLOCK = runClockFrom\(process\.env\)/.test(childSrc)
    && !/const RUN_AT = new Date\(\)/.test(childSrc))
}

// ─────────────────────────────────────────────────────────
console.log('\n㉔ 🔴 🔴 후보 봉투 — 실제 writer 가 적은 파일을 그대로 검증한다')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 **검사가 봉투를 손으로 조립하지 않는다** (2026-09-23 마스터 지적).
   *    축약본을 조립하면 러너가 칸을 빠뜨려도 검사는 통과한다 — 실제로
   *    `semanticReview` 가 빠진 채 적재까지 갔다(P07 실측).
   *    🔴 여기서는 **실제 러너를 임시 디렉터리에서 돌려 산출 파일을 읽는다.**
   */
  const tag = '20260922-env'
  const w = makeWorld({ speakerLoad: 'fresh', speakerLoadRunId: tag })
  const rel = (p: string): string => p.slice(w.root.length + 1)
  writeAdaptPair(w.dd, [{ id: 'env-0', comments: 18, posted: '2026-09-18T00:00:00.000Z' }])
  const plan = selectWorkset({
    rows: rowsOf(w.dd), humanDecided: new Set(), queuePending: new Set(),
    concluded: new Set(), attempted: new Map(),
    limit: 5, runId: tag, takenAt: new Date(),
  })
  const wsPath = join(w.dd, worksetFileName(tag))
  writeFileSync(wsPath, `${JSON.stringify(plan.workset, null, 2)}\n`, 'utf-8')
  runStage({
    script: 'scripts/micro-seed-auto-judge.mts', world: w, cap: '5', judgeDecision: 'AUTO_SEED',
    args: ['--call', '--apply', `--run-id=${tag}`,
      `--ledger-run-id=${ledgerRunIdOf(tag, 'judge')}`, `--workset=${rel(wsPath)}`,
      `--shadow-out=${rel(join(w.dd, `auto-judge-${tag}.shadow.jsonl`))}`],
  })
  runStage({
    script: 'scripts/micro-seed-auto-draft.mts', world: w, cap: '15',
    args: ['--call', '--apply', `--run-id=${tag}`,
      `--ledger-run-id=${ledgerRunIdOf(tag, 'draft')}`, `--workset=${rel(wsPath)}`],
  })

  const candPath = join(w.dd, `auto-draft-${tag}.candidates.json`)
  const artPath = join(w.dd, `auto-draft-${tag}.artifacts.json`)
  const env = existsSync(candPath)
    ? JSON.parse(readFileSync(candPath, 'utf-8')) as Record<string, unknown>
    : {}
  const items = Array.isArray(env.candidates) ? env.candidates as Record<string, unknown>[] : []
  check('🔴 🔴 **① 실제 writer 가 후보를 적었다 (검사가 조립한 객체가 아니다)**',
    items.length === 1, `${items.length}건 · ${candPath}`)

  const it = items[0] ?? {}
  check('🔴 🔴 **② 운영 봉투의 모든 필수 칸이 실제 파일에 있다**',
    missingCandidateKeys(it).length === 0, missingCandidateKeys(it).join(' · '))

  /** 🔴 artifactId 는 그 한 장을 정확히 가리켜야 한다 — 사람 검토의 열쇠다 */
  const arts = existsSync(artPath)
    ? JSON.parse(readFileSync(artPath, 'utf-8')) as Record<string, unknown>[] : []
  check('🔴 🔴 **③ `artifactId` 가 실제 artifact 한 장과 이어진다**',
    String(it.artifactId ?? '') !== ''
    && arts.some((a) => a.artifactId === it.artifactId),
    `${String(it.artifactId)} · artifact ${arts.length}장`)

  /** 🔴 원문 쪽 세 시각 — 적재가 신선도를 재는 값이다 */
  check('🔴 🔴 **④ 원문 세 시각이 값으로 실렸다 — 지금 시각으로 채우지 않았다**',
    it.sourcePostedAt === '2026-09-18T00:00:00.000Z'
    && it.sourceListedAt === '2026-09-18T00:00:00.000Z'
    && String(it.sourceCapturedAt ?? '') !== '',
    JSON.stringify({ p: it.sourcePostedAt, l: it.sourceListedAt, c: it.sourceCapturedAt }))

  /** 🔴 말투 근거 — 적재 정본이 읽는 `comments` 이름으로 이어져야 한다 */
  const vp = (it.voiceProvenance ?? null) as Record<string, unknown> | null
  check('🔴 🔴 **⑤ voiceProvenance 가 적재 정본 모양이다 (`comments` 로 잇는다)**',
    vp !== null && String(vp.personaCode ?? '') !== '' && typeof vp.comments === 'number'
    && String(vp.bundleDigest ?? '') !== '' && String(vp.sourceDigest ?? '') !== '',
    JSON.stringify(vp))

  /** 🔴 의미 검수 요약 — 빠지면 모델이 찾은 결함이 적재까지 오지 못한다 */
  const sr = (it.semanticReview ?? null) as Record<string, unknown> | null
  check('🔴 🔴 **⑥ semanticReview 가 실렸다 — P07 에서 통째로 사라졌던 칸이다**',
    sr !== null && typeof sr === 'object' && Object.keys(sr).length > 0, JSON.stringify(sr))

  /** 🔴 어느 판정에서 왔는가 — 상수를 찍으면 근거가 아니라 장식이다 */
  check('🔴 🔴 **⑦ autoJudge 근거가 실렸다**',
    it.autoJudge !== null && it.autoJudge !== undefined, JSON.stringify(it.autoJudge))

  /** 🔴 원문 전문·제목은 담지 않는다 — 대조 결과만이다 */
  check('🔴 🔴 **⑧ 원문 제목 전문이 봉투에 없다 — 대조 결과만 싣는다**',
    it.sourceTitleChecked === true && typeof it.sourceTitleCopied === 'boolean'
    && !JSON.stringify(it).includes('우리 나이 이야기 env-0'),
    `${String(it.sourceTitleChecked)} · ${String(it.sourceTitleCopied)}`)

  /**
   * 🔴 ⑨ **러너와 검사가 같은 함수를 부른다.** 축약본을 따로 조립하면
   *    러너가 칸을 빠뜨려도 검사는 통과한다 — 그 자리를 없앤다.
   */
  const runnerSrc = readFileSync(join(ROOT, 'scripts/micro-seed-auto-draft.mts'), 'utf-8')
  check('🔴 🔴 **⑨ 러너가 공용 조립 함수를 부른다**',
    /candidateEnvelope\(\{/.test(runnerSrc))
  check('🔴 🔴 **⑨ 러너가 후보 객체를 따로 조립하지 않는다**',
    !/candidateType: 'seedOriginality'/.test(runnerSrc),
    runnerSrc.split('\n').filter((l) => l.includes('candidateType')).join(' | '))
}

// ─────────────────────────────────────────────────────────
console.log('\n㉕ 🔴 🔴 신선도 merge — 빈 값이 아는 값을 지우지 않는다 (마스터 P0-4)')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 실측 결함(2026-09-23): `.raw-detail.jsonl` 에는 원문 쪽 세 시각이 **아예 없는데**
   *    같은 원천이 두 파일에 다 있어서(운영 1321건) 나중에 읽은 raw 가 앞서 읽은 시각을
   *    **빈 문자열로 지웠다.** 실제로 `auto-draft-20260922-131506.candidates.json` 이
   *    세 칸을 비운 채 나갔다.
   *
   * 🔴 여기서는 **실제 러너를 돌려 산출 파일**로 확인한다. 세 파일을 같은 원천에 겹쳐 둔다:
   *    ① 오래된 detail — 유효한 시각
   *    ② 더 최신 detail — **다른** 유효한 시각
   *    ③ raw-detail — 빈 시각
   *    결과는 **가장 최신의 비어 있지 않은 값**이어야 한다.
   */
  const tag = '20260922-fresh'
  const w = makeWorld({ speakerLoad: 'fresh', speakerLoadRunId: tag })
  const rel = (p: string): string => p.slice(w.root.length + 1)
  const ID = 'fr-0'
  const OLD = '2026-09-10T00:00:00.000Z'
  const NEW_T = '2026-09-18T00:00:00.000Z'
  const row = (o: Record<string, unknown>): string => JSON.stringify({
    sourceArticleId: ID, sourceSite: 'navercafe:wgang',
    axis: SEED_AXIS, lane: PROVEN_LANE, access: 'ok', accessStatus: 'ok',
    safetyVerdict: 'pass', safetyReasons: '',
    title: '우리 나이 이야기 fr-0',
    bodyHead: 'fr-0 원문 머리입니다. 사람들이 반응한 이야기이고 질문으로 끝납니다. 다들 어떠세요?',
    commentCount: 19, bodyLength: 300, imageCount: 0, assetAxes: 'sleep|work', qualityFlags: [],
    ...o,
  })
  // 🔴 파일 이름이 곧 순서다 — 러너는 이름 순으로 읽는다
  writeFileSync(join(w.dd, 'a-old.detail.jsonl'),
    `${row({ sourcePostedAt: OLD, sourceListedAt: OLD, sourceCapturedAt: OLD })}\n`, 'utf-8')
  writeFileSync(join(w.dd, 'b-new.detail.jsonl'),
    `${row({ sourcePostedAt: NEW_T, sourceListedAt: NEW_T, sourceCapturedAt: NEW_T })}\n`, 'utf-8')
  // 🔴 운영 raw 파일에는 세 시각이 **아예 없다** — 그 모양 그대로
  writeFileSync(join(w.dd, 'c-raw.raw-detail.jsonl'), `${row({})}\n`, 'utf-8')

  const plan = selectWorkset({
    rows: rowsOf(w.dd), humanDecided: new Set(), queuePending: new Set(),
    concluded: new Set(), attempted: new Map(),
    limit: 5, runId: tag, takenAt: new Date(),
  })
  const wsPath = join(w.dd, worksetFileName(tag))
  writeFileSync(wsPath, `${JSON.stringify(plan.workset, null, 2)}\n`, 'utf-8')
  runStage({
    script: 'scripts/micro-seed-auto-judge.mts', world: w, cap: '5', judgeDecision: 'AUTO_SEED',
    args: ['--call', '--apply', `--run-id=${tag}`,
      `--ledger-run-id=${ledgerRunIdOf(tag, 'judge')}`, `--workset=${rel(wsPath)}`,
      `--shadow-out=${rel(join(w.dd, `auto-judge-${tag}.shadow.jsonl`))}`],
  })
  runStage({
    script: 'scripts/micro-seed-auto-draft.mts', world: w, cap: '15',
    args: ['--call', '--apply', `--run-id=${tag}`,
      `--ledger-run-id=${ledgerRunIdOf(tag, 'draft')}`, `--workset=${rel(wsPath)}`],
  })

  const candPath = join(w.dd, `auto-draft-${tag}.candidates.json`)
  const env = existsSync(candPath)
    ? JSON.parse(readFileSync(candPath, 'utf-8')) as Record<string, unknown> : {}
  const it = (Array.isArray(env.candidates) ? env.candidates as Record<string, unknown>[] : [])[0] ?? {}
  check('🔴 🔴 **① 실제 러너가 후보를 냈다**', Object.keys(it).length > 0, candPath)
  check('🔴 🔴 **② raw 의 빈 시각이 아는 시각을 지우지 않았다**',
    String(it.sourcePostedAt ?? '') !== '' && String(it.sourceListedAt ?? '') !== ''
    && String(it.sourceCapturedAt ?? '') !== '',
    JSON.stringify({ p: it.sourcePostedAt, l: it.sourceListedAt, c: it.sourceCapturedAt }))
  check('🔴 🔴 **③ 남은 값은 더 최신 detail 의 것이다 — 오래된 값이 아니다**',
    it.sourcePostedAt === NEW_T && it.sourceListedAt === NEW_T && it.sourceCapturedAt === NEW_T,
    `${String(it.sourcePostedAt)} (기대 ${NEW_T} · 옛값 ${OLD})`)

  /**
   * 🔴 ④ **정책을 코드에서도 잠근다.** 산출 파일만 보면 파일 순서가 우연히 맞아
   *    통과할 수 있다 — 빈 값이 덮지 않는다는 규칙 자체를 본다.
   */
  const draftSrc = readFileSync(join(ROOT, 'scripts/micro-seed-auto-draft.mts'), 'utf-8')
  check('🔴 🔴 **④ 빈 값으로 덮지 않는 규칙이 코드에 있다**',
    /const keep = \(next: string, prev: string \| undefined\): string =>/.test(draftSrc)
    && /next !== '' \? next : \(prev \?\? ''\)/.test(draftSrc))
  check('🔴 🔴 **④ 세 시각 모두 그 규칙을 지난다**',
    /sourcePostedAt: keep\(/.test(draftSrc) && /sourceListedAt: keep\(/.test(draftSrc)
    && /sourceCapturedAt: keep\(/.test(draftSrc))
  check('🔴 🔴 **④ 파일 순서는 이름으로 결정적이다 — 읽을 때마다 달라지지 않는다**',
    /readdirSync\(DATA_DIR\)\.filter\(\(f\) => f\.endsWith\(suffix\)\)\.sort\(\)/.test(draftSrc))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 가짜 provider · 임시 HOME · 임시 디렉터리다 — 운영 데이터 · DB · 실제 모델 0.')
if (fail > 0) process.exit(1)

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
function makeWorld(o: { copyDocs?: boolean } = {}): { root: string; dd: string; home: string } {
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
  return { root, dd, home }
}

/** adapt 가 낸 모양 그대로 — 🔴 `detail` 과 `raw-detail` **쌍**으로 낸다 */
function writeAdaptPair(
  dd: string,
  rows: { id: string; comments: number; posted: string; lane?: string; axis?: string }[],
  runId = 'adapt-1',
): void {
  const detail = rows.map((r) => JSON.stringify({
    runId, sourceArticleId: r.id, sourceSite: 'navercafe:wgang',
    axis: r.axis ?? SEED_AXIS, lane: r.lane ?? PROVEN_LANE, access: 'ok', safetyVerdict: 'pass', safetyReasons: '',
    title: `우리 나이 이야기 ${r.id}`,
    bodyHead: `${r.id} 원문 머리입니다. 사람들이 반응한 이야기이고 질문으로 끝납니다. 다들 어떠세요?`,
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
    bodyHead: `${r.id} 원문 머리입니다. 사람들이 반응한 이야기이고 질문으로 끝납니다. 다들 어떠세요?`,
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
}): Spawned => {
  const r = spawnSync(TSX, [join(ROOT, o.script), ...o.args], {
    cwd: o.world.root, encoding: 'utf-8',
    env: {
      ...process.env, HOME: o.world.home,
      ANTHROPIC_API_KEY: 'fixture-fake-key', GEMINI_API_KEY: 'fixture-fake-gemini-key',
      NODE_OPTIONS: `--import=${HOOK}`,
      ...(o.bodyLog === undefined ? {} : { FAKE_PROVIDER_BODY_LOG: o.bodyLog }),
      ...(o.judgeDecision === undefined ? {} : { FAKE_PROVIDER_JUDGE_DECISION: o.judgeDecision }),
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
    'process.stdout.write(JSON.stringify(currentContractBase()))',
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
    JSON.stringify(contracts[0] ?? {}))
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
  check('🔴 🔴 **판정 러너가 실제로 AUTO_RAW 를 냈다**',
    r.code === 0 && shadow.length === 2 && shadow.every((x) => x.decision === 'AUTO_RAW'),
    `code=${r.code} · ${shadow.map((x) => x.decision).join(',')}\n${r.out.slice(-400)}`)

  const states = [...latestOutcomes(out4()).values()].map((o) => o.state)
  check('🔴 🔴 **AUTO_RAW 는 unknown 이 아니라 rawLane 이다**',
    states.length === 2 && states.every((x) => x === 'rawLane'), states.join(','))
  const next = selectWorkset({
    rows: rows4, humanDecided: new Set(), queuePending: new Set(),
    concluded: concludedSourceIds(out4()), attempted: attemptedOutcomes(out4()),
    limit: 5, runId: `${tag}-2`, takenAt: new Date(),
  })
  check('🔴 🔴 **다음 회차에 다시 올라오지 않는다**',
    next.picked.length === 0 && next.dropped.terminal === 2,
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

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 가짜 provider · 임시 HOME · 임시 디렉터리다 — 운영 데이터 · DB · 실제 모델 0.')
if (fail > 0) process.exit(1)

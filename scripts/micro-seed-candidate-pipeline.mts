#!/usr/bin/env tsx
/**
 * 후보 생성 파이프라인 — 🔴 **어디가 막혔는지 한 번에 보고, 기계 층만 자동으로 넘긴다** (§4-AO)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AO
 *
 * 🔴 **하는 일**: 네 층의 재고를 세고, **기계가 넘길 수 있는 층만** 실행한다.
 *    산출물은 후보 파일까지다. DB 를 건드리지 않고 발행하지 않는다.
 *
 * 🔴 **하지 않는 일**: 사람 판정을 대신하지 않는다.
 *    `seed-originality-review` 의 ADOPT 는 사람이 찍는다 —
 *    "사람이 고른 글" 이라는 전제 위에 자동 발행이 서 있기 때문이다(§4-AL).
 *    기계가 그 층을 넘기면 전제가 무너지고, 자동 발행의 근거도 같이 무너진다.
 *
 * 🔴 **새 수집을 하지 않는다.** 네이버에 붙지 않고 LLM 을 부르지 않는다.
 *    이미 들어와 있는 것만 다음 층으로 민다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-candidate-pipeline.mts              ← 진단만 (아무것도 안 만듦)
 *   npx tsx scripts/micro-seed-candidate-pipeline.mts --apply      ← 기계 층 실행 (파일 생성)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  findBottleneck, planSteps, diagnose, checkCandidateShape, readListStock,
  LAYERS, LAYER_LABEL, type PipelineInput, type Layer, type Candidate,
} from '../src/lib/micro-seed-candidate-pipeline'
// 🔴 "이미 초안화됐나" 를 여기서 다시 판정하지 않는다 — 생성기가 쓰는 그 함수를 그대로 쓴다.
//    판정이 두 곳에 있으면 화면이 "6건 가능" 이라 하고 생성기는 "0건" 이라 한다(2026-09-07 실제).
import {
  draftedArticleIds, excludeDrafted, mergeSeedInputs, readApprovals, seedRowsOf,
  latestSourceApprovalFile, latestApprovalFile, SEED_DATA_DIR,
} from './micro-seed-seed-originality-dry-run.mjs'

const DATA_DIR = '.microseed-data'
const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : String(v ?? '').trim())

function listJson(re: RegExp): string[] {
  if (!existsSync(DATA_DIR)) return []
  return readdirSync(DATA_DIR).filter((f) => re.test(f)).sort().map((f) => join(DATA_DIR, f))
}
/**
 * 🔴 **어느 배열인지 이름으로 집는다.** "첫 번째 배열" 을 집으면 엉뚱한 것을 센다 —
 *    초안 파일에는 `sources`·`topics`·`expansions` 셋이 있고, 우리가 원하는 것은 마지막이다.
 *    2026-09-07 에 이걸로 초안 재고를 0 으로 잘못 읽었다.
 */
function rowsOf(path: string, keys: readonly string[]): Record<string, unknown>[] {
  try {
    const j = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>
    for (const k of keys) if (Array.isArray(j[k])) return j[k] as Record<string, unknown>[]
    return []
  } catch { return [] }
}
/** 여러 파일에 같은 글이 있으면 최신 판단만 센다 — 파일명에 시각이 들어가므로 뒤가 최신이다 */
function uniqueBy(
  paths: readonly string[], keys: readonly string[],
  pick: (r: Record<string, unknown>) => string | null,
): Set<string> {
  const out = new Map<string, string>()
  for (const p of paths) for (const r of rowsOf(p, keys)) {
    const k = pick(r)
    if (k !== null && k !== '') out.set(k, p)
  }
  return new Set(out.keys())
}

/** `.jsonl` 한 줄씩 — 깨진 줄은 건너뛴다 */
function jsonl(path: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  let raw: string
  try { raw = readFileSync(path, 'utf-8') } catch { return out }
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (t === '') continue
    try { out.push(JSON.parse(t) as Record<string, unknown>) } catch { /* 건너뛴다 */ }
  }
  return out
}
function listFiles(suffix: string): string[] {
  if (!existsSync(DATA_DIR)) return []
  return readdirSync(DATA_DIR).filter((f) => f.endsWith(suffix)).sort().map((f) => join(DATA_DIR, f))
}

function collect(): { input: PipelineInput; detail: Record<Layer, string> } {
  // ⓪ 목록 → 본문 — 🔴 목록에 있는데 본문을 안 읽은 것
  const listed = new Map<string, Record<string, unknown>>()
  for (const f of listFiles('.list.jsonl')) for (const r of jsonl(f)) {
    const id = S(r.sourceArticleId)
    // 🔴 이미 걸러진 것은 세지 않는다 — 고정글·정치·실명은 애초에 대상이 아니다
    if (id === '' || S(r.sourceExcludeReason) !== '' || r.sourcePoliticsExcluded === true) continue
    listed.set(id, r)
  }
  const bodyFiles = [...listFiles('.detail.jsonl'), ...listFiles('.raw-detail.jsonl')]
  const hasBody = new Set<string>()
  for (const f of bodyFiles) for (const r of jsonl(f)) {
    const id = S(r.sourceArticleId)
    if (id !== '') hasBody.add(id)
  }
  const noBody = [...listed.entries()].filter(([id]) => !hasBody.has(id)).map(([, r]) => r)
  const listStock = readListStock(noBody.map((r) => ({ sourceSite: S(r.sourceSite) })))

  // 참고 수치 — 🔴 층으로 세지 않는다. 판정 조건은 검수 화면 셋이 각자 갖고 있다
  const judgedIds = new Set<string>()
  for (const re of [/^srn-approvals.*\.json$/, /^seed-originality-source-approvals-.*\.json$/,
    /^raw-originality-approvals-.*\.json$/]) {
    for (const f of listJson(re)) for (const r of rowsOf(f, ['decisions'])) {
      const id = S(r.sourceArticleId)
      if (id !== '') judgedIds.add(id)
    }
  }

  // ① SEED 승인 — 🔴 **생성기와 똑같이 고른다.**
  //    최신 SRN 승인 1개 + 최신 소스 승인 1개다. 모든 파일을 긁으면 생성기와 숫자가 어긋나고,
  //    화면은 "3건 가능" 이라 하는데 생성기는 "0건" 이라 한다 (2026-09-07 실제로 겪었다).
  const srnPath = latestApprovalFile(SEED_DATA_DIR)
  const srcPath = latestSourceApprovalFile(SEED_DATA_DIR)
  const read = (path: string | null): { rows: ReturnType<typeof seedRowsOf>; from: string } => {
    if (path === null) return { rows: [], from: '' }
    try { return { rows: seedRowsOf(readApprovals(path)), from: path.split('/').pop() ?? path } }
    catch { return { rows: [], from: '' } }
  }
  // 🔴 순서 고정: SRN → 소스 (생성기와 같다)
  const { picked } = mergeSeedInputs([read(srnPath), read(srcPath)])
  const drafted = draftedArticleIds(SEED_DATA_DIR)
  const { kept } = excludeDrafted(picked, drafted)

  // ② 초안 → 판정
  const draftFiles = listJson(/^seed-originality-dry-run-.*\.json$/)
  const reviewFiles = listJson(/^seed-review-.*\.json$/)
  const draftKeys = uniqueBy(draftFiles, ['expansions'], (r) => {
    const drafts = Array.isArray(r.drafts) ? r.drafts : []
    return drafts.length === 0 ? null : S(r.sourceArticleId)
  })
  const reviewedIds = uniqueBy(reviewFiles, ['decisions'], (r) => S(r.sourceArticleId))

  // ③ ADOPT → 후보 파일
  const adopted = uniqueBy(reviewFiles, ['decisions'],
    (r) => (S(r.decision) === 'ADOPT' ? `${S(r.sourceArticleId)} ${S(r.title)}` : null))
  const candFiles = listJson(/^publish-candidates-.*\.json$/)
  const candKeys = uniqueBy(candFiles, ['candidates'], (r) => `${S(r.sourceArticleId)} ${S(r.title)}`)

  // ④ 후보 파일 → 큐: 적재 여부는 DB 를 봐야 안다. 여기서는 보류만 뺀다
  const heldPath = join(DATA_DIR, 'held-candidates.json')
  const held = existsSync(heldPath)
    ? new Set(rowsOf(heldPath, ['held']).map((h) => `${S(h.sourceArticleId)} ${S(h.title)}`))
    : new Set<string>()
  const candUsable = [...candKeys].filter((k) => !held.has(k))

  const inter = (a: Set<string>, b: Set<string>): number => [...a].filter((x) => b.has(x)).length

  return {
    input: {
      body: { total: listStock.pending, passed: 0 },
      seedApproval: { total: picked.length, passed: picked.length - kept.length },
      draft: { total: draftKeys.size, passed: inter(draftKeys, reviewedIds) },
      adopt: { total: adopted.size, passed: inter(adopted, candKeys) },
      candidate: { total: candUsable.length, passed: candUsable.length },
    },
    detail: {
      body: `목록 ${listed.size}건 · 본문 있음 ${listed.size - listStock.pending}건`
        + ` · 🎯 본문 없음 ${listStock.pending}건`
        + ` (fetch 만 ${listStock.fetchOnly} · 브라우저·세션 ${listStock.needsBrowser})`
        + `\n       참고: 본문 ${hasBody.size}건 중 판정됨 ${[...hasBody].filter((x) => judgedIds.has(x)).length}건`
        + ' — 판정 후보 수는 검수 화면이 정본이다',
      seedApproval: `SEED 승인 ${picked.length}건 · 초안 있음 ${picked.length - kept.length}건`
        + ` (생성기와 같은 파일: ${[srnPath, srcPath].filter((x) => x !== null).map((x) => x!.split('/').pop()).join(' · ') || '없음'})`,
      draft: `초안 ${draftKeys.size}건 · 판정됨 ${inter(draftKeys, reviewedIds)}건`,
      adopt: `ADOPT ${adopted.size}건 · 후보화됨 ${inter(adopted, candKeys)}건`,
      candidate: `후보 ${candKeys.size}건 · 보류 제외 ${candUsable.length}건 (큐 적재는 supply-autofill 이 본다)`,
    },
  }
}

function latest(re: RegExp): string | null {
  const hits = listJson(re)
  return hits.length === 0 ? null : hits[hits.length - 1]!
}

function run(cmd: string): boolean {
  // 🔴 npm run 이름만 받는다. 임의 셸 문자열을 실행하지 않는다
  const m = /^npm run ([a-z0-9:-]+)$/.exec(cmd)
  if (m === null) return false
  try {
    execFileSync('npm', ['run', '-s', m[1]!], { stdio: 'inherit' })
    return true
  } catch { return false }
}

function main(): void {
  console.log(APPLY ? '\n══ 🔴 실행 (--apply) — 파일만 만든다 ══\n' : '\n══ 진단 (아무것도 만들지 않는다) ══\n')
  console.log('  🔴 DB write 0 · 발행 0 · 네이버 0 · LLM 0 — 이 도구는 후보 파일까지다\n')

  const { input, detail } = collect()
  const { states, starved } = findBottleneck(input)

  console.log('① 층별 재고')
  for (const s of states) {
    const mark = s.pending === 0 ? '  ' : s.actor === 'human' ? '🔴' : s.actor === 'network' ? '🟡' : '🟢'
    const who = s.actor === 'human' ? '사람' : s.actor === 'network' ? '밖으로 요청 · 승인 사항' : '기계'
    console.log(`  ${mark} ${LAYER_LABEL[s.layer]}`)
    console.log(`       ${detail[s.layer]}`)
    if (s.pending > 0) console.log(`       → 일감 ${s.pending}건 (${who})`)
  }

  const d = diagnose(input)
  console.log(`\n② 진단  ${d.message}`)

  // 후보 파일 모양 검사 — 생성기와 소비기의 계약이 어긋나면 조용히 0건이 된다
  const candPath = latest(/^publish-candidates-.*\.json$/)
  if (candPath !== null) {
    const rows = rowsOf(candPath, ['candidates']) as Candidate[]
    const shape = checkCandidateShape(rows)
    console.log(`\n③ 후보 파일 모양  ${shape.ok ? '✅' : '🔴'}  ${candPath} · ${rows.length}건`)
    for (const p of shape.problems) console.log(`     🔴 ${p}`)
    if (shape.ok) console.log('     supply-autofill 이 읽을 수 있는 모양이다')
  }

  const steps = planSteps(input)
  console.log('\n④ 다음 할 일')
  for (const s of steps) {
    if (s.reason === '일감이 없다') continue
    console.log(`  ${s.runnable ? '🟢' : '🔴'} ${LAYER_LABEL[s.layer]} — ${s.reason}`)
    console.log(`     ${s.command}`)
  }
  const runnable = steps.filter((s) => s.runnable)
  if (runnable.length === 0 && !starved) console.log('  (기계가 할 수 있는 것이 없다)')

  if (!APPLY) {
    console.log('\n⑤ 진단만 했다 — 실행하려면 --apply 를 붙이세요.')
    console.log('   🔴 --apply 도 파일만 만든다. DB 도 발행도 없다.\n')
    return
  }

  if (starved) {
    console.log('\n⑤ 실행하지 않는다 — 전 구간에 일감이 0건이다.')
    console.log('   🔴 새 원천이 들어와야 한다. 여기서 더 짜낼 것이 없다.\n')
    return
  }
  if (runnable.length === 0) {
    console.log('\n⑤ 실행하지 않는다 — 기계가 넘길 수 있는 층이 없다.')
    console.log('   🔴 사람 판정이 먼저다. 위 명령을 보세요.\n')
    return
  }

  console.log(`\n⑤ 🔴 실행 ${runnable.length}단계`)
  for (const s of runnable) {
    console.log(`\n   ── ${LAYER_LABEL[s.layer]}`)
    if (!run(s.command)) {
      console.log(`   🔴 실패했다 — 손으로 확인하세요: ${s.command}`)
      process.exitCode = 1
      return
    }
  }
  console.log('\n   ✅ 기계 층을 넘겼다. DB 는 건드리지 않았다.')
  console.log('   다음: supply-autofill 로 큐에 올린다 (--apply --limit=N)\n')
}

/** 🔴 CLI 로 직접 실행할 때만 돈다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) main()

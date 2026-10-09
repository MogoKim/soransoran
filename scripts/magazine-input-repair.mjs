#!/usr/bin/env node
/**
 * 입력 수리 단계 — producer 회차 안에서 REPAIR_REQUIRED 를 고친다 (2026-10-10).
 *
 *   node scripts/magazine-input-repair.mjs --run YYYY-MM-DD            대상만 본다 (호출 0 · 쓰기 0)
 *   node scripts/magazine-input-repair.mjs --run YYYY-MM-DD --write    🔴 실제 수리 (Claude · ChatGPT 호출)
 *
 * 🔴 실제 바깥 호출은 **여기서만** 붙인다. 판정·교체는 `lib/magazine-input-repair.mjs` 가 한다.
 *    - brief 후보: brief-auto 와 같은 생성기(`generateBriefCandidate`) · 같은 todo(`briefTodo`)
 *    - brief echo 수리: webui-runner `--fetch <slug> --input-repair brief-echo --draft-out <임시>`
 *      (일반 회수·재생성과 같은 전송 경계 · 같은 장부 예약 · 다른 메시지·지문)
 *    - 변환 검사: md-to-draft `--in <임시>` (파일을 쓰지 않는다)
 * 🔴 큐·장부·articles.ts 를 직접 고치지 않는다. hero·등록·PR·병합 0.
 */
import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DRAFTS_DIR, loadArticles, loadQueue } from './lib/magazine-load.mjs'
import { QUARANTINE_PATH, readQuarantine } from './lib/magazine-quarantine.mjs'
import { inputRepairGate } from './lib/magazine-delivery-gate.mjs'
import { fetchResultFor, readFetchResults, removeFetchResults } from './lib/magazine-fetch-result.mjs'
import { MAX_REPAIRS_PER_RUN, runInputRepair, scanRepairTargets, writeInputRepairResult } from './lib/magazine-input-repair.mjs'
import { buildPrompt, generateBriefCandidate, parseReview } from './magazine-brief-auto.mjs'
import { briefTodo } from './magazine-producer-plan.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const NODE = process.execPath
const WEBUI = join(ROOT, 'scripts/magazine-webui-runner.mjs')
const MD2DRAFT = join(ROOT, 'scripts/magazine-md-to-draft.mjs')
/** 🔴 저장소 밖 — 임시 후보가 runtime 을 더럽히면 회차가 DIRTY_TREE 로 멈춘다 */
const TMP_DIR = join(homedir(), 'Library', 'Application Support', 'soransoran', 'input-repair')

const stamp = () => `${new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19)} KST`
const line = (m) => console.log(`[${stamp()}] ${m}`)
const kstDate = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

export function makeRealRepairDeps({ draftsDir = DRAFTS_DIR, quarantinePath = QUARANTINE_PATH } = {}) {
  let articles = null
  return {
    log: line,
    parseReview,
    generateBrief: async ({ slug, item }) => {
      articles ??= loadArticles()
      const prompt = buildPrompt({ slug, todoText: briefTodo(item), queueItem: item, articles })
      const gen = generateBriefCandidate({ prompt, queueItem: item })
      if (!gen.split || !gen.verdict?.ok) return { ok: false, calls: gen.attempts, why: gen.lastReason || '게이트 통과 실패' }
      return { ok: true, calls: gen.attempts, briefText: gen.split.briefText, reviewText: gen.split.reviewText }
    },
    repairGate: ({ slug }) => ({ gate: inputRepairGate({ slug, draftsDir, quarantinePath }) }),
    runRepairFetch: async ({ slug, draftOut }) => {
      const rj = join(TMP_DIR, `input-repair-result-${slug}-${process.pid}-${Date.now()}.json`)
      spawnSync(NODE, [WEBUI, '--fetch', slug, '--input-repair', 'brief-echo', '--draft-out', draftOut, '--result-json', rj],
        { cwd: ROOT, stdio: 'inherit' })
      // 🔴 사람용 출력이 아니라 자식이 적은 구조화 결과만 읽는다. 없으면 null — 전송불명으로 다룬다
      const res = readFetchResults(rj)
      const row = res.ok ? fetchResultFor(res.body, slug) : null
      removeFetchResults(rj)
      return row
    },
    convertCheck: (candidate) => {
      const r = spawnSync(NODE, [MD2DRAFT, '--in', candidate], { cwd: ROOT, encoding: 'utf8' })
      return r.status === 0 ? { ok: true } : { ok: false, why: (r.stderr || r.stdout || '').split('\n').filter((x) => /✗/.test(x)).join(' / ').slice(0, 300) || `종료 코드 ${r.status}` }
    },
  }
}

async function main() {
  const argv = process.argv.slice(2)
  const arg = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] ?? null : null)
  const date = arg('--run') ?? kstDate()
  const write = argv.includes('--write')
  line(`입력 수리 ${write ? '(🔴 실제 수리)' : '(대상만 본다 · 호출 0)'} — 회차 ${date} · 최대 ${MAX_REPAIRS_PER_RUN}건`)
  const queue = loadQueue()
  const ledger = readQuarantine(QUARANTINE_PATH)
  if (!write) {
    if (!ledger.ok) { line(`🔴 장부를 읽지 못했다 — ${ledger.why}`); process.exit(1) }
    const { targets, skipped } = scanRepairTargets({ queue, draftsDir: DRAFTS_DIR, store: ledger.store })
    for (const t of targets) line(`  · ${t.slug} — ${t.type}`)
    for (const s of skipped) line(`  ⏸ ${s.slug} — ${s.type} · ${s.reason}`)
    line(`대상 ${targets.length}건 (이번 회차 최대 ${MAX_REPAIRS_PER_RUN}) · 건너뜀 ${skipped.length}건`)
    process.exit(0)
  }
  const report = await runInputRepair({ draftsDir: DRAFTS_DIR, queue, ledger, deps: makeRealRepairDeps(), tmpDir: TMP_DIR })
  for (const r of report.results ?? []) line(`  ${r.outcome === 'APPLIED' ? '✅' : r.outcome === 'HELD' ? '⏸' : '⛔'} ${r.slug} — ${r.type} · ${r.outcome} · ${r.reason ?? ''}`)
  for (const s of report.skipped ?? []) line(`  ⏸ ${s.slug} — ${s.type} · ${s.reason}`)
  try { line(`결과: ${writeInputRepairResult({ dir: join(DRAFTS_DIR, '_runs', date), report: { date, ...report } })}`) } catch (e) {
    line(`결과 파일을 남기지 못했다 (${e?.message ?? e}) — 판정은 그대로다`)
  }
  // 🔴 수리 실패는 회차 실패가 아니다 — 원고 회수는 계속 간다. 장부를 못 읽은 것만 1
  process.exit(report.ok ? 0 : 1)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-input-repair.mjs')) main()

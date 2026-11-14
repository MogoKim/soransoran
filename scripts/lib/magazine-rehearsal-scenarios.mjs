/**
 * 🔴 **rehearsal 시나리오 — 자료 준비 · 단계 계획 · 증거 수집** (2026-10-10).
 *
 *    판정을 흉내 내지 않는다. 시나리오가 하는 일은 셋뿐이다:
 *      ① 임시 루트의 runtime 사본을 그 시나리오 모양으로 다듬는다 (큐 행 줄이기는 실제 `removeQueueDay`)
 *      ② 실제 최상위 래퍼를 고정 KST 시각에 차례로 띄운다
 *      ③ 남은 사실(호출 기록 · 장부 · run 결과 · origin · 잔여물 · 경계 기록)을 모은다
 *    PASS/FAIL 은 모은 사실과 시나리오의 기대값을 비교해서만 나온다.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { REAL_GIT, readCalls, readGuard, sandboxGit, stageEnv } from './magazine-rehearsal-sandbox.mjs'
import { createHash } from 'node:crypto'
import { stripFormatContract } from './magazine-rehearsal-content.mjs'

export const SPEED = 120
export const KST = (date, hm) => `${date} ${hm}:00`
const kstMs = (s) => Date.parse(`${s.replace(' ', 'T')}+09:00`)
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10)

const imp = (repo, rel) => import(pathToFileURL(join(repo, rel)).href)

// ─────────────────────────────────────────────────────────
// ① 자료 다듬기 — 임시 루트 저장소 사본에서만
// ─────────────────────────────────────────────────────────

/** 큐 행을 실제 `removeQueueDay` 로 줄이고, 큐 행의 작업 중 원고·hero 를 비운다 (추적 중인 등록본은 그대로) */
export async function curate({ repo, keep }) {
  const L = await imp(repo, 'scripts/lib/magazine-load.mjs')
  const QL = await imp(repo, 'scripts/lib/magazine-queue-lock.mjs')
  const qPath = join(repo, 'drafts', 'magazine', 'topic-queue.ts')
  let src = readFileSync(qPath, 'utf8')
  const queue = L.parseQueueSource(src)
  for (const item of queue) {
    rmSync(join(repo, 'drafts', 'magazine', item.slug), { recursive: true, force: true })
    rmSync(join(repo, 'public', 'magazine', item.slug), { recursive: true, force: true })
    if (keep.includes(item.slug)) continue
    const next = QL.removeQueueDay(src, item.day)
    if (next === null) throw new Error(`큐 행을 지우지 못했다: day ${item.day} (${item.slug})`)
    src = next
  }
  writeFileSync(qPath, src)
  const left = L.parseQueueSource(src).map((i) => i.slug)
  if ([...left].sort().join(',') !== [...keep].sort().join(',')) throw new Error(`큐 정리 결과가 다르다: ${left.join(',')} ≠ ${keep.join(',')}`)
  return { removed: queue.length - keep.length, kept: left }
}

/**
 * 시나리오 대상 — 🔴 실제 producer 선정 함수(`selectItems`)로 고른다 (cluster 순환·시리즈·publishWindow 를 따로 흉내 내지 않는다).
 *   selectable  그 날짜에 producer 가 실제로 선정할 행 (앞에서부터)
 *   others      선정되지 않아도 되는 행 — 이미 brief·draft 를 둘 자리 (HOLD · 입력 수리 대상)
 * 의료 필수 클러스터는 뺀다 — 가짜 원고가 진료 권고 문장을 지어내 QA 를 맞추지 않게 (실제 QA 정본 집합).
 */
export async function pickTargets({ repo, date, selectable = 1, others = 0 }) {
  const { ok, ranked } = await rankTargets({ repo, date })
  const sel = ranked.slice(0, selectable)
  if (sel.length < selectable) throw new Error(`${date} 에 실제로 선정될 행이 ${selectable}개 미만이다 (${sel.length})`)
  const rest = ok.filter((i) => !sel.includes(i)).slice(0, others)
  if (rest.length < others) throw new Error(`추가 대상 행이 ${others}개 미만이다 (${rest.length})`)
  return [...sel, ...rest]
}

/**
 * 🔴 **그 날짜의 실제 producer 선정 순위** (2026-11-14 · S1 달력 경계 수리) — `pickTargets` 와 같은 한 경로.
 *    자격(isAutoLaneEligible · 의료 필수 제외) → 실제 `selectItems` 의 순서(SEASONAL 마감 순 → day)를 그대로 돌려준다.
 *    `code` 는 판정 코드를 읽을 저장소, `queueSrc`·`articlesSrc` 는 주면 그 원문을, 없으면 `repo` 의 파일을 읽는다
 *    (순수 검사가 파일 없이 같은 경로를 돌린다). 순위를 다시 흉내 내지 않는다.
 * @returns {Promise<{ ok: object[], ranked: object[] }>}
 */
export async function rankTargets({ repo, date, code = repo, queueSrc = null, articlesSrc = null }) {
  const L = await imp(code, 'scripts/lib/magazine-load.mjs')
  const V = await imp(code, 'scripts/lib/magazine-validation-profile.mjs')
  const P = await imp(code, 'scripts/magazine-producer-plan.mjs')
  const { MEDICAL_REQUIRED } = await imp(code, 'scripts/lib/magazine-qa-constants.mjs')
  const queue = L.parseQueueSource(queueSrc ?? readFileSync(join(repo, 'drafts', 'magazine', 'topic-queue.ts'), 'utf8'))
  const articles = L.parseArticlesSource(articlesSrc ?? readFileSync(join(repo, 'src', 'content', 'magazine', 'articles.ts'), 'utf8'))
  const ok = queue.filter((i) => V.isAutoLaneEligible(i).ok && !MEDICAL_REQUIRED.has(i.cluster)).sort((a, b) => a.day - b.day)
  const { selected } = P.selectItems({ queue: ok, articles, today: date, produceCount: ok.length, draftExists: () => false })
  return { ok, ranked: selected.map((x) => ok.find((i) => i.slug === x.slug)).filter(Boolean) }
}

/**
 * 🔴 **정상 후보가 그 날짜에 1순위가 되도록 — sandbox 사본 큐에서만 앞선 행을 뺀다** (2026-11-14 · S1 달력 경계 수리).
 *    운영 선정 함수와 운영 큐는 그대로다. 실제 순위에서 대상보다 **앞선 행만** 빼고(계절 행이 SEASONAL 우선 규칙으로
 *    앞서는 날 · 낮은 day 가 새로 생긴 날), 뺀 뒤 순위를 같은 경로로 다시 계산해 대상이 1순위인지 확인한다.
 *    대상이 실제 선정 경로에 아예 없으면(자격·창 밖) 숨기지 않고 거부한다.
 * @returns {Promise<{ date:string, target:string, selectedBefore:string|null, removed:{slug:string,day:number,contentType:string,publishWindow:object|null,rank:number,reason:string}[], selectedAfter:string|null, queueSrc:string }>}
 */
export async function curateTargetFirst({ code, date, target, queueSrc, articlesSrc }) {
  const QL = await imp(code, 'scripts/lib/magazine-queue-lock.mjs')
  const before = await rankTargets({ code, date, queueSrc, articlesSrc })
  const at = before.ranked.findIndex((i) => i.slug === target)
  if (at < 0) throw new Error(`${date} 에 대상 ${target} 이 실제 선정 경로에 없다 (자격·창 밖) — 앞선 행을 빼서 맞추지 않는다`)
  const ahead = before.ranked.slice(0, at)
  let next = queueSrc
  for (const q of ahead) next = QL.removeQueueDay(next, q.day) ?? (() => { throw new Error(`sandbox 큐에서 ${q.slug} 행을 빼지 못했다`) })()
  const after = await rankTargets({ code, date, queueSrc: next, articlesSrc })
  if (after.ranked[0]?.slug !== target) throw new Error(`${date} 앞선 행을 뺀 뒤에도 대상 ${target} 이 1순위가 아니다 (${after.ranked[0]?.slug ?? '없음'})`)
  return {
    date, target, selectedBefore: before.ranked[0]?.slug ?? null,
    removed: ahead.map((q, i) => ({ slug: q.slug, day: q.day, contentType: q.contentType ?? null, publishWindow: q.publishWindow ?? null, rank: i + 1,
      reason: `${date} 실제 선정 순위 ${i + 1} — 대상(순위 ${at + 1})보다 앞선다${q.contentType === 'SEASONAL' ? ' (SEASONAL 우선)' : ''}` })),
    selectedAfter: after.ranked[0]?.slug ?? null, queueSrc: next,
  }
}

/** S1 정리 증거 판정 — 그 회차 날짜 · 후 1순위 = 대상 · 뺀 행은 전 순위 앞쪽부터 빈틈없이 · 이유에 날짜 (orchestrator·checker 공용) */
export function s1CurationOk(prepared, target, date) {
  const c = prepared?.curation
  if (!c || c.date !== date || c.target !== target || c.selectedAfter !== target || !Array.isArray(c.removed)) return false
  if (c.selectedBefore === target ? c.removed.length !== 0 : c.removed[0]?.slug !== c.selectedBefore) return false
  return c.removed.every((r, i) => r.rank === i + 1 && r.slug !== target && typeof r.reason === 'string' && r.reason.includes(date))
}

/** S1 회차 격리 증거 판정 — 실제 isolateDirectRunDay 의 기록 모양 · 그 날짜 · 옮겼으면 목적지·파일, 아니면 없음 */
export function s1IsolationOk(prepared, date) {
  const r = prepared?.isolatedRun
  if (!r || r.date !== date || typeof r.moved !== 'boolean' || !Array.isArray(r.otherDates) || !Array.isArray(r.files) || r.otherDates.includes(date)) return false
  return r.moved ? typeof r.dest === 'string' && r.files.length > 0 : r.dest === null && r.files.length === 0
}

/** hero 재사용 자리 — 저장소에 있는 합격 hero 를 이 글의 자리로 (이미지 생성 경로는 rehearsal 범위 밖) */
export function placeHero({ repo, slug, from = 'avoiding-gatherings' }) {
  const src = join(repo, 'public', 'magazine', from, 'hero.webp')
  mkdirSync(join(repo, 'public', 'magazine', slug), { recursive: true })
  cpSync(src, join(repo, 'public', 'magazine', slug, 'hero.webp'))
}

export function writeSlugFiles({ repo, slug, files }) {
  const dir = join(repo, 'drafts', 'magazine', slug)
  mkdirSync(dir, { recursive: true })
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text)
}

/** 템플릿 brief·review (가짜 Claude 와 같은 뼈대) */
export async function templatePair({ repo, item, broken = false }) {
  const C = await imp(repo, 'scripts/lib/magazine-rehearsal-content.mjs')
  const out = C.claudeBriefOutput({ repo, item })
  const brief = out.slice(out.indexOf('===BRIEF===') + 11, out.indexOf('===REVIEW===')).trim() + '\n'
  const review = out.slice(out.indexOf('===REVIEW===') + 12).trim() + '\n'
  return { brief: broken ? stripFormatContract(brief) : brief, review }
}

// ─────────────────────────────────────────────────────────
// ② 실제 래퍼를 고정 시각에
// ─────────────────────────────────────────────────────────

export const ENTRY = Object.freeze({
  producer: { script: 'magazine-producer-run.mjs', args: [] },
  register: { script: 'magazine-auto-register-run.mjs', args: ['--write', '--pr', '--merge'] },
  recover: { script: 'magazine-auto-merge.mjs', args: ['--recover', '--notify-send'] },
  watch: { script: 'magazine-auto-merge.mjs', args: ['--watch', '--notify-send'] },
})

/** 단계 하나 — 🔴 실제 엔트리포인트를 자식 프로세스로 띄운다. 결과는 종료 코드와 출력 그대로 */
export function runStage(sb, { name, entry, kst }) {
  const e = ENTRY[entry]
  const env = stageEnv({ root: sb.root, clock: { fakeMs: kstMs(kst), realMs: Date.now(), speed: SPEED } })
  const t0 = Date.now()
  const r = spawnSync(process.execPath, [join(sb.repo, 'scripts', e.script), ...e.args], {
    cwd: sb.repo, env, encoding: 'utf8', timeout: 20 * 60 * 1000, maxBuffer: 64 * 1024 * 1024,
  })
  const log = join(sb.root, 'logs', `${String(sb.stageNo = (sb.stageNo ?? 0) + 1).padStart(2, '0')}-${name}.log`)
  writeFileSync(log, `${r.stdout ?? ''}\n--- stderr ---\n${r.stderr ?? ''}`)
  return { name, entry, script: e.script, args: e.args, kst, exit: r.status, signal: r.signal ?? null, realMs: Date.now() - t0, log: relative(sb.root, log),
    tail: `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').filter((l) => l.trim()).slice(-6) }
}

// ─────────────────────────────────────────────────────────
// ③ 증거
// ─────────────────────────────────────────────────────────

const readJson = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')) } catch { return null } }

/** 운영 잔여물 — 잠금 · lease · journal · reclaim · 재생성 packet · 임시 쓰기 */
export function leftovers(root) {
  const hits = []
  const RE = /(\.lock$|\.reclaim|lease|journal|\.regen-apply-|\.input-repair-(staged|backup)-|\.tmp-\d|\.g8tmp-)/
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n)
      const st = lstatSync(f)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) { if (!['node_modules', '.git', 'guard', 'logs', 'fixture', 'origin.git'].includes(n)) walk(f); continue }
      if (RE.test(n)) hits.push(relative(root, f))
    }
  }
  for (const d of [join(root, 'repo', 'drafts'), join(root, 'home')]) if (existsSync(d)) walk(d)
  const packets = join(root, 'home', 'Library', 'Application Support', 'soransoran', 'regen-packets')
  if (existsSync(packets)) for (const n of readdirSync(packets)) hits.push(relative(root, join(packets, n)))
  const leases = join(root, 'home', 'Library', 'Application Support', 'soransoran', 'magazine-manuscript-leases')
  if (existsSync(leases)) for (const n of readdirSync(leases)) hits.push(relative(root, join(leases, n)))
  return [...new Set(hits)].sort()
}

/** 시나리오가 끝난 뒤 남은 사실 */
export async function collect(sb, { date }) {
  const calls = readCalls(sb.root)
  const guard = readGuard(sb.root)
  const gh = readJson(join(sb.root, 'fixture', 'github.json'))
  const runs = join(sb.repo, 'drafts', 'magazine', '_runs')
  const L = await imp(sb.repo, 'scripts/lib/magazine-load.mjs')
  const originArticles = (sha) => L.parseArticlesSource(sandboxGit(['--git-dir', sb.origin, 'show', `${sha}:src/content/magazine/articles.ts`], sb.root))
  const mainSha = sandboxGit(['--git-dir', sb.origin, 'rev-parse', 'refs/heads/main'], sb.root)
  const before = new Set(originArticles(sb.baseline).map((a) => a.slug))
  const blob = (rev) => { const r = spawnSync(REAL_GIT, ['--git-dir', sb.origin, 'cat-file', 'blob', rev]); return r.status === 0 ? r.stdout : null }
  const added = originArticles(mainSha).filter((a) => !before.has(a.slug)).map((a) => {
    const hero = a.heroImage?.src ? blob(`${mainSha}:public${a.heroImage.src}`) : null
    return { slug: a.slug, publishAt: a.publishAt ?? null, medical: a.medical ?? null, heroSrc: a.heroImage?.src ?? null, heroImage: a.heroImage ?? null,
      heroFile: hero ? { sha256: createHash('sha256').update(hero).digest('hex'), bytes: hero.length, riff: hero.subarray(0, 4).toString('latin1'), webp: hero.subarray(8, 12).toString('latin1') } : null }
  })
  const ledger = readJson(join(sb.root, 'home', 'Library', 'Application Support', 'soransoran', 'magazine-quarantine.json'))
  const runFiles = {}
  for (const d of [date, ...(sb.extraDates ?? [])]) {
    const dir = join(runs, d)
    if (existsSync(dir)) runFiles[d] = readdirSync(dir).sort()
  }
  const count = (pred) => calls.filter(pred).length
  return {
    sends: {
      initial: count((c) => c.tool === 'chatgpt' && c.kind === 'initial'),
      regen: count((c) => c.tool === 'chatgpt' && c.kind === 'regen'),
      repair: count((c) => c.tool === 'chatgpt' && c.kind === 'repair'),
      bySlug: calls.filter((c) => c.tool === 'chatgpt' && c.slug && c.kind).reduce((m, c) => ({ ...m, [`${c.slug}:${c.kind}`]: (m[`${c.slug}:${c.kind}`] ?? 0) + 1 }), {}),
    },
    claude: calls.filter((c) => c.tool === 'claude' && c.slug).map((c) => ({ slug: c.slug, mode: c.mode })),
    // generate·convert·reuse = hero runner 가 실제로 지난 단계 (trace) · image = 가짜 ChatGPT 이미지 호출
    hero: { generate: count((c) => c.op === 'hero-trace-generate'), convert: count((c) => c.op === 'hero-trace-convert'), reuse: count((c) => c.op === 'hero-trace-reuse'), image: count((c) => c.op === 'hero-image') },
    regenTyped: calls.filter((c) => c.tool === 'chatgpt' && c.kind === 'regen').map((c) => ({ slug: c.slug, typed: c.typed ?? '' })),
    prs: (gh?.prs ?? []).map((p) => ({ number: p.number, head: p.headRefName, state: p.state, merge: p.mergeCommit?.oid ?? null })),
    mergeCalls: calls.filter((c) => c.tool === 'gh' && c.args?.[0] === 'pr' && c.args?.[1] === 'merge').map((c) => ({ args: c.args, merged: c.merged ?? null, error: c.error ?? null })),
    deployments: (gh?.deployments ?? []).map((d) => ({ sha: d.sha, state: d.state })),
    registered: added,
    ledger,
    runFiles,
    slack: guard.filter((e) => e.kind === 'SLACK_FIXTURE').map((e) => ({ role: e.role, text: String(e.body?.text ?? JSON.stringify(e.body)).slice(0, 400) })),
    boundary: {
      violations: guard.filter((e) => e.kind === 'VIOLATION').map((e) => ({ violation: e.violation, target: e.path ?? e.url ?? e.command ?? e.host ?? null, script: e.script?.split('/').pop() ?? null })),
      networkAttempts: guard.filter((e) => e.kind === 'NETWORK_ATTEMPT').length,
      spawnsRefused: guard.filter((e) => e.kind === 'SPAWN' && !e.allowed).length,
      fixtureRefusals: calls.filter((c) => c.refused).map((c) => ({ tool: c.tool, refused: c.refused, args: c.args })),
      guardedProcesses: guard.filter((e) => e.kind === 'GUARD_READY').length,
    },
    leftovers: leftovers(sb.root),
  }
}

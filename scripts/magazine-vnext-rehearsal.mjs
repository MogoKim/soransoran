#!/usr/bin/env node
/**
 * vNext S4 리허설 — **fake provider** 로 같은 생산기 · 같은 release 조립 · 같은 merge 내용 관문을 격리 폴더에서 끝까지 돈다.
 *
 *   node scripts/magazine-vnext-rehearsal.mjs --out <폴더> [--target 1|2] [--resume]
 *
 *   ① 이 작업 트리의 main 바이트(control · Bundle · articles · legacy queue · 결속)를 읽는다(쓰기 0)
 *   ② runProduce(fake) — rollout 은 가정값 vnext/draft/<target> 를 주입한다(운영 rollout 파일 읽기 · 쓰기 0)
 *   ③ readReleaseCandidates(<out>/jobs) → assembleRelease → applyReleaseFiles(<out>/release-tree · journal) — release writer 의 실제 함수
 *   ④ judgeReleaseContent — merge 직전 관문(재컴파일 planHash · admission · ProviderPlan · 파일 모양)을 그 결과로 다시 돈다
 *   ⑤ <out>/preview.html — 읽기용 미리보기(제품 렌더 아님 · fake 표식)
 *
 * 🔴 fake 원고는 자동 생산 결과가 아니다 — ProviderPlan 칸을 틀에 끼운 합성 문장이다. 미리보기 · 산출 어디에도 공개 · 병합 경로가 없다.
 * 🔴 --out 은 저장소 밖 · 운영 상태 폴더(~/Library/Application Support/soransoran) 밖이어야 한다. git · PR · 네트워크 · 키 0.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parsePlanInputBundle, planInputRel } from './lib/magazine-content-plan-input.mjs'
import { compileContentPlans, strictControlGraphVersion } from './lib/magazine-content-plan.mjs'
import { readReleaseCandidates } from './lib/magazine-release-candidates.mjs'
import { ARTICLES_PATH, BINDING_PATH, assembleRelease, judgeReleaseContent, heroFilePath, parseArticleRecordText, planFilePath } from './lib/magazine-release.mjs'
import { applyReleaseFiles } from './lib/magazine-release-journal.mjs'
import { makeFakeProviders, makeRemote } from './lib/magazine-provider-fake.mjs'
import { runProduce } from './lib/magazine-vnext-produce.mjs'
import { publishedHeroesOf } from './magazine-vnext-produce.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const QUEUE = 'drafts/magazine/topic-queue.ts'
const CONTROL = 'src/content/magazine/graph/control.ts'
/** fake 단가 — 상한 판정 경로를 실제처럼 지나게 하는 시험 값(실제 단가가 아니다) */
export const FAKE_PRICES = Object.freeze({ manuscript: { inputPer1M: 1, outputPer1M: 4 }, image: { perImage: 0.04 } })

const inside = (child, parent) => { const r = relative(parent, child); return r === '' || (!r.startsWith('..') && !isAbsolute(r)) }
const real = (p) => { try { return realpathSync(p) } catch { return resolve(p) } }

/** 작업 트리의 main 바이트 — 생산기 · release · gate 가 같은 텍스트를 받는다 */
export function readWorktreeMain(root) {
  const read = (p) => { try { return readFileSync(join(root, p), 'utf8') } catch { return null } }
  const controlText = read(CONTROL)
  const gv = controlText ? strictControlGraphVersion(controlText) : null
  const bundle = gv ? read(planInputRel(gv)) : null
  const articlesText = read(ARTICLES_PATH)
  if (!controlText || !bundle || !articlesText) return { ok: false, code: 'MAIN_UNREADABLE', why: 'control · Bundle · articles 중 읽지 못한 것이 있다' }
  const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' })
  return { ok: true, baseSha: head.status === 0 ? head.stdout.trim() : null, bundle, controlText, articlesText, legacyQueue: { active: true, text: read(QUEUE) }, bindingText: read(BINDING_PATH) }
}

/** 리허설 한 판 — 시험(magazine-vnext-produce-check)도 이 함수를 그대로 부른다 */
export async function rehearse({ root = ROOT, out, target = 1, faults = {}, remote = makeRemote(), clock = { offset: 0 }, maxRuns = 8, resume = false, log = () => {} }) {
  const outAbs = resolve(out)
  const stateHome = real(join(homedir(), 'Library', 'Application Support', 'soransoran'))
  if (inside(real(outAbs), real(root)) || inside(real(outAbs), stateHome)) return { ok: false, code: 'OUT_NOT_ISOLATED', why: `--out 은 저장소와 운영 상태 폴더 밖이어야 한다: ${outAbs}` }
  if (existsSync(outAbs) && readdirSync(outAbs).length && !resume) return { ok: false, code: 'OUT_NOT_EMPTY', why: `${outAbs} 가 비어 있지 않다 — 새 폴더를 주거나 --resume` }
  mkdirSync(outAbs, { recursive: true })
  const main = readWorktreeMain(root)
  if (!main.ok) return main
  const jobsRoot = join(outAbs, 'jobs')
  const now = () => Date.now() + clock.offset
  const provider = { ...makeFakeProviders({ remote, faults }), models: { manuscript: 'fake-manuscript/1', image: 'fake-image/1' }, maxOutputTokens: 6000, repairMaxOutputTokens: 800, imageSize: '1536x1024', prices: FAKE_PRICES }
  const runs = []
  for (let i = 0; i < maxRuns; i++) {
    const deps = { jobsRoot, now, sleep: async (ms) => { clock.offset += ms }, runId: `rehearsal-${i + 1}`, readRollout: () => ({ code: 'VALID', effective: { path: 'vnext', release: 'draft', targetCandidates: target } }),
      readMain: () => main, provider, stage: 'REHEARSAL', publishedHeroes: () => publishedHeroesOf(root) }
    const r = await runProduce({ deps, mode: 'run' })
    runs.push({ run: i + 1, outcome: r.outcome, calls: r.calls, jobs: r.jobs.map((j) => `${j.intentId}:${j.state}${j.hold ? `(${j.hold.reason})` : ''}`) })
    log(`run ${i + 1}: ${r.outcome} ${runs.at(-1).jobs.join(' ')}`)
    if (r.jobs.length >= target && r.jobs.every((j) => ['HERO_READY', 'HOLD'].includes(j.state))) break
    clock.offset += 16 * 60 * 1000 // 다음 회차 — nextPollAt · 확인 창이 지나도록
  }
  const cand = readReleaseCandidates({ jobsRoot })
  const nowMs = now()
  const heroSlugs = existsSync(join(root, 'public/magazine')) ? readdirSync(join(root, 'public/magazine')) : []
  const release = assembleRelease({ bundle: main.bundle, controlText: main.controlText, articlesText: main.articlesText, legacyQueue: main.legacyQueue, nowMs,
    candidates: cand.candidates, slugRecords: {}, occupied: { dates: [], slugs: [] }, existingHeroSlugs: heroSlugs, targetCandidates: target, inFlightIntentIds: [], baseSha: main.baseSha })
  const result = { ok: false, out: outAbs, runs, candidates: cand.candidates.map((c) => c.planId), skipped: cand.skipped, release: { ok: release.ok, code: release.code ?? null, members: release.members, withdrawn: release.withdrawn } }
  if (!release.ok) return { ...result, code: 'RELEASE_NOT_ASSEMBLED' }
  // release writer 의 실제 적용 함수 — main 의 articles.ts 를 깐 사본 위에 CAS · journal 로 쓴다
  const tree = join(outAbs, 'release-tree')
  mkdirSync(dirname(join(tree, ARTICLES_PATH)), { recursive: true })
  if (!existsSync(join(tree, ARTICLES_PATH))) writeFileSync(join(tree, ARTICLES_PATH), main.articlesText)
  const heroOf = new Map(cand.candidates.map((c) => [c.planHash, c.heroPath]))
  applyReleaseFiles({ worktree: tree, journalPath: join(outAbs, 'release-state', 'journal.json'), release, heroBytesOf: (m) => readFileSync(heroOf.get(m.planHash)), nowIso: new Date(nowMs).toISOString() })
  const afterText = readFileSync(join(tree, ARTICLES_PATH), 'utf8')
  const slugs = release.members.map((m) => m.slug)
  const planTexts = Object.fromEntries(slugs.map((s) => [planFilePath(s), readFileSync(join(tree, planFilePath(s)), 'utf8')]))
  const heroPresent = Object.fromEntries(slugs.map((s) => [heroFilePath(s), existsSync(join(tree, heroFilePath(s)))]))
  const gate = judgeReleaseContent({ main: { bundle: main.bundle, controlText: main.controlText, articlesText: main.articlesText, legacyQueue: main.legacyQueue, bindingText: main.bindingText },
    head: { articlesText: afterText, baseArticlesText: main.articlesText, planTexts, heroPresent }, changedFiles: [ARTICLES_PATH, ...Object.keys(planTexts), ...Object.keys(heroPresent)],
    occupied: { dates: [], slugs: [] }, nowMs })
  const preview = join(outAbs, 'preview.html')
  writeFileSync(preview, renderPreview({ release, bundle: main.bundle, afterText }))
  return { ...result, ok: gate.ok, code: gate.ok ? null : 'GATE_BLOCKED', gate: { ok: gate.ok, blockedBy: gate.blockedBy, checked: gate.checked }, tree, preview,
    calls: { submit: remote.calls.submit.length, retrieve: remote.calls.retrieve.length, remove: remote.calls.remove.length, image: remote.calls.image.length } }
}

// ── 읽기용 미리보기 (제품 렌더가 아니다) ─────────────────────

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
function renderPreview({ release, bundle, afterText }) {
  const rows = parseArticleRecordText(afterText).record
  const plans = new Map(compileContentPlans({ bundle }).plans.map((p) => [p.planId, p]))
  const slugOfIntent = new Map(parsePlanInputBundle(bundle).mappings.map((m) => [m.intentId, m.slug]))
  const block = (b) => b.type === 'h2' ? `<h2>${esc(b.text)}</h2>` : b.type === 'h3' ? `<h3>${esc(b.text)}</h3>` : b.type === 'callout' ? `<aside>${esc(b.text)}</aside>`
    : b.type === 'list' ? `<${b.ordered ? 'ol' : 'ul'}>${b.items.map((x) => `<li>${esc(x)}</li>`).join('')}</${b.ordered ? 'ol' : 'ul'}>`
    : b.type === 'cta' ? `<p class="cta"><a href="https://soransoran.com${esc(b.href)}">${esc(b.label)}</a>${b.text ? ` — ${esc(b.text)}` : ''}</p>` : `<p>${esc(b.text)}</p>`
  const sections = release.members.map((m) => {
    const plan = plans.get(m.planId)
    const row = rows[m.slug]
    const rel = [...(plan?.relations?.direct ?? []), ...(plan?.relations?.discovery ?? [])].map((r) => {
      const s = slugOfIntent.get(r.toIntentId)
      return `<li>${s ? `<a href="https://soransoran.com/magazine/${esc(s)}">${esc(r.anchorLabel)}</a>` : esc(r.anchorLabel)} — ${esc(r.readerReason)}</li>`
    }).join('')
    return `<article><p class="meta">${esc(m.slug)} · ${esc(m.cluster)} · 예약 ${esc(m.publishAt)} · planHash ${esc(m.planHash.slice(0, 12))}</p>`
      + `<img src="release-tree/${esc(heroFilePath(m.slug))}" alt="${esc(row.heroImage.alt)}" width="1200" height="675">`
      + `<h1>${esc(row.title)}</h1><p class="desc">${esc(row.description)}</p>${row.body.map(block).join('\n')}`
      + `<h2>관련 글(그래프 관계)</h2><ul>${rel}</ul></article>`
  }).join('\n<hr>\n')
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>vNext S4 리허설 미리보기 (fake)</title>`
    + '<style>body{max-width:760px;margin:2rem auto;padding:0 1rem;font:18px/1.7 system-ui,sans-serif}img{width:100%;height:auto}.banner{border:2px solid;padding:.75rem 1rem;font-weight:700}.meta,.desc{opacity:.75}aside{border-left:4px solid;padding:.5rem 1rem}</style></head><body>'
    + '<p class="banner">fake provider 리허설 산출 — 실제 원고 아님 · 공개 · 병합 금지. 실제 원고는 S5 canary 의 실제 provider 로만 만든다.</p>'
    + `${sections}</body></html>\n`
}

async function main() {
  const argv = process.argv.slice(2)
  const known = new Set(['--out', '--target', '--resume'])
  if (argv.filter((a) => a.startsWith('--')).some((a) => !known.has(a))) { console.error('사용법: --out <폴더> [--target 1|2] [--resume]'); process.exit(2) }
  const out = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null
  const target = argv.includes('--target') ? Number(argv[argv.indexOf('--target') + 1]) : 1
  if (!out || ![1, 2, 3].includes(target)) { console.error('사용법: --out <폴더> [--target 1|2|3] [--resume]'); process.exit(2) }
  const r = await rehearse({ out, target, resume: argv.includes('--resume'), log: (l) => console.error(l) })
  console.log(JSON.stringify(r, null, 2))
  process.exit(r.ok ? 0 : 1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()

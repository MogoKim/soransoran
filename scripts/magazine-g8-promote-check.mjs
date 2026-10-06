#!/usr/bin/env node
/**
 * G8 편입기 검사 — 임시 fixture 에서만 쓴다. 운영 파일·연구 정본에는 쓰지 않는다.
 *
 * 무엇을 보나
 *   ① 모든 의도가 정확히 한 상태로 분류된다 (fixture 의도마다 기대 상태가 있다)
 *   ② HOLD·REJECT·INCOMPLETE·영토 미결정·중복은 후보가 되지 못한다
 *   ③ 필수 필드·제목·시리즈 선행·publishWindow 계약
 *   ④ primary 5 + fallback 3 의 결정적 순서 · 입력 순서를 뒤집어도 같은 manifest
 *   ⑤ CLI dry-run 이 입력을 한 바이트도 바꾸지 않는다 · 두 번 돌려도 같은 출력
 *   ⑥ apply — 두 번 실행해도 중복 0 · 중간 실패는 세 파일 원복 · 큐/편입 장부 어긋남 탐지
 *   ⑦ manifest 가 읽은 입력 **하나하나**가 바뀌면 STALE_INPUT
 *   ⑧ 편입 장부는 정본 m3-pipeline 계약으로만 — 깨진 장부·1:1 위반이면 쓰기 0
 *   ⑨ 판정 시각은 정확한 KST 시각 — 같은 날 10:29:59 / 10:30:00 경계
 *   ⑩ **실제 자식 프로세스** — 동시 apply 는 하나만 쓰고, SIGKILL 급사는 다음 apply 가 되돌린다
 *   ⑪ (연구 디렉터리가 있을 때만) 실제 I-T6-09 · I-T1-26 · 정본 pipeline 사본 대조
 *   ⑫ 후보 0건 manifest 도 잠금 안에서 앞선 급사를 먼저 되돌린다 (실제 SIGKILL)
 *   ⑬ G8 apply 대 M-AUTO 등록 — topic-queue 공용 writer 잠금 · 스냅샷 원복 CAS (실제 자식 프로세스)
 *   ⑭ journal 신원 — 경로·개수·중복·schema 가 어긋나면 쓰기·삭제 0
 *
 * 🔴 `G8_PROMOTER_LIB` 는 변이 시험(`magazine-g8-promote-mutation.mjs`)이 바꾼 lib 를 넣는 자리다.
 *    그때는 CLI 자식 프로세스도 변이된 lib 옆의 CLI 사본을 쓴다 — 운영 CLI 는 이 변수를 읽지 않는다.
 *
 * 사용: node scripts/magazine-g8-promote-check.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseQueueSource } from './lib/magazine-load.mjs'
import { isAutoLaneEligible } from './lib/magazine-validation-profile.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const LIB = process.env.G8_PROMOTER_LIB ?? path.join(HERE, 'lib/magazine-g8-promoter.mjs')
const lib = await import(pathToFileURL(LIB).href)
const CLI_REAL = path.join(HERE, 'magazine-g8-promote.mjs')
const PIPELINE_FIXTURE = path.join(HERE, '__fixtures__/magazine-g8')
const AT = '2026-10-06T09:00:00+09:00'

let pass = 0
let fail = 0
function expect(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else { fail++; console.log(`  ❌ ${name}\n     기대 ${JSON.stringify(want)}\n     실제 ${JSON.stringify(got)}`) }
}
const finish = () => { console.log(`\n${fail ? '🔴' : '✅'} G8 편입기 검사 ${pass}/${pass + fail}\n`) }
process.on('uncaughtException', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e.message}`); finish(); process.exit(1) })
process.on('unhandledRejection', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e?.message ?? e}`); finish(); process.exit(1) })

/**
 * 🔴 변이 시험에서는 CLI 도 변이된 lib 를 써야 한다 — 그렇지 않으면 자식 프로세스 시험이 원본 lib 를 검사한다.
 *    변이 lib 폴더(…/lib) 옆에 CLI 사본을 둔다 — 같은 상대 경로 import 를 그대로 쓴다.
 */
function cliPath() {
  if (!process.env.G8_PROMOTER_LIB) return CLI_REAL
  const copy = path.join(path.dirname(path.dirname(LIB)), 'magazine-g8-promote.mjs')
  if (!fs.existsSync(copy)) fs.copyFileSync(CLI_REAL, copy)
  return copy
}
const CLI = cliPath()

// ── fixture ─────────────────────────────────────────────────

const ev = (observedHits, communityWomen = 0) => ({ refs: 1, observedHits, grade: 'OBSERVED', branchOpened: 0, communityWomen })
/**
 * 의도 하나 = build·canonical·automation·rebaseline 네 줄. 기본은 **완전한 AUTO_READY**,
 * 바꾸고 싶은 것만 덮어쓴다. `expectClass` 가 이 의도의 정답이다.
 */
const BASE = {
  territoryId: 'T8', magazineCluster: 'money-work', verificationProfile: 'STANDARD', automationDecision: 'PASS',
  topicVerdict: 'AUTO_READY_TOPIC', communityDestination: '/community/free', answerScope: '이 글이 답할 범위',
  audienceSituation: '이런 상황의 독자', exclusions: ['단정하지 않는다'], evidence: ev(1),
  riskLevel: 'LOW', contentTypeHint: 'EVERGREEN', searchIntentType: '질문', priorCommunityFit: null, decisionBundle: null,
}
const INTENTS = [
  { id: 'I-F-01', q: '살 빠지는 속도가 느려질 때', expectClass: 'LIVE', topicVerdict: 'EXTEND_EXISTING', existingSlugs: [{ slug: 'live-article', coverage: 'ANSWERS' }] },
  { id: 'I-F-02', q: '예약된 주제를 묻는 질문', expectClass: 'SCHEDULED', topicVerdict: 'EXTEND_EXISTING', existingSlugs: [{ slug: 'sched-article', coverage: 'SCHEDULED_NOT_YET_PUBLIC' }] },
  { id: 'I-F-03', q: '큐에 이미 있는 주제 질문', expectClass: 'ALREADY_QUEUED', topicVerdict: 'EXTEND_EXISTING', existingSlugs: [{ slug: 'queued-one', coverage: 'QUEUED_NOT_PUBLIC' }] },
  { id: 'I-F-04', q: '사라진 글을 가리키는 질문', expectClass: 'DUPLICATE_OR_CONFLICT', existingSlugs: [{ slug: 'gone-slug', coverage: 'ANSWERS' }] },
  { id: 'I-F-05', q: '판정에서 빠진 질문입니다', expectClass: 'REJECT', automationDecision: 'REJECT', topicVerdict: 'AUTO_REJECT' },
  { id: 'I-F-06', q: '근거가 모자란 질문입니다', expectClass: 'HOLD', automationDecision: 'HOLD', topicVerdict: 'AUTO_HOLD' },
  { id: 'I-F-07', q: '기존 글을 보강할 질문', expectClass: 'EXTEND_EXISTING', topicVerdict: 'EXTEND_EXISTING', existingSlugs: [{ slug: 'live-article', coverage: 'ADJACENT' }] },
  { id: 'I-F-08', q: '부모님 돌봄을 시작할 때', expectClass: 'TERRITORY_DECISION_REQUIRED', decisionBundle: 'T9_PARENT_CARE', evidence: ev(10, 3) },
  { id: 'I-F-09', q: '후보 영토에 있는 질문', expectClass: 'TERRITORY_DECISION_REQUIRED', territoryId: 'T9(후보)', evidence: ev(10, 3) },
  { id: 'I-F-10', q: '살이 잘 안 빠질 때', expectClass: 'DUPLICATE_OR_CONFLICT', evidence: ev(10, 3) },
  { id: 'I-F-11', q: '큐에 있는 주제 제목', expectClass: 'DUPLICATE_OR_CONFLICT', evidence: ev(10, 3) },
  { id: 'I-F-12', q: '원고 폴더와 겹치는 질문', expectClass: 'DUPLICATE_OR_CONFLICT', slug: 'draft-only-slug', evidence: ev(10, 3) },
  { id: 'I-F-13', q: '판정이 끝나지 않은 질문', expectClass: 'INCOMPLETE', topicVerdict: 'AUTO_PENDING', evidence: ev(10, 3) },
  { id: 'I-F-14', q: '콘텐츠 유형이 비어 있을 때', expectClass: 'INCOMPLETE', contentTypeHint: null, evidence: ev(10, 3) },
  { id: 'I-F-15', q: '커뮤니티 목적지가 없을 때', expectClass: 'INCOMPLETE', communityDestination: null, evidence: ev(10, 3) },
  { id: 'I-F-16', q: '갱년기', expectClass: 'INCOMPLETE', evidence: ev(10, 3) },
  { id: 'I-F-17', q: '이어질 관계가 없는 질문', expectClass: 'INCOMPLETE', noEdges: true, evidence: ev(10, 3) },
  { id: 'I-F-18', q: '계절 창이 없는 계절 주제', expectClass: 'INCOMPLETE', contentTypeHint: 'SEASONAL', evidence: ev(10, 3) },
  { id: 'I-F-19', q: '검색 의도 유형이 없을 때', expectClass: 'INCOMPLETE', searchIntentType: null, evidence: ev(10, 3) },
  { id: 'I-F-20', q: '시니어 운동을 시작하는 방법', expectClass: 'INCOMPLETE', evidence: ev(10, 3) },
  { id: 'I-F-21', q: '사전이 가르지 못한 첫째 질문', expectClass: 'INCOMPLETE', slug: 'same-dictionary-slug', evidence: ev(10, 3) },
  { id: 'I-F-22', q: '사전이 가르지 못한 둘째 질문', expectClass: 'INCOMPLETE', slug: 'same-dictionary-slug', evidence: ev(10, 3) },
  { id: 'I-F-23', q: '클러스터 정본이 서로 다를 때', expectClass: 'INCOMPLETE', canonCluster: 'sleep', evidence: ev(10, 3) },
  // ── 실제 반례를 옮긴 것 — 부분 답변 · 범위 확장은 완료 답변이 아니다 ──
  { id: 'I-T6-09', q: '50대 여자가 할 수 있는 일에 뭐가 있나', expectClass: 'EXTEND_EXISTING', topicVerdict: 'EXTEND_EXISTING', existingSlugs: [{ slug: 'rehire-where-to-start', coverage: 'ANSWERS_PARTIAL' }] },
  { id: 'I-T1-26', q: '호르몬 치료 범위를 넓혀 묻는 질문', expectClass: 'EXTEND_EXISTING', topicVerdict: 'EXTEND_EXISTING', existingSlugs: [{ slug: 'hormone-therapy-who', coverage: 'ANSWERS_WITH_SCOPE_EXPANSION' }] },
  // ── 같은 날 10:30 공개 글 — 판정 시각 경계 ──
  { id: 'I-F-52', q: '내일 아침 공개될 글의 질문', expectClass: 'SCHEDULED', topicVerdict: 'EXTEND_EXISTING', existingSlugs: [{ slug: 'boundary-article', coverage: 'ANSWERS' }] },
  // ── 판정은 ELIGIBLE_NEW · 이번 구간에서 빠지는 것 ──
  { id: 'I-F-30', q: '철 지난 계절 주제 질문', expectClass: 'ELIGIBLE_NEW', contentTypeHint: 'SEASONAL', publishWindow: { after: '2026-08-01', before: '2026-09-30' }, evidence: ev(10, 3) },
  { id: 'I-F-31', q: '아직 이른 계절 주제 질문', expectClass: 'ELIGIBLE_NEW', contentTypeHint: 'SEASONAL', publishWindow: { after: '2026-11-01', before: '2026-12-31' }, evidence: ev(10, 3) },
  { id: 'I-F-35', q: '앞 회차가 없는 시리즈 둘째 편', expectClass: 'ELIGIBLE_NEW', seriesId: 'gap-series', seriesOrder: 2, evidence: ev(10, 3) },
  // ── 선정 대상 ──
  { id: 'I-F-32', q: '지금 창이 열린 계절 주제', expectClass: 'ELIGIBLE_NEW', riskLevel: 'MEDIUM', magazineCluster: 'emotion', contentTypeHint: 'SEASONAL', publishWindow: { after: '2026-10-01', before: '2026-11-30' }, evidence: ev(1) },
  { id: 'I-F-33', q: '걷기 시리즈 둘째 편 질문', expectClass: 'ELIGIBLE_NEW', magazineCluster: 'daily', seriesId: 'walk-series', seriesOrder: 2, evidence: ev(6), priorCommunityFit: 'MEDIUM' },
  { id: 'I-F-41', q: '증거가 가장 많은 생활 질문', expectClass: 'ELIGIBLE_NEW', evidence: ev(9), priorCommunityFit: 'HIGH', toLive: true },
  { id: 'I-F-42', q: '증거가 중간인 생활 질문', expectClass: 'ELIGIBLE_NEW', evidence: ev(5), priorCommunityFit: 'MEDIUM' },
  { id: 'I-F-43', q: '증거가 적은 생활 질문', expectClass: 'ELIGIBLE_NEW', evidence: ev(2) },
  { id: 'I-F-44', q: '중간 위험의 생활 질문', expectClass: 'ELIGIBLE_NEW', riskLevel: 'MEDIUM', evidence: ev(4) },
  { id: 'I-F-45', q: '의료 프로필 첫째 질문', expectClass: 'ELIGIBLE_NEW', riskLevel: 'MEDIUM', verificationProfile: 'MEDICAL', evidence: ev(8) },
  { id: 'I-F-46', q: '의료 프로필 둘째 질문', expectClass: 'ELIGIBLE_NEW', riskLevel: 'MEDIUM', verificationProfile: 'MEDICAL', evidence: ev(3) },
  { id: 'I-F-47', q: '높은 위험의 의료 질문', expectClass: 'ELIGIBLE_NEW', riskLevel: 'HIGH', verificationProfile: 'MEDICAL', evidence: ev(10) },
  { id: 'I-F-48', q: '높은 위험의 재정 질문', expectClass: 'ELIGIBLE_NEW', riskLevel: 'HIGH', verificationProfile: 'FINANCIAL', evidence: ev(1) },
]
/** 정답 순서 — tier(LOW/STANDARD → STANDARD → 비HIGH → HIGH) → 점수 내림차순 → intentId */
const WANT_PRIMARY = ['I-F-41', 'I-F-33', 'I-F-42', 'I-F-43', 'I-F-44']
const WANT_FALLBACK = ['I-F-32', 'I-F-45', 'I-F-46']

const slugOf = (x) => x.slug ?? `fx-${x.id.toLowerCase()}`
const write = (root, rel, text) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text) }
const jsonl = (rows) => rows.map((r) => `${JSON.stringify(r)}\n`).join('')

function makeFixture({ reverse = false, bundleCombined = 'fixturecombined', dropCanonical = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'g8-check-'))
  const research = path.join(dir, 'research')
  const repo = path.join(dir, 'repo')
  const order = reverse ? [...INTENTS].reverse() : INTENTS
  const v = (x, k) => (k in x ? x[k] : BASE[k])

  const build = order.map((x) => ({
    schemaVersion: 'intent/2', intentId: x.id, primaryQuery: x.q, territoryId: v(x, 'territoryId'),
    magazineCluster: v(x, 'magazineCluster'), audienceSituation: v(x, 'audienceSituation'), answerScope: v(x, 'answerScope'),
    exclusions: v(x, 'exclusions'), verificationProfile: v(x, 'verificationProfile'), automationDecision: v(x, 'automationDecision'),
    topicVerdict: v(x, 'topicVerdict'), communityDestination: v(x, 'communityDestination'), evidence: v(x, 'evidence'),
  }))
  const canonical = order.filter((x) => !(dropCanonical && x.id === 'I-F-48')).map((x) => ({
    intentId: x.id, riskLevel: v(x, 'riskLevel'), contentTypeHint: v(x, 'contentTypeHint'), searchIntentType: v(x, 'searchIntentType'),
    magazineCluster: x.canonCluster ?? v(x, 'magazineCluster'), existingSlugs: x.existingSlugs ?? [],
    evidenceRefs: [{ evidencePath: `evidence/fixture/${x.id}.json` }],
    ...(x.publishWindow ? { publishWindow: x.publishWindow } : {}),
    ...(x.seriesId ? { seriesId: x.seriesId, seriesOrder: x.seriesOrder } : {}),
  }))
  const automation = order.map((x) => ({ intentId: x.id, verdictWhy: `${x.id} 판정 근거`, priorCommunityFit: v(x, 'priorCommunityFit') }))
  const rebaseline = order.map((x) => ({ intentId: x.id, decisionBundle: v(x, 'decisionBundle') }))
  const edges = []
  for (const x of order) {
    if (x.noEdges) continue
    edges.push({ edgeId: `E-${x.id}-a`, fromIntentId: x.id, toIntentId: x.toLive ? 'I-F-01' : 'I-F-07', relationType: 'NEXT_QUESTION',
      anchorLabel: '다음 질문', readerReason: '읽고 나면 이어서 궁금해진다', priority: 1, layers: { AUTOMATION_READY: true } })
    edges.push({ edgeId: `E-${x.id}-b`, fromIntentId: x.id, toIntentId: 'I-F-06', relationType: 'COMMUNITY',
      anchorLabel: '이야기 나누기', readerReason: '경험을 나눈다', priority: 1, layers: { AUTOMATION_READY: true } })
  }
  write(research, 'g4-intents-canonical.jsonl', jsonl(canonical))
  write(research, 'g4-automation-2026-09-23.jsonl', jsonl(automation))
  write(research, 'g4-rebaseline-2026-09-23.jsonl', jsonl(rebaseline))
  write(research, 'contract/build/current/intents.jsonl', jsonl(build))
  write(research, 'contract/build/current/edges.jsonl', jsonl(edges))
  write(research, 'contract/build/current/mappings.jsonl', '')
  write(research, 'contract/build/current/manifest.json', JSON.stringify({ graphVersion: 'g-fixture-000000', contentHash: { combined: 'fixturecombined' } }))
  const table = Object.fromEntries(INTENTS.map((x) => [x.q, slugOf(x)]))
  write(research, 'contract/m3-slug.mjs', `const T = ${JSON.stringify(table)}\nexport function proposeSlug(q) { return T[q] ?? '' }\n`)
  write(research, 'contract/m3-slug-manifest.json', `${JSON.stringify({ _note: 'fixture', asOf: '2026-09-24', slugs: {} }, null, 2)}\n`)
  // 🔴 장부 계약은 정본 사본이다 (⑪ 이 연구 디렉터리의 원본과 바이트 대조한다)
  for (const f of ['m3-pipeline.mjs', 'm3-product.mjs']) fs.copyFileSync(path.join(PIPELINE_FIXTURE, f), path.join(research, 'contract', f))

  write(repo, 'src/content/magazine/types.ts', fs.readFileSync(path.join(REPO, 'src/content/magazine/types.ts'), 'utf8'))
  const realQueue = fs.readFileSync(path.join(REPO, 'drafts/magazine/topic-queue.ts'), 'utf8')
  const header = realQueue.slice(0, realQueue.indexOf('export const TOPIC_QUEUE'))
  const qRow = (day, slug, title, cluster) => lib.renderQueueRow({ day, slug, title, contentType: 'EVERGREEN', intent: '상황', cluster,
    target: '50대', riskLevel: 'LOW', reviewMode: 'SUMMARY_ONLY', imageMode: 'OPTIONAL', autoEligible: true, ctaBoard: '/community/free',
    internalLinks: [], whyNow: '기존 행', notes: '기존 행' })
  write(repo, 'drafts/magazine/topic-queue.ts', `${header}export const TOPIC_QUEUE: TopicQueueItem[] = [\n${qRow(10, 'queued-one', '큐에 이미 있는 주제 질문', 'family')}${qRow(12, 'queued-two', '큐에 있는 주제 제목', 'relationship')}]\n`)
  const art = (title, cluster, extra) => ({ title, description: '설명', cluster, publishedAt: '2026-09-01', body: [], ...extra })
  write(repo, 'src/content/magazine/articles.ts', `export const MAGAZINE_ARTICLE_RECORD = ${JSON.stringify({
    'live-article': art('살이 잘 안 빠질 때', 'daily', { seriesId: 'walk-series', seriesOrder: 1 }),
    'sched-article': art('예약된 글 제목입니다', 'sleep', { status: 'SCHEDULED', publishedAt: '2026-10-20', publishAt: '2026-10-20T10:30:00+09:00' }),
    'rehire-where-to-start': art('재취업 어디서부터 시작할까', 'money-work'),
    'hormone-therapy-who': art('호르몬 치료는 누가 받나', 'clinic'),
    'boundary-article': art('내일 아침 공개될 글', 'sleep', { status: 'SCHEDULED', publishedAt: '2026-10-07', publishAt: '2026-10-07T10:30:00+09:00' }),
  }, null, 2)}\n`)
  write(repo, 'src/content/magazine/graph/current.ts', "export { GRAPH, EXPORT_HASH } from './g-fixture-000000'\n")
  write(repo, 'src/content/magazine/graph/g-fixture-000000.ts', `export const GRAPH = ${JSON.stringify({
    graphVersion: 'g-fixture-000000', contentHash: { combined: bundleCombined }, edges: [], intents: [],
    mappings: [{ intent: 'I-F-01', slug: 'live-article', cluster: 'daily' }],
  }, null, 2)}\nexport const EXPORT_HASH = 'x'\n`)
  fs.mkdirSync(path.join(repo, 'drafts/magazine/draft-only-slug'), { recursive: true })
  return { dir, research, repo }
}

/** 디렉터리 전체의 파일 → sha256. 새 파일·지운 파일·바뀐 바이트를 모두 잡는다 */
function snapshot(root) {
  const out = {}
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const f = path.join(d, e.name)
      if (e.isDirectory()) { out[`${path.relative(root, f)}/`] = 'DIR'; walk(f) } else out[path.relative(root, f)] = lib.sha256(fs.readFileSync(f, 'utf8'))
    }
  }
  walk(root)
  return out
}

const build = async (fx, at = AT) => lib.buildManifest(await lib.loadInputs({ researchDir: fx.research, repoDir: fx.repo }), { at })
const filesOf = (fx) => ({
  queue: path.join(fx.repo, 'drafts/magazine/topic-queue.ts'),
  slugs: path.join(fx.research, 'contract/m3-slug-manifest.json'),
  ledger: path.join(fx.research, 'contract/m3-state.jsonl'),
})
const bytesOf = (fx) => Object.fromEntries(Object.entries(filesOf(fx)).map(([k, f]) => [k, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null]))
const apply = (m, fx, faultHook = () => {}) => lib.applyManifest({ manifest: m, queueRoot: fx.repo, admissionRoot: fx.research, faultHook })
const ledgerRows = (text) => (text ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l))
const fixtures = []
const fresh = (o) => { const f = makeFixture(o); fixtures.push(f); return f }

// ── ① 분류 ──────────────────────────────────────────────────
console.log('\n① 의도마다 정확히 한 상태')
const fx = fresh()
const m = await build(fx)
const byId = Object.fromEntries(m.classification.map((r) => [r.intentId, r]))
for (const x of INTENTS) expect(`${x.id} ${x.q} → ${x.expectClass}`, byId[x.id]?.class, x.expectClass)
expect('분류 합계 = 의도 수', lib.CLASSES.map((c) => m.counts[c]).reduce((a, b) => a + b, 0), INTENTS.length)
expect('모든 의도가 알려진 상태 하나', m.classification.every((r) => lib.CLASSES.includes(r.class)), true)
expect('의도 중복 행 0', new Set(m.classification.map((r) => r.intentId)).size, INTENTS.length)

// ── ② 유입 차단 ─────────────────────────────────────────────
console.log('② HOLD·REJECT·INCOMPLETE·영토·중복은 후보가 아니다')
const chosen = [...m.selection.primary, ...m.selection.fallback].map((s) => s.intentId)
const blockedIds = INTENTS.filter((x) => x.expectClass !== 'ELIGIBLE_NEW').map((x) => x.id)
expect('후보에 비적격 의도 0', chosen.filter((id) => blockedIds.includes(id)), [])
expect('후보는 전부 ELIGIBLE_NEW', chosen.every((id) => byId[id].class === 'ELIGIBLE_NEW'), true)
expect('중복 사유 — 기존 글 제목', byId['I-F-10'].reasons.some((r) => r.startsWith('TITLE_MATCHES_ARTICLE')), true)
expect('중복 사유 — 큐 제목', byId['I-F-11'].reasons.some((r) => r.startsWith('TITLE_MATCHES_QUEUE')), true)
expect('중복 사유 — 원고 폴더 slug', byId['I-F-12'].reasons.some((r) => r.startsWith('SLUG_TAKEN')), true)

// ── ③ 계약 ──────────────────────────────────────────────────
console.log('③ 필수 필드 · 제목 · 시리즈 · publishWindow')
const has = (id, prefix) => byId[id].reasons.some((r) => r.startsWith(prefix))
expect('contentType 없음 → INCOMPLETE(contentType)', has('I-F-14', 'contentType'), true)
expect('CTA 없음 → INCOMPLETE(cta)', has('I-F-15', 'cta'), true)
expect('짧은 제목 → INCOMPLETE(title_form)', has('I-F-16', 'title_form'), true)
expect('관계 없음 → INCOMPLETE(relations)', has('I-F-17', 'relations'), true)
expect('SEASONAL 창 없음 → INCOMPLETE(publishWindow)', has('I-F-18', 'publishWindow'), true)
expect('검색 의도 유형 없음 → INCOMPLETE(searchIntent)', has('I-F-19', 'searchIntent'), true)
expect('금지어 제목 → INCOMPLETE(title_banned)', has('I-F-20', 'title_banned'), true)
expect('slug 사전 충돌 → 양쪽 INCOMPLETE', [has('I-F-21', 'slug_collision'), has('I-F-22', 'slug_collision')], [true, true])
expect('cluster 정본 충돌 → INCOMPLETE', has('I-F-23', 'cluster_conflict'), true)
const excluded = Object.fromEntries(m.selection.excluded.map((x) => [x.intentId, x.reason.split(' — ')[0]]))
expect('창 지난 계절 주제 제외', excluded['I-F-30'], 'WINDOW_CLOSED')
expect('창 열리기 전 계절 주제 제외', excluded['I-F-31'], 'WINDOW_NOT_OPEN')
expect('선행편 없는 시리즈 제외', excluded['I-F-35'], 'SERIES_PREREQ')
expect('선행편 있는 시리즈는 선정', chosen.includes('I-F-33'), true)
const rowOf = (id) => [...m.queueRows, ...m.fallbackRows].find((r) => r.intentId === id)
expect('계절 행은 publishWindow 를 그대로 싣는다', rowOf('I-F-32')?.publishWindow, { after: '2026-10-01', before: '2026-11-30' })
expect('HIGH 는 막지 않고 뒤로 간다', excluded['I-F-47'], 'BEYOND_RUN')
const REQUIRED = ['day', 'slug', 'title', 'contentType', 'intent', 'cluster', 'target', 'validationProfile', 'riskLevel',
  'reviewMode', 'imageMode', 'autoEligible', 'ctaBoard', 'internalLinks', 'whyNow', 'notes', 'intentId']
expect('primary 행 필수 필드 전부 존재', m.queueRows.every((r) => REQUIRED.every((k) => r[k] !== undefined && r[k] !== null && r[k] !== '')), true)
expect('imageMode 는 레인 계약값 REQUIRED', [...new Set(m.queueRows.map((r) => r.imageMode))], ['REQUIRED'])
expect('validationProfile 을 STANDARD 로 낮추지 않는다', rowOf('I-F-45')?.validationProfile, 'MEDICAL')
expect('primary 행은 자동 레인 판정을 통과한다', m.queueRows.map((r) => isAutoLaneEligible(r).ok), m.queueRows.map(() => true))
expect('기존 공개 글 연결이 internalLinks 로 간다', rowOf('I-F-41')?.internalLinks, ['live-article'])
expect('편입 장부 행 = primary (intentId·slug 짝)', m.admissionRows.map((r) => [r.intentId, r.slug]), m.queueRows.map((r) => [r.intentId, r.slug]))
expect('COMMUNITY 관계는 추천 관계에 넣지 않는다', m.admissionRows.every((r) => r.directRelations.every((d) => d.slot !== null)), true)
expect('primary day 는 기존 큐 최대 뒤', m.queueRows.map((r) => r.day), [13, 14, 15, 16, 17])
expect('fallback 은 day 를 받지 않는다', m.fallbackRows.map((r) => r.day), [null, null, null])
expect('제품 graph bundle 은 읽기만 한다고 manifest 가 말한다', m.productGraphBundle?.updatedByThisTool, false)

// ── ④ 결정적 순서 ───────────────────────────────────────────
console.log('④ primary 5 + fallback 3 의 결정적 순서')
expect('primary 순서', m.selection.primary.map((s) => s.intentId), WANT_PRIMARY)
expect('fallback 순서', m.selection.fallback.map((s) => s.intentId), WANT_FALLBACK)
const m2 = await build(fx)
expect('두 번 계산 — 바이트 동일', JSON.stringify(m2), JSON.stringify(m))
const mRev = await build(fresh({ reverse: true }))
expect('입력 순서를 뒤집어도 같은 선정', [mRev.selection.primary, mRev.selection.fallback].map((l) => l.map((s) => s.intentId)), [WANT_PRIMARY, WANT_FALLBACK])
expect('입력 순서를 뒤집어도 같은 큐 행', JSON.stringify(mRev.queueRows), JSON.stringify(m.queueRows))
let threw = null
try { await build(fresh({ bundleCombined: 'other' })) } catch (e) { threw = e.message.split(' — ')[0] }
expect('연구 build 와 제품 번들이 다르면 만들지 않는다', threw, 'GRAPH_BUNDLE_MISMATCH')
threw = null
try { await build(fresh({ dropCanonical: true })) } catch (e) { threw = e.message.slice(0, 20) }
expect('연구 정본 의도 집합이 다르면 만들지 않는다', threw, '연구 정본의 의도 집합이 서로 다르다'.slice(0, 20))

// ── ⑤ CLI dry-run ───────────────────────────────────────────
console.log('⑤ CLI dry-run 은 아무것도 쓰지 않는다')
const before = { research: snapshot(fx.research), repo: snapshot(fx.repo) }
const run = () => execFileSync('node', [CLI, '--research', fx.research, '--repo', fx.repo, '--at', AT, '--json'], { encoding: 'utf8', maxBuffer: 1e8 })
const out1 = run()
const out2 = run()
expect('CLI 두 번 — 출력 바이트 동일', out1 === out2, true)
expect('CLI 출력 = 라이브러리 manifest', JSON.parse(out1).hash, m.hash)
const human = execFileSync('node', [CLI, '--research', fx.research, '--repo', fx.repo, '--at', AT], { encoding: 'utf8' })
expect('CLI 보고가 제품 graph bundle 을 갱신하지 않는다고 말한다', human.includes('제품 graph bundle 갱신은 별도 단계'), true)
expect('dry-run 뒤 연구 입력 바이트·파일 목록 동일', snapshot(fx.research), before.research)
expect('dry-run 뒤 제품 입력 바이트·파일 목록 동일', snapshot(fx.repo), before.repo)
const outInside = spawnSync('node', [CLI, '--research', fx.research, '--repo', fx.repo, '--at', AT, '--out', path.join(fx.repo, 'm.json')], { encoding: 'utf8' })
expect('--out 은 저장소 안을 거부한다', [outInside.status, fs.existsSync(path.join(fx.repo, 'm.json'))], [2, false])

// ── ⑥ apply ────────────────────────────────────────────────
console.log('⑥ apply — 멱등 · 원복 · 큐/편입 장부 짝')
const files = filesOf(fx)
const pristine = bytesOf(fx)
for (const stage of ['after:queue', 'after:slugManifest', 'after:ledger']) {
  const r = await apply(m, fx, (s) => { if (s === stage) throw new Error(`주입 실패 ${s}`) })
  expect(`${stage} 에서 실패 → 세 파일 원복`, [r.code, r.restored, JSON.stringify(bytesOf(fx)) === JSON.stringify(pristine)], ['ROLLED_BACK', true, true])
}
const corrupt = await apply(m, fx, (s) => {
  if (s === 'after:ledger') fs.writeFileSync(files.ledger, fs.readFileSync(files.ledger, 'utf8').split('\n').slice(1).join('\n'))
})
expect('편입 장부가 반쪽이면 쓰기 뒤 대조가 잡고 원복한다', [corrupt.code, JSON.stringify(bytesOf(fx)) === JSON.stringify(pristine)], ['ROLLED_BACK', true])
const tampered = { ...m, queueRows: m.queueRows.map((r, i) => (i ? r : { ...r, title: `${r.title}!` })) }
expect('본문이 해시와 다르면 쓰지 않는다', (await apply(tampered, fx)).code, 'HASH_MISMATCH')

const first = await apply(m, fx)
expect('첫 apply', [first.ok, first.code, first.rows], [true, 'APPLIED', 5])
const afterFirst = bytesOf(fx)
const second = await apply(m, fx)
expect('둘째 apply — 아무것도 쓰지 않는다', [second.ok, second.code], [true, 'ALREADY_APPLIED'])
expect('둘째 apply 뒤 세 파일 바이트 동일', JSON.stringify(bytesOf(fx)), JSON.stringify(afterFirst))
const queueAfter = parseQueueSource(afterFirst.queue)
expect('큐 행 수 = 기존 2 + primary 5 (중복 0)', [queueAfter.length, new Set(queueAfter.map((r) => r.slug)).size], [7, 7])
expect('장부 ADMITTED = 5 (중복 0)', ledgerRows(afterFirst.ledger).length, 5)
expect('장부 행은 정본 recordAdmission 모양 (m3ledger/2 · at = 판정 시각)', ledgerRows(afterFirst.ledger).map((r) => [r.schemaVersion, r.event, r.at]), m.queueRows.map(() => ['m3ledger/2', 'ADMITTED', AT]))
expect('기존 큐 행은 바이트 그대로', afterFirst.queue.includes(lib.renderQueueRow(parseQueueSource(pristine.queue)[0])), true)
const added = queueAfter.filter((r) => r.g8ManifestHash)
expect('새 큐 행이 manifest 해시를 단다', [...new Set(added.map((r) => r.g8ManifestHash))], [m.hash])
expect('새 큐 행은 M-AUTO 자동 레인 판정 통과', added.map((r) => isAutoLaneEligible(r).ok), added.map(() => true))
expect('영구 slug 표가 짝을 묶는다', Object.entries(JSON.parse(afterFirst.slugs).slugs).sort(), m.queueRows.map((r) => [r.intentId, r.slug]).sort())
expect('정상 종료 뒤 journal 이 남지 않는다', fs.existsSync(path.join(fx.research, lib.JOURNAL_FILE)), false)
{
  // 🔴 fixture 큐는 실제 topic-queue.ts 의 타입 머리를 그대로 쓴다 — 새 행이 tsc 를 통과해야 운영 apply 가 빌드를 깨지 않는다
  const tsconfig = path.join(fx.dir, 'tsconfig.json')
  fs.writeFileSync(tsconfig, JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, target: 'es2020',
    module: 'esnext', moduleResolution: 'bundler', baseUrl: REPO, paths: { '@/*': ['src/*'] } }, files: [files.queue] }))
  const tsc = spawnSync(path.join(REPO, 'node_modules/.bin/tsc'), ['-p', tsconfig], { encoding: 'utf8' })
  expect('tsc --noEmit (apply 된 fixture 큐)', [tsc.status, (tsc.stdout + tsc.stderr).trim().split('\n')[0] ?? ''], [0, ''])
}
const consistent = () => lib.verifyConsistency({ queueSource: fs.readFileSync(files.queue, 'utf8'), ledgerSource: fs.readFileSync(files.ledger, 'utf8'), slugManifestSource: fs.readFileSync(files.slugs, 'utf8') })
expect('apply 뒤 큐/편입 장부 대조 PASS', consistent().ok, true)
const verifyCli = spawnSync('node', [CLI, '--verify', '--queue-root', fx.repo, '--admission-root', fx.research], { encoding: 'utf8' })
expect('--verify CLI PASS', verifyCli.status, 0)

fs.writeFileSync(files.queue, pristine.queue)
expect('큐 행을 지우면 ADMISSION_WITHOUT_QUEUE', consistent().problems.some((p) => p.startsWith('ADMISSION_WITHOUT_QUEUE')), true)
expect('그 상태에서 apply 는 쓰지 않는다 (STALE_INPUT)', (await apply(m, fx)).code, 'STALE_INPUT')
fs.writeFileSync(files.queue, afterFirst.queue)
fs.writeFileSync(files.ledger, '')
expect('장부 행을 지우면 QUEUE_WITHOUT_ADMISSION', consistent().problems.some((p) => p.startsWith('QUEUE_WITHOUT_ADMISSION')), true)
fs.writeFileSync(files.ledger, afterFirst.ledger)
{
  const registeredSlug = m.queueRows[0].slug
  const rows = parseQueueSource(afterFirst.queue).filter((r) => r.slug !== registeredSlug)
  const header = afterFirst.queue.slice(0, afterFirst.queue.indexOf('export const TOPIC_QUEUE'))
  fs.writeFileSync(files.queue, `${header}export const TOPIC_QUEUE: TopicQueueItem[] = [\n${rows.map(lib.renderQueueRow).join('')}]\n`)
  const artFile = path.join(fx.repo, 'src/content/magazine/articles.ts')
  const articles = fs.readFileSync(artFile, 'utf8')
  const withReg = articles.replace('"live-article":', `"${registeredSlug}": { "title": "등록됨", "cluster": "daily", "publishedAt": "2026-10-10", "body": [] },\n  "live-article":`)
  fs.writeFileSync(artFile, withReg)
  expect('등록된 글은 ADMISSION_WITHOUT_QUEUE 가 아니다', lib.verifyConsistency({ queueSource: fs.readFileSync(files.queue, 'utf8'), articlesSource: withReg,
    ledgerSource: afterFirst.ledger, slugManifestSource: afterFirst.slugs }).ok, true)
  expect('등록 뒤 apply 재실행도 ALREADY_APPLIED', (await apply(m, fx)).code, 'ALREADY_APPLIED')
  fs.writeFileSync(artFile, articles)
  fs.writeFileSync(files.queue, afterFirst.queue)
}
const m4 = await build(fx)
expect('apply 뒤 재계산 — 편입분 ALREADY_QUEUED', WANT_PRIMARY.map((id) => m4.classification.find((r) => r.intentId === id).class), WANT_PRIMARY.map(() => 'ALREADY_QUEUED'))
expect('apply 뒤 재계산 — 다음 primary 는 fallback 부터', m4.selection.primary.map((s) => s.intentId).slice(0, 3), WANT_FALLBACK)

// ── ⑦ 입력 하나하나 ─────────────────────────────────────────
console.log('⑦ manifest 가 읽은 입력이 하나라도 바뀌면 STALE_INPUT')
{
  const fxA = fresh()
  const mA = await build(fxA)
  const slug = mA.queueRows[0].slug
  const artFile = path.join(fxA.repo, 'src/content/magazine/articles.ts')
  fs.writeFileSync(artFile, fs.readFileSync(artFile, 'utf8').replace('"live-article":', `"${slug}": { "title": "등록됨", "cluster": "daily", "publishedAt": "2026-10-07", "body": [] },\n  "live-article":`))
  const pre = bytesOf(fxA)
  const r = await apply(mA, fxA)
  expect('manifest 뒤 같은 slug 가 articles.ts 에 등록 → STALE_INPUT(product.articles)', [r.code, r.stale], ['STALE_INPUT', ['product.articles']])
  expect('그때 쓰기 0', JSON.stringify(bytesOf(fxA)), JSON.stringify(pre))
}
const touch = {
  'research.canonical': (f) => fs.appendFileSync(path.join(f.research, 'g4-intents-canonical.jsonl'), '\n'),
  'research.automation': (f) => fs.appendFileSync(path.join(f.research, 'g4-automation-2026-09-23.jsonl'), '\n'),
  'research.rebaseline': (f) => fs.appendFileSync(path.join(f.research, 'g4-rebaseline-2026-09-23.jsonl'), '\n'),
  'research.buildIntents': (f) => fs.appendFileSync(path.join(f.research, 'contract/build/current/intents.jsonl'), '\n'),
  'research.buildEdges': (f) => fs.appendFileSync(path.join(f.research, 'contract/build/current/edges.jsonl'), '\n'),
  'research.buildMappings': (f) => fs.appendFileSync(path.join(f.research, 'contract/build/current/mappings.jsonl'), '\n'),
  'research.buildManifest': (f) => fs.appendFileSync(path.join(f.research, 'contract/build/current/manifest.json'), '\n'),
  'research.slugModule': (f) => fs.appendFileSync(path.join(f.research, 'contract/m3-slug.mjs'), '\n'),
  'research.pipelineModule': (f) => fs.appendFileSync(path.join(f.research, 'contract/m3-pipeline.mjs'), '\n'),
  'research.productModule': (f) => fs.appendFileSync(path.join(f.research, 'contract/m3-product.mjs'), '\n'),
  'admission.slugManifest': (f) => fs.appendFileSync(path.join(f.research, 'contract/m3-slug-manifest.json'), '\n'),
  'admission.ledger': (f) => fs.writeFileSync(path.join(f.research, 'contract/m3-state.jsonl'), ''),
  'product.articles': (f) => fs.appendFileSync(path.join(f.repo, 'src/content/magazine/articles.ts'), '\n'),
  'product.queue': (f) => fs.appendFileSync(path.join(f.repo, 'drafts/magazine/topic-queue.ts'), '\n'),
  'product.types': (f) => fs.appendFileSync(path.join(f.repo, 'src/content/magazine/types.ts'), '\n'),
  'product.graphBundle': (f) => fs.appendFileSync(path.join(f.repo, 'src/content/magazine/graph/g-fixture-000000.ts'), '\n'),
  'product.draftDirs': (f) => fs.mkdirSync(path.join(f.repo, 'drafts/magazine/new-draft-dir')),
}
const recorded = Object.entries(m.inputs).flatMap(([g, o]) => Object.keys(o).map((k) => `${g}.${k}`)).sort()
expect('시험이 manifest 입력 전부를 덮는다', Object.keys(touch).sort(), recorded)
for (const [key, mutate] of Object.entries(touch)) {
  const f = fresh()
  const mf = await build(f)
  mutate(f)
  const pre = bytesOf(f)
  const r = await apply(mf, f)
  expect(`${key} 변경 → STALE_INPUT · 쓰기 0`, [r.code, r.stale, JSON.stringify(bytesOf(f)) === JSON.stringify(pre)], ['STALE_INPUT', [key], true])
}

// ── ⑧ 정본 장부 계약 ────────────────────────────────────────
console.log('⑧ 편입 장부는 정본 m3-pipeline 계약으로만 쓴다')
const ledgerCase = async (name, rowsText, wantCode) => {
  const f = fresh()
  fs.writeFileSync(path.join(f.research, 'contract/m3-state.jsonl'), rowsText)
  const mf = await build(f)
  const pre = bytesOf(f)
  const r = await apply(mf, f)
  expect(`${name} → ${wantCode} · 쓰기 0`, [r.code, JSON.stringify(bytesOf(f)) === JSON.stringify(pre)], [wantCode, true])
}
const lrow = (o) => `${JSON.stringify({ schemaVersion: 'm3ledger/2', event: 'ADMITTED', intentId: 'I-X-01', slug: 'x-slug', at: '2026-10-01T00:00:00+09:00', ...o })}\n`
await ledgerCase('같은 사건이 두 줄인 장부', lrow({}) + lrow({}), 'LEDGER_INVALID')
await ledgerCase('ADMITTED 없이 REGISTERED 가 먼저 온 장부', lrow({ event: 'REGISTERED' }), 'LEDGER_INVALID')
await ledgerCase('같은 slug 에 다른 intent 가 묶인 장부', lrow({}) + lrow({ intentId: 'I-X-02', event: 'DRAFT_PASSED' }), 'LEDGER_INVALID')
await ledgerCase('편입할 intent 가 장부에서 다른 slug 에 묶여 있다 (1:1)', lrow({ intentId: 'I-F-41', slug: 'other-slug' }), 'ADMISSION_REJECTED')

// ── ⑨ 판정 시각 ─────────────────────────────────────────────
console.log('⑨ 판정 시각은 정확한 KST 시각')
{
  const f = fresh()
  const cls = async (at) => (await build(f, at)).classification.find((r) => r.intentId === 'I-F-52').class
  expect('10:30 공개 글 — 같은 날 10:29:59 는 SCHEDULED', await cls('2026-10-07T10:29:59+09:00'), 'SCHEDULED')
  expect('10:30 공개 글 — 같은 날 10:30:00 은 LIVE', await cls('2026-10-07T10:30:00+09:00'), 'LIVE')
  let e1 = null
  try { await build(f, '2026-10-07') } catch (e) { e1 = e.message.slice(0, 9) }
  expect('날짜만 주면 판정하지 않는다', e1, '판정 시각은 YY'.slice(0, 9))
  const asof = spawnSync('node', [CLI, '--research', f.research, '--repo', f.repo, '--asof', '2026-10-07'], { encoding: 'utf8' })
  expect('CLI --asof 거부', asof.status, 2)
}

// ── ⑩ 실제 자식 프로세스 ────────────────────────────────────
console.log('⑩ 동시 apply · SIGKILL 급사 — 실제 자식 프로세스')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(file, ms = 15000) {
  const until = Date.now() + ms
  while (!fs.existsSync(file)) { if (Date.now() > until) return false; await sleep(20) }
  return true
}
const testEnv = (gate, stage) => ({ ...process.env, SORAN_MAGAZINE_TEST_MODE: '1', G8_TEST_GATE: gate, G8_TEST_PAUSE_AT: stage })
const applyArgs = (mf, f, hash) => [CLI, '--apply', '--manifest', mf, '--confirm-hash', hash, '--queue-root', f.repo, '--admission-root', f.research]
const exitOf = (child) => new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })))
const saveManifest = (f, mm, name = 'manifest.json') => { const p = path.join(f.dir, name); fs.writeFileSync(p, JSON.stringify(mm)); return p }
const stdoutOf = (child) => { let s = ''; child.stdout.on('data', (d) => { s += d }); return () => s }

for (const stage of ['after:queue', 'after:slugManifest']) {
  const f = fresh()
  const mf = await build(f)
  const mPath = saveManifest(f, mf)
  const pre = bytesOf(f)
  const gate = path.join(f.dir, `gate-${stage.replace(':', '-')}`)
  const child = spawn('node', applyArgs(mPath, f, mf.hash), { env: testEnv(gate, stage), stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = exitOf(child)
  const reached = await waitFor(`${gate}.reached`)
  child.kill('SIGKILL')
  const ex = await exited
  const mid = bytesOf(f)
  const changed = Object.keys(pre).filter((k) => pre[k] !== mid[k])
  expect(`SIGKILL(${stage}) — 실제로 반쪽 상태가 생겼다 (죽은 시험 아님)`, [reached, ex.signal, changed.length > 0 && changed.length < 3], [true, 'SIGKILL', true])
  const v1 = spawnSync('node', [CLI, '--verify', '--queue-root', f.repo, '--admission-root', f.research], { encoding: 'utf8' })
  expect(`SIGKILL(${stage}) — --verify 가 반쪽 상태를 잡는다`, [v1.status, v1.stdout.includes('PENDING_JOURNAL')], [1, true])
  const re = spawnSync('node', applyArgs(mPath, f, mf.hash), { encoding: 'utf8' })
  let rj = {}
  try { rj = JSON.parse(re.stdout) } catch { rj = { code: `출력 없음 ${re.stderr.slice(0, 120)}` } }
  expect(`SIGKILL(${stage}) 뒤 다음 apply — journal 로 되돌리고 완주`, [re.status, rj.code, rj.recovered?.ok ?? null], [0, 'APPLIED', true])
  const fin = bytesOf(f)
  expect(`SIGKILL(${stage}) 뒤 — 큐 7 · 장부 5 · slug 5 (중복·반쪽 0)`,
    [parseQueueSource(fin.queue).length, ledgerRows(fin.ledger).length, Object.keys(JSON.parse(fin.slugs).slugs).length], [7, 5, 5])
  const v2 = spawnSync('node', [CLI, '--verify', '--queue-root', f.repo, '--admission-root', f.research], { encoding: 'utf8' })
  expect(`SIGKILL(${stage}) 뒤 — --verify PASS · journal 0`, [v2.status, fs.existsSync(path.join(f.research, lib.JOURNAL_FILE))], [0, false])
}

{
  const f = fresh()
  const mA = await build(f, '2026-10-06T09:00:00+09:00')
  const mB = await build(f, '2026-10-06T09:01:00+09:00')
  expect('두 manifest 는 서로 다르다', mA.hash !== mB.hash, true)
  const pA = saveManifest(f, mA, 'a.json')
  const pB = saveManifest(f, mB, 'b.json')
  const pre = bytesOf(f)
  const gate = path.join(f.dir, 'gate-race')
  const childA = spawn('node', applyArgs(pA, f, mA.hash), { env: testEnv(gate, 'locked:ready'), stdio: ['ignore', 'pipe', 'pipe'] })
  const outA = stdoutOf(childA)
  const exitA = exitOf(childA)
  const reachedA = await waitFor(`${gate}.reached`)
  const resB = spawnSync('node', applyArgs(pB, f, mB.hash), { encoding: 'utf8' })
  let jB = {}
  try { jB = JSON.parse(resB.stdout) } catch { jB = { code: `출력 없음 ${resB.stderr.slice(0, 120)}` } }
  const midB = bytesOf(f)
  fs.writeFileSync(`${gate}.go`, '')
  const exA = await exitA
  let jA = {}
  try { jA = JSON.parse(outA()) } catch { jA = { code: '출력 없음' } }
  const fin = bytesOf(f)
  const finalHashes = [...new Set(parseQueueSource(fin.queue).filter((r) => r.g8ManifestHash).map((r) => r.g8ManifestHash))]
  expect('동시 apply — A 가 잠금을 쥔 동안 B 는 LOCKED · 쓰기 0', [reachedA, resB.status, jB.code, JSON.stringify(midB) === JSON.stringify(pre)], [true, 1, 'LOCKED', true])
  expect('동시 apply — A 는 완주', [exA.code, jA.code], [0, 'APPLIED'])
  const appliedHashes = [jA, jB].filter((j) => j.code === 'APPLIED').map((j) => j.hash)
  expect('lost update 0 — APPLIED 라고 말한 쪽의 행이 전부 남는다', finalHashes.sort(), appliedHashes.sort())
  expect('동시 apply 뒤 — 큐 7 · 장부 5 · 대조 PASS', [parseQueueSource(fin.queue).length, ledgerRows(fin.ledger).length,
    lib.verifyConsistency({ queueSource: fin.queue, ledgerSource: fin.ledger, slugManifestSource: fin.slugs }).ok], [7, 5, true])
}
{
  const f = fresh()
  const mf = await build(f)
  const mPath = saveManifest(f, mf)
  const r = spawnSync('node', applyArgs(mPath, f, mf.hash), { encoding: 'utf8', env: { ...process.env, SORAN_MAGAZINE_TEST_MODE: '', G8_TEST_PAUSE_AT: 'locked:ready', G8_TEST_GATE: path.join(f.dir, 'g') } })
  expect('시험 정지점은 시험 모드 밖에서 apply 를 거부한다', [r.status, fs.existsSync(path.join(f.research, 'contract/m3-state.jsonl'))], [2, false])
}

// ── CLI 거부 경로 ───────────────────────────────────────────
{
  const f = fresh()
  const mf = await build(f)
  const mPath = saveManifest(f, mf)
  const noHash = spawnSync('node', [CLI, '--apply', '--manifest', mPath, '--queue-root', f.repo, '--admission-root', f.research], { encoding: 'utf8' })
  expect('--confirm-hash 없이 apply 거부', noHash.status, 2)
  const oldFlag = spawnSync('node', [CLI, '--apply', '--manifest', mPath, '--confirm-hash', mf.hash, '--queue-root', f.repo, '--graph-root', f.research], { encoding: 'utf8' })
  expect('옛 --graph-root 거부 (편입 장부 루트와 제품 graph 를 섞지 않는다)', oldFlag.status, 2)
  const runtimeDir = path.join(f.dir, 'soransoran-magazine-runtime')
  fs.cpSync(f.repo, runtimeDir, { recursive: true })
  const toRuntime = spawnSync('node', applyArgs(mPath, { repo: runtimeDir, research: f.research }, mf.hash), { encoding: 'utf8' })
  expect('운영 runtime 경로 apply 거부', [toRuntime.status, fs.readFileSync(path.join(runtimeDir, 'drafts/magazine/topic-queue.ts'), 'utf8') === fs.readFileSync(path.join(f.repo, 'drafts/magazine/topic-queue.ts'), 'utf8')], [2, true])
}

// ── ⑫ 빈 manifest 급사 복구 ─────────────────────────────────
console.log('⑫ 후보 0건 manifest 도 잠금 안에서 앞선 급사를 먼저 되돌린다')
const emptyOf = (mm) => {
  const e = { ...mm, queueRows: [], admissionRows: [], fallbackRows: [], selection: { primary: [], fallback: [], excluded: [] } }
  e.hash = lib.hashManifest(e)
  return e
}
{
  const f = fresh()
  const mf = await build(f)
  const mPath = saveManifest(f, mf)
  const pre = bytesOf(f)
  const gate = path.join(f.dir, 'gate-empty')
  const child = spawn('node', applyArgs(mPath, f, mf.hash), { env: testEnv(gate, 'after:queue'), stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = exitOf(child)
  const reached = await waitFor(`${gate}.reached`)
  child.kill('SIGKILL')
  const ex = await exited
  const mid = bytesOf(f)
  expect('빈 manifest 반례 — 실제 SIGKILL 로 반쪽 상태가 생겼다', [reached, ex.signal, mid.queue !== pre.queue, mid.ledger === pre.ledger,
    fs.existsSync(path.join(f.research, lib.JOURNAL_FILE))], [true, 'SIGKILL', true, true, true])
  const e = emptyOf(mf)
  const ePath = saveManifest(f, e, 'empty.json')
  const r = spawnSync('node', applyArgs(ePath, f, e.hash), { encoding: 'utf8' })
  let j = {}
  try { j = JSON.parse(r.stdout) } catch { j = { code: `출력 없음 ${r.stderr.slice(0, 120)}` } }
  expect('queueRows=[] apply — NOTHING_TO_APPLY 이면서 recovered.ok=true', [r.status, j.code, j.recovered?.ok ?? null], [0, 'NOTHING_TO_APPLY', true])
  expect('queueRows=[] apply 뒤 — 세 파일 원본 바이트 · journal 0', [JSON.stringify(bytesOf(f)) === JSON.stringify(pre), fs.existsSync(path.join(f.research, lib.JOURNAL_FILE))], [true, false])
  const again = await apply(e, f)
  expect('journal 이 없으면 빈 manifest 는 아무것도 하지 않는다', [again.code, again.recovered], ['NOTHING_TO_APPLY', null])
}

// ── ⑬ topic-queue 공용 writer 잠금 ──────────────────────────
console.log('⑬ G8 apply 대 M-AUTO 등록 — 같은 큐 writer 잠금 (실제 자식 프로세스)')
const qlock = await import(pathToFileURL(path.join(path.dirname(LIB), 'magazine-queue-lock.mjs')).href)
const { classifyFailure } = await import(pathToFileURL(path.join(HERE, 'lib/magazine-failure-kind.mjs')).href)
const REG = (() => {
  if (!process.env.G8_PROMOTER_LIB) return path.join(HERE, 'magazine-register.mjs')
  const copy = path.join(path.dirname(path.dirname(LIB)), 'magazine-register.mjs')
  if (!fs.existsSync(copy)) fs.copyFileSync(path.join(HERE, 'magazine-register.mjs'), copy)
  return copy
})()
/** M-AUTO 등록과 같은 함수(`applyWrite`) — queued-one(day 10)을 등록하고 큐에서 지운다 */
const regArgs = (f, arts) => ['--input-type=module', '-e', `const { applyWrite } = await import(${JSON.stringify(REG)}); const fs = await import('node:fs');
const r = applyWrite({ slug: 'queued-one', _internal: { draft: { literal: "{\\n  title: '등록 글',\\n  publishedAt: '',\\n}" }, norm: { date: '2026-10-08', publishAt: '2026-10-08T10:30:00+09:00' }, item: { day: 10 }, articlesSrc: fs.readFileSync(${JSON.stringify(arts)}, 'utf8') } },
  { articlesPath: ${JSON.stringify(arts)}, queuePath: ${JSON.stringify(path.join(f.repo, 'drafts/magazine/topic-queue.ts'))} })
console.log(JSON.stringify(r))`]
const regArticles = (f) => { const p = path.join(f.dir, 'register-articles.ts'); fs.writeFileSync(p, 'export const R = {\n} satisfies Record<string, MagazineArticleBody>\n'); return p }
const hasQueued = (text) => parseQueueSource(text).some((r) => r.slug === 'queued-one')
const parsesOk = (text) => { try { return Array.isArray(parseQueueSource(text)) } catch { return false } }

{
  // A: G8 이 큐 잠금을 쥔 채 멈춘 사이 등록이 시도한다
  const f = fresh()
  const mf = await build(f)
  const mPath = saveManifest(f, mf)
  const arts = regArticles(f)
  const artsPre = fs.readFileSync(arts, 'utf8')
  const pre = bytesOf(f)
  const gate = path.join(f.dir, 'gate-g8-holds')
  const g8 = spawn('node', applyArgs(mPath, f, mf.hash), { env: testEnv(gate, 'locked:ready'), stdio: ['ignore', 'pipe', 'pipe'] })
  const outG8 = stdoutOf(g8)
  const exitG8 = exitOf(g8)
  const reached = await waitFor(`${gate}.reached`)
  const queueFile = filesOf(f).queue
  const restoreWhileHeld = qlock.restoreQueueSnapshot({ path: queueFile, existed: true, bytes: Buffer.from(pre.queue), queueCas: { day: 10 } }, { waitMs: 0 })
  const reg = spawnSync('node', regArgs(f, arts), { encoding: 'utf8', timeout: 20000 })
  let jReg = {}
  try { jReg = JSON.parse(reg.stdout) } catch { jReg = { ok: null, code: `출력 없음 ${reg.stderr.slice(0, 120)}` } }
  const mid = bytesOf(f)
  fs.writeFileSync(`${gate}.go`, '')
  const exG8 = await exitG8
  let jG8 = {}
  try { jG8 = JSON.parse(outG8()) } catch { jG8 = { code: '출력 없음' } }
  const fin = bytesOf(f)
  expect('G8 이 큐 잠금을 쥔 동안 등록은 queue_writer_locked · 쓰기 0', [reached, jReg.ok, jReg.code, mid.queue === pre.queue, fs.readFileSync(arts, 'utf8') === artsPre],
    [true, false, qlock.QUEUE_LOCKED_CODE, true, true])
  expect('G8 이 큐 잠금을 쥔 동안 스냅샷 원복도 덮지 않는다 (queue_writer_locked)', [restoreWhileHeld.restored, restoreWhileHeld.failure?.errorName], [false, qlock.QUEUE_LOCKED_CODE])
  expect('그 뒤 G8 은 완주 (교착 0)', [exG8.code, jG8.code], [0, 'APPLIED'])
  expect('lost update 0 — 등록이 실패라 했으니 queued-one 이 남고 G8 행 5 가 있다', [hasQueued(fin.queue), parseQueueSource(fin.queue).filter((r) => r.g8ManifestHash === mf.hash).length], [true, 5])
  expect('최종 큐 파싱 PASS (7행)', [parsesOk(fin.queue), parseQueueSource(fin.queue).length], [true, 7])
  expect('잠금 파일이 남지 않는다', fs.existsSync(qlock.queueLockFile(queueFile)), false)
  expect('등록의 잠금 실패는 INFRA — 원고 실패 횟수에 넣지 않는다', classifyFailure({ message: `REGISTER_BLOCKED: ${jReg.why ?? ''}`, sent: false }).kind, 'INFRA')
}
{
  // B: 등록이 큐 잠금을 쥔 채(큐를 읽기 직전) 멈춘 사이 G8 apply 가 시도한다
  const f = fresh()
  const mf = await build(f)
  const mPath = saveManifest(f, mf)
  const arts = regArticles(f)
  const pre = bytesOf(f)
  const gate = path.join(f.dir, 'gate-reg-holds')
  const reg = spawn('node', regArgs(f, arts), { env: { ...process.env, SORAN_MAGAZINE_TEST_MODE: '1', SORAN_QUEUE_TEST_GATE: gate, SORAN_QUEUE_TEST_PAUSE_AT: 'register:locked' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const outReg = stdoutOf(reg)
  const exitReg = exitOf(reg)
  const reached = await waitFor(`${gate}.reached`)
  const g8 = spawnSync('node', applyArgs(mPath, f, mf.hash), { encoding: 'utf8', timeout: 20000 })
  let jG8 = {}
  try { jG8 = JSON.parse(g8.stdout) } catch { jG8 = { code: `출력 없음 ${g8.stderr.slice(0, 120)}` } }
  const mid = bytesOf(f)
  fs.writeFileSync(`${gate}.go`, '')
  const exReg = await exitReg
  let jReg = {}
  try { jReg = JSON.parse(outReg()) } catch { jReg = { ok: null } }
  const fin = bytesOf(f)
  expect('등록이 큐 잠금을 쥔 동안 G8 apply 는 LOCKED · 세 파일 쓰기 0', [reached, g8.status, jG8.code, JSON.stringify(mid) === JSON.stringify(pre)], [true, 1, 'LOCKED', true])
  expect('그 뒤 등록은 완주 (교착 0)', [exReg.code, jReg.ok], [0, true])
  expect('lost update 0 — 등록이 지운 queued-one 은 없고 G8 행도 없다', [hasQueued(fin.queue), parseQueueSource(fin.queue).some((r) => r.g8ManifestHash)], [false, false])
  expect('최종 큐 파싱 PASS (1행) · 편입 장부 무변경', [parsesOk(fin.queue), parseQueueSource(fin.queue).length, fin.slugs === pre.slugs, fin.ledger === pre.ledger], [true, 1, true, true])
}
{
  // C: auto-register 스냅샷 원복 — 이 회차 등록의 결과일 때만 되돌린다
  const f = fresh()
  const queueFile = filesOf(f).queue
  const S = fs.readFileSync(queueFile)
  const entry = { path: queueFile, existed: true, bytes: S, queueCas: { day: 10 } }
  expect('원복 — 큐가 스냅샷 그대로면 할 일 없음', qlock.restoreQueueSnapshot(entry), { restored: false, failure: null })
  fs.writeFileSync(queueFile, qlock.removeQueueDay(S.toString('utf8'), 10))
  expect('원복 — 이 회차 등록이 지운 것이면 스냅샷으로 되돌린다', [qlock.restoreQueueSnapshot(entry).restored, fs.readFileSync(queueFile).equals(S)], [true, true])
  fs.writeFileSync(queueFile, String(S).replace(/\n$/, '\n// 부분 쓰기 잔여 (시험)\n'))
  expect('원복 — register 원복 실패 잔여(새 행 없음)도 되돌린다 (m3a 반례9-C 와 같은 상황)', [qlock.restoreQueueSnapshot(entry).restored, fs.readFileSync(queueFile).equals(S)], [true, true])
  fs.writeFileSync(queueFile, String(S).slice(0, 200))
  const broken = fs.readFileSync(queueFile, 'utf8')
  const rb = qlock.restoreQueueSnapshot(entry)
  expect('원복 — 지금 큐를 읽을 수 없으면 덮지 않는다', [rb.restored, rb.failure?.errorName, fs.readFileSync(queueFile, 'utf8') === broken], [false, qlock.QUEUE_CHANGED_CODE, true])
  fs.writeFileSync(queueFile, S)
  const mf = await build(f)
  expect('원복 대조용 G8 apply', (await apply(mf, f)).code, 'APPLIED')
  const withG8 = fs.readFileSync(queueFile, 'utf8')
  const r1 = qlock.restoreQueueSnapshot(entry)
  expect('원복 — 회차 뒤 G8 이 넣은 행을 옛 바이트로 덮지 않는다', [r1.restored, r1.failure?.errorName, fs.readFileSync(queueFile, 'utf8') === withG8], [false, qlock.QUEUE_CHANGED_CODE, true])
  const both = qlock.removeQueueDay(withG8, 10)
  fs.writeFileSync(queueFile, both)
  const r2 = qlock.restoreQueueSnapshot(entry)
  expect('원복 — 등록 + G8 이 섞였으면 덮지 않는다', [r2.restored, r2.failure?.errorName, fs.readFileSync(queueFile, 'utf8') === both], [false, qlock.QUEUE_CHANGED_CODE, true])
}

{
  // D: 서로 다른 큐(worktree 두 개)가 같은 편입 장부를 쓴다 — 큐 잠금은 달라도 편입 장부 잠금이 막는다
  const f = fresh()
  const repo2 = path.join(f.dir, 'repo2')
  fs.cpSync(f.repo, repo2, { recursive: true })
  const f2 = { ...f, repo: repo2 }
  const mA = await build(f, '2026-10-06T09:00:00+09:00')
  const mB = await build(f2, '2026-10-06T09:01:00+09:00')
  const pA = saveManifest(f, mA, 'a.json')
  const pB = saveManifest(f, mB, 'b.json')
  const pre2 = bytesOf(f2)
  const gate = path.join(f.dir, 'gate-shared-admission')
  const a = spawn('node', applyArgs(pA, f, mA.hash), { env: testEnv(gate, 'locked:ready'), stdio: ['ignore', 'pipe', 'pipe'] })
  const outA = stdoutOf(a)
  const exitA = exitOf(a)
  const reached = await waitFor(`${gate}.reached`)
  const b = spawnSync('node', applyArgs(pB, f2, mB.hash), { encoding: 'utf8', timeout: 20000 })
  let jB = {}
  try { jB = JSON.parse(b.stdout) } catch { jB = { code: `출력 없음 ${b.stderr.slice(0, 120)}` } }
  const mid2 = bytesOf(f2)
  fs.writeFileSync(`${gate}.go`, '')
  const exA = await exitA
  let jA = {}
  try { jA = JSON.parse(outA()) } catch { jA = { code: '출력 없음' } }
  const finLedger = ledgerRows(fs.readFileSync(filesOf(f).ledger, 'utf8'))
  expect('같은 편입 장부 · 다른 큐 — A 가 쥔 동안 B 는 LOCKED · 쓰기 0', [reached, b.status, jB.code, JSON.stringify(mid2) === JSON.stringify(pre2)], [true, 1, 'LOCKED', true])
  expect('같은 편입 장부 · 다른 큐 — A 완주 · 장부는 A 의 사건 5 (lost update 0)', [exA.code, jA.code, finLedger.length, [...new Set(finLedger.map((r) => r.at))]], [0, 'APPLIED', 5, [mA.at]])
}

// ── ⑭ journal 신원 ──────────────────────────────────────────
console.log('⑭ journal 신원이 어긋나면 어떤 파일도 쓰거나 지우지 않는다')
const identityCase = async (name, makeFiles, schema = lib.JOURNAL_SCHEMA) => {
  const f = fresh()
  const mf = await build(f)
  const victim = path.join(f.dir, 'victim.txt')
  fs.writeFileSync(victim, '저장소 밖 파일 — 지우면 안 된다')
  const fl = filesOf(f)
  const real = { queue: fl.queue, slugs: fl.slugs, ledger: fl.ledger }
  const journal = { schema, manifestHash: mf.hash, pid: 1, files: makeFiles(real, victim) }
  const jPath = path.join(f.research, lib.JOURNAL_FILE)
  fs.writeFileSync(jPath, JSON.stringify(journal))
  const pre = { research: snapshot(f.research), repo: snapshot(f.repo), victim: fs.readFileSync(victim, 'utf8') }
  const r = await apply(mf, f).catch((e) => ({ code: `THREW ${e.message}` }))
  const post = { research: snapshot(f.research), repo: snapshot(f.repo), victim: fs.existsSync(victim) ? fs.readFileSync(victim, 'utf8') : null }
  expect(`${name} → RECOVERY_IDENTITY · 쓰기·삭제 0 (journal 포함)`, [r.code, JSON.stringify(post) === JSON.stringify(pre)], ['RECOVERY_IDENTITY', true])
}
const sha = (p) => lib.sha256(fs.readFileSync(p, 'utf8'))
/**
 * 🔴 실제 세 파일 항목은 **CAS 를 통과하도록** 만든다(before = 지금 바이트 · afterSha = 지금 해시).
 *    그래야 신원 검증이 없을 때 위조 항목(외부 파일 삭제 등)이 실제로 실행된다 — 시험이 CAS 뒤에 숨지 않는다.
 */
const ok3 = (real) => [real.queue, real.slugs, real.ledger].map((p) => {
  const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null
  return { path: p, before: cur, afterSha: cur === null ? 'ABSENT' : lib.sha256(cur) }
})
await identityCase('외부 경로 (afterSha 까지 맞춘 위조)', (real, v) => [{ path: v, before: null, afterSha: sha(v) }, ...ok3(real).slice(1)])
await identityCase('상대 경로', (real) => [{ path: 'contract/m3-state.jsonl', before: null, afterSha: 'ABSENT' }, ...ok3(real).slice(0, 2)])
await identityCase('누락 (2개)', (real) => ok3(real).slice(0, 2))
await identityCase('추가 (4개)', (real, v) => [...ok3(real), { path: v, before: null, afterSha: sha(v) }])
await identityCase('중복 경로', (real) => [ok3(real)[0], ok3(real)[0], ok3(real)[2]])
await identityCase('잘못된 schema', (real) => ok3(real), 'g8-journal/0')
await identityCase('before 가 원문도 null 도 아니다', (real) => ok3(real).map((x, i) => (i ? x : { ...x, before: 7 })))
{
  const f = fresh()
  const mf = await build(f)
  const mPath = saveManifest(f, mf)
  fs.writeFileSync(path.join(f.research, lib.JOURNAL_FILE), JSON.stringify({ schema: 'nope', files: [] }))
  const r = spawnSync('node', applyArgs(mPath, f, mf.hash), { encoding: 'utf8' })
  let j = {}
  try { j = JSON.parse(r.stdout) } catch { j = { code: '출력 없음' } }
  expect('CLI 도 RECOVERY_IDENTITY 로 멈춘다 (exit 1)', [r.status, j.code], [1, 'RECOVERY_IDENTITY'])
}

// ── ⑪ 실제 연구 정본 ────────────────────────────────────────
const REAL_RESEARCH = path.resolve(REPO, '..', 'soransoran-mgraph-research')
if (fs.existsSync(path.join(REAL_RESEARCH, lib.RESEARCH_FILES.canonical))) {
  console.log('⑪ 실제 연구 정본 (읽기만)')
  for (const f of ['m3-pipeline.mjs', 'm3-product.mjs']) {
    expect(`fixture ${f} = 연구 정본 바이트`, lib.sha256(fs.readFileSync(path.join(PIPELINE_FIXTURE, f), 'utf8')), lib.sha256(fs.readFileSync(path.join(REAL_RESEARCH, 'contract', f), 'utf8')))
  }
  const real = lib.classifyIntents(await lib.loadInputs({ researchDir: REAL_RESEARCH, repoDir: REPO }), { at: '2026-10-06T09:00:00+09:00' })
  const cls = Object.fromEntries(real.rows.map((r) => [r.intentId, r.class]))
  expect('실제 I-T6-09 (ANSWERS_PARTIAL) → EXTEND_EXISTING', cls['I-T6-09'], 'EXTEND_EXISTING')
  expect('실제 I-T1-26 (ANSWERS_WITH_SCOPE_EXPANSION) → EXTEND_EXISTING', cls['I-T1-26'], 'EXTEND_EXISTING')
} else {
  console.log('⑪ 실제 연구 정본 — SKIP (연구 디렉터리가 없다 · fixture ①이 같은 반례를 본다)')
}

for (const d of fixtures) fs.rmSync(d.dir, { recursive: true, force: true })
finish()
process.exitCode = fail ? 1 : 0

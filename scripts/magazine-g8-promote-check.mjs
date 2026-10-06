#!/usr/bin/env node
/**
 * G8 편입기 검사 — 임시 fixture 에서만 돈다. 운영 파일·연구 정본을 읽지도 쓰지도 않는다.
 *
 * 무엇을 보나
 *   ① 모든 의도가 정확히 한 상태로 분류된다 (fixture 의도마다 기대 상태가 있다)
 *   ② HOLD·REJECT·INCOMPLETE·영토 미결정·중복은 후보가 되지 못한다
 *   ③ 필수 필드·제목·시리즈 선행·publishWindow 계약
 *   ④ primary 5 + fallback 3 의 결정적 순서 · 입력 순서를 뒤집어도 같은 manifest
 *   ⑤ CLI dry-run 이 입력을 한 바이트도 바꾸지 않는다 · 두 번 돌려도 같은 출력
 *   ⑥ apply — 두 번 실행해도 중복 0 · 중간 실패는 세 파일 원복 · 큐/그래프 어긋남 탐지
 *
 * 🔴 `G8_PROMOTER_LIB` 는 변이 시험(`magazine-g8-promote-mutation.mjs`)이 바꾼 lib 를 넣는 자리다.
 *    CLI 는 이 변수를 읽지 않는다.
 *
 * 사용: node scripts/magazine-g8-promote-check.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseQueueSource } from './lib/magazine-load.mjs'
import { isAutoLaneEligible } from './lib/magazine-validation-profile.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..')
const LIB = process.env.G8_PROMOTER_LIB ?? path.join(HERE, 'lib/magazine-g8-promoter.mjs')
const lib = await import(pathToFileURL(LIB).href)
const CLI = path.join(HERE, 'magazine-g8-promote.mjs')
const ASOF = '2026-10-06'

let pass = 0
let fail = 0
function expect(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) pass++
  else { fail++; console.log(`  ❌ ${name}\n     기대 ${JSON.stringify(want)}\n     실제 ${JSON.stringify(got)}`) }
}
function attempt(name, fn) {
  try { fn() } catch (e) { fail++; console.log(`  ❌ ${name} — 예외: ${e.message}`) }
}

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

process.on('uncaughtException', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e.message}`); console.log(`\n🔴 G8 편입기 검사 ${pass}/${pass + fail}\n`); process.exit(1) })
process.on('unhandledRejection', (e) => { fail++; console.log(`  ❌ 예외로 중단 — ${e?.message ?? e}`); console.log(`\n🔴 G8 편입기 검사 ${pass}/${pass + fail}\n`); process.exit(1) })

const build = async (fx, asOf = ASOF) => lib.buildManifest(await lib.loadInputs({ researchDir: fx.research, repoDir: fx.repo }), { asOf })

// ── ① 분류 ──────────────────────────────────────────────────
console.log('\n① 의도마다 정확히 한 상태')
const fx = makeFixture()
const m = await build(fx)
const byId = Object.fromEntries(m.classification.map((r) => [r.intentId, r]))
for (const x of INTENTS) expect(`${x.id} ${x.q} → ${x.expectClass}`, byId[x.id]?.class, x.expectClass)
expect('분류 합계 = 의도 수', Object.values(lib.CLASSES.map((c) => m.counts[c])).reduce((a, b) => a + b, 0), INTENTS.length)
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
expect('graph 행 = primary (intentId·slug 짝)', m.graphRows.map((r) => [r.intentId, r.slug]), m.queueRows.map((r) => [r.intentId, r.slug]))
expect('COMMUNITY 관계는 추천 관계에 넣지 않는다', m.graphRows.every((r) => r.directRelations.every((d) => d.slot !== null)), true)
expect('primary day 는 기존 큐 최대 뒤', m.queueRows.map((r) => r.day), [13, 14, 15, 16, 17])
expect('fallback 은 day 를 받지 않는다', m.fallbackRows.map((r) => r.day), [null, null, null])

// ── ④ 결정적 순서 ───────────────────────────────────────────
console.log('④ primary 5 + fallback 3 의 결정적 순서')
expect('primary 순서', m.selection.primary.map((s) => s.intentId), WANT_PRIMARY)
expect('fallback 순서', m.selection.fallback.map((s) => s.intentId), WANT_FALLBACK)
const m2 = await build(fx)
expect('두 번 계산 — 바이트 동일', JSON.stringify(m2), JSON.stringify(m))
const fxRev = makeFixture({ reverse: true })
const mRev = await build(fxRev)
expect('입력 순서를 뒤집어도 같은 선정', [mRev.selection.primary, mRev.selection.fallback].map((l) => l.map((s) => s.intentId)), [WANT_PRIMARY, WANT_FALLBACK])
expect('입력 순서를 뒤집어도 같은 큐 행', JSON.stringify(mRev.queueRows), JSON.stringify(m.queueRows))
let threw = null
try { await build(makeFixture({ bundleCombined: 'other' })) } catch (e) { threw = e.message.split(' — ')[0] }
expect('연구 build 와 제품 번들이 다르면 만들지 않는다', threw, 'GRAPH_BUNDLE_MISMATCH')
threw = null
try { await build(makeFixture({ dropCanonical: true })) } catch (e) { threw = e.message.slice(0, 20) }
expect('연구 정본 의도 집합이 다르면 만들지 않는다', threw, '연구 정본의 의도 집합이 서로 다르다'.slice(0, 20))

// ── ⑤ CLI dry-run ───────────────────────────────────────────
console.log('⑤ CLI dry-run 은 아무것도 쓰지 않는다')
const before = { research: snapshot(fx.research), repo: snapshot(fx.repo) }
const run = () => execFileSync('node', [CLI, '--research', fx.research, '--repo', fx.repo, '--asof', ASOF, '--json'], { encoding: 'utf8', maxBuffer: 1e8 })
const out1 = run()
const out2 = run()
expect('CLI 두 번 — 출력 바이트 동일', out1 === out2, true)
expect('CLI 출력 = 라이브러리 manifest', JSON.parse(out1).hash, m.hash)
execFileSync('node', [CLI, '--research', fx.research, '--repo', fx.repo, '--asof', ASOF], { encoding: 'utf8' })
expect('dry-run 뒤 연구 입력 바이트·파일 목록 동일', snapshot(fx.research), before.research)
expect('dry-run 뒤 제품 입력 바이트·파일 목록 동일', snapshot(fx.repo), before.repo)
const outInside = spawnSync('node', [CLI, '--research', fx.research, '--repo', fx.repo, '--asof', ASOF, '--out', path.join(fx.repo, 'm.json')], { encoding: 'utf8' })
expect('--out 은 저장소 안을 거부한다', [outInside.status, fs.existsSync(path.join(fx.repo, 'm.json'))], [2, false])

// ── ⑥ apply ────────────────────────────────────────────────
console.log('⑥ apply — 멱등 · 원복 · 큐/그래프 동일 manifest')
const apRoot = { queueRoot: fx.repo, graphRoot: fx.research }
const files = {
  queue: path.join(fx.repo, 'drafts/magazine/topic-queue.ts'),
  slugs: path.join(fx.research, 'contract/m3-slug-manifest.json'),
  ledger: path.join(fx.research, 'contract/m3-state.jsonl'),
}
const bytes = () => Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null]))
const pristine = bytes()

for (const stage of ['after:queue', 'after:slugManifest', 'after:ledger']) {
  const r = lib.applyManifest({ manifest: m, ...apRoot, faultHook: (s) => { if (s === stage) throw new Error(`주입 실패 ${s}`) } })
  expect(`${stage} 에서 실패 → 세 파일 원복`, [r.code, r.restored, JSON.stringify(bytes()) === JSON.stringify(pristine)], ['ROLLED_BACK', true, true])
}
const corrupt = lib.applyManifest({ manifest: m, ...apRoot, faultHook: (s) => {
  if (s === 'after:ledger') fs.writeFileSync(files.ledger, fs.readFileSync(files.ledger, 'utf8').split('\n').slice(1).join('\n'))
} })
expect('그래프 장부가 반쪽이면 쓰기 뒤 대조가 잡고 원복한다', [corrupt.code, JSON.stringify(bytes()) === JSON.stringify(pristine)], ['ROLLED_BACK', true])

const tampered = { ...m, queueRows: m.queueRows.map((r, i) => (i ? r : { ...r, title: `${r.title}!` })) }
expect('본문이 해시와 다르면 쓰지 않는다', lib.applyManifest({ manifest: tampered, ...apRoot }).code, 'HASH_MISMATCH')

const first = lib.applyManifest({ manifest: m, ...apRoot })
expect('첫 apply', [first.ok, first.code, first.rows], [true, 'APPLIED', 5])
const afterFirst = bytes()
const second = lib.applyManifest({ manifest: m, ...apRoot })
expect('둘째 apply — 아무것도 쓰지 않는다', [second.ok, second.code], [true, 'ALREADY_APPLIED'])
expect('둘째 apply 뒤 세 파일 바이트 동일', JSON.stringify(bytes()), JSON.stringify(afterFirst))
const queueAfter = parseQueueSource(afterFirst.queue)
expect('큐 행 수 = 기존 2 + primary 5 (중복 0)', [queueAfter.length, new Set(queueAfter.map((r) => r.slug)).size], [7, 7])
expect('장부 ADMITTED = 5 (중복 0)', afterFirst.ledger.trim().split('\n').length, 5)
expect('기존 큐 행은 바이트 그대로', afterFirst.queue.includes(lib.renderQueueRow(parseQueueSource(pristine.queue)[0])), true)
const added = queueAfter.filter((r) => r.g8ManifestHash)
expect('새 큐 행이 manifest 해시를 단다', [...new Set(added.map((r) => r.g8ManifestHash))], [m.hash])
expect('새 큐 행은 M-AUTO 자동 레인 판정 통과', added.map((r) => isAutoLaneEligible(r).ok), added.map(() => true))
expect('영구 slug 표가 짝을 묶는다', Object.entries(JSON.parse(afterFirst.slugs).slugs).sort(), m.queueRows.map((r) => [r.intentId, r.slug]).sort())
attempt('apply 결과가 실제 TopicQueueItem 타입을 통과한다', () => {
  // 🔴 fixture 큐는 실제 topic-queue.ts 의 타입 머리를 그대로 쓴다 — 새 행이 tsc 를 통과해야 운영 apply 가 빌드를 깨지 않는다
  const tsconfig = path.join(fx.dir, 'tsconfig.json')
  fs.writeFileSync(tsconfig, JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, target: 'es2020',
    module: 'esnext', moduleResolution: 'bundler', baseUrl: REPO, paths: { '@/*': ['src/*'] } }, files: [files.queue] }))
  const tsc = spawnSync(path.join(REPO, 'node_modules/.bin/tsc'), ['-p', tsconfig], { encoding: 'utf8' })
  expect('tsc --noEmit (apply 된 fixture 큐)', [tsc.status, (tsc.stdout + tsc.stderr).trim().split('\n')[0] ?? ''], [0, ''])
})
const consistent = () => lib.verifyConsistency({ queueSource: fs.readFileSync(files.queue, 'utf8'), ledgerSource: fs.readFileSync(files.ledger, 'utf8'), slugManifestSource: fs.readFileSync(files.slugs, 'utf8') })
expect('apply 뒤 큐/그래프 대조 PASS', consistent().ok, true)
const verifyCli = spawnSync('node', [CLI, '--verify', '--queue-root', fx.repo, '--graph-root', fx.research], { encoding: 'utf8' })
expect('--verify CLI PASS', verifyCli.status, 0)

attempt('그래프만 남은 상태를 잡는다', () => {
  fs.writeFileSync(files.queue, pristine.queue)
  expect('큐 행을 지우면 GRAPH_WITHOUT_QUEUE', consistent().problems.some((p) => p.startsWith('GRAPH_WITHOUT_QUEUE')), true)
  expect('그 상태에서 apply 는 PARTIAL_STATE', lib.applyManifest({ manifest: m, ...apRoot }).code, 'PARTIAL_STATE')
  fs.writeFileSync(files.queue, afterFirst.queue)
})
attempt('큐만 남은 상태를 잡는다', () => {
  fs.writeFileSync(files.ledger, '')
  expect('장부 행을 지우면 QUEUE_WITHOUT_GRAPH', consistent().problems.some((p) => p.startsWith('QUEUE_WITHOUT_GRAPH')), true)
  fs.writeFileSync(files.ledger, afterFirst.ledger)
})
attempt('등록돼 큐에서 빠진 행은 정상이다', () => {
  const registeredSlug = m.queueRows[0].slug
  const rows = parseQueueSource(afterFirst.queue).filter((r) => r.slug !== registeredSlug)
  const header = afterFirst.queue.slice(0, afterFirst.queue.indexOf('export const TOPIC_QUEUE'))
  fs.writeFileSync(files.queue, `${header}export const TOPIC_QUEUE: TopicQueueItem[] = [\n${rows.map(lib.renderQueueRow).join('')}]\n`)
  const articles = fs.readFileSync(path.join(fx.repo, 'src/content/magazine/articles.ts'), 'utf8')
  const withReg = articles.replace('"live-article":', `"${registeredSlug}": { "title": "등록됨", "cluster": "daily", "publishedAt": "2026-10-10", "body": [] },\n  "live-article":`)
  fs.writeFileSync(path.join(fx.repo, 'src/content/magazine/articles.ts'), withReg)
  expect('등록된 글은 GRAPH_WITHOUT_QUEUE 가 아니다', lib.verifyConsistency({ queueSource: fs.readFileSync(files.queue, 'utf8'), articlesSource: withReg,
    ledgerSource: afterFirst.ledger, slugManifestSource: afterFirst.slugs }).ok, true)
  expect('등록 뒤 apply 재실행도 ALREADY_APPLIED', lib.applyManifest({ manifest: m, ...apRoot }).code, 'ALREADY_APPLIED')
  fs.writeFileSync(path.join(fx.repo, 'src/content/magazine/articles.ts'), articles)
  fs.writeFileSync(files.queue, afterFirst.queue)
})

const m4 = await build(fx)
expect('apply 뒤 재계산 — 편입분 ALREADY_QUEUED', WANT_PRIMARY.map((id) => m4.classification.find((r) => r.intentId === id).class), WANT_PRIMARY.map(() => 'ALREADY_QUEUED'))
expect('apply 뒤 재계산 — 다음 primary 는 fallback 부터', m4.selection.primary.map((s) => s.intentId).slice(0, 3), WANT_FALLBACK)

const fxStale = makeFixture()
const mStale = await build(fxStale)
fs.appendFileSync(path.join(fxStale.repo, 'drafts/magazine/topic-queue.ts'), '\n')
expect('manifest 뒤 큐가 바뀌면 쓰지 않는다', lib.applyManifest({ manifest: mStale, queueRoot: fxStale.repo, graphRoot: fxStale.research }).code, 'STALE_INPUT')

const fxCli = makeFixture()
const mCli = await build(fxCli)
const mFile = path.join(fxCli.dir, 'manifest.json')
fs.writeFileSync(mFile, JSON.stringify(mCli))
const noHash = spawnSync('node', [CLI, '--apply', '--manifest', mFile, '--queue-root', fxCli.repo, '--graph-root', fxCli.research], { encoding: 'utf8' })
expect('--confirm-hash 없이 apply 거부', noHash.status, 2)
const runtimeDir = path.join(fxCli.dir, 'soransoran-magazine-runtime')
fs.cpSync(fxCli.repo, runtimeDir, { recursive: true })
const toRuntime = spawnSync('node', [CLI, '--apply', '--manifest', mFile, '--confirm-hash', mCli.hash, '--queue-root', runtimeDir, '--graph-root', fxCli.research], { encoding: 'utf8' })
expect('운영 runtime 경로 apply 거부', [toRuntime.status, fs.readFileSync(path.join(runtimeDir, 'drafts/magazine/topic-queue.ts'), 'utf8') === fs.readFileSync(path.join(fxCli.repo, 'drafts/magazine/topic-queue.ts'), 'utf8')], [2, true])
const okCli = spawnSync('node', [CLI, '--apply', '--manifest', mFile, '--confirm-hash', mCli.hash, '--queue-root', fxCli.repo, '--graph-root', fxCli.research], { encoding: 'utf8' })
expect('CLI apply (fixture)', [okCli.status, JSON.parse(okCli.stdout).code], [0, 'APPLIED'])

for (const d of [fx, fxRev, fxStale, fxCli]) fs.rmSync(d.dir, { recursive: true, force: true })

console.log(`\n${fail ? '🔴' : '✅'} G8 편입기 검사 ${pass}/${pass + fail}\n`)
process.exitCode = fail ? 1 : 0

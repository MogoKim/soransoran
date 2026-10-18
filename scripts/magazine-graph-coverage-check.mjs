#!/usr/bin/env node

import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// 🔴 변이 하네스가 lib 사본을 주입한다: MGRAPH_COVERAGE_LIB (없으면 저장소 파일). 적재 실패는 검출이 아니다
const LIB = process.env.MGRAPH_COVERAGE_LIB ?? join(dirname(fileURLToPath(import.meta.url)), 'lib/magazine-graph-coverage.mjs')
let analyzeGraphCoverage, clusterActivationVerdict
try { ({ analyzeGraphCoverage, clusterActivationVerdict } = await import(pathToFileURL(LIB).href)) } catch (e) {
  console.log(`LOAD_ERROR ${e.message}`); process.exit(3)
}

let pass = 0
let fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`PASS ${name}`) }
  catch (error) { fail++; console.error(`FAIL ${name}: ${error?.stack ?? error}`) }
}
const article = (slug, cluster = 'sleep') => ({ slug, cluster })
const edge = (from, to, overrides = {}) => ({
  from, to, active: true, slot: 'DIRECT_NEXT', placement: 'FOOTER_NEXT', type: 'NEXT_QUESTION', ...overrides,
})
const analyze = ({ mappings = [], edges = [], publicSlugs = [], allSlugs = publicSlugs }) => analyzeGraphCoverage({
  publicArticles: publicSlugs.map((slug) => article(slug)),
  allArticles: allSlugs.map((slug) => article(slug)),
  graph: { graphVersion: 'g-test', mappings, edges },
})
const row = (report, slug = 'a') => report.rows.find((item) => item.slug === slug)

check('mapping이 없으면 UNMAPPED', () => assert.equal(row(analyze({ publicSlugs: ['a'] })).status, 'UNMAPPED'))
check('한 slug의 여러 intent를 정상 입력으로 합친다', () => {
  const report = analyze({
    publicSlugs: ['a', 'b'],
    mappings: [{ intent: 'i1', slug: 'a' }, { intent: 'i2', slug: 'a' }, { intent: 'i3', slug: 'b' }],
    edges: [edge('i2', 'i3')],
  })
  assert.equal(row(report).status, 'READY')
  assert.equal(report.mappingMultiplicity.multiIntentSlugs.length, 1)
})
check('eligible active edge가 없으면 NO_ACTIVE_EDGE', () => {
  const report = analyze({ publicSlugs: ['a'], mappings: [{ intent: 'i1', slug: 'a' }], edges: [edge('i1', 'i2', { active: false })] })
  assert.equal(row(report).status, 'NO_ACTIVE_EDGE')
})
check('slot 없는 edge는 NO_ACTIVE_EDGE', () => {
  const report = analyze({ publicSlugs: ['a'], mappings: [{ intent: 'i1', slug: 'a' }], edges: [edge('i1', 'i2', { slot: null })] })
  assert.equal(row(report).status, 'NO_ACTIVE_EDGE')
})
check('footer 밖 edge는 NO_ACTIVE_EDGE', () => {
  const report = analyze({ publicSlugs: ['a'], mappings: [{ intent: 'i1', slug: 'a' }], edges: [edge('i1', 'i2', { placement: 'BODY_INLINE_OR_TOP' })] })
  assert.equal(row(report).status, 'NO_ACTIVE_EDGE')
})
check('BRIDGE_DISCOVERY는 BRIDGE 관계만 받는다', () => {
  const report = analyze({ publicSlugs: ['a'], mappings: [{ intent: 'i1', slug: 'a' }], edges: [edge('i1', 'i2', { slot: 'BRIDGE_DISCOVERY' })] })
  assert.equal(row(report).status, 'NO_ACTIVE_EDGE')
})
check('edge target mapping이 없으면 TARGET_UNMAPPED', () => {
  const report = analyze({ publicSlugs: ['a'], mappings: [{ intent: 'i1', slug: 'a' }], edges: [edge('i1', 'i2')] })
  assert.equal(row(report).status, 'TARGET_UNMAPPED')
})
check('target이 등록됐지만 미공개면 TARGET_UNPUBLISHED', () => {
  const report = analyze({ publicSlugs: ['a'], allSlugs: ['a', 'b'], mappings: [{ intent: 'i1', slug: 'a' }, { intent: 'i2', slug: 'b' }], edges: [edge('i1', 'i2')] })
  assert.equal(row(report).status, 'TARGET_UNPUBLISHED')
  assert.deepEqual(row(report).targets, ['b'])
})
check('target mapping slug가 article에 없으면 STALE_TARGET_MAPPING', () => {
  const report = analyze({ publicSlugs: ['a'], mappings: [{ intent: 'i1', slug: 'a' }, { intent: 'i2', slug: 'ghost' }], edges: [edge('i1', 'i2')] })
  assert.equal(row(report).status, 'STALE_TARGET_MAPPING')
  assert.equal(report.integrity.staleMappings.length, 1)
})
check('공개 target이 하나라도 있으면 READY', () => {
  const report = analyze({ publicSlugs: ['a', 'b'], mappings: [{ intent: 'i1', slug: 'a' }, { intent: 'i2', slug: 'b' }], edges: [edge('i1', 'i2')] })
  assert.equal(row(report).status, 'READY')
  assert.deepEqual(row(report).targets, ['b'])
})
check('자기 자신만 target이면 READY가 아니다', () => {
  const report = analyze({ publicSlugs: ['a'], mappings: [{ intent: 'i1', slug: 'a' }], edges: [edge('i1', 'i1')] })
  assert.equal(row(report).status, 'NO_USABLE_RESULT')
})
check('한 intent의 여러 slug는 multiplicity 증거로 남긴다', () => {
  const report = analyze({ publicSlugs: ['a', 'b'], mappings: [{ intent: 'i1', slug: 'a' }, { intent: 'i1', slug: 'b' }] })
  assert.deepEqual(report.mappingMultiplicity.sharedIntentMappings, [{ intent: 'i1', slugs: ['a', 'b'] }])
})
check('입력 순서와 무관하게 row와 증거를 정렬한다', () => {
  const first = analyze({ publicSlugs: ['b', 'a'], mappings: [{ intent: 'i2', slug: 'b' }, { intent: 'i1', slug: 'a' }] })
  const second = analyze({ publicSlugs: ['a', 'b'], mappings: [{ intent: 'i1', slug: 'a' }, { intent: 'i2', slug: 'b' }] })
  assert.deepEqual(first, second)
})
check('상태별 count 합이 공개 글 수와 같다', () => {
  const report = analyze({ publicSlugs: ['a', 'b', 'c'] })
  assert.equal(Object.values(report.counts).reduce((a, b) => a + b, 0), report.publicArticleCount)
})

// ── graph 참여 상태 · 활성 cluster 계약 (2026-10-18) ──
const HASH = 'a'.repeat(64)
const editorial = (slug, over = {}) => ({ slug, state: 'EDITORIAL_NON_SEARCH', reasonCode: 'BOUNDED_RESEARCH_EXHAUSTED', evidenceHash: HASH, ...over })
const world = ({ articles, mappings = [], edges = [], participation }) => analyzeGraphCoverage({
  publicArticles: articles, allArticles: articles,
  graph: participation === undefined ? { graphVersion: 'g-test', mappings, edges } : { graphVersion: 'g-test', mappings, edges, participation },
})
const verdict = (report, cluster = 'sleep') => clusterActivationVerdict(report, cluster)
// a → b 로 쓸 수 있는 관계가 있는 기본 판. c 는 cluster 의 세 번째 공개 글
const READY_BASE = { mappings: [{ intent: 'i1', slug: 'a' }, { intent: 'i2', slug: 'b' }], edges: [edge('i1', 'i2'), edge('i2', 'i1')] }

check('참여: mapped + 쓸 수 있는 edge → SEARCH_NODE · READY · 활성 가능', () => {
  const report = world({ articles: [article('a'), article('b')], ...READY_BASE })
  assert.deepEqual([row(report).participation, row(report).status], ['SEARCH_NODE', 'READY'])
  assert.equal(verdict(report).ok, true)
})
check('참여: mapped + edge 없음 → SEARCH_NODE · NO_ACTIVE_EDGE · 활성 차단', () => {
  const report = world({ articles: [article('a'), article('b'), article('c')],
    mappings: [...READY_BASE.mappings, { intent: 'i3', slug: 'c' }], edges: READY_BASE.edges })
  assert.deepEqual([row(report, 'c').participation, row(report, 'c').status], ['SEARCH_NODE', 'NO_ACTIVE_EDGE'])
  assert.equal(verdict(report).ok, false)
  assert.deepEqual(verdict(report).blockers.map((b) => b.slug), ['c'])
})
check('참여: unmapped + editorial 선언 → EDITORIAL_NON_SEARCH · 활성을 막지 않는다', () => {
  const report = world({ articles: [article('a'), article('b'), article('c')], ...READY_BASE, participation: [editorial('c')] })
  assert.deepEqual([row(report, 'c').participation, row(report, 'c').status], ['EDITORIAL_NON_SEARCH', 'EDITORIAL_NON_SEARCH'])
  assert.deepEqual([verdict(report).ok, verdict(report).editorial], [true, ['c']])
})
check('참여: unmapped + 분류 없음 → UNRESOLVED · 활성 차단', () => {
  const report = world({ articles: [article('a'), article('b'), article('c')], ...READY_BASE })
  assert.deepEqual([row(report, 'c').participation, row(report, 'c').status], ['UNRESOLVED', 'UNMAPPED'])
  assert.equal(verdict(report).ok, false)
})
check('참여: editorial 선언의 hash 누락·빈 hash·형식 밖 hash·reasonCode 누락·state 밖은 UNRESOLVED 로 차단', () => {
  for (const bad of [{ evidenceHash: undefined }, { evidenceHash: '' }, { evidenceHash: 'abc' }, { reasonCode: '' }, { reasonCode: undefined }, { state: 'EDITORIAL' }]) {
    const report = world({ articles: [article('a'), article('b'), article('c')], ...READY_BASE, participation: [editorial('c', bad)] })
    assert.deepEqual([row(report, 'c').participation, row(report, 'c').status], ['UNRESOLVED', 'PARTICIPATION_INVALID'], JSON.stringify(bad))
    assert.equal(verdict(report).ok, false, JSON.stringify(bad))
  }
})
check('참여: 같은 slug 의 editorial 선언 중복은 UNRESOLVED 로 차단', () => {
  const report = world({ articles: [article('a'), article('b'), article('c')], ...READY_BASE, participation: [editorial('c'), editorial('c')] })
  assert.equal(row(report, 'c').status, 'PARTICIPATION_INVALID')
  assert.equal(verdict(report).ok, false)
})
check('참여: editorial 선언 + mapping 동시 → CONFLICT · 활성 차단', () => {
  const report = world({ articles: [article('a'), article('b')], ...READY_BASE, participation: [editorial('a')] })
  assert.deepEqual([row(report).participation, row(report).status], ['CONFLICT', 'PARTICIPATION_CONFLICT'])
  assert.equal(verdict(report).ok, false)
})
check('참여: slug 이름·cluster 이름만으로는 editorial 이 되지 않는다', () => {
  const articles = [article('a', 'editorial'), article('b', 'editorial'), article('editorial-non-search', 'editorial')]
  const report = world({ articles, ...READY_BASE })
  assert.deepEqual([row(report, 'editorial-non-search').participation, row(report, 'editorial-non-search').status], ['UNRESOLVED', 'UNMAPPED'])
  assert.equal(verdict(report, 'editorial').ok, false)
})
check('참여: 다른 slug 의 editorial 선언은 이 글을 바꾸지 않는다', () => {
  const report = world({ articles: [article('a'), article('b'), article('c')], ...READY_BASE, participation: [editorial('z')] })
  assert.equal(row(report, 'c').participation, 'UNRESOLVED')
})
check('참여: participation 키가 없는 bundle(롤백 대상)은 editorial 0 · 미매핑은 UNRESOLVED', () => {
  const report = world({ articles: [article('a'), article('b'), article('c')], ...READY_BASE })
  assert.equal(report.rows.filter((r) => r.participation === 'EDITORIAL_NON_SEARCH').length, 0)
  assert.equal(row(report, 'c').participation, 'UNRESOLVED')
})
check('활성: 공개 글이 없는 cluster 는 켤 수 없다', () => {
  assert.equal(verdict(world({ articles: [article('a')], ...READY_BASE }), 'money-work').ok, false)
})
check('활성: editorial 1편이 있어도 다른 SEARCH_NODE 의 NO_ACTIVE_EDGE 는 계속 막는다', () => {
  const report = world({ articles: [article('a'), article('b'), article('c'), article('d')],
    mappings: [...READY_BASE.mappings, { intent: 'i4', slug: 'd' }], edges: READY_BASE.edges, participation: [editorial('c')] })
  assert.equal(verdict(report).ok, false)
  assert.deepEqual(verdict(report).blockers, [{ slug: 'd', participation: 'SEARCH_NODE', status: 'NO_ACTIVE_EDGE' }])
})

console.log(`\nM-GRAPH coverage 검사: ${pass} pass, ${fail} fail`)
if (fail) process.exit(1)

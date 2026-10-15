#!/usr/bin/env node

import assert from 'node:assert/strict'
import { analyzeGraphCoverage } from './lib/magazine-graph-coverage.mjs'

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

console.log(`\nM-GRAPH coverage 검사: ${pass} pass, ${fail} fail`)
if (fail) process.exit(1)

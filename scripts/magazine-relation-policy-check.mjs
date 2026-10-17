#!/usr/bin/env node
/**
 * 관계 수량 공용 정책(direct 2~3 + discovery 1) 경계 검사 — 소비 경계마다 **독립적으로** 증명한다.
 *
 *   node scripts/magazine-relation-policy-check.mjs [--new-input <2026-10-17-money-work> --real-product <제품 루트>]
 *
 *   P1 정책 자체 — isValidDirectCount 0~5 · isSingleDiscovery
 *   P2 M-GRAPH builder — readiness 최소·표시 숫자가 정책에서 온다
 *   P3 source required-field — direct 2·3 present · 1·4 missing · discovery 0·2 missing
 *   P4 ArticleSpec compile · verify — direct 2·3 통과 · 1·4 거부 · discovery 0·2 거부 · direct 2 에서도 중복·self 거부
 *   P5 제품 resolver 표시 상한(MAX_DIRECT · MAX_DISCOVERY) = 정책
 *   P6 소비 모듈이 공용 정책을 import 한다
 *   (선택) 실제 I-T6-05 — 최종 snapshot `2026-10-17-money-work-kimjang-cold-live` · effectiveAt 2026-10-17T10:30:00+09:00 에서
 *         direct 2 + discovery 1 이 source 수량 관문과 ArticleSpec 을 통과 · G8 미편입은 별도 blocker 로 남는다
 * authoring prepare · judge 경계는 `magazine-direct-spec-source-authoring-check.mjs` S08 · S08b · S08c 가 본다.
 *
 * 🔴 변이 하네스가 lib 사본 폴더를 주입한다: RELATION_POLICY_LIB (없으면 이 저장소 scripts/lib).
 *    적재 실패는 `LOAD_ERROR` — 검출로 세지 않는다. 마지막 줄 `관계 수량 정책 검사: <n> pass, <n> fail`
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const LIB = process.env.RELATION_POLICY_LIB ?? join(HERE, 'lib')
const load = async (name) => import(pathToFileURL(join(LIB, name)).href)
let policy, build, source, spec
try {
  policy = await load('magazine-relation-policy.mjs')
  build = await load('magazine-graph-build.mjs')
  source = await load('magazine-direct-spec-source.mjs')
  spec = await load('magazine-article-spec.mjs')
} catch (e) { console.log(`LOAD_ERROR ${e.message}`); process.exit(3) }

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name} — ${String(e.message).split('\n')[0].slice(0, 300)}`) }
}
const argOf = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1] }
const { RELATION_POLICY, isValidDirectCount, isSingleDiscovery } = policy

check('P1 정책 — direct 2·3 만 유효(0·1·4·5 무효) · discovery 는 단일 객체만', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(isValidDirectCount), [false, false, true, true, false, false])
  assert.deepEqual([{ slug: 'x' }, null, undefined, [], [{ slug: 'x' }], [{ slug: 'x' }, { slug: 'y' }]].map(isSingleDiscovery), [true, false, false, false, false, false])
  assert.deepEqual(RELATION_POLICY, { directMin: 2, directMax: 3, discovery: 1 })
})

check('P2 M-GRAPH builder — 생산 최소 · 표시 상한이 정책 값이다', () => {
  assert.deepEqual(build.READINESS_POLICY, {
    productionMinimum: { direct: RELATION_POLICY.directMin, discovery: RELATION_POLICY.discovery },
    displayTarget: { directMax: RELATION_POLICY.directMax, discovery: RELATION_POLICY.discovery },
  })
})

/** 필수 필드가 모두 채워진 source entry — 관계만 바꿔 가며 본다 */
const rel = (slug, relationType = 'DIRECT_NEXT') => ({ slug, source: 'M-GRAPH', relationType, reason: `${slug} 로 이어진다` })
const entryWith = (direct, discovery) => {
  const e = { node: {}, relations: { direct, discovery }, publication: { publishAt: '2026-10-22T10:30:00+09:00' } }
  for (const path of source.DIRECT_SPEC_REQUIRED_FIELDS) {
    if (path.startsWith('relations.')) continue
    const keys = path.split('.'); const last = keys.pop()
    const parent = keys.reduce((o, k) => (o[k] ??= {}), e)
    parent[last] = path === 'node.outline' ? ['하나', '둘', '셋'] : path.startsWith('node.scope') || path.startsWith('node.evidence') || path === 'node.safetyConstraints' ? ['x'] : 'x'
  }
  return e
}
const missingRel = (direct, discovery) => source.missingSourceFields(entryWith(direct, discovery)).filter((p) => p.startsWith('relations.'))

check('P3 source required-field — direct 2·3 + discovery 1 은 누락 0, direct 1·4 는 relations.direct 누락', () => {
  const d = (n) => Array.from({ length: n }, (_, i) => rel(`d${i + 1}`))
  assert.deepEqual(missingRel(d(2), rel('x', 'BRIDGE_DISCOVERY')), [], 'direct 2')
  assert.deepEqual(missingRel(d(3), rel('x', 'BRIDGE_DISCOVERY')), [], 'direct 3')
  assert.deepEqual(missingRel(d(1), rel('x', 'BRIDGE_DISCOVERY')), ['relations.direct'], 'direct 1')
  assert.deepEqual(missingRel(d(4), rel('x', 'BRIDGE_DISCOVERY')), ['relations.direct'], 'direct 4')
})
check('P3b source required-field — discovery 0(null) · 2(배열) 는 relations.discovery 누락', () => {
  const d2 = [rel('d1'), rel('d2')]
  assert.deepEqual(missingRel(d2, null), ['relations.discovery'], 'discovery 0')
  assert.deepEqual(missingRel(d2, [rel('x', 'BRIDGE_DISCOVERY'), rel('y', 'BRIDGE_DISCOVERY')]), ['relations.discovery'], 'discovery 2')
})

const FIXTURE = join(ROOT, 'scripts/__fixtures__/magazine/direct-spec/canary.input.json')
const fx = () => JSON.parse(readFileSync(FIXTURE, 'utf8'))
const compileWith = (mutate) => { const x = fx(); mutate(x); return spec.compileArticleSpec({ node: x.node, queueItem: x.queueItem, relations: x.relations, publication: x.publication, hero: x.hero }) }
const rejects = (mutate, why) => assert.throws(() => compileWith(mutate), (e) => e?.code === 'ARTICLE_SPEC_RELATION', why)

check('P4 ArticleSpec — direct 3(기존 fixture) · 2 는 compile · verify 통과', () => {
  const three = compileWith(() => {})
  assert.equal(three.navigation.direct.length, 3); assert.equal(spec.verifyArticleSpec(three).ok, true)
  const two = compileWith((x) => { x.relations.direct = x.relations.direct.slice(0, 2) })
  assert.equal(two.navigation.direct.length, 2); assert.equal(spec.verifyArticleSpec(two).ok, true)
})
check('P4b ArticleSpec — direct 1 · 4 · discovery 0 · 2 거부, direct 2 에서도 중복 · self 거부', () => {
  rejects((x) => { x.relations.direct = x.relations.direct.slice(0, 1) }, 'direct 1')
  rejects((x) => { x.relations.direct.push({ ...x.relations.direct[0], slug: 'direct-four' }) }, 'direct 4')
  rejects((x) => { x.relations.discovery = null }, 'discovery 0')
  rejects((x) => { x.relations.discovery = [x.relations.discovery, x.relations.discovery] }, 'discovery 2')
  rejects((x) => { x.relations.direct = [x.relations.direct[0], x.relations.direct[0]] }, 'direct 2 중복')
  rejects((x) => { x.relations.direct = [x.relations.direct[0], { ...x.relations.direct[1], slug: x.queueItem.slug }] }, 'direct 2 self')
})
check('P4c ArticleSpec verify — spec 의 direct 를 4개로 고친 뒤 hash 를 다시 맞춰도 거부', () => {
  const s = compileWith(() => {})
  const bad = structuredClone(s); bad.navigation.direct.push({ ...bad.navigation.direct[0], slug: 'direct-four' })
  delete bad.specHash; bad.specHash = spec.articleSpecHash(bad)
  assert.equal(spec.verifyArticleSpec(bad).ok, false)
})

check('P5 제품 resolver 의 표시 상한(MAX_DIRECT · MAX_DISCOVERY)이 정책과 같다', () => {
  const ts = readFileSync(join(ROOT, 'src/lib/magazine-graph.ts'), 'utf8')
  assert.equal(Number(/export const MAX_DIRECT = (\d+)/.exec(ts)?.[1]), RELATION_POLICY.directMax)
  assert.equal(Number(/export const MAX_DISCOVERY = (\d+)/.exec(ts)?.[1]), RELATION_POLICY.discovery)
})

check('P6 소비 모듈이 공용 정책 모듈을 import 한다', () => {
  for (const f of ['magazine-graph-build.mjs', 'magazine-direct-spec-source.mjs', 'magazine-direct-spec-source-authoring.mjs', 'magazine-article-spec.mjs', 'magazine-direct-spec.mjs']) {
    assert.match(readFileSync(join(LIB, f), 'utf8'), /from '\.\/magazine-relation-policy\.mjs'/, f)
  }
})

const newInput = argOf('--new-input'), realProduct = argOf('--real-product')
if (newInput && realProduct) {
  check('실제 I-T6-05 — 최종 snapshot · 10:30 에서 direct 2(E-0188 · E-0329) + discovery 1(E-0100)이 source 수량 관문과 ArticleSpec 을 통과 · G8 미편입은 별도 blocker', () => {
    // 🔴 제품 lifecycle 과 맞는 최종 snapshot 만 받는다 — 낡은 snapshot 은 build 가 INPUT_PRODUCT_LIFECYCLE_DRIFT 로 막는다
    assert.equal(newInput.replace(/\/+$/, '').split('/').pop(), '2026-10-17-money-work-kimjang-cold-live', '--new-input 은 최종 snapshot 이어야 한다')
    const read = (p) => readFileSync(p, 'utf8')
    const inputTexts = Object.fromEntries(Object.values(build.INPUT_FILES).map((n) => [n, read(join(newInput, n))]))
    const productTexts = Object.fromEntries(Object.entries(build.PRODUCT_FILES).map(([k, r]) => [k, read(join(realProduct, r))]))
    const control = productTexts.control.replace("enabledClusters: ['sleep', 'family'],", "enabledClusters: ['sleep', 'family', 'money-work'],")
    assert.notEqual(control, productTexts.control, 'control 사본 치환 실패')
    const b = build.buildAll({ inputTexts, productTexts: { ...productTexts, control }, admissionTexts: { slugManifest: '{"slugs":{}}', ledger: '' },
      effectiveAt: '2026-10-17T10:30:00+09:00', generatedAt: '2026-10-17T01:30:00.000Z' })
    const x = b.readiness.rows.find((r) => r.intentId === 'I-T6-05')
    assert.equal(x.status, 'GRAPH_READY')
    assert.deepEqual(x.direct.targets.map((t) => t.edgeId), ['E-0188', 'E-0329']); assert.deepEqual(x.discovery.targets.map((t) => t.edgeId), ['E-0100'])
    assert.ok(x.reverse.sources.some((s) => s.edgeId === 'E-0099'))
    assert.deepEqual(x.admission.blockers, ['G8_NOT_ADMITTED'], 'G8 미편입은 별도 blocker 로 남는다')
    const direct = x.direct.targets.map((t) => ({ slug: t.slug, source: 'M-GRAPH', relationType: t.slot, reason: t.reason }))
    const d0 = x.discovery.targets[0]
    const discovery = { slug: d0.slug, source: 'M-GRAPH', relationType: d0.slot, reason: d0.reason }
    assert.deepEqual(missingRel(direct, discovery), [], 'source 수량 관문')
    const s = compileWith((f) => { f.relations = { direct, discovery } })
    assert.equal(s.navigation.direct.length, 2); assert.equal(spec.verifyArticleSpec(s).ok, true)
  })
} else {
  console.log('SKIP 실제 I-T6-05 — --new-input · --real-product 미지정 (통과로 세지 않는다)')
}

console.log(`\n관계 수량 정책 검사: ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)

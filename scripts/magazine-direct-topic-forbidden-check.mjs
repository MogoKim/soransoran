#!/usr/bin/env node
/**
 * DIRECT 글별 주제 금지 패턴 — batch QA 가 review.ts 대신 **승인 ArticleSpec(spec/2)** 에서 패턴을 읽는가.
 *
 * 🔴 왜 (2026-10-28 · age-learning)
 *    DIRECT 글은 review.ts 를 만들지 않는다. 자동 batch QA 는 주제별 위험 검사를 review.ts.forbiddenPatterns
 *    하나로만 받아 DIRECT 글을 매번 FORBIDDEN_PATTERNS_ABSENT 로 막았다. 폴더에 가짜 review.ts 를 두면
 *    그것이 DIRECT 의 권위가 됐다. spec/1 의 bannedTerms · forbiddenAssertions 는 magazine-qa 가 이미 보는
 *    공통 고정 목록이고 topicConstraints 는 자연어 지침이라 글별 패턴을 대신하지 못한다.
 *
 * 🔴 실제 경로를 태운다 — 임시 루트(scripts · 제품 graph · 큐 복사본)에 승인 source · spec · 원고 · hero 를 두고
 *    **auto-register 가 부르는 것과 같은 인자**로 실제 `magazine-batch-qa.mjs` CLI 를 띄운다(magazine-qa · profile QA 포함).
 *    운영 drafts · 큐 · 장부 · ChatGPT · Chrome · 네트워크 접근 0.
 *
 * 반례
 *   T01 DIRECT · source/3 · spec/2 · 패턴 있음 · 위반 없음 → READY_TO_SCHEDULE (패턴 출처 = 그 spec)
 *   T02 DIRECT 원고에 주제 패턴 → FORBIDDEN_PATTERN 하나로 BLOCKED
 *   T03 DIRECT spec 없음 · 손상 · 신원 불일치(다른 spec 바이트) · source drift → 각각 그 코드로 BLOCKED
 *   T04 DIRECT 패턴 없음(source/2 → spec/1) · 빈 배열(source/3) → BLOCKED
 *   T05 DIRECT 폴더의 가짜 review.ts 는 무시한다 (위반 패턴을 넣어도 · 패턴 없는 spec 을 구해 주지도 않는다)
 *   T06 topicConstraints 문장이 원고에 그대로 있어도 FORBIDDEN_PATTERN 이 아니다 · 지침 문장은 패턴으로 컴파일되지 않는다
 *   T07 legacy 정상 review.ts → 수정 전 기준(golden)과 출력 바이트 동일
 *   T08 legacy forbiddenPatterns 없음 → 기존처럼 FORBIDDEN_PATTERNS_ABSENT (golden 동일)
 *   T09 공통 목록(bannedTerms · forbiddenAssertions)만 있고 주제 패턴 없음 → BLOCKED · 공통어를 패턴으로 → 승인 불가
 *   T10 auto-register 의 실제 batch 호출 인자를 소스에서 읽어 그대로 쓴다 — 모든 반례가 그 인자로 돈다
 *   T11 옛 spec/1 을 source/3 개정이 supersedes 로 대체할 수 있다 — 교체 전 batch 진행 0 · draft 가 있으면 DRAFT_EXISTS
 *
 *   node scripts/magazine-direct-topic-forbidden-check.mjs              검사
 *   node scripts/magazine-direct-topic-forbidden-check.mjs --golden <root> 수정 전 루트로 legacy golden 을 다시 만든다
 */
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..')
/** 임시 루트에 복사하는 것 — batch-qa · magazine-qa · source 관문이 읽는 전부 */
export const COPY = ['scripts', 'src/content/magazine', 'src/lib/magazine.ts', 'src/lib/magazine-graph.ts', 'drafts/magazine/topic-queue.ts']
const GOLDEN = join(ROOT, 'scripts/__fixtures__/magazine/direct-topic-forbidden/legacy-golden.json')
const MANUSCRIPT = join(ROOT, 'scripts/__fixtures__/magazine/manuscript-pass.draft.md')
const CANARY = join(ROOT, 'scripts/__fixtures__/magazine/direct-spec/canary.input.json')

const TMPS = []
process.on('exit', () => { for (const d of TMPS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })

/** 임시 루트 — `from` 의 파일을 복사한다. 변이 하네스는 이 사본만 바꾼다(원본 0) */
export function makeRoot(from = ROOT) {
  const root = mkdtempSync(join(tmpdir(), 'dtf-root-'))
  TMPS.push(root)
  for (const p of COPY) cpSync(join(from, p), join(root, p), { recursive: true })
  return root
}

// ── 고정 입력 ─────────────────────────────────────────────────
const DIRECT_SLUG = 'dtf-direct-01'
const LEGACY_SLUG = 'dtf-legacy-01'
const INTENT = 'I-DTF-01'
const CLUSTER = 'family'
/** 원고에 실제로 있는 문장 — topicConstraints 에 넣어도 literal 금지어로 쓰이지 않아야 한다 (T06) */
const CONSTRAINT_IN_MANUSCRIPT = '그런 마음이 드는 분들이 적지 않습니다.'
/** 사람이 승인한 글별 주제 금지 패턴 — 원고에 없다 */
const TOPIC_PATTERNS = ['모임을 끊으세요', '관계를 정리하세요']
/** 원고에 실제로 있는 표현 — 위반 반례(T02 · T05)가 쓴다 */
const IN_MANUSCRIPT = '옷장을 열었다가'

const manuscript = ({ title, extra = '' }) => readFileSync(MANUSCRIPT, 'utf8')
  .replace(/^title: .+$/m, `title: ${title}`)
  .replace(/^description: .+$/m, 'description: 오래 다니던 모임이 어느 날부터 버겁게 느껴질 때, 나를 탓하지 않고 지금 편한 거리를 다시 찾는 방법을 차근차근 함께 정리해 봅니다. 쉬어 가도 괜찮다는 이야기입니다.')
  .replace(/^cluster: .+$/m, `cluster: ${CLUSTER}`)
  .replace(/\n\[CTA\]/, `${extra ? `\n${extra}\n` : ''}\n[CTA]`)

/** auto-register 가 batch-qa 를 부르는 인자 — 소스에서 읽는다 (T10) */
export function autoRegisterBatchArgs(root = ROOT) {
  const src = readFileSync(join(root, 'scripts/magazine-auto-register.mjs'), 'utf8')
  const m = src.match(/runStep\(BATCH_QA, \[slug, ('[^\]]+'), \.\.\.\(autoLane \? \['--require-hero'\] : \[\]\)\]/)
  assert.ok(m, 'auto-register 의 batch-qa 호출을 찾지 못했다 — 호출 모양이 바뀌었다')
  return [...m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')), '--require-hero']
}

/** 실제 CLI — 임시 루트의 batch-qa 를 auto-register 와 같은 인자로 */
export function runBatch(root, slug, args = autoRegisterBatchArgs(root)) {
  const r = spawnSync(process.execPath, ['scripts/magazine-batch-qa.mjs', slug, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, HOME: root } })
  let json = null
  try { json = JSON.parse(r.stdout) } catch { /* 아래에서 단언 */ }
  assert.ok(json?.results?.[0], `batch-qa 출력을 읽지 못했다 (rc ${r.status}): ${r.stderr.slice(0, 300)}`)
  return { rc: r.status, row: json.results[0], stdout: r.stdout }
}

const appendQueue = (root, row) => {
  const p = join(root, 'drafts/magazine/topic-queue.ts')
  const text = readFileSync(p, 'utf8')
  const end = text.lastIndexOf('\n]')
  writeFileSync(p, `${text.slice(0, end)}\n  ${JSON.stringify(row)},${text.slice(end)}`)
}

/** 원고 → article-draft.ts(임시 루트의 실제 변환기) → hero 주입 · public 파일 */
async function writeArticle(root, slug, md, alt) {
  const dir = join(root, 'drafts/magazine', slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'draft.md'), md)
  execFileSync(process.execPath, ['scripts/magazine-md-to-draft.mjs', '--in', `drafts/magazine/${slug}/draft.md`, '--out', `drafts/magazine/${slug}/article-draft.ts`], { cwd: root, stdio: 'pipe' })
  const { injectHeroImage } = await import(pathToFileURL(join(ROOT, 'scripts/lib/magazine-hero.mjs')).href)
  const inj = injectHeroImage(readFileSync(join(dir, 'article-draft.ts'), 'utf8'), slug, alt)
  assert.ok(inj.ok, `hero 주입 실패: ${inj.why}`)
  writeFileSync(join(dir, 'article-draft.ts'), inj.text)
  mkdirSync(join(root, 'public/magazine', slug), { recursive: true })
  writeFileSync(join(root, 'public/magazine', slug, 'hero.webp'), 'dtf')
  return dir
}

/**
 * DIRECT 세계 — 승인 source(판 선택) · 정본 큐 행 · 디스크 spec · 원고.
 * 🔴 fixture 는 **원본 저장소의 라이브러리**로 만든다 — 변이는 임시 루트의 판정 코드만 바꾼다.
 */
export async function directWorld(root, { schema = 'v3', patterns = TOPIC_PATTERNS, extra = '', spec = 'ok', review = null, queueEdit = null } = {}) {
  const S = await import(pathToFileURL(join(ROOT, 'scripts/lib/magazine-direct-spec-source.mjs')).href)
  const fx = JSON.parse(readFileSync(CANARY, 'utf8'))
  const GV = S.readProductGraphVersion(join(root, 'src/content/magazine/graph/current.ts'))
  const title = '모임 약속이 버거워질 때'
  const q = { ...fx.queueItem, title, cluster: CLUSTER, imageMode: 'OPTIONAL', ctaBoard: '/community/free' }
  const plan = {
    ...Object.fromEntries(S.ARTICLE_PLAN_REQUIRED.map((k) => [k, q[k]])),
    ...Object.fromEntries(S.ARTICLE_PLAN_OPTIONAL.filter((k) => q[k] !== undefined).map((k) => [k, q[k]])),
  }
  const node = { ...fx.node, id: INTENT, intentId: INTENT, slug: DIRECT_SLUG, graphVersion: GV,
    safetyConstraints: [...fx.node.safetyConstraints, CONSTRAINT_IN_MANUSCRIPT] }
  if (schema === 'v3') node.forbiddenPatterns = patterns
  const entry = {
    status: 'APPROVED', approvedBy: 'dtf-test-approver', approvedAt: '2026-10-28T09:00:00+09:00',
    admission: { g8ManifestHash: 'sha256:dtf-manifest-0001', receiptHash: 'dtf-receipt-0001', graphVersion: GV, readinessHash: 'dtf-readiness-0001' },
    plan, node, relations: fx.relations, hero: fx.hero, publication: { publishAt: '2026-10-30T10:30:00+09:00' },
    productBasis: S.productBasisFor(S.readProductGraphState(root), { intentId: INTENT, queueCluster: CLUSTER }),
  }
  entry.sourceHash = S.directSpecSourceHash(entry)
  const row = S.queueRowFromEntry(entry, { day: 9101 })
  const drafts = join(root, 'drafts/magazine')
  const sp = S.directSpecSourcePath(drafts, GV)
  mkdirSync(dirname(sp), { recursive: true })
  writeFileSync(sp, `${JSON.stringify({ schema: schema === 'v3' ? S.DIRECT_SPEC_SOURCE_SCHEMA : S.DIRECT_SPEC_SOURCE_SCHEMA_V2, graphVersion: GV, entries: [entry] }, null, 2)}\n`)
  appendQueue(root, queueEdit ? queueEdit(row) : row)
  const dir = await writeArticle(root, DIRECT_SLUG, manuscript({ title, extra }), fx.hero.alt)
  /**
   * 🔴 `spec: 'sut'` — 시험 대상 루트 **자신의** source 관문으로 판정하고, 통과할 때만 그 spec 을 쓴다(producer 와 같은 순서).
   *    거부 반례(빈 배열 · 지침 문장 · 공통어)는 반드시 이 모드로 본다 — 원본 라이브러리로 판정하면 변이된 컴파일을 시험하지 못한다.
   */
  const SUT = spec === 'sut' ? await import(pathToFileURL(join(root, 'scripts/lib/magazine-direct-spec-source.mjs')).href) : S
  const judged = SUT.judgeDirectSpecSource({ queueItem: row, draftsDir: drafts, expectedGraphVersion: GV, productRoot: root })
  const specPath = join(dir, 'article-spec.json')
  if (spec === 'sut') {
    if (judged.ok) writeFileSync(specPath, `${JSON.stringify(judged.spec, null, 2)}\n`)
  } else if (spec === 'ok' || spec === 'conflict') {
    assert.equal(judged.ok, true, `fixture source 가 관문을 지나지 않는다: ${judged.why}`)
    let s = judged.spec
    if (spec === 'conflict') {
      // 🔴 같은 글 · 같은 판의 **다른** 유효 spec — 자기검증은 통과하지만 승인 source 컴파일 결과와 바이트가 다르다
      const { articleSpecHash } = await import(pathToFileURL(join(ROOT, 'scripts/lib/magazine-article-spec.mjs')).href)
      const { specHash: _h, ...body } = structuredClone(s)
      body.publication.publishAt = '2026-10-31T10:30:00+09:00'
      s = { ...body, specHash: articleSpecHash(body) }
    }
    writeFileSync(specPath, `${JSON.stringify(s, null, 2)}\n`)
  } else if (spec === 'corrupt') writeFileSync(specPath, '{ "schemaVersion": "magazine-article-spec/2", ')
  if (review !== null) writeFileSync(join(dir, 'review.ts'), `export const REVIEW = ${JSON.stringify(review)}\n`)
  return { dir, row, entry, judged, specPath }
}

/** legacy 세계 — opt-in 없는 큐 행 · review.ts · 원고 (DIRECT 행 없음) */
export async function legacyWorld(root, { review = { forbiddenPatterns: TOPIC_PATTERNS } } = {}) {
  const fx = JSON.parse(readFileSync(CANARY, 'utf8'))
  const title = '모임에 나가기 전 마음이 무거울 때'
  const { intentId: _i, g8ManifestHash: _g, directSpecMode: _d, ...q } = fx.queueItem
  appendQueue(root, { ...q, day: 9102, slug: LEGACY_SLUG, title, cluster: CLUSTER, imageMode: 'OPTIONAL', ctaBoard: '/community/free', internalLinks: [] })
  const dir = await writeArticle(root, LEGACY_SLUG, manuscript({ title }), fx.hero.alt)
  if (review) writeFileSync(join(dir, 'review.ts'), `export const REVIEW = ${JSON.stringify(review)}\n`)
  return { dir }
}

const codes = (row) => row.blockedBy.map((b) => b.code)

/** legacy 반례 두 개의 출력 — golden 과 바이트로 비교한다 */
export async function legacyOutputs(from) {
  const out = {}
  for (const [key, review] of [['withPatterns', { forbiddenPatterns: TOPIC_PATTERNS }], ['withoutPatterns', { riskSentences: null }]]) {
    const root = makeRoot(from)
    await legacyWorld(root, { review })
    out[key] = runBatch(root, LEGACY_SLUG, autoRegisterBatchArgs(ROOT)).stdout
  }
  return out
}

/** 반례 — `root()` 가 매번 새 임시 루트를 준다(변이 하네스는 변이된 사본을 준다) */
export function topicForbiddenCases({ root = () => makeRoot() } = {}) {
  return [
    ['T01 DIRECT · source/3 · spec/2 · 주제 패턴 있음 · 위반 없음 → READY · 패턴 출처는 그 spec', async () => {
      const r0 = root(); const w = await directWorld(r0)
      const { row } = runBatch(r0, DIRECT_SLUG)
      assert.equal(row.verdict, 'READY_TO_SCHEDULE', JSON.stringify(row.reasons))
      assert.equal(row.checks.forbiddenPatterns, TOPIC_PATTERNS.length)
      assert.deepEqual(row.checks.patternSource, { schemaVersion: 'magazine-article-spec/2', specHash: w.judged.spec.specHash })
      assert.equal(w.judged.spec.schemaVersion, 'magazine-article-spec/2')
    }],
    ['T02 DIRECT 원고에 주제 패턴 → FORBIDDEN_PATTERN 하나로 BLOCKED', async () => {
      const r0 = root(); await directWorld(r0, { extra: `요즘은 차라리 ${TOPIC_PATTERNS[0]}라는 말까지 듣습니다.` })
      const { row } = runBatch(r0, DIRECT_SLUG)
      assert.equal(row.verdict, 'BLOCKED'); assert.deepEqual(codes(row), ['FORBIDDEN_PATTERN'])
      assert.deepEqual(row.checks.patternHits, [TOPIC_PATTERNS[0]])
    }],
    ['T03 DIRECT spec 없음 · 손상 · 다른 spec 바이트 · source drift → 그 코드로 BLOCKED (주제 검사 0)', async () => {
      for (const [label, opt, code] of [
        ['spec 없음', { spec: 'none' }, 'DIRECT_SPEC_MISSING'],
        ['spec 손상', { spec: 'corrupt' }, 'DIRECT_SPEC_UNREADABLE'],
        ['같은 글의 다른 spec', { spec: 'conflict' }, 'DIRECT_SPEC_SPEC_CONFLICT'],
        ['큐 행이 승인과 다르다', { queueEdit: (q) => ({ ...q, articlePlanHash: `sha256:${'f'.repeat(64)}` }) }, 'DIRECT_SPEC_SOURCE_NOT_READY'],
      ]) {
        const r0 = root(); await directWorld(r0, opt)
        const { row } = runBatch(r0, DIRECT_SLUG)
        assert.equal(row.verdict, 'BLOCKED', label); assert.deepEqual(codes(row), [code], label)
        assert.equal(row.checks.forbiddenPatterns, null, `${label} — 검증 못 한 spec 의 패턴을 썼다`)
      }
    }],
    ['T04 DIRECT 패턴 없음(source/2 → spec/1) · 빈 배열(source/3) → BLOCKED', async () => {
      const a = root(); const wa = await directWorld(a, { schema: 'v2' })
      assert.equal(wa.judged.spec.schemaVersion, 'magazine-article-spec/1')
      const ra = runBatch(a, DIRECT_SLUG).row
      assert.equal(ra.verdict, 'BLOCKED'); assert.deepEqual(codes(ra), ['DIRECT_TOPIC_PATTERNS_ABSENT'])
      const b = root(); const wb = await directWorld(b, { patterns: [], spec: 'sut' })
      assert.equal(wb.judged.ok, false, '빈 패턴으로 spec 을 만들었다'); assert.ok(wb.judged.evidence.missingFields.includes('node.forbiddenPatterns'))
      const rb = runBatch(b, DIRECT_SLUG).row
      assert.equal(rb.verdict, 'BLOCKED'); assert.equal(rb.checks.forbiddenPatterns, null)
    }],
    ['T05 DIRECT 폴더의 가짜 review.ts 는 무시한다 — 위반을 만들지도 · 없는 패턴을 채우지도 않는다', async () => {
      const a = root(); await directWorld(a, { review: { forbiddenPatterns: [IN_MANUSCRIPT] } })
      const ra = runBatch(a, DIRECT_SLUG).row
      assert.equal(ra.verdict, 'READY_TO_SCHEDULE', JSON.stringify(ra.reasons)); assert.deepEqual(ra.checks.patternHits, [])
      assert.equal(ra.checks.forbiddenPatterns, TOPIC_PATTERNS.length)
      assert.ok(ra.notes.some((n) => n.includes('review.ts 는 읽지 않는다')))
      const b = root(); await directWorld(b, { schema: 'v2', review: { forbiddenPatterns: ['가짜 패턴'] } })
      const rb = runBatch(b, DIRECT_SLUG).row
      assert.deepEqual(codes(rb), ['DIRECT_TOPIC_PATTERNS_ABSENT']); assert.equal(rb.checks.forbiddenPatterns, null)
    }],
    ['T06 topicConstraints 문장이 원고에 그대로 있어도 금지어가 아니다 · 지침 문장은 패턴으로 컴파일되지 않는다', async () => {
      assert.ok(readFileSync(MANUSCRIPT, 'utf8').includes(CONSTRAINT_IN_MANUSCRIPT), '반례 준비 실패 — 지침 문장이 원고에 없다')
      const r0 = root(); const w = await directWorld(r0)
      assert.ok(w.judged.spec.safety.topicConstraints.includes(CONSTRAINT_IN_MANUSCRIPT))
      const { row } = runBatch(r0, DIRECT_SLUG)
      assert.equal(row.verdict, 'READY_TO_SCHEDULE', JSON.stringify(row.reasons)); assert.deepEqual(row.checks.patternHits, [])
      const r1 = root(); const w1 = await directWorld(r1, { patterns: [CONSTRAINT_IN_MANUSCRIPT], spec: 'sut' })
      assert.equal(w1.judged.ok, false, '지침 문장을 주제 패턴으로 컴파일했다'); assert.ok(w1.judged.evidence.blockers.includes('COMPILE_FAILED'))
      assert.equal(runBatch(r1, DIRECT_SLUG).row.verdict, 'BLOCKED')
    }],
    ['T07 legacy 정상 review.ts → 수정 전 기준과 출력 바이트 동일', async () => {
      const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'))
      const r0 = root(); await legacyWorld(r0)
      assert.equal(runBatch(r0, LEGACY_SLUG).stdout, golden.withPatterns)
      assert.equal(JSON.parse(golden.withPatterns).results[0].verdict, 'READY_TO_SCHEDULE')
    }],
    ['T08 legacy forbiddenPatterns 없음 → 기존처럼 FORBIDDEN_PATTERNS_ABSENT (기준과 바이트 동일)', async () => {
      const golden = JSON.parse(readFileSync(GOLDEN, 'utf8'))
      const r0 = root(); await legacyWorld(r0, { review: { riskSentences: null } })
      const out = runBatch(r0, LEGACY_SLUG)
      assert.equal(out.stdout, golden.withoutPatterns)
      assert.deepEqual(codes(out.row), ['FORBIDDEN_PATTERNS_ABSENT'])
    }],
    ['T09 공통 목록만 있고 주제 패턴 없음 → BLOCKED · 공통어를 주제 패턴으로 → 컴파일 거부', async () => {
      const a = root(); const wa = await directWorld(a, { schema: 'v2' })
      assert.ok(wa.judged.spec.safety.bannedTerms.length > 0 && wa.judged.spec.safety.forbiddenAssertions.length > 0)
      assert.deepEqual(codes(runBatch(a, DIRECT_SLUG).row), ['DIRECT_TOPIC_PATTERNS_ABSENT'])
      for (const common of [wa.judged.spec.safety.bannedTerms[0], wa.judged.spec.safety.forbiddenAssertions[0]]) {
        const b = root(); const wb = await directWorld(b, { patterns: [common], spec: 'sut' })
        assert.equal(wb.judged.ok, false, `공통어 ${common} 를 주제 패턴으로 컴파일했다`); assert.ok(wb.judged.evidence.blockers.includes('COMPILE_FAILED'), common)
        assert.equal(runBatch(b, DIRECT_SLUG).row.verdict, 'BLOCKED', common)
      }
    }],
    ['T11 옛 spec/1(source/2) 을 source/3 개정이 supersedes 로 가리킨다 → 교체 필요 · 옛 spec 자기검증 통과 · draft 가 있으면 DRAFT_EXISTS', async () => {
      const r0 = root(); const w = await directWorld(r0, { schema: 'v2' })
      const S = await import(pathToFileURL(join(r0, 'scripts/lib/magazine-direct-spec-source.mjs')).href)
      const { verifyArticleSpec } = await import(pathToFileURL(join(r0, 'scripts/lib/magazine-article-spec.mjs')).href)
      const old = w.judged.spec
      assert.equal(old.schemaVersion, 'magazine-article-spec/1'); assert.equal(verifyArticleSpec(old).ok, true)
      const { sourceHash: _s, ...body } = structuredClone(w.entry)
      body.node.forbiddenPatterns = [...TOPIC_PATTERNS]
      body.supersedes = { specHash: old.specHash, sourceHash: w.entry.sourceHash }
      const next = { ...body, sourceHash: S.directSpecSourceHash(body) }
      const drafts = join(r0, 'drafts/magazine')
      writeFileSync(S.directSpecSourcePath(drafts, next.node.graphVersion), `${JSON.stringify({ schema: S.DIRECT_SPEC_SOURCE_SCHEMA, graphVersion: next.node.graphVersion, entries: [next] }, null, 2)}\n`)
      const row = S.queueRowFromEntry(next, { day: w.row.day })
      const qp = join(r0, 'drafts/magazine/topic-queue.ts')
      writeFileSync(qp, readFileSync(qp, 'utf8').replace(JSON.stringify(w.row), JSON.stringify(row)))
      const v = S.verifyDirectSpecIdentity({ queueItem: row, draftsDir: drafts, expectedGraphVersion: next.node.graphVersion, productRoot: r0 })
      assert.equal(v.code, 'DIRECT_SPEC_SUPERSEDE_REQUIRED', v.why)
      assert.equal(v.judged.spec.schemaVersion, 'magazine-article-spec/2')
      assert.deepEqual(S.judgeSupersession({ judged: v.judged, draftsDir: drafts, slug: DIRECT_SLUG }).problems, ['DRAFT_EXISTS'])
      // 🔴 교체 전에는 batch 가 옛 spec 으로 진행하지 않는다
      assert.deepEqual(codes(runBatch(r0, DIRECT_SLUG).row), ['DIRECT_SPEC_SUPERSEDE_REQUIRED'])
      rmSync(join(w.dir, 'draft.md'))
      assert.equal(S.judgeSupersession({ judged: v.judged, draftsDir: drafts, slug: DIRECT_SLUG }).ok, true)
    }],
    ['T10 auto-register 의 실제 batch 호출 인자 — 소스에서 읽은 그 인자로 모든 반례가 돈다', () => {
      assert.deepEqual(autoRegisterBatchArgs(), ['--strict-auto', '--json', '--require-hero'])
      const src = readFileSync(join(ROOT, 'scripts/magazine-auto-register.mjs'), 'utf8')
      assert.equal((src.match(/runStep\(BATCH_QA,/g) ?? []).length, 1, 'batch-qa 호출 지점이 하나가 아니다')
    }],
  ]
}

export async function runCases(cases) {
  let pass = 0
  const failures = []
  for (const [name, fn] of cases) {
    try { await fn(); pass += 1; console.log(`PASS ${name}`) }
    catch (e) { failures.push(name); console.log(`FAIL ${name} — ${String(e?.message ?? e).split('\n')[0].slice(0, 240)}`) }
  }
  return { pass, fail: failures.length, failures }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  if (process.argv.includes('--golden')) {
    const from = resolve(process.argv[process.argv.indexOf('--golden') + 1])
    const out = await legacyOutputs(from)
    mkdirSync(dirname(GOLDEN), { recursive: true })
    writeFileSync(GOLDEN, `${JSON.stringify(out, null, 2)}\n`)
    console.log(`golden ← ${from}`)
  } else {
    assert.ok(existsSync(GOLDEN), 'legacy golden 이 없다')
    const r = await runCases(topicForbiddenCases())
    console.log(`\nDIRECT 주제 금지 패턴 검사: ${r.pass} pass, ${r.fail} fail`)
    if (r.fail) process.exitCode = 1
  }
}

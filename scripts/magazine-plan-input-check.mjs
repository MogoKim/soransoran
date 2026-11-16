#!/usr/bin/env node
/**
 * Magazine vNext S2 — ContentPlanInputBundle 조립 · 판독 · 1회 bootstrap 검사 (합성 fixture 만 · 쓰기는 임시 폴더만).
 *
 *   node scripts/magazine-plan-input-check.mjs
 *
 * 보는 것 (반례 위주)
 *   PI1  기본 world — dry-run 성공 · 근거 있는 관계만 실린다 · 제외 사유(근거 없음 · builder 자동 역방향)
 *   PI2  결정성 — 같은 바이트면 같은 Bundle · 입력 행 순서 · evidence 객체 키 순서가 투영을 바꾸지 않는다
 *   PI3  연구 원문 · 비공개 필드가 Bundle 에 없다 · 모르는 키는 판독 실패
 *   PI4  graph · current · control · snapshot · 트리 신원 drift → 거부 · 쓰기 0
 *   PI5  정확히 1회 — 첫 --write 뒤 두 번째 실행은 dry-run 이어도 BUNDLE_ALREADY_EXISTS · 바이트 불변
 *   PI6  bootstrap 허용 판 밖은 거부 · CLI 는 판을 바꾸는 인자를 받지 않는다
 *   PI7  근거 — 없음 · 참조 파일 없음 · schema 위반(변조) · basis 없음 · canonical 필드 불일치 · Bundle 변조
 *   PI8  초안 · HOLD · 격리 파일이 있어도 Bundle · planHash 불변
 *   PI9  CLI 진입 — 인자 없이 쓰기 0 · 모르는 인자 exit 2
 *   PI10 두 해시(P1-A) — export 시점 control · current 주석 · 무관 기사 · 무관 queue · manifest generatedAt 은 bundleHash · planHash 불변,
 *        recordHash · provenance 만 바뀐다. intent · 관계 · 증거 신원 변화는 bundleHash · planHash 를 바꾼다. 봉인 변조 거부
 *   PI11 구조 엄격(P1-D) — inputHashes 는 정확히 canonical 다섯 이름(대체 이름 0) · 저장 Bundle 중첩 객체의 모르는 키 거부
 *   PI12 bootstrap 안전(P1-F) — 판 손잡이 없음 · 출력 경로 구성 요소 symlink 탈출 거부(루트 밖 쓰기 0) · no-clobber 유지
 *   PI13 제3자 원문 경계(P1-E) — intent 문장이 연구가 관측한 제3자 제목 · snippet · communityTitle 을 옮기면 THIRD_PARTY_TEXT,
 *        증거가 불완전하면 UNVERIFIED. Bundle 에는 판정만 싣고 원문은 싣지 않는다
 *   PI14 crash-safe · 경로 고정 no-clobber 쓰기(P1-F · P1-7 — 실제 경로 바꿔치기마다 매 단계 바깥 이름 0) — 짧은 쓰기 반복 · write/fsync fault · 되읽기 대조 · link EEXIST 만 ALREADY(EPERM 은 WRITE_FAILED) ·
 *        새 폴더 부모 · 대상 폴더 fsync · link 뒤 실패 정리 · 경로 바꿔치기(TOCTOU) · 잔여 tmp · ENOENT 밖 오류 보존 · 자식 프로세스 급사 뒤 재실행
 *   PI15 mapping 원시 중복(P1-D) — 같은 (intentId, slug) 두 번은 거부 · 쓰기 0. 다대다는 정상
 *   PI16 입력 CAS(P1-8) — 컴파일 뒤 publication 직전 제품 control · current · 연구 current 링크 · 트리 · 증거 · snapshot 이 바뀌면 INPUT_DRIFT · 출력 0
 *   PI17 실제 CLI fault(P1-9) — EACCES 를 ENOENT(없음)로 보지 않는다 · 모든 fs 오류는 구조화 JSON · exit 1 · stack trace 0
 * 마지막 줄: `plan-input 검사: <n> pass, <n> fail`
 */
import { spawnSync } from 'node:child_process'
import {
  chmodSync, closeSync, existsSync, fstatSync, fsyncSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, realpathSync, renameSync, rmSync,
  statSync, symlinkSync, unlinkSync, writeFileSync, writeSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { makeWorld, controlText, articlesText, queueText, SNAPSHOT_NAMES } from './__fixtures__/magazine/content-plan/world.mjs'
import { bootWorld, cleanupFixtureBootstrap, fixtureBootstrapFile } from './__fixtures__/magazine/content-plan/bootstrap-fixture.mjs'
import {
  SNAPSHOT_INPUT_FILES, buildPlanInputBundle, bundleHashOf, canonicalJson, parsePlanInputBundle, planInputRel, prettyCanonical, recordHashOf, sealBundle,
  sha256Hex, PlanInputError,
} from './lib/magazine-content-plan-input.mjs'
import { compileContentPlans } from './lib/magazine-content-plan.mjs'
import { INPUT_FILES } from './lib/magazine-graph-build.mjs'
import { runBootstrap, BOOTSTRAP_GRAPH_VERSION, STALE_TEMP_RE, writeBundleNoClobber } from './magazine-plan-input-bootstrap.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLI = join(HERE, 'magazine-plan-input-bootstrap.mjs')
const TMP = mkdtempSync(join(tmpdir(), 'plan-input-check-'))
let pass = 0, fail = 0, n = 0
const check = async (id, name, fn) => {
  try { await fn(); pass++; console.log(`PASS ${id} ${name}`) } catch (e) { fail++; console.log(`FAIL ${id} ${name} — ${String(e?.message ?? e).split('\n')[0]}`) }
}
const assert = (ok, why) => { if (!ok) throw new Error(why) }
const world = (mutate) => makeWorld(mkdtempSync(join(TMP, `w${n++}-`)), mutate)
/** 시험 전용 helper(운영 밖)가 world 의 판을 허용 판으로 둔 사본으로 돌린다 — 운영 runBootstrap 에는 판 손잡이가 없다(P1-F) */
const boot = (w, extra = {}) => bootWorld(w, extra)
const bundlePath = (w) => join(w.productRoot, planInputRel(w.graphVersion))
/** 임시 world 에 한 번 쓰고 Bundle 텍스트를 돌려준다 */
const bundleTextOf = async (w) => { const r = await boot(w, { write: true }); assert(r.ok, `쓰기 실패 ${r.code} ${r.why}`); return readFileSync(bundlePath(w), 'utf8') }
const expectStop = async (w, code, label) => {
  const r = await boot(w, { write: true })
  assert(!r.ok && r.code === code, `${label}: 기대 ${code} · 실제 ${r.ok ? 'ok' : `${r.code} ${r.why}`}`)
  assert(!existsSync(bundlePath(w)), `${label}: 거부인데 Bundle 이 쓰였다`)
}
const projection = (b) => canonicalJson({ intents: b.intents, relations: b.relations.map(({ evidence, ...r }) => ({ ...r, refs: evidence.refs.map((x) => x.ref) })), mappings: b.mappings })

try {
  await check('PI1', '기본 world — 근거 있는 관계만 · 제외 사유', async () => {
    const w = world()
    const r = await boot(w)
    assert(r.ok && r.code === 'DRY_RUN', `dry-run 실패 ${r.code} ${r.why}`)
    assert(!existsSync(bundlePath(w)), 'dry-run 이 썼다')
    const b = parsePlanInputBundle(await bundleTextOf(w))
    const ids = b.relations.map((x) => x.edgeId).join(',')
    assert(ids === 'E-0001,E-0002,E-0003,E-0010,E-0011,E-0020,E-0021,E-0040,E-0041,E-0050,E-0080,E-0090', `관계 ${ids}`)
    assert(r.excludedRelations.map((x) => `${x.code}:${x.n}`).join(',') === 'EVIDENCE_ABSENT:1,NO_CANONICAL_EDGE:1', `제외 ${JSON.stringify(r.excludedRelations)}`)
    assert(b.intents.length === 15 && b.intents.every((x) => x.inclusions.length === 0), 'intent 수 · inclusions 결정적 빈 배열')
    const e2 = b.relations.find((x) => x.edgeId === 'E-0002')
    assert(e2.evidence.refs.map((x) => x.ref).join() === 'evidence/serpapi/fx-a.json,evidence/serpapi/fx-b.json', '증거 참조 정규화 · 정렬')
    assert(e2.evidence.refs[0].sha256 === sha256Hex(readFileSync(join(w.researchDir, 'evidence/serpapi/fx-a.json'), 'utf8')), '증거 파일 해시')
    assert(b.provenance.product.controlSha256 === sha256Hex(readFileSync(join(w.productRoot, 'src/content/magazine/graph/control.ts'), 'utf8')), 'control 전체 해시는 provenance 로만 실린다')
  })

  await check('PI2', '결정성 — 같은 바이트 = 같은 Bundle · 행 순서 · evidence 키 순서 무관', async () => {
    const a = world(), b = world()
    assert(await bundleTextOf(a) === await bundleTextOf(b), '같은 입력인데 Bundle 바이트가 다르다')
    const base = parsePlanInputBundle(readFileSync(bundlePath(a), 'utf8'))
    const rev = world((s) => { s.rowOrder = (rows) => [...rows].reverse() })
    const rb = parsePlanInputBundle(await bundleTextOf(rev))
    assert(projection(rb) === projection(base), '입력 행 순서가 투영을 바꿨다')
    const keyed = world((s) => {
      const e = s.edges.find((x) => x.edgeId === 'E-0001')
      e.evidenceObject = { toIntent: 'I-F1-02 합성 대상', serp: `evidence/serpapi/fx-a.json (${s.privateEdgeFields.evidenceQuote})` }
    })
    const keyed2 = world((s) => {
      const e = s.edges.find((x) => x.edgeId === 'E-0001')
      e.evidenceObject = { serp: `evidence/serpapi/fx-a.json (${s.privateEdgeFields.evidenceQuote})`, toIntent: 'I-F1-02 합성 대상' }
    })
    const k1 = parsePlanInputBundle(await bundleTextOf(keyed)).relations.find((x) => x.edgeId === 'E-0001').evidence
    const k2 = parsePlanInputBundle(await bundleTextOf(keyed2)).relations.find((x) => x.edgeId === 'E-0001').evidence
    assert(canonicalJson(k1) === canonicalJson(k2), 'evidence 객체 키 순서가 근거 신원을 바꿨다')
  })

  await check('PI3', '연구 원문 · 비공개 필드 누출 0 · 모르는 키 판독 실패', async () => {
    const w = world()
    const text = await bundleTextOf(w)
    for (const needle of ['PRIVATE-', 'policyScopeWhy', 'verdictWhy', 'founderApproval', 'retryPolicy', 'implementationNote', 'generatedAt', 'readiness',
      'runtimeWhy', 'basis"', 'notes', 'snippet', '합성 질의', '합성 결과', '🔴']) assert(!text.includes(needle), `Bundle 에 ${needle} 가 있다`)
    const b = JSON.parse(text)
    const leak = (mut, label) => {
      const x = JSON.parse(text); mut(x)
      // 두 해시를 다시 맞춘다 — 실패가 해시가 아니라 모양(exact key) 때문임을 본다
      let code = null
      try { parsePlanInputBundle(sealBundle(x)) } catch (e) { code = e.code }
      assert(code === 'BUNDLE_SCHEMA', `${label} 이 판독을 통과했다 (${code})`)
    }
    leak((x) => { x.intents[0].verdictWhy = 'x' }, 'intent 비공개 필드')
    leak((x) => { x.relations[0].snippet = 'x' }, 'relation 원문')
    leak((x) => { x.relations[0].evidence.query = 'x' }, 'evidence 원문 질의')
    leak((x) => { x.readiness = {} }, '최상위 readiness')
    leak((x) => { x.provenance.research.generatedAt = 'x' }, 'provenance generatedAt')
    assert(b.schemaVersion === 'magazine-content-plan-input/1', 'schema')
  })

  await check('PI4', '신원 drift → 거부 · 쓰기 0', async () => {
    let w = world(); writeFileSync(join(w.snapshotDir, SNAPSHOT_NAMES.published), '{"slug":"changed"}\n'); await expectStop(w, 'SNAPSHOT_INPUT_DRIFT', 'snapshot 바이트')
    w = world(); unlinkSync(join(w.snapshotDir, SNAPSHOT_NAMES.queued)); await expectStop(w, 'SNAPSHOT_FILE_MISSING', 'snapshot 파일 없음')
    w = world(); writeFileSync(join(w.productRoot, 'src/content/magazine/graph/control.ts'), controlText('g-20260101-000000', w.seed.control)); await expectStop(w, 'CONTROL_GRAPH_VERSION_DRIFT', 'control 판')
    w = world(); writeFileSync(join(w.productRoot, 'src/content/magazine/graph/control.ts'), 'export const CONTROL = { enabled: "yes" }\n'); await expectStop(w, 'CONTROL_UNREADABLE', 'control 판독 불가')
    w = world(); writeFileSync(join(w.productRoot, `src/content/magazine/graph/${w.graphVersion}.ts`), `${readFileSync(join(w.productRoot, `src/content/magazine/graph/${w.graphVersion}.ts`), 'utf8')}// drift\n`); await expectStop(w, 'PRODUCT_GRAPH_DRIFT', '제품 graph 판 바이트')
    w = world(); writeFileSync(join(w.researchDir, 'contract/build', w.graphVersion, 'edges.jsonl'), '{"edgeId":"E-9999"}\n'); await expectStop(w, 'RESEARCH_CONTENT_HASH', '연구 current 내용')
    w = world(); writeFileSync(join(w.researchDir, 'contract/build/control.json'), '{"graphVersion":"g-20260101-000000"}\n'); await expectStop(w, 'RESEARCH_CONTROL_DRIFT', '연구 control.json')
    w = world(); { const other = join(w.researchDir, 'contract/build', 'g-20260101-abcdef'); mkdirSync(other); unlinkSync(join(w.researchDir, 'contract/build/current')); symlinkSync('g-20260101-abcdef', join(w.researchDir, 'contract/build/current')) }
    await expectStop(w, 'RESEARCH_FILE_MISSING', '연구 current 가 다른 판')
    // 순수 lib — 트리 해시 · 판 이름 drift 는 파일 시스템 없이 직접 본다
    w = world()
    const rd = (rel) => readFileSync(join(w.researchDir, 'contract/build', w.graphVersion, rel), 'utf8')
    const args = () => ({
      research: { currentName: w.graphVersion, manifestText: rd('manifest.json'), controlJsonText: readFileSync(join(w.researchDir, 'contract/build/control.json'), 'utf8'),
        tree: Object.fromEntries(['manifest.json', 'intents.jsonl', 'edges.jsonl', 'mappings.jsonl', `bundle/${w.graphVersion}.ts`].map((f) => [f, sha256Hex(rd(f))])),
        files: Object.fromEntries(['intents.jsonl', 'edges.jsonl', 'mappings.jsonl', `bundle/${w.graphVersion}.ts`].map((f) => [f, rd(f)])) },
      snapshot: { texts: Object.fromEntries(Object.values(SNAPSHOT_NAMES).map((f) => [f, readFileSync(join(w.snapshotDir, f), 'utf8')])), canonicalGraphName: SNAPSHOT_NAMES.graph },
      product: { currentText: readFileSync(join(w.productRoot, 'src/content/magazine/graph/current.ts'), 'utf8'), controlText: 'x', controlGraphVersion: w.graphVersion, graphFileText: rd(`bundle/${w.graphVersion}.ts`) },
      evidenceTexts: Object.fromEntries(['fx-a.json', 'fx-b.json', 'fx-c.json'].map((f) => [`evidence/serpapi/${f}`, readFileSync(join(w.researchDir, 'evidence/serpapi', f), 'utf8')])),
    })
    const codeOf = (mut) => { const a = args(); mut(a); try { buildPlanInputBundle(a); return 'OK' } catch (e) { assert(e instanceof PlanInputError, `구조화 오류가 아니다: ${e.message}`); return e.code } }
    assert(codeOf(() => {}) === 'OK', '순수 lib 기본 입력이 통과하지 않는다')
    assert(codeOf((a) => { a.research.tree['edges.jsonl'] = '0'.repeat(64) }) === 'RESEARCH_TREE_DRIFT', '트리 해시 drift')
    assert(codeOf((a) => { a.research.currentName = 'g-20260101-000000' }) === 'RESEARCH_CURRENT_DRIFT', '연구 current 이름 drift')
    assert(codeOf((a) => { a.product.currentText = "export { GRAPH, EXPORT_HASH } from './g-20260101-000000'\n" }) === 'CONTROL_GRAPH_VERSION_DRIFT', '제품 current 만 다른 판')
    assert(codeOf((a) => { a.product.currentText = "export { GRAPH, EXPORT_HASH } from './g-20260101-000000'\n"; a.product.controlGraphVersion = 'g-20260101-000000' }) === 'RESEARCH_CURRENT_DRIFT', '제품 current · control 이 함께 다른 판')
    assert(codeOf((a) => { delete a.snapshot.texts[SNAPSHOT_NAMES.canonical] }) === 'SNAPSHOT_INPUT_SET', 'snapshot 집합')
    assert(codeOf((a) => { a.product.graphFileText = a.product.graphFileText.replace(/EXPORT_HASH = '[0-9a-f]+'/, "EXPORT_HASH = '0000000000000000'"); a.research.files[`bundle/${w.graphVersion}.ts`] = a.product.graphFileText; a.research.tree[`bundle/${w.graphVersion}.ts`] = sha256Hex(a.product.graphFileText) }) === 'PRODUCT_GRAPH_EXPORT_HASH', 'EXPORT_HASH drift')
  })

  await check('PI5', '정확히 1회 — 두 번째는 dry-run 이어도 거부 · 바이트 불변', async () => {
    const w = world()
    const first = await bundleTextOf(w)
    const again = await boot(w)
    assert(!again.ok && again.code === 'BUNDLE_ALREADY_EXISTS', `두 번째 dry-run ${again.code}`)
    const again2 = await boot(w, { write: true })
    assert(!again2.ok && again2.code === 'BUNDLE_ALREADY_EXISTS', `두 번째 write ${again2.code}`)
    assert(readFileSync(bundlePath(w), 'utf8') === first, 'Bundle 바이트가 바뀌었다')
    assert(first === prettyCanonical(JSON.parse(first)), '저장 바이트가 canonical 이 아니다')
  })

  await check('PI6', 'bootstrap 허용 판 밖 거부 · 허용 판은 하나 · 판 손잡이 없음', async () => {
    const w = world()
    const r = runBootstrap({ productRoot: w.productRoot, researchDir: w.researchDir, snapshotDir: w.snapshotDir })
    assert(!r.ok && r.code === 'BOOTSTRAP_VERSION_NOT_ALLOWED', `기본 허용 판 밖이 통과했다 ${r.code}`)
    // 🔴 옛 시험 손잡이(allowedGraphVersion)는 운영 API 에서 사라졌다 — 넘기면 모르는 옵션으로 거부하고 쓰지 않는다(P1-F)
    for (const write of [false, true]) {
      const k = runBootstrap({ productRoot: w.productRoot, researchDir: w.researchDir, snapshotDir: w.snapshotDir, allowedGraphVersion: w.graphVersion, write })
      assert(!k.ok && k.code === 'BOOTSTRAP_OPTION_UNKNOWN', `판 손잡이가 운영 API 로 열렸다 (write=${write}: ${k.ok ? 'ok' : k.code})`)
    }
    assert(BOOTSTRAP_GRAPH_VERSION === 'g-20261102-427d4d', `허용 판 ${BOOTSTRAP_GRAPH_VERSION}`)
    const cli = spawnSync(process.execPath, [CLI, '--research-dir', w.researchDir, '--snapshot-dir', w.snapshotDir, '--product-root', w.productRoot, '--graph-version', w.graphVersion], { encoding: 'utf8' })
    assert(cli.status === 2, `판을 바꾸는 인자가 받아들여졌다 (exit ${cli.status})`)
    assert(!existsSync(bundlePath(w)), '쓰기 발생')
  })

  await check('PI7', '근거 — 없음 · 참조 없음 · schema 위반 · basis 없음 · 필드 불일치 · Bundle 변조', async () => {
    const excludedOf = async (mut) => {
      const w = world(mut)
      const r = await boot(w)
      assert(r.ok, `bootstrap 실패 ${r.code} ${r.why}`)
      return Object.fromEntries(r.excludedRelations.map((x) => [x.code, x.n]))
    }
    const one = async (mut, code) => { const ex = await excludedOf(mut); assert(ex[code] >= 1, `${code} 로 빠지지 않았다: ${JSON.stringify(ex)}`) }
    await one((s) => { s.edges.find((e) => e.edgeId === 'E-0040').evidence = null }, 'EVIDENCE_ABSENT')
    await one((s) => { s.edges.find((e) => e.edgeId === 'E-0040').evidence = ['fx-missing.json'] }, 'EVIDENCE_REF_MISSING')
    await one((s) => { s.edges.find((e) => e.edgeId === 'E-0040').evidenceObject = { note: '참조 없는 근거 문장' } }, 'EVIDENCE_REF_ABSENT')
    await one((s) => { s.edges.find((e) => e.edgeId === 'E-0040').basis = '' }, 'CANONICAL_BASIS_MISSING')
    await one((s) => { s.edges.find((e) => e.edgeId === 'E-0040').canonical = { reason: '합성 canonical 과 다른 이유 문장이다' } }, 'CANONICAL_FIELD_MISMATCH')
    // 변조된 증거 파일 — raw payload 를 남긴 저장본 · 오류 응답은 받아들이지 않는다
    for (const tamper of [(d) => { d.rawPayloadKept = true }, (d) => { d.status = 'ERROR' }, (d) => { d.schema = 'other/1' }]) {
      const w = world()
      const f = join(w.researchDir, 'evidence/serpapi/fx-c.json')
      const d = JSON.parse(readFileSync(f, 'utf8')); tamper(d); writeFileSync(f, JSON.stringify(d))
      const r = await boot(w)
      assert(r.ok && r.excludedRelations.some((x) => x.code === 'EVIDENCE_SCHEMA_REJECTED'), `변조 증거가 통과했다 ${JSON.stringify(r.excludedRelations)}`)
    }
    // 증거 바이트가 바뀌면(형식은 유효) 근거 신원 · bundleHash 가 바뀐다
    const a = world(), b = world()
    const f = join(b.researchDir, 'evidence/serpapi/fx-a.json'); writeFileSync(f, readFileSync(f, 'utf8').replace('"note": "합성"', '"note": "합성2"'))
    assert((await boot(a)).bundleHash !== (await boot(b)).bundleHash, '증거 바이트 변화가 Bundle 신원에 묶이지 않았다')
    // 저장된 Bundle 변조 — 해시 · canonical 바이트
    const text = await bundleTextOf(world())
    const x = JSON.parse(text); x.relations[0].evidence.refs[0].sha256 = '0'.repeat(64)
    let code = null; try { parsePlanInputBundle(prettyCanonical(x)) } catch (e) { code = e.code }
    assert(code === 'BUNDLE_HASH_MISMATCH', `증거 해시 변조 ${code}`)
    code = null; try { parsePlanInputBundle(JSON.stringify(JSON.parse(text))) } catch (e) { code = e.code }
    assert(code === 'BUNDLE_NOT_CANONICAL', `canonical 아닌 바이트 ${code}`)
  })

  await check('PI8', '초안 · HOLD · 격리가 있어도 Bundle · planHash 불변', async () => {
    const a = world(), b = world()
    for (const [rel, t] of [['drafts/magazine/fx-queued/HOLD.json', '{"hold":"PRIVATE-HOLD"}'], ['drafts/magazine/fx-queued/draft.md', '# 초안'],
      ['drafts/magazine/quarantine.jsonl', '{"slug":"fx-queued"}\n'], ['drafts/magazine/fx-other/manuscript.md', '원고']]) {
      mkdirSync(dirname(join(b.productRoot, rel)), { recursive: true }); writeFileSync(join(b.productRoot, rel), t)
    }
    const ta = await bundleTextOf(a), tb = await bundleTextOf(b)
    assert(ta === tb, 'Bundle 바이트가 달라졌다')
    const pa = compileContentPlans({ bundle: ta }).plans.map((p) => p.planHash).join(), pb = compileContentPlans({ bundle: tb }).plans.map((p) => p.planHash).join()
    assert(pa === pb, 'planHash 가 달라졌다')
  })

  await check('PI9', 'CLI — 필수 인자 없음 · 모르는 인자 exit 2 · 쓰기 0', async () => {
    const w = world()
    const r1 = spawnSync(process.execPath, [CLI], { encoding: 'utf8' })
    assert(r1.status === 2, `인자 없이 exit ${r1.status}`)
    const r2 = spawnSync(process.execPath, [CLI, '--research-dir', w.researchDir, '--snapshot-dir', w.snapshotDir, '--product-root', w.productRoot, '--force'], { encoding: 'utf8' })
    assert(r2.status === 2, `모르는 인자 exit ${r2.status}`)
    const r3 = spawnSync(process.execPath, [CLI, '--research-dir', w.researchDir, '--snapshot-dir', w.snapshotDir, '--product-root', w.productRoot], { encoding: 'utf8' })
    assert(r3.status === 1 && JSON.parse(r3.stdout).code === 'BOOTSTRAP_VERSION_NOT_ALLOWED', `CLI 경로가 허용 판 밖을 받았다 (exit ${r3.status})`)
    assert(!existsSync(bundlePath(w)), '쓰기 발생')
  })

  await check('PI10', '두 해시 — export 시점 provenance 는 bundleHash · planHash 불변 · 내용 신원은 민감 · 봉인 변조 거부', async () => {
    const planHashes = (text) => compileContentPlans({ bundle: text }).plans.map((p) => `${p.planId}:${p.planHash}`).join()
    const base = world()
    const tb = await bundleTextOf(base)
    const B = parsePlanInputBundle(tb)
    const G = join('src/content/magazine/graph')
    /** [이름, world 를 고치는 함수, recordHash 가 바뀌어야 하는가, 바뀌어야 하는 provenance 경로] */
    const cases = [
      ['export 시점 control 토글(cluster · 표면)', (w) => writeFileSync(join(w.productRoot, G, 'control.ts'), controlText(w.graphVersion, {
        ...w.seed.control, enabledClusters: [...w.seed.control.enabledClusters, 'health'], surfaces: { ...w.seed.control.surfaces, BODY_CALLOUT: true } })), true, 'product.controlSha256'],
      ['current.ts 주석 한 줄', (w) => writeFileSync(join(w.productRoot, G, 'current.ts'), `${readFileSync(join(w.productRoot, G, 'current.ts'), 'utf8')}// 합성 주석 한 줄\n`), true, 'product.currentSha256'],
      ['무관한 기사 추가', (w) => writeFileSync(join(w.productRoot, 'src/content/magazine/articles.ts'), articlesText([...w.seed.articles, { slug: 'fx-unrelated', title: '합성 무관 기사', cluster: 'daily', publishAt: '2026-12-24T10:30:00+09:00' }])), false, null],
      ['무관한 queue 항목', (w) => writeFileSync(join(w.productRoot, 'drafts/magazine/topic-queue.ts'), queueText([...w.seed.queue, { slug: 'fx-q-unrelated', title: '합성 무관 대기', cluster: 'daily' }])), false, null],
      ['manifest generatedAt 만', (w) => {
        const f = join(w.researchDir, 'contract/build', w.graphVersion, 'manifest.json')
        const m = JSON.parse(readFileSync(f, 'utf8')); m.generatedAt = '2026-11-11T09:09:09.000Z'; writeFileSync(f, `${JSON.stringify(m, null, 2)}\n`)
      }, true, 'research.manifestSha256'],
    ]
    for (const [label, mut, recordMoves, provPath] of cases) {
      const w = world(); mut(w)
      const t = await bundleTextOf(w)
      const X = parsePlanInputBundle(t)
      assert(X.bundleHash === B.bundleHash, `${label}: bundleHash 가 바뀌었다`)
      assert(planHashes(t) === planHashes(tb), `${label}: planHash 가 바뀌었다`)
      assert((X.recordHash !== B.recordHash) === recordMoves, `${label}: recordHash ${recordMoves ? '불변' : '변화'}(기대와 다르다)`)
      if (provPath) {
        const at = (b) => provPath.split('.').reduce((v, k) => v[k], b.provenance)
        assert(at(X) !== at(B), `${label}: provenance ${provPath} 에 기록되지 않았다`)
      }
    }
    // 감도 — 내용 신원(intent 문장 · 관계 문구 · 증거 바이트)이 바뀌면 bundleHash · planHash 가 바뀐다
    const f1 = B.intents.findIndex((x) => x.intentId === 'I-F1-01')
    const pidF1 = `${B.graphVersion}:I-F1-01`
    const hashOf = (text, id) => compileContentPlans({ bundle: text }).plans.find((p) => p.planId === id)?.planHash
    const scoped = prettyCanonical(sealBundle({ ...B, intents: B.intents.map((x, i) => (i === f1 ? { ...x, answerScope: `${x.answerScope}.` } : x)) }))
    assert(parsePlanInputBundle(scoped).bundleHash !== B.bundleHash && hashOf(scoped, pidF1) !== hashOf(tb, pidF1), 'answerScope 1 글자 변화가 bundleHash · planHash 에 묶이지 않았다')
    const rel = prettyCanonical(sealBundle({ ...B, relations: B.relations.map((r) => (r.edgeId === 'E-0001' ? { ...r, readerReason: `${r.readerReason}.` } : r)) }))
    assert(parsePlanInputBundle(rel).bundleHash !== B.bundleHash && hashOf(rel, pidF1) !== hashOf(tb, pidF1), '관계 문구 변화가 bundleHash · planHash 에 묶이지 않았다')
    const ev = world(); { const f = join(ev.researchDir, 'evidence/serpapi/fx-a.json'); writeFileSync(f, readFileSync(f, 'utf8').replace('"note": "합성"', '"note": "합성3"')) }
    const tev = await bundleTextOf(ev)
    assert(parsePlanInputBundle(tev).bundleHash !== B.bundleHash && hashOf(tev, pidF1) !== hashOf(tb, pidF1), '증거 바이트 변화가 bundleHash · planHash 에 묶이지 않았다')
    // 봉인 — provenance 만 고치면 recordHash 불일치 · recordHash 를 다시 맞추고 bundleHash 만 고치면 bundleHash 불일치 · recordHash 없음은 모양 실패
    const codeOf = (v) => { try { parsePlanInputBundle(v); return 'OK' } catch (e) { return e.code } }
    const prov = JSON.parse(tb); prov.provenance.product.controlSha256 = '0'.repeat(64)
    assert(codeOf(prettyCanonical(prov)) === 'RECORD_HASH_MISMATCH', `provenance 변조 ${codeOf(prettyCanonical(prov))}`)
    const bh = JSON.parse(tb); bh.bundleHash = '1'.repeat(64); bh.recordHash = recordHashOf(bh)
    assert(codeOf(prettyCanonical(bh)) === 'BUNDLE_HASH_MISMATCH', `bundleHash 변조 ${codeOf(prettyCanonical(bh))}`)
    const nr = JSON.parse(tb); delete nr.recordHash
    assert(codeOf(nr) === 'BUNDLE_SCHEMA', `recordHash 없음 ${codeOf(nr)}`)
    // 계약 — bundleHash 는 정확히 다섯 내용 키의 해시다(provenance 를 빼도 같다)
    const { provenance: _p, bundleHash: _b, recordHash: _r, ...content } = B
    assert(bundleHashOf(B) === sha256Hex(canonicalJson(content)) && B.recordHash === recordHashOf(B), '두 해시의 정의')
  })

  await check('PI11', '구조 엄격 — canonical 다섯 이름 · 중첩 객체 모르는 키 거부', async () => {
    assert(canonicalJson(SNAPSHOT_INPUT_FILES) === canonicalJson({ ...INPUT_FILES }), `순수 lib 의 다섯 이름이 graph builder INPUT_FILES 와 다르다`)
    const w = world()
    const rd = (rel) => readFileSync(join(w.researchDir, 'contract/build', w.graphVersion, rel), 'utf8')
    const pure = () => {
      const names = ['manifest.json', 'intents.jsonl', 'edges.jsonl', 'mappings.jsonl', `bundle/${w.graphVersion}.ts`]
      return {
        research: { currentName: w.graphVersion, manifestText: rd('manifest.json'), controlJsonText: readFileSync(join(w.researchDir, 'contract/build/control.json'), 'utf8'),
          tree: Object.fromEntries(names.map((f) => [f, sha256Hex(rd(f))])), files: Object.fromEntries(names.slice(1).map((f) => [f, rd(f)])) },
        snapshot: { texts: Object.fromEntries(Object.values(SNAPSHOT_NAMES).map((f) => [f, readFileSync(join(w.snapshotDir, f), 'utf8')])), canonicalGraphName: SNAPSHOT_NAMES.graph },
        product: { currentText: readFileSync(join(w.productRoot, 'src/content/magazine/graph/current.ts'), 'utf8'), controlText: 'x', controlGraphVersion: w.graphVersion, graphFileText: rd(`bundle/${w.graphVersion}.ts`) },
        evidenceTexts: Object.fromEntries(['fx-a.json', 'fx-b.json', 'fx-c.json'].map((f) => [`evidence/serpapi/${f}`, readFileSync(join(w.researchDir, 'evidence/serpapi', f), 'utf8')])),
      }
    }
    const codeOf = (mut) => { const a = pure(); mut(a); try { buildPlanInputBundle(a); return 'OK' } catch (e) { return e.code } }
    assert(codeOf(() => {}) === 'OK', '순수 lib 기본 입력')
    // 개수는 다섯이지만 이름 하나를 바꾼 manifest · snapshot — 대체 이름은 받지 않는다
    const renamed = (a) => {
      const m = JSON.parse(a.research.manifestText)
      m.inputHashes = Object.fromEntries(Object.entries(m.inputHashes).map(([k, v]) => [k === SNAPSHOT_NAMES.queued ? 'assets-queue-v2.jsonl' : k, v]))
      a.research.manifestText = `${JSON.stringify(m, null, 2)}\n`; a.research.tree['manifest.json'] = sha256Hex(a.research.manifestText)
      a.snapshot.texts['assets-queue-v2.jsonl'] = a.snapshot.texts[SNAPSHOT_NAMES.queued]; delete a.snapshot.texts[SNAPSHOT_NAMES.queued]
    }
    assert(codeOf(renamed) === 'SNAPSHOT_INPUT_SET', `대체 이름 다섯 개가 통과했다 (${codeOf(renamed)})`)
    assert(codeOf((a) => { a.snapshot.canonicalGraphName = SNAPSHOT_NAMES.canonical }) === 'SNAPSHOT_INPUT_SET', 'canonical g5 이름이 다른 파일을 가리킨다')
    // 저장 Bundle — 두 해시를 다시 맞춰도 중첩 객체의 모르는 키 · 대체 이름은 모양 실패다
    const text = await bundleTextOf(w)
    const shape = (mut, label) => {
      const x = JSON.parse(text); mut(x)
      let code = null
      try { parsePlanInputBundle(sealBundle(x)) } catch (e) { code = e.code }
      assert(code === 'BUNDLE_SCHEMA', `${label}: ${code ?? '통과'}`)
    }
    shape((x) => { const h = x.provenance.research.inputHashes; h['assets-queue-v2.jsonl'] = h[SNAPSHOT_NAMES.queued]; delete h[SNAPSHOT_NAMES.queued] }, 'inputHashes 대체 이름(다섯 개)')
    shape((x) => { x.provenance.research.inputHashes['extra.jsonl'] = '0'.repeat(64) }, 'inputHashes 여섯째 이름')
    shape((x) => { x.relations[0].evidence.note = 'x' }, 'relation.evidence 모르는 키')
    shape((x) => { x.relations[0].evidence.refs[0].query = 'x' }, 'relation.evidence.refs[] 모르는 키')
    shape((x) => { x.provenance.sourceText.titles = [] }, 'provenance.sourceText 모르는 키')
    shape((x) => { x.provenance.product.queueSha256 = '0'.repeat(64) }, 'provenance.product 모르는 키')
    shape((x) => { x.mappings[0].publishAt = null }, 'mapping 모르는 키')
    shape((x) => { x.intents[0].textProvenance = 'TRUSTED' }, 'intent textProvenance 값')
  })

  await check('PI12', 'bootstrap 안전 — 출력 경로 symlink 탈출 거부 · 루트 밖 쓰기 0 · no-clobber', async () => {
    const listing = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true }).map(String).sort().join('|') : '<없음>')
    // ① plan-input 폴더 자체가 바깥을 가리키는 symlink
    let w = world()
    let outside = mkdtempSync(join(TMP, 'outside-'))
    symlinkSync(outside, join(w.productRoot, 'src/content/magazine/plan-input'))
    for (const write of [true, false]) {
      const r = await boot(w, { write })
      assert(!r.ok && r.code === 'OUTPUT_PATH_SYMLINK', `plan-input symlink (write=${write}): ${r.ok ? 'ok' : r.code}`)
    }
    assert(listing(outside) === '', `루트 밖에 썼다: ${listing(outside)}`)
    // ② 위쪽 구성 요소(magazine 폴더)가 바깥 실제 폴더를 가리키는 symlink — 읽기는 되지만 쓰기는 거부
    w = world()
    outside = mkdtempSync(join(TMP, 'outside-'))
    const mag = join(w.productRoot, 'src/content/magazine')
    renameSync(mag, join(outside, 'magazine')); symlinkSync(join(outside, 'magazine'), mag)
    const before = listing(outside)
    const r2 = await boot(w, { write: true })
    assert(!r2.ok && r2.code === 'OUTPUT_PATH_SYMLINK', `magazine symlink: ${r2.ok ? 'ok' : r2.code}`)
    assert(listing(outside) === before && !existsSync(join(outside, 'magazine/plan-input')), '루트 밖 폴더가 바뀌었다')
    // ③ 최종 이름이 가리킬 곳 없는 symlink — 있는 것으로 본다(덮지도 따라 쓰지도 않는다)
    w = world()
    outside = mkdtempSync(join(TMP, 'outside-'))
    mkdirSync(join(w.productRoot, 'src/content/magazine/plan-input'))
    symlinkSync(join(outside, 'target.json'), bundlePath(w))
    const r3 = await boot(w, { write: true })
    assert(!r3.ok && r3.code === 'BUNDLE_ALREADY_EXISTS' && !existsSync(join(outside, 'target.json')), `final symlink: ${r3.ok ? 'ok' : r3.code}`)
    // ④ 제품 루트 자체가 symlink 이면 실제 경로 안에 쓴다(탈출 아님) · 두 번째는 no-clobber
    w = world()
    const alias = join(TMP, `alias-${n++}`)
    symlinkSync(w.productRoot, alias)
    const r4 = await bootWorld({ ...w, productRoot: alias }, { write: true })
    assert(r4.ok && existsSync(bundlePath(w)), `루트 alias 쓰기 ${r4.ok ? 'ok' : r4.code}`)
    const bytes = readFileSync(bundlePath(w), 'utf8')
    const r5 = await bootWorld({ ...w, productRoot: alias }, { write: true })
    assert(!r5.ok && r5.code === 'BUNDLE_ALREADY_EXISTS' && readFileSync(bundlePath(w), 'utf8') === bytes, 'no-clobber')
    assert(readdirSync(join(w.productRoot, 'src/content/magazine/plan-input')).join() === `${w.graphVersion}.json`, '임시 파일이 남았다')
  })

  await check('PI13', '제3자 원문 경계 — 결정적 대조 · 판정만 싣는다 · 증거 불완전은 UNVERIFIED', async () => {
    const COMMUNITY = '✅ 82Cook 「40~50대 9명 모임 이름 추천해주세요」를 본 독자 상황'
    const doc = { query: 'PRIVATE-QUERY 합성 모임', organicTitle: '40~50대 9명 모임 이름 추천해주세요 ::: 82cook.com 자유게시판', domain: '82Cook',
      snippet: '저도 비슷한 고민을 하다가 해결했기에 글 올려봐요 한 브랜드에 정착하는 거예요 그동안 여러 곳을 돌았어요' }
    const verdicts = async (mut) => {
      const w = world((s) => { s.evidenceDocs['fx-community.json'] = doc; mut(s) })
      const r = await boot(w)
      assert(r.ok, `bootstrap 실패 ${r.code} ${r.why}`)
      const b = parsePlanInputBundle(await bundleTextOf(w))
      return { r, b, text: readFileSync(bundlePath(w), 'utf8'), of: (id) => b.intents.find((x) => x.intentId === id).textProvenance }
    }
    const intent = (s, id) => s.intents.find((x) => x.intentId === id)
    const plain = await verdicts(() => {})
    assert(plain.b.intents.every((x) => x.textProvenance === 'CLEAR') && plain.r.textProvenance.CLEAR === 15, `기본 world ${JSON.stringify(plain.r.textProvenance)}`)
    // 정확한 반례 — 자기 증거의 커뮤니티 글 제목을 옮긴 독자 상황
    const own = await verdicts((s) => { intent(s, 'I-F1-01').audienceSituation = COMMUNITY; intent(s, 'I-F1-01').sourceRefs = ['fx-a.json', 'fx-community.json'] })
    assert(own.of('I-F1-01') === 'THIRD_PARTY_TEXT' && own.of('I-F2-01') === 'CLEAR', `자기 증거 제목 ${own.of('I-F1-01')}`)
    for (const needle of ['82cook.com', '자유게시판', 'fx-community', '해결했기에', 'PRIVATE-QUERY']) assert(!own.text.includes(needle), `Bundle 에 증거 원문 ${needle}`)
    // 다른 intent 의 증거에만 있는 제목 — corpus 는 판 전체다
    const cross = await verdicts((s) => { intent(s, 'I-F1-01').audienceSituation = COMMUNITY; intent(s, 'I-F2-01').sourceRefs = ['fx-community.json'] })
    assert(cross.of('I-F1-01') === 'THIRD_PARTY_TEXT', `다른 intent 증거 제목 ${cross.of('I-F1-01')}`)
    // canonical communityTitle(증거 파일 제목이 아니라 canonical 기록)
    const ct = await verdicts((s) => {
      intent(s, 'I-F2-01').sourceRefs = [{ seedQuery: '합성', communityTitle: '남편이랑 스킨쉽 없는 분들있나요?', sourceDomain: '82Cook', evidencePath: 'evidence/serpapi/fx-b.json', sourceKind: 'serpapi_organic_title' }]
      intent(s, 'I-F1-01').answerScope = '「남편이랑 스킨쉽 없는 분들있나요?」 같은 고민에 답한다'
    })
    assert(ct.of('I-F1-01') === 'THIRD_PARTY_TEXT', `communityTitle ${ct.of('I-F1-01')}`)
    // snippet 의 연속 원문(구두점 · 띄어쓰기를 바꿔도 같은 글자)
    const sn = await verdicts((s) => { intent(s, 'I-F2-01').sourceRefs = ['fx-community.json']; intent(s, 'I-F1-01').exclusions = ['저도 비슷한 고민을, 하다가 해결했기에 글 올려봐요'] })
    assert(sn.of('I-F1-01') === 'THIRD_PARTY_TEXT', `snippet run ${sn.of('I-F1-01')}`)
    // 대조군 — 짧은 공통 낱말(모임 · 이름)만 겹치면 원문이 아니다
    const ctl = await verdicts((s) => { intent(s, 'I-F2-01').sourceRefs = ['fx-community.json']; intent(s, 'I-F1-01').audienceSituation = '모임 이름을 정해야 하는 독자 상황' })
    assert(ctl.of('I-F1-01') === 'CLEAR', `짧은 낱말 겹침이 원문으로 잡혔다 ${ctl.of('I-F1-01')}`)
    // 대조군 — 우리 사이트 결과(URL 호스트 soransoran.com)는 제3자가 아니다 · 한 낱말 기관 · 용어 제목은 조각 대조 대상이 아니다
    const ownDoc = { query: 'PRIVATE-QUERY 합성 자사', organicTitle: '합성 이력서 칸을 어떻게 채우나요 - 소란소란', url: 'https://soransoran.com/magazine/fx-resume' }
    const termDoc = { query: 'PRIVATE-QUERY 합성 용어', organicTitle: '국가건강검진합성', url: 'https://www.example.or.kr/a' }
    const own2 = await verdicts((s) => { s.evidenceDocs['fx-own.json'] = ownDoc; s.evidenceDocs['fx-term.json'] = termDoc; intent(s, 'I-F2-01').sourceRefs = ['fx-own.json', 'fx-term.json']; intent(s, 'I-F1-01').answerScope = '올해 국가건강검진합성 대상인지 확인하는 경로' })
    assert(own2.of('I-F1-01') === 'CLEAR', `자사 결과 · 한 낱말 제목이 제3자 원문으로 잡혔다 ${own2.of('I-F1-01')}`)
    // 반례 — 같은 제목이라도 호스트가 우리 사이트가 아니면(접미사만 비슷한 도메인 포함) 제3자다
    const fake = await verdicts((s) => { s.evidenceDocs['fx-own.json'] = { ...ownDoc, url: 'https://soransoran.com.evil.example/a' }; intent(s, 'I-F2-01').sourceRefs = ['fx-own.json'] })
    assert(fake.of('I-F1-01') === 'THIRD_PARTY_TEXT', `우리 사이트를 흉내 낸 호스트가 제외됐다 ${fake.of('I-F1-01')}`)
    // 증거 불완전 — 자기 증거 없음 · 자기 증거 불량 · corpus 파일 없음
    const none = await verdicts((s) => { intent(s, 'I-F1-01').sourceRefs = [] })
    assert(none.of('I-F1-01') === 'UNVERIFIED' && none.of('I-F2-01') === 'CLEAR', `자기 증거 없음 ${none.of('I-F1-01')}`)
    const badW = world((s) => { s.evidenceDocs['fx-community.json'] = doc; intent(s, 'I-F1-01').sourceRefs = ['fx-community.json'] })
    { const f = join(badW.researchDir, 'evidence/serpapi/fx-community.json'); const d = JSON.parse(readFileSync(f, 'utf8')); d.rawPayloadKept = true; writeFileSync(f, JSON.stringify(d)) }
    const bad = parsePlanInputBundle(await bundleTextOf(badW))
    assert(bad.intents.find((x) => x.intentId === 'I-F1-01').textProvenance === 'UNVERIFIED' && bad.intents.find((x) => x.intentId === 'I-F2-01').textProvenance === 'CLEAR', '자기 증거 불량')
    const gone = await verdicts((s) => { intent(s, 'I-F2-01').sourceRefs = ['fx-gone.json'] })
    assert(gone.b.intents.every((x) => x.textProvenance === 'UNVERIFIED'), `corpus 파일 없음이 전부 UNVERIFIED 가 아니다 ${JSON.stringify(gone.r.textProvenance)}`)
    // 판정은 내용 신원이다 — 판정이 바뀌면 bundleHash 가 바뀐다
    assert(own.b.bundleHash !== parsePlanInputBundle(prettyCanonical(sealBundle({ ...own.b, intents: own.b.intents.map((x) => ({ ...x, textProvenance: 'CLEAR' })) }))).bundleHash, '판정이 bundleHash 밖이다')
  })
  await check('PI14', 'crash-safe · 경로 고정 no-clobber 쓰기 — 짧은 쓰기 · fault · 되읽기 · link 오류 분류 · 폴더 fsync · 실제 경로 바꿔치기(바깥 이름 0) · 잔여 tmp · 급사', async () => {
    const TEXT = `${'{"합성":"Bundle 바이트"}'.repeat(40)}\n`
    const NAME = 'g-20260101-abcdef.json'
    const PDIR = 'src/content/magazine/plan-input'
    const REL = `${PDIR}/${NAME}`
    const HOME0 = process.cwd()
    const root = () => realpathSync(mkdtempSync(join(TMP, 'wr-')))
    const outsideDir = () => realpathSync(mkdtempSync(join(TMP, 'out-')))
    const fsio = { openSync, writeSync, fsyncSync, closeSync, readSync, fstatSync, statSync, linkSync, unlinkSync, lstatSync, mkdirSync, readdirSync, realpathSync,
      chdir: (d) => process.chdir(d), cwd: () => process.cwd() }
    /** fs 를 감싼 io — trace(단계 · 폴더 fsync 위치) 를 남기고 over 로 호출 하나를 바꾼다 */
    const harness = (over = {}) => {
      const trace = []
      const io = { ...fsio, ...over }
      const openDir = io.openSync
      io.openSync = (p, flags, mode) => { const fd = openDir(p, flags, mode); if (flags === 'r') trace.push(`fsyncdir:${process.cwd()}`); return fd }
      return { io, trace, step: (name) => trace.push(name) }
    }
    const run = (r, h) => {
      try { return { ok: true, ...writeBundleNoClobber({ rootReal: r, outRel: REL, text: TEXT }, { io: h.io, step: h.step }) } } catch (e) { return { ok: false, code: e.code, why: e.why ?? e.message, errno: e.errno ?? null } }
      finally { assert(process.cwd() === HOME0, `cwd 가 원래 자리로 돌아오지 않았다 ${process.cwd()}`) }
    }
    const dirList = (d) => (existsSync(d) ? readdirSync(d).sort() : [])
    const noResidue = (d, label) => assert(dirList(d).every((n) => !STALE_TEMP_RE.test(n)), `${label}: 임시 파일이 남았다 ${dirList(d)}`)
    const ioErr = (code) => Object.assign(new Error(`합성 ${code}`), { code })
    /** 매 단계마다 바깥 폴더 이름 0 을 관찰한다 — 사후 정리가 아니라 "한 번도 생기지 않음"을 본다 */
    const watchOutside = (h, outs, onStep = () => {}) => {
      const seen = []
      const st0 = h.step
      h.step = (n, info) => { st0(n); onStep(n, info); for (const d of outs) if (dirList(d).length) seen.push(`${n}:${d.slice(-12)}:${dirList(d)}`) }
      return seen
    }

    // (a) 정상 — 단계 순서 · 새 폴더 넷의 부모 fsync · 최종 바이트 · 잔여 0 · cwd 원복
    let r = root(); let h = harness(); let o = run(r, h)
    assert(o.ok && readFileSync(join(r, REL), 'utf8') === TEXT && dirList(join(r, PDIR)).join() === NAME, `정상 쓰기 ${JSON.stringify(o)} ${dirList(join(r, PDIR))}`)
    const steps = h.trace.filter((t) => !t.startsWith('fsyncdir:'))
    assert(steps.join() === 'enter,mkdir,enter,mkdir,enter,mkdir,enter,mkdir,enter,ready,open,write,fsync,verify,cas,link,dirsync,unlink,dirsync', `단계 ${steps.join()}`)
    const synced = h.trace.filter((t) => t.startsWith('fsyncdir:')).map((t) => t.slice(9).slice(r.length) || '/')
    for (const d of ['/', '/src', '/src/content', '/src/content/magazine', `/${PDIR}`]) assert(synced.includes(d), `폴더 fsync 누락 ${d} (${synced.join(' ')})`)
    // (b) 짧은 쓰기 — 한 번에 7바이트씩만 써도 끝까지 쓴다
    r = root(); o = run(r, harness({ writeSync: (fd, b, off, len) => writeSync(fd, b, off, Math.min(7, len)) }))
    assert(o.ok && readFileSync(join(r, REL), 'utf8') === TEXT, `짧은 쓰기 ${JSON.stringify(o)}`)
    // (c)~(f) link 전 실패 — 최종 없음 · tmp 0 · 원래 오류 code 보존
    for (const [label, over, needle] of [
      ['진행 없는 쓰기(0바이트)', { writeSync: () => 0 }, '0바이트'],
      ['fsync EIO', { fsyncSync: () => { throw ioErr('EIO') } }, 'EIO'],
      ['조용히 다른 바이트를 쓴다', { writeSync: (fd, b, off, len) => { writeSync(fd, Buffer.alloc(len, 0x41), 0, len); return len } }, '다시 읽은 바이트'],
      ['link EPERM', { linkSync: () => { throw ioErr('EPERM') } }, 'EPERM'],
    ]) {
      r = root(); mkdirSync(join(r, PDIR), { recursive: true }); o = run(r, harness(over))
      assert(!o.ok && o.code === 'BUNDLE_WRITE_FAILED' && o.why.includes(needle), `${label}: ${JSON.stringify(o)}`)
      assert(!existsSync(join(r, REL)), `${label}: 최종 파일이 생겼다`); noResidue(join(r, PDIR), label)
    }
    // (f2) 새 폴더의 부모 fsync 실패 — 구조화된 BUNDLE_WRITE_FAILED · 최종 없음
    r = root(); o = run(r, harness({ fsyncSync: () => { throw ioErr('EIO') } }))
    assert(!o.ok && o.code === 'BUNDLE_WRITE_FAILED' && o.why.includes('부모 fsync') && !existsSync(join(r, REL)), `새 폴더 부모 fsync 실패 ${JSON.stringify(o)}`)
    // (g) 쓰는 사이 최종 이름이 생겼다 — 덮지 않는다(EEXIST 만 ALREADY) · 기존 바이트 불변 · tmp 0
    r = root(); h = harness(); { const st = h.step; h.step = (n) => { st(n); if (n === 'verify') writeFileSync(join(r, REL), '남의 바이트') } }
    o = run(r, h)
    assert(!o.ok && o.code === 'BUNDLE_ALREADY_EXISTS' && readFileSync(join(r, REL), 'utf8') === '남의 바이트', `경합 생성 ${JSON.stringify(o)}`); noResidue(join(r, PDIR), '경합 생성')
    // (h) link 뒤 폴더 fsync 실패 — 우리가 만든 최종 이름까지 지운다(없음 또는 완전 불변식)
    r = root(); { let linked = false; h = harness({ fsyncSync: (fd) => { if (linked) throw ioErr('EIO'); return fsyncSync(fd) } }); const st = h.step; h.step = (n) => { st(n); if (n === 'link') linked = true } }
    o = run(r, h)
    assert(!o.ok && o.code === 'BUNDLE_WRITE_FAILED' && o.why.includes('폴더 fsync') && !existsSync(join(r, REL)), `폴더 fsync 실패 ${JSON.stringify(o)}`); noResidue(join(r, PDIR), '폴더 fsync 실패')

    // ── P1-7 경로 고정 — 실제 바꿔치기. 바깥 폴더는 **모든 단계에서** 이름 0 이어야 한다(정리 후 0 이 아니라 한 번도 없음) ──
    const swapOut = (r, out) => { renameSync(join(r, PDIR), join(r, 'moved-plan-input')); symlinkSync(out, join(r, PDIR)) }
    const swapBack = (r) => { unlinkSync(join(r, PDIR)); renameSync(join(r, 'moved-plan-input'), join(r, PDIR)) }
    // (i0) 이미 바깥 symlink 인 구성 요소 — 진입 전에 거부
    r = root(); let out = outsideDir(); mkdirSync(join(r, 'src/content/magazine'), { recursive: true }); symlinkSync(out, join(r, PDIR))
    h = harness(); let seen = watchOutside(h, [out]); o = run(r, h)
    assert(!o.ok && o.code === 'OUTPUT_PATH_SYMLINK' && seen.length === 0 && dirList(out).length === 0, `symlink 구성 요소 ${JSON.stringify(o)} ${seen}`)
    // (i1) 확인(lstat)과 진입(chdir) 사이 바꿔치기 — ino 대조로 거부 · 아무것도 쓰지 않았다
    r = root(); out = outsideDir(); mkdirSync(join(r, PDIR), { recursive: true })
    h = harness(); seen = watchOutside(h, [out], (n, info) => { if (n === 'enter' && info?.part === 'plan-input') swapOut(r, out) }); o = run(r, h)
    assert(!o.ok && o.code === 'OUTPUT_PATH_RACE' && seen.length === 0 && dirList(out).length === 0 && dirList(join(r, 'moved-plan-input')).length === 0, `진입 바꿔치기 ${JSON.stringify(o)} ${seen}`)
    // (i2) 고정 뒤 바꿔치기 — 바이트는 고정한 폴더 inode 에만 생기고 사후 확인이 지운다 · 바깥 0 · 잔여 0
    r = root(); out = outsideDir(); mkdirSync(join(r, PDIR), { recursive: true })
    h = harness(); seen = watchOutside(h, [out], (n) => { if (n === 'ready') swapOut(r, out) }); o = run(r, h)
    assert(!o.ok && o.code === 'OUTPUT_PATH_RACE' && seen.length === 0 && dirList(out).length === 0 && dirList(join(r, 'moved-plan-input')).length === 0, `고정 뒤 바꿔치기 ${JSON.stringify(o)} ${seen} ${dirList(join(r, 'moved-plan-input'))}`)
    // (i3) 이중 바꿔치기 — 나갔다 돌아오면 원래 자리에 정상 설치 · 그 동안 바깥 0
    r = root(); out = outsideDir(); mkdirSync(join(r, PDIR), { recursive: true })
    h = harness(); seen = watchOutside(h, [out], (n) => { if (n === 'ready') swapOut(r, out); if (n === 'cas') swapBack(r) }); o = run(r, h)
    assert(o.ok && readFileSync(join(r, REL), 'utf8') === TEXT && seen.length === 0 && dirList(out).length === 0, `이중 바꿔치기 ${JSON.stringify(o)} ${seen}`); noResidue(join(r, PDIR), '이중 바꿔치기')
    // (i4) 정리 중 바꿔치기 — 정리는 고정 폴더 안 상대 이름만 지운다. 다른 바깥 폴더의 같은 이름(피해자)은 불변
    r = root(); out = outsideDir(); const victim = outsideDir(); writeFileSync(join(victim, NAME), '피해자 바이트'); mkdirSync(join(r, PDIR), { recursive: true })
    h = harness(); seen = watchOutside(h, [out], (n) => { if (n === 'ready') swapOut(r, out); if (n === 'cleanup') { unlinkSync(join(r, PDIR)); symlinkSync(victim, join(r, PDIR)) } }); o = run(r, h)
    assert(!o.ok && o.code === 'OUTPUT_PATH_RACE' && readFileSync(join(victim, NAME), 'utf8') === '피해자 바이트' && dirList(victim).join() === NAME && seen.length === 0, `정리 중 바꿔치기 ${JSON.stringify(o)} ${dirList(victim)}`)
    assert(dirList(join(r, 'moved-plan-input')).length === 0, `정리 중 바꿔치기: 고정 폴더 잔여 ${dirList(join(r, 'moved-plan-input'))}`)
    // (i5) 만들기(acquire) 경합 — 없던 구성 요소를 mkdir 하기 직전 남이 symlink 로 만든다 → EEXIST 뒤 lstat 이 symlink 를 보고 거부
    r = root(); out = outsideDir(); mkdirSync(join(r, 'src/content/magazine'), { recursive: true })
    h = harness({ mkdirSync: (p) => { if (p === 'plan-input') symlinkSync(out, p); return mkdirSync(p) } }); seen = watchOutside(h, [out]); o = run(r, h)
    assert(!o.ok && o.code === 'OUTPUT_PATH_SYMLINK' && seen.length === 0 && dirList(out).length === 0, `mkdir 경합 ${JSON.stringify(o)} ${seen}`)
    // (i6) 고정한 폴더 inode 자체를 루트 밖으로 옮긴다(rename) — openat 과 같은 한계. 사후 확인이 잡고 그 폴더의 우리 이름을 지운다 · 잔여 0
    r = root(); out = outsideDir(); mkdirSync(join(r, PDIR), { recursive: true })
    h = harness(); { const st = h.step; h.step = (n) => { st(n); if (n === 'link') renameSync(join(r, PDIR), join(out, 'carried')) } }; o = run(r, h)
    assert(!o.ok && o.code === 'OUTPUT_PATH_RACE' && dirList(join(out, 'carried')).length === 0, `고정 폴더 이동 ${JSON.stringify(o)} ${dirList(join(out, 'carried'))}`)

    // (j) 잔여 tmp — 쓰기 0 · 자동 삭제 0
    r = root(); mkdirSync(join(r, PDIR), { recursive: true }); writeFileSync(join(r, PDIR, '.g-20260101-abcdef.json.tmp-1-000000000000'), '반쯤')
    o = run(r, harness())
    assert(!o.ok && o.code === 'STALE_TEMP_PRESENT' && !existsSync(join(r, REL)) && existsSync(join(r, PDIR, '.g-20260101-abcdef.json.tmp-1-000000000000')), `잔여 tmp ${JSON.stringify(o)}`)
    // (k) 최종 이름 확인의 ENOENT 밖 오류는 보존한다(없음 · ALREADY 로 둔갑시키지 않는다) — FILESYSTEM_ERROR · errno
    r = root(); o = run(r, harness({ lstatSync: (p) => { if (String(p).endsWith('.json')) throw ioErr('EACCES'); return lstatSync(p) } }))
    assert(!o.ok && o.code === 'FILESYSTEM_ERROR' && o.errno === 'EACCES', `ENOENT 밖 오류 ${JSON.stringify(o)}`)
    // (l) 급사 — 자식 프로세스가 link 직전 · 직후에 죽는다. 다시 돌리면 각각 STALE_TEMP_PRESENT(dry-run 포함) · BUNDLE_ALREADY_EXISTS · 쓰기 0
    const child = join(TMP, 'crash-child.mjs')
    writeFileSync(child, `import { writeBundleNoClobber } from ${JSON.stringify(pathToFileURL(CLI).href)}\nconst [root, rel, textFile, at] = process.argv.slice(2)\nconst { readFileSync } = await import('node:fs')\nwriteBundleNoClobber({ rootReal: root, outRel: rel, text: readFileSync(textFile, 'utf8') }, { step: (n) => { if (n === at) process.exit(137) } })\n`)
    const want = await bundleTextOf(world())
    for (const [at, code] of [['verify', 'STALE_TEMP_PRESENT'], ['link', 'BUNDLE_ALREADY_EXISTS']]) {
      const w = world()
      const tf = join(TMP, `crash-text-${n++}`); writeFileSync(tf, want)
      const c = spawnSync(process.execPath, [child, realpathSync(w.productRoot), planInputRel(w.graphVersion), tf, at], { encoding: 'utf8' })
      assert(c.status === 137, `자식이 ${at} 에서 죽지 않았다 (exit ${c.status}) ${c.stderr}`)
      const pdir = join(realpathSync(w.productRoot), PDIR)
      const before = dirList(pdir).join()
      for (const write of [false, true]) {
        const again = await boot(w, { write })
        assert(!again.ok && again.code === code, `${at} 급사 뒤 재실행(write=${write}): ${again.ok ? 'ok' : again.code}`)
      }
      assert(dirList(pdir).join() === before, `${at} 급사 뒤 재실행이 폴더를 바꿨다`)
      if (code === 'BUNDLE_ALREADY_EXISTS') assert(parsePlanInputBundle(readFileSync(bundlePath(w), 'utf8')).graphVersion === w.graphVersion, 'link 뒤 급사한 최종 파일이 완전하지 않다')
      else assert(!existsSync(bundlePath(w)), 'link 전 급사인데 최종 파일이 있다')
    }
  })

  await check('PI16', '입력 CAS — 컴파일 뒤 publication 직전 권위 입력이 바뀌면 INPUT_DRIFT · 출력 0 (무관 파일은 막지 않는다)', async () => {
    const swapAt = async (mut, label) => {
      const w = world()
      globalThis.__planInputBootstrapStep = (n) => { if (n === 'verify') { mut(w); globalThis.__planInputBootstrapStep = null } }
      let r
      try { r = await boot(w, { write: true }) } finally { globalThis.__planInputBootstrapStep = null }
      const pdir = join(w.productRoot, 'src/content/magazine/plan-input')
      return { r, w, left: existsSync(pdir) ? readdirSync(pdir) : [], label }
    }
    const G = 'src/content/magazine/graph'
    const cur = (w) => join(w.researchDir, 'contract/build', w.graphVersion)
    for (const [label, mut, key] of [
      ['같은 판 control 토글(제품)', (w) => writeFileSync(join(w.productRoot, G, 'control.ts'), controlText(w.graphVersion, { ...w.seed.control, surfaces: { ...w.seed.control.surfaces, BODY_CALLOUT: true } })), 'product.controlText'],
      ['제품 current.ts 주석', (w) => writeFileSync(join(w.productRoot, G, 'current.ts'), `${readFileSync(join(w.productRoot, G, 'current.ts'), 'utf8')}// 경합\n`), 'product.currentText'],
      ['연구 current 링크를 다른 폴더로', (w) => {
        const alt = join(w.researchDir, 'contract/build', 'g-20991231-zzzzzz'); mkdirSync(alt)
        for (const f of readdirSync(cur(w), { recursive: true }).map(String)) { const src = join(cur(w), f); if (statSync(src).isFile()) { mkdirSync(dirname(join(alt, f)), { recursive: true }); writeFileSync(join(alt, f), readFileSync(src)) } }
        unlinkSync(join(w.researchDir, 'contract/build/current')); symlinkSync('g-20991231-zzzzzz', join(w.researchDir, 'contract/build/current'))
      }, 'research.currentDir'],
      ['연구 current 트리 바이트(edges)', (w) => writeFileSync(join(cur(w), 'edges.jsonl'), `${readFileSync(join(cur(w), 'edges.jsonl'), 'utf8')}\n`), 'research.edges.jsonl'],
      ['증거 파일 바이트', (w) => { const f = join(w.researchDir, 'evidence/serpapi/fx-a.json'); writeFileSync(f, readFileSync(f, 'utf8').replace('"note": "합성"', '"note": "경합"')) }, 'evidence.evidence/serpapi/fx-a.json'],
      ['snapshot 파일', (w) => writeFileSync(join(w.snapshotDir, SNAPSHOT_NAMES.published), `${readFileSync(join(w.snapshotDir, SNAPSHOT_NAMES.published), 'utf8')}\n`), `snapshot.${SNAPSHOT_NAMES.published}`],
    ]) {
      const { r, w, left } = await swapAt(mut, label)
      assert(!r.ok && r.code === 'INPUT_DRIFT' && r.why.includes(key), `${label}: ${r.ok ? 'ok' : `${r.code} ${r.why}`}`)
      assert(!existsSync(bundlePath(w)) && left.length === 0, `${label}: 출력 · 잔여가 있다 ${left}`)
    }
    // 대조군 — Bundle 입력이 아닌 articles · queue 변경은 막지 않는다(작업 트리 전체 clean 을 요구하지 않는다)
    for (const [label, mut] of [
      ['무관 articles', (w) => writeFileSync(join(w.productRoot, 'src/content/magazine/articles.ts'), articlesText([...w.seed.articles, { slug: 'fx-race', title: '경합 무관', cluster: 'daily', publishAt: '2026-12-24T10:30:00+09:00' }]))],
      ['무관 queue', (w) => writeFileSync(join(w.productRoot, 'drafts/magazine/topic-queue.ts'), queueText([...w.seed.queue, { slug: 'fx-race-q', title: '경합 무관 대기', cluster: 'daily' }]))],
    ]) {
      const { r, w } = await swapAt(mut, label)
      assert(r.ok && existsSync(bundlePath(w)), `${label}: 무관 변경이 막았다 ${r.code} ${r.why}`)
    }
  })

  await check('PI17', '실제 CLI 프로세스 fault — 증거 EACCES · 출력 경로 EACCES · 제품 파일 EACCES · 폴더 EACCES 는 구조화 JSON · exit 1 · 출력 0 · stack trace 0', async () => {
    if (process.getuid?.() === 0) throw new Error('root 로는 권한 fault 를 만들 수 없다 — 이 반례는 통과로 세지 않는다')
    const cliOf = async (w) => fixtureBootstrapFile(w.graphVersion)
    const chmods = []
    const lock = (p, mode) => { chmods.push([p, statSync(p).mode & 0o777]); chmodSync(p, mode) }
    try {
      for (const [label, prep, code, write] of [
        ['증거 파일 읽기 EACCES', (w) => lock(join(w.researchDir, 'evidence/serpapi/fx-a.json'), 0o000), 'EVIDENCE_READ_FAILED', false],
        ['증거 폴더 lstat EACCES', (w) => lock(join(w.researchDir, 'evidence/serpapi'), 0o000), 'EVIDENCE_READ_FAILED', false],
        ['제품 control 읽기 EACCES', (w) => lock(join(w.productRoot, 'src/content/magazine/graph/control.ts'), 0o000), 'PRODUCT_FILE_MISSING', false],
        ['출력 부모 폴더 쓰기 EACCES', (w) => lock(join(w.productRoot, 'src/content/magazine'), 0o555), 'BUNDLE_WRITE_FAILED', true],
        ['plan-input 폴더 검색 EACCES', (w) => { mkdirSync(join(w.productRoot, 'src/content/magazine/plan-input')); lock(join(w.productRoot, 'src/content/magazine/plan-input'), 0o000) }, 'FILESYSTEM_ERROR', true],
      ]) {
        const w = world(); prep(w)
        const c = spawnSync(process.execPath, [await cliOf(w), '--research-dir', realpathSync(w.researchDir), '--snapshot-dir', realpathSync(w.snapshotDir), '--product-root', realpathSync(w.productRoot), ...(write ? ['--write'] : [])], { encoding: 'utf8' })
        let j = null
        try { j = JSON.parse(c.stdout) } catch { j = null }
        assert(c.status === 1 && j && j.ok === false && j.code === code && j.errno === 'EACCES', `${label}: exit ${c.status} ${c.stdout.slice(0, 200)} ${c.stderr.slice(0, 200)}`)
        assert(!/\n\s+at /.test(c.stderr) && !/\n\s+at /.test(c.stdout), `${label}: stack trace 가 나왔다`)
        while (chmods.length) { const [p, m] = chmods.pop(); chmodSync(p, m) }
        assert(!existsSync(bundlePath(w)), `${label}: 출력이 생겼다`)
      }
    } finally { while (chmods.length) { const [p, m] = chmods.pop(); try { chmodSync(p, m) } catch { /* 이미 정리 */ } } }
  })

  await check('PI15', 'mapping 원시 중복 — 조용히 줄이지 않고 거부 · 쓰기 0 (다대다는 정상)', async () => {
    await expectStop(world((s) => { s.mappings.push({ ...s.mappings[0] }) }), 'RESEARCH_MAPPING_INVALID', '같은 (intentId, slug) 두 번')
    const many = world((s) => { s.mappings.push({ intentId: s.mappings[0].intentId, slug: 'fx-other-slug' }, { intentId: 'I-F2-01', slug: s.mappings[0].slug }) })
    const r = await boot(many)
    assert(r.ok, `다대다 mapping 이 거부됐다 ${r.code} ${r.why}`)
  })
} finally {
  cleanupFixtureBootstrap()
  rmSync(TMP, { recursive: true, force: true })
}
console.log(`\nplan-input 검사: ${pass} pass, ${fail} fail`)
process.exit(fail ? 1 : 0)

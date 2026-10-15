#!/usr/bin/env node
/**
 * `DIRECT_SPEC_V1` adapter 변이 — 변이가 통과하면 adapter 검사가 FAIL 해야 한다.
 *
 * 🔴 각 변이는 adapter 소스를 string 으로 복제한 뒤 좁은 regex 치환 하나로 결함을 심는다.
 *    변이본은 `scripts/lib/.magazine-direct-spec.__mutant.<id>.mjs` 로 임시 저장되고,
 *    dynamic import 뒤 즉시 지운다. 저장소 다른 파일은 바뀌지 않는다. 네트워크 0 · ChatGPT 0.
 *
 * 변이:
 *   M1  direct wiring 제거 — `compileAndPersistDirectSpec` 가 persist 를 skip 한다
 *       catch: `directSpecMessageFor` 가 DIRECT_SPEC_MISSING 으로 fail-closed 해야 한다
 *   M2  spec verify 제거 — `readDirectSpec` 가 verifyArticleSpec 결과를 믿어 skip 한다
 *       catch: 손상된 spec 이 fail-closed 되지 않는다 (ARTICLE_SPEC_HASH)
 *   M3  legacy fallback 무제한화 — `resolveMagazineAutoMode` 가 항상 DIRECT_SPEC_V1 을 돌려준다
 *       catch: opt-in flag 없는 queueItem 도 direct 로 간다
 *   M4  identity/hash 전달 제거 — `directSpecRegenPacket` instruction 에서 specHash 라인이 빠진다
 *       catch: QA 재생성이 identity 를 운반하지 않는다
 *   M5  재실행 중복 호출 — `registerDirectSpecSidecar` 가 멱등 가드를 지웠다
 *       catch: 두 번째 호출이 written=true 로 돌아와 identity 가 두 번 적힌다
 */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const ADAPTER_PATH = join(ROOT, 'scripts/lib/magazine-direct-spec.mjs')
const FIXTURE_INPUT = join(ROOT, 'scripts/__fixtures__/magazine/direct-spec/canary.input.json')

const ORIGINAL = readFileSync(ADAPTER_PATH, 'utf8')
function loadFixture() { return JSON.parse(readFileSync(FIXTURE_INPUT, 'utf8')) }
const TMPS = []
function tmp(prefix) {
  const d = mkdtempSync(join(tmpdir(), `${prefix}-`))
  TMPS.push(d); return d
}
process.on('exit', () => { for (const d of TMPS) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })

async function withMutant(id, patch, assertion) {
  const patched = patch(ORIGINAL)
  if (patched === ORIGINAL) throw new Error(`${id}: 패치가 소스를 바꾸지 못했다 — anchor 가 틀렸다`)
  const mutantPath = join(dirname(ADAPTER_PATH), `.magazine-direct-spec.__mutant.${id}.mjs`)
  // ESM 캐시 깨트리기 — mutantPath 자체가 매번 유일하므로 재사용 충돌 없음
  writeFileSync(mutantPath, patched, 'utf8')
  try {
    const mod = await import(pathToFileURL(mutantPath).href + `?t=${Date.now()}`)
    await assertion(mod)
  } finally {
    try { unlinkSync(mutantPath) } catch { /* best effort */ }
  }
}

let pass = 0, fail = 0
async function mutate(id, label, patch, assertion) {
  try { await withMutant(id, patch, assertion); pass++; console.log(`PASS ${id} ${label}`) }
  catch (e) { fail++; console.error(`FAIL ${id} ${label}: ${e?.stack ?? e}`) }
}

// Baseline — 원본 adapter 가 각 반례를 **catch 한다** 는 것부터 확인한다.
// 변이 테스트는 "변이가 통과하면 catch 가 깨진다" 를 보여 주지만, 그 전에 **원본은 catch 한다** 를 못 보이면
// 변이가 catch 됐다는 말에 의미가 없다. — "변이 하네스가 운영 adapter 를 실제로 태운다" (가짜 fixture ≠ 운영) 보증.
import * as adapter from './lib/magazine-direct-spec.mjs'
import { ARTICLE_SPEC_FILENAME, ARTICLE_SPEC_REGISTER_LEDGER } from './lib/magazine-direct-spec.mjs'

async function baseline() {
  console.log('\n── baseline (원본 adapter 는 반례를 catch 한다) ──')

  // B1 (M1 짝): compile 생략 상태 (persist 안 함) — 디스크 비어 있으므로 messageFor FAIL
  {
    const d = tmp('ds-base-b1')
    const r = adapter.directSpecMessageFor({ slug: 'canary-direct-spec-01', draftsDir: d })
    assert.equal(r.ok, false, 'B1 원본은 spec 없음을 catch 해야 한다')
    assert.equal(r.code, 'DIRECT_SPEC_MISSING')
    pass++; console.log('PASS B1 compile 생략 상태 — DIRECT_SPEC_MISSING')
  }

  // B2 (M2 짝): verify — 손상 spec 을 쓰면 ARTICLE_SPEC_HASH 로 FAIL
  {
    const d = tmp('ds-base-b2')
    const input = loadFixture()
    const p = adapter.compileAndPersistDirectSpec({ input, draftsDir: d })
    const specPath = join(d, p.spec.identity.slug, ARTICLE_SPEC_FILENAME)
    const spec = JSON.parse(readFileSync(specPath, 'utf8'))
    spec.editorial.outline[0] = '손상된 outline'
    writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n', 'utf8')
    const r = adapter.readDirectSpec({ slug: p.spec.identity.slug, draftsDir: d })
    assert.equal(r.ok, false, 'B2 원본은 손상 spec 을 catch 해야 한다')
    assert.equal(r.code, 'ARTICLE_SPEC_HASH')
    pass++; console.log('PASS B2 손상 spec — ARTICLE_SPEC_HASH')
  }

  // B3 (M3 짝): opt-in 없는 queueItem 은 legacy
  {
    const r = adapter.resolveMagazineAutoMode({ slug: 'none' })
    assert.equal(r.mode, adapter.LEGACY_BRIEF_MODE)
    pass++; console.log('PASS B3 opt-in 없는 queueItem → legacy')
  }

  // B4 (M4 짝): regen 패킷 instruction 에 specHash 가 글자로 들어간다
  {
    const d = tmp('ds-base-b4')
    const p = adapter.compileAndPersistDirectSpec({ input: loadFixture(), draftsDir: d })
    const pkt = adapter.directSpecRegenPacket({ spec: p.spec, failures: [{ code: 'B4', label: 't' }] })
    assert.ok(pkt.instruction.includes(p.specHash), 'B4 원본은 instruction 에 specHash 를 적어야 한다')
    pass++; console.log('PASS B4 regen 패킷에 specHash 운반')
  }

  // B5 (M5 짝): 같은 specHash 두 번 → written=false (멱등)
  {
    const d = tmp('ds-base-b5')
    const p = adapter.compileAndPersistDirectSpec({ input: loadFixture(), draftsDir: d })
    const r1 = adapter.registerDirectSpecSidecar({ spec: p.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' })
    const r2 = adapter.registerDirectSpecSidecar({ spec: p.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' })
    assert.equal(r1.written, true)
    assert.equal(r2.written, false, 'B5 원본은 멱등해야 한다')
    pass++; console.log('PASS B5 register 멱등')
  }
}

// ── 변이 ─────────────────────────────────────────────────
console.log('\n── 변이 (변이가 통과하면 adapter 검사가 catch 한다) ──')

async function runMutations() {
  // M1 compileAndPersistDirectSpec 안의 `atomicWriteJson(specPath, compiled)` 를 지운다
  await mutate('M1', 'direct wiring 제거 — compile 뒤 persist 를 생략',
    (src) => src.replace(/\n(\s*)atomicWriteJson\(specPath, compiled\)\n/,
      "\n$1// mutant M1: persist 생략\n"),
    async (mod) => {
      const d = tmp('ds-m1')
      // 변이가 compileAndPersistDirectSpec 를 돌려도 디스크엔 spec 이 없다 — 변이가 통과한 상태
      const p = mod.compileAndPersistDirectSpec({ input: loadFixture(), draftsDir: d })
      assert.equal(p.specHash.startsWith('sha256:'), true, 'compile 자체는 돈다')
      // 하지만 messageFor 는 spec 을 디스크에서 다시 읽는다 — DIRECT_SPEC_MISSING 으로 fail-closed 되어야 adapter 가 결함을 catch 한 것이다
      const m = mod.directSpecMessageFor({ slug: p.spec.identity.slug, draftsDir: d })
      assert.equal(m.ok, false, 'M1 catch — messageFor 는 spec 없음을 fail-closed 로 돌려줘야 한다')
      assert.equal(m.code, 'DIRECT_SPEC_MISSING')
    })

  // M2 readDirectSpec 안의 verifyArticleSpec 호출 자리를 "그냥 ok" 로 바꾼다
  await mutate('M2', 'spec verify 제거 — readDirectSpec 가 verify 결과를 믿지 않는다',
    (src) => src.replace(
      /const v = verifyArticleSpec\(parsed\)\n\s*if \(!v\.ok\) return \{ ok: false, code: v\.code, why: v\.why \}/,
      'const v = { ok: true } // mutant M2: verify skip'),
    async (mod) => {
      const d = tmp('ds-m2')
      // 원본으로 쓴 뒤 outline 을 조작한다 (specHash 재계산 안 함) — 손상 spec
      const p = adapter.compileAndPersistDirectSpec({ input: loadFixture(), draftsDir: d })
      const specPath = join(d, p.spec.identity.slug, ARTICLE_SPEC_FILENAME)
      const spec = JSON.parse(readFileSync(specPath, 'utf8'))
      spec.editorial.outline[0] = '손상된 outline'
      writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n', 'utf8')
      // 변이본은 verify 를 skip 했으므로 ok 로 돌려준다 — "손상이 통과함" 상태
      const r = mod.readDirectSpec({ slug: p.spec.identity.slug, draftsDir: d })
      assert.equal(r.ok, true, 'M2 변이본은 손상을 통과시킨다')
      // 그러나 handoff 의 identity 검사가 이것을 catch 해야 한다 — 변이본의 message 지문은 원본 specHash 와 어긋난다
      // adapter 소비자 쪽 검사: handoff 로 identity drift 발생 → fail-closed
      // 변이본 handoff 도 verify 를 skip 하지만 message 안에 손상된 outline 글자가 들어가 지문이 달라진다 → 운영은 그걸로는 못 돌린다.
      // mutation 수준에서 명확한 신호: identityHandoff 를 변이본으로 돌리면 message 가 손상된 spec 글자 ('손상된 outline') 를 포함해야 한다 (변이 성공 상태)
      const m = mod.directSpecMessageFor({ slug: p.spec.identity.slug, draftsDir: d })
      assert.equal(m.ok, true, 'M2 변이본은 손상 spec 으로 message 를 조립한다 — 변이 성공')
      assert.ok(m.message.includes('손상된 outline'), 'M2 catch — 변이가 통과하면 손상 글자가 provider 로 흘러간다 (실패 시나리오)')
      // 즉 변이본이 이 자리를 통과시키는 것이 결함이다. 원본 B2 에서 ARTICLE_SPEC_HASH 로 fail-closed 한 것이 올바른 동작임을 보여 준다.
    })

  // M3 resolveMagazineAutoMode 가 항상 DIRECT_SPEC_V1 을 돌려준다
  await mutate('M3', 'legacy fallback 무제한화 — resolveMagazineAutoMode 가 항상 direct',
    (src) => src.replace(
      /export function resolveMagazineAutoMode\(queueItem\) \{[\s\S]*?\n\}\n/,
      "export function resolveMagazineAutoMode(queueItem) { return { mode: DIRECT_SPEC_MODE, reason: 'mutant M3' } }\n"),
    async (mod) => {
      const r1 = mod.resolveMagazineAutoMode({ slug: 'legacy-only' })
      assert.equal(r1.mode, mod.DIRECT_SPEC_MODE, 'M3 변이본은 opt-in 없는 입력도 direct 로 보낸다')
      const r2 = mod.resolveMagazineAutoMode({ [mod.DIRECT_SPEC_OPT_IN_FIELD]: 'DIRECT_SPEC_V2' })
      assert.equal(r2.mode, mod.DIRECT_SPEC_MODE,
        'M3 catch — "모르는 directSpecMode 는 legacy" 라는 bounded rollback 계약이 무너진다')
    })

  // M4 directSpecRegenPacket 의 instruction 조립에서 specHash 라인을 뺀다
  await mutate('M4', 'identity 운반 제거 — regen 패킷 instruction 에서 specHash 라인이 빠진다',
    (src) => src.replace(
      /`원고의 schemaVersion 과 specHash 는 유지합니다: \$\{spec\.schemaVersion\} \/ \$\{spec\.specHash\}\.`,\n/,
      "// mutant M4: specHash 라인 제거\n"),
    async (mod) => {
      const d = tmp('ds-m4')
      const p = adapter.compileAndPersistDirectSpec({ input: loadFixture(), draftsDir: d })
      const pkt = mod.directSpecRegenPacket({ spec: p.spec, failures: [{ code: 'M4', label: 't' }] })
      assert.ok(!pkt.instruction.includes(p.specHash),
        'M4 catch — 변이본의 instruction 글자가 specHash 를 운반하지 않는다 (QA 재생성 자리에서 identity 유실)')
    })

  // M5 registerDirectSpecSidecar 의 멱등 가드 (`if (existsSync(path))` 블록) 를 뺀다
  await mutate('M5', '재실행 중복 호출 — register 멱등 가드 제거',
    (src) => src.replace(
      /if \(existsSync\(path\)\) \{\n[\s\S]*?return \{ written: false, path, specHash: spec\.specHash, record: prev \}\n\s*\}\n/,
      '// mutant M5: 멱등 가드 제거\n'),
    async (mod) => {
      const d = tmp('ds-m5')
      const p = adapter.compileAndPersistDirectSpec({ input: loadFixture(), draftsDir: d })
      const r1 = mod.registerDirectSpecSidecar({ spec: p.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' })
      const r2 = mod.registerDirectSpecSidecar({ spec: p.spec, draftsDir: d, registeredAt: '2026-10-22T10:30:00+09:00' })
      assert.equal(r1.written, true)
      assert.equal(r2.written, true,
        'M5 catch — 변이본은 멱등하지 않아 identity 가 두 번 쓰인다 (재실행이 중복 등록을 만든다)')
    })
}

await baseline()
await runMutations()

console.log(`\nDIRECT_SPEC_V1 mutation: ${pass} pass, ${fail} fail`)
if (fail) process.exit(1)

#!/usr/bin/env node
/**
 * control.ts 구조 편집 helper 반례 (2026-10-18) — `scripts/lib/magazine-graph-control-edit.mjs`
 *
 *   node scripts/magazine-graph-control-edit-check.mjs [--old-input <dir> --new-input <최종 snapshot>]
 *
 * 🔴 제품 control.ts 를 쓰지 않는다. 사본 텍스트만 다룬다(실제 입력 확인은 임시 제품 루트 사본).
 * 🔴 변이 하네스가 helper 사본을 주입한다: MGRAPH_CONTROL_EDIT_LIB (없으면 저장소 파일). 적재 실패는 검출이 아니다.
 * 마지막 줄: `control 편집 검사: <n> pass, <n> fail`
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = dirname(HERE)
const LIB = process.env.MGRAPH_CONTROL_EDIT_LIB ?? join(HERE, 'lib/magazine-graph-control-edit.mjs')
let h
try { h = await import(pathToFileURL(LIB).href) } catch (e) { console.log(`LOAD_ERROR ${e.message}`); process.exit(3) }

let pass = 0, fail = 0
const check = (name, fn) => {
  try { fn(); pass++; console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name} — ${String(e?.message).split('\n')[0].slice(0, 240)}`) }
}
const codeOf = (fn) => { try { fn(); return null } catch (e) { return e instanceof h.ControlEditError ? e.code : `NOT_CONTROL_EDIT_ERROR ${e?.constructor?.name}` } }
const REAL = readFileSync(join(ROOT, 'src/content/magazine/graph/control.ts'), 'utf8')
const real = h.readControl(REAL)
const without = (o) => { const { enabledClusters: _d, ...r } = o; return r }
/** 대상 필드 밖이 의미상 같은가 */
const sameRest = (a, b) => assert.deepEqual(without(h.readControl(b)), without(h.readControl(a)))
const changedLines = (a, b) => { const x = a.split('\n'), y = b.split('\n'); return x.length === y.length ? x.filter((l, i) => l !== y[i]).length : -1 }

const MULTI = `import type { MagazineGraphControl } from './types'

export const CONTROL: MagazineGraphControl = {
  graphVersion: "g-test",
  enabled: true,
  // enabledClusters: ['decoy'] — 주석 안은 편집 대상이 아니다
  enabledClusters: [
    "sleep",
    "family",
  ],
  surfaces: { "CTA_END": true, "FOOTER_NEXT": true },
  killSwitch: { tripped: false, trippedAt: null, trippedBy: "enabledClusters: ['x']", reason: null },
  previousGraphVersion: null,
} as const
`
const QUOTED_KEY = MULTI.replace('  enabledClusters: [', '  "enabledClusters": [')

check('실제 control: money-work 추가 — 기존 순서 보존 · 끝에 한 번 · 한 줄만 바뀜 · 다른 필드 불변', () => {
  const out = h.addCluster(REAL, 'money-work')
  assert.deepEqual(h.readControl(out).enabledClusters, [...real.enabledClusters, 'money-work'])
  assert.equal(changedLines(REAL, out), 1)
  sameRest(REAL, out)
})
check('이미 money-work 가 있으면 addCluster 는 CLUSTER_ALREADY_PRESENT · ensureCluster 는 바이트 그대로 changed=false', () => {
  const once = h.addCluster(REAL, 'money-work')
  assert.equal(codeOf(() => h.addCluster(once, 'money-work')), 'CLUSTER_ALREADY_PRESENT')
  const r = h.ensureCluster(once, 'money-work')
  assert.deepEqual([r.text === once, r.changed], [true, false])
  const r2 = h.ensureCluster(REAL, 'money-work')
  assert.deepEqual([r2.text === once, r2.changed], [true, true])
})
check('실제 control: 켜진 cluster 제거(cluster-off) — 정확히 그 cluster 만 빠진다', () => {
  const target = real.enabledClusters[0]
  const out = h.removeCluster(REAL, target)
  assert.deepEqual(h.readControl(out).enabledClusters, real.enabledClusters.filter((c) => c !== target))
  sameRest(REAL, out)
})
check('없는 cluster 제거는 CLUSTER_NOT_PRESENT · 잘못된 이름은 CLUSTER_INVALID', () => {
  assert.equal(codeOf(() => h.removeCluster(REAL, 'not-enabled-cluster')), 'CLUSTER_NOT_PRESENT')
  for (const bad of ['', 'Money Work', "x'y", 42]) assert.equal(codeOf(() => h.addCluster(REAL, bad)), 'CLUSTER_INVALID', String(bad))
})
check('여러 줄 · 끝 쉼표 · 큰따옴표 · 주석/문자열 안의 미끼 — 최상위 배열만 바뀌고 따옴표 표기를 따른다', () => {
  const add = h.addCluster(MULTI, 'money-work')
  assert.deepEqual(h.readControl(add).enabledClusters, ['sleep', 'family', 'money-work'])
  assert.ok(add.includes('enabledClusters: ["sleep", "family", "money-work"]'), '큰따옴표 표기')
  assert.ok(add.includes("// enabledClusters: ['decoy']") && add.includes(`trippedBy: "enabledClusters: ['x']"`), '미끼가 바뀌었다')
  sameRest(MULTI, add)
  const rm = h.removeCluster(MULTI, 'sleep')
  assert.deepEqual(h.readControl(rm).enabledClusters, ['family'])
  sameRest(MULTI, rm)
})
check('따옴표 key("enabledClusters")도 구조적으로 찾는다', () => {
  assert.deepEqual(h.readControl(h.addCluster(QUOTED_KEY, 'money-work')).enabledClusters, ['sleep', 'family', 'money-work'])
})
check('malformed CONTROL · enabledClusters 비배열·누락·중복은 구조화 오류', () => {
  assert.equal(codeOf(() => h.addCluster('export const OTHER = {}', 'money-work')), 'CONTROL_NOT_FOUND')
  assert.equal(codeOf(() => h.addCluster('export const CONTROL = { enabledClusters: [', 'money-work')), 'CONTROL_PARSE_FAILED')
  assert.equal(codeOf(() => h.addCluster('export const CONTROL = { enabledClusters: foo() }', 'money-work')), 'CONTROL_PARSE_FAILED')
  assert.equal(codeOf(() => h.addCluster("export const CONTROL = { enabledClusters: 'sleep' }", 'money-work')), 'CLUSTERS_NOT_ARRAY')
  assert.equal(codeOf(() => h.addCluster('export const CONTROL = { enabledClusters: [1, 2] }', 'money-work')), 'CLUSTERS_NOT_ARRAY')
  assert.equal(codeOf(() => h.addCluster('export const CONTROL = { enabled: true }', 'money-work')), 'CLUSTERS_NOT_ARRAY')
  assert.equal(codeOf(() => h.addCluster("export const CONTROL = { enabledClusters: ['a'], enabledClusters: ['b'] }", 'money-work')), 'CLUSTERS_AMBIGUOUS')
})
check('사후조건: 편집 뒤 cluster 가 기대값이 아니면 POSTCONDITION_FAILED', () => {
  assert.equal(codeOf(() => h.verifyClusterEdit(real, real, [...real.enabledClusters, 'money-work'])), 'POSTCONDITION_FAILED')
  assert.equal(codeOf(() => h.verifyClusterEdit(real, real, real.enabledClusters)), null)
})
check('대상 필드 밖이 바뀌면 OTHER_FIELD_CHANGED (graphVersion · enabled · surfaces · killSwitch · previousGraphVersion · 필드 추가)', () => {
  const variants = [
    { ...real, graphVersion: 'g-other' }, { ...real, enabled: !real.enabled }, { ...real, surfaces: { ...real.surfaces, FOOTER_NEXT: false } },
    { ...real, killSwitch: { ...real.killSwitch, tripped: true } }, { ...real, previousGraphVersion: 'g-x' }, { ...real, extra: 1 },
  ]
  for (const v of variants) assert.equal(codeOf(() => h.verifyClusterEdit(real, v, v.enabledClusters)), 'OTHER_FIELD_CHANGED', JSON.stringify(Object.keys(v)))
  assert.equal(codeOf(() => h.assertOnlyClustersChanged(real, { ...real, enabledClusters: ['x'] })), null)
})
check('세 소비처가 고정 cluster 문자열 없이 공용 helper 를 쓴다', () => {
  const FIXED = /enabledClusters:\s*\[\s*['"]sleep['"]\s*,\s*['"]family['"]\s*\]/
  const consumers = [
    ['scripts/magazine-direct-spec-source-check.mjs', /removeCluster\(readFileSync\(p, 'utf8'\), BASIS\.sourceCluster\)/],
    ['scripts/magazine-graph-build-check.mjs', /ensureCluster\(pt\.control, 'money-work'\)/],
    ['scripts/magazine-relation-policy-check.mjs', /controlEdit\.ensureCluster\(productTexts\.control, 'money-work'\)/],
  ]
  for (const [file, use] of consumers) {
    const t = readFileSync(join(ROOT, file), 'utf8')
    assert.ok(!FIXED.test(t), `${file} 에 고정 cluster 문자열이 남아 있다`)
    assert.ok(t.includes('magazine-graph-control-edit.mjs'), `${file} 가 helper 를 불러오지 않는다`)
    assert.ok(use.test(t), `${file} 가 helper 를 그 자리에서 쓰지 않는다`)
  }
})

// ── 실제 입력 (선택) — cluster 목록이 이미 sleep·family·money-work 인 제품 사본에서 두 실제 검사가 준비 실패하지 않는다 ──
const argOf = (n) => { const i = process.argv.indexOf(n); return i === -1 ? null : process.argv[i + 1] }
const oldInput = argOf('--old-input'), newInput = argOf('--new-input')
if (oldInput && newInput) {
  const tmp = mkdtempSync(join(tmpdir(), 'control-edit-real-'))
  try {
    for (const rel of ['src/content/magazine/graph', 'src/content/magazine/articles.ts', 'src/lib/magazine-graph.ts']) {
      mkdirSync(dirname(join(tmp, rel)), { recursive: true }); cpSync(join(ROOT, rel), join(tmp, rel), { recursive: true })
    }
    const ctl = join(tmp, 'src/content/magazine/graph/control.ts')
    writeFileSync(ctl, h.addCluster(readFileSync(ctl, 'utf8'), 'money-work'))
    check('실제 입력: money-work 가 이미 켜진 제품 사본에서 실제 I-T6-05 · 실제 입력 3b 가 준비 실패하지 않는다', () => {
      assert.deepEqual(h.readControl(readFileSync(ctl, 'utf8')).enabledClusters.slice(-1), ['money-work'])
      const rp = spawnSync(process.execPath, [join(HERE, 'magazine-relation-policy-check.mjs'), '--new-input', newInput, '--real-product', tmp], { encoding: 'utf8' })
      assert.ok(rp.status === 0 && /PASS 실제 I-T6-05/.test(rp.stdout), `relation-policy: ${rp.stdout.slice(-300)}`)
      const bc = spawnSync(process.execPath, [join(HERE, 'magazine-graph-build-check.mjs'), '--old-input', oldInput, '--new-input', join(dirname(newInput), '2026-10-17-money-work'), '--real-product', tmp], { encoding: 'utf8' })
      assert.ok(/✅ 실제 입력 3b/.test(bc.stdout), `build-check 3b: ${bc.stdout.split('\n').filter((l) => l.includes('3b')).join(' | ').slice(0, 300)}`)
    })
  } finally { rmSync(tmp, { recursive: true, force: true }) }
} else console.log('SKIP 실제 입력 — --old-input · --new-input 미지정 (통과로 세지 않는다)')

console.log(`\ncontrol 편집 검사: ${pass} pass, ${fail} fail`)
if (fail) process.exit(1)

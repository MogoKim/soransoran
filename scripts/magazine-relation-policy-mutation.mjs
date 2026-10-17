#!/usr/bin/env node
/**
 * 관계 수량 공용 정책 변이 — exact-3 계약을 되살리거나 공용 정책 사용을 빼면 `magazine-relation-policy-check` 가 실패해야 한다.
 *
 *   node scripts/magazine-relation-policy-mutation.mjs
 *
 * 🔴 저장소 파일을 고치지 않는다. scripts/lib 의 .mjs 를 임시 폴더에 복사하고(node_modules 는 symlink)
 *    한 파일에 변이 하나를 심어 RELATION_POLICY_LIB 로 주입한다.
 * 🔴 검출 = 요약 줄의 fail > 0 과 exit 1. 변이 지점 없음 · 지점 중복 · 적재 실패(LOAD_ERROR) · 요약 없음은 하네스 FAIL.
 * 🔴 무변이 사본이 먼저 fail 0 이어야 한다.
 * authoring prepare · judge 의 exact-3 · 자동 절단 변이는 `magazine-direct-spec-source-authoring-mutation.mjs` MA28~MA31 이 본다.
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const LIB = join(HERE, 'lib')
const CHECK = join(HERE, 'magazine-relation-policy-check.mjs')

const MUTATIONS = [
  ['RP1', '정책 자체를 exact-3 으로 되돌린다(directMin 3)', 'magazine-relation-policy.mjs', '  directMin: 2,', '  directMin: 3,', 'P1'],
  ['RP2', '정책 표시 상한을 4 로 — 제품 resolver 와 어긋난다', 'magazine-relation-policy.mjs', '  directMax: 3,', '  directMax: 4,', 'P5'],
  ['RP3', 'source required-field 가 exact-3 을 되살린다', 'magazine-direct-spec-source.mjs',
    "  if (path === 'relations.direct') return Array.isArray(value) && isValidDirectCount(value.length)",
    "  if (path === 'relations.direct') return Array.isArray(value) && value.length === 3", 'P3'],
  ['RP4', 'source required-field 가 discovery 단일 객체 검사를 버린다', 'magazine-direct-spec-source.mjs',
    "  if (path === 'relations.discovery') return isSingleDiscovery(value)\n", '', 'P3b'],
  ['RP5', 'ArticleSpec 이 exact-3 을 되살린다', 'magazine-article-spec.mjs', '  if (!isValidDirectCount(direct.length)) {', '  if (direct.length !== 3) {', 'P4'],
  ['RP6', 'ArticleSpec direct 수량 검사 제거(4개 허용)', 'magazine-article-spec.mjs', '  if (!isValidDirectCount(direct.length)) {', '  if (false) {', 'P4b'],
  ['RP7', 'builder 가 공용 정책 대신 숫자를 적는다(생산 최소 3)', 'magazine-graph-build.mjs',
    'productionMinimum: Object.freeze({ direct: RELATION_POLICY.directMin,', 'productionMinimum: Object.freeze({ direct: 3,', 'P2'],
  ['RP8', 'ArticleSpec 이 공용 정책 import 를 버리고 자체 숫자를 쓴다', 'magazine-article-spec.mjs',
    "import { RELATION_CONTRACT_LABEL, RELATION_POLICY, isValidDirectCount } from './magazine-relation-policy.mjs'\n",
    "const RELATION_POLICY = { directMin: 3, directMax: 3, discovery: 1 }\nconst RELATION_CONTRACT_LABEL = '3+1'\nconst isValidDirectCount = (n) => n === 3\n", 'P4'],
]

const base = mkdtempSync(join(tmpdir(), 'relation-policy-mutation-'))
symlinkSync(join(ROOT, 'node_modules'), join(base, 'node_modules'))
const original = Object.fromEntries(readdirSync(LIB).filter((f) => f.endsWith('.mjs')).map((f) => [f, readFileSync(join(LIB, f), 'utf8')]))

function runWith(tag, file, mutated) {
  const dir = join(base, tag, 'lib'); mkdirSync(dir, { recursive: true })
  for (const f of Object.keys(original)) copyFileSync(join(LIB, f), join(dir, f))
  if (file) writeFileSync(join(dir, file), mutated)
  const r = spawnSync(process.execPath, [CHECK], { encoding: 'utf8', env: { ...process.env, RELATION_POLICY_LIB: dir }, maxBuffer: 1e8 })
  const m = /관계 수량 정책 검사: (\d+) pass, (\d+) fail/.exec(r.stdout ?? '')
  return { status: r.status, out: r.stdout ?? '', err: r.stderr ?? '', pass: m ? +m[1] : null, fail: m ? +m[2] : null, load: /LOAD_ERROR/.test(r.stdout ?? '') }
}

const lines = []
let detected = 0, harnessFail = 0
const b = runWith('base', null, null)
if (b.status !== 0 || b.fail !== 0 || b.load) { lines.push(`FAIL 무변이 사본이 통과하지 않는다 — ${(b.out + b.err).slice(-300)}`); harnessFail++ }
else lines.push(`PASS 무변이 사본 ${b.pass} pass · 0 fail`)

for (const [id, label, file, from, to, expect] of MUTATIONS) {
  const src = original[file]
  const count = src.split(from).length - 1
  if (count !== 1) { lines.push(`FAIL ${id} ${label} — 변이 지점 ${count}곳 (하네스 결함)`); harnessFail++; continue }
  const r = runWith(id, file, src.replace(from, to))
  if (r.load || r.fail === null) { lines.push(`FAIL ${id} ${label} — 적재 실패·요약 없음(검출 아님): ${(r.out + r.err).slice(-200)}`); harnessFail++; continue }
  const hit = r.out.split('\n').some((l) => l.startsWith(`FAIL ${expect} `))
  if (r.status === 1 && r.fail > 0 && hit) { detected++; lines.push(`PASS ${id} ${label} → ${expect} 실패로 검출 (fail=${r.fail})`) }
  else { lines.push(`FAIL ${id} ${label} — 기대한 ${expect} 가 실패하지 않았다 (status ${r.status} fail=${r.fail})`); harnessFail++ }
}

rmSync(base, { recursive: true, force: true })
console.log(lines.join('\n'))
console.log(`\n관계 수량 정책 변이: ${detected} pass, ${harnessFail} fail (변이 ${MUTATIONS.length})`)
process.exit(harnessFail ? 1 : 0)

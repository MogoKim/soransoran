#!/usr/bin/env node
/**
 * DIRECT 글별 주제 금지 패턴 변이 — 관문을 하나씩 끊으면 `topicForbiddenCases` 중 하나가 **단언으로** 실패해야 한다.
 *
 * 🔴 변이는 임시 루트 사본에만 넣는다 — 작업 트리 원본 바이트 0 변경(마지막에 확인).
 * 🔴 변이 지점은 파일마다 정확히 1곳이어야 한다(0곳 · 2곳은 하네스 결함 — 죽은 변이를 세지 않는다).
 * 🔴 실행 실패(batch-qa 출력을 읽지 못함 · 문법 오류)는 "잡혔다" 가 아니다 — 하네스 결함으로 센다.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { COPY, ROOT, makeRoot, runCases, topicForbiddenCases } from './magazine-direct-topic-forbidden-check.mjs'

const BQ = 'scripts/magazine-batch-qa.mjs'
const SRC = 'scripts/lib/magazine-direct-spec-source.mjs'
const SPEC = 'scripts/lib/magazine-article-spec.mjs'

/** [id, 설명, [[파일, 원문, 변이], ...]] — 여러 지점은 한 결함을 함께 만든다 */
const MUTATIONS = [
  ['MT1', 'DIRECT 분기 제거 — DIRECT 도 review.ts 로 본다', [
    [BQ, 'const direct = mode?.ok === true && mode.mode === DIRECT_SPEC_MODE', 'const direct = false'],
  ]],
  ['MT2', '빈 주제 패턴 허용 — source · spec · batch 모두 빈 배열을 통과시킨다', [
    [SRC, "  if (schema === DIRECT_SPEC_SOURCE_SCHEMA && !isPresent(valueAt(entry, TOPIC_PATTERNS_FIELD), TOPIC_PATTERNS_FIELD)) missing.push(TOPIC_PATTERNS_FIELD)\n", ''],
    [SPEC, "if (!Array.isArray(value) || value.length === 0) fail('ARTICLE_SPEC_TOPIC_PATTERNS'", "if (!Array.isArray(value)) fail('ARTICLE_SPEC_TOPIC_PATTERNS'"],
    [SRC, '!Array.isArray(patterns) || patterns.length === 0) {', '!Array.isArray(patterns)) {'],
  ]],
  ['MT3', 'spec 검증 우회 — 디스크 spec 을 승인 source 와 맞춰 보지 않는다', [
    [SRC, '  const v = verifyDirectSpecOnDisk({ slug, queue, draftsDir, expectedGraphVersion, productRoot })\n  if (!v.ok) return { ok: false, code: v.code, why: v.why }\n  const patterns',
      '  const v = { ok: true, spec: disk.spec }\n  const patterns'],
  ]],
  ['MT4', '주제 패턴 대조 제거 — DIRECT 패턴을 읽고도 원고에 대지 않는다', [
    [BQ, 'const fv = judgeForbidden(text, patterns)', 'const fv = judgeForbidden(text, direct ? [] : patterns)'],
  ]],
  ['MT5', '가짜 review.ts 를 DIRECT 권위로 쓴다', [
    [BQ, 'const review = direct || (mode && !mode.ok) ? null : loadReview(dir)', 'const review = loadReview(dir)'],
    [BQ, '? (directSpec?.ok ? directSpec.patterns : null)', '? (Array.isArray(review?.forbiddenPatterns) ? review.forbiddenPatterns : directSpec?.ok ? directSpec.patterns : null)'],
  ]],
  ['MT6', 'legacy 를 DIRECT 규칙으로 오염 — opt-in 없는 행도 spec 을 요구한다', [
    [BQ, 'const direct = mode?.ok === true && mode.mode === DIRECT_SPEC_MODE', 'const direct = mode?.ok === true'],
  ]],
  ['MT7a', 'topicConstraints 를 literal 패턴으로 대조한다 (batch)', [
    [SRC, 'return { ok: true, patterns: [...patterns], specHash', 'return { ok: true, patterns: [...patterns, ...v.spec.safety.topicConstraints], specHash'],
  ]],
  ['MT7b', 'topicConstraints 문장을 주제 패턴으로 받아 준다 (컴파일)', [
    [SPEC, "    if (constraints.has(item)) fail('ARTICLE_SPEC_TOPIC_PATTERNS', `topicForbiddenPatterns[${index}] 는 topicConstraints 문장이다 — 지침을 literal 로 쓰지 않는다`)\n", ''],
  ]],
  ['MT8', 'source/3 패턴을 spec 으로 넘기지 않는다 (spec/1 로 떨어진다)', [
    [SRC, '    ...(sourceV3 ? { topicForbiddenPatterns: entry.node.forbiddenPatterns } : {}),\n', ''],
  ]],
  ['MT10', 'spec/1 을 더는 검증하지 않는다 — 운영 디스크의 옛 spec 을 supersedes 로 대체할 수 없다', [
    [SPEC, 'if ((spec.schemaVersion !== ARTICLE_SPEC_SCHEMA && !v2) || spec.mode !== ARTICLE_SPEC_MODE) {', 'if (!v2 || spec.mode !== ARTICLE_SPEC_MODE) {'],
  ]],
  ['MT9', '공통 목록을 주제 패턴으로 받아 준다', [
    [SPEC, "    if (common.has(item)) fail('ARTICLE_SPEC_TOPIC_PATTERNS', `topicForbiddenPatterns[${index}] 는 공통 고정 목록이다 — 주제별 패턴이 아니다`)\n", ''],
  ]],
]

const LOAD_FAILURE = /batch-qa 출력을 읽지 못했다|SyntaxError|Cannot find module|is not defined/
const before = Object.fromEntries(COPY.filter((p) => p.endsWith('.mjs') || p.endsWith('.ts')).map((p) => [p, readFileSync(join(ROOT, p), 'utf8')]))
const watched = [BQ, SRC, SPEC].map((p) => [p, readFileSync(join(ROOT, p), 'utf8')])

let pass = 0
let fail = 0
for (const [id, label, sites] of MUTATIONS) {
  const mut = makeRoot()
  const bad = []
  for (const [file, from, to] of sites) {
    const p = join(mut, file)
    const text = readFileSync(p, 'utf8')
    const count = text.split(from).length - 1
    if (count !== 1) { bad.push(`${file} 지점 ${count}곳`); continue }
    writeFileSync(p, text.replace(from, to))
  }
  if (bad.length) { fail += 1; console.log(`FAIL ${id} ${label} — 변이 지점이 정확히 1곳이 아니다 (${bad.join(' · ')}) — 하네스 결함`); continue }
  const syntax = sites.map(([f]) => f).filter((f, i, a) => a.indexOf(f) === i)
    .map((f) => spawnSync(process.execPath, ['--check', join(mut, f)], { encoding: 'utf8' })).find((r) => r.status !== 0)
  if (syntax) { fail += 1; console.log(`FAIL ${id} ${label} — 변이 사본이 문법 오류다 — 하네스 결함: ${syntax.stderr.split('\n')[0]}`); continue }
  const out = []
  const origLog = console.log
  console.log = (...a) => out.push(a.join(' '))
  let r
  try { r = await runCases(topicForbiddenCases({ root: () => makeRoot(mut) })) } finally { console.log = origLog }
  const failed = out.filter((l) => l.startsWith('FAIL '))
  const real = failed.filter((l) => !LOAD_FAILURE.test(l))
  if (real.length) { pass += 1; console.log(`PASS ${id} ${label} → 잡혔다 — ${real[0].slice(5, 160)}`) }
  else if (failed.length) { fail += 1; console.log(`FAIL ${id} ${label} — 실행 실패만 났다(잡힌 것이 아니다) — ${failed[0].slice(5, 200)}`) }
  else { fail += 1; console.log(`FAIL ${id} ${label} → 모든 반례가 통과했다 (${r.pass} pass)`) }
}

// 🔴 원본 바이트 불변 — 변이는 사본에만 들어갔다
for (const [p, text] of [...watched, ...Object.entries(before)]) {
  if (readFileSync(join(ROOT, p), 'utf8') !== text) { fail += 1; console.log(`FAIL 원본 ${p} 가 바뀌었다`) }
}
console.log(`\nDIRECT 주제 금지 패턴 변이: ${pass} pass, ${fail} fail`)
if (fail) process.exitCode = 1

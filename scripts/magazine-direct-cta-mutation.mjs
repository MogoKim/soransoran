#!/usr/bin/env node
/**
 * DIRECT CTA 앞 문장 변이 (2026-10-28 · age-learning "밤 이야기" 노출) — 관문을 하나씩 끊으면
 * wire-check 의 CTA 반례(W42~W48) 중 하나가 **단언으로** 실패해야 한다.
 *
 * 🔴 변이는 임시 루트 사본에만 넣고 그 사본에서 wire-check 를 통째로 돌린다 — 작업 트리 원본 바이트 0 변경(마지막에 확인).
 * 🔴 지점은 파일마다 정확히 1곳 · 변이 사본은 문법 검사를 지나야 한다(실행 실패는 "잡혔다" 가 아니다).
 * 🔴 wire-check 가 끝까지 돌아 합계 줄을 찍어야 한다 — 중간에 죽은 실행은 하네스 결함으로 센다.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { ROOT, makeRoot } from './magazine-direct-topic-forbidden-check.mjs'

const DS = 'scripts/lib/magazine-direct-spec.mjs'
const RUNNER = 'scripts/magazine-webui-runner.mjs'
const AR = 'scripts/magazine-auto-register.mjs'

const MUTATIONS = [
  ['MC1', 'spec/2 brief 가 옛 고정 문장을 쓴다', [[DS, '${spec.schemaVersion === ARTICLE_SPEC_SCHEMA_V2 ? directCtaLeadDirective(spec) : LEGACY_DIRECT_CTA_LEAD}', '${LEGACY_DIRECT_CTA_LEAD}']]],
  ['MC2', 'spec/1 brief 도 지시문으로 바꾼다 (기존 지문 깨짐)', [[DS, '${spec.schemaVersion === ARTICLE_SPEC_SCHEMA_V2 ? directCtaLeadDirective(spec) : LEGACY_DIRECT_CTA_LEAD}', '${directCtaLeadDirective(spec)}']]],
  ['MC3', 'CTA 판정을 끈다', [[DS, '  if (spec?.schemaVersion !== ARTICLE_SPEC_SCHEMA_V2) return { ok: true }\n  const ctas', '  return { ok: true }\n  const ctas']]],
  ['MC4', '옛 고정 문장을 알아보지 않는다', [[DS, 'text === LEGACY_DIRECT_CTA_LEAD || ', '']]],
  ['MC5', 'spec/1 원고도 CTA 판정을 받는다 (legacy·spec/1 동작 변경)', [[DS, '  if (spec?.schemaVersion !== ARTICLE_SPEC_SCHEMA_V2) return { ok: true }\n  const ctas', '  if (false) return { ok: true }\n  const ctas']]],
  ['MC6', 'runner 저장 전 관문이 CTA 판정을 버린다', [[RUNNER, '    return c.ok ? v : { ...v, ok: false,', '    return v || { ...v, ok: false,']]],
  ['MC7', 'runner 회수(fetch)가 일반 관문만 쓴다', [[RUNNER, '    validate: manuscriptValidatorFor(gate, { slug, draftsDir }),\n    onBeforeSend', '    validate: validateManuscript,\n    onBeforeSend']]],
  ['MC8', 'runner 무전송 회수(recover)가 일반 관문만 쓴다', [[RUNNER, '      validate: manuscriptValidatorFor(gate, { slug, draftsDir }), checkOnly,', '      validate: validateManuscript, checkOnly,']]],
  ['MC9', 'auto-register 가 저장된 원고의 CTA 를 보지 않는다', [[AR, "    if (!c.ok) return stop('article', c.code, c.why, { ctaText: c.text })\n", '']]],
  ['MC10', 'auto-register 가 재생성 후보의 CTA 를 보지 않는다', [[AR, '        const t = tt.ok ? directSpecCtaCheck({ spec: directSpec, manuscript: candidateText }) : tt', '        const t = tt']]],
  ['MC11', '재생성 중단 코드가 CTA 위반을 일반 코드로 덮는다', [[AR, '(rr?.code === DIRECT_CTA_TEMPLATE_COPY ? rr.code : (', '((']]],
]

const watched = [DS, RUNNER, AR].map((p) => [p, readFileSync(join(ROOT, p), 'utf8')])
const CTA_CASE = /^FAIL W4[2-8] /
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
  const syntax = [...new Set(sites.map(([f]) => f))].map((f) => spawnSync(process.execPath, ['--check', join(mut, f)], { encoding: 'utf8' })).find((r) => r.status !== 0)
  if (syntax) { fail += 1; console.log(`FAIL ${id} ${label} — 변이 사본이 문법 오류다 — 하네스 결함`); continue }
  const r = spawnSync(process.execPath, ['scripts/magazine-direct-spec-wire-check.mjs'], { cwd: mut, encoding: 'utf8', timeout: 600000 })
  const finished = /DIRECT_SPEC_V1 wire-check: \d+ pass, \d+ fail/.test(r.stdout)
  // 🔴 wire-check 는 FAIL 을 stderr 로 찍는다 — 두 흐름을 다 읽는다(한쪽만 보면 잡힌 변이를 놓친다)
  const caught = `${r.stdout}\n${r.stderr}`.split('\n').filter((l) => CTA_CASE.test(l))
  if (!finished) { fail += 1; console.log(`FAIL ${id} ${label} — wire-check 가 끝까지 돌지 않았다(실행 실패는 잡힌 것이 아니다) — ${r.stderr.split('\n')[0]}`) }
  else if (caught.length) { pass += 1; console.log(`PASS ${id} ${label} → 잡혔다 — ${caught[0].slice(5, 150)}`) }
  else { fail += 1; console.log(`FAIL ${id} ${label} → CTA 반례가 모두 통과했다`) }
}
for (const [p, text] of watched) if (readFileSync(join(ROOT, p), 'utf8') !== text) { fail += 1; console.log(`FAIL 원본 ${p} 가 바뀌었다`) }
console.log(`\nDIRECT CTA 변이: ${pass} pass, ${fail} fail`)
if (fail) process.exitCode = 1

#!/usr/bin/env tsx
/**
 * Persona Safety Gate fixture — 네트워크 · DB · LLM 없이 계약을 검증한다
 *
 * 정본: docs/operations/2026-08-30-persona-safety-originality-gate-design.md
 *
 * 이번 단계는 **⑤ 금지 호칭 / 브랜드 금칙어**만 다룬다.
 * ⑨ Source Community Marker 는 다음 PR 이다.
 *
 * 🔴 이 fixture 가 검사하는 것은 "잘 잡는가" 가 아니라 **"선을 넘지 않는가"** 다:
 *      ① 두 갈래를 **둘 다** 보는가 — 갈래 2 가 빠지면 "어르신" 이 통과한다
 *      ② 두 갈래를 **분리해서** 보고하는가 — 합치면 원인을 잃는다
 *      ③ 살려야 할 표현을 **죽이지 않는가** — GENERIC · REGISTER 는 통과해야 한다
 *      ④ ⑤ 가 ⑨ 의 일을 **가져가지 않는가** — 브랜드 정책과 출처 세탁은 다른 문제다
 *      ⑤ DB · LLM 경로가 들어오지 않는가 — 이 판정부는 비용 0원이어야 한다
 *
 * 🔴 ① 이 이 파일의 존재 이유에 가깝다.
 *    문서가 오래 "M3_FORBIDDEN_ADDRESS_TERMS 하나면 시니어·어르신까지 잡힌다" 고
 *    적어 왔다. 실제로는 그 상수에 그 넷이 없다. 문서는 고쳤지만(PR #214)
 *    사람은 같은 실수를 반복하고, 문서는 읽히지 않는다. fixture 는 읽힌다.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkForbiddenAddress, FORBIDDEN_ADDRESS_LANES,
} from './lib/persona-gate-forbidden-address.mjs'
import {
  computeCommunityRegister,
  TARGET_DESCRIPTOR_TERMS, SORANSORAN_REGISTER_TERMS, GENERIC_COMMUNITY_TERMS,
} from './lib/voice-style-signals.mjs'
import { BRAND_BANNED_WORDS } from '../src/lib/content-guard'

const HERE = dirname(fileURLToPath(import.meta.url))
const GATE_LIB = join(HERE, 'lib/persona-gate-forbidden-address.mts')

const report: Array<{ ok: boolean; kind: string; name: string; detail: string }> = []
const failures: string[] = []
const ok = (name: string, kind: string, detail: string) => report.push({ ok: true, kind, name, detail })
const bad = (name: string, kind: string, detail: string) => {
  report.push({ ok: false, kind, name, detail })
  failures.push(`${name} — ${detail}`)
}

/** 🔴 `/**` 로 시작하는 한 줄 JSDoc 도 걷어낸다 — 설명을 위반으로 읽으면 안 된다 */
const stripComments = (raw: string): string =>
  raw.split('\n').filter((l) => !/^\s*(\/\*|\*|\/\/|--)/.test(l)).join('\n')

const gateRaw = readFileSync(GATE_LIB, 'utf-8')
const gateCode = stripComments(gateRaw)

// ── ① 갈래 1 — 타겟 설명어 15개를 전부 잡는다 ─────────────
{
  const offenders: string[] = []
  for (const term of TARGET_DESCRIPTOR_TERMS) {
    const v = checkForbiddenAddress(`저기요 ${term} 이런 경우 어떻게 하세요?`)
    if (v.status !== 'regenerate') offenders.push(`${term} 이 ${v.status}`)
    if (!v.targetDescriptors.some((t) => term.includes(t) || t.includes(term))) {
      offenders.push(`${term} 미검출`)
    }
    // 🔴 타겟 설명어가 브랜드 갈래로 새면 원인 분리가 깨진다
    if (v.brandBannedWords.length > 0) offenders.push(`${term} 이 브랜드 갈래로 샜다`)
  }
  if (offenders.length) bad('갈래 1 — 타겟 설명어 전건 차단', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('갈래 1 — 타겟 설명어 전건 차단', 'policy', `${TARGET_DESCRIPTOR_TERMS.length}종 전부 regenerate`)
}

// ── ② 갈래 2 — 브랜드 금지어 4개를 전부 잡는다 ────────────
//    🔴 여기가 PR #214 정정의 실행 증거다. 갈래 1 만 보면 전부 통과한다.
{
  const offenders: string[] = []
  for (const word of BRAND_BANNED_WORDS) {
    const v = checkForbiddenAddress(`${word} 이야기라서 조심스럽네요`)
    if (v.status !== 'regenerate') offenders.push(`${word} 이 ${v.status}`)
    if (!v.brandBannedWords.includes(word)) offenders.push(`${word} 미검출`)
    // 🔴 브랜드 금지어가 타겟 갈래로 새면 원인 분리가 깨진다
    if (v.targetDescriptors.length > 0) offenders.push(`${word} 이 타겟 갈래로 샜다`)
  }
  if (offenders.length) bad('갈래 2 — 브랜드 금지어 전건 차단', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('갈래 2 — 브랜드 금지어 전건 차단', 'policy', `${BRAND_BANNED_WORDS.length}종 전부 regenerate`)
}

// ── ③ 두 갈래가 분리 보고된다 ────────────────────────────
{
  const offenders: string[] = []
  const both = checkForbiddenAddress('어르신 그리고 우리 또래분들 이야기예요')
  if (both.targetDescriptors.length === 0) offenders.push('타겟 갈래가 비었다')
  if (both.brandBannedWords.length === 0) offenders.push('브랜드 갈래가 비었다')
  if (!both.targetDescriptors.includes('우리 또래분들')) offenders.push('우리 또래분들 이 타겟 갈래에 없다')
  if (!both.brandBannedWords.includes('어르신')) offenders.push('어르신 이 브랜드 갈래에 없다')
  // 🔴 한쪽 배열이 다른 쪽 항목을 담으면 합쳐진 것이다
  if (both.targetDescriptors.includes('어르신')) offenders.push('🔴 두 갈래가 합쳐졌다 (타겟에 어르신)')
  if (both.brandBannedWords.includes('우리 또래분들')) offenders.push('🔴 두 갈래가 합쳐졌다 (브랜드에 또래)')
  // 로그도 원인을 구분해야 한다
  if (!/타겟 설명어/.test(both.reason) || !/브랜드 금지어/.test(both.reason)) {
    offenders.push('reason 이 원인을 구분하지 않는다')
  }
  if (offenders.length) bad('두 갈래를 분리 보고한다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('두 갈래를 분리 보고한다', 'policy', `타겟 ${both.targetDescriptors.length} · 브랜드 ${both.brandBannedWords.length} · reason 분리`)
}

// ── ④ 역검증 — 갈래 2 를 떼면 4단어가 통과한다 ────────────
//    🔴 판정부가 BRAND_BANNED_WORDS 를 **실제로 쓰는지** 소스에서 확인한다.
//       import 만 해두고 안 쓰면 타입은 통과하고 어르신은 새 나간다.
{
  const offenders: string[] = []
  if (!/from '\.\.\/\.\.\/src\/lib\/content-guard'/.test(gateCode)) {
    offenders.push('content-guard import 가 사라졌다')
  }
  if (!/\bBRAND_BANNED_WORDS\b/.test(gateCode)) offenders.push('BRAND_BANNED_WORDS 참조가 없다')
  // import 만 있고 판정에 쓰이지 않는 경우를 잡는다
  if (!/matchLongestFirst\(\s*text\s*,\s*BRAND_BANNED_WORDS\s*\)/.test(gateCode)) {
    offenders.push('🔴 BRAND_BANNED_WORDS 가 판정에 쓰이지 않는다')
  }
  if (!/matchLongestFirst\(\s*text\s*,\s*TARGET_DESCRIPTOR_TERMS\s*\)/.test(gateCode)) {
    offenders.push('🔴 TARGET_DESCRIPTOR_TERMS 가 판정에 쓰이지 않는다')
  }
  // 🔴 두 갈래를 배열 하나로 합치는 형태를 금지한다
  if (/\[\s*\.\.\.TARGET_DESCRIPTOR_TERMS\s*,\s*\.\.\.BRAND_BANNED_WORDS/.test(gateCode)) {
    offenders.push('🔴 두 갈래가 한 배열로 합쳐졌다')
  }
  // 실동작 — 갈래 2 없이는 잡히지 않을 단어가 실제로 잡히는지
  const onlyBrand = checkForbiddenAddress('어르신 이야기')
  if (onlyBrand.targetDescriptors.length !== 0) offenders.push('어르신이 갈래 1 로 잡혔다 (기대: 갈래 2)')
  if (onlyBrand.brandBannedWords.length !== 1) offenders.push('어르신이 갈래 2 로 잡히지 않았다')
  if (FORBIDDEN_ADDRESS_LANES.brandBannedWords !== BRAND_BANNED_WORDS.length) {
    offenders.push('브랜드 갈래 규모가 상수와 다르다')
  }
  if (offenders.length) bad('역검증 — 갈래 2 가 실제로 쓰인다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('역검증 — 갈래 2 가 실제로 쓰인다', 'guard', `갈래 ${FORBIDDEN_ADDRESS_LANES.targetDescriptors}+${FORBIDDEN_ADDRESS_LANES.brandBannedWords} · 합침 0`)
}

// ── ⑤ 소란소란 호칭 4개는 통과한다 ───────────────────────
{
  const offenders: string[] = []
  for (const term of SORANSORAN_REGISTER_TERMS) {
    const v = checkForbiddenAddress(`${term} 오늘 하루 어떠셨어요?`)
    if (v.status !== 'pass') offenders.push(`${term} 이 ${v.status} (${v.reason})`)
  }
  if (offenders.length) bad('소란소란 호칭은 통과한다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('소란소란 호칭은 통과한다', 'policy', `${SORANSORAN_REGISTER_TERMS.length}종 전부 pass`)
}

// ── ⑥ 일반 커뮤니티 표현 11개는 통과한다 ─────────────────
//    🔴 '다들' · '혹시' 가 걸리면 거의 모든 생성물이 죽는다.
{
  const offenders: string[] = []
  for (const term of GENERIC_COMMUNITY_TERMS) {
    const v = checkForbiddenAddress(`${term} 요즘 잠은 잘 주무세요?`)
    if (v.status !== 'pass') offenders.push(`${term} 이 ${v.status} (${v.reason})`)
  }
  if (offenders.length) bad('일반 커뮤니티 표현은 살린다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('일반 커뮤니티 표현은 살린다', 'policy', `${GENERIC_COMMUNITY_TERMS.length}종 전부 pass`)
}

// ── ⑦ 경계 — ⑤ 와 ⑨ 를 섞지 않는다 ──────────────────────
//    ⑤ 는 브랜드 정책이고 ⑨ 는 출처 세탁이다. 같은 판정부가 둘 다 하면
//    실패 로그에서 원인이 갈라지고, 조치도 달라진다.
{
  const offenders: string[] = []

  // '우리 또래분들' — ⑤ 가 잡고, 출처 흔적으로 분류되면 안 된다
  const desc = checkForbiddenAddress('우리 또래분들 다 그러시죠?')
  if (desc.status !== 'regenerate') offenders.push('우리 또래분들 이 ⑤ 에서 통과했다')
  const descReg = computeCommunityRegister('우리 또래분들 다 그러시죠?')
  if (!descReg.targetDescriptorRisk.includes('우리 또래분들')) offenders.push('우리 또래분들 이 targetDescriptorRisk 에 없다')
  if (descReg.sourceSpecific.length > 0) offenders.push('🔴 우리 또래분들 이 출처 흔적(⑨)으로 분류됐다')
  if (descReg.soransoranRegister.length > 0) offenders.push('🔴 우리 또래분들 이 치환 후보로 승격됐다')

  // '어르신' — ⑤ 만 잡는다. ⑨ 의 어느 갈래에도 없어야 한다
  const brand = checkForbiddenAddress('어르신 말씀이 맞는 것 같아요')
  if (brand.status !== 'regenerate') offenders.push('어르신 이 ⑤ 에서 통과했다')
  const brandReg = computeCommunityRegister('어르신 말씀이 맞는 것 같아요')
  if (brandReg.sourceSpecific.length > 0) offenders.push('🔴 어르신 이 출처 흔적(⑨)으로 분류됐다')
  if (brandReg.targetDescriptorRisk.length > 0) offenders.push('어르신 이 targetDescriptorRisk 로 잡혔다')
  if (brandReg.soransoranRegister.length > 0) offenders.push('🔴 어르신 이 치환 후보로 승격됐다')

  // 🔴 ⑤ 판정부가 출처 호칭을 가져가지 않는다 — 그건 ⑨ 의 일이다
  const src = checkForbiddenAddress('레테님들 안녕하세요')
  if (src.status !== 'pass') offenders.push(`🔴 ⑤ 가 출처 호칭까지 잡았다 (${src.reason})`)

  if (offenders.length) bad('⑤ 와 ⑨ 를 섞지 않는다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('⑤ 와 ⑨ 를 섞지 않는다', 'policy', '타겟·브랜드는 ⑤ · 출처 호칭은 ⑤ 밖')
}

// ── ⑧ 중복 검출 방지 — 긴 것을 먼저 센다 ─────────────────
//    '우리 또래분들' 이 '우리 또래' 로도 잡히면 두 건이 된다.
{
  const offenders: string[] = []
  const dup = checkForbiddenAddress('우리 또래분들 이야기예요')
  if (dup.targetDescriptors.length !== 1) {
    offenders.push(`우리 또래분들 이 ${dup.targetDescriptors.length}건으로 중복 검출`)
  }
  const dup2 = checkForbiddenAddress('50대 여성분들 계신가요')
  if (dup2.targetDescriptors.length !== 1) {
    offenders.push(`50대 여성분들 이 ${dup2.targetDescriptors.length}건으로 중복 검출`)
  }
  if (!/sort\(\(a, b\) => b\.length - a\.length\)/.test(gateCode)) {
    offenders.push('🔴 긴 것 우선 정렬이 사라졌다')
  }
  if (offenders.length) bad('중복 검출 방지', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('중복 검출 방지', 'guard', '포함 관계 1건으로 집계 · 긴 것 우선 정렬 유지')
}

// ── ⑨ 판정부가 선을 넘지 않는다 ──────────────────────────
//    🔴 DB · LLM · 네트워크 · 파일 IO 가 들어오면 "비용 0원 판정부" 가 아니게 된다.
{
  const offenders: string[] = []
  const forbidden: Array<[RegExp, string]> = [
    [/@prisma\/client|PrismaClient|from 'pg'/, 'DB 클라이언트'],
    [/anthropic|openai|fetch\(|axios|undici/i, 'LLM · 네트워크'],
    [/readFileSync|writeFileSync|node:fs/, '파일 IO'],
    [/process\.env/, '환경변수'],
  ]
  for (const [re, label] of forbidden) {
    if (re.test(gateCode)) offenders.push(`${label} 경로가 들어왔다`)
  }
  // 로그에 원문을 담지 않는다 — reason 은 상수 항목만 적는다
  const leak = checkForbiddenAddress('어르신 얘기하다가 병원 이름까지 나왔어요')
  if (leak.reason.includes('병원') || leak.reason.includes('얘기하다가')) {
    offenders.push('🔴 reason 에 원문 조각이 담겼다')
  }
  if (offenders.length) bad('판정부가 선을 넘지 않는다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('판정부가 선을 넘지 않는다', 'guard', 'DB · LLM · 파일 IO · env 0 · reason 정결')
}

// ── ⑩ 생성 파이프라인에 연결되지 않았다 ──────────────────
//    이번 PR 은 판정부와 fixture 만이다. 호출부가 생기면 범위를 넘은 것이다.
{
  const offenders: string[] = []
  if (/export\s+(async\s+)?function\s+\w*[Gg]enerate/.test(gateCode)) offenders.push('생성 함수가 있다')
  if (/persona.*create|comment.*create|post.*create/i.test(gateCode)) offenders.push('레코드 생성 경로가 있다')
  if (offenders.length) bad('생성 파이프라인 미연결', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('생성 파이프라인 미연결', 'guard', '순수 판정부 · 호출부 0')
}

// ── 출력 ────────────────────────────────────────────────
console.log('\nPersona Safety Gate ⑤ — 금지 호칭 / 브랜드 금칙어 fixture')
console.log('  이 fixture 는 네트워크 · DB · LLM 을 타지 않는다')
console.log('  🔴 검사하는 것은 "잘 잡는가" 가 아니라 "선을 넘지 않는가" 다\n')
const label: Record<string, string> = { policy: '[정책]  ', guard: '[가드]  ' }
for (const r of report) console.log(`  ${r.ok ? '✅' : '❌'} ${label[r.kind] ?? ''} ${r.name.padEnd(28)} → ${r.detail}`)
if (failures.length) {
  console.error(`\n❌ fixture ${failures.length}건 실패\n`)
  for (const f of failures) console.error(`  · ${f}`)
  console.error('')
  process.exit(1)
}
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치 — ⑤ 가 두 갈래를 보고 ⑨ 와 섞이지 않는다\n`)

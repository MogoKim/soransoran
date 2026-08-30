#!/usr/bin/env tsx
/**
 * Persona Safety Gate fixture — 네트워크 · DB · LLM 없이 계약을 검증한다
 *
 * 정본: docs/operations/2026-08-30-persona-safety-originality-gate-design.md
 *
 * 다루는 관문 — **⑤ 금지 호칭 / 브랜드 금칙어** · **⑨ Source Community Marker**
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
import { checkSourceMarker } from './lib/persona-gate-source-marker.mjs'
import {
  computeCommunityRegister,
  TARGET_DESCRIPTOR_TERMS, SORANSORAN_REGISTER_TERMS, GENERIC_COMMUNITY_TERMS,
  SOURCE_SPECIFIC_TERMS, SOURCE_CONTEXT_TERMS, CAFE_COMMUNITY_CUES, CAFE_SHOP_CUES,
} from './lib/voice-style-signals.mjs'
import { BRAND_BANNED_WORDS } from '../src/lib/content-guard'

const HERE = dirname(fileURLToPath(import.meta.url))
const GATE_LIB = join(HERE, 'lib/persona-gate-forbidden-address.mts')
const MARKER_LIB = join(HERE, 'lib/persona-gate-source-marker.mts')
const SIGNALS_LIB = join(HERE, 'lib/voice-style-signals.mts')

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
const markerCode = stripComments(readFileSync(MARKER_LIB, 'utf-8'))
const signalsCode = stripComments(readFileSync(SIGNALS_LIB, 'utf-8'))

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

// ══════ ⑨ Source Community Marker ══════════════════════

// ── ⑪ 출처 호칭 8개를 전부 잡는다 ────────────────────────
{
  const offenders: string[] = []
  for (const { term, site } of SOURCE_SPECIFIC_TERMS) {
    const v = checkSourceMarker(`${term} 이거 어떻게 하세요?`)
    if (v.status !== 'regenerate') offenders.push(`${term} 이 ${v.status}`)
    const hit = v.hits.find((h) => h.kind === 'site' && h.term === term)
    if (!hit) offenders.push(`${term} 미검출`)
    else if (hit.kind === 'site' && hit.site !== site) offenders.push(`${term} 의 site 가 ${hit.site}`)
  }
  if (offenders.length) bad('⑨ 출처 호칭 전건 차단', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('⑨ 출처 호칭 전건 차단', 'policy', `${SOURCE_SPECIFIC_TERMS.length}종 전부 regenerate · site 매핑 일치`)
}

// ── ⑫ 포함 관계는 1건으로만 집계한다 ─────────────────────
//    🔴 '82님들' 이 '82님' 으로도 잡히면 두 건이 된다.
//       '우리 카페에서는' 이 '우리 카페' 로도 잡히면 tier 판정까지 흔들린다.
{
  const offenders: string[] = []
  const dup = checkSourceMarker('82님들 안녕하세요')
  if (dup.hits.length !== 1) offenders.push(`82님들 이 ${dup.hits.length}건으로 중복 검출`)

  const ctx = checkSourceMarker('우리 카페에서는 다들 그렇게 해요')
  const ctxHits = ctx.hits.filter((h) => h.kind === 'context')
  if (ctxHits.length !== 1) offenders.push(`우리 카페에서는 이 ${ctxHits.length}건으로 중복 검출`)
  if (ctxHits[0]?.kind === 'context' && ctxHits[0].tier !== 'strong') {
    offenders.push(`우리 카페에서는 의 tier 가 ${ctxHits[0].tier}`)
  }
  // 🔴 이중 계수되면 '우리 카페'(ambiguous) 가 섞여 cafeSense 가 켜진다
  if (ctx.cafeSense !== 'none') offenders.push(`strong 단독인데 cafeSense=${ctx.cafeSense}`)

  const member = checkSourceMarker('카페 회원님들 반가워요')
  if (member.hits.length !== 1) offenders.push(`카페 회원님들 이 ${member.hits.length}건으로 중복 검출`)

  // 🔴 동작 검사만으로는 부족하다.
  //    SOURCE_CONTEXT_TERMS 가 지금은 우연히 긴 것부터 선언돼 있어
  //    정렬을 빼도 결과가 같다. 짧은 항목이 앞에 추가되는 날 중복 검출이 시작된다.
  //    ⑤ 판정부와 같은 이유로 소스에서도 확인한다.
  if (!/\[\.\.\.SOURCE_CONTEXT_TERMS\]\.sort\(\(a, b\) => b\.term\.length - a\.term\.length\)/.test(signalsCode)) {
    offenders.push('🔴 맥락 스캔의 긴 것 우선 정렬이 사라졌다')
  }
  if (!/\[\.\.\.SOURCE_SPECIFIC_TERMS\]\.sort\(\(a, b\) => b\.term\.length - a\.term\.length\)/.test(signalsCode)) {
    offenders.push('🔴 출처 호칭 스캔의 긴 것 우선 정렬이 사라졌다')
  }

  if (offenders.length) bad('⑨ 중복 검출 방지', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('⑨ 중복 검출 방지', 'guard', '출처 호칭 · 맥락 포함 관계 각 1건')
}

// ── ⑬ Tier A strong 4개는 단독으로 차단한다 ─────────────
{
  const offenders: string[] = []
  const strongTerms = SOURCE_CONTEXT_TERMS.filter((t) => t.tier === 'strong')
  for (const { term } of strongTerms) {
    const v = checkSourceMarker(`${term} 확인해 주세요`)
    if (v.status !== 'regenerate') offenders.push(`${term} 이 ${v.status}`)
    if (!v.hits.some((h) => h.kind === 'context' && h.term === term)) offenders.push(`${term} 미검출`)
  }
  if (offenders.length) bad('⑨ Tier A 는 단독 차단', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('⑨ Tier A 는 단독 차단', 'policy', `strong ${strongTerms.length}종 전부 regenerate`)
}

// ── ⑭ Tier B ambiguous — 단서가 판정을 가른다 ────────────
//    🔴 '카페' 는 커피숍이기도 하다. 단독 regenerate 로 두면 정상 글이 폐기된다.
{
  const offenders: string[] = []
  const ambiguousTerms = SOURCE_CONTEXT_TERMS.filter((t) => t.tier === 'ambiguous')
  for (const { term } of ambiguousTerms) {
    // ① 커뮤니티 단서 → regenerate
    const comm = checkSourceMarker(`${term} 게시판에 올린 글 보셨어요?`)
    if (comm.status !== 'regenerate') offenders.push(`${term}+커뮤니티단서 가 ${comm.status}`)
    if (comm.cafeSense !== 'community') offenders.push(`${term}+커뮤니티단서 cafeSense=${comm.cafeSense}`)

    // ② 커피숍 단서 → 🟢 pass
    const shop = checkSourceMarker(`${term} 커피가 진짜 맛있더라고요`)
    if (shop.status !== 'pass') offenders.push(`🔴 ${term}+커피숍단서 가 ${shop.status} (정상 글이 죽는다)`)
    if (shop.cafeSense !== 'shop') offenders.push(`${term}+커피숍단서 cafeSense=${shop.cafeSense}`)

    // ③ 단독 → review
    const alone = checkSourceMarker(`${term} 생각이 나네요`)
    if (alone.status !== 'review') offenders.push(`${term} 단독이 ${alone.status}`)
    if (alone.cafeSense !== 'unknown') offenders.push(`${term} 단독 cafeSense=${alone.cafeSense}`)

    // ④ 양쪽 단서 → review (사람이 본다)
    const both = checkSourceMarker(`${term} 커피 마시면서 게시판 봤어요`)
    if (both.status !== 'review') offenders.push(`${term}+양쪽단서 가 ${both.status}`)
    if (both.cafeSense !== 'unknown') offenders.push(`${term}+양쪽단서 cafeSense=${both.cafeSense}`)
  }
  if (offenders.length) bad('⑨ Tier B 는 단서로 가른다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('⑨ Tier B 는 단서로 가른다', 'policy',
    `ambiguous ${ambiguousTerms.length}종 × 4경우 · 커피숍 ${CAFE_SHOP_CUES.length} · 커뮤니티 ${CAFE_COMMUNITY_CUES.length}`)
}

// ── ⑮ ⑨ 가 살려야 할 것을 죽이지 않는다 ──────────────────
{
  const offenders: string[] = []
  for (const term of GENERIC_COMMUNITY_TERMS) {
    const v = checkSourceMarker(`${term} 요즘 어떻게 지내세요?`)
    if (v.status !== 'pass') offenders.push(`generic ${term} 이 ${v.status} (${v.reason})`)
  }
  for (const term of SORANSORAN_REGISTER_TERMS) {
    const v = checkSourceMarker(`${term} 오늘 하루 어떠셨어요?`)
    if (v.status !== 'pass') offenders.push(`register ${term} 이 ${v.status} (${v.reason})`)
    if (v.hits.length > 0) offenders.push(`🔴 ${term} 이 출처 흔적으로 잡혔다`)
  }
  if (offenders.length) bad('⑨ 살릴 것은 살린다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('⑨ 살릴 것은 살린다', 'policy',
    `generic ${GENERIC_COMMUNITY_TERMS.length}종 · register ${SORANSORAN_REGISTER_TERMS.length}종 전부 pass`)
}

// ── ⑯ sourceSite 로 검사 범위를 좁히지 않는다 ────────────
//    🔴 wgang 에서 온 글에 '레테님들' 이 나올 수 있다.
{
  const offenders: string[] = []
  for (const { term } of SOURCE_SPECIFIC_TERMS) {
    // sourceSite 미지정
    const none = checkSourceMarker(`${term} 안녕하세요`)
    if (none.status !== 'regenerate') offenders.push(`sourceSite 없이 ${term} 이 ${none.status}`)
    // 🔴 전혀 다른 sourceSite 를 줘도 결과가 같아야 한다
    const other = checkSourceMarker(`${term} 안녕하세요`, { sourceSite: 'navercafe:masanmam' })
    if (other.status !== 'regenerate') offenders.push(`다른 site 지정 시 ${term} 이 ${other.status}`)
    if (other.hits.length !== none.hits.length) offenders.push(`${term} 이 site 지정에 따라 hit 수가 달라졌다`)
    if (other.sourceSite !== 'navercafe:masanmam') offenders.push('sourceSite 가 로그에 남지 않았다')
  }
  // 🔴 판정부가 sourceSite 로 필터링하는 코드를 갖고 있으면 안 된다
  if (/\.filter\([^)]*sourceSite/.test(markerCode)) offenders.push('🔴 sourceSite 로 필터링한다')
  if (/site\s*===\s*opts\.sourceSite|opts\.sourceSite\s*===\s*/.test(markerCode)) {
    offenders.push('🔴 sourceSite 로 검사 범위를 좁힌다')
  }
  if (offenders.length) bad('⑨ sourceSite 는 로그용일 뿐', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('⑨ sourceSite 는 로그용일 뿐', 'guard', `${SOURCE_SPECIFIC_TERMS.length}종 · site 지정 무관하게 전건 스캔`)
}

// ── ⑰ 경계 — ⑤ 와 ⑨ 는 서로의 일을 하지 않는다 ──────────
{
  const offenders: string[] = []

  // ⑤ 영역 — ⑨ 는 통과시켜야 한다
  for (const term of ['우리 또래분들', '어르신']) {
    const nine = checkSourceMarker(`${term} 어떻게 지내세요?`)
    if (nine.status !== 'pass') offenders.push(`🔴 ⑨ 가 ⑤ 영역 '${term}' 을 잡았다 (${nine.reason})`)
    if (nine.hits.length > 0) offenders.push(`🔴 '${term}' 이 출처 흔적으로 분류됐다`)
    const five = checkForbiddenAddress(`${term} 어떻게 지내세요?`)
    if (five.status !== 'regenerate') offenders.push(`⑤ 가 '${term}' 을 놓쳤다`)
  }

  // ⑨ 영역 — ⑤ 는 통과시켜야 한다
  for (const term of ['레테님들', '우갱님들']) {
    const nine = checkSourceMarker(`${term} 반가워요`)
    if (nine.status !== 'regenerate') offenders.push(`⑨ 가 '${term}' 을 놓쳤다`)
    const five = checkForbiddenAddress(`${term} 반가워요`)
    if (five.status !== 'pass') offenders.push(`🔴 ⑤ 가 ⑨ 영역 '${term}' 을 잡았다 (${five.reason})`)
  }

  // 🔴 ⑨ 판정부가 ⑤ 상수를 가져다 쓰면 두 관문이 섞인 것이다
  if (/TARGET_DESCRIPTOR_TERMS|BRAND_BANNED_WORDS|content-guard/.test(markerCode)) {
    offenders.push('🔴 ⑨ 판정부가 ⑤ 상수를 참조한다')
  }
  // 🔴 ⑤ 판정부도 ⑨ 상수를 가져다 쓰면 안 된다
  if (/SOURCE_SPECIFIC_TERMS|SOURCE_CONTEXT_TERMS/.test(gateCode)) {
    offenders.push('🔴 ⑤ 판정부가 ⑨ 상수를 참조한다')
  }

  if (offenders.length) bad('⑤ 와 ⑨ 는 서로의 일을 안 한다', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('⑤ 와 ⑨ 는 서로의 일을 안 한다', 'policy', '타겟·브랜드는 ⑤ · 출처 호칭은 ⑨ · 상수 교차 참조 0')
}

// ── ⑱ reject — 출처가 카페 운영/공지/광고 문맥 ───────────
{
  const offenders: string[] = []
  const rej = checkSourceMarker('레테님들 등업 신청하세요', { sourceIsCafeOperational: true })
  if (rej.status !== 'reject') offenders.push(`운영 문맥인데 ${rej.status}`)
  // 🔴 marker 가 없으면 reject 하지 않는다 — 플래그만으로 후보를 버리지 않는다
  const clean = checkSourceMarker('오늘 날씨가 좋네요', { sourceIsCafeOperational: true })
  if (clean.status !== 'pass') offenders.push(`marker 0 인데 ${clean.status}`)
  if (offenders.length) bad('⑨ 운영 문맥은 reject', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('⑨ 운영 문맥은 reject', 'policy', 'marker 있을 때만 reject · 없으면 pass')
}

// ── ⑲ ⑨ 판정부가 선을 넘지 않는다 ────────────────────────
{
  const offenders: string[] = []
  const forbidden: Array<[RegExp, string]> = [
    [/@prisma\/client|PrismaClient|from 'pg'/, 'DB 클라이언트'],
    [/anthropic|openai|fetch\(|axios|undici/i, 'LLM · 네트워크'],
    [/readFileSync|writeFileSync|node:fs/, '파일 IO'],
    [/process\.env/, '환경변수'],
  ]
  for (const [re, label] of forbidden) {
    if (re.test(markerCode)) offenders.push(`${label} 경로가 들어왔다`)
  }
  // 생성 파이프라인 연결 금지
  if (/\.create\(\{|\.update\(\{|\.upsert\(/.test(markerCode)) offenders.push('레코드 생성/수정 경로가 있다')

  // 🔴 로그에 원문을 담지 않는다 — hits[].term 은 전부 상수 목록 안에 있어야 한다
  const known = new Set<string>([
    ...SOURCE_SPECIFIC_TERMS.map((s) => s.term),
    ...SOURCE_CONTEXT_TERMS.map((c) => c.term),
  ])
  const leak = checkSourceMarker('레테님들 우리 카페 게시판에 ○○병원 후기 올렸어요')
  for (const h of leak.hits) {
    if (!known.has(h.term)) offenders.push(`🔴 hits 에 상수 밖 문자열: 길이 ${h.term.length}`)
  }
  if (leak.reason.includes('병원') || leak.reason.includes('후기')) {
    offenders.push('🔴 reason 에 원문 조각이 담겼다')
  }
  if (offenders.length) bad('⑨ 판정부가 선을 넘지 않는다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('⑨ 판정부가 선을 넘지 않는다', 'guard', 'DB · LLM · 파일 IO · env 0 · hits/reason 정결')
}

// ── ⑳ VE-M2 계약 — 기존 5개 필드를 건드리지 않았다 ───────
//    🔴 voice-derive-check.mts 가 이 구조를 검사한다. 바꾸면 학습 파이프라인이 깨진다.
{
  const offenders: string[] = []
  const r = computeCommunityRegister('82님들 우리 또래분들 여기 계신 분들 소란님들 어떠세요?')
  for (const key of ['sourceSpecific', 'soransoranRegister', 'targetDescriptorRisk',
    'genericCommunityPhrase', 'preserveStructure'] as const) {
    if (!(key in r)) offenders.push(`기존 필드 ${key} 가 사라졌다`)
  }
  for (const key of ['sourceContextRisk', 'cafeSense'] as const) {
    if (!(key in r)) offenders.push(`신규 필드 ${key} 가 없다`)
  }
  // 기존 갈래가 여전히 각자 일한다
  // 🔴 필드가 통째로 사라져도 **크래시가 아니라 실패로** 보고해야 한다.
  //    크래시는 exit 1 이라 CI 는 막지만, 어느 계약이 깨졌는지 리포트에 남지 않는다.
  if (!Array.isArray(r.sourceSpecific) || !r.sourceSpecific.some((s) => s.term === '82님들')) offenders.push('sourceSpecific 회귀')
  if (!Array.isArray(r.targetDescriptorRisk) || !r.targetDescriptorRisk.includes('우리 또래분들')) offenders.push('targetDescriptorRisk 회귀')
  if (!Array.isArray(r.soransoranRegister) || !r.soransoranRegister.includes('소란님들')) offenders.push('soransoranRegister 회귀')
  if (!Array.isArray(r.genericCommunityPhrase) || r.genericCommunityPhrase.length === 0) offenders.push('genericCommunityPhrase 회귀')
  if (!Array.isArray(r.sourceContextRisk)) offenders.push('sourceContextRisk 가 배열이 아니다')
  if (offenders.length) bad('VE-M2 계약 유지 · 필드 추가만', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('VE-M2 계약 유지 · 필드 추가만', 'guard', '기존 5 유지 · 신규 2 추가 · 갈래 회귀 0')
}

// ── 출력 ────────────────────────────────────────────────
console.log('\nPersona Safety Gate ⑤ · ⑨ — 금지 호칭 / 출처 흔적 fixture')
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
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치 — ⑤ 는 두 갈래를 보고 ⑨ 는 출처 흔적만 본다\n`)

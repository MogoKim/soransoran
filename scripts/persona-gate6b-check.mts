#!/usr/bin/env tsx
/**
 * Persona Safety Gate ⑥-B fixture — 네트워크 · DB · LLM 없이 계약을 검증한다
 *
 * 정본: docs/operations/2026-08-31-persona-gate6-nickname-collision-design.md
 *
 * 🔴 이 fixture 가 검사하는 것은 "잘 잡는가" 가 아니라 **"선을 넘지 않는가"** 다:
 *      ① N3 가 reject 로 새지 않는가 — 실측상 열에 하나가 근거 없이 걸린다
 *      ② N3 가 빈 문자열일 때 비교를 **하지 않는가** — 한글 없는 이름이 전부 같아진다
 *      ③ 짧은 이름에 유사도를 적용하지 않는가 — 2자 이하는 완전 일치만
 *      ④ 크롤 작가(옛 B2) 대조가 판정에 다시 들어오지 않는가 — 옛 authorHash 값의 유무 · 섞임이 판정을 바꾸지 않는다(2026-10-01 · #641)
 *      ⑤ 반환값에 **원문 문자열이 없는가** — 이 판정부에서 가장 깨지기 쉬운 원칙
 *      ⑥ DB · LLM 경로가 들어오지 않는가 — 판정부는 순수 함수여야 한다
 *
 * 🔴 **합성 문자열만 쓴다.** 실회원 닉네임 · 크롤 author 를 fixture 에 넣으면
 *    저장소에 원문이 남는다. 아래 이름은 전부 지어낸 것이다.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkNameCollision, summarizeForAdmin,
  normalizeN1, normalizeN2, normalizeN3, editDistance,
  NAME_COLLISION_THRESHOLDS,
  type NameCollisionSets,
} from './lib/persona-gate-name-collision.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const GATE_LIB = join(HERE, 'lib/persona-gate-name-collision.mts')
const SETS_LIB = join(HERE, 'lib/persona-name-collision-sets.mts')

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
const setsCode = stripComments(readFileSync(SETS_LIB, 'utf-8'))


// 🔴 전부 합성 문자열이다
const MEMBER = ['봄뜰하나', '겨울숲둘', '가을바다셋']
const PERSONA = ['여름길넷']

const baseSets: NameCollisionSets = { memberNames: MEMBER, personaNames: PERSONA }

// ── ① pass ─────────────────────────────────────────────
{
  const v = checkNameCollision('민들레섬', baseSets)
  if (v.status !== 'pass') bad('pass — 겹치지 않는 후보', 'case', `🔴 ${v.status} (${v.reason})`)
  else if (v.hits.length !== 0) bad('pass — 겹치지 않는 후보', 'case', `🔴 hit ${v.hits.length}건`)
  else ok('pass — 겹치지 않는 후보', 'case', 'status=pass · hit 0')
}

// ── ② reject — 완전 일치 (B1 회원) ──────────────────────
{
  const v = checkNameCollision('봄뜰하나', baseSets)
  const hit = v.hits.find((h) => h.kind === 'B1_MEMBER')
  if (v.status !== 'reject') bad('reject — 회원 완전 일치', 'case', `🔴 ${v.status}`)
  else if (hit?.stage !== 'N0' || hit.distance !== 0) bad('reject — 회원 완전 일치', 'case', `🔴 stage=${hit?.stage} d=${hit?.distance}`)
  else if (hit.refType !== 'userId') bad('reject — 회원 완전 일치', 'case', `🔴 refType=${hit.refType}`)
  else ok('reject — 회원 완전 일치', 'case', 'B1 · N0 · d0 · userId')
}

// ── ③ reject — N2 에서 일치 (공백·기호 차이) ─────────────
{
  const v = checkNameCollision('겨울 숲.둘', baseSets)
  const hit = v.hits.find((h) => h.kind === 'B1_MEMBER')
  if (v.status !== 'reject') bad('reject — N2 정규화 일치', 'case', `🔴 ${v.status}`)
  else if (hit?.stage !== 'N2') bad('reject — N2 정규화 일치', 'case', `🔴 stage=${hit?.stage}`)
  else ok('reject — N2 정규화 일치', 'case', 'B1 · N2 · d0')
}

// ── ④ reject — 5자 이상 거리 1 ──────────────────────────
{
  const v = checkNameCollision('가을바다셋넷', baseSets)
  if (v.status !== 'reject') bad('reject — 5자+ 거리1', 'case', `🔴 ${v.status} (${v.reason})`)
  else ok('reject — 5자+ 거리1', 'case', `길이 ${v.candidateLength} · reject`)
}

// ── ⑤ review — 3~4자 거리 1 은 reject 가 아니다 ──────────
{
  const v = checkNameCollision('솔잎바다', { memberNames: ['솔잎하늘'] })
  if (v.status !== 'review') bad('review — 3~4자 거리1', 'case', `🔴 ${v.status} (${v.reason})`)
  else ok('review — 3~4자 거리1', 'case', `길이 ${v.candidateLength} · review`)
}

// ── ⑥ 🔴 2자 이하는 유사도를 하지 않는다 ────────────────
{
  const v = checkNameCollision('솔밤', { memberNames: ['솔달'] })
  if (v.status !== 'pass') bad('2자 이하 유사도 제외', 'guard', `🔴 ${v.status} — 짧은 이름에 유사도가 걸렸다`)
  else ok('2자 이하 유사도 제외', 'guard', `임계 minLength=${NAME_COLLISION_THRESHOLDS.minLengthForSimilarity}`)
}

// ── ⑦ 🔴 N3 일치는 reject 가 아니라 review 다 ────────────
{
  // N2 는 다르고(숫자 유무) N3 는 같아지는 쌍
  const v = checkNameCollision('들꽃77', { memberNames: ['들꽃'] })
  const n3hit = v.hits.find((h) => h.stage === 'N3')
  if (n3hit === undefined) bad('N3 는 review 신호', 'guard', '🔴 N3 신호가 없다 — 케이스가 성립하지 않는다')
  else if (v.status === 'reject') bad('N3 는 review 신호', 'guard', '🔴 N3 가 reject 로 샜다')
  else ok('N3 는 review 신호', 'guard', `status=${v.status} · N3 hit 有`)
}

// ── ⑧ 🔴 N3 결과가 빈 문자열이면 비교하지 않는다 ─────────
{
  // 둘 다 한글이 없어 N3 가 '' 가 된다 — 여기서 같다고 하면 안 된다
  const v = checkNameCollision('ab12', { memberNames: ['xy99'] })
  const n3hit = v.hits.find((h) => h.stage === 'N3')
  if (n3hit !== undefined) bad('N3 빈 문자열 비교 제외', 'guard', '🔴 빈 문자열끼리 일치로 잡혔다')
  else ok('N3 빈 문자열 비교 제외', 'guard', 'N3 hit 0 — 비교하지 않았다')
}

// ── ⑨ regenerate — B5 운영자 / AI 느낌 ──────────────────
{
  const cases = ['소란지기', '운영도우미', 'sunny', '들꽃7']
  const offenders: string[] = []
  for (const c of cases) {
    const v = checkNameCollision(c, baseSets)
    if (v.status !== 'regenerate') offenders.push(`${c}=${v.status}`)
    if (!v.hits.some((h) => h.kind === 'B5_OPERATOR_AI')) offenders.push(`${c} B5 미검출`)
  }
  if (offenders.length) bad('regenerate — 운영자/AI 느낌', 'case', `🔴 ${offenders.join(' / ')}`)
  else ok('regenerate — 운영자/AI 느낌', 'case', `${cases.length}종 전부 regenerate`)
}

// ── ⑩ regenerate — B6 식별 정보 노출 ────────────────────
{
  const cases = ['52세아줌마', '분당동', '갑상선맘', '며느리']
  const offenders: string[] = []
  for (const c of cases) {
    const v = checkNameCollision(c, baseSets)
    if (v.status !== 'regenerate' && v.status !== 'reject') offenders.push(`${c}=${v.status}`)
    if (!v.hits.some((h) => h.kind === 'B6_IDENTIFYING')) offenders.push(`${c} B6 미검출`)
  }
  if (offenders.length) bad('regenerate — 식별 정보 노출', 'case', `🔴 ${offenders.join(' / ')}`)
  else ok('regenerate — 식별 정보 노출', 'case', `${cases.length}종 전부 검출`)
}

// ── ⑪ reject — B4 출처 커뮤니티 marker ──────────────────
{
  const v = checkNameCollision('레테님들모임', baseSets)
  const hit = v.hits.find((h) => h.kind === 'B4_SOURCE_MARKER')
  if (v.status !== 'reject') bad('reject — 출처 marker', 'case', `🔴 ${v.status}`)
  else if (hit?.term === undefined) bad('reject — 출처 marker', 'case', '🔴 term 이 없다')
  else ok('reject — 출처 marker', 'case', `B4 · term=${hit.term}`)
}

// ── ⑫ 🔴 옛 크롤 작가 해시는 inert — 유무 · 섞임이 판정을 만들지도 막지도 않는다 (2026-10-01 · #641) ──
//    호출부가 옛 칸을 실어 보내도(타입 밖 값) 판정부는 읽지 않는다. 같은 이름 · 같은 회원 집합이면 결과가 같아야 한다.
{
  const legacyV1 = `sha256:${'a'.repeat(64)}`
  const legacyV2 = `hmac-v2:${'b'.repeat(12)}:${'c'.repeat(64)}`
  const variants: Array<[string, Record<string, unknown>]> = [
    ['없음', {}],
    ['v1 만', { authorHashes: new Set([legacyV1]), authorHashNorms: new Set([legacyV1]) }],
    ['v1 · v2 섞임', { authorHashes: new Set([legacyV1, legacyV2]), authorHashNorms: new Set<string>() }],
    ['빈 집합', { authorHashes: new Set<string>(), authorHashNorms: new Set<string>() }],
  ]
  const offenders: string[] = []
  for (const name of ['민들레섬', '봄뜰하나', '여름길넷', '레테님들모임']) {
    const want = JSON.stringify(checkNameCollision(name, baseSets))
    for (const [label, extra] of variants) {
      const got = JSON.stringify(checkNameCollision(name, { ...baseSets, ...extra } as NameCollisionSets))
      if (got !== want) offenders.push(`${label} 이 결과를 바꿨다`)
    }
  }
  if (offenders.length) bad('옛 작가 해시 inert', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('옛 작가 해시 inert', 'guard', '없음 · v1 · 섞임 · 빈 집합 — 판정 동일')
}

// ── ⑬ B3 — 다른 Persona 표시명(retired · paused 포함)은 회원과 같은 규칙으로 막는다 ──
{
  const v = checkNameCollision('여름길넷', { memberNames: [], personaNames: PERSONA })
  const hit = v.hits.find((h) => h.kind === 'B3_PERSONA')
  if (v.status !== 'reject' || hit?.refType !== 'personaId') bad('B3 — Persona 완전 일치', 'case', `🔴 ${v.status} ${hit?.refType}`)
  else ok('B3 — Persona 완전 일치', 'case', 'B3 · N0 · personaId')
}

// ── ⑮ 🔴 반환값에 원문 문자열이 없다 ────────────────────
{
  const v = checkNameCollision('겨울숲둘', baseSets)
  const json = JSON.stringify(v)
  const leaked = [...MEMBER, ...PERSONA, '겨울숲둘'].filter((n) => json.includes(n))
  if (leaked.length > 0) bad('반환값에 원문 없음', 'guard', `🔴 원문 ${leaked.length}건이 반환값에 있다`)
  else ok('반환값에 원문 없음', 'guard', 'status · hits · reason 어디에도 이름이 없다')
}

// ── ⑯ 어드민 요약에도 원문이 없다 ───────────────────────
{
  const v = checkNameCollision('봄뜰하나', baseSets)
  const s = summarizeForAdmin(v)
  const json = JSON.stringify(s)
  if ([...MEMBER, '봄뜰하나'].some((n) => json.includes(n))) {
    bad('어드민 요약에 원문 없음', 'guard', '🔴 요약에 이름이 있다')
  } else if (s.counts.B1_MEMBER !== 1 || s.minDistance !== 0) {
    bad('어드민 요약에 원문 없음', 'guard', `🔴 집계가 틀렸다 B1=${s.counts.B1_MEMBER} d=${s.minDistance}`)
  } else ok('어드민 요약에 원문 없음', 'guard', '종류 · 단계 · 거리 집계만')
}

// ── ⑰ 가장 엄격한 쪽을 따른다 ───────────────────────────
{
  // B5(regenerate) 와 B1 완전 일치(reject) 가 함께 걸리는 후보
  const v = checkNameCollision('봄뜰하나7', { memberNames: ['봄뜰하나7'] })
  if (v.status !== 'reject') bad('가장 엄격한 쪽', 'policy', `🔴 ${v.status} — regenerate 가 reject 를 덮었다`)
  else ok('가장 엄격한 쪽', 'policy', 'B5 regenerate + B1 reject → reject')
}

// ── ⑱ 빈 후보 ──────────────────────────────────────────
{
  const v = checkNameCollision('   ', baseSets)
  if (v.status !== 'regenerate') bad('빈 후보', 'case', `🔴 ${v.status}`)
  else ok('빈 후보', 'case', 'regenerate')
}

// ── ⑲ 정규화 함수 계약 ──────────────────────────────────
{
  const offenders: string[] = []
  if (normalizeN1(' Ab ') !== 'ab') offenders.push('N1 trim/소문자')
  if (normalizeN2('a b.c') !== 'abc') offenders.push('N2 공백·기호 제거')
  if (normalizeN3('들꽃12ab') !== '들꽃') offenders.push('N3 숫자·영문 제거')
  if (normalizeN3('ab12') !== '') offenders.push('N3 한글 없으면 빈 문자열')
  if (editDistance('가나다', '가나라') !== 1) offenders.push('편집거리')
  if (offenders.length) bad('정규화 계약', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('정규화 계약', 'guard', 'N1 · N2 · N3 · 편집거리')
}

// ── ⑳ 소스 스캔 — 판정부가 순수 함수인가 ────────────────
{
  const offenders: string[] = []
  for (const key of ['PrismaClient', 'prisma.', 'fetch(', 'readFileSync', 'process.env']) {
    if (gateCode.includes(key)) offenders.push(`판정부가 ${key} 를 쓴다`)
  }
  // 🔴 N3 가 reject 로 쓰이지 않는가 — **같은 줄** 기준으로 본다.
  //    범위를 넓히면 바로 다음 줄의 정상 분기(distance===0 → reject)를 오탐한다
  for (const line of gateCode.split('\n')) {
    if (line.includes("'N3'") && line.includes('reject')) offenders.push('🔴 N3 와 reject 가 같은 줄에 있다')
  }
  if (!/stage === 'N3'\) return 'review'/.test(gateCode)) offenders.push('N3 → review 분기가 사라졌다')
  // 🔴 빈 문자열 가드가 사라지지 않았는가
  if (!/c3 !== '' && n3 !== ''/.test(gateCode)) offenders.push('N3 빈 문자열 가드가 사라졌다')
  // 🔴 길이 구간이 원본 길이로 되돌아가지 않았는가
  const mn = /function matchNames[\s\S]*?\n}/.exec(gateCode)?.[0] ?? ''
  if (mn === '') offenders.push('matchNames 를 찾을 수 없다')
  if (/charLength\((candidate|name)\)/.test(mn)) offenders.push('🔴 길이 구간이 원본 길이로 되돌아갔다')
  if (!/normalizedLength/.test(mn)) offenders.push('🔴 matchNames 가 N2 길이를 쓰지 않는다')
  // 🔴 (2026-10-01 · #641) 크롤 작가 대조가 다시 들어오지 않았는가 — 복구할 수 없는 축을 권위로 두지 않는다
  if (/B2_CRAWL_AUTHOR|authorHash|hashOf|matchAuthorHashes/.test(gateCode)) offenders.push('🔴 판정부에 크롤 작가 대조가 돌아왔다')
  if (offenders.length) bad('판정부는 순수 함수', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('판정부는 순수 함수', 'guard', 'DB · 네트워크 · env 없음 · N3 경계 유지 · 크롤 작가 대조 없음')
}

// ── ㉑ 소스 스캔 — 조회 계층이 write 하지 않는가 ─────────
{
  const offenders: string[] = []
  for (const key of ['update(', 'create(', 'delete(', 'upsert(', 'executeRaw', 'INSERT', 'UPDATE', 'DELETE']) {
    if (setsCode.includes(key)) offenders.push(`조회 계층이 ${key} 를 쓴다`)
  }
  // 🔴 회원 표시명은 nickname 과 name 을 둘 다 읽어야 한다
  if (!/nickname/.test(setsCode) || !/name/.test(setsCode)) offenders.push('nickname ∪ name 중 하나가 빠졌다')
  // 🔴 (2026-10-01 · #641) B3 는 실제 Persona 를 읽는다(앞판은 빈 배열) · 크롤 작가 해시는 읽지 않는다
  if (!/prisma\.persona\.findMany/.test(setsCode)) offenders.push('B3 가 Persona 를 읽지 않는다')
  if (/voiceSource|voiceCommentSignal|authorHash/.test(setsCode)) offenders.push('조회 계층이 크롤 작가 해시를 읽는다')
  if (offenders.length) bad('조회 계층은 read-only', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('조회 계층은 read-only', 'guard', 'write 0 · nickname ∪ name · B3 Persona 실조회 · 작가 해시 0')
}

// ── ㉒ 🔴 N3 만 걸린 상황에서는 절대 reject 가 아니다 (동작 기반) ─
//    소스 스캔은 우회될 수 있다. 동작으로 한 번 더 못박는다.
{
  const cases: Array<[string, string]> = [
    ['들꽃77', '들꽃'],
    ['솔잎ab', '솔잎'],
    ['바다99', '바다'],
  ]
  const offenders: string[] = []
  for (const [cand, member] of cases) {
    const v = checkNameCollision(cand, { memberNames: [member] })
    const onlyN3 = v.hits.length > 0 && v.hits.every((h) => h.stage === 'N3' || h.kind === 'B5_OPERATOR_AI')
    const n3 = v.hits.some((h) => h.stage === 'N3')
    if (!n3) { offenders.push(`${cand}: N3 신호 없음`); continue }
    if (!onlyN3) continue
    if (v.status === 'reject') offenders.push(`${cand}: N3 만인데 reject`)
  }
  if (offenders.length) bad('N3 단독은 reject 아님', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('N3 단독은 reject 아님', 'guard', `${cases.length}종 — reject 0`)
}

// ── ㉓ 🔴 길이 구간은 N2 기준이다 — 공백·기호로 우회할 수 없다 ─
{
  // "솔 밤" 은 원본 3자지만 N2 로는 "솔밤" 2자다.
  // 원본 길이로 재면 유사도 검사에 들어가 review 가 나온다 — 그러면 안 된다.
  const v = checkNameCollision('솔 밤', { memberNames: ['솔 달'] })
  if (v.status !== 'pass') {
    bad('길이 구간은 N2 기준', 'guard', `🔴 ${v.status} — 원본 길이로 재고 있다 (${v.reason})`)
  } else if (v.candidateLength !== 2) {
    bad('길이 구간은 N2 기준', 'guard', `🔴 candidateLength=${v.candidateLength} — N2 길이가 아니다`)
  } else ok('길이 구간은 N2 기준', 'guard', 'N2 2자 → 유사도 제외 · pass')
}

// ── ㉔ 기호를 넣어도 짧은 이름 가드가 유지된다 ────────────
{
  const cases: Array<[string, string]> = [
    ['솔.밤', '솔.달'],
    ['솔_밤', '솔_달'],
    ['솔 밤 ', ' 솔 달'],
  ]
  const offenders: string[] = []
  for (const [cand, member] of cases) {
    const v = checkNameCollision(cand, { memberNames: [member] })
    if (v.status !== 'pass') offenders.push(`${v.status}(len=${v.candidateLength})`)
  }
  if (offenders.length) bad('기호로 길이 가드 우회 불가', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('기호로 길이 가드 우회 불가', 'guard', `${cases.length}종 전부 pass`)
}

// ── ㉕ N2 기준 5자 이상이면 기호가 있어도 거리1 은 reject ──
{
  // "가을 바다.셋" → N2 "가을바다셋" 5자. 회원 "가을바다솔" 과 거리 1
  const v = checkNameCollision('가을 바다.셋', { memberNames: ['가을바다솔'] })
  if (v.candidateLength !== 5) bad('N2 5자+ 거리1 reject', 'guard', `🔴 len=${v.candidateLength}`)
  else if (v.status !== 'reject') bad('N2 5자+ 거리1 reject', 'guard', `🔴 ${v.status}`)
  else ok('N2 5자+ 거리1 reject', 'guard', 'N2 5자 · d1 · reject')
}

// ── 출력 ────────────────────────────────────────────────
console.log('\nPersona Safety Gate ⑥-B — displayName 충돌 fixture')
console.log('  이 fixture 는 네트워크 · DB · LLM 을 타지 않는다')
console.log('  🔴 이름은 전부 합성 문자열이다 — 실회원 닉네임 · 크롤 author 를 쓰지 않는다\n')
const label: Record<string, string> = { case: '[케이스]', guard: '[가드]  ', policy: '[정책]  ' }
for (const r of report) console.log(`  ${r.ok ? '✅' : '❌'} ${label[r.kind] ?? ''} ${r.name.padEnd(26)} → ${r.detail}`)
if (failures.length) {
  console.error(`\n❌ fixture ${failures.length}건 실패\n`)
  for (const f of failures) console.error(`  · ${f}`)
  console.error('')
  process.exit(1)
}
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치 — N3 는 review 로만 · 크롤 작가 대조 없음 · 반환값에 원문 없음\n`)

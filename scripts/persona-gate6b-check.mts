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
 *      ④ B2(해시)에서 유사도·부분 포함을 하지 않는가 — 해시로는 불가능하다
 *      ⑤ 반환값에 **원문 문자열이 없는가** — 이 판정부에서 가장 깨지기 쉬운 원칙
 *      ⑥ DB · LLM 경로가 들어오지 않는가 — 판정부는 순수 함수여야 한다
 *
 * 🔴 **합성 문자열만 쓴다.** 실회원 닉네임 · 크롤 author 를 fixture 에 넣으면
 *    저장소에 원문이 남는다. 아래 이름은 전부 지어낸 것이다.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { authorHashKeyOf, authorHashV2Of, type AuthorHashKey } from './lib/voice-author-hash.mjs'
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

// 🔴 fixture 전용 salt. 실제 salt 가 아니다
// 🔴 (2026-10-01 author-hash v2) 해시는 정본 helper 하나 — 시험 전용 key(합성 32자 이상)
const FIXTURE_KEY = authorHashKeyOf('fixture-key-not-real-0123456789abcdef')
if (!FIXTURE_KEY.ok) throw new Error('fixture key')
const hashOf = (v: string): string => authorHashV2Of(v, (FIXTURE_KEY as { ok: true; key: AuthorHashKey }).key)
/** 🔴 작가 해시 집합이 없는 순수 gate 시험용 — 운영 경로에서는 `authorGateOf` 가 빈 집합을 거절한다 */
const NO_AUTHOR = { authorHashes: new Set<string>(), authorHashNorms: new Set<string>() }

// 🔴 전부 합성 문자열이다
const MEMBER = ['봄뜰하나', '겨울숲둘', '가을바다셋']
const PERSONA = ['여름길넷']

const baseSets: NameCollisionSets = { ...NO_AUTHOR, memberNames: MEMBER, personaNames: PERSONA }

// ── ① pass ─────────────────────────────────────────────
{
  const v = checkNameCollision('민들레섬', baseSets, { hashOf })
  if (v.status !== 'pass') bad('pass — 겹치지 않는 후보', 'case', `🔴 ${v.status} (${v.reason})`)
  else if (v.hits.length !== 0) bad('pass — 겹치지 않는 후보', 'case', `🔴 hit ${v.hits.length}건`)
  else ok('pass — 겹치지 않는 후보', 'case', 'status=pass · hit 0')
}

// ── ② reject — 완전 일치 (B1 회원) ──────────────────────
{
  const v = checkNameCollision('봄뜰하나', baseSets, { hashOf })
  const hit = v.hits.find((h) => h.kind === 'B1_MEMBER')
  if (v.status !== 'reject') bad('reject — 회원 완전 일치', 'case', `🔴 ${v.status}`)
  else if (hit?.stage !== 'N0' || hit.distance !== 0) bad('reject — 회원 완전 일치', 'case', `🔴 stage=${hit?.stage} d=${hit?.distance}`)
  else if (hit.refType !== 'userId') bad('reject — 회원 완전 일치', 'case', `🔴 refType=${hit.refType}`)
  else ok('reject — 회원 완전 일치', 'case', 'B1 · N0 · d0 · userId')
}

// ── ③ reject — N2 에서 일치 (공백·기호 차이) ─────────────
{
  const v = checkNameCollision('겨울 숲.둘', baseSets, { hashOf })
  const hit = v.hits.find((h) => h.kind === 'B1_MEMBER')
  if (v.status !== 'reject') bad('reject — N2 정규화 일치', 'case', `🔴 ${v.status}`)
  else if (hit?.stage !== 'N2') bad('reject — N2 정규화 일치', 'case', `🔴 stage=${hit?.stage}`)
  else ok('reject — N2 정규화 일치', 'case', 'B1 · N2 · d0')
}

// ── ④ reject — 5자 이상 거리 1 ──────────────────────────
{
  const v = checkNameCollision('가을바다셋넷', baseSets, { hashOf })
  if (v.status !== 'reject') bad('reject — 5자+ 거리1', 'case', `🔴 ${v.status} (${v.reason})`)
  else ok('reject — 5자+ 거리1', 'case', `길이 ${v.candidateLength} · reject`)
}

// ── ⑤ review — 3~4자 거리 1 은 reject 가 아니다 ──────────
{
  const v = checkNameCollision('솔잎바다', { ...NO_AUTHOR, memberNames: ['솔잎하늘'] }, { hashOf })
  if (v.status !== 'review') bad('review — 3~4자 거리1', 'case', `🔴 ${v.status} (${v.reason})`)
  else ok('review — 3~4자 거리1', 'case', `길이 ${v.candidateLength} · review`)
}

// ── ⑥ 🔴 2자 이하는 유사도를 하지 않는다 ────────────────
{
  const v = checkNameCollision('솔밤', { ...NO_AUTHOR, memberNames: ['솔달'] }, { hashOf })
  if (v.status !== 'pass') bad('2자 이하 유사도 제외', 'guard', `🔴 ${v.status} — 짧은 이름에 유사도가 걸렸다`)
  else ok('2자 이하 유사도 제외', 'guard', `임계 minLength=${NAME_COLLISION_THRESHOLDS.minLengthForSimilarity}`)
}

// ── ⑦ 🔴 N3 일치는 reject 가 아니라 review 다 ────────────
{
  // N2 는 다르고(숫자 유무) N3 는 같아지는 쌍
  const v = checkNameCollision('들꽃77', { ...NO_AUTHOR, memberNames: ['들꽃'] }, { hashOf })
  const n3hit = v.hits.find((h) => h.stage === 'N3')
  if (n3hit === undefined) bad('N3 는 review 신호', 'guard', '🔴 N3 신호가 없다 — 케이스가 성립하지 않는다')
  else if (v.status === 'reject') bad('N3 는 review 신호', 'guard', '🔴 N3 가 reject 로 샜다')
  else ok('N3 는 review 신호', 'guard', `status=${v.status} · N3 hit 有`)
}

// ── ⑧ 🔴 N3 결과가 빈 문자열이면 비교하지 않는다 ─────────
{
  // 둘 다 한글이 없어 N3 가 '' 가 된다 — 여기서 같다고 하면 안 된다
  const v = checkNameCollision('ab12', { ...NO_AUTHOR, memberNames: ['xy99'] }, { hashOf })
  const n3hit = v.hits.find((h) => h.stage === 'N3')
  if (n3hit !== undefined) bad('N3 빈 문자열 비교 제외', 'guard', '🔴 빈 문자열끼리 일치로 잡혔다')
  else ok('N3 빈 문자열 비교 제외', 'guard', 'N3 hit 0 — 비교하지 않았다')
}

// ── ⑨ regenerate — B5 운영자 / AI 느낌 ──────────────────
{
  const cases = ['소란지기', '운영도우미', 'sunny', '들꽃7']
  const offenders: string[] = []
  for (const c of cases) {
    const v = checkNameCollision(c, baseSets, { hashOf })
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
    const v = checkNameCollision(c, baseSets, { hashOf })
    if (v.status !== 'regenerate' && v.status !== 'reject') offenders.push(`${c}=${v.status}`)
    if (!v.hits.some((h) => h.kind === 'B6_IDENTIFYING')) offenders.push(`${c} B6 미검출`)
  }
  if (offenders.length) bad('regenerate — 식별 정보 노출', 'case', `🔴 ${offenders.join(' / ')}`)
  else ok('regenerate — 식별 정보 노출', 'case', `${cases.length}종 전부 검출`)
}

// ── ⑪ reject — B4 출처 커뮤니티 marker ──────────────────
{
  const v = checkNameCollision('레테님들모임', baseSets, { hashOf })
  const hit = v.hits.find((h) => h.kind === 'B4_SOURCE_MARKER')
  if (v.status !== 'reject') bad('reject — 출처 marker', 'case', `🔴 ${v.status}`)
  else if (hit?.term === undefined) bad('reject — 출처 marker', 'case', '🔴 term 이 없다')
  else ok('reject — 출처 marker', 'case', `B4 · term=${hit.term}`)
}

// ── ⑫ B2 — 해시 완전 일치는 reject ──────────────────────
{
  const sets: NameCollisionSets = { authorHashes: new Set([hashOf('밤바다길')]), authorHashNorms: new Set<string>() }
  const v = checkNameCollision('밤바다길', sets, { hashOf })
  const hit = v.hits.find((h) => h.kind === 'B2_CRAWL_AUTHOR')
  if (v.status !== 'reject') bad('B2 — 해시 완전 일치', 'case', `🔴 ${v.status}`)
  else if (hit?.refType !== 'authorHash') bad('B2 — 해시 완전 일치', 'case', `🔴 refType=${hit?.refType}`)
  else ok('B2 — 해시 완전 일치', 'case', 'B2 · N0 · authorHash')
}

// ── ⑬ B2 — authorHashNorm 으로 N2 변형을 잡는다 ─────────
{
  const sets: NameCollisionSets = { authorHashes: new Set<string>(), authorHashNorms: new Set([hashOf(normalizeN2('밤바다길'))]) }
  const v = checkNameCollision('밤 바다.길', sets, { hashOf })
  const hit = v.hits.find((h) => h.kind === 'B2_CRAWL_AUTHOR')
  if (hit?.refType !== 'authorHashNorm') bad('B2 — Norm 으로 변형 검출', 'case', `🔴 refType=${hit?.refType}`)
  else if (v.status !== 'reject') bad('B2 — Norm 으로 변형 검출', 'case', `🔴 ${v.status}`)
  else ok('B2 — Norm 으로 변형 검출', 'case', 'B2 · N2 · authorHashNorm')
}

// ── ⑭ 🔴 B2 는 유사도를 하지 않는다 ─────────────────────
{
  const sets: NameCollisionSets = { authorHashes: new Set([hashOf('밤바다길')]), authorHashNorms: new Set<string>() }
  const v = checkNameCollision('밤바다칼', sets, { hashOf })  // 거리 1
  if (v.hits.some((h) => h.kind === 'B2_CRAWL_AUTHOR')) {
    bad('B2 유사도 금지', 'guard', '🔴 해시에서 유사 일치가 나왔다 — 불가능한 결과다')
  } else if (v.status !== 'pass') {
    bad('B2 유사도 금지', 'guard', `🔴 ${v.status}`)
  } else ok('B2 유사도 금지', 'guard', '해시는 일치 계열만 — 거리 1 은 잡히지 않는다')
}

// ── ⑮ 🔴 반환값에 원문 문자열이 없다 ────────────────────
{
  const v = checkNameCollision('겨울숲둘', baseSets, { hashOf })
  const json = JSON.stringify(v)
  const leaked = [...MEMBER, ...PERSONA, '겨울숲둘'].filter((n) => json.includes(n))
  if (leaked.length > 0) bad('반환값에 원문 없음', 'guard', `🔴 원문 ${leaked.length}건이 반환값에 있다`)
  else ok('반환값에 원문 없음', 'guard', 'status · hits · reason 어디에도 이름이 없다')
}

// ── ⑯ 어드민 요약에도 원문이 없다 ───────────────────────
{
  const v = checkNameCollision('봄뜰하나', baseSets, { hashOf })
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
  const v = checkNameCollision('봄뜰하나7', { ...NO_AUTHOR, memberNames: ['봄뜰하나7'] }, { hashOf })
  if (v.status !== 'reject') bad('가장 엄격한 쪽', 'policy', `🔴 ${v.status} — regenerate 가 reject 를 덮었다`)
  else ok('가장 엄격한 쪽', 'policy', 'B5 regenerate + B1 reject → reject')
}

// ── ⑱ 빈 후보 ──────────────────────────────────────────
{
  const v = checkNameCollision('   ', baseSets, { hashOf })
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
  // 🔴 B2 에 편집거리가 들어오지 않았는가
  const b2 = /function matchAuthorHashes[\s\S]*?\n}/.exec(gateCode)?.[0] ?? ''
  if (b2 === '') offenders.push('matchAuthorHashes 를 찾을 수 없다')
  if (/editDistance/.test(b2)) offenders.push('🔴 B2 에 편집거리가 들어왔다 — 해시로는 불가능하다')
  if (/includes\(/.test(b2)) offenders.push('🔴 B2 에 부분 포함이 들어왔다')
  if (offenders.length) bad('판정부는 순수 함수', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('판정부는 순수 함수', 'guard', 'DB · 네트워크 · env 없음 · N3/B2 경계 유지')
}

// ── ㉑ 소스 스캔 — 조회 계층이 write 하지 않는가 ─────────
{
  const offenders: string[] = []
  for (const key of ['update(', 'create(', 'delete(', 'upsert(', 'executeRaw', 'INSERT', 'UPDATE', 'DELETE']) {
    if (setsCode.includes(key)) offenders.push(`조회 계층이 ${key} 를 쓴다`)
  }
  // 🔴 회원 표시명은 nickname 과 name 을 둘 다 읽어야 한다
  if (!/nickname/.test(setsCode) || !/name/.test(setsCode)) offenders.push('nickname ∪ name 중 하나가 빠졌다')
  if (!/voiceCommentSignal/.test(setsCode)) offenders.push('VoiceCommentSignal 를 읽지 않는다')
  if (!/authorHashNorm/.test(setsCode)) offenders.push('authorHashNorm 을 읽지 않는다')
  if (offenders.length) bad('조회 계층은 read-only', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('조회 계층은 read-only', 'guard', 'write 0 · nickname ∪ name · Norm 포함')
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
    const v = checkNameCollision(cand, { ...NO_AUTHOR, memberNames: [member] }, { hashOf })
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
  const v = checkNameCollision('솔 밤', { ...NO_AUTHOR, memberNames: ['솔 달'] }, { hashOf })
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
    const v = checkNameCollision(cand, { ...NO_AUTHOR, memberNames: [member] }, { hashOf })
    if (v.status !== 'pass') offenders.push(`${v.status}(len=${v.candidateLength})`)
  }
  if (offenders.length) bad('기호로 길이 가드 우회 불가', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('기호로 길이 가드 우회 불가', 'guard', `${cases.length}종 전부 pass`)
}

// ── ㉕ N2 기준 5자 이상이면 기호가 있어도 거리1 은 reject ──
{
  // "가을 바다.셋" → N2 "가을바다셋" 5자. 회원 "가을바다솔" 과 거리 1
  const v = checkNameCollision('가을 바다.셋', { ...NO_AUTHOR, memberNames: ['가을바다솔'] }, { hashOf })
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
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치 — N3 는 review 로만 · B2 는 일치 계열만 · 반환값에 원문 없음\n`)

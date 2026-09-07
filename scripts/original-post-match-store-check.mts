#!/usr/bin/env tsx
/**
 * 매칭 결과 저장 규칙 fixture — 🔴 DB · 네트워크 · LLM 없음
 *
 * 실행: npx tsx scripts/original-post-match-store-check.mts
 * 종료 코드: 실패가 있으면 1
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  QUEUE_STATUSES, ASSIGNABLE_STATUSES, RULE_VERSION,
  MATCH_META_KEYS, ALLOWED_WRITE_KEYS, FORBIDDEN_WRITE_KEYS,
  canSetMatch, planStore, buildMatchMeta, assertMatchMeta, assertMatchWrite,
  type QueueStatus, type ScoreBreakdownLike, type MatchInput,
} from '../src/lib/original-post-match-store'

const HERE = dirname(fileURLToPath(import.meta.url))
const RULES = join(HERE, '..', 'src', 'lib', 'original-post-match-store.ts')
const CLI = join(HERE, 'original-post-match-assign.mts')
const ADMIN_LIST = join(HERE, '..', 'src', 'app', 'admin', 'original-post-candidates', 'page.tsx')
const ADMIN_DETAIL = join(HERE, '..', 'src', 'app', 'admin', 'original-post-candidates', '[id]', 'page.tsx')

let passed = 0
let failed = 0
const ok = (n: string, d: string): void => { passed += 1; console.log(`  ✅ ${n} — ${d}`) }
const bad = (n: string, d: string): void => { failed += 1; console.log(`  🔴 ${n} — ${d}`) }

const BD: ScoreBreakdownLike = { topicFit: 35, lifeConsistency: 25, voiceFit: 15, activitySpread: 15, interest: 10 }
const base: MatchInput = {
  status: 'APPROVED', createdPostId: null, assigned: 'P07', seed: 'q1',
  eligible: [{ code: 'P07', score: { total: 90, breakdown: BD } }, { code: 'P05', score: { total: 85, breakdown: BD } }],
  top: [{ code: 'P07', score: { total: 90 } }, { code: 'P05', score: { total: 85 } }],
  blockedCount: 2,
}
const I = (o: Partial<MatchInput>): MatchInput => ({ ...base, ...o })

console.log('\n══ 매칭 결과 저장 규칙 fixture ══\n')

// ── ① 🔴 상태 전이 (전수) ──
{
  const offenders: string[] = []
  for (const st of QUEUE_STATUSES) {
    const allowed = st === 'APPROVED' || st === 'EDITED'
    if (canSetMatch(st) !== allowed) offenders.push(`canSetMatch(${st})=${canSetMatch(st)}`)
    const plan = planStore(I({ status: st }))
    if (allowed && !plan.ok) offenders.push(`${st} 거부됨 (${plan.reason})`)
    if (!allowed && plan.ok) offenders.push(`🔴 ${st} 통과됨`)
  }
  if (ASSIGNABLE_STATUSES.join(',') !== 'APPROVED,EDITED') offenders.push(`허용 목록이 다르다: ${ASSIGNABLE_STATUSES.join(',')}`)
  if (offenders.length) bad('🔴 상태 전이', offenders.join(' / '))
  else ok('🔴 상태 전이', `${QUEUE_STATUSES.length}개 상태 전수 · APPROVED · EDITED 만 통과`)
}

// ── ② 🔴 createdPostId 가 있으면 status 무관 차단 ──
{
  const offenders: string[] = []
  for (const st of QUEUE_STATUSES) {
    if (planStore(I({ status: st, createdPostId: 'post_abc' })).ok) offenders.push(`🔴 ${st} + 발행됨 통과`)
  }
  // 🔴 공백만 든 값은 "없음" 으로 본다 — 있는 척하는 빈 문자열에 정상 건이 막히면 안 된다
  if (!planStore(I({ createdPostId: '   ' })).ok) offenders.push('공백 createdPostId 에 막힘')
  // PUBLISHED 는 createdPostId 가 없어도 막힌다
  if (planStore(I({ status: 'PUBLISHED', createdPostId: null })).ok) offenders.push('🔴 PUBLISHED 가 통과')
  if (offenders.length) bad('🔴 발행된 것은 건드리지 않는다', offenders.join(' / '))
  else ok('🔴 발행된 것은 건드리지 않는다', `${QUEUE_STATUSES.length}개 상태 전수 차단 · PUBLISHED 도 차단 · 공백은 없음으로`)
}

// ── ③ 🔴 배정되지 않은 건은 저장하지 않는다 ──
{
  const offenders: string[] = []
  for (const v of [null, '', '   ']) {
    if (planStore(I({ assigned: v })).ok) offenders.push(`🔴 assigned="${String(v)}" 가 통과`)
  }
  // 🔴 배정된 코드가 후보에 없으면 계산이 어긋난 것이다
  const wrong = planStore(I({ assigned: 'P99' }))
  if (wrong.ok) offenders.push('🔴 후보 밖 코드가 통과')
  else if (!wrong.reason.includes('P99')) offenders.push('후보 밖 사유에 코드가 없다')
  if (offenders.length) bad('🔴 미배정은 저장 안 함', offenders.join(' / '))
  else ok('🔴 미배정은 저장 안 함', 'null · 빈값 · 공백 · 후보 밖 코드 전부 차단')
}

// ── ④ matchMeta shape ──
{
  const plan = planStore(I({}))
  const offenders: string[] = []
  if (!plan.ok) { bad('matchMeta shape', '정상 입력이 거부됨'); }
  else {
    const m = plan.meta
    const keys = Object.keys(m).sort()
    if (keys.join(',') !== [...MATCH_META_KEYS].sort().join(',')) offenders.push(`키가 다르다: ${keys.join(',')}`)
    if (m.ruleVersion !== RULE_VERSION) offenders.push(`ruleVersion=${m.ruleVersion} (기대 ${RULE_VERSION})`)
    // 🔴 배치 배정이 최대 매칭으로 바뀐 판이다 (2026-09-07). 규칙이 바뀌면 판도 올려야
    //    나중에 "이 배정이 어느 규칙에서 나왔나" 를 말할 수 있다
    if (RULE_VERSION !== 'E-2b') offenders.push(`🔴 RULE_VERSION 이 "E-2b" 가 아니다: ${RULE_VERSION}`)
    if (m.seed !== 'q1') offenders.push(`seed=${m.seed}`)
    // 🔴 배정된 사람의 점수여야 한다 — 최고점이 아니라
    if (m.total !== 90) offenders.push(`total=${m.total} (기대 90 · P07)`)
    if (m.eligibleCount !== 2 || m.blockedCount !== 2) offenders.push(`count ${m.eligibleCount}/${m.blockedCount}`)
    if (m.top.length !== 2 || m.top[0]!.code !== 'P07') offenders.push('top 이 다르다')
    // 🔴 breakdown 5축이 전부 있어야 "왜 이 사람이었나" 에 답할 수 있다
    const bk = Object.keys(m.breakdown).sort().join(',')
    if (bk !== 'activitySpread,interest,lifeConsistency,topicFit,voiceFit') offenders.push(`breakdown 축: ${bk}`)
    // 🔴 원본을 건드리지 않는다
    if (m.breakdown === BD) offenders.push('🔴 breakdown 이 입력 객체와 같은 참조다')
    // 🔴 blockedBy 전문이 없다 — dry-run 이 다시 낸다
    const s = JSON.stringify(m)
    for (const k of ['blockedBy', 'reasons', 'detail', 'draftBody', 'rawBody']) {
      if (s.includes(k)) offenders.push(`🔴 ${k} 가 담겼다`)
    }
  }
  if (offenders.length) bad('matchMeta shape', offenders.join(' / '))
  else ok('matchMeta shape', `${MATCH_META_KEYS.length}키 · ruleVersion "${RULE_VERSION}" · breakdown 5축 · blockedBy 전문 0`)
}

// ── ⑤ 🔴 assertMatchMeta ──
{
  const offenders: string[] = []
  const good = buildMatchMeta({ seed: 's', total: 1, breakdown: BD, top: [], eligibleCount: 0, blockedCount: 0 })
  let threw = false
  try { assertMatchMeta(good) } catch { threw = true }
  if (threw) offenders.push('정상 meta 에서 던짐')
  // 🔴 허용 밖 키
  for (const k of ['blockedBy', 'draftBody', 'somethingNew']) {
    let t = false
    try { assertMatchMeta({ ...good, [k]: 'x' } as never) } catch { t = true }
    if (!t) offenders.push(`🔴 ${k} 가 통과`)
  }
  // 🔴 빈 ruleVersion · seed
  for (const patch of [{ ruleVersion: '' }, { ruleVersion: '  ' }, { seed: '' }]) {
    let t = false
    try { assertMatchMeta({ ...good, ...patch }) } catch { t = true }
    if (!t) offenders.push(`🔴 ${JSON.stringify(patch)} 가 통과`)
  }
  if (offenders.length) bad('🔴 assertMatchMeta', offenders.join(' / '))
  else ok('🔴 assertMatchMeta', '허용 밖 키 · 빈 ruleVersion · 빈 seed 차단')
}

// ── ⑥ 🔴 세 컬럼만 쓴다 ──
{
  const offenders: string[] = []
  for (const k of FORBIDDEN_WRITE_KEYS) {
    let t = false
    try { assertMatchWrite({ matchedPersonaId: 'x', [k]: 'y' }) } catch { t = true }
    if (!t) offenders.push(`🔴 ${k} 가 통과`)
  }
  // 🔴 허용 목록 밖은 이름이 뭐든 막는다
  let unknown = false
  try { assertMatchWrite({ matchedPersonaId: 'x', somethingNew: 1 }) } catch { unknown = true }
  if (!unknown) offenders.push('🔴 모르는 필드가 통과')
  let okThrew = false
  try { assertMatchWrite({ matchedPersonaId: 'x', matchedAt: new Date(), matchMeta: {} }) } catch { okThrew = true }
  if (okThrew) offenders.push('정상 3필드에서 던짐')
  if (ALLOWED_WRITE_KEYS.join(',') !== 'matchedPersonaId,matchedAt,matchMeta') offenders.push(`허용 목록: ${ALLOWED_WRITE_KEYS.join(',')}`)
  // 🔴 createdPostId · status 가 금지 목록에 있어야 한다
  for (const k of ['createdPostId', 'status']) {
    if (!FORBIDDEN_WRITE_KEYS.includes(k)) offenders.push(`🔴 ${k} 가 금지 목록에 없다`)
  }
  if (offenders.length) bad('🔴 세 컬럼만', offenders.join(' / '))
  else ok('🔴 세 컬럼만', `허용 ${ALLOWED_WRITE_KEYS.length} · 금지 ${FORBIDDEN_WRITE_KEYS.length}종 · 미지 필드 차단`)
}

// ── ⑦ 🔴 규칙 모듈이 순수한가 ──
{
  const code = readFileSync(RULES, 'utf-8').split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**')).join('\n')
  const offenders: string[] = []
  for (const k of ['PrismaClient', 'prisma.', 'fetch(', 'node:fs', 'process.env', 'Math.random']) {
    if (code.includes(k)) offenders.push(`🔴 ${k} 가 있다`)
  }
  if (/^import /m.test(code)) offenders.push('🔴 import 가 있다 — 순수 모듈이 아니다')
  if (offenders.length) bad('규칙 모듈은 순수', offenders.join(' / '))
  else ok('규칙 모듈은 순수', 'import 0 · DB 0 · 네트워크 0 · env 0')
}

// ── ⑧ 🔴 소스 스캔 — CLI write 경계 ──
{
  const code = readFileSync(CLI, 'utf-8').split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**')).join('\n')
  const offenders: string[] = []

  // 🔴 write 대상은 대기열 한 테이블뿐이다
  const writes = [...code.matchAll(/prisma\.([A-Za-z]+)\.(create|update|updateMany|upsert|delete|deleteMany|createMany)\b/g)].map((m) => m[1] ?? '')
  const badW = [...new Set(writes)].filter((m) => m !== 'originalPostApprovalQueue')
  if (badW.length > 0) offenders.push(`🔴 ${badW.join(' · ')} 에 쓴다`)
  if (writes.length === 0) offenders.push('write 가 없다 — 스캔이 헛돈다')
  // 🔴 Post · Persona · MicroSeedCandidate 는 쓰지 않는다 (읽기는 한다)
  for (const t of ['post', 'comment', 'microSeedCandidate', 'microSeedRawContent']) {
    if (new RegExp(`prisma\\.${t}\\.(create|update|updateMany|upsert|delete|deleteMany)`, 'i').test(code)) {
      offenders.push(`🔴 ${t} 에 쓴다`)
    }
  }
  if (/prisma\.persona\.(create|update|updateMany|upsert|delete)/i.test(code)) offenders.push('🔴 persona 에 쓴다')

  // 🔴 data 블록에 세 컬럼 말고 다른 것이 없다
  const dataBlocks: string[] = []
  for (const m of code.matchAll(/data:\s*\{/g)) {
    let depth = 0; let i = m.index! + m[0].length - 1; const s = i
    for (; i < code.length; i += 1) { if (code[i] === '{') depth += 1; else if (code[i] === '}') { depth -= 1; if (depth === 0) break } }
    dataBlocks.push(code.slice(s, i + 1))
  }
  if (dataBlocks.length === 0) offenders.push('data 블록이 없다')
  for (const k of ['status:', 'createdPostId:', 'draftTitle', 'draftBody', 'decidedBy', 'gateVerdict']) {
    if (dataBlocks.some((b) => b.includes(k))) offenders.push(`🔴 쓰기 자리에 ${k} 가 있다`)
  }
  for (const k of ALLOWED_WRITE_KEYS) {
    if (!dataBlocks.some((b) => b.includes(k))) offenders.push(`🔴 쓰기 자리에 ${k} 가 없다`)
  }
  // 🔴 발행하지 않는다
  for (const k of ['permanentNoindex', 'isMicroSeed', 'authorId', 'fetch(', 'anthropic', 'openai']) {
    if (code.toLowerCase().includes(k.toLowerCase())) offenders.push(`🔴 ${k} 가 있다`)
  }
  // 🔴 규칙을 다시 만들지 않는다
  if (!code.includes('planBatch(')) offenders.push('🔴 planBatch 를 부르지 않는다')
  if (!code.includes('planStore(')) offenders.push('🔴 planStore 를 부르지 않는다')
  if (code.includes('scoreMatch(')) offenders.push('🔴 CLI 가 점수를 다시 계산한다')
  // 🔴 이중 스위치 · 조건부 UPDATE · read-back · assert
  if (!code.includes("argv.includes('--apply')")) offenders.push('🔴 --apply 스위치가 없다')
  if (!/LIMIT\s*!==\s*save\.length/.test(code)) offenders.push('🔴 --limit 대조가 없다')
  if (!/status:\s*\{\s*in:\s*\['APPROVED',\s*'EDITED'\]\s*\}/.test(code)) offenders.push('🔴 조건부 UPDATE 가 아니다')
  if (!/createdPostId:\s*null/.test(code)) offenders.push('🔴 WHERE 에 createdPostId null 이 없다')
  if (!code.includes('findUniqueOrThrow')) offenders.push('🔴 read-back 이 없다')
  if (!code.includes('assertMatchWrite(') || !code.includes('assertMatchMeta(')) offenders.push('🔴 저장 직전 방어가 없다')

  if (offenders.length) bad('CLI write 경계', offenders.join(' / '))
  else ok('CLI write 경계', '대기열 3컬럼만 · Post/Persona/Candidate write 0 · 조건부 UPDATE · read-back · 이중 스위치')
}

// ── ⑨ 🔴 어드민은 읽기 전용이다 ──
{
  const offenders: string[] = []
  for (const [label, path] of [['목록', ADMIN_LIST], ['상세', ADMIN_DETAIL]] as const) {
    const code = readFileSync(path, 'utf-8')
    // 🔴 버튼 · form · 서버 액션이 없다
    for (const k of ['<button', '<form', "'use server'", 'useState', 'onClick']) {
      if (code.includes(k)) offenders.push(`🔴 ${label}에 ${k} 가 있다`)
    }
    // 🔴 write 가 없다
    if (/prisma\.[A-Za-z]+\.(create|update|updateMany|upsert|delete|deleteMany)/.test(code)) {
      offenders.push(`🔴 ${label}에 DB write 가 있다`)
    }
    // 🔴 색인 차단 유지
    if (!code.includes('robots')) offenders.push(`🔴 ${label}에 robots 가 없다`)
    // 🔴 배정 표시가 있다
    if (!code.includes('matchedPersona')) offenders.push(`${label}에 배정 표시가 없다`)
    // 🔴 페르소나 닉네임을 내지 않는다 — code 만
    if (/matchedPersona[^}]*nickname/.test(code) || /matchedPersona:\s*\{\s*select:\s*\{[^}]*user/.test(code)) {
      offenders.push(`🔴 ${label}이 페르소나 닉네임을 노출한다`)
    }
  }
  if (offenders.length) bad('🔴 어드민 읽기 전용', offenders.join(' / '))
  else ok('🔴 어드민 읽기 전용', '버튼·form·서버액션·write 0 · robots 유지 · code 만 노출')
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL\n`)
process.exit(failed === 0 ? 0 : 1)

#!/usr/bin/env tsx
/**
 * childrenAgeBands 반영 규칙 fixture — 🔴 DB · 네트워크 없음
 *
 * 🔴 이 파일이 스크립트를 import 해도 DB 가 열리지 않는다 —
 *    스크립트의 실행부가 `import.meta.url` 로 가드돼 있기 때문이다.
 *
 * 실행: npx tsx scripts/persona-children-age-bands-check.mts
 * 종료 코드: 실패가 있으면 1
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PLANNED, TARGET_CODES, validateBands, validateCount, mergeIdentity,
  planUpdate, assertNoStatusWrite,
  type PersonaRow, type IdentityLike,
} from './persona-children-age-bands.mjs'
import { CHILD_AGE_BANDS } from '../src/lib/original-post-persona-match'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'persona-children-age-bands.mts')

let passed = 0
let failed = 0
const ok = (n: string, d: string): void => { passed += 1; console.log(`  ✅ ${n} — ${d}`) }
const bad = (n: string, d: string): void => { failed += 1; console.log(`  🔴 ${n} — ${d}`) }

/** 실측 DB 를 본뜬 행 (2026-09-02) */
const ROWS: PersonaRow[] = [
  { code: 'P05', status: 'active', providerId: null, identity: { childrenCount: 2, maritalStatus: '기혼', coreWound: '돌봄이 당연시되는 자리', warmPoint: 'x' } },
  { code: 'P07', status: 'draft', providerId: null, identity: { childrenCount: 1, maritalStatus: '기혼' } },
  { code: 'P10', status: 'draft', providerId: null, identity: { childrenCount: 1, maritalStatus: '이혼' } },
  { code: 'P15', status: 'draft', providerId: null, identity: { childrenCount: 0, maritalStatus: '비혼' } },
  { code: 'P17', status: 'draft', providerId: null, identity: { childrenCount: 2, maritalStatus: '기혼' } },
]

console.log('\n══ childrenAgeBands 반영 규칙 fixture ══\n')

// ── ① 확정값이 스스로 정합한가 ──
{
  const offenders: string[] = []
  if (PLANNED.length !== 5) offenders.push(`계획 ${PLANNED.length}건 (기대 5)`)
  if (new Set(TARGET_CODES).size !== TARGET_CODES.length) offenders.push('코드 중복')
  for (const p of PLANNED) {
    const e = validateBands(p.bands)
    if (e !== null) offenders.push(`${p.code}: ${e}`)
  }
  // 🔴 P15 는 빈 배열이어야 한다 — 미기재(키 없음)와 다르다
  const p15 = PLANNED.find((p) => p.code === 'P15')
  if (p15 === undefined || !Array.isArray(p15.bands) || p15.bands.length !== 0) offenders.push('P15 가 빈 배열이 아니다')
  if (offenders.length) bad('확정값 정합', offenders.join(' / '))
  else ok('확정값 정합', `${PLANNED.length}명 · 밴드 전부 허용값 · P15 = []`)
}

// ── ② 밴드 검증 ──
{
  const offenders: string[] = []
  for (const b of CHILD_AGE_BANDS) if (validateBands([b]) !== null) offenders.push(`${b} 거부됨`)
  for (const v of ['고3', '초등학교', '', 'adult', 30, null]) {
    if (validateBands([v]) === null) offenders.push(`🔴 "${String(v)}" 통과`)
  }
  if (validateBands([]) !== null) offenders.push('빈 배열이 거부됨')
  if (offenders.length) bad('밴드 검증', offenders.join(' / '))
  else ok('밴드 검증', `허용 ${CHILD_AGE_BANDS.length}종 · 오타/숫자/null 거부 · [] 허용`)
}

// ── ③ 🔴 자녀 수 ↔ 밴드 개수 ──
{
  const offenders: string[] = []
  if (validateCount(2, ['중고등', '성인']) !== null) offenders.push('2/2 가 거부됨')
  if (validateCount(0, []) !== null) offenders.push('🔴 P15 형태(0/[])가 거부됨')
  if (validateCount(null, []) !== null) offenders.push('null/[] 이 거부됨')
  // 🔴 모름이 앎으로 둔갑하는 경우
  if (validateCount(2, ['중고등']) === null) offenders.push('🔴 2명인데 밴드 1개가 통과')
  if (validateCount(1, ['중고등', '성인']) === null) offenders.push('🔴 1명인데 밴드 2개가 통과')
  if (validateCount(0, ['성인']) === null) offenders.push('🔴 무자녀인데 밴드가 통과')
  if (offenders.length) bad('🔴 자녀 수 ↔ 밴드 개수', offenders.join(' / '))
  else ok('🔴 자녀 수 ↔ 밴드 개수', '일치만 통과 · 0/[] 허용 · 부족/초과 차단')
}

// ── ④ 🔴 identity 보존 ──
{
  const offenders: string[] = []
  const before: IdentityLike = { childrenCount: 2, maritalStatus: '기혼', coreWound: 'a', warmPoint: 'b', personality: ['x'] }
  const after = mergeIdentity(before, ['중고등', '성인'])
  for (const k of Object.keys(before)) if (!(k in after)) offenders.push(`🔴 ${k} 유실`)
  if (after.coreWound !== 'a' || after.maritalStatus !== '기혼') offenders.push('기존 값이 변형됨')
  if (!Array.isArray(after.childrenAgeBands) || (after.childrenAgeBands as unknown[]).length !== 2) offenders.push('밴드 미반영')
  // 🔴 원본을 건드리지 않는다
  if ('childrenAgeBands' in before) offenders.push('🔴 입력 객체가 변형됐다')
  // 빈 배열도 실제로 저장된다 — 키를 빼면 매칭기가 '모름' 으로 읽는다
  const empty = mergeIdentity({ childrenCount: 0 }, [])
  if (!Array.isArray(empty.childrenAgeBands)) offenders.push('🔴 [] 가 키로 저장되지 않는다')
  if (offenders.length) bad('🔴 identity 보존', offenders.join(' / '))
  else ok('🔴 identity 보존', '기존 5키 전부 유지 · 원본 불변 · [] 도 키로 저장')
}

// ── ⑤ 계획 — 실측 행 ──
{
  const plan = planUpdate(ROWS)
  const offenders: string[] = []
  if (plan.issues.length !== 0) offenders.push(`문제 ${plan.issues.map((i) => `${i.code}:${i.reason}`).join(' / ')}`)
  if (plan.apply.length !== 5) offenders.push(`반영 ${plan.apply.length} (기대 5)`)
  const p05 = plan.apply.find((a) => a.code === 'P05')
  if (p05 === undefined || p05.nextIdentity.coreWound !== '돌봄이 당연시되는 자리') offenders.push('P05 coreWound 유실')
  const p15 = plan.apply.find((a) => a.code === 'P15')
  if (p15 === undefined || p15.after.length !== 0) offenders.push('P15 가 빈 배열이 아니다')
  // 🔴 before 는 전부 미기재여야 한다 (아직 아무도 안 넣었다)
  if (plan.apply.some((a) => a.before !== null)) offenders.push('before 가 미기재가 아니다')
  if (offenders.length) bad('계획 (실측 행)', offenders.join(' / '))
  else ok('계획 (실측 행)', '5명 전부 반영 대상 · 문제 0 · identity 보존 · P15 = []')
}

// ── ⑥ 🔴 문제가 있으면 걸러진다 ──
{
  const offenders: string[] = []
  // 실회원
  const real = planUpdate(ROWS.map((r) => (r.code === 'P07' ? { ...r, providerId: 'kakao_1' } : r)))
  if (!real.issues.some((i) => i.code === 'P07')) offenders.push('🔴 실회원이 통과')
  if (real.apply.some((a) => a.code === 'P07')) offenders.push('🔴 실회원이 반영 대상에 있음')
  // 자녀 수 불일치
  const mismatch = planUpdate(ROWS.map((r) => (r.code === 'P17' ? { ...r, identity: { childrenCount: 3 } } : r)))
  if (!mismatch.issues.some((i) => i.code === 'P17')) offenders.push('🔴 자녀 수 불일치가 통과')
  // 대상에 없는 페르소나
  const extra = planUpdate([...ROWS, { code: 'P99', status: 'draft', providerId: null, identity: {} }])
  if (!extra.issues.some((i) => i.code === 'P99')) offenders.push('🔴 목록 밖 페르소나가 조용히 넘어감')
  if (extra.apply.some((a) => a.code === 'P99')) offenders.push('🔴 목록 밖 페르소나가 반영 대상')
  // 누락
  const missing = planUpdate(ROWS.filter((r) => r.code !== 'P10'))
  if (!missing.issues.some((i) => i.code === 'P10')) offenders.push('🔴 누락이 감지되지 않음')
  if (offenders.length) bad('🔴 문제 감지', offenders.join(' / '))
  else ok('🔴 문제 감지', '실회원 · 자녀 수 불일치 · 목록 밖 · 누락 전부 issue')
}

// ── ⑦ 🔴 status 를 쓰지 않는다 ──
{
  const offenders: string[] = []
  const plan = planUpdate(ROWS)
  for (const a of plan.apply) {
    for (const k of ['status', 'activatedAt', 'pausedAt', 'retiredAt']) {
      if (k in a.nextIdentity) offenders.push(`🔴 ${a.code}.identity 에 ${k}`)
    }
  }
  // assert 가 실제로 던지는가
  for (const k of ['status', 'activatedAt', 'pausedAt', 'retiredAt']) {
    let threw = false
    try { assertNoStatusWrite({ identity: {}, [k]: 'x' }) } catch { threw = true }
    if (!threw) offenders.push(`🔴 ${k} 가 있는데 던지지 않음`)
  }
  let okThrew = false
  try { assertNoStatusWrite({ identity: {} }) } catch { okThrew = true }
  if (okThrew) offenders.push('정상 data 에서 던짐')
  if (offenders.length) bad('🔴 status 를 쓰지 않는다', offenders.join(' / '))
  else ok('🔴 status 를 쓰지 않는다', 'identity 에 status 없음 · assert 가 4종 전부 차단')
}

// ── ⑧ 🔴 소스 스캔 — write 경계 ──
{
  const code = readFileSync(SCRIPT, 'utf-8').split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**')).join('\n')
  const offenders: string[] = []

  // 🔴 write 대상은 persona 하나뿐이다
  const writes = [...code.matchAll(/prisma\.([A-Za-z]+)\.(create|update|updateMany|upsert|delete|deleteMany|createMany)\b/g)].map((m) => m[1] ?? '')
  const badW = [...new Set(writes)].filter((m) => m !== 'persona')
  if (badW.length > 0) offenders.push(`🔴 ${badW.join(' · ')} 에 쓴다`)
  if (writes.length === 0) offenders.push('write 가 없다 — 스캔이 헛돈다')

  // 🔴 data 블록에 identity 말고 다른 것이 없다
  const dataBlocks: string[] = []
  for (const m of code.matchAll(/data:\s*\{/g)) {
    let depth = 0; let i = m.index! + m[0].length - 1; const s = i
    for (; i < code.length; i += 1) { if (code[i] === '{') depth += 1; else if (code[i] === '}') { depth -= 1; if (depth === 0) break } }
    dataBlocks.push(code.slice(s, i + 1))
  }
  for (const k of ['status', 'activatedAt', 'retiredAt', 'userId', 'noGoTopics', 'dailyCap']) {
    if (dataBlocks.some((b) => b.includes(k))) offenders.push(`🔴 쓰기 자리에 ${k} 가 있다`)
  }
  // 🔴 이중 스위치 · read-back
  if (!code.includes("argv.includes('--apply')")) offenders.push('🔴 --apply 스위치가 없다')
  if (!/LIMIT\s*!==\s*plan\.apply\.length/.test(code)) offenders.push('🔴 --limit 과 대상 수를 대조하지 않는다')
  if (!code.includes('findUniqueOrThrow')) offenders.push('🔴 read-back 이 없다')
  if (!code.includes('assertNoStatusWrite(')) offenders.push('🔴 저장 직전 방어가 없다')
  // 🔴 발행·네트워크 없음
  for (const k of ['permanentNoindex', 'fetch(', 'anthropic', 'openai']) {
    if (code.toLowerCase().includes(k.toLowerCase())) offenders.push(`🔴 ${k} 가 있다`)
  }
  // 🔴 다른 테이블은 **읽지도** 않는다.
  //    이름을 통째로 막으면 "활성화는 PersonaGlobalSwitch 확인이 선행된다" 고
  //    **거부 사유를 설명하는 문구**까지 걸린다 — 접근하는 코드만 본다.
  for (const t of ['post', 'comment', 'personaGlobalSwitch', 'personaAuditLog', 'originalPostApprovalQueue']) {
    if (new RegExp(`prisma\\.${t}\\b`, 'i').test(code)) offenders.push(`🔴 prisma.${t} 에 접근한다`)
  }
  // 🔴 import 해도 DB 를 열지 않는다
  if (!code.includes('import.meta.url')) offenders.push('🔴 실행부 가드가 없다')

  if (offenders.length) bad('write 경계', offenders.join(' / '))
  else ok('write 경계', 'persona.identity 만 · status 미포함 · 이중 스위치 · read-back · 발행 0 · import 안전')
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL\n`)
process.exit(failed === 0 ? 0 : 1)

#!/usr/bin/env tsx
/**
 * 카드 → DB 이관 규칙 fixture — 🔴 DB · 네트워크 없음
 *
 * 🔴 이 파일이 스크립트를 import 해도 DB 가 열리지 않는다 —
 *    스크립트의 실행부가 `import.meta.url` 로 가드돼 있기 때문이다.
 *
 * 실행: npx tsx scripts/persona-voice-profile-check.mts
 * 종료 코드: 실패가 있으면 1
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PLANNED, TARGET_CODES, EXCLUDED_CODES, REACTION_ROLES, FORBIDDEN_WRITE_KEYS,
  validateProfile, validateRhythm, planUpdate, assertSafeWrite, nogoHits,
  type PersonaRow, type VoiceProfile,
} from './persona-voice-profile.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'persona-voice-profile.mts')
const CARD = join(HERE, '..', 'docs', 'operations', '2026-08-30-persona-pool-design.md')

let passed = 0
let failed = 0
const ok = (n: string, d: string): void => { passed += 1; console.log(`  ✅ ${n} — ${d}`) }
const bad = (n: string, d: string): void => { failed += 1; console.log(`  🔴 ${n} — ${d}`) }

/** 실측 DB 를 본뜬 행 (2026-09-02) */
const ROWS: PersonaRow[] = TARGET_CODES.map((code) => ({ code, status: 'draft', providerId: null }))

console.log('\n══ 카드 → DB 이관 규칙 fixture ══\n')

// ── ① 계획값 정합 ──
{
  const offenders: string[] = []
  if (PLANNED.length !== 4) offenders.push(`계획 ${PLANNED.length}건 (기대 4)`)
  if (new Set(TARGET_CODES).size !== TARGET_CODES.length) offenders.push('코드 중복')
  // 🔴 P05 는 대상이 아니다 — 이미 채워져 있고 건드릴 이유가 없다
  for (const c of EXCLUDED_CODES) if (TARGET_CODES.includes(c)) offenders.push(`🔴 ${c} 가 대상에 있다`)
  for (const p of PLANNED) {
    const e = validateProfile(p)
    if (e !== null) offenders.push(`${p.code}: ${e}`)
  }
  if (offenders.length) bad('계획값 정합', offenders.join(' / '))
  else ok('계획값 정합', `${PLANNED.length}명 · 변주 5~8개 · noGo 있음 · 역할 어휘 정상 · P05 제외`)
}

// ── ② 🔴 카드가 정본이다 — 문서에 실제로 있는 값인가 ──
{
  const doc = readFileSync(CARD, 'utf-8')
  const offenders: string[] = []
  for (const p of PLANNED) {
    // 카드의 variation · noGo 낱말이 문서에 실재해야 한다
    for (const v of p.voiceVariations) {
      if (!doc.includes(v)) offenders.push(`🔴 ${p.code} 변주 "${v}" 가 카드에 없다`)
    }
    for (const t of p.noGoTopics) {
      if (!doc.includes(t)) offenders.push(`🔴 ${p.code} noGo "${t}" 가 카드에 없다`)
    }
    for (const e of p.noGoExpressions) {
      if (!doc.includes(e)) offenders.push(`🔴 ${p.code} 표현 "${e}" 가 카드에 없다`)
    }
  }
  if (offenders.length) bad('🔴 카드가 정본', offenders.slice(0, 6).join(' / '))
  else ok('🔴 카드가 정본', '변주 · noGo · 표현 전부 문서에 실재 — 지어낸 값 0')
}

// ── ③ 🔴 문서 region 정정이 반영됐는가 ──
{
  const doc = readFileSync(CARD, 'utf-8')
  const offenders: string[] = []
  if (!doc.includes('ageBand 50대 초반 · 수도권 · 기혼(원만) · 자녀 1(대학생')) offenders.push('🔴 P07 이 수도권이 아니다')
  if (!doc.includes('ageBand 60대 초반 · 광역시 · 기혼(원만) · 자녀 2(성인, 분가)')) offenders.push('🔴 P17 이 광역시가 아니다')
  if (!doc.includes('region` 정본은 DB')) offenders.push('정정 이력이 없다')
  if (offenders.length) bad('🔴 문서 region 정정', offenders.join(' / '))
  else ok('🔴 문서 region 정정', 'P07 수도권 · P17 광역시 · 정정 이력 기록됨')
}

// ── ④ 활동 리듬 검증 ──
{
  const offenders: string[] = []
  for (const p of PLANNED) if (validateRhythm(p.activityRhythm) !== null) offenders.push(`${p.code} 리듬 거부됨`)
  const bads: [string, unknown][] = [
    ['빈 구간', { activeHours: [], weekdayBias: 0.5, burstiness: 0.5 }],
    ['시작>끝', { activeHours: [[13, 10]], weekdayBias: 0.5, burstiness: 0.5 }],
    ['범위 초과', { activeHours: [[10, 25]], weekdayBias: 0.5, burstiness: 0.5 }],
    ['🔴 구간 겹침', { activeHours: [[9, 13], [12, 15]], weekdayBias: 0.5, burstiness: 0.5 }],
    ['bias 범위 밖', { activeHours: [[9, 12]], weekdayBias: 1.5, burstiness: 0.5 }],
    ['burst 음수', { activeHours: [[9, 12]], weekdayBias: 0.5, burstiness: -0.1 }],
  ]
  for (const [label, r] of bads) {
    if (validateRhythm(r as never) === null) offenders.push(`🔴 ${label} 통과`)
  }
  // 🔴 자정까지(24)는 정상이다
  if (validateRhythm({ activeHours: [[22, 24]], weekdayBias: 0.4, burstiness: 0.5 }) !== null) offenders.push('22-24 가 막힘')
  if (offenders.length) bad('활동 리듬 검증', offenders.join(' / '))
  else ok('활동 리듬 검증', '빈 구간 · 역순 · 범위 초과 · 겹침 · bias/burst 범위 거부 · 22-24 허용')
}

// ── ⑤ 변주 개수 · 빈 문자열 ──
{
  const offenders: string[] = []
  const base = PLANNED[0]!
  const mk = (o: Partial<VoiceProfile>): VoiceProfile => ({ ...base, ...o })
  // 아키텍처 §5 — 5~8개
  if (validateProfile(mk({ voiceVariations: ['a', 'b', 'c', 'd'] })) === null) offenders.push('🔴 4개가 통과')
  if (validateProfile(mk({ voiceVariations: Array.from({ length: 9 }, (_, i) => `v${i}`) })) === null) offenders.push('🔴 9개가 통과')
  if (validateProfile(mk({ voiceVariations: ['a', 'b', 'c', 'd', 'e'] })) !== null) offenders.push('5개가 막힘')
  if (validateProfile(mk({ voiceVariations: ['a', 'a', 'b', 'c', 'd'] })) === null) offenders.push('🔴 중복이 통과')
  // 🔴 빈 문자열 noGo 는 모든 글에 걸린다
  if (validateProfile(mk({ noGoTopics: ['정상', '  '] })) === null) offenders.push('🔴 빈 noGoTopics 가 통과')
  if (validateProfile(mk({ noGoExpressions: [''] })) === null) offenders.push('🔴 빈 noGoExpressions 가 통과')
  if (validateProfile(mk({ noGoTopics: [] })) === null) offenders.push('🔴 noGoTopics 빈 배열이 통과')
  if (validateProfile(mk({ forbiddenReactionRoles: ['advice', 'nope'] })) === null) offenders.push('🔴 미지의 역할이 통과')
  for (const r of REACTION_ROLES) {
    if (validateProfile(mk({ forbiddenReactionRoles: [r] })) !== null) offenders.push(`${r} 거부됨`)
  }
  if (offenders.length) bad('변주 개수 · 빈 문자열', offenders.join(' / '))
  else ok('변주 개수 · 빈 문자열', `5~8개 강제 · 중복/빈값 거부 · 역할 ${REACTION_ROLES.length}종 어휘`)
}

// ── ⑥ 계획 — 실측 행 ──
{
  const plan = planUpdate(ROWS)
  const offenders: string[] = []
  if (plan.issues.length !== 0) offenders.push(`문제 ${plan.issues.map((i) => `${i.code}:${i.reason}`).join(' / ')}`)
  if (plan.apply.length !== 4) offenders.push(`반영 ${plan.apply.length} (기대 4)`)
  if (offenders.length) bad('계획 (실측 행)', offenders.join(' / '))
  else ok('계획 (실측 행)', '4명 전부 반영 대상 · 문제 0')
}

// ── ⑦ 🔴 문제 감지 ──
{
  const offenders: string[] = []
  const real = planUpdate(ROWS.map((r) => (r.code === 'P07' ? { ...r, providerId: 'kakao_1' } : r)))
  if (!real.issues.some((i) => i.code === 'P07')) offenders.push('🔴 실회원이 통과')
  if (real.apply.some((a) => a.code === 'P07')) offenders.push('🔴 실회원이 반영 대상')
  // 🔴 P05 가 섞여 들어오면 잡아야 한다
  const withP05 = planUpdate([...ROWS, { code: 'P05', status: 'active', providerId: null }])
  if (!withP05.issues.some((i) => i.code === 'P05')) offenders.push('🔴 P05 가 조용히 넘어감')
  if (withP05.apply.some((a) => a.code === 'P05')) offenders.push('🔴 P05 가 반영 대상')
  const missing = planUpdate(ROWS.filter((r) => r.code !== 'P15'))
  if (!missing.issues.some((i) => i.code === 'P15')) offenders.push('🔴 누락이 감지되지 않음')
  if (offenders.length) bad('🔴 문제 감지', offenders.join(' / '))
  else ok('🔴 문제 감지', '실회원 · P05 혼입 · 누락 전부 issue')
}

// ── ⑧ 🔴 건드리면 안 되는 것을 쓰지 않는다 ──
{
  const offenders: string[] = []
  // 🔴 base 는 반드시 '쓰는 필드' 여야 한다. noGoTopics 를 base 로 두면
  //    그 자체가 금지 목록에 들어간 뒤로 모든 케이스가 무조건 던져 시험이 헛돈다
  for (const k of FORBIDDEN_WRITE_KEYS) {
    let threw = false
    try { assertSafeWrite({ voiceVariations: [], [k]: 'x' }) } catch { threw = true }
    if (!threw) offenders.push(`🔴 ${k} 가 있는데 던지지 않음`)
  }
  // 🔴 noGoTopics 는 보류다 — data 에 섞이면 던져야 한다
  if (!FORBIDDEN_WRITE_KEYS.includes('noGoTopics')) offenders.push('🔴 noGoTopics 가 금지 목록에 없다')
  let nogoThrew = false
  try { assertSafeWrite({ voiceVariations: [], noGoTopics: ['x'] }) } catch { nogoThrew = true }
  if (!nogoThrew) offenders.push('🔴 noGoTopics 가 있는데 던지지 않음')
  // 🔴 쓰는 4필드는 통과해야 한다
  let okThrew = false
  try {
    assertSafeWrite({ voiceVariations: [], activityRhythm: {}, noGoExpressions: [], forbiddenReactionRoles: [] })
  } catch { okThrew = true }
  if (okThrew) offenders.push('정상 4필드 data 에서 던짐')
  if (offenders.length) bad('🔴 금지 필드 차단', offenders.join(' / '))
  else ok('🔴 금지 필드 차단', `${FORBIDDEN_WRITE_KEYS.length}종 전부 차단 (status · identity · cap · userId · voiceCore · 🟡 noGoTopics)`)
}

// ── ⑨ noGo 부분 문자열 판정 ──
{
  const offenders: string[] = []
  if (nogoHits('오늘 비교해 봤어요', ['비교']).length !== 1) offenders.push('부분 일치 실패')
  if (nogoHits('오늘 국수를 삶았어요', ['비교']).length !== 0) offenders.push('오탐')
  // 🔴 빈 문자열은 모든 글에 걸린다 — 걸리면 안 된다
  if (nogoHits('아무 글', ['', '  ']).length !== 0) offenders.push('🔴 빈 문자열이 걸림')
  if (offenders.length) bad('noGo 부분 문자열', offenders.join(' / '))
  else ok('noGo 부분 문자열', '부분 일치 · 오탐 없음 · 빈 문자열 무시')
}

// ── ⑩ 🔴 소스 스캔 — write 경계 ──
{
  const code = readFileSync(SCRIPT, 'utf-8').split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**')).join('\n')
  const offenders: string[] = []

  const writes = [...code.matchAll(/prisma\.([A-Za-z]+)\.(create|update|updateMany|upsert|delete|deleteMany|createMany)\b/g)].map((m) => m[1] ?? '')
  const badW = [...new Set(writes)].filter((m) => m !== 'persona')
  if (badW.length > 0) offenders.push(`🔴 ${badW.join(' · ')} 에 쓴다`)
  if (writes.length === 0) offenders.push('write 가 없다 — 스캔이 헛돈다')

  // 🔴 data 블록에 금지 필드가 없다
  const dataBlocks: string[] = []
  for (const m of code.matchAll(/data:\s*\{/g)) {
    let depth = 0; let i = m.index! + m[0].length - 1; const s = i
    for (; i < code.length; i += 1) { if (code[i] === '{') depth += 1; else if (code[i] === '}') { depth -= 1; if (depth === 0) break } }
    dataBlocks.push(code.slice(s, i + 1))
  }
  if (dataBlocks.length === 0) offenders.push('data 블록이 없다')
  for (const k of ['status', 'activatedAt', 'identity', 'dailyCap', 'weeklyCap', 'userId']) {
    if (dataBlocks.some((b) => b.includes(k))) offenders.push(`🔴 쓰기 자리에 ${k} 가 있다`)
  }
  // 🔴 noGoTopics 는 보류 — 쓰기 자리에 있으면 실패다
  if (dataBlocks.some((b) => b.includes('noGoTopics'))) offenders.push('🔴 쓰기 자리에 noGoTopics 가 있다 (보류 대상)')
  // 🔴 쓰는 4필드는 실제로 쓰기 자리에 있어야 한다 — 빠지면 이관이 안 된다
  for (const k of ['voiceVariations', 'activityRhythm', 'noGoExpressions', 'forbiddenReactionRoles']) {
    if (!dataBlocks.some((b) => b.includes(k))) offenders.push(`🔴 쓰기 자리에 ${k} 가 없다`)
  }
  // 🔴 다른 테이블은 읽기만 — Queue 는 noGo 실측 때 읽는다. 쓰지 않는지가 핵심(위 writes 로 확인)
  for (const t of ['post', 'comment', 'personaGlobalSwitch', 'personaAuditLog']) {
    if (new RegExp(`prisma\\.${t}\\b`, 'i').test(code)) offenders.push(`🔴 prisma.${t} 에 접근한다`)
  }
  if (!code.includes("argv.includes('--apply')")) offenders.push('🔴 --apply 스위치가 없다')
  if (!/LIMIT\s*!==\s*plan\.apply\.length/.test(code)) offenders.push('🔴 --limit 대조가 없다')
  if (!code.includes('findUniqueOrThrow')) offenders.push('🔴 read-back 이 없다')
  if (!code.includes('assertSafeWrite(')) offenders.push('🔴 저장 직전 방어가 없다')
  for (const k of ['permanentNoindex', 'fetch(', 'anthropic', 'openai']) {
    if (code.toLowerCase().includes(k.toLowerCase())) offenders.push(`🔴 ${k} 가 있다`)
  }
  if (!code.includes('import.meta.url')) offenders.push('🔴 실행부 가드가 없다')

  if (offenders.length) bad('write 경계', offenders.join(' / '))
  else ok('write 경계', 'persona 4필드만 · status/identity/cap/noGoTopics 미포함 · 이중 스위치 · read-back · Post/Queue write 0 · import 안전')
}


// ── ⑪ 🔴 noGoTopics 보류 — 값은 보관하되 쓰지 않는다 ──
{
  const offenders: string[] = []
  // 🔴 카드 값은 그대로 남아 있어야 한다. 지우면 나중에 형식을 정할 때 근거가 사라진다
  for (const p of PLANNED) {
    if (p.noGoTopics.length === 0) offenders.push(`🔴 ${p.code} 의 카드 noGoTopics 가 지워졌다`)
  }
  // 문서 카드에도 그대로 있어야 한다
  const doc = readFileSync(CARD, 'utf-8')
  for (const p of PLANNED) {
    for (const t of p.noGoTopics) if (!doc.includes(t)) offenders.push(`🔴 ${p.code} "${t}" 가 문서에서 사라졌다`)
  }
  // 🔴 --nogo-scan 은 유지된다 — 보류 판단의 근거를 계속 재볼 수 있어야 한다
  const code = readFileSync(SCRIPT, 'utf-8')
  if (!code.includes("--nogo-scan")) offenders.push('🔴 --nogo-scan 이 사라졌다')
  if (!code.includes('nogoHits(')) offenders.push('🔴 nogoHits 가 사라졌다')
  // dry-run 이 보류를 말하는가
  if (!code.includes('보류')) offenders.push('🔴 dry-run 출력에 보류 표시가 없다')

  if (offenders.length) bad('🔴 noGoTopics 보류', offenders.join(' / '))
  else ok('🔴 noGoTopics 보류', `카드 ${PLANNED.length}명 값 보관 · 문서 유지 · --nogo-scan 유지 · dry-run 보류 표시`)
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL\n`)
process.exit(failed === 0 ? 0 : 1)

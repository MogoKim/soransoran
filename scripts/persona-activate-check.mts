#!/usr/bin/env tsx
/**
 * 활성화 규칙 fixture — 🔴 DB · 네트워크 없음
 *
 * 🔴 이 파일이 스크립트를 import 해도 DB 가 열리지 않는다 —
 *    실행부가 `import.meta.url` 로 가드돼 있기 때문이다.
 *
 * 실행: npx tsx scripts/persona-activate-check.mts
 * 종료 코드: 실패가 있으면 1
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TARGET_CODES, EXCLUDED_CODES, ACTIVATABLE_FROM,
  FORBIDDEN_WRITE_KEYS, ALLOWED_WRITE_KEYS,
  judge, planActivation, isKillSwitchOn, assertActivationWrite,
  type PersonaRow,
} from './persona-activate.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCRIPT = join(HERE, 'persona-activate.mts')
const P05_SCRIPT = join(HERE, 'persona-activate-p05.mts')

let passed = 0
let failed = 0
const ok = (n: string, d: string): void => { passed += 1; console.log(`  ✅ ${n} — ${d}`) }
const bad = (n: string, d: string): void => { failed += 1; console.log(`  🔴 ${n} — ${d}`) }

const R = (o: Partial<PersonaRow> & { code: string }): PersonaRow =>
  ({ status: 'draft', dailyCap: 3, weeklyCap: 12, ...o })

/** 실측 DB 를 본뜬 행 (2026-09-02) */
const ROWS: PersonaRow[] = [
  R({ code: 'P07' }), R({ code: 'P10' }), R({ code: 'P15' }), R({ code: 'P17', dailyCap: 2, weeklyCap: 8 }),
]

console.log('\n══ 활성화 규칙 fixture ══\n')

// ── ① 대상이 못박혀 있다 ──
{
  const offenders: string[] = []
  if (TARGET_CODES.length !== 4) offenders.push(`대상 ${TARGET_CODES.length}명 (기대 4)`)
  for (const c of ['P07', 'P10', 'P15', 'P17']) if (!TARGET_CODES.includes(c)) offenders.push(`${c} 누락`)
  // 🔴 P05 는 대상이 아니다 — 이미 active 이고 건드릴 이유가 없다
  for (const c of EXCLUDED_CODES) if (TARGET_CODES.includes(c)) offenders.push(`🔴 ${c} 가 대상에 있다`)
  if (new Set(TARGET_CODES).size !== TARGET_CODES.length) offenders.push('코드 중복')
  if (offenders.length) bad('대상 못박음', offenders.join(' / '))
  else ok('대상 못박음', `${TARGET_CODES.join(' · ')} · P05 제외`)
}

// ── ② 🔴 P05 스크립트를 재사용하지 않는다 ──
{
  const offenders: string[] = []
  const p05 = readFileSync(P05_SCRIPT, 'utf-8')
  // 🔴 P05 스크립트는 여전히 P05 하나만 켜야 한다 — 이 PR 이 그것을 고치지 않았음을 강제한다
  if (!p05.includes("const TARGET_CODE = 'P05'")) offenders.push('🔴 P05 스크립트의 못박음이 사라졌다')
  if (/TARGET_CODES/.test(p05)) offenders.push('🔴 P05 스크립트가 다중 대상으로 바뀌었다')
  // 🔴 새 스크립트는 인자로 code 를 받지 않는다
  const code = readFileSync(SCRIPT, 'utf-8')
  for (const pat of ["arg('code')", "arg('persona')", '--code', 'process.argv.includes(code']) {
    if (code.includes(pat)) offenders.push(`🔴 인자로 code 를 받는다: ${pat}`)
  }
  if (offenders.length) bad('🔴 P05 선례 보존 · 인자 미수용', offenders.join(' / '))
  else ok('🔴 P05 선례 보존 · 인자 미수용', 'P05 는 여전히 단일 대상 · 새 스크립트도 인자로 code 를 받지 않는다')
}

// ── ③ 🔴 상태별 판정 (전수) ──
{
  const offenders: string[] = []
  const STATUSES = ['draft', 'active', 'paused', 'retired']
  for (const st of STATUSES) {
    const v = judge(R({ code: 'P07', status: st }))
    if (st === 'draft' && v.kind !== 'ACTIVATE') offenders.push(`draft 가 안 켜짐: ${v.kind}`)
    if (st === 'active' && v.kind !== 'ALREADY_ACTIVE') offenders.push(`🔴 active 가 ${v.kind}`)
    // 🔴 retired · paused 는 막는다
    if ((st === 'paused' || st === 'retired') && v.kind !== 'BLOCKED') offenders.push(`🔴 ${st} 가 통과됨`)
  }
  // 🔴 retired 는 사유가 분명해야 한다
  const ret = judge(R({ code: 'P07', status: 'retired' }))
  if (ret.kind !== 'BLOCKED' || !ret.reason.includes('retired')) offenders.push('retired 사유가 불명확')
  // 🔴 대상 밖 페르소나는 상태와 무관하게 막힌다
  for (const st of STATUSES) {
    const v = judge(R({ code: 'P05', status: st }))
    if (v.kind !== 'BLOCKED') offenders.push(`🔴 P05(${st}) 가 통과됨`)
  }
  if (offenders.length) bad('🔴 상태별 판정', offenders.join(' / '))
  else ok('🔴 상태별 판정', `draft 만 켬 · active 불변 · paused/retired 차단 · 대상 밖 4상태 전수 차단`)
}

// ── ④ 계획 — 실측 행 ──
{
  const plan = planActivation(ROWS)
  const offenders: string[] = []
  if (plan.activate.length !== 4) offenders.push(`켤 대상 ${plan.activate.length} (기대 4)`)
  if (plan.blocked.length !== 0) offenders.push(`막힘 ${plan.blocked.map((b) => b.code).join(',')}`)
  if (plan.alreadyActive.length !== 0) offenders.push('이미 active 가 있다')
  // 🔴 4명 전부 cap 이 있으므로 경고 0
  if (plan.capWarnings.length !== 0) offenders.push(`cap 경고 ${plan.capWarnings.length}`)
  if (offenders.length) bad('계획 (실측 행)', offenders.join(' / '))
  else ok('계획 (실측 행)', '4명 전부 켤 대상 · 막힘 0 · cap 경고 0')
}

// ── ⑤ 🔴 문제 감지 ──
{
  const offenders: string[] = []
  // 누락
  const missing = planActivation(ROWS.filter((r) => r.code !== 'P15'))
  if (!missing.blocked.some((b) => b.code === 'P15')) offenders.push('🔴 누락이 감지되지 않음')
  // 이미 active 는 켜지 않고 따로 센다
  const withActive = planActivation(ROWS.map((r) => (r.code === 'P10' ? { ...r, status: 'active' } : r)))
  if (withActive.activate.some((a) => a.code === 'P10')) offenders.push('🔴 active 를 다시 켬')
  if (!withActive.alreadyActive.some((a) => a.code === 'P10')) offenders.push('active 가 집계되지 않음')
  // retired 는 막힘
  const withRetired = planActivation(ROWS.map((r) => (r.code === 'P17' ? { ...r, status: 'retired' } : r)))
  if (!withRetired.blocked.some((b) => b.code === 'P17')) offenders.push('🔴 retired 가 통과')
  // 🔴 대상 밖이 섞여 들어오면 잡는다
  const withP05 = planActivation([...ROWS, R({ code: 'P05', status: 'active' })])
  if (!withP05.blocked.some((b) => b.code === 'P05')) offenders.push('🔴 P05 가 조용히 넘어감')
  // cap 없으면 경고하되 막지는 않는다
  const noCap = planActivation(ROWS.map((r) => (r.code === 'P07' ? { ...r, dailyCap: null } : r)))
  if (noCap.capWarnings.length !== 1) offenders.push('cap 경고가 안 뜸')
  if (!noCap.activate.some((a) => a.code === 'P07')) offenders.push('🔴 cap 없다고 켜기를 막았다 (3층 분리 위반)')

  if (offenders.length) bad('🔴 문제 감지', offenders.join(' / '))
  else ok('🔴 문제 감지', '누락 · active 재켬 방지 · retired 차단 · 대상 밖 차단 · cap 경고(차단 아님)')
}

// ── ⑥ 🔴 kill switch — 0행은 중지 꺼짐 ──
{
  const offenders: string[] = []
  if (isKillSwitchOn(null) !== false) offenders.push('🔴 0행을 중지로 읽는다 — 정상 운영을 막는다')
  if (isKillSwitchOn({ enabled: false }) !== false) offenders.push('false 를 중지로 읽는다')
  if (isKillSwitchOn({ enabled: true }) !== true) offenders.push('🔴 true 를 중지로 읽지 않는다')
  if (offenders.length) bad('🔴 kill switch 해석', offenders.join(' / '))
  else ok('🔴 kill switch 해석', '0행 = 꺼짐(기본 상태) · false = 꺼짐 · true = 켜짐')
}

// ── ⑦ 🔴 status 층 하나만 만진다 ──
{
  const offenders: string[] = []
  for (const k of FORBIDDEN_WRITE_KEYS) {
    let threw = false
    try { assertActivationWrite({ status: 'active', [k]: 'x' }) } catch { threw = true }
    if (!threw) offenders.push(`🔴 ${k} 가 있는데 던지지 않음`)
  }
  // 🔴 허용 목록 밖은 이름이 뭐든 막는다
  let unknownThrew = false
  try { assertActivationWrite({ status: 'active', somethingNew: 1 }) } catch { unknownThrew = true }
  if (!unknownThrew) offenders.push('🔴 모르는 필드가 통과됨')
  // 정상은 통과
  let okThrew = false
  try { assertActivationWrite({ status: 'active', activatedAt: new Date() }) } catch { okThrew = true }
  if (okThrew) offenders.push('정상 data 에서 던짐')
  if (ALLOWED_WRITE_KEYS.join(',') !== 'status,activatedAt') offenders.push(`허용 목록이 다르다: ${ALLOWED_WRITE_KEYS.join(',')}`)
  if (offenders.length) bad('🔴 status 층만', offenders.join(' / '))
  else ok('🔴 status 층만', `허용 ${ALLOWED_WRITE_KEYS.join(' · ')} · 금지 ${FORBIDDEN_WRITE_KEYS.length}종 · 미지 필드 차단`)
}

// ── ⑧ 🔴 소스 스캔 — write 경계 ──
{
  const code = readFileSync(SCRIPT, 'utf-8').split('\n')
    .filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//') && !l.trim().startsWith('/**')).join('\n')
  const offenders: string[] = []

  // 🔴 write 대상은 persona · personaAuditLog 둘뿐이다
  const writes = [...code.matchAll(/(?:prisma|tx)\.([A-Za-z]+)\.(create|update|updateMany|upsert|delete|deleteMany|createMany)\b/g)].map((m) => m[1] ?? '')
  const badW = [...new Set(writes)].filter((m) => !['persona', 'personaAuditLog'].includes(m))
  if (badW.length > 0) offenders.push(`🔴 ${badW.join(' · ')} 에 쓴다`)
  if (writes.length === 0) offenders.push('write 가 없다 — 스캔이 헛돈다')

  // 🔴 kill switch 는 읽기만
  if (/personaGlobalSwitch\.(create|update|upsert|delete)/.test(code)) offenders.push('🔴 kill switch 를 조작한다')
  // 🔴 발행 · Queue 는 접근조차 안 한다
  for (const t of ['post', 'comment', 'originalPostApprovalQueue', 'microSeedCandidate', 'microSeedRawContent']) {
    if (new RegExp(`(?:prisma|tx)\\.${t}\\b`, 'i').test(code)) offenders.push(`🔴 ${t} 에 접근한다`)
  }
  // 🔴 data 블록에 금지 필드가 없다
  const dataBlocks: string[] = []
  for (const m of code.matchAll(/data:\s*\{/g)) {
    let depth = 0; let i = m.index! + m[0].length - 1; const s = i
    for (; i < code.length; i += 1) { if (code[i] === '{') depth += 1; else if (code[i] === '}') { depth -= 1; if (depth === 0) break } }
    dataBlocks.push(code.slice(s, i + 1))
  }
  if (dataBlocks.length === 0) offenders.push('data 블록이 없다')
  for (const k of ['dailyCap', 'weeklyCap', 'identity', 'voiceCore', 'voiceVariations', 'noGoTopics', 'userId']) {
    if (dataBlocks.some((b) => b.includes(k))) offenders.push(`🔴 쓰기 자리에 ${k} 가 있다`)
  }
  // 🔴 상태 변경과 감사 로그는 같은 트랜잭션이다
  if (!code.includes('$transaction')) offenders.push('🔴 트랜잭션이 없다 — 상태만 바뀌고 로그가 없는 순간이 생긴다')
  if (!code.includes("action: 'status_changed'")) offenders.push('🔴 감사 로그를 남기지 않는다')
  // 🔴 이중 스위치 · 조건부 UPDATE · read-back · 환경변수
  if (!code.includes("argv.includes('--apply')")) offenders.push('🔴 --apply 스위치가 없다')
  if (!/LIMIT\s*!==\s*plan\.activate\.length/.test(code)) offenders.push('🔴 --limit 대조가 없다')
  if (!/status:\s*ACTIVATABLE_FROM/.test(code)) offenders.push('🔴 조건부 UPDATE 가 아니다')
  if (!code.includes('findUniqueOrThrow')) offenders.push('🔴 read-back 이 없다')
  if (!code.includes('ACTOR_USER_ID')) offenders.push('🔴 ACTOR_USER_ID 를 요구하지 않는다')
  if (!code.includes('assertActivationWrite(')) offenders.push('🔴 저장 직전 방어가 없다')
  for (const k of ['fetch(', 'anthropic', 'openai', 'permanentNoindex']) {
    if (code.toLowerCase().includes(k.toLowerCase())) offenders.push(`🔴 ${k} 가 있다`)
  }
  if (!code.includes('import.meta.url')) offenders.push('🔴 실행부 가드가 없다')

  if (offenders.length) bad('write 경계', offenders.join(' / '))
  else ok('write 경계', 'persona+auditLog 만 · cap/identity 미포함 · 트랜잭션 · 조건부 UPDATE · read-back · ACTOR_USER_ID · Post/Queue 접근 0')
}

console.log(`\n${failed === 0 ? '✅' : '🔴'} ${passed} PASS · ${failed} FAIL\n`)
process.exit(failed === 0 ? 0 : 1)

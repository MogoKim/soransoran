#!/usr/bin/env tsx
/**
 * 승인 대기열 상태 전환 규칙 fixture — 🔴 DB · 세션 · 네트워크 없음
 *
 * 🔴 규칙을 server action 안에 두면 DB 없이는 검증할 수 없다.
 *    순수 함수로 빼 두었기 때문에 전이표를 전수로 확인할 수 있다.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  planDecision, canDecide, isDeclineReasonCode, DECLINE_REASONS,
  type CandidateStatus, type CandidateDecision,
} from '../src/lib/persona-candidate-rules'

const HERE = dirname(fileURLToPath(import.meta.url))
const ACTION = join(HERE, '..', 'src', 'lib', 'actions', 'persona-candidate.ts')

const report: Array<{ ok: boolean; name: string; detail: string }> = []
let failures = 0
const ok = (name: string, detail: string) => report.push({ ok: true, name, detail })
const bad = (name: string, detail: string) => { report.push({ ok: false, name, detail }); failures++ }

const ALL: CandidateStatus[] = ['PENDING', 'APPROVED', 'EDITED', 'DECLINED', 'PUBLISHED', 'EXPIRED']
const DECISIONS: CandidateDecision[] = ['approve', 'decline']

// ── 🔴 PENDING 만 결정할 수 있다 (전수) ──
{
  const offenders: string[] = []
  for (const st of ALL) {
    const expected = st === 'PENDING'
    if (canDecide(st) !== expected) offenders.push(`${st}=${canDecide(st)}`)
    for (const d of DECISIONS) {
      const plan = planDecision({ status: st, decision: d, declineReason: 'OTHER' })
      if (expected && !plan.ok) offenders.push(`${st}/${d} 거부됨`)
      if (!expected && plan.ok) offenders.push(`🔴 ${st}/${d} 통과됨`)
    }
  }
  if (offenders.length) bad('PENDING 만 결정 가능', `🔴 ${offenders.join(' / ')}`)
  else ok('PENDING 만 결정 가능', `${ALL.length}개 상태 × ${DECISIONS.length}개 결정 전수`)
}

// ── 승인 → APPROVED · 폐기 → DECLINED ──
{
  const a = planDecision({ status: 'PENDING', decision: 'approve' })
  const d = planDecision({ status: 'PENDING', decision: 'decline', declineReason: 'REDUNDANT' })
  const offenders: string[] = []
  if (!a.ok || a.nextStatus !== 'APPROVED') offenders.push(`승인=${a.ok ? a.nextStatus : a.error}`)
  if (a.ok && a.declineReason !== null) offenders.push('승인인데 사유가 남음')
  if (!d.ok || d.nextStatus !== 'DECLINED') offenders.push(`폐기=${d.ok ? d.nextStatus : d.error}`)
  if (d.ok && d.declineReason !== 'REDUNDANT') offenders.push('폐기 사유 미기록')
  if (offenders.length) bad('전이 결과', `🔴 ${offenders.join(' / ')}`)
  else ok('전이 결과', 'approve → APPROVED · decline → DECLINED')
}

// ── 🔴 PUBLISHED 로 가는 경로가 없다 ──
{
  const reachable = new Set<string>()
  for (const st of ALL) {
    for (const d of DECISIONS) {
      const plan = planDecision({ status: st, decision: d, declineReason: 'OTHER' })
      if (plan.ok) reachable.add(plan.nextStatus)
    }
  }
  const forbidden = [...reachable].filter((s) => s !== 'APPROVED' && s !== 'DECLINED')
  if (forbidden.length > 0) bad('PUBLISHED 도달 불가', `🔴 도달 가능: ${forbidden.join(' · ')}`)
  else ok('PUBLISHED 도달 불가', `도달 가능한 상태는 ${[...reachable].sort().join(' · ')} 뿐`)
}

// ── 🔴 폐기 사유는 코드여야 한다 ──
{
  const offenders: string[] = []
  const empty = planDecision({ status: 'PENDING', decision: 'decline' })
  if (empty.ok) offenders.push('🔴 사유 없이 폐기됨')
  const blank = planDecision({ status: 'PENDING', decision: 'decline', declineReason: '   ' })
  if (blank.ok) offenders.push('🔴 공백 사유로 폐기됨')
  // 🔴 자유 텍스트를 허용하면 집계가 무너진다
  const free = planDecision({ status: 'PENDING', decision: 'decline', declineReason: '그냥 별로여서' })
  if (free.ok) offenders.push('🔴 자유 텍스트가 통과됨')
  for (const r of DECLINE_REASONS) {
    const p = planDecision({ status: 'PENDING', decision: 'decline', declineReason: r.code })
    if (!p.ok) offenders.push(`${r.code} 거부됨`)
  }
  if (!isDeclineReasonCode('NOPE') && isDeclineReasonCode('OTHER')) { /* 정상 */ }
  else offenders.push('코드 판별이 잘못됨')
  if (offenders.length) bad('폐기 사유는 코드', `🔴 ${offenders.join(' / ')}`)
  else ok('폐기 사유는 코드', `${DECLINE_REASONS.length}종 허용 · 자유 텍스트 거부`)
}

// ── 🔴 소스 스캔 — server action 이 무엇을 쓰는가 ──
{
  const code = readFileSync(ACTION, 'utf-8')
    .split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n')
  const offenders: string[] = []
  const QUEUE_ONLY = ['personaApprovalQueue']
  const writes = [...code.matchAll(
    /prisma\.([A-Za-z]+)\.(create|update|updateMany|upsert|delete|deleteMany|createMany)\b/g,
  )].map((m) => m[1] ?? '')
  const badWrites = [...new Set(writes)].filter((m) => !QUEUE_ONLY.includes(m))
  if (badWrites.length > 0) offenders.push(`🔴 ${badWrites.join(' · ')} 에 쓴다`)
  for (const key of ['anthropic', 'openai', 'fetch(', "'PUBLISHED'", 'personaId:']) {
    if (code.includes(key)) offenders.push(`🔴 ${key} 가 있다`)
  }
  if (!code.includes('requireAdmin')) offenders.push('🔴 requireAdmin 이 없다')
  // 🔴 읽은 뒤 쓰는 사이에 끼어들 수 있다 — WHERE 에 PENDING 이 있어야 한다
  if (!/status:\s*'PENDING'/.test(code)) offenders.push('🔴 조건부 UPDATE 가 아니다')
  if (offenders.length) bad('server action 경계', offenders.join(' / '))
  else ok('server action 경계', 'write 는 대기열만 · LLM 0 · PUBLISHED 0 · requireAdmin · 조건부 UPDATE')
}

console.log('\n승인 대기열 상태 전환 fixture')
console.log('  네트워크 · DB · 세션을 타지 않는다\n')
for (const r of report) console.log(`  ${r.ok ? '✅' : '❌'} ${r.name.padEnd(22)} → ${r.detail}`)
if (failures > 0) { console.log(`\n🔴 ${failures}건 실패\n`); process.exit(1) }
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치\n`)

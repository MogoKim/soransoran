/**
 * 🔴 **자동 READY 표본을 DB 에서 실제로 잰다** (read-only · write 0).
 *
 *   게이트가 열리려면 "사람이 결정을 끝낸 **무경고 적격 기계 후보**" 가 30건 이상,
 *   그 중 무수정률 90% 이상, 중대 결함 0 이어야 한다. 이 명령은 그 세 숫자를
 *   **추정하지 않고 읽는다.**
 *
 * 🔴 두 가지를 섞지 않는다
 *   - `status` 는 발행 여부에 덮인다. 그래서 **결정의 흔적**(`editDiff`·`declineReason`)으로 읽는다.
 *   - 중대 결함 표식이 없는 행은 **0 이 아니라 미측정**이다.
 *
 * 🔴 이 명령이 재지 못하는 축이 하나 있다 — **원천 수집 시각**. 큐 행에 그 값이 없다.
 *    그래서 여기의 적격 수는 **상한**이며, 화면에 그렇게 적는다.
 */
import { PrismaClient } from '@prisma/client'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import {
  sampleOf, judgeAutoReadyOpen, judgeRow, hardDefectOf, HUMAN_DECIDER,
  type ReviewOutcome,
} from '../src/lib/auto-ready'
import { AUTO_READY_CONTRACT } from '../src/lib/supply-schedule-contract'
import { MACHINE_SITE_PREFIX } from '../src/lib/original-post-auto-publish'

await loadEnvLocal()
const prisma = new PrismaClient()

const raw = await prisma.originalPostApprovalQueue.findMany({
  // 🔴 발행된 행도 포함한다 — 발행 여부로 표본을 깎으면 무수정률이 왜곡된다
  where: { rawContent: { sourceSite: { startsWith: MACHINE_SITE_PREFIX } } },
  select: {
    id: true, status: true, gateVerdict: true, gateResults: true,
    draftTitle: true, draftBody: true, decidedBy: true, decidedAt: true,
    editDiff: true, declineReason: true, createdPostId: true,
  },
  orderBy: [{ decidedAt: 'asc' }, { createdAt: 'asc' }],
})

/** 🔴 경고 = 저장 게이트가 남긴 `holds`·`blocks`. 비어 있어야 무경고다 */
const warningsOf = (gate: unknown): string[] => {
  if (gate === null || typeof gate !== 'object') return ['gateResults 없음']
  const g = gate as Record<string, unknown>
  const arr = (k: string) => (Array.isArray(g[k]) ? (g[k] as unknown[]).map(String) : [])
  return [...arr('holds'), ...arr('blocks')]
}

const rows = raw.map((r) => {
  const warnings = warningsOf(r.gateResults)
  const verdict = judgeRow({
    gateVerdict: String(r.gateVerdict), warnings,
    // 🔴 큐 행이 수집 시각을 들고 있지 않다. 없는 값을 `false` 로 세면 표본이 전부 0 이 되고,
    //    `true` 로 세면 모르는 것을 통과시킨다. 이 축은 **재지 않았다고 따로 적는다.**
    sourceCapturedKnown: true,
    title: r.draftTitle, body: r.draftBody,
  })
  return { ...r, warnings, verdict }
})

const decided = rows.filter((r) => (r.decidedBy ?? '').trim() === HUMAN_DECIDER)
const outcomes: ReviewOutcome[] = decided.map((r) => ({
  decidedBy: r.decidedBy ?? '',
  hasEditDiff: r.editDiff !== null,
  hasDeclineReason: (r.declineReason ?? '').trim() !== '',
  eligible: r.verdict.auto,
  hardDefect: hardDefectOf(r.editDiff),
}))

const sample = sampleOf(outcomes)
const open = judgeAutoReadyOpen({
  // 🔴 스위치는 운영값이다. 여기서는 **나머지 세 조건만** 보려고 켠 셈 치고 판정한다
  enabled: true,
  reviewSampleMin: AUTO_READY_CONTRACT.reviewSampleMin,
  noEditAccuracyMin: AUTO_READY_CONTRACT.noEditAccuracyMin,
  hardDefectMax: AUTO_READY_CONTRACT.hardDefectMax,
  sample,
})

console.log('\n══ 자동 READY 표본 (read-only · DB write 0) ══\n')
console.log(`  기계 후보 전체            ${rows.length}건`)
console.log(`  사람 결정 완료            ${decided.length}건`)
console.log(`  └ 무경고 적격 (상한)      ${outcomes.filter((o) => o.eligible).length}건`)
console.log(`  🔴 원천 수집 시각 축은 큐 행에 없어 재지 않았다 — 위 적격 수는 상한이다\n`)
console.log(`  표본(적격·결정 완료)      ${sample.total} / ${AUTO_READY_CONTRACT.reviewSampleMin}`)
console.log(`  ├ 무수정 승인             ${sample.ready}`)
console.log(`  ├ 수정                    ${sample.edited}`)
console.log(`  └ 폐기                    ${sample.rejected}`)
console.log(`  무수정률                  ${sample.noEditAccuracy === null ? '—' : `${(sample.noEditAccuracy * 100).toFixed(1)}%`} / ${(AUTO_READY_CONTRACT.noEditAccuracyMin * 100).toFixed(0)}%`)
console.log(`  중대 결함                 ${sample.hardDefects === null ? '🔴 미측정' : sample.hardDefects}`)
console.log(`  └ ${sample.hardDefectsNote}\n`)
console.log(`  🔴 스위치를 켠 셈 친 판정 ${open.open ? '열 수 있다' : '닫힘'} — ${open.reason}`)
console.log('     (실제 스위치 SORAN_AUTO_READY_ENABLED 는 이 명령이 읽지 않는다)\n')

// 🔴 왜 빠졌는지 값으로 보여 준다 — "적격이 적다" 로 끝내지 않는다
const dropped = decided.filter((r) => !r.verdict.auto)
if (dropped.length > 0) {
  console.log(`  ── 결정은 끝났지만 적격이 아닌 ${dropped.length}건 ──`)
  for (const d of dropped) {
    const kind = d.editDiff !== null ? '수정' : (d.declineReason ?? '').trim() !== '' ? '폐기' : '승인'
    console.log(`     ${d.id} · ${kind} · ${d.verdict.reasons.join(' · ')}`)
  }
  console.log('     🔴 이 종류는 자동이 애초에 손대지 않는다 — 표본에서 빼는 것이 맞다\n')
}

await prisma.$disconnect()

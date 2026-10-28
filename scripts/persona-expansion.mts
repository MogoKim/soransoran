#!/usr/bin/env tsx
/**
 * Persona **30 → 40 → 60 → 300 확장 판정** — 🔴 read-only. DB write 0 · LLM 0 · 유료 호출 0 (2026-10-13)
 *
 *   npx tsx scripts/persona-expansion.mts --fixture=<path> # 오프라인 — 정본 카드 · 말투 자산 · fixture
 *   npx tsx scripts/persona-expansion.mts --db --fixture=<path> # + 운영 DB read-only (계약 유효 · 집중도 · Gate ⑥-B · cadence)
 *   npx tsx scripts/persona-expansion.mts --db --voice-evidence --fixture=<path> # + 익명 보충 말투 근거 read-only
 *   npx tsx scripts/persona-expansion.mts --fixture=<path> --json=<out.json>
 *
 * 🔴 **켜는 명령이 없다.** `--apply` 를 받으면 거부한다. 활성화는 runbook 의 순서대로
 *    `COHORTS` 승격 커밋 → `persona:cohort-run` (create → seed → activate) 가 한다.
 *
 * 한 사이클
 *   ① 지금 30명 — 계약 유효 · 4상태 · 활동 집중도(7일 · 30일) · 게시판 (--db)
 *   ② 자원 — 남은 말투 화자 · 남은 이름 · 남은 코드(코드 형식 한계)
 *   ③ 단계 — d20-canary 40 · d20-sustained 60 · d100-sustained 300 각각 무엇이 모자라는가
 *   ④ canary 후보 — 운영 검증기 + 충돌(닉네임 · 연령 · 관심사 · 게시판 · 금칙) + creative 품질 + 집단 다양성
 *
 * 🔴 출력에는 코드 · 개수 · 사유 코드만 나간다. 회원 이름 · 말투 원문 · 화자 식별자는 나가지 않는다.
 *    (후보 표시명은 아직 없는 Persona 의 설계값이라 찍는다)
 */
import { readFileSync, writeFileSync } from 'node:fs'

import { modeCadence, RETIRED_AUTOGEN_CODES } from '../src/lib/persona-autogen'
import { COHORTS, PRODUCTION_PERSONA_CODES, RUNNABLE_COHORTS } from '../src/lib/persona-cohort'
import {
  activityConcentration, codeCeiling, codeLimitsToLift, codeOrderSafe, codeRoom, EXPANSION_STEPS,
  expansionFixtureComparisonInputs, judgeExpansionFixtureScope, planExpansionStep, PROPOSED_COHORTS,
  type ActivityConcentration, type ExpansionResources,
} from '../src/lib/persona-expansion'
import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { voicePoolFor } from './lib/persona-autogen.mjs'
import type { ExpansionFacts } from './lib/persona-expansion-facts.mjs'
import { judgeExpansionBatch, loadExpansionFixture, nameSpaceCapacity } from './lib/persona-expansion-gate.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'
import { readEvidenceSalt, voiceEvidenceDataDir } from './lib/voice-evidence-capture.mjs'
import { readUsableVoiceEvidence } from './lib/voice-evidence-status.mjs'
import type { LocalComment } from './lib/persona-reference-store.mjs'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'

const argv = process.argv.slice(2)
const arg = (k: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit === undefined ? null : (hit.split('=').slice(1).join('=') || null)
}
const fail = (m: string): never => { console.error(`❌ ${m}`); process.exit(1) }
if (argv.some((a) => a === '--apply' || a.startsWith('--apply=') || a === '--execute')) {
  fail('이 도구는 켜지도 쓰지도 않는다 — 활성화는 runbook(2026-10-13-persona-expansion-runbook.md) 순서로 persona:cohort-run 이 한다')
}
const USE_DB = argv.includes('--db')
const USE_VOICE_EVIDENCE = argv.includes('--voice-evidence')
if (USE_VOICE_EVIDENCE && !USE_DB) fail('--voice-evidence 는 정확한 회원·Persona 제외 집합이 필요하므로 --db 와 함께 써야 한다')
const FIXTURE = arg('fixture') ?? PROPOSED_COHORTS[0]?.fixture
  ?? fail('--fixture=<path> 가 필요하다 — 승격 대기 중인 제안 cohort 가 없다')
const JSON_OUT = arg('json')
const repoRoot = process.cwd()

console.log(`══ Persona 확장 판정 — read-only · ${USE_DB ? '운영 DB read-only' : '오프라인'} ══\n`)

// ── 정본 카드 ──
const pool = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
if (pool.problems.length > 0) fail(`정본 카드를 읽지 못했다: ${pool.problems.join(' / ')}`)

// ── fixture ──
const fx = loadExpansionFixture(repoRoot, FIXTURE)
if (!fx.ok) fail(`fixture ${FIXTURE}: ${fx.problems.join(' / ')}`)
const fixture = fx.ok ? fx.fixture : null!
const batchCodes = fixture.candidates.map((c) => c.code)
const fixtureScope = judgeExpansionFixtureScope({
  fixtureCohort: fixture.cohort,
  fixtureCodes: batchCodes,
  productionCodes: PRODUCTION_PERSONA_CODES,
  runnableCohorts: RUNNABLE_COHORTS.map((id) => COHORTS[id]),
})
if (!fixtureScope.ok) fail(fixtureScope.reason)
const baselineCodes = fixtureScope.baselineCodes
const baselineCodeSet = new Set(baselineCodes)

// ── ① 운영 DB read-only ──
let facts: ExpansionFacts | null = null
if (USE_DB) {
  await loadEnvLocal()
  const { PrismaClient } = await import('@prisma/client')
  const { readExpansionFacts } = await import('./lib/persona-expansion-facts.mjs')
  const prisma = new PrismaClient()
  try {
    facts = await readExpansionFacts(prisma, { now: new Date(), repoRoot })
  } finally {
    await prisma.$disconnect()
  }
}

const pct = (x: number): string => `${(x * 100).toFixed(0)}%`
const concLine = (label: string, c: ActivityConcentration): string => c.events === 0
  ? `  ${label}  활동 0건`
  : `  ${label}  ${c.events}건 · 활동 ${c.activePersonas}/${c.personas}명 · 1위 ${c.top1!.code} ${pct(c.top1!.share)}`
    + ` · 상위3 ${pct(c.top3Share)} · 유효 인원 ${c.effectivePersonas.toFixed(1)} · Gini ${c.gini.toFixed(2)}`
    + (c.idle.length > 0 ? ` · 0건 ${c.idle.join(' ')}` : '')

if (facts !== null) {
  const r = facts.reserve
  console.log('── ① 지금 Persona (운영 DB read-only)')
  console.log(`  DB 행 ${facts.dbCodes.length} · active 행 ${r.activeRows} · 계약 유효 ${r.contractValid ?? '모름'}`
    + ` (reserve ${r.byState.reserve.length} · stage-active ${r.byState['stage-active'].length}`
    + ` · 자격 대기 ${r.byState['qualification-pending'].length} · 설계만 ${r.byState.designed.length} · 퇴역 ${r.retired.length})`)
  if (r.activeNotContractValid.length > 0) console.log(`  🔴 active 인데 계약 밖: ${r.activeNotContractValid.join(' ')}`)
  const outsideUniverse = facts.dbCodes.filter((c) => !PRODUCTION_PERSONA_CODES.includes(c))
  console.log(`  운영 universe ${PRODUCTION_PERSONA_CODES.length} · DB 에만 있는 코드 ${outsideUniverse.length > 0 ? outsideUniverse.join(' ') : '0'}`)
  for (const [axis, g] of Object.entries(r.roundOnlyGaps)) {
    if (g.blocked.length + g.unknown.length > 0) console.log(`  회차 축 ${axis}: 막힘 ${g.blocked.length} · 모름 ${g.unknown.length} (계약 유효 수에 영향 없음)`)
  }
  console.log(concLine('7일 글+댓글', activityConcentration(facts.activity7)))
  console.log(concLine('7일 글     ', activityConcentration(facts.activity7, 'posts')))
  console.log(concLine('7일 댓글   ', activityConcentration(facts.activity7, 'comments')))
  console.log(concLine('30일 글+댓글', activityConcentration(facts.activity30)))
  console.log(`  30일 Persona 글 게시판  ${Object.entries(facts.boards30).map(([b, n]) => `${b} ${n}`).join(' · ') || '0'}`)
  console.log('')
}

// ── ② 자원 ──
let supplementalRows: LocalComment[] = []
let supplementalStatus: ReturnType<typeof readUsableVoiceEvidence>['status'] | null = null
if (USE_VOICE_EVIDENCE) {
  if (facts === null) fail('운영 DB 사실을 읽지 못했다 — 보충 말투 근거를 사용하지 않는다')
  const measuredFacts = facts as ExpansionFacts
  const measuredMembers = measuredFacts.nameSets.memberNames
    ?? fail('회원 이름 대조 집합을 읽지 못했다 — 보충 말투 근거를 사용하지 않는다')
  const salt = readEvidenceSalt(process.env)
  if (!salt.ok) fail(`보충 말투 근거가 꺼져 있다 — ${salt.code}`)
  const evidence = readUsableVoiceEvidence({
    dataDir: arg('voice-evidence-dir') ?? voiceEvidenceDataDir(),
    salt,
    members: { memberNames: measuredMembers, personaNames: measuredFacts.nameSets.personaNames ?? [] },
    now: new Date(),
  })
  supplementalRows = evidence.rows
  supplementalStatus = evidence.status
}
const voice = voicePoolFor({ repoRoot, newCodes: batchCodes, supplementalRows })
// 🔴 자산을 못 열었거나(화자 0) 운영 배정이 흔들리면 남은 수를 모른다 — 0 으로 쓰지 않는다
const voiceFree = voice.eligibleSpeakers > 0 && voice.drift.length === 0
  ? Math.max(0, voice.eligibleSpeakers - voice.assignedSpeakers) : null
const takenNames = facts?.nameSets.personaNames ?? []
const memberNames = facts?.nameSets.memberNames ?? null
// 🔴 canary 후보 이름도 이미 쓰인 것으로 본다 — 그 뒤 단계가 쓸 공간이다
const names = nameSpaceCapacity({
  takenNames: [...takenNames, ...fixture.candidates.map((c) => c.displayName)],
  memberNames: memberNames === null ? null : [...memberNames],
})
const poolCodes = pool.cards.map((card) => card.code)
const dbCodes = facts?.dbCodes ?? []
const usedCodes = [...poolCodes, ...dbCodes]
const comparison = expansionFixtureComparisonInputs({
  mode: fixtureScope.mode,
  fixtureCodes: batchCodes,
  poolCodes,
  dbCodes,
})
if (!comparison.ok) fail(comparison.reason)
const existingCardCodeSet = new Set(comparison.existingCardCodes)
const ceiling = codeCeiling()
const room = codeRoom({ usedCodes, retiredCodes: Object.keys(RETIRED_AUTOGEN_CODES), ceiling })
const orderSafeAll = codeOrderSafe([...baselineCodes, ...batchCodes])

console.log('── ② 확장 자원')
console.log(`  말투 화자   정본 자산 ${voice.eligibleSpeakers > 0 ? 'OK' : voice.code} · 근거 화자 ${voice.eligibleSpeakers}`
  + ` · 운영 배정 ${voice.assignedSpeakers} · 남음 ${voiceFree ?? '모름'}`
  + (voice.drift.length > 0 ? ` · 🔴 운영 배정 변동 ${voice.drift.join(',')}` : ''))
if (supplementalStatus !== null) {
  console.log(`  보충 근거   파일 ${supplementalStatus.files} · 사용 행 ${supplementalStatus.usableRows}`
    + ` · 화자 ${voice.supplementalSpeakers} · 자격 ${voice.supplementalEligible}`
    + ` · 정본 중복 제외 ${voice.supplementalExcluded} · 원문/식별자 출력 0`)
}
console.log(`  이름 공간   후보 합집합 ${names.space} · canary 뒤 서로·기존과 Gate ⑥-B pass ${names.free}`
  + (names.bound === 'upper' ? ' (상한 — 회원·기존 Persona 이름 미대조, --db 로 정확히)' : ' (회원·기존 Persona 대조)'))
console.log(`  코드 공간   high-water P${room.highWater} · 현재 한계 P${ceiling} · 남음 ${room.room} · 코드 순서 안전 ${orderSafeAll ? '예' : '아니오'}`)
console.log('')

// ── ③ 단계 ──
// 🔴 이름 상한(upper)은 "모자람" 만 증명한다 — 상한이 필요 수 이상이면 모른다
const contractValid = facts?.reserve.contractValid ?? null
const resources = (compareNeed: number): ExpansionResources => ({
  contractValid,
  voiceSpeakersFree: voiceFree,
  namesFree: names.bound === 'exact' || names.free < compareNeed ? names.free : null,
  codesFree: room.room,
  codeCeiling: ceiling,
})
console.log('── ③ 단계별 자원 판정 (🔴 게시 상한은 Persona 수로 계산하지 않는다 — 단계 계획 · preflight 가 정한다)')
// 🔴 계약 유효 수를 모르면(오프라인) 운영 universe 전원이 유효하다고 **가정**해 가장 작은 필요 수로 비교한다 —
//    그래도 모자라면 모자람은 증명된 것이다. 계약 유효 모름 차단은 남는다
const assumed = contractValid === null ? PRODUCTION_PERSONA_CODES.length : undefined
const plans = EXPANSION_STEPS.map((step) => {
  const compareNeed = Math.max(0, step.target - (contractValid ?? PRODUCTION_PERSONA_CODES.length))
  const plan = planExpansionStep(step, resources(compareNeed), assumed === undefined ? {} : { assumedContractValid: assumed })
  const lift = codeLimitsToLift({ highWater: room.highWater, newCodes: plan.need ?? compareNeed })
  console.log(`  ${step.id.padEnd(15)} 목표 ${String(step.target).padStart(3)} · 지금 ${plan.have ?? '모름'}`
    + ` · 필요 ${plan.need ?? `모름(가정 ${compareNeed})`} · ${plan.resourcesReady ? '✅ 자원 준비' : '❌'}`
    + `${step.requires === null ? '' : ` · 선행 ${step.requires}`}`)
  for (const b of plan.blocks) console.log(`      ${b.code}: ${b.detail}`)
  for (const l of lift) console.log(`      코드 한계 P${l.max} (${l.kind}) ${l.file} — ${l.effect}`)
  return { plan, lift: lift.map((l) => `${l.file}:${l.kind}:P${l.max}`) }
})
console.log('')

// ── ④ canary 후보 ──
const cadence = facts === null ? null : modeCadence(facts.cadences)
const batch = judgeExpansionBatch({
  fixture,
  existingCards: pool.cards.filter((card) => existingCardCodeSet.has(card.code)),
  productionCodes: baselineCodes,
  takenCodes: comparison.takenCodes,
  voiceByCode: voice.byCode,
  productionBundles: voice.productionBundles.filter((bundle) => baselineCodeSet.has(bundle.personaCode)),
  cadence,
  nameSets: facts?.nameSets ?? null,
})
const scopeLabel = fixtureScope.mode === 'runnable'
  ? '승격된 runnable cohort · 운영 DB 적재/활성화는 별도'
  : '제안 cohort · COHORTS 밖 · 기본 비활성'
console.log(`── ④ ${fixture.cohort} — ${fixture.candidates.length}명 (🔴 ${scopeLabel})`)
for (const c of batch.candidates) {
  const f = fixture.candidates.find((x) => x.code === c.code)!
  const l = f.life
  const head = `${l.ageBand}·${l.region}·${l.maritalStatus}·자녀${l.childrenCount}·${l.workStatus}·돌봄${l.parentCare}`
  console.log(`  ${c.code}  ${c.status.padEnd(10)} ${f.displayName}  ${head.padEnd(30)} ${c.reasons.join(' ') || '—'}`)
}
const counts = { ready: 0, blocked: 0, unmeasured: 0 }
for (const c of batch.candidates) counts[c.status] += 1
const reasonCount = new Map<string, number>()
for (const c of batch.candidates) for (const r of c.reasons) reasonCount.set(r, (reasonCount.get(r) ?? 0) + 1)
console.log(`  ready ${counts.ready} · blocked ${counts.blocked} · unmeasured ${counts.unmeasured}`)
if (reasonCount.size > 0) console.log(`  사유  ${[...reasonCount.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} ${n}`).join(' · ')}`)
console.log(`  creative 묶음 품질 ${batch.creativeQuality.status}`)
for (const p of batch.creativeQuality.problems) console.log(`      ${p}`)
console.log(`  집단 다양성 ${batch.diversity.ok ? 'OK' : 'FAIL'} — 30 + ${fixture.candidates.length}`)
for (const p of batch.diversity.problems) console.log(`      ${p.rule}: ${p.detail}`)
console.log(`      합친 집단 최빈 점유  ${batch.diversity.merged.map((s) => `${s.axis}=${s.value} ${pct(s.share)}`).join(' · ')}`)
console.log(`      묶음 최빈 점유      ${batch.diversity.batch.map((s) => `${s.axis}=${s.value} ${s.count}/${s.total}`).join(' · ')}`)
console.log(`  문체 분리 기준(운영 묶음 최소 거리) ${batch.voiceBaseline?.toFixed(3) ?? '모름'}`)
console.log('')
console.log(`🟡 read-only — DB write 0 · 활성화 0 · ${batch.ok ? 'canary 묶음 서 있음' : 'canary 묶음 아직 서지 않음'}`)

if (JSON_OUT !== null) {
  writeFileSync(JSON_OUT, `${JSON.stringify({
    mode: USE_DB ? 'db-read-only' : 'offline',
    now: Date.now(),
    current: facts === null ? null : {
      contractValid: facts.reserve.contractValid, activeRows: facts.reserve.activeRows,
      activeNotContractValid: facts.reserve.activeNotContractValid,
      concentration7: activityConcentration(facts.activity7), concentration30: activityConcentration(facts.activity30),
      boards30: facts.boards30,
    },
    resources: { voiceSpeakers: { eligible: voice.eligibleSpeakers, assigned: voice.assignedSpeakers, free: voiceFree }, names: { space: names.space, free: names.free, bound: names.bound }, codes: { ...room, ceiling, orderSafeAll } },
    steps: plans,
    canary: {
      cohort: fixture.cohort,
      candidates: batch.candidates.map((c) => ({
        code: c.code,
        status: c.status,
        reasons: c.reasons,
        displayName: fixture.candidates.find((candidate) => candidate.code === c.code)?.displayName ?? null,
        // Promotion consumes only artifacts that passed the same production
        // card/seed validators used above. Source voice text is never emitted.
        cardMarkdown: c.status === 'ready' ? c.autogen.cardMarkdown : null,
        seed: c.status === 'ready' ? c.autogen.seed : null,
      })),
      creativeQuality: batch.creativeQuality.status,
      diversity: { ok: batch.diversity.ok, problems: batch.diversity.problems, merged: batch.diversity.merged, effective: batch.diversity.effective },
    },
  }, null, 2)}\n`)
  console.log(`  JSON → ${JSON_OUT}`)
}

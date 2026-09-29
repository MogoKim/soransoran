#!/usr/bin/env tsx
/**
 * Persona **자동 확장** — 🔴 기본은 dry-run. LLM 0 · 유료 호출 0 (2026-09-29, Track C)
 *
 *   npx tsx scripts/persona-autogen.mts                      # 후보 생성 · 검증 · 격리 · 계획 (DB 0)
 *   npx tsx scripts/persona-autogen.mts --db                 # + 운영 DB read-only (코드·cadence·표시명 Gate ⑥-B)
 *   npx tsx scripts/persona-autogen.mts --count=10 --supplement=<creative.json>
 *   npx tsx scripts/persona-autogen.mts --db --supplement=<creative.json> \
 *     --apply --limit=<valid 수> --reason "..."             # 🔴 draft 적재 — 켜지 않는다
 *
 * 한 사이클
 *   ① 코드   P26~ 중 카드·DB 에 없는 번호
 *   ② 생활사 얇은 축을 메우는 골격 — 결정론 (`proposeLifeSkeletons`)
 *   ③ 말투   아직 배정되지 않은 정본 화자 — 운영과 같은 규칙 (`voicePoolFor`)
 *   ④ creative 🔴 LLM 단계 — **구현하지 않았다.** `--supplement` 로 받은 것만 쓴다
 *   ⑤ 검증   운영 검증기 그대로 (`judgeAutogenCandidate`) → valid / quarantined / rejected
 *   ⑥ 계획   valid 만 활성화 계획에 올린다 — 문서 카드 · cohort manifest · seed · activate
 *
 * 🔴 출력에는 코드·개수·사유 코드만 나온다. 코퍼스 원문 · 화자 식별자 · 회원 이름은 나오지 않는다.
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { parsePoolDoc } from '../src/lib/persona-pool-card'
import { PERSONA_CANARY_FLOOR, PERSONA_SUSTAINED_TARGET } from '../src/lib/d100-capacity'
import { assignCandidates } from '../src/lib/persona-nickname-candidates'
import {
  AUTOGEN_CODE_FIRST, AUTOGEN_CODE_LAST, autogenCodeOf, modeCadence, proposeLifeSkeletons,
  subjectOfCard, subjectOfLife, thinLifeAxisCount,
  type AutogenCandidate, type Cadence, type DisplayNameCheck, type PersonaCreative,
} from '../src/lib/persona-autogen'
import { judgeAutogenCandidate, voicePoolFor, type AutogenVerdict } from './lib/persona-autogen.mjs'
import { applyAutogenDrafts } from './lib/persona-autogen-apply.mjs'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const argv = process.argv.slice(2)
const arg = (k: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit === undefined ? null : (hit.split('=').slice(1).join('=') || null)
}
const APPLY = argv.includes('--apply')
const USE_DB = argv.includes('--db') || APPLY
const COUNT = Number(arg('count') ?? '6')
const LIMIT = arg('limit') === null ? null : Number(arg('limit'))
const REASON_AT = argv.indexOf('--reason')
const REASON = REASON_AT >= 0 ? (argv[REASON_AT + 1] ?? '') : ''
const SUPPLEMENT = arg('supplement')
const OUT = arg('out')
const fail = (m: string): never => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }

if (!Number.isInteger(COUNT) || COUNT < 1 || COUNT > AUTOGEN_CODE_LAST - AUTOGEN_CODE_FIRST + 1) {
  fail(`--count 는 1~${AUTOGEN_CODE_LAST - AUTOGEN_CODE_FIRST + 1} 정수다`)
}

console.log(`\n══ Persona 자동 확장 — ${APPLY ? '🔴 --apply (draft 적재)' : 'dry-run (DB write 0)'} · LLM 0 ══\n`)
console.log(`  목표(정본 d100-capacity): canary ${JSON.stringify(PERSONA_CANARY_FLOOR)}`)
console.log(`                            지속   ${JSON.stringify(PERSONA_SUSTAINED_TARGET)}`)

// ── 정본 카드 ──
const pool = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
if (pool.problems.length > 0) fail(`정본 Pool 카드 파싱 문제 ${pool.problems.length}건`)
const taken = new Set<string>(pool.cards.map((c) => c.code))

// ── 운영 DB (read-only) ──
type DbFacts = { codes: string[]; cadences: Cadence[]; isTaken: (n: string) => boolean; gateOf: (n: string) => DisplayNameCheck['gate'] }
let db: DbFacts | null = null
let prismaRef: import('@prisma/client').PrismaClient | null = null
let hashOf: ((v: string) => string) | null = null
if (USE_DB) {
  await loadEnvLocal()
  const { PrismaClient } = await import('@prisma/client')
  const { loadNameCollisionSets } = await import('./lib/persona-name-collision-sets.mjs')
  const { checkNameCollision } = await import('./lib/persona-gate-name-collision.mjs')
  const salt = (process.env.VOICE_AUTHOR_HASH_SALT ?? 'soransoran-voice-v1').trim()
  const h = (v: string): string => `sha256:${createHash('sha256').update(`${salt}::${v}`, 'utf8').digest('hex')}`
  hashOf = h
  const prisma = new PrismaClient()
  prismaRef = prisma
  const rows = await prisma.persona.findMany({
    select: { code: true, status: true, dailyCap: true, weeklyCap: true, silenceRate: true, activityRhythm: true },
  })
  const sets = await loadNameCollisionSets(prisma)
  const cadences: Cadence[] = rows
    .filter((r) => r.status === 'active' && r.dailyCap !== null && r.weeklyCap !== null && r.silenceRate !== null
      && r.activityRhythm !== null && typeof r.activityRhythm === 'object')
    .map((r) => ({
      dailyCap: r.dailyCap!, weeklyCap: r.weeklyCap!, silenceRate: Number(r.silenceRate),
      activityRhythm: r.activityRhythm as Cadence['activityRhythm'],
    }))
  db = {
    codes: rows.map((r) => r.code),
    cadences,
    isTaken: (n) => checkNameCollision(n, sets, { hashOf: h }).status !== 'pass',
    gateOf: (n) => checkNameCollision(n, sets, { hashOf: h }).status,
  }
  for (const c of db.codes) taken.add(c)
  console.log(`  운영 DB read-only — Persona ${rows.length}행 · cadence 표본 ${cadences.length}`)
}

// ── ① 코드 ──
const codes: string[] = []
for (let n = AUTOGEN_CODE_FIRST; n <= AUTOGEN_CODE_LAST && codes.length < COUNT; n += 1) {
  if (!taken.has(autogenCodeOf(n))) codes.push(autogenCodeOf(n))
}

// ── ② 생활사 골격 ──
const skeletons = proposeLifeSkeletons({ existing: pool.cards, codes })
const lifeOf = new Map(skeletons.map((s) => [s.code, s.life]))
const thinBefore = thinLifeAxisCount(pool.cards.map(subjectOfCard))
const thinAfter = thinLifeAxisCount([...pool.cards.map(subjectOfCard), ...skeletons.map((s) => subjectOfLife(s.code, s.life))])

// ── ③ 말투 풀 ──
const voice = voicePoolFor({ repoRoot: process.cwd(), newCodes: codes })

// ── ④ creative — 🔴 LLM 단계 없음. 보충 파일만 ──
let creative: Record<string, PersonaCreative> = {}
if (SUPPLEMENT !== null) {
  if (!existsSync(SUPPLEMENT)) fail(`--supplement 파일이 없다: ${SUPPLEMENT}`)
  creative = JSON.parse(readFileSync(SUPPLEMENT, 'utf-8')) as Record<string, PersonaCreative>
}

// ── 표시명 — 정책 + Gate ⑥-B (DB 가 있을 때만) ──
const names = db === null ? null : assignCandidates(codes, db.isTaken)
const cadence = db === null ? null : modeCadence(db.cadences)

// ── ⑤ 검증 ──
const verdicts: AutogenVerdict[] = codes.map((code) => {
  const v = voice.byCode.get(code) ?? null
  const name = names?.picked.get(code) ?? null
  const cand: AutogenCandidate = {
    code,
    life: lifeOf.get(code) ?? null,
    creative: creative[code] ?? null,
    voice: v,
    cadence,
    // 🔴 자동 후보는 언제나 **새 User** 를 만든다 — 계정 0 · providerId 없음이 사실이다
    binding: { accountCount: 0, providerId: null },
    displayName: db === null || name === null ? null : { name, gate: db.gateOf(name) },
  }
  const verdict = judgeAutogenCandidate(cand, { takenCodes: taken })
  if (!voice.ok) {
    verdict.blocks.push('VOICE_ASSIGNMENT_DRIFT')
    verdict.status = verdict.status === 'rejected' ? 'rejected' : 'quarantined'
  }
  return verdict
})

// ── 보고 ──
console.log('\n── 말투 근거 풀 (정본 자산 · 운영 고정 배정 규칙)')
console.log(`  자산 ${voice.code} · 3건↑ 안전 화자 ${voice.eligibleSpeakers} · 운영 배정 ${voice.assignedSpeakers}`
  + ` · 남은 화자 ${Math.max(0, voice.eligibleSpeakers - voice.assignedSpeakers)}`)
console.log(`  운영 active 인데 말투 없음 ${voice.productionWithoutVoice.length} (${voice.productionWithoutVoice.join('·') || '—'}) — 새 화자는 여기부터 간다`)
console.log(`  새 코드에 돌아간 묶음 ${voice.byCode.size}/${codes.length}${voice.drift.length > 0 ? ` · 🔴 운영 배정 변동 ${voice.drift.join('·')}` : ''}`)
console.log(`\n── 생활사 골격 ${skeletons.length}/${codes.length} · 얇은 생활사 축 ${thinBefore} → ${thinAfter}`)

console.log('\n── 후보 판정 (코드만)')
const cnt: Record<string, number> = {}
for (const v of verdicts) {
  const l = lifeOf.get(v.code)
  const shape = l === undefined ? '—' : `${l.ageBand}·${l.maritalStatus}·자녀${l.childrenCount}·${l.workStatus}·돌봄${l.parentCare}`
  console.log(`  ${v.code}  ${v.status.padEnd(11)} ${shape.padEnd(28)} ${v.blocks.join(' ') || '—'}`)
  for (const b of v.blocks) cnt[b] = (cnt[b] ?? 0) + 1
}
const valid = verdicts.filter((v) => v.status === 'valid')
console.log(`\n  valid ${valid.length} · quarantined ${verdicts.filter((v) => v.status === 'quarantined').length}`
  + ` · rejected ${verdicts.filter((v) => v.status === 'rejected').length}`)
console.log(`  격리 사유  ${Object.entries(cnt).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'}`)

const first = verdicts.length > 0 && verdicts.every((v) => v.blocks.includes('NO_VOICE_EVIDENCE'))
if (first) {
  console.log('\n  🔴 첫 병목: 말투 근거 — 배정되지 않은 3건↑ 안전 화자가 0명이다.'
    + ' 생활사·LLM 을 채워도 이 칸에서 전원 격리된다(코퍼스를 늘리는 것이 먼저다)')
}

// ── ⑥ 활성화 계획 — valid 만 ──
console.log('\n── 활성화 계획 (valid 만 · 🔴 이 도구는 켜지 않는다)')
if (valid.length === 0) console.log('  valid 0 — 계획 없음')
else {
  console.log(`  1) 정본 카드 ${valid.length}장을 ${PERSONA_POOL_DOC} §5 에 추가 (문서 PR)`)
  console.log(`  2) src/lib/persona-cohort.ts COHORTS 에 새 cohort (${valid.map((v) => v.code).join(' · ')}) · RUNNABLE_COHORTS`)
  console.log(`  3) draft 적재: persona-autogen --db --apply --limit=${valid.length} --reason "..."  (User·Persona draft·seed·감사 3건)`)
  console.log('  4) ACTOR_USER_ID=<id> persona-cohort-run --cohort=<새 cohort> --step=activate --apply --limit=N --reason "..."')
}

if (OUT !== null) {
  mkdirSync(dirname(OUT), { recursive: true })
  // 🔴 코퍼스 원문을 담지 않는다 — 묶음은 건수만
  writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    voice: { code: voice.code, eligible: voice.eligibleSpeakers, assigned: voice.assignedSpeakers,
      productionWithoutVoice: voice.productionWithoutVoice, newWithVoice: [...voice.byCode.keys()] },
    verdicts: verdicts.map((v) => ({ code: v.code, status: v.status, blocks: v.blocks, postEligible: v.postEligible,
      commentEligible: v.commentEligible, cardMarkdown: v.cardMarkdown, seed: v.seed })),
  }, null, 2))
  console.log(`\n  artifact → ${OUT}`)
}

// ── 🔴 적재 — --apply 뒤에서만 ──
if (!APPLY) {
  console.log('\n🟡 dry-run — DB write 0\n')
  await prismaRef?.$disconnect()
  process.exit(0)
}
if (prismaRef === null || hashOf === null || names === null) fail('--apply 는 DB 읽기가 필요하다')
const plans = valid.map((v) => ({ code: v.code, status: v.status, name: names!.picked.get(v.code) ?? '', seed: v.seed ?? {} }))
const res = await applyAutogenDrafts(prismaRef!, { plans, limit: LIMIT, hashOf: hashOf!, reason: REASON })
await prismaRef!.$disconnect()
if (!res.ok) fail(`적재하지 않았다 — ${res.reason}`)
console.log(`\n✅ draft 적재 ${res.ok ? res.created.join(' · ') : ''} — 🔴 status=draft. 켜는 것은 계획 4) 다\n`)

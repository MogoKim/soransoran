#!/usr/bin/env tsx
/**
 * Persona **cohort seed materializer** — 🔴 기본 dry-run · DB read-only · provider 0 (2026-10-08)
 *
 *   npx tsx scripts/persona-cohort-seed.mts --cohort=wave5-d10 \
 *     --creative=<승인 creative 파일> --expect-sha=<sha256>            # dry-run — 파일 0
 *   npx tsx scripts/persona-cohort-seed.mts ... --write                  # tmp/persona-<cohort>-seed.json
 *
 * `persona-cohort-run --step=seed` 가 읽는 seed 파일을 **정본에서만** 만든다 — 손으로 쓰지 않는다.
 * 판정 authority 는 `scripts/lib/persona-cohort-seed.mts` 에 있다(입력 출처 표는 그 파일 머리).
 *
 * 🔴 이 도구가 하지 않는 것
 *      · DB write — Persona 는 cadence 측정을 위해 **읽기만** 한다
 *      · provider · LLM 호출
 *      · Persona create · seed · activate — 그것은 `persona-cohort-run` 이다
 *      · 일부만 쓰는 것 — 하나라도 어긋나면 파일 0
 *      · 다른 내용의 기존 seed 파일 덮어쓰기
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { cohortOf, judgeCohortArg, PRODUCTION_PERSONA_CODES, seedPathOf, verifyAllCohorts } from '../src/lib/persona-cohort'
import { parsePoolDoc, type PoolCard } from '../src/lib/persona-pool-card'
import { lifeStageOf, modeCadence, voiceCoreFromBundle, type Cadence } from '../src/lib/persona-autogen'
import {
  buildCohortSeeds, judgeCohortVoice, judgeCreativeAgainstCards, judgeExistingOutput, readApprovedCreative,
  seedPrivacyProblems, serializeSeeds, sha256Hex,
} from './lib/persona-cohort-seed.mjs'
import { planBundles, stableAssignment } from './lib/persona-reference-store.mjs'
import { PERSONA_POOL_DOC } from './lib/voice-runtime.mjs'
import { loadEnvLocal } from './lib/micro-seed-time.mjs'

const argv = process.argv.slice(2)
const arg = (k: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`))
  return hit === undefined ? null : (hit.split('=').slice(1).join('=') || null)
}
const WRITE = argv.includes('--write')
const fail = (m: string): never => { console.error(`\n🔴 중단 — 파일 0 · DB write 0\n   ${m}\n`); process.exit(1) }
const failAll = (problems: readonly string[]): never => fail(problems.join('\n   '))

// ── 인자 · manifest — 🔴 DB 를 열기 전에 막는다 ──
const manifestProblems = verifyAllCohorts()
if (manifestProblems.length > 0) failAll(manifestProblems.map((p) => `[MANIFEST] ${p}`))
const cg = judgeCohortArg(arg('cohort'))
if (!cg.ok) fail(`[COHORT] ${cg.reason}`)
const COHORT = cg.id!
const CODES = cohortOf(COHORT)!.codes
const CREATIVE = arg('creative')
const EXPECT_SHA = arg('expect-sha')
if (CREATIVE === null) fail('[ARGS] --creative=<승인 creative 파일> 이 필요하다')
if (EXPECT_SHA === null || !/^[0-9a-f]{64}$/.test(EXPECT_SHA)) fail('[ARGS] --expect-sha=<sha256 64자> 이 필요하다')
const outsideUniverse = CODES.filter((c) => !PRODUCTION_PERSONA_CODES.includes(c))
if (outsideUniverse.length > 0) fail(`[COHORT] production universe 밖 코드: ${outsideUniverse.join(',')}`)

console.log(`\n══ Persona cohort seed — ${COHORT} · ${WRITE ? '🔴 --write' : 'dry-run (파일 0)'} · DB read-only · provider 0 ══\n`)
console.log(`  대상 ${CODES.length}명  ${CODES.join(' · ')}   🔴 manifest 가 정한다`)

// ── ① 승인 creative ──
if (!existsSync(CREATIVE!)) fail(`[CREATIVE] 파일이 없다: ${CREATIVE}`)
const creativeRead = readApprovedCreative({ raw: readFileSync(CREATIVE!, 'utf-8'), expectSha: EXPECT_SHA!, codes: CODES })
if (!creativeRead.ok) failAll(creativeRead.problems)
const creatives = (creativeRead as { ok: true; value: Parameters<typeof judgeCreativeAgainstCards>[0]['creatives'] }).value
console.log(`  ✅ 승인 creative — SHA 일치 · 코드 ${Object.keys(creatives).length}개 · 중복 0 · 엄격 파서 통과`)

// ── ② 정본 카드 ──
const pool = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
if (pool.problems.length > 0) failAll(pool.problems.map((p) => `[CARD_PARSE] ${p}`))
const cards = new Map<string, PoolCard>(pool.cards.map((c) => [c.code, c]))
const cardProblems = judgeCreativeAgainstCards({ codes: CODES, creatives, cards })
if (cardProblems.length > 0) failAll(cardProblems)
console.log('  ✅ 정본 카드 ↔ creative — title · personality · noGo 글자 일치 · variation 개수 일치')

// ── ③ 말투 — 현재 production 전체 기준 고정 배정 ──
const sa = stableAssignment({ repoRoot: process.cwd() })
if (sa.origin !== '정본 자산' || sa.rows.length === 0) fail(`[VOICE_ASSET] 정본 말투 자산이 아니다 — ${sa.origin} · ${sa.blocks.join(' / ')}`)
const existing = PRODUCTION_PERSONA_CODES.filter((c) => !CODES.includes(c))
const base = new Map(planBundles({ rows: sa.rows, personaCodes: existing }).bundles.map((b) => [b.personaCode, b]))
const voiceProblems = judgeCohortVoice({ cohortCodes: CODES, existingCodes: existing, base, full: sa.byCode })
if (voiceProblems.length > 0) failAll(voiceProblems)
console.log(`  ✅ 말투 묶음 ${CODES.length}/${CODES.length} · 기존 production ${existing.length}명 배정 drift 0`)

// ── ④ cadence — 운영 active 최빈값 (🔴 read-only) ──
await loadEnvLocal()
const { PrismaClient } = await import('@prisma/client')
const prisma = new PrismaClient()
let cadence: Cadence | null = null
let activeCount = 0
try {
  const rows = await prisma.persona.findMany({
    where: { status: 'active' },
    select: { dailyCap: true, weeklyCap: true, silenceRate: true, activityRhythm: true },
  })
  activeCount = rows.length
  cadence = modeCadence(rows
    .filter((r) => r.dailyCap !== null && r.weeklyCap !== null && r.silenceRate !== null
      && r.activityRhythm !== null && typeof r.activityRhythm === 'object')
    .map((r) => ({
      dailyCap: r.dailyCap!, weeklyCap: r.weeklyCap!, silenceRate: Number(r.silenceRate),
      activityRhythm: r.activityRhythm as Cadence['activityRhythm'],
    })))
} finally {
  await prisma.$disconnect()
}
console.log(`  운영 active ${activeCount}명 cadence 최빈값 ${cadence === null ? '—' : JSON.stringify(cadence)}`)

// ── ⑤ seed 조립 · 정본 검증 ──
const built = buildCohortSeeds({ codes: CODES, cards, creatives, voice: sa.byCode, cadence })
if (!built.ok) failAll(built.problems)
const seeds = (built as { ok: true; value: Record<string, Record<string, unknown>> }).value
const text = serializeSeeds(CODES, seeds)
const privacy = seedPrivacyProblems(text, { texts: sa.rows.map((r) => r.text), speakerIds: sa.rows.map((r) => r.speakerId) })
if (privacy.length > 0) failAll(privacy)

console.log('\n  ── seed (코드 · lifeStage · voiceCore · cadence)')
for (const code of CODES) {
  const s = seeds[code]!
  const vc = voiceCoreFromBundle(sa.byCode.get(code)!)
  console.log(`  ${code}  ${String(s.lifeStage).padEnd(9)} voiceCore ${JSON.stringify(s.voiceCore)}`
    + `  cap ${String(s.dailyCap)}/${String(s.weeklyCap)} · silence ${String(s.silenceRate)}  verifySeedCard ✅`
    + `${lifeStageOf(cards.get(code)!) === s.lifeStage ? '' : '  🔴 lifeStageOf 불일치'}${vc.register === (s.voiceCore as { register: string }).register ? '' : '  🔴 voiceCore 불일치'}`)
}
const digest = sha256Hex(text)
console.log(`\n  seed ${CODES.length}명 · digest ${digest} · 원문 · 화자 id · URL · 이메일 0`)

// ── ⑥ 출력 ──
const path = seedPathOf(COHORT)
const decision = judgeExistingOutput(existsSync(path) ? readFileSync(path, 'utf-8') : null, text)
if (decision === 'conflict') fail(`[OUTPUT_CONFLICT] ${path} 이 이미 있고 내용이 다르다 — 덮지 않는다(digest ${sha256Hex(readFileSync(path, 'utf-8'))})`)
if (decision === 'same') {
  console.log(`  ✅ ${path} 이 이미 같은 내용이다 — 쓰지 않는다\n`)
  process.exit(0)
}
if (!WRITE) {
  console.log(`  🟡 dry-run — 파일 0. 쓰려면 --write (${path})\n`)
  process.exit(0)
}
mkdirSync(dirname(path), { recursive: true })
const tmp = `${path}.tmp-${process.pid}`
writeFileSync(tmp, text, { mode: 0o600 })
chmodSync(tmp, 0o600)
renameSync(tmp, path)
if (sha256Hex(readFileSync(path, 'utf-8')) !== digest) fail(`[OUTPUT_VERIFY] 쓴 파일 digest 가 다르다: ${path}`)
console.log(`  ✅ ${path} — 원자적 rename · 권한 600 · ${CODES.length}키 · digest ${digest}\n`)

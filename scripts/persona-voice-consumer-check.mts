#!/usr/bin/env tsx
/**
 * 🔴 D20→D30→D50 말투 묶음 소비자 검사 (2026-11-14 · v3 2026-11-23) — 임시 HOME · 합성 자산 · DB 0 · provider 0
 *
 *   npm run persona:voice-consumer-check
 *
 * ① 스냅샷 없음: base30 배정 불변, 신규 30명 fail-closed
 * ② 글 생성과 댓글이 같은 Persona 배정 정본을 쓴다
 * ③ v1은 wave6 10명만 추가한다
 * ④ v2는 동결 v1 + wave7 20명을 추가해 production 60명을 덮는다
 * ⑤ 손상 v2는 v1로 조용히 후퇴하지 않고 base30만 유지한다
 * ⑥ v3는 동결 v2 + 다음 cohort 를 더하고 기존 60명 배정을 바꾸지 않는다 · 투입 전 기준선은 데이터에서 고른다
 * ⑦ 글 생성 경로는 배정을 따로 계산하지 않는다
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const home = mkdtempSync(join(tmpdir(), 'persona-voice-consumer-'))
process.env.HOME = home
const repoRoot = process.cwd()

const { REFERENCE_DIR, REFERENCE_CORPUS_FILE, REFERENCE_MANIFEST_FILE, ASSET_VERSION } = await import('../src/lib/persona-reference-asset')
const { COHORTS, PRODUCTION_PERSONA_CODES } = await import('../src/lib/persona-cohort')
const { supplementPaths } = await import('../src/lib/persona-reference-supplement')
const { loadCanonAsset, planBundles, bundlesForPersonas, preInsertVoiceBaseline, stableAssignment } = await import('./lib/persona-reference-store.mjs')
const { loadExpansionFixture } = await import('./lib/persona-expansion-gate.mjs')
const { loadVoice, digest16 } = await import('./lib/voice-runtime.mjs')
const { planSupplementSnapshot } = await import('./lib/persona-reference-supplement-plan.mjs')
const { writeSupplementSnapshot } = await import('./lib/persona-reference-supplement-store.mjs')
const { VOICE_SAMPLE_MAX } = await import('../src/lib/content-core/voice-evidence')
const BASE_CODES = PRODUCTION_PERSONA_CODES.slice(0, 30)
const V1_CODES = COHORTS['wave6-d20-canary'].codes
const V2_CODES = COHORTS['wave7-d30'].codes
/** 다음 cohort — 승인 전 fixture 의 코드(코드 universe 밖) */
const D50_FIXTURE = loadExpansionFixture(repoRoot, 'scripts/__fixtures__/persona-expansion-d50.json')
const V3_CODES = D50_FIXTURE.ok ? D50_FIXTURE.fixture.candidates.map((c) => c.code) : []

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

/** 🔴 합성 말투만 쓴다. 실제 회원·외부 원문은 없다. */
const speakerId = (prefix: string, n: number): string => createHash('sha256').update(`${prefix}${n}`).digest('hex').slice(0, 12)
const rowsOf = (prefix: string, speakers: number) => Array.from({ length: speakers }, (_, s) =>
  Array.from({ length: 3 }, (_, i) => ({ speakerId: speakerId(prefix, s), text: `${prefix} 의견 ${s}-${i} 정말 그렇네요 반갑습니다` }))).flat()
/**
 * 🔴 보충 화자는 길이 밴드를 섞는다(짧게 · 보통 · 길게 차례) — 한 밴드가 묶음의 70% 를 넘는 합성 cohort 는
 *    기록이 판정과 같은 코드(BATCH_MONOCULTURE)로 막는다(2026-11-23 · voiceBand 상한). 실제 wave6 · wave7 도 섞여 있었다.
 */
const mixedRowsOf = (prefix: string, speakers: number) => Array.from({ length: speakers }, (_, s) =>
  Array.from({ length: 3 }, (_, i) => ({
    speakerId: speakerId(prefix, s),
    text: `${prefix} 의견 ${s}-${i} 정말 그렇네요 반갑습니다${' 정말 그렇네요'.repeat([0, 1, 7][s % 3]!)}`,
  }))).flat()

// 정본 화자 32: base30을 안정적으로 배정하고 2명의 여유를 둔 운영 모양.
const canonRows = rowsOf('ca', 32)
mkdirSync(REFERENCE_DIR, { recursive: true, mode: 0o700 })
const corpusRaw = JSON.stringify({
  version: ASSET_VERSION, generatedAt: '2026-10-15T00:00:00.000Z',
  comments: canonRows.map((r) => ({ speakerId: r.speakerId, content: r.text })),
})
writeFileSync(REFERENCE_CORPUS_FILE, corpusRaw, { mode: 0o600 })
chmodSync(REFERENCE_CORPUS_FILE, 0o600)
const sourceDigest = createHash('sha256').update(corpusRaw).digest('hex').slice(0, 16)
writeFileSync(REFERENCE_MANIFEST_FILE, JSON.stringify({ sourceDigest }), { mode: 0o600 })
chmodSync(REFERENCE_MANIFEST_FILE, 0o600)

const canon = loadCanonAsset()
check('합성 정본 자산이 정본 경로로 읽힌다', canon.ok && canon.sourceDigest === sourceDigest, `${canon.code} ${canon.reason}`)
const textsOf = (b: { comments: readonly { text: string }[] } | undefined): string[] => (b?.comments ?? []).map((c) => c.text)
const authorCodes = (): Set<string> => new Set(loadVoice().candidates.map((c) => c.code))
const bundleDigestOf = (b: { comments: readonly { text: string }[] } | undefined): string => digest16(textsOf(b).join('\u0000'))

console.log('\n① 스냅샷 없음 — base30 그대로 · 신규 30명 fail-closed')
const legacy = new Map(planBundles({ rows: canon.rows, personaCodes: BASE_CODES }).bundles.map((b) => [b.personaCode, b]))
const voice0 = loadVoice()
check('글 생성이 막히지 않는다', voice0.blockAllCode === null, String(voice0.blockReason))
const expected0 = [...legacy.keys()].filter((code) => voice0.candidates.some((c) => c.code === code))
check('글쓴이 후보 = 말투·나이대가 선 base30', voice0.candidates.length > 0 && voice0.candidates.length === expected0.length,
  `${voice0.candidates.length}/${expected0.length}`)
check('🔴 후보마다 말투 지문·표본이 앞판 계산과 같다', voice0.candidates.every((c) =>
  c.bundleDigest === bundleDigestOf(legacy.get(c.code))
  && JSON.stringify(c.samples) === JSON.stringify(textsOf(legacy.get(c.code)).slice(0, VOICE_SAMPLE_MAX))))

console.log('\n② 글 생성과 댓글이 같은 Persona 배정을 쓴다')
const comment0 = bundlesForPersonas({ repoRoot, personaCodes: PRODUCTION_PERSONA_CODES })
check('🔴 글 생성 말투 지문 = 댓글 묶음 지문', voice0.candidates.every((c) => c.bundleDigest === bundleDigestOf(comment0.byCode.get(c.code))))
check('스냅샷 없이는 base30만 서고 신규 30명은 막힌다',
  BASE_CODES.every((code) => comment0.byCode.has(code))
  && [...V1_CODES, ...V2_CODES].every((code) => !comment0.byCode.has(code)))

console.log('\n③ v1 스냅샷 — base30 그대로 · wave6 10명 활성')
const planV1 = planSupplementSnapshot({
  canonRows: canon.rows, extraRows: mixedRowsOf('v1', V1_CODES.length), baseCodes: BASE_CODES, newCodes: V1_CODES,
  baseSourceDigest: sourceDigest, saltId: 'c'.repeat(12), generatedAt: '2026-10-15T00:00:00.000Z', reason: 'fixture v1',
})
check('v1 계획이 선다(base30 배정 변동 0)', planV1.ok, planV1.problems.join(' / '))
const writtenV1 = writeSupplementSnapshot({ assetText: planV1.assetText, manifestText: planV1.manifestText, generation: 1 })
check('v1이 정본 경로에 기록된다', writtenV1.ok)
const saV1 = stableAssignment({ repoRoot })
check('배정 정본이 v1 동결 묶음 10개만 읽는다', saV1.supplementByCode.size === V1_CODES.length, String(saV1.supplementByCode.size))
const before = new Map(voice0.candidates.map((c) => [c.code, JSON.stringify(c)]))
check('🔴 v1 후에도 base30 글쓴이·말투가 한 글자도 바뀌지 않는다',
  loadVoice().candidates.filter((c) => before.has(c.code)).every((c) => before.get(c.code) === JSON.stringify(c)))
const voiceV1 = authorCodes()
check('🔴 wave6 10명이 글쓴이 후보에 들어온다', V1_CODES.every((code) => voiceV1.has(code)))
const comment1 = bundlesForPersonas({ repoRoot, personaCodes: PRODUCTION_PERSONA_CODES })
check('🔴 v1은 base30 + wave6 10명만 덮고 wave7은 막는다',
  [...BASE_CODES, ...V1_CODES].every((code) => comment1.byCode.has(code))
  && V2_CODES.every((code) => !comment1.byCode.has(code)))

console.log('\n④ v2 스냅샷 — v1 동결 · wave7 20명 추가 · production 60')
const planV2 = planSupplementSnapshot({
  canonRows: canon.rows, extraRows: mixedRowsOf('v2', V2_CODES.length), baseCodes: BASE_CODES, newCodes: V2_CODES,
  frozenBundles: planV1.asset.bundles,
  baseSourceDigest: sourceDigest, saltId: 'd'.repeat(12), generatedAt: '2026-11-14T00:00:00.000Z', reason: 'fixture v2',
})
check('v2 계획이 선다(v1 동결)', planV2.ok, planV2.problems.join(' / '))
const writtenV2 = writeSupplementSnapshot({ assetText: planV2.assetText, manifestText: planV2.manifestText, generation: 2 })
check('v2가 정본 경로에 기록된다', writtenV2.ok)
const saV2 = stableAssignment({ repoRoot })
check('배정 정본이 v1 10 + v2 20 동결 묶음을 읽는다', saV2.supplementByCode.size === V1_CODES.length + V2_CODES.length, String(saV2.supplementByCode.size))
check('🔴 v2 후에도 base30과 v1 10명 배정은 한 글자도 바뀌지 않는다',
  [...BASE_CODES, ...V1_CODES].every((code) => JSON.stringify(saV2.byCode.get(code)) === JSON.stringify(saV1.byCode.get(code))))
const voiceV2 = authorCodes()
check('🔴 wave7 20명이 글쓴이 후보에 들어온다', V2_CODES.every((code) => voiceV2.has(code)))
const voiceV2Snapshot = new Map(loadVoice().candidates.map((c) => [c.code, c]))
const comment2 = bundlesForPersonas({ repoRoot, personaCodes: PRODUCTION_PERSONA_CODES })
check('🔴 production 60명 댓글 묶음이 모두 선다', PRODUCTION_PERSONA_CODES.every((code) => comment2.byCode.has(code)))
const outside = bundlesForPersonas({ repoRoot, personaCodes: ['P64', 'P65', 'P66'] })
check('🔴 정본 밖 코드는 댓글 묶음을 받지 않는다', outside.byCode.size === 0 && outside.blocks.some((b) => b.includes('production 정본 universe 밖')))

console.log('\n⑤ 손상 v2 — base30만 유지 · v1로 조용히 후퇴 금지')
writeFileSync(supplementPaths(2).corpus, '{"broken":', { mode: 0o600 })
const voice2 = loadVoice()
check('🔴 손상 v2여도 base30 글쓴이·말투는 그대로다', voice2.blockAllCode === null
  && voice2.candidates.length === voice0.candidates.length
  && voice2.candidates.every((c) => before.get(c.code) === JSON.stringify(c)))
const brokenV2 = stableAssignment({ repoRoot })
check('🔴 손상 v2는 v1로 후퇴하지 않고 신규 30명을 모두 막는다',
  [...V1_CODES, ...V2_CODES].every((code) => !brokenV2.byCode.has(code)))
check('손상 사유를 숨기지 않는다', brokenV2.blocks.some((b) => b.includes('보충 말투 스냅샷')))

console.log('\n⑥ v3 스냅샷 — v2 동결 · 다음 cohort 묶음 · 기존 60 배정 불변 · 투입 전 기준선')
writeFileSync(supplementPaths(2).corpus, planV2.assetText, { mode: 0o600 })
check('준비 — 다음 cohort fixture 를 읽는다', D50_FIXTURE.ok && V3_CODES.length > 0, D50_FIXTURE.ok ? '' : D50_FIXTURE.problems.join(' / '))
const restoredV2 = stableAssignment({ repoRoot })
check('v2 복구 뒤 배정이 ④ 와 같다', PRODUCTION_PERSONA_CODES.every((code) => JSON.stringify(restoredV2.byCode.get(code)) === JSON.stringify(saV2.byCode.get(code))))
const v2Frozen = (saV2.supplementByCode.size > 0 ? [...saV2.supplementByCode.values()] : [])
const planV3 = planSupplementSnapshot({
  canonRows: canon.rows, extraRows: mixedRowsOf('v3', V3_CODES.length), baseCodes: BASE_CODES, newCodes: V3_CODES,
  frozenBundles: v2Frozen,
  baseSourceDigest: sourceDigest, saltId: 'e'.repeat(12), generatedAt: '2026-11-23T00:00:00.000Z', reason: 'fixture v3',
})
check('v3 계획이 선다(v2 동결 30 + 다음 cohort)', planV3.ok && planV3.asset.bundles.length === V1_CODES.length + V2_CODES.length + V3_CODES.length,
  planV3.problems.join(' / '))
const baselineBeforeV3 = preInsertVoiceBaseline({ repoRoot, cohortCodes: V3_CODES })
check('🔴 v3 기록 전 다음 cohort 기준선 = v2', baselineBeforeV3.ok && baselineBeforeV3.generation === 2)
const writtenV3 = writeSupplementSnapshot({ assetText: planV3.assetText, manifestText: planV3.manifestText, generation: 3 })
check('v3가 정본 경로에 기록된다', writtenV3.ok)
const saV3 = stableAssignment({ repoRoot })
check('배정 정본이 v3 동결 묶음 전부를 읽는다', saV3.supplementByCode.size === V1_CODES.length + V2_CODES.length + V3_CODES.length,
  String(saV3.supplementByCode.size))
check('🔴 v3 후에도 production 60명 배정은 한 글자도 바뀌지 않는다',
  PRODUCTION_PERSONA_CODES.every((code) => JSON.stringify(saV3.byCode.get(code)) === JSON.stringify(saV2.byCode.get(code))))
const afterV3Authors = new Map(loadVoice().candidates.map((c) => [c.code, JSON.stringify(c)]))
const authorDrift = [...afterV3Authors.entries()].filter(([code, value]) => JSON.stringify(voiceV2Snapshot.get(code)) !== value)
check('🔴 v3 후에도 production 글쓴이·말투가 그대로다', authorDrift.length === 0 && afterV3Authors.size === voiceV2Snapshot.size,
  authorDrift.slice(0, 1).map(([code]) => `${code} 글쓴이 입력이 v2 때와 다르다`).join(''))
const notYet = bundlesForPersonas({ repoRoot, personaCodes: V3_CODES })
check('🔴 등록 전 다음 cohort 코드는 v3에 묶음이 있어도 댓글 묶음을 받지 않는다',
  notYet.byCode.size === 0 && notYet.blocks.some((b) => b.includes('production 정본 universe 밖')))
const baselineD50 = preInsertVoiceBaseline({ repoRoot, cohortCodes: V3_CODES })
const baselineWave7 = preInsertVoiceBaseline({ repoRoot, cohortCodes: V2_CODES })
const baselineWave6 = preInsertVoiceBaseline({ repoRoot, cohortCodes: V1_CODES })
check('🔴 투입 전 기준선은 cohort 코드가 없는 가장 최근 세대다 — 다음 cohort v2 · wave7 v1',
  baselineD50.ok && baselineD50.generation === 2 && baselineWave7.ok && baselineWave7.generation === 1)
check('🔴 기준선은 자기 cohort 를 담을 수 없다 — v1 에도 있는 wave6 은 기준선 없음',
  !baselineWave6.ok && baselineWave6.code === 'VOICE_BASELINE_MISSING')
check('🔴 v2 기준선 배정 = v3 기록 전 활성 배정(기존 60)',
  baselineD50.ok && PRODUCTION_PERSONA_CODES.every((code) => JSON.stringify(baselineD50.assignment.byCode.get(code)) === JSON.stringify(saV2.byCode.get(code))))
writeFileSync(supplementPaths(3).corpus, '{"broken":', { mode: 0o600 })
const brokenV3 = stableAssignment({ repoRoot })
check('🔴 손상 v3는 v2로 후퇴하지 않고 보충 Persona 를 모두 막는다',
  [...V1_CODES, ...V2_CODES].every((code) => !brokenV3.byCode.has(code)) && brokenV3.blocks.some((b) => b.includes('보충 말투 스냅샷')))
const baselineBroken = preInsertVoiceBaseline({ repoRoot, cohortCodes: V3_CODES })
check('🔴 깨진 세대를 건너뛰어 기준선을 고르지 않는다', !baselineBroken.ok && baselineBroken.code === 'VOICE_BASELINE_INVALID')
writeFileSync(supplementPaths(3).corpus, planV3.assetText, { mode: 0o600 })

console.log('\n⑦ 글 생성 경로가 배정을 따로 계산하지 않는다')
const runtime = readFileSync(join(repoRoot, 'scripts/lib/voice-runtime.mts'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
check('🔴 voice-runtime 이 stableAssignment 를 쓰고 planBundles 를 직접 부르지 않는다',
  /stableAssignment\(\{ repoRoot/.test(runtime) && !/planBundles\(/.test(runtime))

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} 통과 · ${fail} 실패 — 임시 HOME · DB 0 · provider 0`)
if (fail > 0) process.exit(1)

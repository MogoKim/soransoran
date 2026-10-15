#!/usr/bin/env tsx
/**
 * 🔴 **D20 말투 묶음 소비자 검사** (2026-10-15) — 임시 HOME · 합성 정본 자산 · DB 0 · 네트워크 0 · provider 0
 *
 *   npm run persona:voice-consumer-check
 *
 * `persona:reference-supplement-check` 는 묶음 자체(동결 · 덮어쓰기 금지 · 기존 30 불변)를 본다.
 * 이 검사는 **그 묶음을 읽는 자리**를 본다 — 글 생성(`loadVoice`)과 댓글(`bundlesForPersonas`)이 같은 배정 정본
 * (`stableAssignment`)을 쓰는가.
 *   ① 오늘(스냅샷 없음) 글 생성 말투는 앞판(`planBundles(정본, PRODUCTION)`)과 바이트까지 같다
 *   ② 글 생성 표본과 댓글 묶음이 같은 Persona 에 같은 말투를 준다 — Persona 정체성은 한 벌
 *   ③ 승격 전 유효 스냅샷이 생겨도 기존 30명 배정은 그대로 · 정본 밖 코드(P34~)는 글쓴이 · 댓글러가 되지 않는다
 *   ④ 손상 스냅샷은 기존 30명 생성을 멈추지 않는다(새 코드만 fail-closed)
 *   ⑤ 글 생성 경로가 배정을 따로 계산하지 않는다(정적)
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const home = mkdtempSync(join(tmpdir(), 'persona-voice-consumer-'))
process.env.HOME = home
const repoRoot = process.cwd()

const { REFERENCE_DIR, REFERENCE_CORPUS_FILE, REFERENCE_MANIFEST_FILE, ASSET_VERSION } = await import('../src/lib/persona-reference-asset')
const { PRODUCTION_PERSONA_CODES } = await import('../src/lib/persona-cohort')
const { SUPPLEMENT_CORPUS_FILE } = await import('../src/lib/persona-reference-supplement')
const { loadCanonAsset, planBundles, bundlesForPersonas, stableAssignment } = await import('./lib/persona-reference-store.mjs')
const { loadVoice, digest16 } = await import('./lib/voice-runtime.mjs')
const { planSupplementSnapshot } = await import('./lib/persona-reference-supplement-plan.mjs')
const { writeSupplementSnapshot } = await import('./lib/persona-reference-supplement-store.mjs')
const { VOICE_SAMPLE_MAX } = await import('../src/lib/content-core/voice-evidence')

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else {
    fail += 1
    console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`)
  }
}

/** 🔴 합성 말투 — 실제 회원 · 외부 원문이 아니다. 화자 id 는 정본 모양(12 hex)만 맞춘다 */
const speakerId = (prefix: string, n: number): string => createHash('sha256').update(`${prefix}${n}`).digest('hex').slice(0, 12)
const rowsOf = (prefix: string, speakers: number) => Array.from({ length: speakers }, (_, s) =>
  Array.from({ length: 3 }, (_, i) => ({ speakerId: speakerId(prefix, s), text: `${prefix} 의견 ${s}-${i} 정말 그렇네요 반갑습니다` }))).flat()

// ── 합성 정본 자산 (정본 화자 32 — 운영 배정 30 · 남음 2 와 같은 모양) ──
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
/** 🔴 생성 경로가 프롬프트에 싣는 말투 지문 — `loadVoice` 와 같은 식(묶음 전체 본문) */
const bundleDigestOf = (b: { comments: readonly { text: string }[] } | undefined): string => digest16(textsOf(b).join('\u0000'))

// ─────────────────────────────────────────────────────────
console.log('\n① 오늘(스냅샷 없음) — 글 생성 말투는 앞판과 바이트까지 같다')
// ─────────────────────────────────────────────────────────
const legacy = new Map(planBundles({ rows: canon.rows, personaCodes: PRODUCTION_PERSONA_CODES }).bundles.map((b) => [b.personaCode, b]))
const voice0 = loadVoice()
check('글 생성이 막히지 않는다', voice0.blockAllCode === null, String(voice0.blockReason))
const expected0 = [...legacy.keys()].filter((code) => voice0.candidates.some((c) => c.code === code))
check('글쓴이 후보 = 말투 · 나이대가 선 production Persona 전원', voice0.candidates.length > 0 && voice0.candidates.length === expected0.length,
  `${voice0.candidates.length}/${expected0.length}`)
check('🔴 후보마다 말투 지문 · 표본이 앞판 계산과 같다', voice0.candidates.every((c) =>
  c.bundleDigest === bundleDigestOf(legacy.get(c.code))
    && JSON.stringify(c.samples) === JSON.stringify(textsOf(legacy.get(c.code)).slice(0, VOICE_SAMPLE_MAX))))

// ─────────────────────────────────────────────────────────
console.log('\n② 글 생성과 댓글이 같은 Persona 에 같은 말투를 준다')
// ─────────────────────────────────────────────────────────
const comment0 = bundlesForPersonas({ repoRoot, personaCodes: PRODUCTION_PERSONA_CODES })
check('🔴 글 생성 말투 지문 = 댓글 묶음 지문(같은 코드)', voice0.candidates.every((c) => c.bundleDigest === bundleDigestOf(comment0.byCode.get(c.code))))
check('댓글 묶음이 production 전원에 선다', PRODUCTION_PERSONA_CODES.every((code) => comment0.byCode.has(code)))

// ─────────────────────────────────────────────────────────
console.log('\n③ 승격 전 유효 스냅샷 — 기존 30명 그대로 · 정본 밖 코드는 글쓴이 · 댓글러가 아니다')
// ─────────────────────────────────────────────────────────
const newCodes = ['P34', 'P35', 'P36']
const plan = planSupplementSnapshot({
  canonRows: canon.rows, extraRows: rowsOf('ex', 3), baseCodes: PRODUCTION_PERSONA_CODES, newCodes,
  baseSourceDigest: sourceDigest, saltId: 'c'.repeat(12), generatedAt: '2026-10-15T00:00:00.000Z', reason: 'fixture',
})
check('합성 스냅샷 계획이 선다(기존 배정 변동 0)', plan.ok, plan.problems.join(' / '))
const written = writeSupplementSnapshot({ assetText: plan.assetText, manifestText: plan.manifestText })
check('스냅샷이 정본 경로에 기록된다', written.ok)
const sa = stableAssignment({ repoRoot })
check('배정 정본이 스냅샷을 읽는다(동결 묶음 3)', sa.supplementByCode.size === 3, String(sa.supplementByCode.size))
const voice1 = authorCodes()
const before = new Map(voice0.candidates.map((c) => [c.code, JSON.stringify(c)]))
check('🔴 스냅샷이 생겨도 기존 글쓴이 후보 · 말투가 한 글자도 바뀌지 않는다',
  loadVoice().candidates.length === voice0.candidates.length
    && loadVoice().candidates.every((c) => before.get(c.code) === JSON.stringify(c)))
check('🔴 정본 밖 코드(P34~)는 글쓴이 후보가 아니다', newCodes.every((code) => !voice1.has(code)))
const comment1 = bundlesForPersonas({ repoRoot, personaCodes: newCodes })
check('🔴 정본 밖 코드는 댓글 묶음도 받지 않는다', comment1.byCode.size === 0 && comment1.blocks.some((b) => b.includes('production 정본 universe 밖')))

// ─────────────────────────────────────────────────────────
console.log('\n④ 손상 스냅샷 — 기존 30명 생성은 멈추지 않는다')
// ─────────────────────────────────────────────────────────
writeFileSync(SUPPLEMENT_CORPUS_FILE, '{"broken":', { mode: 0o600 })
const voice2 = loadVoice()
check('🔴 손상 스냅샷이어도 기존 글쓴이 후보 · 말투 그대로', voice2.blockAllCode === null
  && voice2.candidates.length === voice0.candidates.length && voice2.candidates.every((c) => before.get(c.code) === JSON.stringify(c)))
check('손상은 숨기지 않는다(배정 정본이 사유를 남긴다)', stableAssignment({ repoRoot }).blocks.some((b) => b.includes('보충 말투 스냅샷')))

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 글 생성 경로가 배정을 따로 계산하지 않는다')
// ─────────────────────────────────────────────────────────
const runtime = readFileSync(join(repoRoot, 'scripts/lib/voice-runtime.mts'), 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
check('🔴 voice-runtime 이 stableAssignment 를 쓰고 planBundles 를 직접 부르지 않는다',
  /stableAssignment\(\{ repoRoot/.test(runtime) && !/planBundles\(/.test(runtime))

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} 통과 · ${fail} 실패 — 임시 HOME · DB 0 · provider 0`)
if (fail > 0) process.exit(1)

#!/usr/bin/env tsx
/**
 * 🔴 새 묶음 voiceBand 상한 — 말투 배정(`planAppendOnlyBundles` ③′)이 판정과 **같은 식**으로 고르는가 (2026-11-23 · wave8)
 *
 *   npm run persona:voice-band-cap-check
 *
 * 🔴 합성 문장만 쓴다(실제 말뭉치 · 근거 0) · 임시 HOME · DB 0 · provider 0 · 네트워크 0
 *
 *   ⓪ 같은 정의 — 밴드 · 상한 · 문체 거리 · seed 공유를 판정 쪽에서 가져온다(복제 0) · 합성 문체가 뜻한 대로 잰다
 *   ① 상위 순위가 한 밴드로 몰리면 상한까지만 그 밴드 — wave8 모양(보통 33/43 → 30) · 상한 안이면 바이트 그대로
 *   ② 교체 후보가 판정에 걸리면 건너뛴다 — 운영 묶음과 가까움 · 뒤 자리와 가까움 · seed 공유 → 통과하는 다음 순위
 *   ③ 기존 묶음 불변 — 운영 · 정본에서 받은 새 자리 · 동결 세대 · 기록 뒤 운영 60명 배정(`stableAssignment`)
 *   ④ 바꿀 화자가 모자라면 — 빈 자리 없이 원래 묶음을 두고, 판정과 같은 코드(BATCH_MONOCULTURE)로 기록을 막는다
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import type { AutogenBlockCode, AutogenCandidate, Cadence } from '../src/lib/persona-autogen'
import type { VoiceReferenceBundle } from '../src/lib/persona-voice-reference'
import type { LocalComment } from './lib/persona-reference-store.mjs'

// 🔴 모듈을 읽기 전에 HOME 을 고정한다 — 정본 자산 경로(REFERENCE_DIR)가 import 시점에 정해진다
const home = mkdtempSync(join(tmpdir(), 'persona-voice-band-cap-'))
process.env.HOME = home
const repoRoot = process.cwd()

const { REFERENCE_DIR, REFERENCE_CORPUS_FILE, REFERENCE_MANIFEST_FILE, ASSET_VERSION } = await import('../src/lib/persona-reference-asset')
const { COHORTS, PRODUCTION_PERSONA_CODES } = await import('../src/lib/persona-cohort')
const { styleOf } = await import('../src/lib/persona-voice-reference')
const { voiceBandOfBundle, voiceCoreFromBundle } = await import('../src/lib/persona-autogen')
const { readLengthBand } = await import('../src/lib/original-post-persona-match')
const { BATCH_MIN_SIZE, BATCH_SHARE_MAX, diversitySubjectOf, judgePopulationDiversity } = await import('../src/lib/persona-expansion')
const { parsePoolDoc } = await import('../src/lib/persona-pool-card')
const {
  carriesExperience, loadCanonAsset, planAppendOnlyBundles, planBundles, referenceSeedShareCount, stableAssignment,
} = await import('./lib/persona-reference-store.mjs')
const { planSupplementSnapshot } = await import('./lib/persona-reference-supplement-plan.mjs')
const { assignmentDigest, writeSupplementSnapshot } = await import('./lib/persona-reference-supplement-store.mjs')
const { judgeAutogenBatch, voicePoolFor } = await import('./lib/persona-autogen.mjs')
const { judgeExpansionBatch, loadExpansionFixture } = await import('./lib/persona-expansion-gate.mjs')
const { PERSONA_POOL_DOC } = await import('./lib/voice-runtime.mjs')

let pass = 0
let fail = 0
const check = (name: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  🔴 FAIL ${name}${detail === '' ? '' : ` — ${detail}`}`) }
}
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

// ─────────────────────────────────────────────────────────
// 합성 문체 — 🔴 말버릇 좌표를 정확히 정해 문장을 만든다(내용은 뜻 없는 맞장구뿐)
// ─────────────────────────────────────────────────────────
type Band = '짧게' | '보통' | '길게'
/** len 글자 수 · j 자모 웃음 수 · k 꾸밈 수 · q 물음표 · y 요 끝 — `styleOf` 의 축 그대로 */
type Style = { len: number; j: number; k: number; q: boolean; y: boolean }
/**
 * 🔴 밴드마다 말버릇 조합을 나눈다 — 밴드가 다르면 조합도 달라 문체 거리가 0.04 이상 떨어진다.
 *    같은 조합은 길이가 20자 이상 떨어진다(거리 0.0167). 운영 기준(0.01)은 아래 PAIR 한 쌍이 정한다 — 나머지는 전부 그보다 멀다.
 */
const LEVELS: Record<Band, readonly number[]> = { 짧게: [24], 보통: [26, 46, 66], 길게: [80, 100, 120, 140, 160, 180, 200] }
const grid = (q: boolean, ys: readonly boolean[]): Omit<Style, 'len'>[] =>
  ys.flatMap((y) => [0, 1, 2, 3, 4].flatMap((j) => [0, 1, 2, 3].map((k) => ({ j, k, q, y }))))
const COMBOS: Record<Band, readonly Omit<Style, 'len'>[]> = { 짧게: grid(true, [true, false]), 보통: grid(false, [true]), 길게: grid(false, [false]) }
/** 한 세계 안에서 겹치지 않는 문체를 차례로 준다 */
const allocator = (): ((band: Band) => Style) => {
  const used: Record<Band, number> = { 짧게: 0, 보통: 0, 길게: 0 }
  return (band) => {
    const n = used[band]
    used[band] = n + 1
    const len = LEVELS[band][Math.floor(n / COMBOS[band].length)]
    if (len === undefined) throw new Error(`합성 ${band} 문체가 모자란다 (${n})`)
    return { ...COMBOS[band][n % COMBOS[band].length]!, len }
  }
}
/** 🔴 운영 기준 쌍 — 서로 0.01 떨어진 운영 묶음 둘(물음표 + 긴 길이 — 어느 밴드 조합과도 멀다) */
const PAIR_A: Style = { len: 180, j: 0, k: 0, q: true, y: true }
const PAIR_B: Style = { ...PAIR_A, len: 192 }
/** 🔴 반례용 — 같은 말버릇 · 길이만 조금 다른 문체(거리 < 운영 기준) */
const near = (s: Style, dLen: number): Style => ({ ...s, len: s.len + dLen })

const textOf = (s: Style, tag: string): string => {
  const tail = `${'ㅋ'.repeat(s.j)}${'♡'.repeat(s.k)} 그렇네${s.y ? '요' : ''}${s.q ? '?' : '.'}`
  const room = s.len - tag.length - [...tail].length
  if (room < 1) throw new Error(`합성 문장 ${tag} — 길이 ${s.len} 이 너무 짧다`)
  return `${tag}${` ${'정말 '.repeat(Math.ceil(room / 3))}`.slice(0, room)}${tail}`
}
/** `tag` 는 문장 머리 — 화자 id 가 정본 자산 모양(12자 hex)이라 길 때만 따로 준다 */
type Speaker = { id: string; tag?: string; style: Style; shared?: string }
const rowsOf = (sp: Speaker): LocalComment[] => {
  const texts = [0, 1, 2].map((i) => textOf(sp.style, `${sp.tag ?? sp.id}-${i}`))
  // 🔴 seed 공유 반례 — 다른 화자의 댓글 하나를 같이 가진다
  if (sp.shared !== undefined) texts[0] = sp.shared
  return texts.map((text) => ({ speakerId: sp.id, text }))
}
const rowsAll = (sps: readonly Speaker[]): LocalComment[] => sps.flatMap(rowsOf)
const speakersOf = (prefix: string, bands: readonly Band[], next: (b: Band) => Style): Speaker[] =>
  bands.map((band, i) => ({ id: `${prefix}${String(i).padStart(3, '0')}`, style: next(band) }))

type Plan = ReturnType<typeof planAppendOnlyBundles>
const bandOf = (b: VoiceReferenceBundle | undefined): string => (b === undefined ? '없음' : voiceBandOfBundle(b) ?? '없음')
const countBands = (byCode: ReadonlyMap<string, VoiceReferenceBundle>, codes: readonly string[]): Record<string, number> =>
  codes.reduce((m: Record<string, number>, c) => { const k = bandOf(byCode.get(c)); m[k] = (m[k] ?? 0) + 1; return m }, {})
const texts = (b: VoiceReferenceBundle | undefined): string[] => (b?.comments ?? []).map((c) => c.text)
/** ③ 만 쓰던 옛 배정 — 상위 N 을 코드순 자리에 그대로 */
const legacyOf = (extraRows: readonly LocalComment[], codes: readonly string[]): Map<string, VoiceReferenceBundle> =>
  new Map(planBundles({ rows: extraRows, personaCodes: codes }).bundles.map((b) => [b.personaCode, b]))

// ── 판정 재료 — 승인 d50 fixture 의 생활사 · creative(이름 · 원문 아님) ──
const D50 = loadExpansionFixture(repoRoot, 'scripts/__fixtures__/persona-expansion-d50.json')
if (!D50.ok) throw new Error(`d50 fixture: ${D50.problems.join(' / ')}`)
const FX = D50.fixture
const D50_CODES = FX.candidates.map((c) => c.code)
const fxOf = (code: string) => FX.candidates.find((c) => c.code === code)!
const CAD: Cadence = { dailyCap: 3, weeklyCap: 12, silenceRate: 0.3, activityRhythm: { activeHours: [[10, 13], [21, 23]], burstiness: 0.3, weekdayBias: 0.5 } }
const pool = parsePoolDoc(readFileSync(PERSONA_POOL_DOC, 'utf-8'))
const PRIOR_CODES = PRODUCTION_PERSONA_CODES.filter((c) => !D50_CODES.includes(c))

/** 🔴 판정 그대로(`judgeAutogenBatch` ③) — 운영 묶음 + 새 자리에서 VOICE_TOO_CLOSE · VOICE_SPEAKER_DUPLICATE 가 나는 코드 */
const voiceVerdict = (byCode: ReadonlyMap<string, VoiceReferenceBundle>, codes: readonly string[], production: readonly VoiceReferenceBundle[]) => {
  const all = new Map<string, VoiceReferenceBundle>([
    ...production.map((b) => [b.personaCode, b] as const), ...codes.map((c) => [c, { ...byCode.get(c)!, personaCode: c }] as const),
  ])
  const cands: AutogenCandidate[] = codes.map((code) => {
    const f = fxOf(code)
    return {
      code, life: f.life, creative: f.creative,
      voice: { bundle: all.get(code)!, seedShareCount: referenceSeedShareCount(all, code) },
      cadence: CAD, binding: { accountCount: 0, providerId: null }, displayName: { name: f.displayName, gate: 'pass' },
    }
  })
  const r = judgeAutogenBatch(cands, { takenCodes: new Set(), existingCards: [], productionBundles: production })
  const blocked = (b: AutogenBlockCode): string[] => r.verdicts.filter((v) => v.blocks.includes(b)).map((v) => v.code)
  return { tooClose: blocked('VOICE_TOO_CLOSE'), dup: blocked('VOICE_SPEAKER_DUPLICATE'), baseline: r.voiceBaseline }
}
/** 🔴 판정 그대로(`judgePopulationDiversity`) — 묶음 voiceBand 단일 품종 문제만 */
const bandProblems = (byCode: ReadonlyMap<string, VoiceReferenceBundle>, codes: readonly string[]) =>
  judgePopulationDiversity({
    existing: [],
    batch: codes.map((c) => diversitySubjectOf(c, fxOf(c).life, fxOf(c).creative, byCode.has(c) ? voiceBandOfBundle(byCode.get(c)!) : null)),
  }).problems.filter((p) => p.rule === 'BATCH_MONOCULTURE' && p.detail.startsWith('묶음 voiceBand='))

// ── 순수 세계 공통 — 운영 3명(정본) · 기준 쌍 + 먼 하나 ──
const pureWorld = () => {
  const next = allocator()
  const canon: Speaker[] = [{ id: 'c000', style: PAIR_A }, { id: 'c001', style: PAIR_B }, { id: 'c002', style: next('길게') }]
  return { next, canon, canonRows: rowsAll(canon), PROD: ['P01', 'P02', 'P03'] as const }
}
const operatingOf = (plan: Plan, codes: readonly string[]): VoiceReferenceBundle[] => codes.map((c) => plan.byCode.get(c)!)

try {
  console.log('\n══ 새 묶음 voiceBand 상한 — 배정이 판정과 같은 식으로 고른다 ══\n')

  // ─────────────────────────────────────────────────────────
  console.log('⓪ 같은 정의 · 합성 문체')
  // ─────────────────────────────────────────────────────────
  const strip = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const storeSrc = strip(readFileSync('scripts/lib/persona-reference-store.mts', 'utf-8'))
  const capSrc = storeSrc.slice(storeSrc.indexOf('function capNewVoiceBands'))
  check('🔴 배정은 판정의 정의를 가져온다 — 상한 batchMonocultureProblem · 밴드 voiceBandOfBundle · 문체 거리 voiceSeparationBaseline/voiceTooClose · seed referenceSeedShareCount',
    /import \{ batchMonocultureProblem \} from '\.\.\/\.\.\/src\/lib\/persona-expansion'/.test(storeSrc)
    && /import \{ voiceBandOfBundle \} from '\.\.\/\.\.\/src\/lib\/persona-autogen'/.test(storeSrc)
    && /voiceSeparationBaseline, voiceTooClose,/.test(storeSrc)
    && ['batchMonocultureProblem(', 'voiceBandOfBundle(', 'voiceSeparationBaseline(', 'voiceTooClose(', 'referenceSeedShareCount('].every((f) => capSrc.includes(f)))
  check('🔴 배정에 문턱 · 밴드 · 거리 식을 다시 적지 않는다(0.7 · BATCH_SHARE_MAX · readLengthBand · styleDistance · judgeVoiceSeparation 0)',
    !/0\.7\b|BATCH_SHARE_MAX|BATCH_MIN_SIZE|readLengthBand\(|styleDistance\(|judgeVoiceSeparation\(/.test(capSrc))
  const gateSrc = strip(readFileSync('scripts/lib/persona-expansion-gate.mts', 'utf-8'))
  const autogenSrc = strip(readFileSync('scripts/lib/persona-autogen.mts', 'utf-8'))
  const expSrc = strip(readFileSync('src/lib/persona-expansion.ts', 'utf-8'))
  check('🔴 판정도 같은 정의를 쓴다 — 다양성 판정 밴드 · VOICE_TOO_CLOSE · BATCH_MONOCULTURE',
    /voiceBandOfBundle\(v\.bundle\)/.test(gateSrc) && !/readLengthBand\(voiceCoreFromBundle/.test(gateSrc)
    && /voiceSeparationBaseline\(ctx\.productionBundles\)/.test(autogenSrc) && /voiceTooClose\(mine, others, voiceBaseline\)/.test(autogenSrc)
    && /const p = batchMonocultureProblem\(t\)/.test(expSrc))
  check(`문턱은 판정 상수 그대로 — 묶음 ${BATCH_MIN_SIZE}명 이상 · ${BATCH_SHARE_MAX * 100}% 초과`, BATCH_MIN_SIZE === 5 && BATCH_SHARE_MAX === 0.7)
  const probe = allocator()
  const samples: Style[] = [...(['짧게', '보통', '길게'] as const).flatMap((b) => [probe(b), probe(b)]), PAIR_A, PAIR_B, near(PAIR_A, 4)]
  const exact = samples.every((s) => {
    const t = textOf(s, 'x000-0')
    const st = styleOf(t)
    return [...t].length === s.len && st.len === Math.min(1, s.len / 200) && st.question === (s.q ? 1 : 0) && st.jamo === s.j / 4
      && st.deco === s.k / 3 && st.yo === (s.y ? 1 : 0) && st.sentences === 0.25
  })
  check('준비 — 합성 문장의 말버릇 좌표가 뜻한 그대로 잰다(글자 수 · 물음표 · 자모 · 꾸밈 · 요 · 문장 수)', exact)
  check('준비 — 합성 문장은 경험형이 아니다(안전 원문으로 센다)', samples.every((s) => !carriesExperience(textOf(s, 'x000-1'))))
  const one = (s: Style): VoiceReferenceBundle => planBundles({ rows: rowsOf({ id: 'x900', style: s }), personaCodes: ['P99'] }).bundles[0]!
  const edges = ([[25, '짧게'], [26, '보통'], [70, '보통'], [71, '길게']] as const).map(([len, band]) => {
    const b = one({ len, j: 0, k: 0, q: false, y: true })
    return voiceBandOfBundle(b) === band && voiceBandOfBundle(b) === readLengthBand(voiceCoreFromBundle(b).length)
  })
  check('🔴 밴드 경계 25 짧게 · 26 보통 · 70 보통 · 71 길게 = 판정의 readLengthBand(voiceCoreFromBundle)', edges.every(Boolean))

  // ─────────────────────────────────────────────────────────
  console.log('② 교체 후보가 판정에 걸리면 건너뛴다 — 통과하는 다음 순위')
  // ─────────────────────────────────────────────────────────
  {
    const w = pureWorld()
    const NEW = D50_CODES.slice(0, 10)
    // 상위 10 — 보통 9 · 짧게 1 → 상한 7(7/10) 이라 8번째 · 9번째 보통 자리(P71 · P73)가 넘는다
    const top = speakersOf('x', ['보통', '보통', '보통', '보통', '보통', '보통', '보통', '보통', '짧게', '보통'], w.next)
    const s3Text = rowsOf(top[3]!)[1]!.text
    const spares: Speaker[] = [
      { id: 'x010', style: w.next('보통') },                    // 보통 — 상한이 찼다
      { id: 'x011', style: near(w.canon[2]!.style, 4) },          // 길게 — 운영 묶음(P03)과 거의 같은 말투
      { id: 'x012', style: near(top[8]!.style, -2) },             // 짧게 — 뒤 자리(P72)와 거의 같은 말투
      { id: 'x013', style: w.next('길게'), shared: s3Text },      // 길게 — P67 의 댓글 하나를 같이 가진다
      { id: 'x014', style: w.next('길게') },                     // 길게 — 통과
      { id: 'x015', style: w.next('짧게') },                     // 짧게 — 통과
    ]
    const extraRows = rowsAll([...top, ...spares])
    const plan = planAppendOnlyBundles({ canonRows: w.canonRows, extraRows, productionCodes: w.PROD, newCodes: NEW })
    const prod = operatingOf(plan, w.PROD)
    const cap = plan.voiceBandCap
    check('넘는 자리 P71 · P73 만 바꾼다 — P71 보통→길게 · P73 보통→짧게', same(cap.replaced, [
      { code: 'P71', from: '보통', to: '길게' }, { code: 'P73', from: '보통', to: '짧게' },
    ]), JSON.stringify(cap.replaced))
    const bundleOfSpare = (id: string): string[] => rowsOf(spares.find((s) => s.id === id)!).map((r) => r.text).sort()
    check('🔴 바뀐 묶음은 판정을 통과하는 첫 여분이다 — P71 ← x014 · P73 ← x015',
      same([...texts(plan.byCode.get('P71'))].sort(), bundleOfSpare('x014')) && same([...texts(plan.byCode.get('P73'))].sort(), bundleOfSpare('x015')))
    check('🔴 건너뛴 여분 — 문체 거리 2(운영 묶음 · 뒤 자리) · seed 공유 1', same(cap.skipped, { tooClose: 2, seedShared: 1 }), JSON.stringify(cap.skipped))
    check('운영 기준 = 판정의 기준(운영 묶음 최소 분리) · 0.01', cap.baseline !== null && Math.abs(cap.baseline - 0.01) < 1e-9
      && voiceVerdict(plan.byCode, NEW, prod).baseline === cap.baseline, String(cap.baseline))
    const v = voiceVerdict(plan.byCode, NEW, prod)
    check('🔴 판정 그대로 — 교체 뒤 VOICE_TOO_CLOSE 0 · VOICE_SPEAKER_DUPLICATE 0', v.tooClose.length === 0 && v.dup.length === 0, JSON.stringify(v))
    check('교체 뒤 묶음 밴드 보통 7 · 짧게 2 · 길게 1 — 판정 BATCH_MONOCULTURE 0', same(countBands(plan.byCode, NEW), { 보통: 7, 길게: 1, 짧게: 2 })
      && bandProblems(plan.byCode, NEW).length === 0 && cap.problems.length === 0, JSON.stringify(countBands(plan.byCode, NEW)))
    // 반례 — 건너뛴 여분을 그 자리에 앉히면 판정이 막는다(배정이 피한 것이 정확히 판정이 막는 것이다)
    const placed = (id: string): Map<string, VoiceReferenceBundle> => {
      const m = new Map(plan.byCode)
      const b = planBundles({ rows: extraRows.filter((r) => r.speakerId === id), personaCodes: ['P71'] }).bundles[0]!
      m.set('P71', b)
      return m
    }
    const c1 = voiceVerdict(placed('x011'), NEW, prod)
    const c2 = voiceVerdict(placed('x012'), NEW, prod)
    const c3 = voiceVerdict(placed('x013'), NEW, prod)
    check('🔴 반례 — 운영 묶음과 가까운 여분을 P71 에 앉히면 판정이 P71 을 VOICE_TOO_CLOSE 로 막는다', c1.tooClose.includes('P71'), JSON.stringify(c1))
    check('🔴 반례 — 뒤 자리와 가까운 여분을 앉히면 판정이 뒤 자리 P72 를 VOICE_TOO_CLOSE 로 막는다', c2.tooClose.includes('P72'), JSON.stringify(c2))
    check('🔴 반례 — 댓글을 나눠 가진 여분을 앉히면 판정이 P67 · P71 을 VOICE_SPEAKER_DUPLICATE 로 막는다',
      c3.dup.includes('P67') && c3.dup.includes('P71'), JSON.stringify(c3))
    const again = planAppendOnlyBundles({ canonRows: w.canonRows, extraRows, productionCodes: w.PROD, newCodes: NEW })
    check('결정적 — 같은 입력이면 같은 배정 · 같은 보고', same([...again.byCode], [...plan.byCode]) && same(again.voiceBandCap, cap))
    const legacy = legacyOf(extraRows, NEW)
    check('🔴 넘지 않은 8자리는 옛 배정과 바이트까지 같다', NEW.filter((c) => c !== 'P71' && c !== 'P73').every((c) => same(plan.byCode.get(c), legacy.get(c))))
  }

  // ─────────────────────────────────────────────────────────
  console.log('① 상위 순위가 한 밴드로 몰리면 상한까지만 — 상한 안이면 아무것도 바꾸지 않는다')
  // ─────────────────────────────────────────────────────────
  {
    // 상한 안 43 — 보통 18 · 짧게 13 · 길게 12 (wave6 · wave7 처럼 섞인 모양) + 여분 17
    const w = pureWorld()
    const mixed: Band[] = Array.from({ length: 60 }, (_, i) => (['보통', '짧게', '보통', '길게', '길게', '짧게', '보통'] as Band[])[i % 7]!)
    const extraRows = rowsAll(speakersOf('m', mixed, w.next))
    const plan = planAppendOnlyBundles({ canonRows: w.canonRows, extraRows, productionCodes: w.PROD, newCodes: D50_CODES })
    const legacy = legacyOf(extraRows, D50_CODES)
    check('🔴 상한 안 → 교체 0 · 43자리 모두 옛 배정과 바이트까지 같다 · 문체 거리를 재지도 않는다',
      plan.voiceBandCap.replaced.length === 0 && plan.voiceBandCap.baseline === null && plan.voiceBandCap.problems.length === 0
      && D50_CODES.every((c) => same(plan.byCode.get(c), legacy.get(c))), JSON.stringify(countBands(plan.byCode, D50_CODES)))
    // 경계 — 10명 묶음은 7 까지(7/10 = 70% 는 넘지 않는다) · 8 부터 넘는다
    const edge = (n: number): Plan => {
      const ww = pureWorld()
      const bands: Band[] = [...Array<Band>(n).fill('보통'), ...Array<Band>(10 - n).fill('짧게'), '길게', '짧게', '길게']
      return planAppendOnlyBundles({ canonRows: ww.canonRows, extraRows: rowsAll(speakersOf('e', bands, ww.next)), productionCodes: ww.PROD, newCodes: D50_CODES.slice(0, 10) })
    }
    const e7 = edge(7)
    const e8 = edge(8)
    check('🔴 경계 — 보통 7/10 은 판정이 통과시키므로 바꾸지 않는다', e7.voiceBandCap.replaced.length === 0 && bandProblems(e7.byCode, D50_CODES.slice(0, 10)).length === 0)
    check('🔴 경계 — 보통 8/10 은 판정이 막으므로 넘는 한 자리(P71)만 바꾼다', same(e8.voiceBandCap.replaced.map((r) => r.code), ['P71'])
      && countBands(e8.byCode, D50_CODES.slice(0, 10))['보통'] === 7 && bandProblems(e8.byCode, D50_CODES.slice(0, 10)).length === 0,
    JSON.stringify(e8.voiceBandCap.replaced))
    const ws = pureWorld()
    const small = planAppendOnlyBundles({
      canonRows: ws.canonRows, extraRows: rowsAll(speakersOf('s', ['보통', '보통', '보통', '보통', '짧게', '길게'], ws.next)),
      productionCodes: ws.PROD, newCodes: D50_CODES.slice(0, 4),
    })
    check(`작은 묶음(${BATCH_MIN_SIZE}명 미만 — 판정도 보지 않는다) → 교체 0 · 넘침 0`, small.voiceBandCap.replaced.length === 0 && small.voiceBandCap.problems.length === 0)
  }

  // ─────────────────────────────────────────────────────────
  console.log('③ 기존 묶음 불변 — 운영 · 정본 자리 · 동결 세대')
  // ─────────────────────────────────────────────────────────
  {
    // 정본에 운영 3 + 남는 화자 2(보통) → 새 앞 두 자리(P64 · P65)는 정본 묶음. 보충 8자리 중 보통 6 → 합 8/10 → 보충 한 자리만 바뀐다
    const w = pureWorld()
    const canon2 = [...w.canon, { id: 'c003', style: w.next('보통') }, { id: 'c004', style: w.next('보통') }]
    const canonRows = rowsAll(canon2)
    const NEW = D50_CODES.slice(0, 10)
    const extraRows = rowsAll(speakersOf('f', ['보통', '보통', '보통', '보통', '보통', '짧게', '보통', '짧게', '길게', '길게'], w.next))
    const plan = planAppendOnlyBundles({ canonRows, extraRows, productionCodes: w.PROD, newCodes: NEW })
    const base = new Map(planBundles({ rows: canonRows, personaCodes: w.PROD }).bundles.map((b) => [b.personaCode, b]))
    const wide = new Map(planBundles({ rows: canonRows, personaCodes: [...w.PROD, ...NEW] }).bundles.map((b) => [b.personaCode, b]))
    check('🔴 운영 3자리 = 정본만으로 나눈 묶음(바이트) · 운영 배정 변동 0', w.PROD.every((c) => same(plan.byCode.get(c), base.get(c))) && plan.productionDrift.length === 0)
    check('정본에서 받은 새 자리(P64 · P65)는 먼저 세고 바꾸지 않는다(바이트)', same(plan.fromCanon, ['P64', 'P65'])
      && plan.fromCanon.every((c) => same(plan.byCode.get(c), wide.get(c))))
    check('🔴 정본 자리 보통 2 를 세서 보충 쪽 넘는 자리만 바꾼다 — P72 하나 · 묶음 보통 7/10',
      same(plan.voiceBandCap.replaced.map((r) => r.code), ['P72']) && countBands(plan.byCode, NEW)['보통'] === 7 && bandProblems(plan.byCode, NEW).length === 0,
      `${JSON.stringify(plan.voiceBandCap.replaced)} ${JSON.stringify(countBands(plan.byCode, NEW))}`)

    // 동결 세대 — 앞 세대 묶음은 다음 세대 자산에 바이트 그대로 · 기존 배정 digest 그대로
    const w2 = pureWorld()
    const BASE = ['P01', 'P02', 'P03']
    const prevCodes = ['P34', 'P35', 'P36', 'P37', 'P38']
    const prev = planSupplementSnapshot({
      canonRows: w2.canonRows, extraRows: rowsAll(speakersOf('p', ['보통', '짧게', '길게', '보통', '짧게'], w2.next)),
      baseCodes: BASE, newCodes: prevCodes, baseSourceDigest: 'a'.repeat(16), saltId: 'b'.repeat(12), generatedAt: '2026-11-14T00:00:00.000Z', reason: 'synthetic prev',
    })
    const next = planSupplementSnapshot({
      canonRows: w2.canonRows, extraRows: rowsAll(speakersOf('q', ['보통', '보통', '보통', '보통', '보통', '보통', '보통', '보통', '짧게', '보통', '길게', '짧게'], w2.next)),
      baseCodes: BASE, newCodes: NEW, frozenBundles: prev.asset.bundles,
      baseSourceDigest: 'a'.repeat(16), saltId: 'b'.repeat(12), generatedAt: '2026-11-23T00:00:00.000Z', reason: 'synthetic next',
    })
    check('다음 세대 계획이 선다 — 넘는 두 자리를 바꿨다', prev.ok && next.ok && next.voiceBandCap.replaced.length === 2, next.problems.join(' / '))
    check('🔴 동결 세대 묶음은 다음 세대 자산에 바이트 그대로', same(next.asset.bundles.filter((b) => prevCodes.includes(b.personaCode)), prev.asset.bundles))
    check('🔴 기존 배정 digest 그대로 — manifest baseAssignmentDigest = 정본만으로 나눈 운영 배정',
      next.manifest.baseAssignmentDigest === prev.manifest.baseAssignmentDigest
      && next.manifest.baseAssignmentDigest === assignmentDigest(new Map(planBundles({ rows: w2.canonRows, personaCodes: BASE }).bundles.map((b) => [b.personaCode, b])), BASE))
  }

  // ─────────────────────────────────────────────────────────
  console.log('④ 바꿀 화자가 모자라면 — 빈 자리 없이 두고, 판정과 같은 코드로 막는다')
  // ─────────────────────────────────────────────────────────
  {
    const NEW = D50_CODES.slice(0, 10)
    const shortWorld = (extra: (w: ReturnType<typeof pureWorld>) => Speaker[], prodCodes?: readonly string[]) => {
      const w = pureWorld()
      const top = speakersOf('y', Array<Band>(10).fill('보통'), w.next)
      const extraRows = rowsAll([...top, ...extra(w)])
      const productionCodes = prodCodes ?? w.PROD
      const canonRows = prodCodes === undefined ? w.canonRows : rowsAll(w.canon.slice(0, prodCodes.length))
      return {
        extraRows, canonRows, productionCodes,
        plan: planAppendOnlyBundles({ canonRows, extraRows, productionCodes, newCodes: NEW }),
        snapshot: planSupplementSnapshot({
          canonRows, extraRows, baseCodes: productionCodes, newCodes: NEW,
          baseSourceDigest: 'a'.repeat(16), saltId: 'b'.repeat(12), generatedAt: '2026-11-23T00:00:00.000Z', reason: 'synthetic short',
        }),
      }
    }
    const none = shortWorld(() => [])
    const judged = bandProblems(none.plan.byCode, NEW)
    check('🔴 여분 0 → 교체 0 · 10자리 모두 원래 묶음 그대로(빈 자리 0)', none.plan.voiceBandCap.replaced.length === 0
      && NEW.every((c) => same(none.plan.byCode.get(c), legacyOf(none.extraRows, NEW).get(c))))
    check('🔴 남은 넘침은 판정과 같은 코드 · 같은 문장 — BATCH_MONOCULTURE 묶음 voiceBand=보통 10/10 > 70%',
      same(none.plan.voiceBandCap.problems, judged) && same(judged, [{ rule: 'BATCH_MONOCULTURE', detail: '묶음 voiceBand=보통 10/10 > 70%' }]),
      JSON.stringify(none.plan.voiceBandCap.problems))
    check('🔴 기록은 그 코드로 막힌다 — 빈 자리(BUNDLE_MISSING) 없이 BATCH_MONOCULTURE 로 not ok',
      !none.snapshot.ok && none.snapshot.problems.includes('BATCH_MONOCULTURE:묶음 voiceBand=보통 10/10 > 70%')
      && !none.snapshot.problems.some((p) => p.startsWith('BUNDLE_MISSING')), none.snapshot.problems.join(' / '))
    const close = shortWorld((w) => [
      { id: 'y010', style: near(w.canon[2]!.style, 4) }, { id: 'y011', style: near(w.canon[2]!.style, -4) }, { id: 'y012', style: near(w.canon[2]!.style, 8) },
    ])
    check('🔴 여분이 전부 판정에 걸리면 — 건너뛴 3 · 교체 0 · 같은 코드로 막는다', close.plan.voiceBandCap.replaced.length === 0
      && close.plan.voiceBandCap.skipped.tooClose === 3 && !close.snapshot.ok && close.snapshot.problems.some((p) => p.startsWith('BATCH_MONOCULTURE:')),
    JSON.stringify(close.plan.voiceBandCap))
    const partial = shortWorld((w) => [{ id: 'y010', style: w.next('짧게') }])
    check('여분이 1명이면 1자리만 바꾸고 남은 넘침(보통 9/10)을 같은 코드로 돌려준다',
      same(partial.plan.voiceBandCap.replaced.map((r) => r.code), ['P71'])
      && same(partial.plan.voiceBandCap.problems, bandProblems(partial.plan.byCode, NEW))
      && partial.plan.voiceBandCap.problems[0]?.detail === '묶음 voiceBand=보통 9/10 > 70%' && !partial.snapshot.ok,
    JSON.stringify(partial.plan.voiceBandCap))
    const unmeasured = shortWorld((w) => [{ id: 'y010', style: w.next('짧게') }, { id: 'y011', style: w.next('길게') }], ['P01'])
    check('🔴 운영 묶음 1개(문체 거리 기준을 못 잰다) → 통과를 보일 수 없어 바꾸지 않는다 · 같은 코드로 막는다',
      unmeasured.plan.voiceBandCap.baseline === null && unmeasured.plan.voiceBandCap.replaced.length === 0
      && unmeasured.plan.voiceBandCap.problems.length === 1 && !unmeasured.snapshot.ok, JSON.stringify(unmeasured.plan.voiceBandCap))
  }

  // ─────────────────────────────────────────────────────────
  console.log('①·③ wave8 모양 — 임시 HOME · 운영 60(정본 30 + 동결 v1 10 + v2 20) · 측정 = 기록 · 기록 뒤 운영 배정 불변')
  // ─────────────────────────────────────────────────────────
  {
    const next = allocator()
    const BASE_CODES = PRODUCTION_PERSONA_CODES.slice(0, 30)
    const V1 = COHORTS['wave6-d20-canary'].codes
    const V2 = COHORTS['wave7-d30'].codes
    const cycle = (n: number): Band[] => Array.from({ length: n }, (_, i) => (['짧게', '보통', '길게'] as Band[])[i % 3]!)
    // 정본 30 — 기준 쌍(0.01) + 나머지는 긴 말투. 🔴 정본 자산의 화자 id 는 12자 hex 모양이어야 읽힌다
    const canon: Speaker[] = [PAIR_A, PAIR_B, ...Array.from({ length: 28 }, () => next('길게'))]
      .map((style, i) => ({ id: `ca${String(i).padStart(10, '0')}`, tag: `c${String(i).padStart(3, '0')}`, style }))
    const canonRows = rowsAll(canon)
    mkdirSync(REFERENCE_DIR, { recursive: true, mode: 0o700 })
    const corpusRaw = JSON.stringify({ version: ASSET_VERSION, generatedAt: '2026-10-15T00:00:00.000Z', comments: canonRows.map((r) => ({ speakerId: r.speakerId, content: r.text })) })
    writeFileSync(REFERENCE_CORPUS_FILE, corpusRaw, { mode: 0o600 })
    chmodSync(REFERENCE_CORPUS_FILE, 0o600)
    const sourceDigest = createHash('sha256').update(corpusRaw).digest('hex').slice(0, 16)
    writeFileSync(REFERENCE_MANIFEST_FILE, JSON.stringify({ sourceDigest }), { mode: 0o600 })
    chmodSync(REFERENCE_MANIFEST_FILE, 0o600)
    const canonRead = loadCanonAsset()
    check('준비 — 합성 정본 자산이 정본 경로로 읽힌다', canonRead.ok && canonRead.sourceDigest === sourceDigest, canonRead.code)
    const v2Speakers = speakersOf('v2s', cycle(V2.length), next)
    const v1 = planSupplementSnapshot({
      canonRows: canonRead.rows, extraRows: rowsAll(speakersOf('v1s', cycle(V1.length), next)), baseCodes: BASE_CODES, newCodes: V1,
      baseSourceDigest: sourceDigest, saltId: 'c'.repeat(12), generatedAt: '2026-10-15T00:00:00.000Z', reason: 'synthetic v1',
    })
    const v2 = planSupplementSnapshot({
      canonRows: canonRead.rows, extraRows: rowsAll(v2Speakers), baseCodes: BASE_CODES, newCodes: V2, frozenBundles: v1.asset.bundles,
      baseSourceDigest: sourceDigest, saltId: 'd'.repeat(12), generatedAt: '2026-11-14T00:00:00.000Z', reason: 'synthetic v2',
    })
    check('준비 — 동결 v1 · v2 가 선다(섞인 밴드 · 교체 0)', v1.ok && v2.ok && v1.voiceBandCap.replaced.length + v2.voiceBandCap.replaced.length === 0,
      [...v1.problems, ...v2.problems].join(' / '))
    writeSupplementSnapshot({ assetText: v1.assetText, manifestText: v1.manifestText, generation: 1 })
    writeSupplementSnapshot({ assetText: v2.assetText, manifestText: v2.manifestText, generation: 2 })
    const before = stableAssignment({ repoRoot })
    check('준비 — 운영 60명 배정이 정본 + 동결 v2 로 선다', PRIOR_CODES.length === 60 && PRIOR_CODES.every((c) => before.byCode.has(c)), String(before.byCode.size))

    // 보충 v3 — 상위 43 = 보통 33 · 짧게 6 · 길게 4 (wave8 측정 모양) + 여분 17. 여분 두 번째는 동결 v2 묶음(P44)과 거의 같은 말투
    const TOP: Band[] = Array.from({ length: 43 }, (_, i) => ([3, 8, 13, 18, 24, 29].includes(i) ? '짧게' : [6, 16, 27, 36].includes(i) ? '길게' : '보통'))
    const TAIL: Band[] = ['보통', '짧게', '짧게', '보통', '길게', '보통', '짧게', '보통', '길게', '보통', '짧게', '보통', '길게', '보통', '짧게', '보통', '길게']
    const p44Speaker = v2Speakers[0]!
    const tail = speakersOf('x1', TAIL, next).map((s, i) => (i === 1 ? { ...s, style: near(p44Speaker.style, -2) } : s))
    const v3Rows = rowsAll([...speakersOf('x0', TOP, next), ...tail])
    const frozenP44 = v2.asset.bundles.find((b) => b.personaCode === V2[0])!
    check('준비 — 반례 여분이 기댈 동결 묶음은 짧은 말투다(P44)', V2[0] === 'P44' && voiceBandOfBundle(frozenP44) === '짧게')

    const voice = voicePoolFor({ repoRoot, newCodes: D50_CODES, supplementalRows: v3Rows })
    const plan3 = planSupplementSnapshot({
      canonRows: canonRead.rows, extraRows: v3Rows, baseCodes: v2.asset.baseCodes, newCodes: D50_CODES, frozenBundles: v2.asset.bundles,
      baseSourceDigest: sourceDigest, saltId: 'e'.repeat(12), generatedAt: '2026-11-23T00:00:00.000Z', reason: 'synthetic v3',
    })
    const planned = new Map(plan3.asset.bundles.map((b) => [b.personaCode, b]))
    const expected = [{ code: 'P104', from: '보통', to: '짧게' }, { code: 'P105', from: '보통', to: '길게' }, { code: 'P106', from: '보통', to: '짧게' }]
    check('🔴 상위 43 보통 33 → 넘는 자리 P104 · P105 · P106 만 바꾼다(코드순 마지막 보통 3자리)', same(plan3.voiceBandCap.replaced, expected),
      JSON.stringify(plan3.voiceBandCap.replaced))
    check('🔴 교체 뒤 보통 30/43(판정 상한) · 짧게 8 · 길게 5', same(countBands(planned, D50_CODES), { 보통: 30, 짧게: 8, 길게: 5 }), JSON.stringify(countBands(planned, D50_CODES)))
    check('🔴 동결 묶음(P44)과 거의 같은 여분은 건너뛴다 — 문체 거리 1 · 기준 = 운영 60 최소 분리', plan3.voiceBandCap.skipped.tooClose === 1
      && plan3.voiceBandCap.skipped.seedShared === 0 && plan3.voiceBandCap.baseline === voiceVerdict(planned, D50_CODES, voice.productionBundles).baseline,
    JSON.stringify(plan3.voiceBandCap))
    const legacy = legacyOf(v3Rows, D50_CODES)
    check('🔴 나머지 40자리는 옛 배정과 바이트까지 같다', D50_CODES.filter((c) => !expected.some((e) => e.code === c)).every((c) => same(planned.get(c), legacy.get(c))))
    check('🔴 측정(voicePoolFor) = 기록(planSupplementSnapshot) — 43명 묶음 바이트 · 교체 보고가 같다',
      plan3.ok && D50_CODES.every((c) => same(voice.byCode.get(c)?.bundle, planned.get(c))) && same(voice.voiceBandCap, plan3.voiceBandCap),
      plan3.problems.join(' / '))

    // 판정 그대로 — 측정 CLI 와 같은 입력(운영 카드 60 · 운영 묶음 60 · 승인 fixture · 대조 집합 빈 값)
    const prior = new Set(PRIOR_CODES)
    const judge = (byCode: ReadonlyMap<string, VoiceReferenceBundle>) => {
      const all = new Map<string, VoiceReferenceBundle>([...before.byCode, ...D50_CODES.map((c) => [c, { ...byCode.get(c)!, personaCode: c }] as const)])
      return judgeExpansionBatch({
        fixture: FX, existingCards: pool.cards.filter((c) => prior.has(c.code)), productionCodes: PRIOR_CODES,
        takenCodes: new Set(pool.cards.map((c) => c.code).filter((c) => !D50_CODES.includes(c))),
        voiceByCode: new Map(D50_CODES.map((c) => [c, { bundle: all.get(c)!, seedShareCount: referenceSeedShareCount(all, c) }])),
        productionBundles: voice.productionBundles, cadence: CAD, nameSets: { memberNames: [], personaNames: [] },
      })
    }
    const old = judge(legacy)
    const now = judge(planned)
    check('🔴 판정 그대로 — 옛 배정은 BATCH_MONOCULTURE(voiceBand=보통 33/43) 로 막힌다',
      !old.diversity.ok && old.diversity.problems.some((p) => p.rule === 'BATCH_MONOCULTURE' && p.detail === '묶음 voiceBand=보통 33/43 > 70%'),
      old.diversity.problems.map((p) => `${p.rule} ${p.detail}`).join(' / '))
    const voiceReasons = now.candidates.filter((c) => c.reasons.some((r) => r === 'VOICE_TOO_CLOSE' || r === 'VOICE_SPEAKER_DUPLICATE'))
    check('🔴 판정 그대로 — 교체 뒤 집단 다양성 OK · VOICE_TOO_CLOSE · VOICE_SPEAKER_DUPLICATE 0 · 43명 ready',
      now.diversity.ok && voiceReasons.length === 0 && now.candidates.every((c) => c.status === 'ready') && now.ok,
      `${now.diversity.problems.map((p) => `${p.rule} ${p.detail}`).join(' / ')} ${now.candidates.filter((c) => c.status !== 'ready').map((c) => `${c.code}:${c.reasons.join('+')}`).join(' ')}`)
    const swapped = new Map(planned)
    swapped.set('P104', planBundles({ rows: v3Rows.filter((r) => r.speakerId === tail[1]!.id), personaCodes: ['P104'] }).bundles[0]!)
    check('🔴 반례 — 건너뛴 여분을 P104 에 앉히면 판정이 VOICE_TOO_CLOSE 로 막는다(동결 묶음 기준)',
      judge(swapped).candidates.find((c) => c.code === 'P104')?.reasons.includes('VOICE_TOO_CLOSE') === true)

    // 기록 → 운영 60명 배정은 한 바이트도 바뀌지 않는다
    const written = writeSupplementSnapshot({ assetText: plan3.assetText, manifestText: plan3.manifestText, generation: 3 })
    const after = stableAssignment({ repoRoot })
    check('v3 가 정본 경로에 기록된다', written.ok)
    check('🔴 v3 기록 뒤 운영 60명 배정 = 기록 전(바이트)', PRIOR_CODES.every((c) => same(after.byCode.get(c), before.byCode.get(c))))
    check('🔴 v3 자산의 동결 v1 · v2 묶음 = v2 자산(바이트) · 새 43명 = 계획', same(plan3.asset.bundles.slice(0, 30), v2.asset.bundles)
      && D50_CODES.every((c) => same(after.supplementByCode.get(c), planned.get(c))))
  }
} finally {
  rmSync(home, { recursive: true, force: true })
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} 통과 · ${fail} 실패 — 합성 문장 · 임시 HOME · DB 0 · provider 0`)
if (fail > 0) process.exit(1)

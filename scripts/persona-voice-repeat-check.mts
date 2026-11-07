#!/usr/bin/env tsx
/**
 * Gate ⑧ 후보 귀속 판정 검사 (2026-11-07 D20 · COMMENT_MISSING)
 *
 *   npx tsx scripts/persona-voice-repeat-check.mts
 *
 * ① 옛 판정(prior + 후보 최빈 점유율)을 그대로 옮긴 oracle 과의 비교 — 후보가 임계 패턴에 속하면 옛 판정처럼 막는다
 *    (단계는 후보가 속한 패턴의 단계 · 옛 판정의 최고 단계 패턴에 후보가 속하면 단계까지 같다)
 * ② 반례 — 2026-11-07 잠긴 5명 모양(n=4) · n=60 말끝 40% · 섞인 단계(prior 만 regenerate + 후보 review) · 경계(=임계)
 *    · 표본 부족(notRun) · 빈 후보 — 뒤의 둘은 옛 판정 비교 주장에 넣지 않는다(각각 bootstrap · 별도 거절)
 * ③ 후보 자체 위반은 그대로 — seed 공유 · 구조화 나열(TIDY) · 우세 패턴 재사용 · 점유율 악화
 * ④ 고정 잠금(유료 호출 전) — seed 공유 1 통과 · 2·3 잠금 · 모름 잠금
 * ⑤ 시도 기억 — ⑧ 이 막은 실패만 글 × Persona 범위(⑧:notRun 은 아니다) · 다른 글은 막지 않는다 · 파일 모양 v1 그대로
 * ⑦ readiness 관측 — 첫 댓글 가능 수 = 계약 유효 − 고정 잠금 · d20-readiness 가 그 값을 싣는다(controller 입력은 그대로)
 * ⑥ 프롬프트 회피 표지 = Gate 가 막는 패턴(같은 추출 · 같은 임계) · 원인 표식 · 본문 없음
 *
 * 🔴 DB 0 · provider 0 · 파일 0 · 네트워크 0
 */
import { readFileSync } from 'node:fs'

import { checkVoiceFingerprint } from './lib/persona-gate-78.mjs'
import { buildPrompt, extractVoiceMarks } from './lib/persona-prompt'
import { legacyAxisBand, LEGACY_RANK, type LegacyBand } from './lib/persona-voice-legacy-oracle.mjs'
import { DEFAULT_FINGERPRINT_THRESHOLDS as TH } from '../src/lib/persona-fingerprint-thresholds'
import {
  commentCapableOf, countPatterns, dominantRepeatMarks, endingOf, gramsOf, hookOf, judgeRepeatAxes, judgeStaticVoiceCapability,
  parseVoiceCause, patternsOf, REPEAT_AXES, voiceCauseNote, type RepeatAxis,
} from '../src/lib/persona-voice-repeat'
import {
  attemptedComboKeys, isVoiceFailure, parseAttemptJournal, serializeAttemptJournal, voiceFailedPostPersonaKeys, withAttemptStarted,
  type AttemptEntry,
} from '../src/lib/persona-comment-attempt-policy'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  ❌ ${name}${detail === '' ? '' : ` — ${detail}`}`) }
}

type Band = LegacyBand
const RANK = LEGACY_RANK
const legacyAxis = (axis: RepeatAxis, sample: readonly string[]): Band => legacyAxisBand(axis, sample.slice(0, -1), sample[sample.length - 1]!)

/** 후보가 그 축에서 임계를 넘은 패턴(after 표본)에 속하는가 */
function candidateInOver(axis: RepeatAxis, prior: readonly string[], cand: string): boolean {
  const sample = [...prior, cand]
  const after = countPatterns(axis, sample)
  const mine = new Set(patternsOf(axis, cand))
  const review = axis === 'ENDING' ? TH.endingReview : axis === 'HOOK' ? TH.hookReview : TH.ngramReview
  return [...after].some(([p, c]) => mine.has(p) && c / sample.length >= review)
}

// ─────────────────────────────────────────────────────────
// 결정적 난수 — 시드 고정
// ─────────────────────────────────────────────────────────
let seed = 20261107
const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
const HOOKS = ['저는', '오늘', '그냥', '요즘', '아침에', '점심엔', '맞아요', '근데']
const MIDS = ['산책', '김치', '무릎', '비가', '시장', '날씨', '커피', '저도요']
const ENDS = ['좋아요', '같아요', '했어요', '네요', '쉬었죠', '가요']
const utter = (): string => `${pick(HOOKS)} ${pick(MIDS)} ${pick(MIDS)} ${pick(ENDS)}`

// ── 2026-11-07 잠긴 5명 모양(합성 · 실제 본문 아님) — 실측 축과 비율만 같다 ──
const LOCKED: Record<string, { prior: string[]; axis: RepeatAxis }> = {
  // 3-gram 4/4 (실측 P14 · P24)
  P14: { axis: 'NGRAM', prior: ['아침에 저도요 걸었어요', '점심엔 국수 먹고 저도요 쉬었네요', '비가 와서 저도요 집에 있었죠', '주말엔 저도요 시장 가요'] },
  P24: { axis: 'NGRAM', prior: ['커피 한잔 맞는말 이에요', '그 말이 맞는말 같네요', '다들 맞는말 하시네', '역시 맞는말 이지요'] },
  // 시작어절 2/4 (실측 P17 · P26)
  P17: { axis: 'HOOK', prior: ['저는 산책이 좋아요', '저는 오늘 쉬어요', '요즘 무릎이 아파서요', '날이 추워졌네요'] },
  P26: { axis: 'HOOK', prior: ['그냥 웃고 말아요', '그냥 넘기셔도 돼요', '시장 다녀왔어요', '바람이 차네요'] },
  // 말끝 2/4 (실측 P39)
  P39: { axis: 'ENDING', prior: ['오늘 비 오는 것 같아요', '내일은 맑을 것 같아요', '산책 다녀왔어요', '점심은 김밥이에요'] },
}
const CLEAN = '이런 얘기 들으니 마음이 편해지네'
const CLEAN_CHECK = (code: string): string => {
  // 🔴 이 Persona 의 어떤 우세 패턴에도 속하지 않는 후보 — 반례마다 직접 확인한다
  const d = dominantRepeatMarks(LOCKED[code]!.prior)
  const hit = d.endings.includes(endingOf(CLEAN)) || d.hooks.includes(hookOf(CLEAN)) || gramsOf(CLEAN).some((g) => d.grams.includes(g))
  if (hit) throw new Error(`fixture 결함 — CLEAN 이 ${code} 의 우세 패턴을 쓴다`)
  return CLEAN
}

console.log('\n══ Gate ⑧ 후보 귀속 판정 (🔴 DB 0 · provider 0 · 파일 0) ══')

// ─────────────────────────────────────────────────────────
console.log('\n① 옛 판정과의 비교 — 후보가 임계 패턴에 속하면 옛 판정처럼 막는다')
// ─────────────────────────────────────────────────────────
{
  let same = 0
  let memberCases = 0
  let sameBlocking = 0
  let topMember = 0
  let topSame = 0
  let differ = 0
  let differNotBaseline = 0
  let differStricter = 0
  for (let k = 0; k < 4000; k += 1) {
    const n = 4 + Math.floor(rnd() * 20)
    const prior = Array.from({ length: n }, utter)
    const cand = rnd() < 0.5 ? utter() : pick(prior)
    const v = judgeRepeatAxes(prior, cand, TH)
    for (const axis of REPEAT_AXES) {
      const neo = v.axes.find((a) => a.axis === axis)!
      const old = legacyAxis(axis, [...prior, cand])
      if (candidateInOver(axis, prior, cand)) {
        memberCases += 1
        if (neo.band === old) same += 1
        if ((neo.band !== 'pass') === (old !== 'pass')) sameBlocking += 1
        // 옛 판정의 최고 단계를 만든 패턴에 후보가 속하는가
        const sample = [...prior, cand]
        const after = countPatterns(axis, sample)
        const top = Math.max(...after.values())
        const mine = new Set(patternsOf(axis, cand))
        if ([...after].some(([p, c]) => c === top && mine.has(p))) { topMember += 1; if (neo.band === old) topSame += 1 }
      } else if (neo.band !== old) {
        differ += 1
        if (neo.cause !== 'BASELINE_ONLY') differNotBaseline += 1
        if (RANK[neo.band] > RANK[old]) differStricter += 1
      }
    }
  }
  console.log(`     무작위 4000 표본 × 3축 · 후보가 임계 패턴에 속한 판정 ${memberCases}건(단계까지 같음 ${same}) · 소속 밖에서 다른 판정 ${differ}건`)
  check('🔴 🔴 후보가 임계 패턴에 속하면 옛 판정처럼 막는다(막음 여부 완전 동치 · 완화 0)', memberCases > 0 && sameBlocking === memberCases, `${sameBlocking}/${memberCases}`)
  check('🔴 옛 판정의 최고 단계 패턴에 후보가 속하면 단계까지 같다', topMember > 0 && topSame === topMember, `${topSame}/${topMember}`)
  check('🔴 판정이 다른 것은 전부 BASELINE_ONLY(prior 만 넘음)뿐이다', differ > 0 && differNotBaseline === 0, `${differNotBaseline}/${differ}`)
  check('🔴 새 판정이 옛 판정보다 엄격해지는 경우는 없다(같은 임계)', differStricter === 0, String(differStricter))
  // 🔴 임계 상수는 그대로다 — 이 PR 은 임계를 낮추지 않는다
  check('🔴 임계 정본 값 그대로(0.33/0.40 · 0.25/0.35 · 0.67/0.80 · seed 2/3 · 최소 5)',
    TH.endingReview === 0.33 && TH.endingRegen === 0.40 && TH.hookReview === 0.25 && TH.hookRegen === 0.35
    && TH.ngramReview === 0.67 && TH.ngramRegen === 0.80 && TH.seedReuseReview === 2 && TH.seedReuseRegen === 3 && TH.minSamples === 5)
}

// ─────────────────────────────────────────────────────────
console.log('\n② 반례 — 잠긴 5명(n=4) · n=60 · 경계 · 표본 부족 · 빈 후보')
// ─────────────────────────────────────────────────────────
for (const [code, { prior, axis }] of Object.entries(LOCKED)) {
  const clean = CLEAN_CHECK(code)
  const oldClean = legacyAxis(axis, [...prior, clean])
  const v = checkVoiceFingerprint(clean, { priorTexts: prior, seedUseCount: 1 })
  check(`🔴 ${code} (${axis}) — 옛 판정은 깨끗한 후보에도 ${oldClean} · 새 판정은 pass + BASELINE_ONLY`,
    oldClean !== 'pass' && v.status === 'pass' && v.baselineOnly.includes(axis) && v.axes.length === 0, `${v.status} · ${v.detail}`)
  const reuse = axis === 'ENDING' ? '이번에도 그럴 것 같아요' : axis === 'HOOK' ? `${prior[0]!.split(' ')[0]} 이번엔 쉬었네` : `오늘도 ${axis === 'NGRAM' && code === 'P14' ? '저도요' : '맞는말'} 이네`
  const r = checkVoiceFingerprint(reuse, { priorTexts: prior, seedUseCount: 1 })
  check(`🔴 ${code} — 우세 패턴을 다시 쓴 후보는 막는다(CANDIDATE · ${axis})`,
    r.status !== 'pass' && r.status !== 'notRun' && r.axes.includes(axis) && parseVoiceCause(r.detail).candidate.includes(axis), `${r.status} · ${r.detail}`)
}
{
  // n=60 — 말끝 '같아요' 24건(40%) · 나머지는 서로 다른 말끝
  const prior = [
    ...Array.from({ length: 24 }, (_, i) => `날씨 이야기 ${i}번째 그런 것 같아요`),
    ...Array.from({ length: 36 }, (_, i) => `다른 이야기 ${String.fromCharCode(0xAC00 + i * 7)}${String.fromCharCode(0xAC01 + i * 7)}${String.fromCharCode(0xAC02 + i * 7)}`),
  ]
  const clean = '오늘은 그냥 조용히 지냈어'
  const oldClean = legacyAxis('ENDING', [...prior, clean])
  const v = checkVoiceFingerprint(clean, { priorTexts: prior, seedUseCount: 1 })
  check('🔴 n=60 말끝 24/60 — 옛 판정은 안 쓴 후보도 review(24/61=0.393) · 새 판정은 통과(BASELINE_ONLY)',
    oldClean === 'review' && v.status === 'pass' && v.baselineOnly.includes('ENDING'), `${oldClean} → ${v.status} · ${v.detail}`)
  const r = checkVoiceFingerprint('이것도 그런 것 같아요', { priorTexts: prior, seedUseCount: 1 })
  check('🔴 n=60 — 같은 말끝을 다시 쓰면 regenerate(25/61=0.41 · 악화)', r.status === 'regenerate' && r.axes.includes('ENDING'), r.detail)
  // 회복 — 깨끗한 발화가 쌓이면 BASELINE_ONLY 도 사라진다(24/(60+k+1) < 0.33 → k ≥ 13)
  const grown = [...prior, ...Array.from({ length: 13 }, (_, i) => `새 말 ${String.fromCharCode(0xB000 + i * 5)}${String.fromCharCode(0xB001 + i * 5)}${String.fromCharCode(0xB002 + i * 5)}`)]
  const g = checkVoiceFingerprint(clean, { priorTexts: grown, seedUseCount: 1 })
  check('🟢 n=60 회복 — 깨끗한 발화 13건 뒤 말끝 기준선 초과가 사라진다', g.status === 'pass' && !g.baselineOnly.includes('ENDING'), g.detail)
}
{
  // 회복 — 잠긴 5명은 깨끗한 댓글 몇 건으로 정상 판정(기준선 초과 0)에 돌아온다
  const after = (code: string, k: number): RepeatAxis[] => {
    // 🔴 채움 발화끼리도 겹치지 않게 — 시작 · 말끝 · 3글자 조각이 전부 다르다
    const u = (j: number): string => String.fromCharCode(0xC000 + j)
    const prior = [...LOCKED[code]!.prior, ...Array.from({ length: k }, (_, i) => `${u(i * 40)}${u(i * 40 + 1)} ${u(i * 40 + 2)}${u(i * 40 + 3)}${u(i * 40 + 4)}`)]
    return checkVoiceFingerprint(CLEAN, { priorTexts: prior, seedUseCount: 1 }).baselineOnly
  }
  check('🟢 회복 — P14·P24 는 깨끗한 2건 뒤 3-gram 기준선 초과 0', !after('P14', 2).includes('NGRAM') && !after('P24', 2).includes('NGRAM'))
  check('🟢 회복 — P39 는 깨끗한 3건 뒤 말끝 기준선 초과 0', !after('P39', 3).includes('ENDING'))
}
{
  // 🔴 섞인 단계 — 같은 축(말끝)에 prior 만 넘은 regenerate 와 후보가 속한 review 가 함께 있다
  //    prior: 같아요 ×3 · 좋아요 ×1 · 했네요 ×1 · 후보 말끝 좋아요 → 표본 6: 같아요 3/6=0.50(regenerate · 후보 무관) · 좋아요 2/6=0.333(review · 후보)
  const prior = ['가 같아요', '나 같아요', '다 같아요', '라 좋아요', '마 했네요']
  const cand = '바 좋아요'
  const axis = judgeRepeatAxes(prior, cand).axes.find((a) => a.axis === 'ENDING')!
  const g = checkVoiceFingerprint(cand, { priorTexts: prior, seedUseCount: 1 })
  check('🔴 🔴 섞인 단계 — 후보가 속한 패턴 중 가장 높은 단계(review)로 막는다 · prior 만의 regenerate 를 후보에게 지우지 않는다',
    axis.band === 'review' && axis.cause === 'CANDIDATE' && g.status === 'review' && g.axes.includes('ENDING'), `${axis.band} · ${g.status} · ${g.detail}`)
  check('🔴 섞인 단계 — 옛 판정은 regenerate · 둘 다 막는다(막음 여부 동치)', legacyAxisBand('ENDING', prior, cand) === 'regenerate')
  const free = checkVoiceFingerprint('사 그렇구나', { priorTexts: prior, seedUseCount: 1 })
  check('🔴 섞인 단계 — 같은 prior 에서 어느 임계 패턴에도 속하지 않는 후보는 통과(BASELINE_ONLY)',
    free.status === 'pass' && free.baselineOnly.includes('ENDING'), free.detail)
}
{
  // 경계 — 정확히 임계와 같으면 막는다(≥) · 표본 부족은 notRun
  const prior = ['같은 말로 끝나요 같아요', '오늘도 같아요', '하나 둘 셋', '넷 다섯 여섯'] // 말끝 '같아요' 2/4
  const r = checkVoiceFingerprint('셋째도 같아요', { priorTexts: prior, seedUseCount: 1 })
  check('🔴 경계 — 후보 포함 3/5=0.60 ≥ 0.40 은 regenerate', r.status === 'regenerate' && r.axes.includes('ENDING'))
  const twoOfFive = ['a 하나 같아요', 'b 둘 좋아요', 'c 셋 했어요', 'd 넷 쉬었죠']
  const r2 = checkVoiceFingerprint('e 다섯 같아요', { priorTexts: twoOfFive, seedUseCount: 1 })
  check('🔴 경계 — 정확히 2/5 = 0.40(=임계)이면 막는다(≥ · 후보가 그 말끝)', r2.status === 'regenerate' && r2.axes.includes('ENDING'), r2.detail)
  const few = checkVoiceFingerprint('처음 하는 말이에요', { priorTexts: ['하나', '둘', '셋'], seedUseCount: 1 })
  check('🔴 표본 부족(후보 포함 4 < 5) — notRun(bootstrap 경로 그대로)', few.status === 'notRun' && few.axes.length === 0, few.detail)
  const empty = checkVoiceFingerprint('   ', { priorTexts: LOCKED.P14!.prior, seedUseCount: 1 })
  check('🔴 빈 후보 — 귀속할 말이 없어 통과로 세지 않는다(regenerate)', empty.status === 'regenerate')
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 후보 자체 위반은 그대로 — seed · TIDY')
// ─────────────────────────────────────────────────────────
{
  const prior = Array.from({ length: 6 }, (_, i) => `서로 ${String.fromCharCode(0xD000 + i * 13)}${String.fromCharCode(0xD001 + i * 13)} 다른 말`)
  const base = checkVoiceFingerprint(CLEAN, { priorTexts: prior, seedUseCount: 1 })
  const s2 = checkVoiceFingerprint(CLEAN, { priorTexts: prior, seedUseCount: 2 })
  const s3 = checkVoiceFingerprint(CLEAN, { priorTexts: prior, seedUseCount: 3 })
  const tidy = checkVoiceFingerprint(CLEAN, { priorTexts: prior, seedUseCount: 1, tidyMarks: true })
  const tidyFew = checkVoiceFingerprint(CLEAN, { priorTexts: ['하나'], seedUseCount: 1, tidyMarks: true })
  check('🟢 깨끗한 후보 · seed 1 — pass', base.status === 'pass' && base.axes.length === 0)
  check('🔴 seed 공유 2 — review · 3 — regenerate (후보 무관 · 그대로)', s2.status === 'review' && s3.status === 'regenerate'
    && s2.axes.includes('SEED_REUSE') && s3.axes.includes('SEED_REUSE'))
  check('🔴 구조화 나열(TIDY) — 표본과 무관하게 regenerate', tidy.status === 'regenerate' && tidy.axes.includes('TIDY')
    && tidyFew.status === 'regenerate')
  check('🔴 detail 에 본문 · 패턴 문자열이 없다(축 이름 · 비율 · 원인만)',
    ![base, s2, tidy, checkVoiceFingerprint(CLEAN, { priorTexts: LOCKED.P14!.prior, seedUseCount: 1 })]
      .some((v) => v.detail.includes('저도요') || v.detail.includes(CLEAN.slice(0, 4))))
}

// ─────────────────────────────────────────────────────────
console.log('\n④ 고정 잠금 — 유료 호출 전')
// ─────────────────────────────────────────────────────────
{
  const st = (n: number | null): string => { const v = judgeStaticVoiceCapability({ seedShare: n }); return v.capable ? 'ok' : v.codes.join(',') }
  check('🔴 seed 공유 1 → 가능 · 2·3 → SEED_REUSE_LOCKED · 모름 → SEED_SHARE_UNKNOWN',
    st(1) === 'ok' && st(2) === 'SEED_REUSE_LOCKED' && st(3) === 'SEED_REUSE_LOCKED' && st(null) === 'SEED_SHARE_UNKNOWN' && st(Number.NaN) === 'SEED_SHARE_UNKNOWN')
  // 🔴 고정 잠금은 "어떤 후보로도" 막히는 것과 같다 — 반례로 확인
  const prior = Array.from({ length: 6 }, (_, i) => `서로 ${String.fromCharCode(0xD000 + i * 13)} 다른 말`)
  check('🔴 고정 잠금 ⇔ 어떤 후보도 ⑧ 통과 불가 (seed 2·3 에서 무작위 후보 200개 전부 막힘 · seed 1 은 통과 후보가 있다)',
    [2, 3].every((n) => Array.from({ length: 200 }, utter).every((c) => checkVoiceFingerprint(c, { priorTexts: prior, seedUseCount: n }).status !== 'pass'))
    && Array.from({ length: 200 }, utter).some((c) => checkVoiceFingerprint(c, { priorTexts: prior, seedUseCount: 1 }).status === 'pass'))
  check('🔴 반복 이력만으로는 고정 잠금이 아니다 — 잠긴 5명 모두 seed 1 이면 가능',
    Object.keys(LOCKED).every(() => judgeStaticVoiceCapability({ seedShare: 1 }).capable))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 시도 기억 — ⑧ 실패는 글 × Persona 범위')
// ─────────────────────────────────────────────────────────
{
  const PUB = Date.parse('2026-11-07T03:10:00.000Z') // 12:10 KST
  const now = PUB + 15 * 60_000
  const e = (postId: string, personaCode: string, reactionRole: string, failedGates: string[]): AttemptEntry => ({
    postId, personaCode, reactionRole, postPublishedAtMs: PUB, attemptedAtMs: now, step: 'ENQUEUE_BLOCKED', failedGates, blockCodes: ['GATE_NOT_FULL_PASS'],
  })
  const entries = [e('postA', 'P14', 'empathy', ['⑧:regenerate']), e('postA', 'P37', 'empathy', ['⑦:regenerate'])]
  const voice = voiceFailedPostPersonaKeys(entries, now)
  check('🔴 ⑧ 실패 → 그 글 × Persona 를 기억한다 · ⑦ 실패는 글 × Persona 로 올리지 않는다',
    voice.has('postA:P14') && !voice.has('postA:P37') && voice.size === 1)
  // 🔴 ⑧:notRun 은 ⑧ 이 막은 것이 아니다 — 표본이 모자란 Persona 가 ② 로 막혀도 그 글의 다른 역할은 남는다
  const cold = [e('postC', 'P40', 'empathy', ['②:regenerate', '⑧:notRun'])]
  check('🔴 🔴 ⑧:notRun + ②:regenerate → 글 × Persona 로 올리지 않는다(다른 역할 허용)',
    !isVoiceFailure(cold[0]!) && voiceFailedPostPersonaKeys(cold, now).size === 0
    && withAttemptStarted(cold, { ...e('postC', 'P40', 'question', []), step: 'STARTED', blockCodes: [] }, now).ok)
  check('🔴 ⑧:review · ⑧:regenerate · ⑧:reject 는 ⑧ 이 막은 것이다',
    ['⑧:review', '⑧:regenerate', '⑧:reject'].every((g) => isVoiceFailure({ failedGates: [g] })) && !isVoiceFailure({ failedGates: ['⑧:notRun', '⑨:notRun'] }))
  const start = (postId: string, personaCode: string, reactionRole: string) =>
    withAttemptStarted(entries, { ...e(postId, personaCode, reactionRole, []), step: 'STARTED', blockCodes: [] }, now)
  check('🔴 🔴 같은 글 · 같은 Persona · 다른 역할 — ⑧ 뒤에는 시작 기록을 거절한다(역할만 바꾼 재호출 0)', !start('postA', 'P14', 'question').ok)
  check('🟢 다른 글의 같은 Persona — 막지 않는다(회복 허용)', start('postB', 'P14', 'empathy').ok)
  check('🟢 ⑦ 실패 Persona 의 다른 역할 — 조합 범위 그대로(다시 보낼 수 있다)', start('postA', 'P37', 'question').ok)
  check('🔴 정확한 조합 재전송은 여전히 거절', !start('postA', 'P37', 'empathy').ok && attemptedComboKeys(entries, now).size === 2)
  const after = now + 60 * 60_000
  check('🟢 60분 window 가 지나면 글 × Persona 기억도 끝난다', voiceFailedPostPersonaKeys(entries, after).size === 0)
  const round = parseAttemptJournal(serializeAttemptJournal(entries))
  check('🔴 파일 모양 v1 그대로 — 새 키 0 · 옛 reader(같은 파서)가 그대로 읽는다(rollback 안전)',
    round.ok && round.journal.version === 1 && Object.keys(round.journal.entries[0]!).length === 8)
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 프롬프트 회피 표지 = Gate 가 막는 패턴 · 원인 표식')
// ─────────────────────────────────────────────────────────
{
  let agree = 0
  let total = 0
  for (let k = 0; k < 1500; k += 1) {
    const prior = Array.from({ length: 4 + Math.floor(rnd() * 12) }, utter)
    const d = dominantRepeatMarks(prior)
    const cand = utter()
    const reusesDominant = d.endings.includes(endingOf(cand)) || d.hooks.includes(hookOf(cand)) || gramsOf(cand).some((g) => d.grams.includes(g))
    const blockedByRepeat = judgeRepeatAxes(prior, cand).axes.some((a) => a.cause === 'CANDIDATE')
    // 🔴 표지는 최대 6개로 자른다 — 잘리지 않은 경우만 정확 동치를 본다
    const truncated = [d.endings, d.hooks, d.grams].some((xs) => xs.length >= 6)
    if (truncated) continue
    total += 1
    if (reusesDominant === blockedByRepeat) agree += 1
  }
  check('🔴 🔴 회피 표지를 하나라도 쓰면 ⑧ 이 막고, 하나도 안 쓰면 반복 축으로는 막지 않는다(정확 동치)', total > 500 && agree === total, `${agree}/${total}`)
  const marks = extractVoiceMarks(LOCKED.P14!.prior)
  check('🔴 프롬프트 표지가 Gate 와 같은 함수에서 온다 — P14 우세 3-gram 이 실린다',
    marks.dominant.grams.includes('저도요') && JSON.stringify(marks.dominant) === JSON.stringify(dominantRepeatMarks(LOCKED.P14!.prior)))
  const plan = buildPrompt({
    persona: { code: 'P14', ageBand: '50대', region: '경기', lifeStage: '갱년기', identity: {}, voiceCore: { ending: '요' },
      voiceVariations: [], noGoTopics: [], noGoExpressions: [], forbiddenReactionRoles: [] },
    post: { title: '산책 이야기', content: '오늘 산책을 다녀왔어요', boardLabel: 'FREE' },
    reactionType: 'empathy', recentMarks: marks, requireReference: false,
  })
  check('🔴 🔴 프롬프트 본문에 우세 3-gram 회피 줄이 실제로 실린다(주입)',
    plan.ok && plan.prompt.systemPrompt.includes('이 글자 묶음은 이번에 쓰지 않습니다') && plan.prompt.systemPrompt.includes('저도요'),
    plan.ok ? '' : JSON.stringify(plan.blocks))
  check('🟢 표본이 모자라면 표지가 비어 있다', JSON.stringify(dominantRepeatMarks(['하나', '둘'])) === JSON.stringify({ endings: [], hooks: [], grams: [] }))
  const v = checkVoiceFingerprint(CLEAN, { priorTexts: LOCKED.P39!.prior, seedUseCount: 1 })
  const note = voiceCauseNote([{ gate: '⑧', detail: v.detail }])
  check('🔴 원인 표식 — BASELINE_ONLY 는 "기준선 초과(후보 무관 · 통과)" 로 · 후보 원인과 섞이지 않는다',
    note.includes('기준선 초과') && !note.includes('후보 원인') && parseVoiceCause(v.detail).baselineOnly.join() === 'ENDING')
  const blocked = checkVoiceFingerprint('이번에도 그럴 것 같아요', { priorTexts: LOCKED.P39!.prior, seedUseCount: 1 })
  check('🔴 원인 표식 — 후보 원인은 "⑧ 후보 원인 ENDING"', voiceCauseNote([{ gate: '⑧', detail: blocked.detail }]).includes('⑧ 후보 원인 ENDING'))
  check('🔴 표식 없는 detail(옛 판 · 다른 관문)은 빈 원인', voiceCauseNote([{ gate: '⑧', detail: '반복 없음 (표본 5)' }, { gate: '②', detail: '[cause=CANDIDATE:HOOK] x' }]) === '')
}

// ─────────────────────────────────────────────────────────
console.log('\n⑦ readiness 관측 — 첫 댓글 가능 수')
// ─────────────────────────────────────────────────────────
{
  const share: Record<string, number | null> = { P01: 1, P02: 2, P03: 3, P04: null, P05: 1 }
  const c = commentCapableOf(Object.keys(share), (code) => share[code] ?? null)
  check('🔴 계약 유효 5 − 고정 잠금 3(공유 2 · 3 · 모름) = 첫 댓글 가능 2',
    c.commentCapable === 2 && c.staticLocked.map((x) => `${x.code}:${x.codes.join(',')}`).join(' ')
      === 'P02:SEED_REUSE_LOCKED P03:SEED_REUSE_LOCKED P04:SEED_SHARE_UNKNOWN')
  const thrown = commentCapableOf(['P09'], () => { throw new Error('자산 읽기 실패') })
  check('🔴 seed 공유 조회가 던지면 모름(고정 잠금)으로 센다', thrown.commentCapable === 0 && thrown.staticLocked[0]?.codes[0] === 'SEED_SHARE_UNKNOWN')
  const readiness = readFileSync('scripts/d20-readiness.mts', 'utf-8')
  const facts = readFileSync('scripts/lib/persona-reserve-facts.mts', 'utf-8')
  const fu = readFileSync('scripts/lib/persona-comment-followup-run.mts', 'utf-8')
  check('🔴 추가 댓글도 seed 공유 수를 못 세면 회차 전체 유료 호출 0(첫 댓글과 같은 정본 · 실제 동작은 followup-db-check ③-b)',
    /for \(const \[code, n\] of seedShareByCode\) if \(n === null\) providerBlockers\.push\(/.test(fu))
  check('🔴 d20-readiness 가 첫 댓글 가능 수 · 고정 잠금을 싣고, controller 입력은 계약 유효 수 그대로다',
    /const cap = await readCommentCapablePersonas\(/.test(readiness) && /commentCapable: cap\.commentCapable, staticLocked: cap\.staticLocked/.test(readiness)
    && /const personas = cap\.contractValid/.test(readiness) && /contractValidPersonas: async \(\) => personas/.test(readiness)
    && /commentCapableOf\(codes, \(code\) => referenceSeedShareCount\(byCode, code\)\)/.test(facts))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑧ 문서 정합 — ⑧ 정본 설명이 현재 계약과 같다')
// ─────────────────────────────────────────────────────────
{
  const doc = readFileSync('docs/operations/2026-08-30-persona-safety-originality-gate-design.md', 'utf-8')
  check('🔴 관문 설계 문서에 옛 seed 설명("최근 N건 내 사용 횟수" · "수치 기본값은 구현 시 결정") 0',
    !doc.includes('같은 seed 의 최근 N건 내 사용 횟수') && !doc.includes('수치 기본값은 **구현 시 결정**') && !doc.includes('`seedReuseRate` 임계는 구현 시 결정'))
  check('🔴 관문 설계 문서의 seed 임계가 정본 상수와 같다(review 2 / regenerate 3)',
    doc.includes(`공유 ${TH.seedReuseReview} → review · 공유 ${TH.seedReuseRegen} → regenerate`))
  check('🔴 관문 설계 문서가 후보 귀속 단계 규칙(후보가 속한 패턴 중 가장 높은 단계)을 말한다',
    doc.includes('막는 단계는 **후보가 속한 임계 패턴 가운데 가장 높은 단계**다'))
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail`)
process.exit(fail === 0 ? 0 : 1)

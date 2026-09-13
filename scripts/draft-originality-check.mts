#!/usr/bin/env tsx
/**
 * 독창성 정본 fixture — 🔴 **흔한 표현은 통과하고 실질 복제는 막힌다**
 *
 * 읽기만 한다. DB · 네트워크 · 파일 쓰기 0.
 *
 * 🔴 이 fixture 가 증명해야 하는 것은 네 가지다.
 *    ① 같은 주제로 쓰면 저절로 겹치는 흔한 한국어 표현이 **통과한다**
 *    ② 원문 문장을 통째로 옮기면 **막힌다**
 *    ③ 띄어쓰기를 흩거나 조각을 이어 붙여 피해 가려 해도 **막힌다**
 *    ④ 옛 6자 기준이 막던 글이 이제 **지나간다** (결함 재주입으로 대조)
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  measureOriginality, judgeCopy, readMeasure, describeOriginality,
  normalizeWords, normalizeChars, coveredRatio,
  COPY_RUN_WORDS, COPY_RUN_CHARS, COVER_PIECE_CHARS, COVER_RATIO,
  COPY_REASON_LABEL, COPY_REASONS,
} from '../src/lib/draft-originality'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}
const copied = (draft: string, source: string): boolean => judgeCopy(measureOriginality(draft, source)).copied

// ─────────────────────────────────────────────────────────
console.log('\n── ① 흔한 한국어 표현은 통과한다 ──\n')
// ─────────────────────────────────────────────────────────

/**
 * 🔴 실측에서 막힌 종류다 (2026-09-11~12).
 *    같은 소재로 글을 쓰면 이 정도는 저절로 겹친다 — 베낀 것이 아니다.
 */
const SOURCE_A = [
  '갱년기 시작되고 나서 잠을 통 못 자요',
  '요즘 너무 힘들어서 병원을 가볼까 하는데 다들 어떻게 하셨는지 궁금하네요',
  '그래서 저는 일단 운동부터 다시 시작해보려고 합니다',
].join('\n')

for (const [label, draft] of [
  ['연결어가 겹친다', '그래서 저는 요즘 아침마다 산책을 나갑니다. 별거 아닌데 기분이 좀 낫더라고요'],
  ['소재어가 겹친다', '갱년기 시작되고 나서 몸이 예전 같지 않네요. 저녁에 스트레칭 하나씩 해보는 중이에요'],
  ['흔한 하소연이 겹친다', '요즘 너무 힘들어서 아무것도 손에 안 잡혀요 ㅠㅠ 다들 이런 시기 어떻게 보내셨어요'],
  ['같은 주제 다른 이야기', '잠을 통 못 자요. 새벽 3시에 눈이 떠지면 그냥 일어나서 티비를 봅니다'],
] as const) {
  check(`🟢 ${label} — 통과`, !copied(draft, SOURCE_A))
}

/**
 * 🔴 **결함 재주입 — 옛 6자 기준을 그대로 되살려 대조한다.**
 *    "이 글은 옛 규칙이라면 막혔다" 를 말로 적는 대신 **재서** 보인다.
 */
const OLD_MAX_OVERLAP = 6
const oldRuleBlocks = (draft: string, source: string): boolean =>
  measureOriginality(draft, source).runChars >= OLD_MAX_OVERLAP

for (const [label, draft] of [
  ['흔한 하소연', '요즘 너무 힘들어서 아무것도 손에 안 잡혀요 ㅠㅠ 다들 이런 시기 어떻게 보내셨어요'],
  ['소재어 겹침', '갱년기 시작되고 나서 몸이 예전 같지 않네요. 저녁에 스트레칭 하나씩 해보는 중이에요'],
] as const) {
  check(`🔴 옛 6자 기준이라면 "${label}" 은 막혔다`, oldRuleBlocks(draft, SOURCE_A))
  check(`🟢 새 정본에서 "${label}" 은 통과한다`, !copied(draft, SOURCE_A))
}

// ─────────────────────────────────────────────────────────
console.log('\n── ② 원문 문장을 옮기면 막힌다 ──\n')
// ─────────────────────────────────────────────────────────

check(`🔴 원문 한 문장을 그대로 옮기면 막힌다`,
  copied('요즘 너무 힘들어서 병원을 가볼까 하는데 다들 어떻게 하셨는지 궁금하네요', SOURCE_A))
check('🔴 앞뒤에 내 말을 붙여도 옮긴 문장이 남아 있으면 막힌다',
  copied('안녕하세요 요즘 너무 힘들어서 병원을 가볼까 하는데 다들 어떻게 하셨는지 궁금하네요 ㅠㅠ', SOURCE_A))

{
  const m = measureOriginality('요즘 너무 힘들어서 병원을 가볼까 하는데 다들 어떻게 하셨는지 궁금하네요', SOURCE_A)
  check(`🔴 사유가 어절 연속이다 (${m.runWords}어절 ≥ ${COPY_RUN_WORDS})`,
    judgeCopy(m).reason === 'runWords' && m.runWords >= COPY_RUN_WORDS)
}

// ─────────────────────────────────────────────────────────
console.log('\n── ③ 피해 가려는 복제도 막힌다 ──\n')
// ─────────────────────────────────────────────────────────

{
  // 띄어쓰기를 흩어 어절 연속을 끊어도 글자 나열은 남는다
  const evasive = '요즘너무 힘들어서병원을 가볼까하는데 다들어떻게 하셨는지궁금하네요'
  const m = measureOriginality(evasive, SOURCE_A)
  check(`🔴 띄어쓰기를 흩어도 막힌다 (연속 ${m.runChars}자 ≥ ${COPY_RUN_CHARS})`,
    judgeCopy(m).copied && m.runChars >= COPY_RUN_CHARS)
  check('🔴 그때 사유는 글자 연속이다 — 어절 연속만으로는 못 잡는다',
    m.runWords < COPY_RUN_WORDS && judgeCopy(m).reason === 'runChars')
}

{
  // 조각을 이어 붙여 만든 모자이크 — 어느 한 조각도 기준 아래인데 합치면 원문이다
  const mosaic = '갱년기 시작되고 나서 잠을 잘 못 자네요 그래서 저는 일단 운동부터 다시 해보려고요'
  const m = measureOriginality(mosaic, SOURCE_A)
  check(`🔴 조각을 이어 붙인 모자이크도 막힌다 (덮임 ${Math.round(m.coverRatio * 100)}%)`,
    judgeCopy(m).copied)
  check('🔴 그때 사유는 덮임이다 — 어절·글자 연속만으로는 못 잡는다',
    m.runWords < COPY_RUN_WORDS && m.runChars < COPY_RUN_CHARS && judgeCopy(m).reason === 'cover')
  // 🔴 자기 말로 쓴 긴 글은 덮임이 0 이다 — 여유가 크다는 근거
  check('🟢 자기 말로 쓴 긴 글은 덮임 0',
    measureOriginality(
      '새벽에 자꾸 깨는 게 벌써 반년째예요. 낮에 졸리니까 커피만 늘고, 그러다 밤에 또 못 자고.'
      + ' 어제는 아예 티비 켜놓고 앉아 있었네요 ㅎㅎ 병원 가야 하나 싶다가도 막상 뭐라고 말해야 할지 모르겠어서요',
      SOURCE_A).coverRatio === 0)
}

check(`🟢 덮임 비율은 자리를 센다 — 0~1 을 넘지 않는다`,
  coveredRatio(SOURCE_A, SOURCE_A) <= 1 && coveredRatio(SOURCE_A, SOURCE_A) >= COVER_RATIO)
check('🟢 원문과 아무 상관 없는 글은 덮임 0', coveredRatio('오늘 김치를 담갔습니다', SOURCE_A) === 0)

// ─────────────────────────────────────────────────────────
console.log('\n── ④ 재지 않은 것은 통과가 아니다 ──\n')
// ─────────────────────────────────────────────────────────

check('🔴 잰 값이 없으면 복제로 본다', judgeCopy(null).copied && judgeCopy(undefined).copied)
check('🔴 숫자가 아니면 복제로 본다',
  judgeCopy({ runWords: NaN, runChars: 0, coverRatio: 0 }).copied)
check('🔴 파일에서 읽은 값이 모양이 아니면 null', readMeasure(null) === null && readMeasure({ a: 1 }) === null)
check('🔴 비율이 1 을 넘으면 null', readMeasure({ runWords: 1, runChars: 1, coverRatio: 1.5 }) === null)
check('🟢 모양이 맞으면 그대로 읽는다',
  readMeasure({ runWords: 2, runChars: 5, coverRatio: 0.1 })?.runChars === 5)

// ─────────────────────────────────────────────────────────
console.log('\n── ⑤ 기준선 바로 위·아래 ──\n')
// ─────────────────────────────────────────────────────────

check(`🟢 어절 ${COPY_RUN_WORDS - 1}개 연속은 통과`,
  !judgeCopy({ runWords: COPY_RUN_WORDS - 1, runChars: 0, coverRatio: 0 }).copied)
check(`🔴 어절 ${COPY_RUN_WORDS}개 연속은 막힌다`,
  judgeCopy({ runWords: COPY_RUN_WORDS, runChars: 0, coverRatio: 0 }).copied)
check(`🟢 글자 ${COPY_RUN_CHARS - 1}자 연속은 통과`,
  !judgeCopy({ runWords: 0, runChars: COPY_RUN_CHARS - 1, coverRatio: 0 }).copied)
check(`🔴 글자 ${COPY_RUN_CHARS}자 연속은 막힌다`,
  judgeCopy({ runWords: 0, runChars: COPY_RUN_CHARS, coverRatio: 0 }).copied)
check(`🔴 덮임 ${COVER_RATIO} 은 막힌다 — 경계는 포함이다`,
  judgeCopy({ runWords: 0, runChars: 0, coverRatio: COVER_RATIO }).copied)

// ─────────────────────────────────────────────────────────
console.log('\n── ⑥ 잰 값은 판정이 아니다 ──\n')
// ─────────────────────────────────────────────────────────

check('🟢 어절로 쪼갤 때 기호를 뗀다', normalizeWords('안녕하세요, 잘 지내셨어요?').length === 3)
check('🟢 글자로 볼 때는 공백도 기호도 없다', normalizeChars('안녕 하세요!') === '안녕하세요')
check('🟢 사유 이름이 라벨과 하나씩 짝지어져 있다',
  COPY_REASONS.every((r) => COPY_REASON_LABEL[r] !== undefined))
check('🟢 한 줄 설명이 세 값을 다 담는다',
  /연속 .*어절 · .*자 · 덮임 .*%/.test(describeOriginality({ runWords: 1, runChars: 2, coverRatio: 0.3 })))

// ─────────────────────────────────────────────────────────
console.log('\n── ⑦ 기준은 저장소에 한 벌뿐이다 ──\n')
// ─────────────────────────────────────────────────────────

/**
 * 🔴 옛 판이 낸 사고가 바로 이것이다 — 생성 쪽 `< 6`, 적재 쪽 `>= 6`.
 *    숫자를 두 군데 적으면 반드시 갈라진다. 소스에서 직접 확인한다.
 */
const codeOf = (p: string): string =>
  readFileSync(p, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

for (const p of [
  'src/lib/micro-seed-auto-draft.ts',
  'src/lib/micro-seed-supply-autofill.ts',
  'scripts/micro-seed-auto-draft.mts',
  'scripts/micro-seed-supply-autofill.mts',
  'scripts/lib/micro-seed-seed-originality.mts',
]) {
  const c = codeOf(p)
  check(`🔴 ${p} 에 옛 상수가 남아 있지 않다`,
    !/MAX_OVERLAP|MAX_ALLOWED_OVERLAP|MAX_SOURCE_OVERLAP/.test(c))
  check(`🔴 ${p} 이 겹침 기준 숫자를 직접 적지 않는다`,
    !/overlap\s*[<>]=?\s*\d/.test(c))
}

{
  const c = codeOf('src/lib/draft-originality.ts')
  check('🔴 기준 숫자는 정본 파일에만 있다',
    c.includes(`COPY_RUN_WORDS = ${COPY_RUN_WORDS}`)
    && c.includes(`COPY_RUN_CHARS = ${COPY_RUN_CHARS}`)
    && c.includes(`COVER_PIECE_CHARS = ${COVER_PIECE_CHARS}`))
  check('🔴 정본은 순수하다 — 파일 · DB · 네트워크 import 가 없다',
    !/from '(node:|@prisma)/.test(c))
}

/**
 * 🔴 **고유명사는 복제가 아니다** (2026-09-13, 창업자 결정).
 *    공개 인물 이름 · 프로그램 이름은 그 글이 무슨 이야기인지 알려 주는 말이고,
 *    검색으로 사람이 들어오는 자리다. 지우면 글이 뭘 말하는지 알 수 없게 된다.
 */
console.log('\n⑧ 🟢 고유명사는 통과하고 제목 통째 복사는 막힌다\n')
{
  const SRC = '차태현이 술 끊었다고 미운 우리 새끼에서 말했대요. 다들 보셨어요?'
  const own = '차태현 얘기 나온 미운 우리 새끼 어제 봤어요. 남편이 그거 보더니 자기도 끊는다고 하네요 ㅋㅋ'
  const m1 = measureOriginality(own, SRC)
  check(`🟢 사람 이름·프로그램 이름만 겹치는 것은 통과 (${describeOriginality(m1)})`, !judgeCopy(m1).copied)
  const m2 = measureOriginality(SRC, SRC)
  check(`🔴 원문 제목을 통째로 옮기면 막힌다 (${describeOriginality(m2)})`, judgeCopy(m2).copied)
}

/**
 * 🔴 **임계값 근거를 예시 넷에서 실제 사람 글로 넓힌다** (2026-09-13).
 *    정본 말투 자산(외부 커뮤니티 댓글 · 익명화 · 유출검사 완료)이 있으면 그것으로 잰다.
 *    🔴 자산이 없는 환경(CI)에서는 **건너뛴다.** 없다고 실패시키면
 *    "자산이 있어야 통과하는 검사" 가 되어 CI 가 사람 기계에 종속된다.
 */
console.log('\n⑨ 🔴 실제 사람 글로 오탐·미탐을 잰다\n')
{
  const texts = ((): string[] => {
    try {
      const raw = readFileSync(join(
        homedir(), 'Library', 'Application Support', 'soransoran', 'persona-reference', 'corpus.json',
      ), 'utf-8')
      const d = JSON.parse(raw) as { comments?: { content?: string }[] }
      return (d.comments ?? []).map((c) => String(c.content ?? '')).filter((t) => [...t].length >= 40)
    } catch { return [] }
  })()
  if (texts.length < 50) {
    console.log('  🟡 정본 말투 자산이 없다 — 이 구간은 건너뛴다 (CI 에서는 정상이다)')
  } else {
    let fp = 0
    let pairs = 0
    for (let i = 0; i + 1 < texts.length && pairs < 1500; i += 1) {
      for (let k = 1; k <= 3 && i + k < texts.length; k += 1) {
        pairs += 1
        if (judgeCopy(measureOriginality(texts[i]!, texts[i + k]!)).copied) fp += 1
      }
    }
    check(`🟢 서로 다른 사람 글 ${pairs}쌍 중 복제 오판 0건 (실제 ${fp})`, fp === 0)
    const sample = texts.slice(0, 300)
    check('🔴 자기 자신은 전부 잡는다',
      sample.every((t) => judgeCopy(measureOriginality(t, t)).copied))
    check('🔴 앞 절반만 베껴도 전부 잡는다', sample.every((t) => judgeCopy(measureOriginality(
      `${t.slice(0, Math.floor(t.length / 2))} 저도 그랬어요 요즘 다들 그런가 봐요`, t,
    )).copied))
  }
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)

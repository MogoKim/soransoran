#!/usr/bin/env tsx
/**
 * 네이버 카페 원천 규칙 fixture — 🔴 DB · 네트워크 · 파일 없음
 *
 * 🔴 **여기서 막는 사고**
 *    ① 자동 선별이 목록 단계에 없는 플래그에 기대 아무것도 막지 못하는 것
 *    ② 이미 연 글을 다시 열어 카페에 부하만 주는 것
 *    ③ 바퀴 몫을 넘겨 여는 것(몫 계산 자체는 collect-sources-check 가 잰다)
 *    ④ 다른 카페의 같은 번호 글이 같은 키가 되어 조용히 빠지는 것
 *
 * 사용법: npx tsx scripts/micro-seed-supply-check.mts
 */
import {
  planAutoFetch, isNaverCafeSource, cafeIdOf, AUTO_SKIP_LIST_FLAGS,
} from './lib/micro-seed-supply.mjs'
import { computeDedupKey } from './lib/micro-seed-navercafe.mjs'
import { assessCandidate, DETAIL_ONLY_FLAGS } from './lib/micro-seed-quality.mjs'

let failed = 0
const ok = (label: string) => console.log(`  ✅ ${label}`)
const bad = (label: string, detail: string) => {
  console.error(`  ❌ ${label}\n     ${detail}`)
  failed += 1
}
const check = (label: string, cond: boolean, detail = '') => (cond ? ok(label) : bad(label, detail))

console.log('\n네이버 카페 원천 규칙 fixture\n')

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 자동 선별 — 자동 경로에는 사람이 없다')
// ─────────────────────────────────────────────────────────
{
  const rows = [
    { sourceArticleId: 'a1', score: 90, flags: ['targetLikely'] },
    { sourceArticleId: 'a2', score: 80, flags: ['targetLikely', 'hanjaLanguageFit'] },
    { sourceArticleId: 'a3', score: 70, flags: ['personalExperienceLikely'] },
    { sourceArticleId: 'a4', score: 10, flags: [] },
    { sourceArticleId: 'a5', score: 60, flags: ['clickbaitTitle'] },
    { sourceArticleId: 'a6', score: 50, flags: [], alreadyInVault: true },
  ]
  const p = planAutoFetch(rows, { max: 30 })
  check('🔴 언어 핏(한자 제목)은 자동으로 열지 않는다', !p.picked.includes('a2'))
  check('🔴 그 밖의 플래그는 여는 것을 막지 않는다 — 글의 주제로 빼지 않는다', p.picked.includes('a5'))
  check('🔴 옛 정치 플래그가 붙은 행도 연다 — 정치 낱말 사전은 지웠다',
    planAutoFetch([{ sourceArticleId: 'p1', score: 1, flags: ['politicalFigure', 'politicalTopicLikely'] }], { max: 30 }).picked.includes('p1'))
  /**
   * 🔴 **점수 하한을 없앴다** (2026-09-11). 낮은 점수는 **나중에** 열릴 뿐 버려지지 않는다 —
   *    후보가 남아 있는데 상세가 0 으로 끝나던 것이 병목이었다(실측 후보 15 → 상세 2~4).
   */
  check('🟢 점수가 낮아도 자리가 남으면 열린다', p.picked.includes('a4'))
  check('이미 Vault 에 있으면 열지 않는다', !p.picked.includes('a6'))
  check('게시 시각을 모르면 결정적 열쇠(글 번호) 순으로 열린다', p.picked.join(',') === 'a1,a3,a4,a5', p.picked.join(','))
  check(
    '🔴 제외는 버려지지 않고 사유와 함께 남는다',
    p.skipped.length === 2 && p.skipped.every((s) => s.detail.length > 0),
    JSON.stringify(p.skipped),
  )
  /**
   * a2 는 SKIP_FLAG · a6 은 ALREADY_IN_VAULT — 제외 2건의 사유는 2종이다.
   * 🔴 `BELOW_MIN_SCORE` 는 사라졌다 — 하드 차단은 중복과 플래그 둘뿐이다.
   */
  check(
    '제외 사유가 전부 코드로 분류된다',
    [...new Set(p.skipped.map((s) => s.reason))].sort().join(',') === 'ALREADY_IN_VAULT,SKIP_FLAG',
    JSON.stringify(p.skipped.map((s) => s.reason)),
  )
  check(
    '🔴 상세 플래그(medicalOrAdLikely)로는 목록 단계에서 거르지 않는다',
    planAutoFetch([{ sourceArticleId: 'm1', score: 90, flags: ['medicalOrAdLikely'] }], { max: 30 }).picked.includes('m1'),
    '목록 단계에 없는 플래그를 여기서 막는 척하면 가드가 무력해진다 — 막는 판단은 판정이 한다',
  )
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤-B 🔴 구조 가드 — 목록 단계에 없는 플래그에 의존하지 않는다 (PR-S2-a)')
// ─────────────────────────────────────────────────────────
//
// 🔴 2026-09-03 실측 결함의 재발 방지다.
//    AUTO_SKIP_LIST_FLAGS 에 이름을 적는 것만으로는 가드가 되지 않는다.
//    **제목 하나로 실제 발화하는지**를 fixture 가 증명해야 한다.
{
  for (const f of AUTO_SKIP_LIST_FLAGS) {
    check(
      `[구조] ${f} 는 DETAIL_ONLY_FLAGS 가 아니다`,
      !DETAIL_ONLY_FLAGS.includes(f as never),
      '본문을 읽어야 붙는 플래그를 목록 단계 제외 목록에 두면 아무것도 막지 못한다',
    )
  }
  // 🔴 이름만이 아니라 **발화 증명**을 요구한다. 제목만 주고 실제로 붙는지 본다
  const titleOnly = (title: string) =>
    assessCandidate({ originalTitle: title, rawBody: '', sourceCommentCount: 3 }).flags as readonly string[]

  check('[구조·증명] hanjaLanguageFit 는 제목만으로 발화한다', titleOnly('韓國 여행 다녀왔어요').includes('hanjaLanguageFit'))
  check(
    '🔴 [구조] medicalOrAdLikely 는 목록 단계 제외 목록에 없다',
    !(AUTO_SKIP_LIST_FLAGS as readonly string[]).includes('medicalOrAdLikely'),
    '제목만으로 (시설|시술)+가격 조합이 성립하는 일은 사실상 없다 — 무력한 가드가 된다',
  )
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤-D 실측 회귀 — 2026-09-03 live 수집 3건')
// ─────────────────────────────────────────────────────────
{
  const assess = (title: string, body: string) =>
    assessCandidate({ originalTitle: title, rawBody: body, sourceCommentCount: 8 })

  // ① 4234890 — 정신과약. 제목만으로는 안 잡히고, 본문을 읽으면 보류돼야 한다
  const t1 = assess('불안으로 정신과약 드셔본 분 계신가요', '')
  check(
    '4234890 정신과약 — 목록 단계에서는 자동 제외 대상이 아니다 (실측 재현)',
    !AUTO_SKIP_LIST_FLAGS.some((f) => (t1.flags as readonly string[]).includes(f)),
    JSON.stringify(t1.flags),
  )
  // ③ 사회 · 정치 화제 제목도 목록 단계에서 빼지 않는다 — 부분일치 사전이 지우던 모양 포함(지어낸 제목)
  for (const s of ['나라별 극우의 특징', '대선 후보 토론 보셨어요', '배우 박진영 나오는 드라마 보셨어요', '하수구가 막혀서 사람 불렀어요', '남친문제로 잠이 안 와요', '이것도 약관 위반일까요']) {
    const flags = assess(s, '').flags
    check(`🔴 "${s.slice(0, 14)}" — 자동 선별에서 빠지지 않는다`,
      planAutoFetch([{ sourceArticleId: 'x', score: 0, flags: [...flags] }], { max: 30 }).picked.includes('x'), JSON.stringify(flags))
  }
}
{
  const MAX = 20
  const many = Array.from({ length: MAX + 15 }, (_, i) => ({
    sourceArticleId: `b${String(i).padStart(3, '0')}`,
    score: 100 - i,
    flags: ['targetLikely'],
  }))
  const p = planAutoFetch(many, { max: MAX })
  check(`바퀴 몫 ${MAX}건을 넘지 않는다`, p.picked.length === MAX, String(p.picked.length))
  check('몫 밖은 OVER_MAX 로 남는다', p.skipped.every((s) => s.reason === 'OVER_MAX'))
  check('몫 0 이면 하나도 열지 않는다', planAutoFetch(many, { max: 0 }).picked.length === 0)
}
check('같은 입력이면 같은 결과다 (재현성)', (() => {
  const rows = [
    { sourceArticleId: 'z2', score: 50, flags: [] },
    { sourceArticleId: 'z1', score: 50, flags: [] },
  ]
  return planAutoFetch(rows, { max: 30 }).picked.join(',') === planAutoFetch(rows, { max: 30 }).picked.join(',')
})())

// ─────────────────────────────────────────────────────────
console.log('\n⑥ sourceSite 계약 — navercafe:{cafeId} (PR-S2-b-1)')
// ─────────────────────────────────────────────────────────
{
  // ── 형태 판정 ──
  check('navercafe:remonterrace 는 네이버 소스다', isNaverCafeSource('navercafe:remonterrace'))
  check('navercafe:wgang 도 마찬가지', isNaverCafeSource('navercafe:wgang'))
  check('cafeId 를 뽑아낸다', cafeIdOf('navercafe:remonterrace') === 'remonterrace')
  check('prefix 만 있으면 안 된다', !isNaverCafeSource('navercafe:'))
  check('🔴 경로가 붙은 형태는 거부한다', !isNaverCafeSource('navercafe:a/b'))
  check('🔴 공백이 든 형태는 거부한다', !isNaverCafeSource('navercafe:a b'))
  check('cafeIdOf 는 형태가 아니면 null', cafeIdOf('dcinside') === null && cafeIdOf('navercafe:') === null)

  // ── dedupKey 계약 — 카페가 다르면 키가 다르다 ──
  {
    const a = computeDedupKey('navercafe:remonterrace', '34783204')
    const b = computeDedupKey('navercafe:wgang', '34783204')
    check('dedupKey 는 sha256:{hex} 형태다', /^sha256:[0-9a-f]{64}$/.test(a), a.slice(0, 20))
    check('🔴 같은 articleId 라도 카페가 다르면 dedupKey 가 다르다', a !== b,
      'cafeId 가 sourceSite 에 없으면 다른 카페 글이 조용히 SKIP 된다')
    check('같은 (카페, articleId) 는 항상 같은 키다', computeDedupKey('navercafe:remonterrace', '34783204') === a)
  }
}

console.log(failed === 0 ? '\n✅ 전부 통과\n' : `\n❌ ${failed}건 실패\n`)
process.exit(failed === 0 ? 0 : 1)

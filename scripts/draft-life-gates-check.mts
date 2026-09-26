#!/usr/bin/env tsx
/**
 * 초안 게이트 검사 — 🔴 **운영 기계 초안 4편이 다시는 후보가 되지 않는다** (2026-09-26)
 *
 *   반례(운영 실측) · 대조(운영 실측) · 말바꿈 · carve-out 을 **실제 함수**로 돌린다:
 *     ① 게이트 정본 `judgeDraftGates` — 구조화된 사유 코드
 *     ② 러너 경로 `runContentCore → pickV2` — artifact review 에 사유가 남고, 유료 검수 요청 전에 멈추고,
 *        pick 이 그 이름 그대로 `AUTO_HOLD` 다. 대조군은 `AUTO_ADOPT` 까지 간다
 *     ③ 옛 캐시 artifact(`adopt` 로 저장된 한 장)도 채택 자리에서 막힌다
 *     ④ 말바꿈 — 문자열 하나를 찾는 순진한 규칙이면 놓치는 표현
 *     ⑤ carve-out — 막으면 안 되는 글
 *
 *   🔴 네트워크 0 · provider 0 · DB 0. 가짜 provider 는 운영에서 실제로 돌아온 답(`clean`)을 준다.
 */
import { readFileSync } from 'node:fs'
import { judgeDraftGates, DRAFT_GATE_CODES, DRAFT_GATE_LABEL, type DraftGateCode }
  from '../src/lib/content-core/draft-life-gates'
import { readMediaDependency, buildEvidencePacket } from '../src/lib/content-core/evidence'
import { DETERMINISTIC_CODES, DETERMINISTIC_LABEL } from '../src/lib/content-core/review'
import { DRAFT_REASON_LABEL } from '../src/lib/micro-seed-auto-draft'
import { readPostRequirements, readSelfClaims } from '../src/lib/original-post-persona-match'
import type { PoolCard } from '../src/lib/persona-pool-card'
import {
  FIXTURES as OPS_FIXTURES, REVIEW_FIXTURES, P01, P02, P12, P13, P14, P19, runFixturePath, type GateFixture,
} from './lib/draft-gate-fixtures.mjs'

/** 🔴 운영 실측 6 + 마스터 재검토 반례 6 — 셋 다(게이트 · 러너 경로 · 캐시) 같은 목록을 돈다 */
const FIXTURES: readonly GateFixture[] = [...OPS_FIXTURES, ...REVIEW_FIXTURES]

let pass = 0
let fail = 0
const check = (label: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${label}`) } else {
    fail += 1; console.log(`  🔴 FAIL ${label}${detail === '' ? '' : ` — ${detail}`}`)
  }
}
/** 🔴 값으로 견준다 — 두 모듈 인스턴스가 생겨도(Node 20 · tsx) 같은 답이어야 한다 */
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  [...new Set(a)].sort().join('|') === [...new Set(b)].sort().join('|')

type PlanLike = { selfBasis: string | null; warrants: { fact: string }[] }
const planLike = (fx: GateFixture): PlanLike => ({
  selfBasis: (fx.plan.selfBasis as string | null) ?? null,
  warrants: ((fx.plan.speakerWarrants as { fact: string }[] | undefined) ?? []).map((w) => ({ fact: w.fact })),
})
const QUESTION: PlanLike = { selfBasis: null, warrants: [] }
const SELF: PlanLike = { selfBasis: 'lifeFacts', warrants: [{ fact: 'spouse' }] }
const codes = (title: string, body: string, plan: PlanLike | null, card: PoolCard | null): DraftGateCode[] =>
  judgeDraftGates({ title, body, plan, card }).map((g) => g.code)

console.log('\n══ 초안 게이트 (자료 의존 · 1인칭 허가 · 지금 삶과 시제) — 🔴 provider 0 · DB 0 ══\n')

console.log('① 운영 반례 4 · 대조 2 + 재검토 반례 6 — 게이트 정본')
for (const fx of FIXTURES) {
  const got = codes(fx.draft.title, fx.draft.body, planLike(fx), fx.card)
  if (fx.expect.length === 0) {
    check(`🟢 ${fx.label} — 통과`, got.length === 0, got.join(','))
  } else {
    check(`🔴 🔴 **${fx.label} — ${fx.expect.join('·')} 로 막힌다**`,
      fx.expect.every((c) => got.includes(c)) && got[0] === fx.expect[0], got.join(','))
  }
}

console.log('\n② 러너 경로 — runContentCore → pickV2 (artifact review 기록 · 유료 검수 전 멈춤 · AUTO_HOLD)')
for (const fx of FIXTURES) {
  const r = await runFixturePath(fx)
  const det = r.art.review.deterministic.failures.map((f) => f.code as string)
  const askedReview = r.asks.some((a) => a.stage === 'semanticReview')
  if (fx.expect.length === 0) {
    check(`🟢 ${fx.label} — adopt → AUTO_ADOPT (의미 검수까지 간다)`,
      r.art.review.machineOutcome === 'adopt' && r.pick?.decision === 'AUTO_ADOPT' && askedReview,
      `${r.art.review.machineOutcome} · ${r.pick?.decision} · ${r.pick?.reason} · ${r.art.review.machineReason}`)
    continue
  }
  check(`🔴 🔴 **${fx.label} — artifact review 에 구조화 사유가 남는다**`,
    fx.expect.every((c) => det.includes(c)) && r.art.review.machineOutcome === 'hold'
    && r.art.review.semanticCompletion.cause === 'deterministicFailed',
    `${det.join(',')} · ${r.art.review.machineOutcome}`)
  check(`🔴 ${fx.label} — 사유 라벨이 machineReason 에 적힌다`,
    fx.expect.every((c) => r.art.review.machineReason.includes(DRAFT_GATE_LABEL[c])), r.art.review.machineReason)
  check(`🔴 ${fx.label} — 유료 의미 검수를 부르지 않는다 (요청 ${r.asks.length}회)`,
    !askedReview && r.asks.length === 2, r.asks.map((a) => a.stage).join(','))
  check(`🔴 🔴 **${fx.label} — pick 이 AUTO_HOLD · 사유 ${fx.expect[0]}**`,
    r.pick?.decision === 'AUTO_HOLD' && r.pick.reason === fx.expect[0]
    && fx.expect.every((c) => r.pick!.rejected.some((x) => x.reason === c)),
    `${r.pick?.decision} · ${r.pick?.reason} · ${JSON.stringify(r.pick?.rejected)}`)
}

console.log('\n③ 옛 캐시 artifact — `adopt` 로 저장된 한 장도 채택 자리에서 막힌다')
for (const fx of FIXTURES) {
  const r = await runFixturePath(fx, { cachedAdopt: true })
  if (fx.expect.length === 0) {
    check(`🟢 ${fx.label} — 캐시 adopt → AUTO_ADOPT`, r.pick?.decision === 'AUTO_ADOPT', `${r.pick?.reason}`)
  } else {
    check(`🔴 🔴 **${fx.label} — 캐시 adopt 여도 AUTO_HOLD · ${fx.expect[0]}**`,
      r.pick?.decision === 'AUTO_HOLD' && r.pick.reason === fx.expect[0], `${r.pick?.decision} · ${r.pick?.reason}`)
  }
}

console.log('\n④ A 자료 의존 — 말바꿈은 막고 carve-out 은 통과')
{
  const blocked: [string, string][] = [
    // 🔴 순진한 `올려봐요 + 이런 스타일` 문자열 규칙이면 놓치는 말바꿈이다
    ['옛날에 했던 파마 모습 한번 올려 봅니다', '요런 머리 소화 가능하신 분 계세요?'],
    ['작년 여름 원피스예요', '사진 첨부합니다. 이 옷 나이에 안 맞나요?'],
    ['염색했어요', '이 색깔 어떤지 보여드릴게요. 괜찮은가요?'],
    ['김장 사진이에요', '사진 보시고 간이 맞는지 알려 주세요'],
  ]
  for (const [t, b] of blocked) {
    check(`🔴 "${t} / ${b}" — mediaDependentDraft`,
      codes(t, b, SELF, P12).includes('mediaDependentDraft'), JSON.stringify(readMediaDependency(`${t}\n${b}`)))
  }
  const passed: [string, string][] = [
    // 🔴 원천 쪽 carve-out 그대로 — 올리는 동작이 없으면 완결된 글이다
    ['이 사진 정리하다 울었어요', '엄마 젊을 때 사진이 나왔는데 한참을 봤네요'],
    ['그 사진만 보면 엄마 생각이 나요', '다들 그런 물건 하나씩 있으시죠?'],
    // 🔴 올리는 것이 글이다
    ['궁금해서 글 올려봐요', '이런 경우 다들 어떻게 하세요?'],
    // 🔴 올리는 동작은 있는데 눈으로 봐야 할 지시어가 없다
    ['생각나서 올려봐요', '이런 일 겪어보신 분 계세요?'],
    // 🔴 `딸아이 머리` 의 `이` 는 지시어가 아니다 · `저 머리` 의 `저` 는 글쓴이다
    ['딸아이 머리 묶어 주다가', '저 머리 자를까 고민 올려요'],
    ['파마를 한번 해 봤는데', '제 눈엔 촌스럽고 남편은 귀엽다네요. 이런 스타일 어떠세요?'],
  ]
  for (const [t, b] of passed) {
    check(`🟢 "${t} / ${b}" — 통과`, !codes(t, b, SELF, P12).includes('mediaDependentDraft'),
      JSON.stringify(readMediaDependency(`${t}\n${b}`)))
  }
  // 🔴 원천 쪽 판정은 그대로다 — 초안 규칙을 넣으면서 원천 carve-out 을 바꾸지 않았다
  const src = buildEvidencePacket({ sourceArticleId: 's', title: '이 사진 정리하다 울었어요', maskedBody: '엄마 사진이 나왔어요' })
  check('🟢 원천 판정 — "이 사진 정리하다 울었어요" 는 여전히 sufficient', src.contextSufficiency === 'sufficient')
  const srcAsk = buildEvidencePacket({ sourceArticleId: 's', title: '어떤가요', maskedBody: '사진 보시고 골라 주세요' })
  check('🔴 원천 판정 — "사진 보시고 골라 주세요" 는 여전히 needsImage', srcAsk.insufficientReasons.includes('needsImage'))
}

console.log('\n⑤ B 1인칭 허가 없는 생활사 — selfBasis=null 에서만')
{
  const blocked: [string, string][] = [
    ['부모님 이사 고민', '저희 부모님은 올해 은퇴하셨어요. 집을 줄이실지 고민이세요.'],
    ['시댁 명절', '시어머니께서 올해는 오지 말라고 하시네요.'],
    ['남편 이야기', '남편이 요즘 퇴근이 늦어요.'],
    ['아이 이야기', '애들이 방학이라 집이 시끄러워요.'],
    ['노후', '제 연금으로는 부족할 것 같아요.'],
  ]
  for (const [t, b] of blocked) {
    const g = codes(t, b, QUESTION, P13)
    check(`🔴 QUESTION · "${b.slice(0, 22)}…" — unwarrantedSelfClaim`, g.includes('unwarrantedSelfClaim'),
      `${g.join(',')} · ${JSON.stringify(readSelfClaims(t, b))}`)
  }
  // 🔴 같은 글도 1인칭 허가가 있으면 B 는 막지 않는다 (카드 모순은 C 가 본다)
  // 🔴 재검토 — 남의 집안이 `-고` 로 이어져도 B 는 그 사람 아이를 글쓴이 자녀로 세지 않는다
  check('🟢 QUESTION · "친구 남편이 육아휴직 쓰고 애들이랑 놀아줘요" — B 통과',
    !codes('육아휴직', '친구 남편이 육아휴직 쓰고 애들이랑 놀아줘요.', QUESTION, P13).includes('unwarrantedSelfClaim'),
    JSON.stringify(readSelfClaims('육아휴직', '친구 남편이 육아휴직 쓰고 애들이랑 놀아줘요.')))
  check('🔴 QUESTION · 맨 "남편이 육아휴직 쓰고 애들이랑 놀아줘요" — B 는 여전히 막는다',
    codes('육아휴직', '남편이 육아휴직 쓰고 애들이랑 놀아줘요.', QUESTION, P13).includes('unwarrantedSelfClaim'))
  check('🟢 같은 "남편이 요즘 퇴근이 늦어요" 도 lifeFacts 허가면 B 통과',
    !codes('남편 이야기', '남편이 요즘 퇴근이 늦어요.', SELF, P13).includes('unwarrantedSelfClaim'))
  const passed: [string, string, string][] = [
    // 🔴 운영 P07 — 일반론이다 (넓은 매칭 판정이면 막혔다)
    ['아들 낳았다고 하면 안쓰럽게 보는 시선들이요',
      '어디서 글을 읽다 보니까 아들 낳았다고 하면 은근히 안쓰럽게 보는 시선이 있다는 이야기가 있더라고요.\n\n'
      + '딸도 딸 나름이고, 주변 보면 엄마 알뜰히 잘 챙기는 아들들도 참 많잖아요.', 'P07 일반론'],
    // 🔴 운영 P18 — 읽는 사람의 친정을 묻는다
    ['친정엄마나 시어머니랑 매일 통화하시나요?',
      '딸들은 친정엄마랑 가까이 살아도 매일 통화하곤 하잖아요.\n다들 어떠세요?', 'P18 묻는 글'],
    ['부모님 은퇴하시면 다들 어디 사세요?', '서울에 계속 계시는지 궁금해요.', '일반 질문'],
    ['친구 남편 이야기', '친구 남편이 육아휴직을 했대요. 다들 어떻게 보세요?', '남의 남편'],
  ]
  for (const [t, b, why] of passed) {
    const g = codes(t, b, QUESTION, P13)
    check(`🟢 ${why} — 통과`, !g.includes('unwarrantedSelfClaim'), `${g.join(',')} · ${JSON.stringify(readSelfClaims(t, b))}`)
  }
}

console.log('\n⑥ C 카드의 지금 삶과 시제')
{
  const blocked: [string, string, PoolCard, string][] = [
    ['애들 크면', '아이들이 중고등 되면 사춘기라 힘들다던데 걱정이에요.', P01, '중고등 카드 · 밴드 이름을 미래로'],
    ['학교 보내기', '애들이 초등학교 들어가면 뭐부터 챙겨야 할까요 싶어요.', P01, '중고등 카드 · 지난 밴드를 미래로'],
    ['대학 시절', '애들이 대학생이었을 때 용돈을 얼마나 줬었는지 가물가물해요.', P01, '중고등 카드 · 오지 않은 밴드를 과거로'],
    ['아침밥', '초2 아이 아침밥으로 김밥을 싸 줬어요.', P14, '성인 카드 · 지금 초등 아이'],
    ['아침밥', '남편이 초1 아이 등교를 맡았어요.', P19, '성인 카드 · 지금 초등 아이'],
    // 🔴 재검토 ③ — 맨 `남편이` 는 글쓴이 남편이다. `-고` 뒤 주어 없는 절이 그 주어를 이어 받는다
    ['육아휴직', '남편이 육아휴직 쓰고 초1 아이를 돌봐요.', P14, '성인 카드 · 맨 "남편이 … 쓰고 초1 아이"'],
    ['육아휴직', '제가 초1 아이를 돌보고 있어요.', P14, '성인 카드 · 1인칭 주어'],
    // 🔴 재검토 ⑥ — 앞날을 여는 틀은 그대로 미래다
    ['중고등', '애들이 중고등학생이 되면 대화가 줄겠죠.', P01, '중고등 카드 · "되면"'],
    ['중고등', '애들이 중고등학생이 될 때 대화가 준다고 하네요.', P01, '중고등 카드 · "될 때"'],
    ['중고등', '애들이 중고등 시기가 오면 방에만 있겠죠.', P01, '중고등 카드 · "시기가 오면"'],
    // 🔴 관계 명칭도 **명시된 1인칭**이면 그대로 센다
    ['사위', '우리 사위가 요즘 많이 바빠요.', P01, '중고등 카드 · "우리 사위"'],
  ]
  for (const [t, b, card, why] of blocked) {
    const g = codes(t, b, SELF, card)
    check(`🔴 ${why} — lifeStageTenseConflict`, g.includes('lifeStageTenseConflict'), g.join(','))
  }
  const passed: [string, string, PoolCard, string][] = [
    ['고등학교', '애들이 고등학생 되면 학원비가 더 든다던데요.', P01, '중고등 카드 · 같은 밴드 안의 다음 학년'],
    ['고3', '곧 고3인데 벌써 떨려요.', P01, '중고등 카드 · 지금 중고등'],
    ['옛날 생각', '애들 초등 시절에 도시락 싸던 생각이 나네요.', P14, '성인 카드 · 지난 밴드를 과거로'],
    ['손주', '애들 다 커서 이제 명절에 사위 며느리까지 모여요.', P19, '성인 카드 · 지금으로 말함'],
    ['수학', '초등학생 수학 문제 요즘 어렵다는데 어떤가요?', P14, '성인 카드 · 묻는 일반론'],
    // 🔴 재검토 ①④ — 남의 집안. 앞 절 주어의 임자를 `-고` 뒤 절이 이어 받는다 (사람 명사 목록 없음)
    ['육아휴직', '친구 남편이 육아휴직 쓰고 초1 아이를 돌봐요.', P14, '성인 카드 · "친구 남편이 … 쓰고"'],
    ['육아휴직', '회사 동료가 육아휴직 쓰고 초1 아이를 돌봐요.', P14, '성인 카드 · "회사 동료가 … 쓰고"'],
    ['육아휴직', '이웃집 남편이 육아휴직 쓰고 초1 아이를 돌봐요.', P14, '성인 카드 · "이웃집 남편이 … 쓰고"'],
    ['육아휴직', '동생이 육아휴직 쓰고 초1 아이를 돌보면서 힘들어해요.', P14, '성인 카드 · 소재어 아닌 주어가 두 절을 넘어간다'],
    // 🔴 재검토 ⑤ — `돼서` 는 이미 된 까닭이다
    ['중고등', '애들이 중고등학생이 돼서 요즘 대화가 줄었어요.', P01, '중고등 카드 · "돼서 요즘" 은 지금'],
    /**
     * 🔴 운영 P07 초안(2026-09-26 재측정) — `사위` 는 글쓴이 남편을 친정 쪽에서 부른 이름이다.
     *    `돼서` 를 미래에서 빼자 이 절이 "지금 성인 자녀" 로 읽혀 새로 막혔다 — 관계 명칭은
     *    명시된 1인칭이 아니면 임자를 확정할 수 없으므로 막지 않는다.
     */
    ['호칭', '사위가 돼서 자꾸 그러니까 듣다 보니 서운하더라고요.',
      { ...P01, code: 'P07', childrenAgeBands: ['대학·취준'] }, '대학·취준 카드 · 생략된 "사위가 돼서"'],
  ]
  for (const [t, b, card, why] of passed) {
    const g = codes(t, b, SELF, card)
    check(`🟢 ${why} — 통과`, !g.includes('lifeStageTenseConflict'), g.join(','))
  }
  // 🔴 학년 표기를 읽는다 — 앞이 한글이면 학년이 아니다
  check('🔴 readPostRequirements 가 "초1 아이" 를 초등으로 읽는다',
    readPostRequirements('', '초1 아이 아침밥을 차렸어요').needsChildAgeBands.includes('초등'))
  check('🟢 "최초1" 은 학년이 아니다', readPostRequirements('', '최초1 등을 했어요').needsChildAgeBands.length === 0)
}

console.log('\n⑥-b 절 머리 주어 — 첫 은/는 어절에서 멈추지 않는다 (재검토 2차)')
{
  for (const head of ['지금은', '오늘은', '요즘은']) {
    const b = `${head} 남편이 육아휴직 쓰고 초1 아이를 돌봐요.`
    const g = codes('육아휴직', b, QUESTION, P14)
    check(`🔴 🔴 **"${head} 남편이 … 초1 아이" · P14 · QUESTION — C 와 B 둘 다 막는다**`,
      g.includes('lifeStageTenseConflict') && g.includes('unwarrantedSelfClaim'), g.join(','))
  }
  check('🔴 맨 "남편이 … 초1 아이" · QUESTION — C 와 B',
    sameSet(codes('육아휴직', '남편이 육아휴직 쓰고 초1 아이를 돌봐요.', QUESTION, P14),
      ['lifeStageTenseConflict', 'unwarrantedSelfClaim']))
  for (const b of ['오늘은 친구 남편이 육아휴직 쓰고 초1 아이를 돌봐요.', '친구는 남편이 육아휴직 쓰고 초1 아이를 돌봐요.']) {
    const g = codes('육아휴직', b, QUESTION, P14)
    check(`🟢 "${b.slice(0, 12)}…" — 남의 집안 · 둘 다 통과`, g.length === 0, g.join(','))
  }
}

console.log('\n⑦ 배선 — 코드 한 벌 · 러너가 실제로 넘긴다')
{
  check('🔴 deterministic 코드에 게이트 셋이 다 있다 (값으로)',
    DRAFT_GATE_CODES.every((c) => (DETERMINISTIC_CODES as readonly string[]).includes(c)))
  check('🔴 deterministic 라벨이 게이트 정본 라벨과 같다',
    DRAFT_GATE_CODES.every((c) => DETERMINISTIC_LABEL[c] === DRAFT_GATE_LABEL[c]))
  check('🔴 채택 사유 라벨이 게이트 정본 라벨과 같다',
    DRAFT_GATE_CODES.every((c) => DRAFT_REASON_LABEL[c] === DRAFT_GATE_LABEL[c]))
  /**
   * 🔴 **주석을 빼고 본다.** 채택 루프는 provider·장부·파일을 끼고 돌아 여기서 통째로 부를 수 없다 —
   *    그래서 러너가 pickV2 에 게이트 입력을 **실제로 넘기는지**를 코드에서 확인한다.
   *    넘기지 않으면 캐시 hit artifact 는 게이트를 한 번도 지나지 않는다.
   */
  const code = readFileSync('scripts/micro-seed-auto-draft.mts', 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const call = /pickV2\(\{[\s\S]*?\}, nowIso\)/.exec(code)?.[0] ?? ''
  check('🔴 🔴 **채택 루프가 pickV2 에 draftGate(계획·정본 카드)를 넘긴다**',
    /draftGate:\s*\{\s*plan:\s*art\.plan\s*\?\?\s*null,\s*card:\s*card\s*\?\?\s*null\s*\}/.test(call), call.slice(-200))
  const run = readFileSync('scripts/lib/content-core-run.mts', 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  const detAt = run.indexOf('judgeDraftGates(')
  check('🔴 게이트가 유료 의미 검수 요청보다 앞이다',
    detAt > 0 && detAt < run.indexOf("ask('semanticReview'"))
}

// 🔴 운영 카드 값을 fixture 가 부풀리지 않았는가 — 정본 문서와 대조
console.log('\n⑧ fixture 카드 = 정본 카드')
{
  const { parsePoolDoc } = await import('../src/lib/persona-pool-card')
  const doc = parsePoolDoc(readFileSync('docs/operations/2026-08-30-persona-pool-design.md', 'utf-8')).cards
  for (const c of [P01, P02, P12, P13, P14, P19]) {
    const real = doc.find((d) => d.code === c.code)
    check(`${c.code} 생활사 칸이 정본과 같다`,
      real !== undefined && real.birthDate === c.birthDate && real.maritalStatus === c.maritalStatus
      && real.childrenCount === c.childrenCount && sameSet(real.childrenAgeBands, c.childrenAgeBands)
      && real.workStatus === c.workStatus && real.ageBand === c.ageBand,
      real === undefined ? '정본에 없음' : `${real.childrenAgeBands.join('·')} · ${real.workStatus}`)
  }
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 가짜 provider 검사다 — 실제 모델이 이 네 가지를 다시 쓰지 않는지는 운영 실측으로만 안다.\n')
if (fail > 0) process.exit(1)

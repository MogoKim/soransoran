#!/usr/bin/env tsx
/**
 * 🔴 **P0-3 정치 · 연예 분리 계약 검사** (2026-10-04 · canon §7.1 · C-03)
 *
 *   옛 판은 `politicalOrPublicFigure`(제목) · `publicFigureMention`(본문) · 수집 사유 `publicFigure` 하나로 정치인과 연예인 ·
 *   방송인을 함께 막았다(수집 → 자동 상세 → 판정 hard gate → 82cook thin). 이제 축은 하나 — **정치**:
 *     · 정치 주제(`findPoliticalTopicHit` · 창업자 승인 목록) + 정치 인물(`findPoliticalFigureHits`)만 막는다
 *     · 배우 · 가수 · 방송인 · 드라마 · 예능 · 대중문화는 공인 이름이라는 이유로 막지 않는다
 *     · 명예훼손 · 사생활 · 괴롭힘 · 혐오 · 위협은 별도 hard gate(안전 필터 · 의미 판정)가 그대로 막는다
 *
 *   A 승인 정치인 · 정당 · 선거 · 캠페인 → 차단 · B 연예 · 방송 화제 → 통과 · C 생활 정책 · 병원 → 정치 오탐 없음
 *   D 연예인 명예훼손 · 사생활 → 별도 gate 차단 · E 정치 캠페인 + 연예인 → 차단 · 소스 잠금
 *
 * 🔴 DB 0 · 네트워크 0 · provider 0 · 파일 write 0.
 */
import { readFileSync } from 'node:fs'

import { assessCandidate, findPoliticalFigureHits, findPoliticalTopicHit } from './lib/micro-seed-quality.mjs'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { judgeExcludeReason } from './lib/micro-seed-navercafe.mjs'
import { gateOf } from './lib/micro-seed-scout-score.mjs'
import { planAutoFetch, judgeAutoHold } from './lib/micro-seed-supply.mjs'
import { judgeOne, readFlags, SEED_AXIS, type JudgeInput, type SemanticVerdict } from '../src/lib/micro-seed-auto-judge'
import { planThinFetch } from '../src/lib/micro-seed-82cook-thin'
import { findCjkIdeograph, HANJA_LANGUAGE_FIT } from '../src/lib/cjk-ideograph'
import { recheck } from './micro-seed-supply-autofill.mjs'

/** 🔴 다음 통합 단계의 1회 bounded read-only 의미 판정 replay 입력 — 이 검사가 결정적 축은 실제로 돌린다 */
type ReplayCase = { text: string; expect: 'PASS' | 'BLOCK'; axis: string; reason?: string }
const REPLAY = JSON.parse(readFileSync('scripts/__fixtures__/p0-3-semantic-replay.json', 'utf-8')) as { kind: string; cases: ReplayCase[] }

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  🔴 FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const strip = (p: string): string => readFileSync(p, 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')

/** 🔴 수집 → 자동 상세 → 안전 필터 → 판정 → 82cook thin 이 한 제목을 어떻게 다루는가(실제 함수만) */
function paths(title: string, body = '', risks: SemanticVerdict['risks'] = []): {
  flags: string[]; politics: boolean; exclude: string | null; safety: string; safetyCodes: string[]
  judge: string; judgeCodes: string[]; thin: string | null; autoFetchSkipped: boolean
} {
  const flags = assessCandidate({ originalTitle: title, sourceCommentCount: 10, rawBody: body }).flags as string[]
  const safety = safetyFilter({ title, body })
  const judge = judgeOne({
    sourceSite: 'navercafe:wgang', sourceArticleId: '1', axis: SEED_AXIS, access: 'ok', lane: 'microSeedQuestion',
    assetAxes: '', safetyVerdict: safety.verdict, safetyReasons: safety.reasons.map((r) => r.code).join('|'),
    bodyLength: 800, qualityFlags: flags, title, bodyHead: '가'.repeat(120), commentCount: 10,
  } as JudgeInput, '2026-10-04T00:00:00.000Z', {
    verdict: { decision: 'AUTO_SEED', confidence: 0.9, risks, communityAngle: '같이 이야기' }, status: 'ok',
    attemptCount: 1, providerErrorCode: null, model: 'm',
  })
  const thin = planThinFetch({
    rows: [{ sourceArticleId: '9', sourceSite: '82cook', originalTitle: title, sourceCommentCount: 10, sourceViewCount: 500,
      sourceExcludeReason: '', sourcePoliticsExcluded: false, qualityFlags: flags }],
    hasBody: new Set<string>(),
  })
  return {
    flags,
    politics: safety.reasons.some((r) => r.code === 'politics'),
    exclude: judgeExcludeReason({ politicsExcluded: false, pinned: false, qualityFlags: flags }),
    safety: safety.verdict,
    safetyCodes: safety.reasons.map((r) => r.code),
    judge: judge.decision,
    judgeCodes: [...judge.reasonCodes],
    thin: thin.skipped[0]?.code ?? null,
    autoFetchSkipped: planAutoFetch([{ sourceArticleId: 'x', score: 50, flags }], { max: 10 }).picked.length === 0,
  }
}
const blockedEverywhere = (p: ReturnType<typeof paths>): boolean =>
  p.politics && p.exclude === 'politics' && p.safety === 'hardExclude' && p.judge === 'AUTO_DROP'
  && (p.thin === 'FLAG_POLITICS' || p.thin === 'POLITICS') && p.autoFetchSkipped
/** 🔴 정상 원천 기회 — 정치 · 언어 핏 · 위해 어느 사유로도 버려지지 않는다(보류 사유는 별개) */
const passesAll = (p: ReturnType<typeof paths>): boolean =>
  !p.politics && p.exclude === null && p.safety !== 'drop' && p.safety !== 'hardExclude' && p.judge !== 'AUTO_DROP'
  && p.thin !== 'FLAG_POLITICS' && p.thin !== 'FLAG_LANGUAGE' && !p.autoFetchSkipped
/** 🔴 언어 핏 차단 — 정치로 위장하지 않는다 */
const blockedLanguage = (p: ReturnType<typeof paths>): boolean =>
  p.safetyCodes.includes(HANJA_LANGUAGE_FIT) && !p.politics && p.safety === 'drop' && p.exclude === null
  && p.judge === 'AUTO_DROP' && p.judgeCodes.includes(HANJA_LANGUAGE_FIT) && !p.judgeCodes.includes('politics')
  && p.thin === 'FLAG_LANGUAGE' && p.autoFetchSkipped && p.flags.includes(HANJA_LANGUAGE_FIT)
const clearOfPolitics = (p: ReturnType<typeof paths>): boolean =>
  !p.politics && p.exclude === null && !p.flags.includes('politicalFigure') && !p.flags.includes('politicalTopicLikely')
  && p.judge !== 'AUTO_DROP' && p.thin !== 'FLAG_POLITICS' && !p.autoFetchSkipped

console.log('\nA 🔴 승인된 정치인 · 정당 · 선거 · 캠페인 → 수집 · 자동 상세 · 안전 필터 · 판정 · 82cook thin 모두 차단')
for (const t of [
  '이재명 대통령 발언 어떻게 보세요', '김민석 의원 말이 맞나요', '국민의힘 전당대회 결과 보셨어요',
  '지방선거 투표 독려 캠페인 같이해요', '윤석열 탄핵 집회 다녀왔어요', '민주당 당대표 누가 될까요',
]) {
  const p = paths(t)
  check(`🔴 A "${t}" → 차단`, blockedEverywhere(p), JSON.stringify(p))
}

console.log('\nB 🔵 배우 · 가수 · 방송인 이름과 드라마 · 예능 화제 → 수집 통과(정치 축 아님)')
for (const t of [
  '배우 송혜교 새 드라마 첫방 봤어요', '가수 임영웅 콘서트 다녀왔어요 너무 좋았어요', '나혼자산다 박나래 편 보셨어요',
  '예능 런닝맨 유재석 진짜 웃겨요', '장영란 유튜브 보셨어요 살림팁 좋네요', '박수홍 결혼 소식 축하해요',
  '아나운서 김주하 뉴스 마지막 방송', '드라마 마지막회 결말 어떻게 보셨어요', '트로트 가수 채연 노래 좋네요',
]) {
  const p = paths(t)
  check(`🔵 B "${t}" → 정치 축 아님 · 판정 통과`, clearOfPolitics(p), JSON.stringify(p))
}
check('🔵 B 본문에 방송인 이름(장영란)이 있어도 본문 정치 인물 플래그 · 보류가 아니다', (() => {
  const a = assessCandidate({ originalTitle: '눈썹 시술 고민', sourceCommentCount: 5, rawBody: '장영란이 방송에서 얘기한 거 보고 저도 고민돼요' })
  return !a.flags.includes('politicalFigureMention') && !judgeAutoHold({ sourceArticleId: 'b', flags: a.flags }).hold
})())

console.log('\nC 🟢 병원 · 세금 · 주거 · 임금 생활글 → 정치 오탐 없음')
for (const t of [
  '한의원 침 맞고 왔는데 효과 있을까요', '피부과의원 레이저 가격 어느 정도예요', '동네 의원 원장님이 친절해요',
  '치과의원 스케일링 주기 궁금해요', '종합소득세 신고 혼자 하시나요', '전세 재계약 주거비 고민이에요',
  '월급 계산 어떻게 하세요 임금 명세서 보는 법', '건강보험료 너무 올랐어요', '국민연금 수령 나이 언제부터인가요',
  '집값 때문에 이사 고민이에요', '돌봄 휴가 쓰는 방법 아시는 분',
  '모친명의로 된 집 상속 문제 여쭤봐요', '모친명절 준비 다들 어떻게 하세요',
]) {
  const p = paths(t)
  check(`🟢 C "${t}" → 정치 오탐 없음`, clearOfPolitics(p), JSON.stringify(p))
}

console.log('\nC-2 🟢 (창업자 확정) 생활 정책 낱말은 단독 정치 근거가 아니다 — 수집 · 상세 · 안전 · 판정 · thin PASS')
for (const t of [
  '최저임금 올라서 알바비 계산 어떻게 하세요', '전세사기 당할까 봐 걱정돼요', '상속세 신고 어떻게 하셨어요',
  '유류세 인하 끝나면 기름값 오를까요', '연금개혁 되면 우리 연금은 어떻게 되나요', '주52시간 때문에 근무표가 바뀌었어요',
  '전공의가 없어서 병원 예약이 밀렸어요', '내 조국을 떠나 살면서', '조국에 돌아가고 싶어요',
]) {
  const p = paths(t)
  check(`🟢 C-2 "${t}" → PASS`, passesAll(p) && clearOfPolitics(p), JSON.stringify(p))
}
check('🔴 정책 · 법안 낱말은 단독으로 정치가 아니다 — 정치 문맥(공약 · 유세 · 반대 · 법안 · 정당 · 선거 …)이 있을 때만',
  findPoliticalTopicHit('최저임금') === null && findPoliticalTopicHit('간호법') === null && findPoliticalTopicHit('원전') === null
  && findPoliticalTopicHit('최저임금 공약') === '최저임금' && findPoliticalTopicHit('민주당 최저임금') === '민주당'
  && findPoliticalTopicHit('원전 반대 시위') === '원전' && findPoliticalTopicHit('간호법 지지부진') === null)

console.log('\nR 🔴 replay fixture(scripts/__fixtures__/p0-3-semantic-replay.json) — 결정적 축은 실제 경로로 판정')
{
  check('fixture 가 읽힌다 · 23건 · 축 5종', REPLAY.kind === 'p0-3-semantic-replay' && REPLAY.cases.length === 23
    && new Set(REPLAY.cases.map((c) => c.axis)).size === 5)
  for (const c of REPLAY.cases) {
    if (c.axis === 'policyLife' || c.axis === 'coarseOpinion') {
      const p = paths(c.text)
      check(`🟢 R ${c.axis} "${c.text}" → PASS (정치 · 혐오 · 언어 핏 사유 없음)`,
        passesAll(p) && !p.safetyCodes.includes('hostility'), JSON.stringify(p))
    } else if (c.axis === 'politics') {
      const p = paths(c.text)
      check(`🔴 R politics "${c.text}" → 정치 차단`, blockedEverywhere(p) && p.judgeCodes.includes('politics'), JSON.stringify(p))
    } else if (c.axis === 'groupHate') {
      const p = paths(c.text)
      check(`🔴 R groupHate "${c.text}" → 결정적 hostility drop · AUTO_DROP(정치 아님)`,
        p.safety === 'drop' && p.safetyCodes.includes('hostility') && p.judge === 'AUTO_DROP' && !p.politics, JSON.stringify(p))
    } else if (c.axis === 'semanticHarm') {
      // 🔴 결정적 필터는 이 문장을 낱말로 흉내 내지 않는다 — 의미 판정 사유가 막는다(아래 downstream 배선)
      const p = paths(c.text)
      check(`🔵 R semanticHarm "${c.text}" — 결정적 필터는 낱말로 막지 않는다(의미 판정 몫)`,
        p.safety !== 'drop' && p.safety !== 'hardExclude', JSON.stringify(p))
      const w = paths(c.text, '', [c.reason as SemanticVerdict['risks'][number]])
      check(`🔴 R semanticHarm "${c.text}" → [downstream 배선 검사 — 의미 판정 결과 ${c.reason} 를 fixture 로 주입 · 실제 모델 판정 검증 아님] AUTO_DROP`,
        w.judge === 'AUTO_DROP' && w.judgeCodes.includes(c.reason!) && !w.judgeCodes.includes('politics'), JSON.stringify(w))
    }
  }
}

console.log('\nH 🔵 연예 · 방송 · 공개 논란에 대한 비판 · 실망 · 호불호 → PASS(부정적 감정 · 연예인 이름은 위해가 아니다)')
for (const t of [
  '박나래 요즘 예능 너무 과한 것 같아요', '그 배우 인터뷰 태도는 솔직히 별로였어요', '방송에서 한 말이 무례하게 느껴졌어요',
  '이번 논란 해명은 납득이 안 되네요', '요즘 그 가수 너무 자주 나와서 조금 질려요', '공개된 이혼 기사 보고 마음이 복잡했어요',
  '그 드라마 결말 너무 억지 같지 않았나요', '연예인 논란에 대해 여러분은 어떻게 생각하세요', '그 예능 진짜 극혐이었어요',
]) {
  const p = paths(t)
  check(`🔵 H "${t}" → PASS`, passesAll(p), JSON.stringify(p))
}

console.log('\nI 🔴 정치 — 정당 · 후보 · 선거 · 유세 · 캠페인 · 지지 동원 → 차단(생활 정책 낱말과 함께 있어도)')
for (const t of [
  '민주당 최저임금 공약 지지합시다', '대선 후보 전세사기 대책 유세', '국민의힘 연금개혁 법안 캠페인',
  '조국혁신당 선거 유세', '조국 전 장관 정치 발언', '대통령 선거 발언을 지지합시다',
]) {
  const p = paths(t)
  check(`🔴 I "${t}" → 정치 차단`, blockedEverywhere(p) && p.judgeCodes.includes('politics'), JSON.stringify(p))
}

console.log('\nJ 🔴 언어 핏 — 실제 한자 문자 → 차단(정치 사유 아님 · hanjaLanguageFit)')
for (const t of ['朴나래 예능 너무 웃겨요', '李효리 새 예능 봤어요', '故 배우를 추모합니다', '祖國을 떠나 살면서']) {
  const p = paths(t)
  check(`🔴 J "${t}" → hanjaLanguageFit (정치 아님)`, blockedLanguage(p), JSON.stringify(p))
}
check('🔴 J 본문에만 한자가 있어도 언어 핏(상세 단계)',
  blockedLanguage(paths('예능 이야기 해요', '어제 본 장면이 故 배우 생각나게 했어요')))
check('🔵 J 한자가 없으면 언어 핏 사유 없음 — 한글 낱말 `한자` 는 한자 문자가 아니다',
  ['박나래 예능 너무 웃겨요', '이효리 새 예능 봤어요', '한자 공부 어떻게 하세요'].every((t) => {
    const p = paths(t); return !p.safetyCodes.includes(HANJA_LANGUAGE_FIT) && !p.flags.includes(HANJA_LANGUAGE_FIT) && passesAll(p)
  }))
check('🔴 J shared helper — 실제 한자 문자만(한글 · 영문 · 숫자 · 일본어 가나는 아니다)',
  findCjkIdeograph('朴') === '朴' && findCjkIdeograph('故 배우') === '故' && findCjkIdeograph('祖國') === '祖'
  && findCjkIdeograph('한자 공부') === null && findCjkIdeograph('abc 123 あいう カタ') === null && findCjkIdeograph('') === null)
check('🔴 J 최종 생성 제목 · 본문 — 적재 직전 관문이 한자 언어 핏으로 거절한다(정치 사유 아님)', (() => {
  const t = recheck('李효리 새 예능 봤어요', '본문입니다 우리 이야기', null)
  const b = recheck('새 예능 봤어요', '어제 본 故 배우 이야기', null)
  const ok = recheck('이효리 새 예능 봤어요', '본문입니다 우리 이야기', null)
  return t.some((x) => x.includes(HANJA_LANGUAGE_FIT)) && b.some((x) => x.includes(HANJA_LANGUAGE_FIT))
    && !ok.some((x) => x.includes(HANJA_LANGUAGE_FIT)) && !t.some((x) => /정치/.test(x))
})())

console.log('\nK 🔴 [downstream 배선 검사 — 의미 판정 결과를 fixture 로 주입 · 실제 모델 판정 검증 아님] 실제 위해 → 사유 코드가 따로 남아 차단')
{
  const harm: [string, SemanticVerdict['risks'], string][] = [
    ['주소 알아냈으니 다 같이 찾아가자', ['identifiablePrivatePerson', 'targetedHarassmentOrThreat'], 'targetedHarassmentOrThreat'],
    ['가서 악플로 도배합시다', ['targetedHarassmentOrThreat'], 'targetedHarassmentOrThreat'],
    ['저 사람은 죽여야 한다', ['targetedHarassmentOrThreat'], 'targetedHarassmentOrThreat'],
    ['아이 학교를 알아내서 공개하자', ['identifiablePrivatePerson'], 'identifiablePrivatePerson'],
    ['아무 근거는 없지만 저 배우는 범죄자임이 확실하다', ['unverifiedDefamation'], 'unverifiedDefamation'],
  ]
  for (const [t, risks, code] of harm) {
    const p = paths(t, '', risks)
    check(`🔴 K "${t}" → AUTO_DROP · ${code} (정치 · 언어 핏으로 위장하지 않는다)`,
      p.judge === 'AUTO_DROP' && p.judgeCodes.includes(code) && !p.judgeCodes.includes('politics')
      && !p.judgeCodes.includes(HANJA_LANGUAGE_FIT) && !p.politics, JSON.stringify(p))
  }
  // 🔴 경계 — 같은 연예 소재라도 비판은 통과 · 동원 · 위협 · 창작 단정만 막는다(판정은 의미 판정의 위해 사유 하나)
  check('🔵 K 경계 — "방송 태도가 별로였다"(위해 사유 없음) PASS · "가서 악플 달자"(괴롭힘 동원) BLOCK',
    passesAll(paths('그 배우 방송 태도가 별로였어요')) && paths('그 배우한테 가서 악플 달자', '', ['targetedHarassmentOrThreat']).judge === 'AUTO_DROP')
  check('🔵 K 경계 — 공개 보도된 논란 의견 PASS · 근거 없는 중대 의혹 창작 BLOCK',
    passesAll(paths('보도된 논란 기사 보고 실망했어요')) && paths('근거는 없지만 그 가수 마약 확실함', '', ['unverifiedDefamation']).judge === 'AUTO_DROP')
}

console.log('\nD 🔴 연예인 관련 위해 → 별도 hard gate (의미 판정 사유는 [downstream 배선 검사 — 결과 주입 · 실제 모델 검증 아님] · 집단 비하 · 신상 털기는 결정적)')
{
  const base = (title: string, risks: SemanticVerdict['risks']): string => {
    const s = safetyFilter({ title })
    return judgeOne({
      sourceSite: 'navercafe:wgang', sourceArticleId: '2', axis: SEED_AXIS, access: 'ok', lane: 'microSeedQuestion',
      assetAxes: '', safetyVerdict: s.verdict, safetyReasons: s.reasons.map((r) => r.code).join('|'), bodyLength: 800,
      qualityFlags: assessCandidate({ originalTitle: title, sourceCommentCount: 10, rawBody: '' }).flags as string[],
      title, bodyHead: '가'.repeat(120), commentCount: 10,
    } as JudgeInput, '2026-10-04T00:00:00.000Z', {
      verdict: { decision: 'AUTO_SEED', confidence: 0.9, risks, communityAngle: '이야기' }, status: 'ok',
      attemptCount: 1, providerErrorCode: null, model: 'm',
    }).decision
  }
  check('🔴 D 배우 이혼 사유를 불륜으로 단정(의미 판정 unverifiedDefamation) → AUTO_DROP',
    base('배우 OO 이혼 진짜 이유 불륜이래요', ['unverifiedDefamation']) === 'AUTO_DROP')
  check('🔴 D 가수 가족 사생활 폭로(identifiablePrivatePerson) → AUTO_DROP',
    base('가수 OO 아들 학교 어딘지 알아요', ['identifiablePrivatePerson']) === 'AUTO_DROP')
  check('🔴 D 방송인 괴롭힘 · 위협(targetedHarassmentOrThreat) → AUTO_DROP',
    base('방송인 OO 다들 가서 댓글로 혼내줘요', ['targetedHarassmentOrThreat']) === 'AUTO_DROP')
  check('🔴 D 연예인 신상 털기(결정적 안전 필터 personalIdentity) → 통과 아님',
    safetyFilter({ title: '배우 OO 신상 털어서 올렸더라구요' }).verdict !== 'pass')
  check('🔴 D 혐오 표현(결정적 안전 필터 hostility · 보호 대상 집단 비하) → drop · 사유 hostility',
    safetyFilter({ title: '연예인 OO 팬들 다 틀딱 맘충' }).verdict === 'drop'
    && safetyFilter({ title: '연예인 OO 팬들 다 틀딱 맘충' }).reasons.some((r) => r.code === 'hostility'))
  check('🔵 D 강한 호불호(극혐 · 고소각)는 주관적 의견이다 — hostility 아님',
    safetyFilter({ title: '그 예능 진짜 극혐이었어요' }).verdict !== 'drop' && safetyFilter({ title: '이건 고소각 아닌가요' }).verdict !== 'drop')
  check('🔵 D 같은 연예인 이름이라도 위해 신호가 없으면 통과 — 이름은 위해가 아니다',
    base('배우 OO 새 드라마 첫방 봤어요', []) !== 'AUTO_DROP')
}

console.log('\nE 🔴 정치인과 연예인이 함께 나온 정치 캠페인 → 차단')
for (const t of [
  '가수 김OO 이재명 후보 지지 선언 영상 보셨어요', '배우 OO 국민의힘 선거 유세 참여했대요',
  '방송인 OO 대선 투표 독려 캠페인 같이해요',
]) {
  const p = paths(t)
  check(`🔴 E "${t}" → 차단(연예인이 함께 있어도 정치가 이긴다)`, blockedEverywhere(p), JSON.stringify(p))
}

console.log('\n⑥ 소스 잠금 — 통합 판정 · 죽은 경로가 돌아오지 않는다')
{
  const live = [
    'scripts/lib/micro-seed-quality.mts', 'scripts/lib/micro-seed-navercafe.mts', 'scripts/lib/micro-seed-safety-filter.mts',
    'scripts/lib/micro-seed-scout-score.mts', 'scripts/lib/micro-seed-supply.mts', 'src/lib/micro-seed-auto-judge.ts',
    'src/lib/micro-seed-82cook-thin.ts', 'scripts/micro-seed-navercafe-thin.mts', 'scripts/micro-seed-collect-82cook.mts',
  ]
  check('🔴 수집기가 옛 통합 플래그 · 사유를 더 이상 만들지 않는다(문자열은 political-flags 의 legacy 이름에만)',
    live.every((p) => !/'politicalOrPublicFigure'|'publicFigureMention'|'publicFigure'/.test(strip(p))),
    live.filter((p) => /'politicalOrPublicFigure'|'publicFigureMention'|'publicFigure'/.test(strip(p))).join(','))
  const q = strip('scripts/lib/micro-seed-quality.mts')
  check('🔴 공인 사전에서 연예 · 방송 이름을 뺐다 — 정치 인물 사전만 남는다',
    !/KNOWN_PUBLIC_FIGURES/.test(q) && !/장영란|박수홍|채연|헬마우스/.test(q) && /KNOWN_POLITICAL_FIGURES/.test(q))
  check('🔴 직함 탐지는 정치 직함만 — 가수 · 배우 · 작가 · 감독 · 아나운서 · 기자 없음',
    !/(가수|배우|감독|아나운서|기자)\|/.test(q.slice(q.indexOf('const NAME_WITH_TITLE'), q.indexOf('const CLICKBAIT'))))
  check('🔴 82cook · 네이버카페 · 판정 · 안전 필터가 같은 정치 인물 판정을 쓴다',
    /findPoliticalFigureHits\(title\)/.test(strip('scripts/lib/micro-seed-safety-filter.mts'))
    && /isPoliticalFigureTitleFlag/.test(strip('src/lib/micro-seed-auto-judge.ts'))
    && /isPoliticalFigureTitleFlag/.test(strip('src/lib/micro-seed-82cook-thin.ts'))
    && /isPoliticalFigureTitleFlag/.test(strip('scripts/lib/micro-seed-navercafe.mts')))
  check('🔴 네이버카페 thin 의 죽은 정치 판정(사유 객체를 문자열로 비교 — 언제나 false)을 고쳤다',
    /reasons\.some\(\(x\) => x\.code === 'politics'\)/.test(strip('scripts/micro-seed-navercafe-thin.mts'))
    && !/String\(x\)\)\.includes/.test(strip('scripts/micro-seed-navercafe-thin.mts')))
  check('🔴 정치 주제 판정은 창업자 승인 목록 하나 그대로다(새 목록 없음)',
    findPoliticalTopicHit('국민의힘 지지율') !== null && findPoliticalFigureHits('이재명').length === 1)
  check('🔴 정치 authority 하나가 창업자 목록을 구조로 가른다 — 항상 정치 · 정책 문맥형(단어별 예외 배열 없음)',
    /const ALWAYS_POLITICAL_TERMS = \[/.test(q) && /const POLICY_DEBATE_TERMS = \[/.test(q)
    && /POLITICAL_TOPIC_TERMS = \[\.\.\.ALWAYS_POLITICAL_TERMS, \.\.\.POLICY_DEBATE_TERMS\]/.test(q)
    && !/POLICY_CONTEXT_TERMS/.test(q) && (q.match(/export function findPoliticalTopicHit/g) ?? []).length === 1)
  const sf = strip('scripts/lib/micro-seed-safety-filter.mts')
  const hostility = sf.slice(sf.indexOf('const HOSTILITY'), sf.indexOf('\n', sf.indexOf('const HOSTILITY') + 20) + 40)
  check('🔴 결정적 혐오 필터는 보호 대상 집단 비하만 — 일반 욕설 · 거친 감탄 · 위협 · 박제 낱말 없음(의미 판정 몫)',
    /틀딱/.test(hostility) && !/시발|발\||지랄|미친|꺼져|죽어라|패|박제|찢|쥐박|일베|메갈/.test(hostility), hostility)
  check('🔴 HANJA_NAME(한자 성 한 글자 = 정치인) 판정이 없다 — 한자는 언어 핏 하나가 본다',
    !/HANJA_NAME/.test(q) && findPoliticalFigureHits('朴나래 李효리').length === 0)
  const han = ['scripts/lib/micro-seed-quality.mts', 'scripts/lib/micro-seed-safety-filter.mts', 'src/lib/micro-seed-auto-judge.ts',
    'src/lib/micro-seed-82cook-thin.ts', 'scripts/micro-seed-supply-autofill.mts', 'scripts/lib/micro-seed-supply.mts']
  check('🔴 한자 정규식은 shared helper 하나(cjk-ideograph)에만 있다 — 다른 판정 파일에 복제 없음',
    han.every((p) => !/Script=Han|\\u4e00|一-龥|一-鿿/.test(strip(p))) && /\\p\{Script=Han\}/.test(strip('src/lib/cjk-ideograph.ts')))
  check('🔴 조국은 사람 문맥에서만 정치 인물 — 일반명사 조국은 아니다',
    findPoliticalTopicHit('조국 전 장관') === '조국' && findPoliticalTopicHit('내 조국을 떠나') === null && findPoliticalFigureHits('조국에 돌아가고').length === 0)
  check('📜 옛 저장 혼합 플래그 · 사유는 가를 수 없어 정치로 읽는다(fail-closed · 새로 만들지 않음)',
    readFlags(['politicalOrPublicFigure']).includes('politics')
    && gateOf({ sourceArticleId: 'l', originalTitle: 't', sourceExcludeReason: 'publicFigure' } as never).reason === 'politics')
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · provider 0 · 파일 write 0.')
if (fail > 0) process.exit(1)

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

let pass = 0
let fail = 0
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) { pass += 1; console.log(`  ✅ ${name}`) } else { fail += 1; console.log(`  🔴 FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const strip = (p: string): string => readFileSync(p, 'utf-8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '')

/** 🔴 수집 → 자동 상세 → 안전 필터 → 판정 → 82cook thin 이 한 제목을 어떻게 다루는가(실제 함수만) */
function paths(title: string, body = ''): {
  flags: string[]; politics: boolean; exclude: string | null; safety: string; judge: string; thin: string | null
  autoFetchSkipped: boolean
} {
  const flags = assessCandidate({ originalTitle: title, sourceCommentCount: 10, rawBody: body }).flags as string[]
  const safety = safetyFilter({ title, body })
  const judge = judgeOne({
    sourceSite: 'navercafe:wgang', sourceArticleId: '1', axis: SEED_AXIS, access: 'ok', lane: 'microSeedQuestion',
    assetAxes: '', safetyVerdict: safety.verdict, safetyReasons: safety.reasons.map((r) => r.code).join('|'),
    bodyLength: 800, qualityFlags: flags, title, bodyHead: '가'.repeat(120), commentCount: 10,
  } as JudgeInput, '2026-10-04T00:00:00.000Z', {
    verdict: { decision: 'AUTO_SEED', confidence: 0.9, risks: [], communityAngle: '같이 이야기' }, status: 'ok',
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
    judge: judge.decision,
    thin: thin.skipped[0]?.code ?? null,
    autoFetchSkipped: planAutoFetch([{ sourceArticleId: 'x', score: 50, flags }], { max: 10 }).picked.length === 0,
  }
}
const blockedEverywhere = (p: ReturnType<typeof paths>): boolean =>
  p.politics && p.exclude === 'politics' && p.safety === 'hardExclude' && p.judge === 'AUTO_DROP'
  && (p.thin === 'FLAG_POLITICS' || p.thin === 'POLITICS') && p.autoFetchSkipped
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

/**
 * ⚠️ **창업자 승인 정치 주제 목록의 `정책·법안` 묶음(PR-S2-b-15)** 에는 생활 정책 낱말이 들어 있다(최저임금 · 전세사기 ·
 *    상속세 · 유류세 · 연금개혁 · 종부세 · 의료대란 · 전공의 · 주52시간 …). P0-3 은 그 목록을 유지한다 — 바꾸는 것은
 *    창업자 결정이다. 그래서 여기서는 통과/실패가 아니라 **현재 막히는 생활 문장을 그대로 보여 준다**(숨기지 않는다).
 */
{
  const lifePolicy = ['최저임금 올라서 알바비 계산 어떻게 하세요', '전세사기 당할까 봐 걱정돼요', '상속세 신고 어떻게 하셨어요',
    '유류세 인하 끝나면 기름값 오를까요', '연금개혁 되면 우리 연금은 어떻게 되나요']
  for (const t of lifePolicy) console.log(`  ⚠️ 창업자 목록 정책어 — "${t}" → ${findPoliticalTopicHit(t) ?? '통과'}`)
}

console.log('\nD 🔴 연예인 관련 명예훼손 · 사생활 · 괴롭힘 → 별도 hard gate 가 막는다(공인 이름 판정이 아니다)')
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
  check('🔴 D 연예인 혐오 · 욕설(결정적 안전 필터 hostility) → drop',
    safetyFilter({ title: '연예인 OO 진짜 극혐 꺼져' }).verdict === 'drop')
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
  check('📜 옛 저장 혼합 플래그 · 사유는 가를 수 없어 정치로 읽는다(fail-closed · 새로 만들지 않음)',
    readFlags(['politicalOrPublicFigure']).includes('politics')
    && gateOf({ sourceArticleId: 'l', originalTitle: 't', sourceExcludeReason: 'publicFigure' } as never).reason === 'politics')
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
console.log('🔴 DB 0 · 네트워크 0 · provider 0 · 파일 write 0.')
if (fail > 0) process.exit(1)

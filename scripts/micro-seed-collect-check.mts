#!/usr/bin/env tsx
/**
 * 수집 품질 플래그 fixture — 네트워크 · DB · Sheet 없이 계약을 검증한다
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2-1 · §6-9-F · §6-10
 *
 * 🔴 이 파일이 검사하는 것은 "수집이 되는가" 가 아니라 **"넘지 말아야 할 선을 넘지 않는가"** 다.
 *    수집 성공은 --live 로 사람이 확인한다. 여기서 잠그는 것은 되돌리기 어려운 쪽이다.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ARTICLE_URL, computeDedupKey, buildCollected } from './lib/micro-seed-82cook.mjs'
import {
  assessCandidate, selectionScore, stripTruncationTail, linkCharRatioOf,
  DETAIL_ONLY_FLAGS, HIGH_ENGAGEMENT_MIN, SHORT_BODY_MAX, LINK_HEAVY_RATIO, SHORT_TITLE_MAX,
} from './lib/micro-seed-quality.mjs'

// 실측에서 가져온 본문 조각. 원문 전체가 아니라 판정에 필요한 최소만 둔다.
const BODY_4232047 = '장영란이 눈썹거상했다면서요\n\n저는 눈썹과 눈 사이는 먼 편인데 쌍꺼풀이 풀려서 시술 알아보는 중이에요. 피부과에서 얼마쯤 하는지 궁금해요'
const BODY_4232041 = '가보진 않았는데 창고형 약국이 있더라구요\n\n거기서 파는 약이나 영양제가 저렴한지 궁금해요'
const BODY_4232060 = '작년 연말에 결혼한 딸부부..\n\n둘이 쿵짝이 잘 맞아서 즐거운 건 알겠는데 저희 앞에서도 너무 해맑아서 가끔 당황스러워요. 사위가 착하긴 한데 어른 앞에서는 조금 조심했으면 싶기도 하고'
const BODY_4231985 = '제가 요며칠 계속 글썼던 사람입니다\n\n목구멍 이물감이 심해서 치과에 다녀왔어요. 턱관절 때문이라는데 증상이 나아지질 않네요'

const HERE = dirname(fileURLToPath(import.meta.url))
const report: Array<{ ok: boolean; kind: string; name: string; detail: string }> = []
const failures: string[] = []
const ok = (name: string, kind: string, detail: string) => report.push({ ok: true, kind, name, detail })
const bad = (name: string, kind: string, detail: string) => {
  report.push({ ok: false, kind, name, detail })
  failures.push(`${name} — ${detail}`)
}

// 🔴 ①~⑯(82cook 수집기 · importer · 예약 제안값) 는 그 코드와 함께 지웠다(2026-11-19).
//    남은 것은 네이버 수집물도 지나는 품질 플래그 룰 엔진(`micro-seed-quality`)의 계약이다.

// ── ⑰ 룰 엔진에 네트워크 · LLM · 난수가 없다 ────────────
//    🔴 비용을 만들지 않는 것이 Q-1 의 전제다. LLM 판단은 M4 의 일이다.
{
  const code = readFileSync(join(HERE, 'lib/micro-seed-quality.mts'), 'utf-8')
    .split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
  const offenders: string[] = []
  if (/\bfetch\s*\(|axios|node-fetch|https?:\/\//.test(code)) offenders.push('네트워크')
  if (/openai|anthropic|claude|gpt-|LLM|embedding/i.test(code)) offenders.push('LLM')
  if (/Math\.random|Date\.now|new Date\(/.test(code)) offenders.push('비결정성')
  if (/@prisma\/client|PrismaClient|prisma\./.test(code)) offenders.push('prisma')
  if (/googleapis|spreadsheets/.test(code)) offenders.push('Sheet')
  if (offenders.length) bad('룰 엔진 — 네트워크 · LLM · 난수 0', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('룰 엔진 — 네트워크 · LLM · 난수 0', 'guard', '순수 함수 · 같은 입력이면 같은 결과')
}

// ── ⑱ 목록 단계는 본문 플래그를 매기지 않는다 ───────────
//    🔴 "본문이 짧다" 와 "본문을 읽지 않았다" 는 다른 것이다.
//       목록에서 shortBody 를 붙이면 읽지도 않은 글을 짧다고 표시하게 된다.
{
  const list = assessCandidate({ originalTitle: '물로만 세안 3개월이 지났어요.', sourceCommentCount: 6, rawBody: '' })
  const detail = assessCandidate({ originalTitle: '물로만 세안 3개월이 지났어요.', sourceCommentCount: 6, rawBody: '짧은 본문' })
  const listClean = !list.flags.some((f) => (DETAIL_ONLY_FLAGS as readonly string[]).includes(f))
  const stageOk = list.stage === 'list' && detail.stage === 'detail'
  const bodyZero = list.signals.bodyLength === 0
  const detailFlagged = detail.flags.includes('shortBody')
  if (listClean && stageOk && bodyZero && detailFlagged) {
    ok('목록 단계는 본문 플래그를 매기지 않는다', 'policy', `list=${list.flags.join(',')} · stage 구분 O`)
  } else {
    bad('목록 단계는 본문 플래그를 매기지 않는다', 'policy',
      `clean=${listClean} stage=${stageOk} bodyZero=${bodyZero} detail=${detailFlagged}`)
  }
}

// ── ⑲ 임계값 경계 (1차값) ───────────────────────────────
//    🔴 이 값들은 실측 표본이 목록 25건 · 상세 4건뿐인 **1차값**이다.
//       후보 50건이 누적되면 재조정한다. 경계에서 흔들리지 않는지만 여기서 잠근다.
{
  const at = (comment: number, body: string, title = '우리 딸 학원 이야기') =>
    assessCandidate({ originalTitle: title, sourceCommentCount: comment, rawBody: body })
  const filler = '가'.repeat(400)
  const engageOff = !at(HIGH_ENGAGEMENT_MIN - 1, filler).flags.includes('highEngagement')
  const engageOn = at(HIGH_ENGAGEMENT_MIN, filler).flags.includes('highEngagement')
  const bodyOn = at(3, '가'.repeat(SHORT_BODY_MAX - 1)).flags.includes('shortBody')
  const bodyOff = !at(3, '가'.repeat(SHORT_BODY_MAX)).flags.includes('shortBody')
  const shortT = assessCandidate({ originalTitle: '가'.repeat(SHORT_TITLE_MAX - 1), sourceCommentCount: 1, rawBody: '' })
  const longT = assessCandidate({ originalTitle: '가'.repeat(SHORT_TITLE_MAX), sourceCommentCount: 1, rawBody: '' })
  const titleOk = shortT.flags.includes('shortTitle') && !longT.flags.includes('shortTitle')
  // 링크 비중 — URL 40자 / 전체 100자 = 40% 는 걸리고, 400자 중 40자 = 10% 는 안 걸린다
  const url = `https://example.com/${'a'.repeat(20)}`
  const heavy = at(3, `${url}${'가'.repeat(100 - url.length)}`).flags.includes('linkHeavyBody')
  const light = !at(3, `${url}${'가'.repeat(400 - url.length)}`).flags.includes('linkHeavyBody')
  const ratioOk = Math.abs(linkCharRatioOf(`${url}${'가'.repeat(100 - url.length)}`) - 0.4) < 0.001

  // 🔴 위 검사들은 상수를 **참조**한다 — 상수를 바꾸면 검사도 같이 움직여 아무것도 못 잡는다.
  //    (역검증에서 실제로 뚫렸다: SHORT_BODY_MAX 를 150→50 으로 바꿔도 통과했다)
  //    그래서 1차값 자체를 리터럴로 못박는다. 재조정할 때 이 줄도 같이 고치게 되고,
  //    그 diff 가 "임계값을 언제 왜 바꿨는지" 의 기록이 된다.
  const literals =
    HIGH_ENGAGEMENT_MIN === 5 && SHORT_BODY_MAX === 150 && LINK_HEAVY_RATIO === 0.3 && SHORT_TITLE_MAX === 8
  if (engageOff && engageOn && bodyOn && bodyOff && titleOk && heavy && light && ratioOk && literals) {
    ok('임계값 경계 — 1차값', 'policy',
      `댓글 ${HIGH_ENGAGEMENT_MIN} · 본문 ${SHORT_BODY_MAX} · 링크 ${LINK_HEAVY_RATIO} · 제목 ${SHORT_TITLE_MAX} (후보 50건 뒤 재조정)`)
  } else {
    bad('임계값 경계 — 1차값', 'policy',
      `engage=${engageOff && engageOn} body=${bodyOn && bodyOff} title=${titleOk} link=${heavy && light} ratio=${ratioOk} 1차값=${literals}`)
  }
}

// ── ⑳ 오탐 3종 회귀 (실측) ──────────────────────────────
//    🔴 한국어에는 단어 경계(\b)가 없다. 부분 문자열이 오탐을 만든다.
//       아래 셋은 전부 **실제 82cook 목록에서 나온** 오탐이다. 다시 생기면 여기서 잡는다.
{
  const offenders: string[] = []

  // (1) `전세계` 안의 `전세` 를 생활 어휘로 읽었다
  const a = assessCandidate({ originalTitle: '전세계 슈퍼쳇 1위. 유시민작가의 간곡한부탁', sourceCommentCount: 6, rawBody: '' })
  if (a.flags.includes('targetLikely')) offenders.push('전세계→전세')

  // (2) 목록 제목 말줄임(`…`)을 낚시성으로 읽었다
  const b = assessCandidate({ originalTitle: '초등 저학년 교육 시간 확대?…', sourceCommentCount: 1, rawBody: '' })
  if (b.flags.includes('clickbaitTitle')) offenders.push('말줄임→낚시')
  if (!b.flags.includes('titleTruncated')) offenders.push('말줄임 미표시')

  // (4) 실제 발행된 글의 잘린 꼬리(`도와주..`)를 낚시성으로 읽었다
  const d = assessCandidate({
    originalTitle: '턱관절치과 다녀온후..저 망한 게 맞는것 같아요 82님들 도와주..',
    sourceCommentCount: 5, rawBody: '',
  })
  if (d.flags.includes('clickbaitTitle')) offenders.push('발행글→낚시')

  // 겹친 꼬리(`넘어서길&q..`)를 끝까지 벗기는가
  const stem = stripTruncationTail('李대통령, 민주 지도부에 "서로 작은 차이 넘어서길&q..')
  if (!stem.truncated || /&q$|\.\.$/.test(stem.stem)) offenders.push('겹친 꼬리 미제거')

  if (offenders.length) bad('오탐 3종 회귀 — 실측', 'policy', `🔴 ${offenders.join(' / ')}`)
  else ok('오탐 3종 회귀 — 실측', 'policy', '전세계 · 말줄임 · 교회 목사 · 겹친 꼬리')
}

// ── ㉑ 실측 재현 — 창업자가 고른 3건이 위로 온다 ─────────
//    🔴 이것이 Q-1 의 존재 이유다. 룰이 사람의 판단을 재현하지 못하면 쓸모가 없다.
//
//    예전 정렬(댓글 많은 순)의 1순위는 `제주도관광 망하겠어요`(댓글 9) 였다.
//    상세까지 열고 **발행하지 않은 글**이다 — 본문 62자에 URL 이 65% 였다.
{
  // 실측 목록에서 가져온 6건. 앞 3건이 실제로 발행됐다.
  const sample = [
    { t: '물로만 세안 3개월이 지났어요.', c: 6, published: true },
    { t: '턱관절치과 다녀온후..저 망한 게 맞는것 같아요 82님들 도와주..', c: 5, published: true },
    { t: '항공과 승무원 학원', c: 4, published: true },
    { t: '제주도관광 망하겠어요', c: 9, published: false },
  ]
  const ranked = sample
    .map((x) => ({ ...x, score: selectionScore(assessCandidate({ originalTitle: x.t, sourceCommentCount: x.c, rawBody: '' })) }))
    .sort((a, b) => b.score - a.score)
  const top3 = ranked.slice(0, 3)
  const allPublished = top3.every((x) => x.published)
  // 댓글수 1위(제주도관광 9건)가 1등이 아니어야 한다 — 그것이 예전 정렬의 실패다
  const notCommentOnly = ranked[0].t !== '제주도관광 망하겠어요'
  const allKept = ranked.length === sample.length
  if (allPublished && notCommentOnly && allKept) {
    ok('실측 재현 — 발행 3건이 상위 3', 'policy', top3.map((x) => `${x.score}:${x.t.slice(0, 10)}`).join(' · '))
  } else {
    bad('실측 재현 — 발행 3건이 상위 3', 'policy',
      `top3발행=${allPublished} 댓글1위아님=${notCommentOnly} 전량유지=${allKept}`)
  }
}

// ── ㉒ 자동 거부가 늘지 않았다 ──────────────────────────
//    🔴 룰 엔진 자체가 거부를 표현하지 않는다 — 플래그는 순서 관측일 뿐이다
{
  const quality = readFileSync(join(HERE, 'lib/micro-seed-quality.mts'), 'utf-8')
  if (/\breject\b|\bdecline\b|\bblock\b|\bdrop\b/i.test(quality.replace(/^\s*[*/].*$/gm, ''))) {
    bad('룰 엔진에 거부 어휘가 없다', 'guard', '🔴 룰 엔진에 거부 어휘')
  } else ok('룰 엔진에 거부 어휘가 없다', 'guard', '플래그는 순서만 바꾼다')
}

// ── ㉓ 플래그가 붙어도 산출물은 온전하다 ─────────────────
//    🔴 최악의 후보(정치 · 실명 · 낚시 · 짧은 제목 · 링크 본문)도 버려지지 않는다.
{
  const worst = buildCollected(
    { sourceArticleId: '999', sourceUrl: ARTICLE_URL('999'), originalTitle: '李의원 충격!!', sourceCommentCount: 0 },
    'https://example.com/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 짧음',
    '2026-08-26T00:00:00.000Z',
  )
  const core = ['sourceSite','sourceUrl','sourceArticleId','sourceBoardName','sourceCommentCount',
    'originalTitle','rawBody','sourceCapturedAt','dedupKey'].every((k) => k in worst)
  const bodyKept = worst.rawBody.length > 0
  const titleKept = worst.originalTitle === '李의원 충격!!'
  const keyOk = worst.dedupKey === computeDedupKey('82cook', '999')
  const manyFlags = worst.qualityFlags.length >= 4
  const negative = selectionScore({ stage: 'detail', flags: worst.qualityFlags, signals: worst.qualitySignals }) < 0
  if (core && bodyKept && titleKept && keyOk && manyFlags && negative) {
    ok('플래그가 붙어도 산출물은 온전하다', 'guard', `${worst.qualityFlags.length}개 플래그 · 9필드 유지 · 점수만 음수`)
  } else {
    bad('플래그가 붙어도 산출물은 온전하다', 'guard',
      `core=${core} body=${bodyKept} title=${titleKept} key=${keyOk} flags=${manyFlags} score=${negative}`)
  }
}

// ── ㉔ 플래그마다 근거가 남는다 ─────────────────────────
//    🔴 "왜 이 플래그가 붙었는가" 를 사람이 검증할 수 없으면 룰을 고칠 수 없다.
{
  const b = assessCandidate({
    originalTitle: '우리 딸 학원 문제로 병원까지 다녀왔어요',
    sourceCommentCount: 6,
    rawBody: '제가 요며칠 증상이 심해서 치과에 다녀왔어요. 목구멍 이물감이 계속됩니다.',
  })
  const hasReason = (x: typeof b, flag: string) => (x.signals.matched[flag]?.length ?? 0) > 0
  const okB = hasReason(b, 'targetLikely') && hasReason(b, 'personalExperienceLikely') && hasReason(b, 'practicalConcernLikely')
  // 근거 없이 붙는 플래그가 없어야 한다 (근거를 남기는 종류에 한해)
  const reasoned = ['clickbaitTitle', 'targetLikely',
    'personalExperienceLikely', 'practicalConcernLikely', 'titleTruncated']
  const orphan = [b].flatMap((x) => x.flags.filter((f) => reasoned.includes(f) && !hasReason(x, f)))
  if (okB && !orphan.length) {
    ok('플래그마다 근거가 남는다', 'policy', `${JSON.stringify(b.signals.matched.targetLikely)}`)
  } else {
    bad('플래그마다 근거가 남는다', 'policy', `b=${okB} orphan=${orphan.join(',')}`)
  }
}

// ── ㉕ 잘린 제목은 플래그로 드러난다
{
  const truncFlag = assessCandidate({
    originalTitle: '트레이더스 럭스나인 메모리폼 토퍼 핫앤쿨 제품 온라인으로 안파나..',
    sourceCommentCount: 0, rawBody: '',
  }).flags.includes('titleTruncated')
  if (truncFlag) ok('잘린 제목은 플래그로 드러난다', 'guard', 'titleTruncated')
  else bad('잘린 제목은 플래그로 드러난다', 'guard', 'flag 없음')
}

// ── ㉖ 4232047 유형 — 본문 실명 · 의료 · 가격 ───────────
{
  const a = assessCandidate({ originalTitle: '눈썹거상은 얼마정도 할까요?', sourceCommentCount: 7, rawBody: BODY_4232047 })
  const missing: string[] = []
  for (const f of ['medicalOrAdLikely', 'quotedOrMediaLikely']) {
    if (!a.flags.includes(f as never)) missing.push(f)
  }
  const medReason = (a.signals.matched.medicalOrAdLikely ?? []).some((x) => x === '피부과' || x === '얼마')
  // 🔴 여전히 후보로 남는다 — 의료 · 전언 신호로 순서만 내려간다
  const kept = a.flags.length > 0
  if (!missing.length && medReason && kept) {
    ok('본문 위험 2종 — 4232047 유형', 'policy', `${selectionScore(a)}점`)
  } else {
    bad('본문 위험 3종 — 4232047 유형', 'policy',
      `missing=${missing.join(',')} med=${medReason} kept=${kept}`)
  }
}

// ── ㉗ 좋은 후보에는 위험 플래그가 붙지 않는다 ──────────
//    🔴 이쪽이 더 중요하다. 위험 플래그가 좋은 글에도 붙으면 소음이 되고,
//       소음이 되면 사람이 플래그를 안 본다 — 그 순간 이 엔진은 없는 것과 같다.
//
//    BODY_4231985 는 **실제로 발행한 글**이다(턱관절치과 경험담).
//    시설 어휘(`치과`)가 있지만 가격을 묻지 않는다. 그래서 medicalOrAdLikely 가 붙으면 안 된다.
{
  const good = assessCandidate({ originalTitle: '저도 작년에 사위 봤는데 많이 해맑아요', sourceCommentCount: 10, rawBody: BODY_4232060 })
  const published = assessCandidate({
    originalTitle: '턱관절치과 다녀온후..저 망한 게 맞는것 같아요 82님들 도와주..',
    sourceCommentCount: 5, rawBody: BODY_4231985,
  })
  const RISKY = ['medicalOrAdLikely', 'quotedOrMediaLikely']
  const goodClean = !good.flags.some((f) => RISKY.includes(f))
  const publishedClean = !published.flags.some((f) => RISKY.includes(f))
  const goodStrong = good.flags.includes('targetLikely') && good.flags.includes('personalExperienceLikely')
  const goodRanksHigher = selectionScore(good) > selectionScore(
    assessCandidate({ originalTitle: '눈썹거상은 얼마정도 할까요?', sourceCommentCount: 7, rawBody: BODY_4232047 }),
  )
  if (goodClean && publishedClean && goodStrong && goodRanksHigher) {
    ok('좋은 후보에는 위험 플래그가 안 붙는다', 'policy',
      `4232060=${selectionScore(good)}점 · 발행분(치과)도 깨끗`)
  } else {
    bad('좋은 후보에는 위험 플래그가 안 붙는다', 'policy',
      `good=${goodClean} published=${publishedClean} strong=${goodStrong} rank=${goodRanksHigher}`)
  }
}

// ── ㉘ medicalOrAdLikely 는 조합을 요구한다 ─────────────
//    시설·시술 어휘만으로 붙이면 "무릎 수술 후기" 같은 진짜 생활 고민까지 위험으로 칠한다.
//    가격을 묻는 순간 성격이 달라진다. 상업 유도는 그 자체로 신호다.
{
  const at = (t: string, b: string) => assessCandidate({ originalTitle: t, sourceCommentCount: 3, rawBody: b })
  const facilityOnly = !at('치과 다녀왔어요', '치과에서 스케일링 받고 왔어요. 증상이 나아졌으면 좋겠네요').flags.includes('medicalOrAdLikely')
  const withPrice = at('치과 스케일링', '치과에서 스케일링 얼마인가요?').flags.includes('medicalOrAdLikely')
  const promoAlone = at('영양제 공구해요', '이번에 공구 진행합니다. 참여하실 분 계신가요').flags.includes('medicalOrAdLikely')
  const priceAlone = !at('장 볼 때 얼마나 쓰세요', '요즘 장보면 얼마나 나오세요? 반찬값이 부담이에요').flags.includes('medicalOrAdLikely')
  if (facilityOnly && withPrice && promoAlone && priceAlone) {
    ok('medicalOrAdLikely 는 조합을 요구한다', 'policy', '시설만 ✕ · 시설+가격 ○ · 상업유도 단독 ○ · 가격만 ✕')
  } else {
    bad('medicalOrAdLikely 는 조합을 요구한다', 'policy',
      `시설만=${facilityOnly} 시설+가격=${withPrice} 유도단독=${promoAlone} 가격만=${priceAlone}`)
  }
}

// ── ㉙ 4232041 유형 — targetLikely 어휘 보강 ────────────
//    보강 전에는 `약국` 이 어휘에 없어 5점으로 하위권이었다. 사람이 보면 명백한 우리 또래 소재다.
{
  const a = assessCandidate({ originalTitle: '창고형 약국에서파는 약', sourceCommentCount: 7, rawBody: BODY_4232041 })
  const hasTarget = a.flags.includes('targetLikely')
  const reason = (a.signals.matched.targetLikely ?? []).includes('약국')
  // 전언체("가보진 않았는데")는 경험담과 분리해 표시된다
  const quoted = a.flags.includes('quotedOrMediaLikely')
  const notPersonal = !a.flags.includes('personalExperienceLikely')
  // 새 어휘가 실제로 들어갔는지 (오탐 방지: 낱말 단위로 확인)
  const vocab = ['약국', '약값', '영양제', '비타민', '건강검진', '관절'].every((w) =>
    assessCandidate({ originalTitle: `${w} 이야기입니다`, sourceCommentCount: 1, rawBody: '' }).flags.includes('targetLikely'))
  // 🔴 `영양제가` 안의 `제가` 를 1인칭으로 읽으면 안 된다 — 이 fixture 가 실제로 잡아낸 결함이다.
  //    `문제가` · `형제가` 도 같은 함정이다. 한국어에는 단어 경계가 없다.
  const noSubstring = ['영양제가 비싸요', '문제가 생겼어요', '형제가 많아요'].every((b) =>
    !assessCandidate({ originalTitle: '약국 이야기', sourceCommentCount: 1, rawBody: b })
      .flags.includes('personalExperienceLikely'))
  // 어절 앞의 `제가` 는 정상적으로 잡혀야 한다 (과잉 차단 방지)
  const stillWorks = assessCandidate({ originalTitle: '약국 이야기', sourceCommentCount: 1, rawBody: '제가 어제 다녀왔습니다' })
    .flags.includes('personalExperienceLikely')
  if (hasTarget && reason && quoted && notPersonal && vocab && noSubstring && stillWorks) {
    ok('targetLikely 어휘 보강 — 4232041 유형', 'policy',
      `${selectionScore(a)}점 · 약국·약값·영양제·비타민·건강검진·관절 · 영양제가≠제가`)
  } else {
    bad('targetLikely 어휘 보강 — 4232041 유형', 'policy',
      `target=${hasTarget} reason=${reason} quoted=${quoted} notPersonal=${notPersonal} vocab=${vocab} sub=${noSubstring} works=${stillWorks}`)
  }
}

// ── ㉚ 전언과 경험은 한 글에 같이 온다 ─────────────────
//    🔴 어느 한쪽으로 뭉개면 판단이 흐려진다.
//       4232047 은 "장영란이 …했다면서요"(전언)로 시작해 "저는 …싶어요"(경험)로 이어진다.
//       둘 다 표시해야 사람이 "남 얘기로 시작하지만 본인 고민이구나" 를 알 수 있다.
{
  const a = assessCandidate({ originalTitle: '눈썹거상은 얼마정도 할까요?', sourceCommentCount: 7, rawBody: BODY_4232047 })
  const bothShown = a.flags.includes('quotedOrMediaLikely') && a.flags.includes('personalExperienceLikely')
  // `더라구요` 는 본인 경험에도 쓰인다 — 전언으로 읽으면 오탐이다
  const noFalsePositive = !assessCandidate({
    originalTitle: '어제 다녀왔어요', sourceCommentCount: 2, rawBody: '가봤더니 사람이 많더라구요. 저는 다음에 또 가려구요',
  }).flags.includes('quotedOrMediaLikely')
  if (bothShown && noFalsePositive) {
    ok('전언과 경험은 분리해 표시한다', 'policy', '둘 다 표시 · `더라구요` 는 전언 아님')
  } else {
    bad('전언과 경험은 분리해 표시한다', 'policy', `both=${bothShown} noFP=${noFalsePositive}`)
  }
}

// ── 출력 ────────────────────────────────────────────────
console.log('\n수집 품질 플래그 — fixture 자기검증')
console.log('  이 fixture 는 네트워크 · DB · Sheet 를 타지 않는다\n')
const label: Record<string, string> = { policy: '[정책]  ', guard: '[가드]  ', parse: '[파싱]  ' }
for (const r of report) console.log(`  ${r.ok ? '✅' : '❌'} ${label[r.kind] ?? ''} ${r.name.padEnd(40)} → ${r.detail}`)
if (failures.length) {
  console.error(`\n❌ fixture ${failures.length}건 실패\n`)
  for (const f of failures) console.error(`  · ${f}`)
  console.error('')
  process.exit(1)
}
console.log(`\n✅ fixture ${report.length}건 전부 기대와 일치 — 수집 레일이 선을 넘지 않는다\n`)

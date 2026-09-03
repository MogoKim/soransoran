#!/usr/bin/env tsx
/**
 * 82cook 수집 레일 fixture — 네트워크 · DB · Sheet 없이 계약을 검증한다
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2-1 · §6-9-F · §6-10
 *
 * 🔴 이 파일이 검사하는 것은 "수집이 되는가" 가 아니라 **"넘지 말아야 할 선을 넘지 않는가"** 다.
 *    수집 성공은 --live 로 사람이 확인한다. 여기서 잠그는 것은 되돌리기 어려운 쪽이다.
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { roundUpToFiveMinutes, kstString, utcWallClock } from './lib/micro-seed-time.mjs'
import {
  SOURCE_SITE, BOARD_NAME, DELAY_MS, USER_AGENT, ARTICLE_URL, LIST_URL,
  computeDedupKey, parseRobotsTxt, isPathAllowed, toRobotsPath,
  parseListHtml, extractArticleBodyHtml, htmlToText, parseArticleTitle, buildCollected,
} from './lib/micro-seed-82cook.mjs'
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

// ── ① sourceSite 정본 ────────────────────────────────────
//    🔴 우나어 디렉터리명이 cook82 라고 해서 그 값을 새로 만들면 안 된다.
//       헌법과 기존 fixture 4곳이 82cook 을 쓴다. 갈라지면 R11 대조가 통째로 어긋난다.
{
  if (SOURCE_SITE !== '82cook') {
    bad('sourceSite 정본은 82cook 이다', 'policy', `🔴 ${SOURCE_SITE}`)
  } else {
    // 헌법 문서와 기존 fixture 에서 같은 값을 쓰는지 실제로 읽어 확인한다
    const constitution = readFileSync(join(HERE, '../docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md'), 'utf-8')
    const validate = readFileSync(join(HERE, 'micro-seed-validate.mjs'), 'utf-8')
    const inDoc = /`82cook`/.test(constitution)
    const inFixture = /sourceSite:\s*'82cook'/.test(validate)
    const noCook82 = !/sourceSite[^\n]*'cook82'/.test(validate)
    if (inDoc && inFixture && noCook82) ok('sourceSite 정본은 82cook 이다', 'policy', '헌법 · validate fixture 일치')
    else bad('sourceSite 정본은 82cook 이다', 'policy', `헌법=${inDoc} fixture=${inFixture} cook82없음=${noCook82}`)
  }
}

// ── ② dedupKey 형식 (§6-10) ─────────────────────────────
{
  const key = computeDedupKey(SOURCE_SITE, '4231986')
  const shape = /^sha256:[0-9a-f]{64}$/.test(key)
  // 같은 입력 → 같은 값 · 다른 입력 → 다른 값
  const stable = key === computeDedupKey(SOURCE_SITE, '4231986')
  const distinct = key !== computeDedupKey(SOURCE_SITE, '4231987')
  const siteMatters = key !== computeDedupKey('navercafe:x', '4231986')
  if (shape && stable && distinct && siteMatters) {
    ok('dedupKey 는 sha256:{hex} 표준이다', 'policy', `${key.slice(0, 20)}… (71자)`)
  } else {
    bad('dedupKey 는 sha256:{hex} 표준이다', 'policy', `shape=${shape} stable=${stable} distinct=${distinct} site=${siteMatters}`)
  }
}

// ── ③ write 0건 — 소스 검사 ─────────────────────────────
//    🔴 "안 쓴다" 를 사람이 기억하는 방식으로 두지 않는다.
{
  const files = ['micro-seed-collect-82cook.mts', 'lib/micro-seed-82cook.mts']
  const offenders: string[] = []
  for (const rel of files) {
    const raw = readFileSync(join(HERE, rel), 'utf-8')
    const code = raw.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
    if (/@prisma\/client|PrismaClient|prisma\./.test(code)) offenders.push(`${rel}: prisma 참조`)
    if (/updateCandidateRow|planSheetWrite|SHEET_WRITE_SCOPE|values:batchUpdate|:append\b/.test(code)) {
      offenders.push(`${rel}: Sheet write 경로`)
    }
    if (/post\.(create|update|delete|upsert)/.test(code)) offenders.push(`${rel}: Post write`)
    if (/micro-seed-publish-live|publish-lib/.test(code)) offenders.push(`${rel}: publisher 참조`)
  }
  if (offenders.length) bad('DB · Sheet · Post write 가 없다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('DB · Sheet · Post write 가 없다', 'guard', `${files.length}개 파일 검사 · prisma/Sheet/Post/publisher 참조 0`)
}

// ── ④ 네이버 세션 코드 미사용 ───────────────────────────
//    🔴 우나어는 창업자 개인 Chrome 프로필에서 NID_AUT/NID_SES 를 복호화해 쓴다.
//       그 경로를 이 레일에 들이지 않는다 — 개인 자격증명으로 회원 전용 글을 읽는 구조다.
{
  const files = ['micro-seed-collect-82cook.mts', 'lib/micro-seed-82cook.mts']
  const offenders: string[] = []
  for (const rel of files) {
    const code = readFileSync(join(HERE, rel), 'utf-8')
      .split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
    if (/NID_AUT|NID_SES|browser_cookie3|storageState|Cookies['"]?\s*\)|cafe\.naver\.com/.test(code)) {
      offenders.push(`${rel}: 네이버 세션/쿠키 흔적`)
    }
    if (/Chrome\/\d|Mozilla\/5\.0/.test(code)) offenders.push(`${rel}: Chrome 위장 User-Agent`)
    if (/randomDelay|Math\.random/.test(code)) offenders.push(`${rel}: 랜덤 지연(탐지 회피)`)
  }
  if (offenders.length) bad('네이버 세션 · 위장 UA · 랜덤 지연이 없다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('네이버 세션 · 위장 UA · 랜덤 지연이 없다', 'guard', '쿠키 0 · 위장 UA 0 · jitter 0')
}

// ── ⑤ robots · rate limit 이 실행에 드러난다 ────────────
{
  const code = readFileSync(join(HERE, 'micro-seed-collect-82cook.mts'), 'utf-8')
  const checksRobots = /parseRobotsTxt\(/.test(code) && /isPathAllowed\(/.test(code)
  const stopsOnBlock = /robots 가 막는 URL/.test(code) && /process\.exit\(1\)/.test(code)
  const printsPolicy = /요청 간격/.test(code) && /User-Agent:/.test(code)
  const fixedDelay = DELAY_MS > 0 && !/randomDelay/.test(code)
  const honestUa = USER_AGENT.startsWith('soransoran-') && !/Mozilla/.test(USER_AGENT)
  if (checksRobots && stopsOnBlock && printsPolicy && fixedDelay && honestUa) {
    ok('robots 확인 · 고정 지연 · 정직한 UA', 'guard', `${DELAY_MS}ms · ${USER_AGENT}`)
  } else {
    bad('robots 확인 · 고정 지연 · 정직한 UA', 'guard',
      `robots=${checksRobots} stop=${stopsOnBlock} print=${printsPolicy} fixed=${fixedDelay} ua=${honestUa}`)
  }
}

// ── ⑥ dry-run 기본 + kill switch ────────────────────────
{
  const code = readFileSync(join(HERE, 'micro-seed-collect-82cook.mts'), 'utf-8')
  const liveOptIn = /const LIVE = process\.argv\.includes\('--live'\)/.test(code)
  const switchGated = /const live = LIVE && enabled/.test(code)
  const noCron = !/cron|schedule|workflow/i.test(code.replace(/^\s*\*.*$/gm, ''))
  if (liveOptIn && switchGated && noCron) {
    ok('dry-run 기본 · kill switch · cron 없음', 'guard', '--live + SORAN_82COOK_COLLECT_ENABLED 둘 다 필요')
  } else {
    bad('dry-run 기본 · kill switch · cron 없음', 'guard', `live=${liveOptIn} switch=${switchGated} cron=${noCron}`)
  }
}

// ── ⑦ robots 파싱 (User-agent:* 만 본다) ────────────────
{
  const sample = [
    'User-agent: Googlebot', 'Disallow:', '',
    'User-agent: *', 'Disallow: /tempfile/', 'Disallow: /ajax/',
    'Disallow: /entiz/read.php?bn=15&num=1166440&page=6', '',
    'User-agent: KaBot', 'Disallow: /', '',
    'sitemap: http://www.82cook.com/sitemap.xml',
  ].join('\n')
  const rules = parseRobotsTxt(sample)
  const onlyStar = rules.disallow.length === 3 && rules.disallow.includes('/tempfile/') && !rules.disallow.includes('/')
  const allowsList = isPathAllowed(toRobotsPath(LIST_URL(1)), rules)
  const allowsArticle = isPathAllowed(toRobotsPath(ARTICLE_URL('4231986')), rules)
  const blocksNamed = !isPathAllowed('/entiz/read.php?bn=15&num=1166440&page=6', rules)
  const blocksAjax = !isPathAllowed('/ajax/x', rules)
  if (onlyStar && allowsList && allowsArticle && blocksNamed && blocksAjax) {
    ok('robots 파싱 — * 섹션만 · 접두 매칭', 'parse', `Disallow ${rules.disallow.length}건 · KaBot 의 / 를 삼키지 않는다`)
  } else {
    bad('robots 파싱 — * 섹션만 · 접두 매칭', 'parse',
      `star=${onlyStar} list=${allowsList} article=${allowsArticle} named=${blocksNamed} ajax=${blocksAjax}`)
  }
}

// ── ⑧ 목록 파싱 — photolink 중복을 접는다 ───────────────
{
  const html = `
    <td class="title">
      <a href="read.php?bn=15&num=4231986&page=1" class="photolink">1836186</a>
      <a href="read.php?bn=15&num=4231986&page=1">&#48708;&#48128;&amp;제목 <b>강조</b></a>
      <em>34</em>
    </td>
    <td class="title">
      <a href="read.php?bn=15&num=4231985&page=1">댓글 없는 글</a>
    </td>`
  const items = parseListHtml(html)
  const single = items.length === 2
  const first = items[0]
  const merged = first?.sourceArticleId === '4231986' && first?.sourceCommentCount === 34
  const decoded = first?.originalTitle === '비밀&제목 강조'
  const urlBuilt = first?.sourceUrl === ARTICLE_URL('4231986')
  const zeroComment = items[1]?.sourceCommentCount === 0
  if (single && merged && decoded && urlBuilt && zeroComment) {
    ok('목록 파싱 — 중복 접기 · 엔티티 · 댓글수', 'parse', `${items.length}건 · 댓글 ${first.sourceCommentCount}`)
  } else {
    bad('목록 파싱 — 중복 접기 · 엔티티 · 댓글수', 'parse',
      `n=${items.length} merged=${merged} decoded=${decoded}(${first?.originalTitle}) url=${urlBuilt} zero=${zeroComment}`)
  }
}

// ── ⑨ 본문 추출 — 중첩 div 에서 잘리지 않는다 ───────────
//    🔴 non-greedy 정규식이면 첫 </div> 에서 끊겨 본문 일부만 가져온다.
//       그 상태로 발행되면 원문이 훼손된 채 우리 이름으로 나간다.
{
  const html = `<div id="articleBody"> <p>앞</p><div class="quote"><p>인용</p></div><p>뒤</p> </div><div>바깥</div>`
  const body = extractArticleBodyHtml(html)
  const kept = body !== null && /앞/.test(body) && /인용/.test(body) && /뒤/.test(body) && !/바깥/.test(body)
  const missing = extractArticleBodyHtml('<div id="other"></div>') === null
  if (kept && missing) ok('본문 추출 — 중첩 div 균형', 'parse', '앞·인용·뒤 보존 · 바깥 제외')
  else bad('본문 추출 — 중첩 div 균형', 'parse', `kept=${kept} missing=${missing} body=${JSON.stringify(body)}`)
}

// ── ⑩ 텍스트화 — 이미지 흔적 0 · 링크 href 제거 ─────────
{
  const text = htmlToText(
    '<p>첫 줄<br>둘째 줄</p><img src="https://x/a.jpg" alt="사진"><p><a href="https://x/link">링크글자</a></p>' +
      '<script>bad()</script><p>&nbsp;끝</p>',
  )
  const noImg = !/x\/a\.jpg|<img|사진/.test(text)
  const noHref = !/https:\/\/x\/link/.test(text) && /링크글자/.test(text)
  const noScript = !/bad\(\)/.test(text)
  const lineBreak = /첫 줄\n둘째 줄/.test(text)
  if (noImg && noHref && noScript && lineBreak) {
    ok('텍스트화 — 이미지·href·script 제거', 'parse', JSON.stringify(text.slice(0, 30)))
  } else {
    bad('텍스트화 — 이미지·href·script 제거', 'parse',
      `img=${noImg} href=${noHref} script=${noScript} br=${lineBreak} → ${JSON.stringify(text)}`)
  }
}

// ── ⑪ 산출물 스키마 — Micro Seed 필드명과 일치 ──────────
{
  const item = { sourceArticleId: '4231986', sourceUrl: ARTICLE_URL('4231986'), originalTitle: '제목', sourceCommentCount: 34 }
  const c = buildCollected(item, '본문', '2026-08-26T00:00:00.000Z')
  // 🔴 앞 9필드는 Micro Seed 원장 이름 그대로다. 뒤 2필드는 선별 보조이며
  //    importer 가 읽지 않는다 — 원장에도 Sheet 17열에도 들어가지 않는다 (Q-1).
  const want = ['sourceSite', 'sourceUrl', 'sourceArticleId', 'sourceBoardName', 'sourceCommentCount',
    'originalTitle', 'rawBody', 'sourceCapturedAt', 'dedupKey', 'qualityFlags', 'qualitySignals']
  const missing = want.filter((k) => !(k in c))
  const siteOk = c.sourceSite === '82cook'
  const boardOk = c.sourceBoardName === BOARD_NAME
  const keyOk = c.dedupKey === computeDedupKey('82cook', '4231986')
  const flagsArray = Array.isArray(c.qualityFlags)
  if (!missing.length && siteOk && boardOk && keyOk && flagsArray) {
    ok('산출물 스키마 — 11필드 · Micro Seed 이름', 'parse', want.join(' · '))
  } else {
    bad('산출물 스키마 — 11필드 · Micro Seed 이름', 'parse',
      `missing=${missing.join(',')} site=${siteOk} board=${boardOk} key=${keyOk} flags=${flagsArray}`)
  }
}

// ── ⑫ 제목 파싱 ─────────────────────────────────────────
{
  const t = parseArticleTitle('<h4 class="title bbstitle"><i class="icon"></i><span>제목 &amp; 기호</span></h4>')
  if (t === '제목 & 기호') ok('상세 제목 파싱', 'parse', t)
  else bad('상세 제목 파싱', 'parse', String(t))
}

// ── ⑬ 목록 산출물도 필드가 갖춰진다 (2026-08-26 실측 결함) ──
//    🔴 목록 저장이 buildCollected 를 거치지 않아 sourceBoardName · sourceCapturedAt 이
//       빠져 있었다. 상세는 9필드인데 목록은 6필드였고, 목록 파일을 importer 에 넘기면
//       두 칸이 빈 채로 원장에 들어간다. 정규화 경로를 하나로 두고 여기서 잠근다.
{
  const code = readFileSync(join(HERE, 'micro-seed-collect-82cook.mts'), 'utf-8')
    .split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
  // 목록 저장이 buildCollected 산출물(rows)을 그대로 넘기는지 본다.
  // 손으로 만든 객체 리터럴을 넘기면 필드가 빠진다 — 그것이 원래 결함이었다.
  const usesBuilder = /const rows = items\.map\(\(i\) => buildCollected\(/.test(code)
  const writesRows = /writeJsonl\(listPath, rows\)/.test(code)
  const noHandRolled = !/writeJsonl\(listPath, items\.map\(\(i\) => \(\{/.test(code)
  // 실제 산출물 모양도 확인한다 — rawBody 는 빈 문자열이어야 한다
  const listRow = buildCollected(
    { sourceArticleId: '1', sourceUrl: ARTICLE_URL('1'), originalTitle: 't', sourceCommentCount: 0 },
    '', '2026-08-26T00:00:00.000Z',
  )
  const has11 = ['sourceSite','sourceUrl','sourceArticleId','sourceBoardName','sourceCommentCount',
    'originalTitle','rawBody','sourceCapturedAt','dedupKey','qualityFlags','qualitySignals']
    .every((k) => k in listRow)
  const emptyBody = listRow.rawBody === ''
  if (usesBuilder && writesRows && noHandRolled && has11 && emptyBody) {
    ok('목록 산출물도 11필드를 갖춘다', 'guard', 'buildCollected 경로 · rawBody 는 빈 값')
  } else {
    bad('목록 산출물도 11필드를 갖춘다', 'guard',
      `builder=${usesBuilder} rows=${writesRows} noHand=${noHandRolled} fields11=${has11} emptyBody=${emptyBody}`)
  }
}

// ── ⑭ importer 소스 계약 ────────────────────────────────
{
  const raw = readFileSync(join(HERE, 'micro-seed-import-82cook-live.mts'), 'utf-8')
  const code = raw.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [
    {
      // 🔴 2026-09-03 (PR-S2) — 레인이 둘로 나뉘며 판정식이 planSupplyMode 로 옮겨갔다.
      //    계약 자체는 그대로다: **스위치 하나로는 아무것도 쓰이지 않는다.**
      //    바뀐 것은 그 판정을 어디서 하느냐이고, 이 검사는 그것이 **한 곳**인지까지 본다.
      name: 'dry-run 기본 · 스위치 두 개를 요구한다',
      ok: /const APPLY = process\.argv\.includes\('--apply'\)/.test(code) &&
          /planSupplyMode\(\{ apply: APPLY/.test(code) &&
          /const WRITE_DB = PLAN\.mode !== 'dry-run'/.test(code) &&
          /if \(!WRITE_DB\)/.test(code) &&
          // 🔴 판정을 두 곳에 쓰지 않는다. 갈라지는 쪽이 Sheet 에 배치를 꽂는다
          !/APPLY && LIMIT === 1/.test(code),
      detail: '판정은 planSupplyMode 한 곳 · --apply 하나로는 안 쓴다',
    },
    {
      // 🔴 PR-S2 신설 — raw-only 레인이 승인 게이트를 우회하지 못하게 한다
      name: 'raw-only 는 Candidate·Sheet 를 만들지 않는다',
      ok: /const RAW_ONLY = process\.argv\.includes\('--raw-only'\)/.test(code) &&
          // Sheet 를 읽지도 않는다 — 읽기 경로가 살아 있으면 언젠가 쓰기로 이어진다
          /if \(RAW_ONLY\) \{[\s\S]{0,200}?Sheet: 접근하지 않는다/.test(code) &&
          // raw-only 분기에서 RawContent 만 만든다
          /if \(RAW_ONLY\) \{[\s\S]{0,900}?microSeedRawContent\.create/.test(code) &&
          !/if \(RAW_ONLY\) \{[\s\S]{0,900}?microSeedCandidate\.create/.test(code) &&
          !/if \(RAW_ONLY\) \{[\s\S]{0,900}?updateCandidateRow/.test(code),
      detail: '재료만 넣는 문은 승인 게이트를 지나지 않는다',
    },
    {
      // 🔴 PR-S2 신설 — 배치가 Sheet 레인으로 새지 않는다
      name: '모호한 인자 조합은 거부한다',
      ok: /PLAN\.fatal !== null/.test(code) &&
          /process\.exit\(1\)/.test(code) &&
          /violatesSupplyInvariant\(PLAN\)/.test(code),
      detail: '--batch 단독 · --raw-only --limit 을 통과시키지 않는다',
    },
    {
      name: 'JSONL 중복은 dedupKey 로 접는다',
      ok: /byKey\.set\(row\.dedupKey/.test(code) && /DUPLICATE_IN_JSONL/.test(code),
      detail: '중복은 오류가 아니라 진단',
    },
    {
      // 🔴 2026-09-03 (PR-S2-b-1) — 소스가 둘이 되며 판정이 judgeSourceSite 로 옮겨갔다.
      //    계약은 그대로다: **정본 외 출처를 원장에 들이지 않는다.**
      //    바뀐 것은 "정본" 이 82cook 하나에서 82cook + navercafe:* 로 늘어난 것이고,
      //    Micro Seed Sheet 레인은 여전히 82cook 하나다.
      name: '정본 외 sourceSite 를 원장에 들이지 않는다',
      ok: /judgeSourceSite\(row\.sourceSite, INTENDED_LANE\)/.test(code) &&
          /if \(!src\.ok\)/.test(code) &&
          // 🔴 판정을 두 곳에 쓰지 않는다 — 갈라지는 쪽이 네이버를 Sheet 레인에 넣는다
          !/row\.sourceSite !== SOURCE_SITE/.test(code),
      detail: 'judgeSourceSite 한 곳 · 레인별로 받는 소스가 다르다',
    },
    {
      // 🔴 PR-S2-b-1 신설 — 네이버가 Sheet 승인 게이트로 새지 않게 한다
      name: '네이버는 raw-only 전용이다',
      ok: /const INTENDED_LANE: SupplyMode = RAW_ONLY \? 'raw-only' : 'micro-seed'/.test(code),
      detail: 'dry-run 도 의도한 레인으로 판정한다 — apply 결과를 정직하게 예고한다',
    },
    {
      name: 'dedupKey 를 재계산해 대조한다',
      ok: /computeDedupKey\(row\.sourceSite, id\)/.test(code) && /row\.dedupKey !== expectKey/.test(code),
      detail: '입력 파일의 값을 믿지 않는다 (§6-10 0차)',
    },
    {
      name: 'rawBody 가 비면 거부 (목록 파일 오투입)',
      ok: /rawBody\.trim\(\)/.test(code) && /상세 fetch 산출물을 준다/.test(raw),
      detail: '목록 JSONL 을 잘못 넘겨도 적재되지 않는다',
    },
    {
      name: 'DB · Sheet 중복을 쓰기 전에 확인한다',
      // 🔴 문자열이 있는지가 아니라 **위치**를 본다.
      //    ALREADY_IN_DB 는 두 곳(candidate · raw)에 있어서 하나만 지워도
      //    단순 포함 검사는 통과한다 — 역검증에서 실제로 뚫렸다.
      //    중복 조회 세 개가 전부 create 보다 **앞**에 있어야 멱등하다.
      ok: (() => {
        const write = code.indexOf('$transaction(async (tx)')
        const cand = code.indexOf('microSeedCandidate.findFirst')
        const raw = code.indexOf('microSeedRawContent.findFirst')
        const sheet = code.indexOf('sheetKeys.has(row.dedupKey)')
        return [cand, raw, sheet].every((i) => i !== -1 && i < write) && write !== -1
      })(),
      detail: '조회 3종이 전부 create 앞에 있다',
    },
    {
      name: 'Sheet 는 bootstrap 모드 · append 없음',
      ok: /mode:\s*'bootstrap'/.test(code) && !/:append\b/.test(code) && !/appendRow/.test(code),
      detail: '빈 행을 찾아 그 자리에 쓴다',
    },
    {
      name: 'postUrl · updatedBySystemAt 공란 강제',
      ok: /postUrl:\s*''/.test(code) && /updatedBySystemAt:\s*''/.test(code),
      detail: '발행 전 흔적을 남기지 않는다',
    },
    {
      name: 'HOLD 로만 적재한다',
      ok: /INITIAL_STATUS = 'HOLD'/.test(code) &&
          !/'PENDING'/.test(code) && !/'PUBLISHED'/.test(code),
      detail: 'PENDING · PUBLISHED 로 가는 경로가 없다',
    },
    {
      name: 'Post 를 만들지 않는다',
      ok: !/post\.(create|update|delete|upsert)/.test(code) && !/publish-live|publish-lib/.test(code),
      detail: '발행은 publisher 의 일이다',
    },
    {
      name: 'RawContent origin 은 live 고정',
      ok: /origin:\s*'live'/.test(code) && !/unao_legacy/.test(code),
      detail: '§10-1 · 정책 12',
    },
    {
      name: 'board 는 free · FREE 고정',
      // 🔴 주석의 설명("magazine·best 로 갈 경로를 만들지 않는다")까지 잡으면 안 된다.
      //    막을 것은 **값으로 쓰이는** 것이다 — 따옴표 안의 리터럴만 본다.
      ok: /BOARD_SHEET_VALUE = 'free'/.test(code) && /BOARD_TYPE = 'FREE'/.test(code) &&
          !/'(magazine|MAGAZINE|BEST|best)'/.test(code),
      detail: '§6-9-D 화이트리스트',
    },
    {
      name: '네이버 세션 · cron 흔적이 없다',
      // 🔴 scheduledPublishAt 은 Sheet 필드명이다. `schedule` 로 잡으면 오탐이다 —
      //    막을 것은 크론 배선이지 필드 이름이 아니다.
      ok: !/NID_AUT|NID_SES|browser_cookie3|storageState|cafe\.naver/.test(code) &&
          !/\bcron\b/i.test(code) && !/node-cron|setInterval|CronJob/.test(code),
      detail: '§6-9-F · 개인 자격증명 미사용',
    },
  ]
  const bad2 = checks.filter((c) => !c.ok)
  if (bad2.length === 0) ok('importer 소스 계약', 'guard', `${checks.length}종 전부`)
  else bad('importer 소스 계약', 'guard', `🔴 ${bad2.map((c) => `${c.name}(${c.detail})`).join(' / ')}`)
}

// ── ⑮ 예약 제안값 (B-1) ─────────────────────────────────
//
//    🔴 제안값이지 확정이 아니다. status 는 HOLD 로 남고 창업자가 Sheet F열에서 고친다.
//       비워 두면 매 발행마다 reschedule 을 따로 돌려야 하고 그때부터 20분을 기다린다 —
//       적재 시점에 넣어 두면 그 대기가 절차에 흡수된다.
{
  const NOW = new Date('2026-08-26T00:00:00Z') // = 09:00 KST
  const cases = [
    { name: '기본 8분 → 09:10 으로 올림', min: 8, expectKst: '2026-08-26 09:10' },
    { name: '+6분 → 09:10 으로 올림', min: 6, expectKst: '2026-08-26 09:10' },
    { name: '+11분 → 09:15 로 올림', min: 11, expectKst: '2026-08-26 09:15' },
    { name: '--in=30 반영 (창업자 직접 승인용)', min: 30, expectKst: '2026-08-26 09:30' },
    { name: '--in=40 반영', min: 40, expectKst: '2026-08-26 09:40' },
    { name: '--in=90 반영', min: 90, expectKst: '2026-08-26 10:30' },
  ]
  const wrong = cases.filter(
    (c) => kstString(roundUpToFiveMinutes(new Date(NOW.getTime() + c.min * 60_000))) !== c.expectKst,
  )
  if (wrong.length === 0) {
    ok('예약 제안 — 5분 올림 · --in 반영', 'policy', `${cases.length}종 전부`)
  } else {
    bad('예약 제안 — 5분 올림 · --in 반영', 'policy',
      `🔴 ${wrong.map((c) => `${c.name} → ${kstString(roundUpToFiveMinutes(new Date(NOW.getTime() + c.min * 60_000)))}`).join(' / ')}`)
  }

  // 🔴 DB 는 UTC, Sheet 는 KST 다. 같은 순간을 가리켜야 한다 —
  //    한쪽만 어긋나면 승인과 발행이 다른 시각을 본다.
  const at = roundUpToFiveMinutes(new Date(NOW.getTime() + 8 * 60_000))
  const kst = kstString(at)
  const utc = utcWallClock(at)
  const sameInstant = new Date(`${utc.replace(' ', 'T')}Z`).getTime() === at.getTime()
  const kstIsNineHoursAhead =
    new Date(`${utc.replace(' ', 'T')}Z`).getTime() + 9 * 3600_000 ===
    new Date(`${kst.replace(' ', 'T')}:00Z`).getTime()
  if (sameInstant && kstIsNineHoursAhead) {
    ok('예약 제안 — DB(UTC) 와 Sheet(KST) 가 같은 순간', 'policy', `${kst} KST = ${utc} UTC`)
  } else {
    bad('예약 제안 — DB(UTC) 와 Sheet(KST) 가 같은 순간', 'policy', `same=${sameInstant} offset=${kstIsNineHoursAhead}`)
  }
}

// ── ⑯ importer 예약 소스 계약 ───────────────────────────
{
  const raw = readFileSync(join(HERE, 'micro-seed-import-82cook-live.mts'), 'utf-8')
  const code = raw.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [
    {
      // 🔴 값을 fixture 에 박는다. 실측 근거로 정한 값이라 조용히 바뀌면 안 된다
      //    (2026-08-26: 승인 80초 실측 → 25분은 과했다).
      name: '기본 8분 · --in 으로 조정',
      ok: /SCHEDULE_DEFAULT_MINUTES = 8\b/.test(code) && /startsWith\('--in='\)/.test(code),
      detail: '제안 간격 (창업자 직접 승인은 --in=30)',
    },
    {
      // 🔴 2026-09-03 (PR-S2) — raw-only 는 Candidate 를 안 만들어 예약 자체가 없다.
      //    조건이 `RAW_ONLY || NO_SCHEDULE` 로 늘었을 뿐 계약은 그대로다.
      name: '--no-schedule · raw-only 면 비운다',
      ok: /NO_SCHEDULE = process\.argv\.includes\('--no-schedule'\)/.test(code) &&
          /RAW_ONLY \|\| NO_SCHEDULE[\s\S]{0,40}\? null/.test(code) &&
          /proposed \? kstString\(proposed\) : ''/.test(code),
      detail: 'DB null · Sheet 공란 · raw-only 는 예약 없음',
    },
    {
      name: '5분 올림을 공용 함수로 쓴다',
      ok: /roundUpToFiveMinutes\(/.test(code) && !/setUTCMinutes|% 5/.test(code),
      detail: '계산을 다시 적지 않는다 (C-2)',
    },
    {
      name: 'status 는 HOLD 로 남는다',
      ok: /INITIAL_STATUS = 'HOLD'/.test(code) && !/'PENDING'/.test(code) && !/'PUBLISHED'/.test(code),
      detail: '예약을 넣어도 승인되지 않는다',
    },
    {
      name: '예약 read-back 을 검증한다',
      ok: /예약 read-back 불일치/.test(raw) && /dbKst !== sheetKst/.test(code),
      detail: 'DB(UTC) 와 Sheet(KST) 가 같은 순간인지',
    },
    {
      name: 'status read-back 도 본다',
      ok: /back\.status !== INITIAL_STATUS/.test(code),
      detail: '적재 중 상태가 바뀌지 않았는가',
    },
    {
      name: 'Post · publisher 경로가 없다',
      ok: !/post\.(create|update|delete)/.test(code) && !/publish-live|publish-lib/.test(code),
      detail: '적재는 발행이 아니다',
    },
  ]
  const bad5 = checks.filter((c) => !c.ok)
  if (bad5.length === 0) ok('importer 예약 계약', 'guard', `${checks.length}종 전부`)
  else bad('importer 예약 계약', 'guard', `🔴 ${bad5.map((c) => `${c.name}(${c.detail})`).join(' / ')}`)
}

// ══════════════════════════════════════════════════════════
// Q-1 품질 플래그 (M2 Source Quality Engine v0)
//
// 🔴 여기서 잠그는 것은 "플래그가 잘 붙는가" 가 아니라
//    **"선별 보조 엔진이 거부 엔진으로 변질되지 않았는가"** 다.
//    창업자가 명시적으로 금지한 방향이 바로 그것이다.
// ══════════════════════════════════════════════════════════

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
  // 🔴 본문에 이름이 있어도 목록 단계에서는 붙지 않아야 한다 — 본문을 읽지 않았기 때문이다
  const listNoFigure = !assessCandidate({
    originalTitle: '눈썹거상은 얼마정도 할까요?', sourceCommentCount: 7, rawBody: '',
  }).flags.includes('publicFigureMention')
  const stageOk = list.stage === 'list' && detail.stage === 'detail'
  const bodyZero = list.signals.bodyLength === 0
  const detailFlagged = detail.flags.includes('shortBody')
  if (listClean && listNoFigure && stageOk && bodyZero && detailFlagged) {
    ok('목록 단계는 본문 플래그를 매기지 않는다', 'policy', `list=${list.flags.join(',')} · stage 구분 O`)
  } else {
    bad('목록 단계는 본문 플래그를 매기지 않는다', 'policy',
      `clean=${listClean} figure=${listNoFigure} stage=${stageOk} bodyZero=${bodyZero} detail=${detailFlagged}`)
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
  if (!a.flags.includes('politicalOrPublicFigure')) offenders.push('유시민작가 미탐지')

  // (2) 목록 제목 말줄임(`…`)을 낚시성으로 읽었다
  const b = assessCandidate({ originalTitle: '초등 저학년 교육 시간 확대?…', sourceCommentCount: 1, rawBody: '' })
  if (b.flags.includes('clickbaitTitle')) offenders.push('말줄임→낚시')
  if (!b.flags.includes('titleTruncated')) offenders.push('말줄임 미표시')

  // (3) `교회 목사` 의 `교회` 를 사람 이름으로 읽었다
  const c = assessCandidate({ originalTitle: '진짜 교회 목사 자녀들은 유학을 왜그리들 가는지', sourceCommentCount: 0, rawBody: '' })
  if (c.flags.includes('politicalOrPublicFigure')) offenders.push('교회 목사→실명')

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
    { t: '李대통령, 민주 지도부에 "서로 작은 차이 넘어서길&q..', c: 8, published: false },
    { t: '유시민 \'李 저격\'에 친명계 폭발 ..친명계 "개가 짖..', c: 0, published: false },
  ]
  const ranked = sample
    .map((x) => ({ ...x, score: selectionScore(assessCandidate({ originalTitle: x.t, sourceCommentCount: x.c, rawBody: '' })) }))
    .sort((a, b) => b.score - a.score)
  const top3 = ranked.slice(0, 3)
  const allPublished = top3.every((x) => x.published)
  // 댓글수 1위(제주도관광 9건)가 1등이 아니어야 한다 — 그것이 예전 정렬의 실패다
  const notCommentOnly = ranked[0].t !== '제주도관광 망하겠어요'
  // 정치·실명은 아래로 내려간다 (버리는 것이 아니라 순서만 뒤로)
  const politicsLast = ranked.slice(-2).every((x) => /李|유시민/.test(x.t))
  const allKept = ranked.length === sample.length
  if (allPublished && notCommentOnly && politicsLast && allKept) {
    ok('실측 재현 — 발행 3건이 상위 3', 'policy', top3.map((x) => `${x.score}:${x.t.slice(0, 10)}`).join(' · '))
  } else {
    bad('실측 재현 — 발행 3건이 상위 3', 'policy',
      `top3발행=${allPublished} 댓글1위아님=${notCommentOnly} 정치하위=${politicsLast} 전량유지=${allKept}`)
  }
}

// ── ㉒ 자동 거부가 늘지 않았다 ──────────────────────────
//    🔴 창업자가 명시적으로 금지한 방향이다.
//       정치성 · 실명 · 낮은 댓글수 · 낚시성 제목 · 짧은 본문은 **거부하지 않는다**.
{
  const code = readFileSync(join(HERE, 'micro-seed-collect-82cook.mts'), 'utf-8')
    .split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
  const offenders: string[] = []
  // 품질 플래그가 흐름을 끊는 자리에 쓰이면 안 된다
  if (/qualityFlags[^\n]{0,80}(continue|return|process\.exit|filter)/.test(code)) offenders.push('flags 로 흐름 차단')
  if (/(continue|return)[^\n]{0,40}qualityFlags/.test(code)) offenders.push('flags 로 흐름 차단(역방향)')
  if (/selectionScore[^\n]{0,80}(continue|filter\()/.test(code)) offenders.push('점수로 걸러냄')
  // 거부 경로는 예전 그대로 3곳뿐이다 (본문 HTML 없음 · 본문 빈 값 · 제목 없음)
  const continues = (code.match(/\bcontinue\b/g) ?? []).length
  if (continues > 3) offenders.push(`거부 경로 ${continues}곳 (기존 3곳)`)
  // 룰 엔진 자체가 거부를 표현하지 않는다
  const quality = readFileSync(join(HERE, 'lib/micro-seed-quality.mts'), 'utf-8')
  if (/\breject\b|\bdecline\b|\bblock\b|\bdrop\b/i.test(quality.replace(/^\s*[*/].*$/gm, ''))) {
    offenders.push('룰 엔진에 거부 어휘')
  }
  if (offenders.length) bad('자동 거부가 늘지 않았다', 'guard', `🔴 ${offenders.join(' / ')}`)
  else ok('자동 거부가 늘지 않았다', 'guard', `거부 경로 ${continues}곳 · 플래그는 순서만 바꾼다`)
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
  const a = assessCandidate({
    originalTitle: '유시민작가님 60프로만 말한거라고 하던데',
    sourceCommentCount: 0, rawBody: '',
  })
  const b = assessCandidate({
    originalTitle: '우리 딸 학원 문제로 병원까지 다녀왔어요',
    sourceCommentCount: 6,
    rawBody: '제가 요며칠 증상이 심해서 치과에 다녀왔어요. 목구멍 이물감이 계속됩니다.',
  })
  const hasReason = (x: typeof a, flag: string) => (x.signals.matched[flag]?.length ?? 0) > 0
  const okA = hasReason(a, 'politicalOrPublicFigure')
  const okB = hasReason(b, 'targetLikely') && hasReason(b, 'personalExperienceLikely') && hasReason(b, 'practicalConcernLikely')
  // 근거 없이 붙는 플래그가 없어야 한다 (근거를 남기는 종류에 한해)
  const reasoned = ['politicalOrPublicFigure', 'clickbaitTitle', 'targetLikely',
    'personalExperienceLikely', 'practicalConcernLikely', 'titleTruncated']
  const orphan = [a, b].flatMap((x) => x.flags.filter((f) => reasoned.includes(f) && !hasReason(x, f)))
  if (okA && okB && !orphan.length) {
    ok('플래그마다 근거가 남는다', 'policy', `${JSON.stringify(a.signals.matched.politicalOrPublicFigure)}`)
  } else {
    bad('플래그마다 근거가 남는다', 'policy', `a=${okA} b=${okB} orphan=${orphan.join(',')}`)
  }
}

// ── ㉕ 상세 제목이 목록 제목을 이긴다 ───────────────────
//    🔴 목록 제목은 37자에서 잘린다 — 실측 25건 중 5건(20%).
//       importer 가 originalTitle 을 founderTitle 초기값으로 그대로 쓰므로
//       잘린 제목이 그대로 발행된다. 실제로 그렇게 발행된 글이 있다.
//    ⚠️ 이미 발행된 글은 소급 수정하지 않는다 (§6-4 발행은 비가역).
{
  const code = readFileSync(join(HERE, 'micro-seed-collect-82cook.mts'), 'utf-8')
    .split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')
  // 목록 정보가 있어도 상세 제목으로 덮어쓰는 형태인지 본다
  const prefersDetail = /originalTitle:\s*detailTitle\s*\?\?\s*listed\.originalTitle/.test(code)
  // 예전 형태(목록이 있으면 상세를 버림)가 남아 있으면 안 된다
  const noOldShape = !/const base = known\.get\(id\) \?\?/.test(code)
  const parses = /parseArticleTitle\(html\)/.test(code)
  // 잘린 제목은 플래그로도 드러난다
  const truncFlag = assessCandidate({
    originalTitle: '트레이더스 럭스나인 메모리폼 토퍼 핫앤쿨 제품 온라인으로 안파나..',
    sourceCommentCount: 0, rawBody: '',
  }).flags.includes('titleTruncated')
  if (prefersDetail && noOldShape && parses && truncFlag) {
    ok('상세 제목이 목록 제목을 이긴다', 'guard', '잘린 제목이 원장으로 넘어가지 않는다')
  } else {
    bad('상세 제목이 목록 제목을 이긴다', 'guard',
      `prefer=${prefersDetail} noOld=${noOldShape} parse=${parses} flag=${truncFlag}`)
  }
}

// ══════════════════════════════════════════════════════════
// Q-1 보강 — 본문 위험 신호
//
// 🔴 계기: 4232047. 제목(`눈썹거상은 얼마정도 할까요?`)만 보면 깨끗해서 score 75 로
//    상위권이었는데, 본문 첫 줄이 "장영란이 눈썹거상했다면서요" 였고 피부과와 가격 문의가
//    이어졌다. **사람이 본문을 읽어야만 걸러졌다.** 그 판단을 플래그로 앞당긴다.
//    여전히 거부하지 않는다 — 순서만 바꾼다.
// ══════════════════════════════════════════════════════════

// ── ㉖ 4232047 유형 — 본문 실명 · 의료 · 가격 ───────────
{
  const a = assessCandidate({ originalTitle: '눈썹거상은 얼마정도 할까요?', sourceCommentCount: 7, rawBody: BODY_4232047 })
  const missing: string[] = []
  for (const f of ['medicalOrAdLikely', 'publicFigureMention', 'quotedOrMediaLikely']) {
    if (!a.flags.includes(f as never)) missing.push(f)
  }
  // 근거가 남아야 사람이 검증할 수 있다
  const namedReason = a.signals.matched.publicFigureMention?.includes('장영란') ?? false
  const medReason = (a.signals.matched.medicalOrAdLikely ?? []).some((x) => x === '피부과' || x === '얼마')
  // 🔴 여전히 후보로 남는다. 점수만 내려간다
  const kept = a.flags.length > 0 && selectionScore(a) < 40
  if (!missing.length && namedReason && medReason && kept) {
    ok('본문 위험 3종 — 4232047 유형', 'policy', `${selectionScore(a)}점 · ${JSON.stringify(a.signals.matched.publicFigureMention)}`)
  } else {
    bad('본문 위험 3종 — 4232047 유형', 'policy',
      `missing=${missing.join(',')} name=${namedReason} med=${medReason} kept=${kept}`)
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
  const RISKY = ['medicalOrAdLikely', 'publicFigureMention', 'quotedOrMediaLikely']
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
console.log('\n82cook 수집 레일 — fixture 자기검증')
console.log(`  sourceSite=${SOURCE_SITE} · 게시판 ${BOARD_NAME} · 지연 ${DELAY_MS}ms`)
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

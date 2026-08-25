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
  const want = ['sourceSite', 'sourceUrl', 'sourceArticleId', 'sourceBoardName', 'sourceCommentCount',
    'originalTitle', 'rawBody', 'sourceCapturedAt', 'dedupKey']
  const missing = want.filter((k) => !(k in c))
  const siteOk = c.sourceSite === '82cook'
  const boardOk = c.sourceBoardName === BOARD_NAME
  const keyOk = c.dedupKey === computeDedupKey('82cook', '4231986')
  if (!missing.length && siteOk && boardOk && keyOk) {
    ok('산출물 스키마 — 9필드 · Micro Seed 이름', 'parse', want.join(' · '))
  } else {
    bad('산출물 스키마 — 9필드 · Micro Seed 이름', 'parse', `missing=${missing.join(',')} site=${siteOk} board=${boardOk} key=${keyOk}`)
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
  const usesBuilder = /writeJsonl\(listPath, items\.map\(\(i\) => buildCollected\(/.test(code)
  const noHandRolled = !/writeJsonl\(listPath, items\.map\(\(i\) => \(\{/.test(code)
  // 실제 산출물 모양도 확인한다 — rawBody 는 빈 문자열이어야 한다
  const listRow = buildCollected(
    { sourceArticleId: '1', sourceUrl: ARTICLE_URL('1'), originalTitle: 't', sourceCommentCount: 0 },
    '', '2026-08-26T00:00:00.000Z',
  )
  const has9 = ['sourceSite','sourceUrl','sourceArticleId','sourceBoardName','sourceCommentCount',
    'originalTitle','rawBody','sourceCapturedAt','dedupKey'].every((k) => k in listRow)
  const emptyBody = listRow.rawBody === ''
  if (usesBuilder && noHandRolled && has9 && emptyBody) {
    ok('목록 산출물도 9필드를 갖춘다', 'guard', 'buildCollected 경로 · rawBody 는 빈 값')
  } else {
    bad('목록 산출물도 9필드를 갖춘다', 'guard',
      `builder=${usesBuilder} noHand=${noHandRolled} fields9=${has9} emptyBody=${emptyBody}`)
  }
}

// ── ⑭ importer 소스 계약 ────────────────────────────────
{
  const raw = readFileSync(join(HERE, 'micro-seed-import-82cook-live.mts'), 'utf-8')
  const code = raw.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l)).join('\n')

  const checks: Array<{ name: string; ok: boolean; detail: string }> = [
    {
      name: 'dry-run 기본 · --apply + --limit=1 둘 다 필요',
      ok: /const APPLY = process\.argv\.includes\('--apply'\)/.test(code) &&
          /if \(!APPLY \|\| LIMIT !== 1\)/.test(code) &&
          /APPLY && LIMIT === 1/.test(code),
      detail: '스위치 두 개를 요구한다',
    },
    {
      name: 'JSONL 중복은 dedupKey 로 접는다',
      ok: /byKey\.set\(row\.dedupKey/.test(code) && /DUPLICATE_IN_JSONL/.test(code),
      detail: '중복은 오류가 아니라 진단',
    },
    {
      name: 'sourceSite 가 82cook 이 아니면 거부',
      ok: /row\.sourceSite !== SOURCE_SITE/.test(code),
      detail: '정본 외 출처를 원장에 들이지 않는다',
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
    { name: '기본 25분 → 5분 올림', min: 25, expectKst: '2026-08-26 09:25' },
    { name: '+23분 → 09:25 로 올림', min: 23, expectKst: '2026-08-26 09:25' },
    { name: '+26분 → 09:30 로 올림', min: 26, expectKst: '2026-08-26 09:30' },
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
  const at = roundUpToFiveMinutes(new Date(NOW.getTime() + 25 * 60_000))
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
      name: '기본 25분 · --in 으로 조정',
      ok: /SCHEDULE_DEFAULT_MINUTES = 25/.test(code) && /startsWith\('--in='\)/.test(code),
      detail: '제안 간격',
    },
    {
      name: '--no-schedule 이면 비운다',
      ok: /NO_SCHEDULE = process\.argv\.includes\('--no-schedule'\)/.test(code) &&
          /NO_SCHEDULE \? null :/.test(code) &&
          /proposed \? kstString\(proposed\) : ''/.test(code),
      detail: 'DB null · Sheet 공란',
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

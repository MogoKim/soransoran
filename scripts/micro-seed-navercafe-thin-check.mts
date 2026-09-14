/**
 * 네이버 카페 얇은 저장 fixture (§4-AV)
 *
 * 🔴 네트워크 0 · LLM 0 · DB 0 · 파일 write 0.
 */

import { readFileSync } from 'node:fs'

import {
  SKIP_LABEL, CAFE_BODY_HEAD_CHARS, planCafeThin, keepAfterClassify, outPathOf,
  isNaverCafeRow, statsOf, verifyThinRun, dedupKeyOf, uniqueSourceCount, type CafeRow,
} from '../src/lib/micro-seed-navercafe-thin'
import { THIN_COLUMNS, FORBIDDEN_COLUMNS, toThinRow, violatesStorage } from '../src/lib/micro-seed-82cook-thin'

let pass = 0
let failN = 0
const check = (name: string, ok: boolean): void => {
  if (ok) { pass += 1 } else { failN += 1; console.log(`  🔴 FAIL  ${name}`) }
}

const row = (over: Partial<CafeRow> = {}): CafeRow => ({
  sourceArticleId: '447520', sourceSite: 'navercafe:remonterrace',
  sourceUrl: 'https://cafe.naver.com/x/447520', originalTitle: '오늘 저녁 뭐 드세요',
  rawBody: '가',  // 🔴 fixture 는 길이만 본다. 실제 본문을 넣지 않는다
  sourceCommentCount: 7, sourceBoardName: '자유게시판',
  ...over,
})
const NONE = new Set<string>()

console.log('\n══ 네이버 카페 얇은 저장 fixture ══\n')

// ── ① 소스 판별 ──
check('🟢 navercafe: 접두를 알아본다', isNaverCafeRow(row()))
check('🔴 82cook 행은 이 레인이 아니다', !isNaverCafeRow(row({ sourceSite: '82cook' })))
check('🔴 빈 sourceSite 는 받지 않는다', !isNaverCafeRow(row({ sourceSite: '' })))

// ── ② 계획 ──
check('🟢 정상 행은 대상이다', planCafeThin({ rows: [row()], seen: NONE }).targets.length === 1)
check('🔴 id 가 없으면 뺀다', (() => {
  const p = planCafeThin({ rows: [row({ sourceArticleId: '' })], seen: NONE })
  return p.targets.length === 0 && p.skipped[0].code === 'NO_ID'
})())
check('🔴 본문이 비면 뺀다 — 목록 행(.list.jsonl)이 섞여 들어온 경우다', (() => {
  const p = planCafeThin({ rows: [row({ rawBody: '' })], seen: NONE })
  return p.skipped[0].code === 'NO_BODY'
})())
check('🔴 82cook 행이 섞이면 뺀다', (() => {
  const p = planCafeThin({ rows: [row({ sourceSite: '82cook' })], seen: NONE })
  return p.skipped[0].code === 'NOT_NAVERCAFE'
})())
check('🔴 이미 얇게 저장한 것은 다시 하지 않는다 — 재탕 방지', (() => {
  // 🔴 키는 sourceSite 까지 붙인 것이다. id 만 담으면 막히지 않는다(그게 정상이다)
  const p = planCafeThin({
    rows: [row()], seen: new Set([dedupKeyOf('navercafe:remonterrace', '447520')]),
  })
  return p.targets.length === 0 && p.skipped[0].code === 'ALREADY'
})())
check('🔴 id 만 담은 옛 키로는 막히지 않는다 — 정본 키를 쓰지 않으면 여기서 드러난다',
  planCafeThin({ rows: [row()], seen: new Set(['447520']) }).targets.length === 1)
check('🔴 제목이 정치·공인이면 **가져오지 않는다** — 판정까지 가면 본문이 한 번 더 저장된다', (() => {
  const p = planCafeThin({
    rows: [row()], seen: NONE,
    judge: { isPolitics: () => true, isBlocked: () => false },
  })
  return p.targets.length === 0 && p.skipped[0].code === 'TITLE_POLITICS'
})())
check('🔴 제목이 안전 기준에 걸리면 가져오지 않는다', (() => {
  const p = planCafeThin({
    rows: [row()], seen: NONE,
    judge: { isPolitics: () => false, isBlocked: () => true },
  })
  return p.skipped[0].code === 'TITLE_SAFETY'
})())
check('🟢 순서가 결정적이다 — 같은 입력이면 같은 것을 고른다', (() => {
  const rows = [row({ sourceArticleId: 'c' }), row({ sourceArticleId: 'a' }), row({ sourceArticleId: 'b' })]
  const p = planCafeThin({ rows, seen: NONE })
  return p.targets.map((r) => String(r.sourceArticleId)).join('') === 'abc'
})())
check('🟢 cap 을 지킨다', planCafeThin({
  rows: [row({ sourceArticleId: 'a' }), row({ sourceArticleId: 'b' })], seen: NONE, cap: 1,
}).targets.length === 1)

// ── ③ 분류 후 채택 ──
check('🟢 seedOriginality 는 저장한다',
  keepAfterClassify({ axis: 'seedOriginality', safetyVerdict: 'pass' }).keep)
check('🟢 rawOriginality 는 저장한다',
  keepAfterClassify({ axis: 'rawOriginality', safetyVerdict: 'pass' }).keep)
check('🟢 shortRawNoindex 는 저장한다 — 사람 검수 레일로 간다',
  keepAfterClassify({ axis: 'shortRawNoindex', safetyVerdict: 'pass' }).keep)
check('🔴 drop 은 파일에 남기지 않는다', (() => {
  const k = keepAfterClassify({ axis: 'drop', safetyVerdict: 'pass' })
  return !k.keep && k.code === 'DROP'
})())
check('🔴 hardExclude 는 축과 무관하게 남기지 않는다', (() => {
  const k = keepAfterClassify({ axis: 'seedOriginality', safetyVerdict: 'hardExclude' })
  return !k.keep && k.code === 'HARD_EXCLUDE'
})())

// ── ④ 저장 계약 — 🔴 전문이 나가지 않는다 ──
const mkRow = (body: string): Record<string, unknown> => toThinRow({
  id: '447520', url: 'https://cafe.naver.com/x/447520', title: '제목',
  commentCount: 7, score: 0, maskedBody: body, bodyHeadChars: CAFE_BODY_HEAD_CHARS,
  axis: 'seedOriginality', safetyVerdict: 'pass', safetyReasons: [],
  reason: '', runId: 'R', fetchedAt: '2026-09-07T00:00:00.000Z',
  sourceSite: 'navercafe:remonterrace',
}) as unknown as Record<string, unknown>

check('🔴 sourceSite 가 navercafe 로 남는다 — 82cook 으로 둔갑하지 않는다',
  mkRow('가').sourceSite === 'navercafe:remonterrace')
check('🔴 기본값은 82cook 이다 — 기존 호출부가 바뀌지 않는다', (() => {
  const r = toThinRow({
    id: '1', url: '', title: 't', commentCount: 0, score: 0, maskedBody: '가',
    bodyHeadChars: 300, axis: 'a', safetyVerdict: 'pass', safetyReasons: [],
    reason: '', runId: 'R', fetchedAt: '',
  })
  return r.sourceSite === '82cook'
})())
check('🔴 bodyHead 가 300자를 넘지 않는다', (() => {
  const long = '가'.repeat(5000)
  const r = mkRow(long)
  return String(r.bodyHead).length === CAFE_BODY_HEAD_CHARS
})())
check('🔴 bodyLength 는 자르기 전 길이다 — 얼마나 긴 글이었는지는 판단에 쓰인다', (() => {
  const r = mkRow('가'.repeat(5000))
  return r.bodyLength === 5000
})())
check('🔴 전문 컬럼이 하나도 없다', (() => {
  const r = mkRow('가'.repeat(1000))
  return FORBIDDEN_COLUMNS.every((k) => !(k in r))
})())
check('🔴 rawBody 가 결과에 남지 않는다 — 수집물의 그 키가 새어나가면 안 된다',
  !('rawBody' in mkRow('가')))
check('🔴 계약에 없는 컬럼이 없다', (() => {
  const r = mkRow('가')
  return Object.keys(r).every((k) => THIN_COLUMNS.includes(k))
})())
check('🟢 저장 직전 관문을 통과한다', violatesStorage(mkRow('가'.repeat(400)), CAFE_BODY_HEAD_CHARS).length === 0)
check('🔴 전문을 끼워 넣으면 관문이 잡는다', (() => {
  const r = { ...mkRow('가'), rawBody: '전문' }
  return violatesStorage(r, CAFE_BODY_HEAD_CHARS).length > 0
})())

// ── ⑤ 본문 길이 계약이 82cook 과 같다 ──
check('🔴 CAFE_BODY_HEAD_CHARS 가 정본과 같다 — 한쪽만 늘어나면 여기서 걸린다', (() => {
  const src = readFileSync('scripts/lib/micro-seed-raw-originality.mts', 'utf-8')
  const m = /export const BODY_HEAD_CHARS = (\d+)/.exec(src)
  return m !== null && Number(m[1]) === CAFE_BODY_HEAD_CHARS
})())

// ── ⑥ 산출 경로 — 기존 adapt 가 집는 접미여야 한다 ──
check('🔴 산출물이 .thin-detail.jsonl 이다 — 아니면 82cook-thin-adapt 가 집지 않는다',
  outPathOf('.microseed-data', 'wgang', 'R1').endsWith('.thin-detail.jsonl'))
check('🔴 산출물이 .microseed-data 아래다',
  outPathOf('.microseed-data', 'wgang', 'R1').startsWith('.microseed-data/'))
check('🟢 카페별로 파일이 갈린다', (() => (
  outPathOf('.', 'wgang', 'R') !== outPathOf('.', 'remonterrace', 'R')
))())

// ── ⑦ 정합 ──
check('🟢 네트워크 0 · DB 0 이면 통과',
  verifyThinRun({ planned: 5, written: 4, networkRequests: 0, dbWrites: 0 }).ok)
check('🔴 네트워크 요청이 있으면 잡는다 — 이 레인은 파일만 읽는다', (() => {
  const v = verifyThinRun({ planned: 5, written: 4, networkRequests: 1, dbWrites: 0 })
  return !v.ok && v.problems.some((p) => p.includes('네트워크'))
})())
check('🔴 DB write 가 있으면 잡는다 — 적재는 importer 의 일이다', (() => {
  const v = verifyThinRun({ planned: 5, written: 4, networkRequests: 0, dbWrites: 1 })
  return !v.ok && v.problems.some((p) => p.includes('DB'))
})())
check('🔴 계획보다 많이 쓰면 잡는다',
  !verifyThinRun({ planned: 2, written: 3, networkRequests: 0, dbWrites: 0 }).ok)
check('🟢 축별 집계가 맞는다', (() => {
  const st = statsOf([{ axis: 'seedOriginality' }, { axis: 'seedOriginality' }, { axis: 'rawOriginality' }])
  return st.total === 3 && st.byAxis.seedOriginality === 2 && st.byAxis.rawOriginality === 1
})())

// ══════════════════════════════════════════════════════════════════
// 🔴 소스까지 붙인 중복 키 — id 단독으로 막으면 다른 카페의 글이 유실된다
// ══════════════════════════════════════════════════════════════════
const R = 'navercafe:remonterrace'
const W = 'navercafe:wgang'
const E = '82cook'

check('🟢 키가 sourceSite 와 articleId 를 함께 담는다', dedupKeyOf(R, '447520') === `${R}|447520`)
check('🔴 소스가 다르면 키가 다르다', dedupKeyOf(R, '447520') !== dedupKeyOf(W, '447520'))
check('🔴 82cook 과 카페도 키가 다르다', dedupKeyOf(E, '447520') !== dedupKeyOf(R, '447520'))
check('🟢 같은 소스·같은 번호면 같은 키다', dedupKeyOf(R, '447520') === dedupKeyOf(R, '447520'))

check('🔴 [충돌] 82cook 447520 을 먹었어도 remonterrace 447520 은 막히지 않는다', (() => {
  const seen = new Set([dedupKeyOf(E, '447520')])
  const p = planCafeThin({ rows: [row({ sourceSite: R, sourceArticleId: '447520' })], seen })
  return p.targets.length === 1
})())
check('🔴 [충돌] remonterrace 447520 을 먹었어도 wgang 447520 은 막히지 않는다', (() => {
  const seen = new Set([dedupKeyOf(R, '447520')])
  const p = planCafeThin({ rows: [row({ sourceSite: W, sourceArticleId: '447520' })], seen })
  return p.targets.length === 1
})())
check('🔴 [충돌] 세 소스에 같은 번호가 있어도 셋 다 살아남는다', (() => {
  const rows = [
    row({ sourceSite: R, sourceArticleId: '447520' }),
    row({ sourceSite: W, sourceArticleId: '447520' }),
  ]
  const p = planCafeThin({ rows, seen: new Set([dedupKeyOf(E, '447520')]) })
  return p.targets.length === 2
})())
check('🟢 같은 sourceSite+articleId 만 중복으로 막는다', (() => {
  const seen = new Set([dedupKeyOf(R, '447520')])
  const p = planCafeThin({ rows: [row({ sourceSite: R, sourceArticleId: '447520' })], seen })
  return p.targets.length === 0 && p.skipped[0].code === 'ALREADY'
})())

// ── 두 카페가 각각 통과한다 (wgang 은 fixture 실증) ──
for (const [cafe, site] of [['remonterrace', R], ['wgang', W]] as const) {
  check(`🟢 [${cafe}] 행을 알아본다`, isNaverCafeRow(row({ sourceSite: site })))
  check(`🟢 [${cafe}] 대상이 된다`,
    planCafeThin({ rows: [row({ sourceSite: site })], seen: NONE }).targets.length === 1)
  check(`🟢 [${cafe}] 얇은 행의 sourceSite 가 그대로 남는다`, (() => {
    const r = toThinRow({
      id: '1', url: '', title: 't', commentCount: 0, score: 0, maskedBody: '가',
      bodyHeadChars: CAFE_BODY_HEAD_CHARS, axis: 'seedOriginality', safetyVerdict: 'pass',
      safetyReasons: [], reason: '', runId: 'R', fetchedAt: '', sourceSite: site,
    })
    return r.sourceSite === site
  })())
  check(`🟢 [${cafe}] 산출 경로가 카페 이름을 담는다`,
    outPathOf('.microseed-data', cafe, 'R1').includes(cafe))
}

// ══════════════════════════════════════════════════════════════════
// 🔴 수집기 자체가 전문을 디스크에 남기지 않는다 (§4-AV ②)
// ══════════════════════════════════════════════════════════════════
{
  const collector = ((): string => {
    const raw = readFileSync('scripts/micro-seed-collect-navercafe.mts', 'utf-8')
    return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  })()
  check('🔴 수집기에 --thin 경로가 있다', /THIN = argv\.includes\('--thin'\)/.test(collector))
  check('🔴 --thin 이면 전문 JSONL 을 쓰지 않는다 — 지우는 것이 아니라 쓰지 않는다', (() => {
    // writeJsonl(OUT, collected) 은 THIN 이 아닌 분기에만 있어야 한다
    const thinBranch = /if \(collected\.length && THIN\)/.test(collector)
    const elseBranch = /\} else if \(collected\.length\) \{[\s\S]{0,200}writeJsonl\(OUT, collected\)/.test(collector)
    return thinBranch && elseBranch
  })())
  check('🔴 --thin 경로가 마스킹 → 자르기 순서를 지킨다', (() => {
    const i = collector.indexOf('maskSensitive')
    const j = collector.indexOf('bodyHeadChars: BODY_HEAD_CHARS')
    return i !== -1 && j !== -1 && i < j
  })())
  check('🔴 --thin 경로도 저장 직전 관문을 지난다', /violatesStorage\(row, BODY_HEAD_CHARS\)/.test(collector))
  check('🔴 --thin 경로가 drop·hardExclude 를 저장하지 않는다', /keepAfterClassify/.test(collector))
  // 🔴 파일 write 가 루프 밖 한 곳뿐이어야 crash 시 전문이 남지 않는다
  check('🔴 수집 루프 안에서 파일을 쓰지 않는다 — crash 해도 전문 파일이 생기지 않는 근거다', (() => {
    const loop = /for \(const \[idx, id\] of plan\.picked\.entries\(\)\) \{([\s\S]*?)\n    \}/.exec(collector)
    return loop !== null && !/writeJsonl|writeFileSync|appendFileSync/.test(loop[1])
  })())
}

// 🔴 실제 산출물 — 신규 thin 파일에 전문 키가 하나도 없어야 한다
{
  const { existsSync: ex, readdirSync: rd } = await import('node:fs')
  const DIR = '.microseed-data'
  const files = ex(DIR)
    ? rd(DIR).filter((f) => /^navercafe-thin-.*\.thin-detail\.jsonl$/.test(f))
    : []
  const FORBIDDEN = ['rawBody', 'body', 'content', 'html', 'rawHtml', 'text']
  let bad = 0
  let rows = 0
  for (const f of files) {
    for (const line of readFileSync(`${DIR}/${f}`, 'utf-8').split('\n')) {
      if (line.trim() === '') continue
      rows += 1
      const r = JSON.parse(line) as Record<string, unknown>
      if (FORBIDDEN.some((k) => k in r)) bad += 1
      if (String(r.bodyHead ?? '').length > CAFE_BODY_HEAD_CHARS) bad += 1
    }
  }
  check(`🔴 [실파일] navercafe thin ${rows}행에 전문 키 0 · bodyHead 초과 0`, bad === 0)
}

// ── ⑧ 러너가 넘지 말아야 할 선 ──
const code = ((): string => {
  const raw = readFileSync('scripts/micro-seed-navercafe-thin.mts', 'utf-8')
  // 🔴 주석을 지우고 본다 — 설명 문구가 자기 자신을 잡는 일이 반복됐다
  return raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
})()
check('🔴 네트워크로 나가지 않는다', !/\bfetch\(|https?:\/\/|playwright|chromium/i.test(code))
check('🔴 DB 를 건드리지 않는다', !/PrismaClient|prisma\./.test(code))
check('🔴 Sheet 로 보내지 않는다 — 네이버 원문이 시트로 가면 되돌릴 수 없다',
  !/sheets|googleapis|appendRow|SHEET_ID/i.test(code))
check('🔴 발행하지 않는다', !/\bpost\.(create|update)|publish|persona/i.test(code))
check('🔴 판정·분류를 새로 만들지 않는다 — 기존 함수를 쓴다',
  /classifyDetail/.test(code) && /toThinRow/.test(code) && !/function classify/.test(code))
check('🔴 마스킹을 자르기 전에 한다', (() => {
  const i = code.indexOf('maskSensitive')
  const j = code.indexOf('bodyHeadChars: BODY_HEAD_CHARS')
  return i !== -1 && j !== -1 && i < j
})())
check('🔴 저장 직전 관문을 부른다', /violatesStorage/.test(code))
check('🔴 .microseed-data 밖으로 쓰지 않는다', /isInsideDataDir/.test(code))
check('🔴 기본 실행은 쓰지 않는다', /APPLY = argv\.includes\('--apply'\)/.test(code))
check('🔴 목록 파일(.list.jsonl)을 상세로 착각하지 않는다',
  /navercafe-\[a-z0-9\]\+-\[0-9-\]\+\\\.jsonl/.test(code) || /\.list\.jsonl/.test(code))

/**
 * 🔴 **"제외" 를 네 갈래로 나눈다** (2026-09-13).
 *
 *    관측(2026-09-11~12)에서 후보 1,479건 중 95건만 열렸고 나머지 1,384건이
 *    "제외" 로 보였다. 대부분은 버린 것이 아니라 **회차 상한 때문에 미룬 것**이었다.
 *    섞여 있으면 "왜 이렇게 많이 거르나" 라는 틀린 물음을 하게 된다.
 */
console.log('\n⑨ 🔴 제외를 네 갈래로 나눈다')
{
  const rows = [
    row({ sourceArticleId: '1' }),
    row({ sourceArticleId: '2' }),
    row({ sourceArticleId: '3' }),
    row({ sourceArticleId: '4', rawBody: '' }),          // 🔴 안 가져옴
    row({ sourceArticleId: '5' }),                        // ⚪ 이미 읽음
  ]
  const p = planCafeThin({
    rows, cap: 2,
    seen: new Set([dedupKeyOf('navercafe:remonterrace', '5')]),
  })
  check('🟢 이번 회차 처리는 상한만큼이다', p.targets.length === 2)
  check('🟡 상한에 밀린 것은 **이월**이다 — 제외가 아니다', p.deferred.length === 1)
  check('⚪ 이미 읽은 것은 따로 센다', p.alreadyRead.length === 1 && p.alreadyRead[0]!.code === 'ALREADY')
  check('🔴 안 가져오는 것도 따로 센다', p.rejected.length === 1 && p.rejected[0]!.code === 'NO_BODY')
  check('🔴 이월은 skipped 에 들어가지 않는다 — 옛 이름으로 세도 부풀지 않는다',
    p.skipped.length === 2 && !p.skipped.some((x) => x.id === '3'))
  check('🔴 네 갈래의 합이 입력과 같다 — 조용히 사라지는 행이 없다',
    p.targets.length + p.deferred.length + p.alreadyRead.length + p.rejected.length === rows.length)
  check('🔴 이월된 것은 다음 회차에 다시 후보가 된다', (() => {
    const again = planCafeThin({ rows: p.deferred, seen: NONE, cap: 10 })
    return again.targets.length === 1
  })())
}

console.log('\n⑩ 🔴 후보 수를 고유 원천 수로 오해하지 않는다')
{
  // 같은 글이 페이지를 걸쳐 두 번 나오는 것은 흔하다 — 행 수는 원천 수가 아니다
  const dup = [row({ sourceArticleId: '9' }), row({ sourceArticleId: '9' }), row({ sourceArticleId: '8' })]
  check('🔴 행 3건이지만 고유 원천은 2건이다', dup.length === 3 && uniqueSourceCount(dup) === 2)
  check('🔴 같은 번호라도 카페가 다르면 다른 글이다',
    uniqueSourceCount([row({ sourceArticleId: '9' }), row({ sourceArticleId: '9', sourceSite: 'navercafe:wgang' })]) === 2)
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${failN === 0 ? '✅' : '🔴'} ${pass} pass · ${failN} fail\n`)
process.exit(failN === 0 ? 0 : 1)

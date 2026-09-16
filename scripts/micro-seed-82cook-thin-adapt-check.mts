#!/usr/bin/env tsx
/**
 * thin → 검수 어댑터 fixture — 🔴 **전문이 사본으로도 새지 않는다** (§4-AQ)
 *
 * 읽기만 한다. DB·네트워크·파일 쓰기 0.
 */
import { readFileSync } from 'node:fs'
import {
  toDetailRecord, toRawDetailRecord, statsOf, violatesAdapt, accessOf,
  DETAIL_KEYS, RAW_DETAIL_KEYS, FORBIDDEN_KEYS,
  SOURCE_AXIS, RAW_AXIS, SRN_AXIS,
  DEFAULT_IMAGE_COUNT, DEFAULT_LENGTH_BASIS, ADAPT_PREFIX,
  type ThinRow,
} from '../src/lib/micro-seed-82cook-thin-adapt'
import { BODY_HEAD_CHARS } from './lib/micro-seed-raw-originality.mjs'
import { POST_CAP_PER_WEEK, MIN_DAYS_BETWEEN_POSTS } from '../src/lib/original-post-persona-match'
import { DAILY_PUBLISH_CAP } from '../src/lib/original-post-publish'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

const ok = (o: Partial<ThinRow> = {}): ThinRow => ({
  sourceArticleId: '4234470', sourceSite: '82cook',
  url: 'https://www.82cook.com/entiz/read.php?bn=15&num=4234470',
  title: '당근에서 집안일 도와주실 분', commentCount: 10, score: 0,
  bodyLength: 816, bodyHead: '가'.repeat(300),
  axis: SOURCE_AXIS, safetyVerdict: 'pass', safetyReasons: '',
  reason: '', runId: '20260907-113234', fetchedAt: '2026-09-07T02:32:34.000Z', ...o,
})

console.log('\nthin → 검수 어댑터 — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 🔴 전문이 사본으로도 새지 않는다')
{
  const d = toDetailRecord(ok())
  const r = toRawDetailRecord(ok())
  check('🔴 detail 사본에 전문 키 없음', FORBIDDEN_KEYS.every((k) => !(k in d)))
  check('🔴 raw-detail 사본에 전문 키 없음', FORBIDDEN_KEYS.every((k) => !(k in r)))
  check('detail 키가 계약과 같다',
    Object.keys(d).sort().join(',') === [...DETAIL_KEYS].sort().join(','))
  check('raw-detail 키가 계약과 같다',
    Object.keys(r).sort().join(',') === [...RAW_DETAIL_KEYS].sort().join(','))
  check(`bodyHead 가 ${BODY_HEAD_CHARS}자 이하`, String(d.bodyHead).length <= BODY_HEAD_CHARS)
  check('🔴 입력에 없는 것은 출력에도 없다 — 지어내지 않는다', (() => {
    const src = ok()
    return !('rawBody' in src) && !('rawBody' in d) && !('rawBody' in r)
  })())

  // 🔴 출력 직전 관문
  check('🟢 온전한 행은 통과', violatesAdapt(d, DETAIL_KEYS, BODY_HEAD_CHARS).length === 0)
  for (const k of FORBIDDEN_KEYS) {
    check(`🔴 ${k} 가 섞이면 잡는다`,
      violatesAdapt({ ...d, [k]: '원문' }, DETAIL_KEYS, BODY_HEAD_CHARS).some((m) => m.includes(k)))
  }
  check('🔴 계약 밖 키도 잡는다',
    violatesAdapt({ ...d, memo: 'x' }, DETAIL_KEYS, BODY_HEAD_CHARS).some((m) => m.includes('memo')))
  check(`🔴 bodyHead 초과를 잡는다`, violatesAdapt(
    { ...d, bodyHead: '가'.repeat(BODY_HEAD_CHARS + 1) }, DETAIL_KEYS, BODY_HEAD_CHARS,
  ).some((m) => m.includes('넘는다')))
}

console.log('\n② 🔴 읽지 못한 글을 ok 로 적지 않는다')
{
  check('본문이 있으면 ok', accessOf(ok({ bodyLength: 100 })) === 'ok')
  check('🔴 404 로 0자면 failed — 판단 대상이 아니다', accessOf(ok({ bodyLength: 0 })) === 'failed')
  check('길이가 없으면 failed', accessOf({}) === 'failed')
  check('detail 사본이 access 를 그대로 옮긴다',
    toDetailRecord(ok({ bodyLength: 0 })).access === 'failed')
  check('🔴 raw 사본은 키 이름이 accessStatus 다 — 화면이 그걸 본다',
    'accessStatus' in toRawDetailRecord(ok()) && !('access' in toRawDetailRecord(ok())))
  check('🔴 두 사본의 판정이 같다', (() => {
    const t = ok({ bodyLength: 0 })
    return toDetailRecord(t).access === toRawDetailRecord(t).accessStatus
  })())
}

console.log('\n③ 없는 값은 안전한 기본값으로')
{
  const d = toDetailRecord(ok())
  check(`imageCount = ${DEFAULT_IMAGE_COUNT}`, d.imageCount === DEFAULT_IMAGE_COUNT)
  check(`lengthBasis = ${DEFAULT_LENGTH_BASIS}`, d.lengthBasis === DEFAULT_LENGTH_BASIS)
  check('🔴 assetAxes 를 지어내지 않는다 — thin 은 사연 축을 안 쟀다', d.assetAxes === '')
  check('빈 입력도 터지지 않는다', (() => {
    const e = toDetailRecord({})
    return e.access === 'failed' && e.bodyLength === 0 && e.title === ''
  })())
  check('숫자가 아닌 값은 0 으로', toDetailRecord({ score: NaN }).score === 0)
  check('유지 필드가 그대로 온다', (() => {
    const t = ok()
    const x = toDetailRecord(t)
    return x.sourceArticleId === t.sourceArticleId && x.url === t.url
      && x.title === t.title && x.runId === t.runId && x.commentCount === t.commentCount
  })())
  check('fetchedAt 은 raw 사본에 남는다', toRawDetailRecord(ok()).fetchedAt === ok().fetchedAt)
}

console.log('\n④ 🔴 drop · hardExclude 는 어느 화면에도 오르지 않는다')
{
  const rows = [
    ok({ sourceArticleId: 'a1', axis: SOURCE_AXIS }),
    ok({ sourceArticleId: 'a2', axis: RAW_AXIS }),
    ok({ sourceArticleId: 'a3', axis: SRN_AXIS }),
    ok({ sourceArticleId: 'a4', axis: 'drop', safetyVerdict: 'hardExclude' }),
    ok({ sourceArticleId: 'a5', axis: SOURCE_AXIS, safetyVerdict: 'hardExclude' }),
    ok({ sourceArticleId: 'a6', axis: SOURCE_AXIS, bodyLength: 0 }),
  ]
  const s = statsOf(rows)
  check('소스 후보 1건', s.sourceCandidates === 1)
  check('raw 후보 1건', s.rawCandidates === 1)
  check(`${SRN_AXIS} 는 따로 센다 — 발행 후보화하지 않는다`, s.srn === 1)
  check('🔴 drop·hardExclude 2건이 후보에서 빠진다', s.dropped === 2)
  check('🔴 safety 가 pass 가 아니면 축이 맞아도 안 오른다',
    !rows.filter((r) => r.sourceArticleId === 'a5')
      .every(() => statsOf([rows[4]!]).sourceCandidates === 1))
  check('🔴 읽지 못한 글도 안 오른다', statsOf([rows[5]!]).sourceCandidates === 0)
  check('읽지 못한 것을 따로 센다', s.unreadable === 1)
  check('전체 수는 그대로', s.total === 6)
}

console.log('\n⑤ 🔴 하지 않는 것 — 스캔')
{
  const codeOf = (p: string): string => readFileSync(p, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const runner = codeOf('scripts/micro-seed-82cook-thin-adapt.mts')
  const lib = codeOf('src/lib/micro-seed-82cook-thin-adapt.ts')

  for (const [label, re] of [
    ['Prisma / DB', /PrismaClient|prisma\./],
    ['Raw SQL', /\$executeRaw|\$queryRaw/],
    ['네트워크', /fetch\(|axios|playwright|chromium/i],
    ['LLM', /openai|anthropic|gemini|gpt-/i],
    ['Sheet', /googleapis|spreadsheet/i],
    ['Raw Vault', /microSeedRawContent/],
    ['Post 생성', /post\.create/i],
    ['발행 호출', /publishOriginalPostTx\s*\(/],
  ] as const) {
    check(`🔴 러너에 ${label} 없음`, !re.test(runner))
  }
  check('🔴 lib 은 순수 함수만이다',
    !/readFileSync|writeFileSync|fetch\(|await |PrismaClient/.test(lib))
  check('🔴 thin 원본을 쓰지 않는다 — 읽기만 한다',
    !/writeFileSync\([^)]*thin-detail/.test(runner))
  // 🔴 **소스 문자열이 아니라 실제 값**을 본다 (2026-09-11).
  //    접두를 lib 정본(`ADAPT_PREFIX`)으로 옮기면서 러너의 리터럴이 사라졌다.
  //    원래 의도는 "사본 이름이 원본과 다른가" 였으므로 값으로 묻는 편이 더 강하다.
  check('🔴 사본 파일명이 원본과 다르다',
    ADAPT_PREFIX === '82cook-adapt-'
    && !ADAPT_PREFIX.includes('thin-detail')
    && /ADAPT_PREFIX/.test(runner))
  check('계획이 기본이고 --apply 가 있어야 쓴다',
    /const APPLY = argv\.includes\('--apply'\)/.test(runner))
  check('🔴 산출물은 데이터 디렉터리 안에만', /isInsideDataDir/.test(runner))
  check('🔴 같은 회차를 두 번 내지 않는다', /adaptedRunIds/.test(runner))
  check('엔트리포인트 가드가 있다', /isDirectRun/.test(runner))
}

console.log('\n⑥ 🔴 상수를 건드리지 않았다')
{
  const m = readFileSync('src/lib/original-post-persona-match.ts', 'utf-8')
  // 🔴 **소스 문자열이 아니라 실제 값**을 본다 (2026-09-08).
  //    상수를 `RUNTIME_PROFILE` 에서 파생시키면서 `= 1` 리터럴이 사라졌다.
  //    원래 의도가 "값이 그대로인가" 였으므로 값으로 묻는 편이 더 강하다.
  check('POST_CAP_PER_WEEK = 1 그대로', POST_CAP_PER_WEEK === 1)
  check('MIN_DAYS_BETWEEN_POSTS = 5 그대로', MIN_DAYS_BETWEEN_POSTS === 5)
  check('DAILY_PUBLISH_CAP = 1 그대로', DAILY_PUBLISH_CAP === 1)
  check(`BODY_HEAD_CHARS = ${BODY_HEAD_CHARS} 그대로`,
    /export const BODY_HEAD_CHARS = 300\b/.test(readFileSync('scripts/lib/micro-seed-raw-originality.mts', 'utf-8')))
  check('🔴 thin 저장 계약을 바꾸지 않았다',
    /export const PACE_MIN_MS = 3000\b/.test(readFileSync('src/lib/micro-seed-82cook-thin.ts', 'utf-8')))
}

// ─────────────────────────────────────────────────────────
// [ST] 원문 시각이 adapt 를 **통과한다** — 🔴 한 군데만 뚫어서는 길이 나지 않는다
// ─────────────────────────────────────────────────────────
{
  const POSTED = '2020-12-13T15:00:00.000Z'
  const LISTED = '2026-09-16T12:33:31.020Z'
  const withTimes: ThinRow = {
    sourceArticleId: '1', sourceSite: 'navercafe:remonterrace', url: 'https://x/1',
    title: '제목', commentCount: 0, score: 0, bodyLength: 120, bodyHead: '본문',
    axis: SOURCE_AXIS, safetyVerdict: 'pass', safetyReasons: '', reason: 'r',
    runId: 'run', fetchedAt: LISTED,
    sourcePostedAt: POSTED, sourceListedAt: LISTED, sourceCapturedAt: LISTED,
  }
  // 🔴 옛 얇은 파일에는 세 키가 아예 없다 — 그 경우도 깨지지 않아야 한다
  const legacy: ThinRow = { ...withTimes }
  delete (legacy as Record<string, unknown>).sourcePostedAt
  delete (legacy as Record<string, unknown>).sourceListedAt
  delete (legacy as Record<string, unknown>).sourceCapturedAt

  for (const k of ['sourcePostedAt', 'sourceListedAt', 'sourceCapturedAt']) {
    check(`🔴 [ST] detail 계약에 ${k} 가 있다`, DETAIL_KEYS.includes(k))
    check(`🔴 [ST] raw-detail 계약에 ${k} 가 있다`, RAW_DETAIL_KEYS.includes(k))
  }

  const d = toDetailRecord(withTimes)
  check('🔴 [ST] detail 행이 게시 시각을 옮긴다', d.sourcePostedAt === POSTED)
  check('🔴 [ST] detail 행이 목록 시각을 옮긴다', d.sourceListedAt === LISTED)
  check('🔴 [ST] detail 행이 계약 관문을 통과한다',
    violatesAdapt(d, DETAIL_KEYS, BODY_HEAD_CHARS).length === 0)
  const r = toRawDetailRecord(withTimes)
  check('🔴 [ST] raw-detail 행도 게시 시각을 옮긴다', r.sourcePostedAt === POSTED)
  check('🔴 [ST] raw-detail 행이 계약 관문을 통과한다',
    violatesAdapt(r, RAW_DETAIL_KEYS, BODY_HEAD_CHARS).length === 0)

  const dl = toDetailRecord(legacy)
  check('🔴 [ST] 옛 행은 빈 문자열이 된다 (모른다)', dl.sourcePostedAt === '')
  check('🔴 [ST] 옛 행도 키는 있다 — 하류가 "키 없음" 을 따로 다루지 않아도 되게',
    'sourcePostedAt' in dl && 'sourceListedAt' in dl && 'sourceCapturedAt' in dl)
  check('🔴 [ST] 옛 행도 계약 관문을 통과한다',
    violatesAdapt(dl, DETAIL_KEYS, BODY_HEAD_CHARS).length === 0)
  check('🔴 [ST] 🔴 옛 행의 게시 시각을 가져온 시각으로 메우지 않는다',
    dl.sourcePostedAt === '' && dl.sourceCapturedAt === '')

  check('🔴 [ST] 전문 키는 여전히 나가지 않는다',
    FORBIDDEN_KEYS.every((k) => !(k in d) && !(k in r)))
}

// ─────────────────────────────────────────────────────────
// [SF] 🔴 **오래된 이슈 재수집 ≠ 오래된 상시 소재** — 이번 PR 은 판정을 바꾸지 않는다.
//
//   지금(`ageDays` = 가져온 시각 기준)은 둘이 **구분되지 않는다.** 아래 fixture 는
//   그 사실을 못박고, 게시 시각을 기준으로 바꾸면 무엇이 갈라지는지 미리 적어 둔다.
//   🔴 TTL 상수도 `judgeCandidate` 도 건드리지 않는다 — 준비만 한다.
// ─────────────────────────────────────────────────────────
{
  const day = 86400000
  const now = new Date('2026-09-17T00:00:00.000Z').getTime()
  const ageFrom = (iso: string): number | null => {
    if (iso === '') return null
    const t = new Date(iso).getTime()
    return Number.isNaN(t) ? null : Math.floor((now - t) / day)
  }

  // ① 오래된 **이슈**를 오늘 다시 수집했다 — 게시 2020년 · 수집 오늘
  const restaleIssue = { posted: '2020-12-13T15:00:00.000Z', captured: '2026-09-17T00:00:00.000Z' }
  // ② 오래된 **상시 소재** — 게시도 수집도 40일 전
  const oldEvergreen = { posted: '2026-08-08T00:00:00.000Z', captured: '2026-08-08T00:00:00.000Z' }
  // ③ 오늘 올라온 글
  const freshToday = { posted: '2026-09-16T22:00:00.000Z', captured: '2026-09-17T00:00:00.000Z' }

  check('🔴 [SF] 지금 기준(가져온 시각)으로는 ①과 ③이 **같아 보인다** — 이것이 결함이다',
    ageFrom(restaleIssue.captured) === ageFrom(freshToday.captured))
  check('🔴 [SF] 게시 시각 기준이면 ①이 2,000일 넘게 묵은 글로 갈린다',
    (ageFrom(restaleIssue.posted) ?? 0) > 2000)
  check('🔴 [SF] 게시 시각 기준이면 ③은 여전히 갓 올라온 글이다',
    (ageFrom(freshToday.posted) ?? 999) <= 1)
  check('🔴 [SF] 오래된 상시 소재는 두 기준이 같다 — 여기서는 달라지지 않는다',
    ageFrom(oldEvergreen.posted) === ageFrom(oldEvergreen.captured))
  check('🔴 [SF] 상시 소재 40일 — 현재성(7일)은 넘지만 상시(28일) 기준으로도 넘는다',
    (ageFrom(oldEvergreen.posted) ?? 0) > 28)

  // 🔴 미상·잘못된 시각
  check('🔴 [SF] 게시 시각을 모르면 나이도 모른다 (null) — warm 으로 적지 않는다',
    ageFrom('') === null)
  check('🔴 [SF] 읽을 수 없는 값도 모른다 (null)', ageFrom('어제쯤') === null)

  // 🔴 이번 PR 이 판정을 바꾸지 않았다는 증거
  {
    const src = readFileSync('src/lib/supply-freshness.ts', 'utf-8')
    check('🔴 [SF] TTL 상수를 건드리지 않았다',
      /hot:\s*2,/.test(src) && /timelyWarm:\s*7,/.test(src))
    check('🔴 [SF] 신선도 판정이 아직 게시 시각을 읽지 않는다 — 별도 PR 이다',
      !/sourcePostedAt/.test(src))
  }
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)

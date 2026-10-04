#!/usr/bin/env tsx
/**
 * 82cook 얇은 상세 fetch fixture — 🔴 **전문이 디스크에 남지 않는다** (§4-AP)
 *
 * 읽기만 한다. DB·네트워크·파일 쓰기 0.
 */
import { readFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  guardedGet, guardPath, guardRoot, setGuardRoot, writeGuardAtomic, readGuard, kstDayOf,
} from './lib/collect-guard-store.mjs'
import {
  newGuardState, recordRequest, recordFailure, breakerOf, BREAKER, type SourceId,
} from '../src/lib/collect-guard'
import {
  requestsPerRunOf, thin82cookRequestsPerRun, ROBOTS_REQUESTS_PER_RUN, factsOf,
} from '../src/lib/collect-schedule'
import {
  planThinFetch, toThinRow, violatesStorage, judgeLive, paceMs, flagsOf,
  THIN_COLUMNS, FORBIDDEN_COLUMNS, SKIP_LABEL,
  PACE_MIN_MS, PACE_MAX_MS, BATCH_CAP, COMMENT_TIER_HIGH, COMMENT_TIER_LOW,
  type ListRow,
} from '../src/lib/micro-seed-82cook-thin'
import { BODY_HEAD_CHARS } from './lib/micro-seed-raw-originality.mjs'
import { POST_CAP_PER_WEEK, MIN_DAYS_BETWEEN_POSTS } from '../src/lib/original-post-persona-match'
import { DAILY_PUBLISH_CAP } from '../src/lib/original-post-publish'

let pass = 0
let fail = 0
const check = (label: string, ok: boolean): void => {
  if (ok) { pass++; console.log(`  ✅ ${label}`) } else { fail++; console.log(`  ❌ ${label}`) }
}

/** 통과하는 표본 — 여기서 한 가지씩 어긋뜨려 본다 */
const ok = (o: Partial<ListRow> = {}): ListRow => ({
  sourceArticleId: '4234470', sourceSite: '82cook',
  originalTitle: '당근에서 집안일 도와주실 분 구해보신 분 계세요?',
  sourceCommentCount: 10, sourceViewCount: 500,
  sourceExcludeReason: '', sourcePoliticsExcluded: false, qualityFlags: [], ...o,
})
const base = { hasBody: new Set<string>() }

console.log('\n82cook 얇은 상세 fetch — 계약 확인')
console.log('─────────────────────────────────────────────────────────')

console.log('\n① 🔴 전문을 저장하지 않는다 — 이 레인의 존재 이유다')
{
  const row = toThinRow({
    id: '1', url: 'u', title: 't', commentCount: 9, score: 0,
    maskedBody: '가'.repeat(2000), bodyHeadChars: BODY_HEAD_CHARS,
    axis: 'seedOriginality', safetyVerdict: 'pass', safetyReasons: [],
    reason: '', runId: 'r', fetchedAt: 'now',
  })
  check(`🔴 bodyHead 가 ${BODY_HEAD_CHARS}자로 잘린다`, row.bodyHead.length === BODY_HEAD_CHARS)
  check('🔴 자르기 전 길이를 따로 남긴다 — 자른 뒤 길이를 쓰면 전부 300 이 된다',
    row.bodyLength === 2000)
  check('🔴 행에 전문 키가 없다', FORBIDDEN_COLUMNS.every((k) => !(k in row)))
  check('저장 컬럼이 계약과 정확히 같다', (() => {
    const keys = Object.keys(row).sort()
    return keys.join(',') === [...THIN_COLUMNS].sort().join(',')
  })())

  // 🔴 저장 직전 관문
  check('🟢 온전한 행은 통과', violatesStorage(row as unknown as Record<string, unknown>, BODY_HEAD_CHARS).length === 0)
  for (const k of FORBIDDEN_COLUMNS) {
    const bad = { ...row, [k]: '원문 전체' } as unknown as Record<string, unknown>
    check(`🔴 ${k} 가 섞이면 잡는다`,
      violatesStorage(bad, BODY_HEAD_CHARS).some((m) => m.includes(k)))
  }
  check('🔴 계약에 없는 컬럼도 잡는다',
    violatesStorage({ ...row, memo: 'x' } as unknown as Record<string, unknown>, BODY_HEAD_CHARS)
      .some((m) => m.includes('memo')))
  check(`🔴 bodyHead 가 ${BODY_HEAD_CHARS}자를 넘으면 잡는다`, violatesStorage(
    { ...row, bodyHead: '가'.repeat(BODY_HEAD_CHARS + 1) } as unknown as Record<string, unknown>,
    BODY_HEAD_CHARS,
  ).some((m) => m.includes('넘는다')))
  check('짧은 본문은 그대로', toThinRow({
    id: '1', url: 'u', title: 't', commentCount: 1, score: 0,
    maskedBody: '짧다', bodyHeadChars: BODY_HEAD_CHARS,
    axis: '', safetyVerdict: '', safetyReasons: [], reason: '', runId: 'r', fetchedAt: 'n',
  }).bodyHead === '짧다')
}

console.log('\n② 🔴 자동 경로에서 빼는 것 — 사람이 없기 때문이다')
{
  const cases: [string, Partial<ListRow>, string][] = [
    ['네이버 카페', { sourceSite: 'navercafe:remonterrace' }, 'NOT_82COOK'],
    ['목록 제외됨', { sourceExcludeReason: 'pinned' }, 'EXCLUDED'],
    ['정치 제외', { sourcePoliticsExcluded: true }, 'POLITICS'],
    ['정치 인물 플래그', { qualityFlags: ['politicalFigure'] }, 'FLAG_POLITICS'],
    ['📜 옛 혼합 플래그(가를 수 없음 → 정치로 읽는다)', { qualityFlags: ['politicalOrPublicFigure'] }, 'FLAG_POLITICS'],
    ['의료·광고성 플래그', { qualityFlags: ['medicalOrAdLikely'] }, 'FLAG_MEDICAL'],
    [`댓글 ${COMMENT_TIER_LOW} 미만`, { sourceCommentCount: 4 }, 'LOW_COMMENT'],
    ['id 없음', { sourceArticleId: '' }, 'NO_ID'],
  ]
  for (const [label, patch, code] of cases) {
    const r = planThinFetch({ ...base, rows: [ok(patch)] })
    check(`🔴 ${label} → 제외 (${code})`, r.targets.length === 0 && r.skipped[0]?.code === code)
  }
  check('🔴 이미 읽은 글은 다시 읽지 않는다', (() => {
    const r = planThinFetch({ rows: [ok()], hasBody: new Set(['4234470']) })
    return r.targets.length === 0 && r.skipped[0]?.code === 'HAS_BODY'
  })())
  check('플래그가 객체로 와도 읽는다',
    flagsOf(ok({ qualityFlags: { politicalOrPublicFigure: true, other: false } })).join(',')
      === 'politicalOrPublicFigure')
  check('플래그가 없으면 빈 배열', flagsOf(ok({ qualityFlags: undefined })).length === 0)
  check('🟢 다른 플래그는 막지 않는다',
    planThinFetch({ ...base, rows: [ok({ qualityFlags: ['clickbaitTitle'] })] }).targets.length === 1)
  check('제외 사유에 라벨이 있다', Object.keys(SKIP_LABEL).length === 10)

  // 🔴 플래그만으로는 모자랐다 — 2026-09-07 실측에서 정치 제목이 대상에 섞였다
  const judge = {
    isPolitics: (t: string) => /조국|이준석|정청래|대통령|극우|민주tv/.test(t),
    isBlocked: (t: string) => /광고|홍보/.test(t),
  }
  check('🔴 플래그가 없어도 제목이 정치면 뺀다', (() => {
    const r = planThinFetch({ ...base, judge, rows: [ok({ originalTitle: '조국 56일 뒤 어쩌고' })] })
    return r.targets.length === 0 && r.skipped[0]?.code === 'TITLE_POLITICS'
  })())
  check('🔴 제목 안전 판정에서도 뺀다', (() => {
    const r = planThinFetch({ ...base, judge, rows: [ok({ originalTitle: '광고입니다' })] })
    return r.targets.length === 0 && r.skipped[0]?.code === 'TITLE_SAFETY'
  })())
  check('🟢 생활 글은 통과한다',
    planThinFetch({ ...base, judge, rows: [ok({ originalTitle: '카레 어떤거 사세요?' })] })
      .targets.length === 1)
  check('🔴 judge 를 안 주면 제목을 안 본다 — 순수 판정만 볼 때의 기본값',
    planThinFetch({ ...base, rows: [ok({ originalTitle: '조국 56일 뒤 어쩌고' })] }).targets.length === 1)
}

console.log('\n③ 댓글 많은 것부터 · 순서가 고정이다')
{
  const rows = [
    ok({ sourceArticleId: 'a', sourceCommentCount: 5 }),
    ok({ sourceArticleId: 'b', sourceCommentCount: 12 }),
    ok({ sourceArticleId: 'c', sourceCommentCount: 8 }),
  ]
  const r = planThinFetch({ ...base, rows })
  check('댓글 내림차순', r.targets.map((t) => t.sourceArticleId).join(',') === 'b,c,a')
  check('🔴 입력 순서를 바꿔도 같다 — dry-run 에서 본 것이 그대로 열린다',
    planThinFetch({ ...base, rows: [...rows].reverse() })
      .targets.map((t) => t.sourceArticleId).join(',') === 'b,c,a')
  check('댓글이 같으면 조회수로 가른다', (() => {
    const x = planThinFetch({ ...base, rows: [
      ok({ sourceArticleId: 'p', sourceCommentCount: 7, sourceViewCount: 10 }),
      ok({ sourceArticleId: 'q', sourceCommentCount: 7, sourceViewCount: 99 }),
    ] })
    return x.targets[0]!.sourceArticleId === 'q'
  })())
  check('둘 다 같으면 id 로 가른다', (() => {
    const x = planThinFetch({ ...base, rows: [
      ok({ sourceArticleId: 'z', sourceCommentCount: 7, sourceViewCount: 1 }),
      ok({ sourceArticleId: 'a', sourceCommentCount: 7, sourceViewCount: 1 }),
    ] })
    return x.targets[0]!.sourceArticleId === 'a'
  })())
  check(`${COMMENT_TIER_HIGH}+ 와 ${COMMENT_TIER_LOW}~ 를 나눠 센다`, r.high === 1 && r.low === 2)
  check('상한을 넘기지 않는다', planThinFetch({ ...base, rows, cap: 2 }).targets.length === 2)
  check(`기본 상한은 ${BATCH_CAP}건`, BATCH_CAP === 50)
}

console.log('\n④ 🔴 스위치 없이는 밖으로 나가지 않는다')
{
  const g = { live: true, targets: 10, cap: 50, robotsAllowed: true }
  check('🟢 전부 맞으면 통과', judgeLive(g).ok)
  check('🔴 --live 없으면 요청 0', !judgeLive({ ...g, live: false }).ok)
  check('dry-run 이라고 말한다', (() => {
    const r = judgeLive({ ...g, live: false })
    return !r.ok && r.reason.includes('네트워크 요청 0')
  })())
  check('🔴 대상 0건이면 안 연다', !judgeLive({ ...g, targets: 0 }).ok)
  check('🔴 상한을 넘으면 안 연다', !judgeLive({ ...g, targets: 51, cap: 50 }).ok)
  check('🔴 robots 가 막으면 안 연다', !judgeLive({ ...g, robotsAllowed: false }).ok)
}

console.log('\n⑤ 요청 간격 3~5초 랜덤')
{
  check(`최소 ${PACE_MIN_MS}ms`, paceMs(0) === PACE_MIN_MS)
  check(`최대 ${PACE_MAX_MS}ms 미만`, paceMs(0.999999) < PACE_MAX_MS)
  check('중간값이 범위 안', (() => {
    const m = paceMs(0.5)
    return m >= PACE_MIN_MS && m < PACE_MAX_MS
  })())
  check('🔴 범위를 벗어난 입력도 안전하다', paceMs(-1) === PACE_MIN_MS && paceMs(2) < PACE_MAX_MS)
  check('🔴 고정 간격이 아니다 — 같은 간격으로 두드리면 패턴이 남는다',
    new Set([paceMs(0), paceMs(0.3), paceMs(0.7)]).size === 3)
  check('🔴 기존 82cook 고정 2000ms 를 쓰지 않는다', PACE_MIN_MS > 2000)
}

console.log('\n⑥ 🔴 하지 않는 것 — 스캔')
{
  // 🔴 주석을 지우고 본다 — 주석에 적힌 금지 패턴이 자기 자신을 잡으면 안 된다
  const codeOf = (p: string): string => readFileSync(p, 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const runner = codeOf('scripts/micro-seed-82cook-thin-detail.mts')
  const lib = codeOf('src/lib/micro-seed-82cook-thin.ts')

  for (const [label, re] of [
    ['Prisma / DB', /PrismaClient|prisma\./],
    ['Raw SQL', /\$executeRaw|\$queryRaw/],
    ['LLM', /openai|anthropic|gemini|gpt-/i],
    ['Sheet', /googleapis|spreadsheet/i],
    ['네이버 · 브라우저', /naver\.com|playwright|chromium|puppeteer/i],
    ['Post 생성', /post\.create/i],
    ['발행 호출', /publishOriginalPostTx\s*\(|from\s+'[^']*(?:publish-live|auto-publish)'/],
    ['Raw Vault 적재', /microSeedRawContent/],
  ] as const) {
    check(`🔴 러너에 ${label} 없음`, !re.test(runner))
  }

  // 🔴 전문 컬럼을 러너가 만들거나 읽지 않는다.
  //    lib 은 제외한다 — 거기 있는 것은 FORBIDDEN_COLUMNS 정의, 즉 **막는 쪽**이다.
  //    금지 목록이 금지 스캔에 걸리면 방어 코드를 못 쓰게 된다.
  for (const k of ['rawBody', 'sourceBody', 'bodyText'] as const) {
    check(`🔴 러너가 ${k} 를 쓰지 않는다`, !new RegExp(`\\b${k}\\b`).test(runner))
  }
  check('🔴 lib 의 금지 목록에는 그 이름들이 있어야 한다 — 막기 위해서다',
    ['rawBody', 'sourceBody', 'bodyText'].every((k) => FORBIDDEN_COLUMNS.includes(k)))

  check('🔴 lib 은 순수 함수만이다',
    !/readFileSync|writeFileSync|fetch\(|await |PrismaClient/.test(lib))
  check('🔴 두 스위치를 요구한다 — --live 하나로는 안 열린다',
    /--live/.test(runner) && /SORAN_82COOK_THIN_DETAIL_ENABLED/.test(runner))
  check('🔴 dry-run 이 기본이다 — LIVE 가 아니면 return 한다',
    /if \(!LIVE\) \{[\s\S]{0,400}return\n?\s*\}/.test(runner))
  check('🔴 robots 를 실행마다 확인한다', /parseRobotsTxt\(await get\(ROBOTS_URL\)\)/.test(runner))
  check('🔴 마스킹을 자르기 전에 한다', (() => {
    const iMask = runner.indexOf('maskSensitive(body)')
    const iCut = runner.indexOf('toThinRow(')
    return iMask > 0 && iCut > iMask
  })())
  check('🔴 산출물은 데이터 디렉터리 안에만', /isInsideDataDir/.test(runner))
  check('🔴 기존 collect-82cook 을 수정하지 않는다 — 순수 함수만 가져온다',
    /from '\.\/lib\/micro-seed-82cook\.mjs'/.test(runner)
    && !/collect-82cook/.test(runner.replace(/'[^']*'/g, '')))
  check('엔트리포인트 가드가 있다', /isDirectRun/.test(runner))
}

console.log('\n⑦ 🔴 pacing 상수를 건드리지 않았다')
{
  const m = readFileSync('src/lib/original-post-persona-match.ts', 'utf-8')
  // 🔴 **소스 문자열이 아니라 실제 값**을 본다 (2026-09-08).
  //    상수를 `RUNTIME_PROFILE` 에서 파생시키면서 `= 1` 리터럴이 사라졌다.
  //    원래 의도가 "값이 그대로인가" 였으므로 값으로 묻는 편이 더 강하다.
  check('POST_CAP_PER_WEEK = 1 그대로', POST_CAP_PER_WEEK === 1)
  check('MIN_DAYS_BETWEEN_POSTS = 5 그대로', MIN_DAYS_BETWEEN_POSTS === 5)
  check('DAILY_PUBLISH_CAP = 1 그대로', DAILY_PUBLISH_CAP === 1)
  check('🔴 82cook 기존 DELAY_MS 를 바꾸지 않았다',
    /export const DELAY_MS = 2000\b/.test(readFileSync('scripts/lib/micro-seed-82cook.mts', 'utf-8')))
  check(`🔴 BODY_HEAD_CHARS = ${BODY_HEAD_CHARS} 그대로`,
    /export const BODY_HEAD_CHARS = 300\b/.test(readFileSync('scripts/lib/micro-seed-raw-originality.mts', 'utf-8')))
}

/**
 * 🔴 **raw 목록 job 과 thin 상세 job 이 같은 차단기를 쓴다** (2026-09-14).
 *
 *    전에는 thin 이 `fetch` 를 직접 불렀다. 그래서 raw 가 NETWORK 차단기를 연 뒤에도
 *    40분 뒤 thin 이 **같은 IP 로 같은 도메인을 다시 두드렸다.**
 *    두 번째 guard 도 두 번째 상태 파일도 만들지 않았다 — `source: '82cook'` 하나를 공유한다.
 */
console.log('\n⑨ 🔴 82cook 두 job 이 차단기·예산·잠금을 공유한다')
{
  const RAW = 'scripts/micro-seed-collect-82cook.mts'
  const THIN = 'scripts/micro-seed-82cook-thin-detail.mts'
  const rawSrc = readFileSync(RAW, 'utf-8')
  const thinSrc = readFileSync(THIN, 'utf-8')

  check('🔴 thin 이 직접 fetch 하지 않는다 — guardedGet 정본을 쓴다',
    /guardedGet\(/.test(thinSrc)
    && !/await fetch\(/.test(thinSrc.replace(/\/\*[\s\S]*?\*\//g, '')))
  check('🔴 raw 도 같은 정본을 쓴다', /guardedGet\(/.test(rawSrc))
  check('🔴 두 job 이 같은 source id 를 쓴다 — 별도 차단기가 아니다', (() => {
    const idOf = (src: string): string | null =>
      /const GUARD_SOURCE: SourceId = '([^']+)'/.exec(src)?.[1] ?? null
    return idOf(rawSrc) === '82cook' && idOf(thinSrc) === '82cook'
  })())
  /** 🔴 **두 runner 의 실제 source id 를 읽어** 같은 경로가 되는지 본다 — 자기 비교가 아니다 */
  check('🔴 두 job 이 같은 guard 파일을 본다', (() => {
    const idOf = (src: string): string | null =>
      /const GUARD_SOURCE: SourceId = '([^']+)'/.exec(src)?.[1] ?? null
    const a = idOf(rawSrc)
    const b = idOf(thinSrc)
    if (a === null || b === null) return false
    return guardPath(a as SourceId) === guardPath(b as SourceId)
      && /collect-guard-82cook\.json$/.test(guardPath(a as SourceId))
  })())
  check('🔴 새 guard 추상화·별도 상태 파일을 만들지 않았다',
    !/collect-guard-82cook-thin|thin-guard|ThinGuard/.test(thinSrc))
  /** 🔴 프록시 · IP 교체 · UA 위장 · CAPTCHA 우회를 쓰지 않는다 */
  check('🔴 차단 우회 수단이 없다', (() => {
    const both = `${rawSrc}\n${thinSrc}`
    return !/proxy|Proxy|HttpsProxyAgent|rotate|CAPTCHA|captcha|puppeteer|playwright/.test(both)
      && !/Mozilla\/5\.0/.test(both)
  })())

  /**
   * 🔴 **차단기가 열리면 양쪽 다 멈춘다** — 실제 동작으로 확인한다.
   *    임시 디렉토리에서만 돌리고 실제 수집 상태 파일은 건드리지 않는다.
   *    `fetchImpl` 을 주입해 **외부 요청 0** 으로 검사한다.
   */
  {
    const tmp = mkdtempSync(join(tmpdir(), 'guard-82cook-'))
    const saved = guardRoot()
    setGuardRoot(tmp)
    try {
      const now = new Date('2026-09-14T09:00:00+09:00')
      // 한쪽 job 이 NETWORK 실패를 임계치까지 쌓아 차단기를 연다
      let st = newGuardState('82cook', kstDayOf(now))
      for (let i = 0; i < BREAKER.NETWORK.threshold; i += 1) {
        st = recordRequest(st, now.getTime())
        st = recordFailure(st, 'NETWORK', now.getTime())
      }
      writeGuardAtomic(st)
      check('🔴 NETWORK 차단기가 열렸다',
        breakerOf(readGuard('82cook', now), 'NETWORK', now.getTime()) === 'open')

      // 🔴 다른 job 이 같은 source 로 나가려 하면 **외부 요청 전에** 막힌다
      let calls = 0
      const spy: typeof fetch = async () => { calls += 1; return new Response('x', { status: 200 }) }
      let blocked = false
      await guardedGet({
        url: 'https://www.82cook.com/entiz/read.php?num=1', source: '82cook',
        now: () => now, headers: {}, fetchImpl: spy,
      }).catch(() => { blocked = true })
      check('🔴 한쪽이 차단기를 열면 다른 쪽도 외부 요청 0 건으로 멈춘다', blocked && calls === 0)

      /**
       * 🔴 **40분 뒤에도 막혀 있나 — 실제로 재 본다** (2026-09-14).
       *    thin job 은 raw 회차 40분 뒤에 돈다. 그때 상태를 그대로 물어본다.
       *
       * 🔴 **현 정책을 그대로 적는다.** NETWORK 쿨다운은 **10분**이고
       *    `requiresHuman` 이 아니므로, 10분이 지나면 `half-open` 이 되어
       *    **시험 요청 1건**이 나간다. 40분 뒤 thin 회차는 그 1건에 해당한다.
       *    이번 수정에서 쿨다운을 늘리거나 새 규제를 만들지 않았다 —
       *    고친 것은 "thin 이 차단기를 아예 보지 않던 것" 이다.
       */
      const at = (ms: number): Date => new Date(now.getTime() + ms)
      check('🔴 차단 직후·5분 뒤에는 여전히 open',
        breakerOf(readGuard('82cook', now), 'NETWORK', now.getTime()) === 'open'
        && breakerOf(readGuard('82cook', at(5 * 60_000)), 'NETWORK', at(5 * 60_000).getTime()) === 'open')
      check('🔴 40분 뒤에는 half-open 이다 — 시험 요청 1건이 허용된다 (쿨다운 10분)', (() => {
        const t40 = at(40 * 60_000)
        return BREAKER.NETWORK.cooldownMs === 600_000 && !BREAKER.NETWORK.requiresHuman
          && breakerOf(readGuard('82cook', t40), 'NETWORK', t40.getTime()) === 'half-open'
      })())
      check('🔴 시험 요청이 이미 나가 있으면 또 보내지 않는다 — half-open 은 1건뿐이다', (() => {
        const t40 = at(40 * 60_000)
        const probing = { ...st, failures: { ...st.failures,
          NETWORK: { ...st.failures.NETWORK, probeStartedAt: t40.getTime() } } }
        return breakerOf(probing, 'NETWORK', t40.getTime() + 1_000) === 'open'
      })())

      // 🔴 다른 source 는 막히지 않는다 — 한 곳 실패가 전체를 세우지 않는다
      let naver = 0
      const spy2: typeof fetch = async () => { naver += 1; return new Response('ok', { status: 200 }) }
      const r = await guardedGet({
        url: 'https://cafe.naver.com/x', source: 'navercafe:remonterrace',
        now: () => now, headers: {}, fetchImpl: spy2,
      })
      check('🟢 네이버 source 는 영향을 받지 않는다', naver === 1 && r.text === 'ok')
      check('🟢 supply-process 는 수집 차단기와 무관하다 — guard 를 부르지 않는다',
        !/guardedGet\(/.test(readFileSync('scripts/supply-process.mts', 'utf-8')))
    } finally {
      setGuardRoot(saved)
      rmSync(tmp, { recursive: true, force: true })
    }
  }

  /** 🔴 요청량은 실제 인자에서 파생된다 — robots 를 포함한다 */
  check('🔴 raw 한 회차 = robots 1 + 목록 3 = 4', requestsPerRunOf('82cook') === 4)
  check('🔴 thin 한 회차 = robots 1 + 상세 cap = 18', thin82cookRequestsPerRun() === 18)
  check('🔴 robots 도 요청으로 센다', ROBOTS_REQUESTS_PER_RUN === 1
    && /robots/i.test(rawSrc) && /robots/i.test(thinSrc))
  check('🔴 목록 전용 job 은 상세를 0건 연다', factsOf('82cook').detailPerRun === 0)
}

console.log('\n─────────────────────────────────────────────────────────')
console.log(`  ${fail === 0 ? '✅' : '❌'} ${pass} pass · ${fail} fail\n`)
if (fail > 0) process.exit(1)

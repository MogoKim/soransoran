#!/usr/bin/env tsx
/**
 * 원문 게시 시각 전달 검사 — 🔴 **네트워크 0 · 실제 provider 0 · DB 0**
 *
 * 🔴 **무엇이 틀렸었나** (2026-09-17 실측).
 *
 *    세 시각을 넘기는 배선이 얇은 변환기(`micro-seed-navercafe-thin.mts`)에만 있었고
 *    **운영 수집기(`micro-seed-collect-navercafe.mts`)에는 없었다.**
 *    후보 파일에는 칸이 다 있는데 값이 전부 `''` 였다 —
 *    실측 후보 1건: `sourcePostedAt:"" · sourceListedAt:"" · sourceCapturedAt:""`.
 *
 * 🔴 **그래서 변환기만 시험하지 않는다.** 운영 수집기가 부르는 **그 함수**를 시험하고,
 *    수집물 → thin → adapt → 후보 파일까지 합성 입력으로 값이 살아남는지 본다.
 *
 * 🔴 **모르는 게시 시각을 수집 시각으로 채우지 않는다.**
 * 🔴 **`sourcePostedAt` 은 사건 시각이 아니다** — 원문이 올라온 시각일 뿐이다.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LAST_SLOT_SCHEDULED_ENV } from './lib/fake-scheduled-slot-env.mjs'

import { sourceTimesOf, thinRowFromCollected } from '../src/lib/micro-seed-navercafe-thin'
import { NO_SOURCE_TIMES, THIN_COLUMNS } from '../src/lib/micro-seed-82cook-thin'
import { DATA_DIR_NAME } from '../src/lib/micro-seed-82cook-thin-adapt'
import { MACHINE_SITE_PREFIX, sourceEvidenceOf } from '../src/lib/micro-seed-supply-autofill'
import { buildQueueSnapshot, queueSnapshotFileName } from '../src/lib/supply-queue-snapshot'
import { writeFakePersonaAsset } from './lib/fake-persona-asset.mjs'
import { writeFakeSpeakerLoad } from './lib/fake-speaker-load.mjs'
import { evidenceMaterialFor, readListObservations } from './lib/source-list-observations.mjs'

let pass = 0
let fail = 0
const check = (n: string, ok: boolean, detail = ''): void => {
  if (ok) { pass += 1; console.log(`  ✅ ${n}`) } else { fail += 1; console.log(`  🔴 FAIL ${n}${detail === '' ? '' : ` — ${detail}`}`) }
}
console.log('\n══ 원문 게시 시각 전달 검사 (🔴 네트워크 0 · provider 0 · DB 0) ══\n')

/** 🔴 합성 값 — 실제 수집물이 아니다. 서로 다른 시각이라 섞이면 바로 드러난다 */
const POSTED = '2026-09-01T02:03:04.000Z'
const LISTED = '2026-09-16T11:22:33.000Z'
const CAPTURED = '2026-09-16T11:25:00.000Z'

// ─────────────────────────────────────────────────────────
console.log('① 조립 함수 — 🔴 운영 수집기가 부르는 바로 그 함수')
// ─────────────────────────────────────────────────────────
{
  const collected = {
    sourceArticleId: 'T1', sourceSite: 'navercafe:wgang',
    sourceUrl: 'https://cafe.naver.com/x/1', originalTitle: '합성 제목',
    sourceCommentCount: 3,
    sourcePostedAt: POSTED, sourceListedAt: LISTED, sourceCapturedAt: CAPTURED,
  }
  const row = thinRowFromCollected({
    collected, maskedBody: '합성 본문입니다. 실제 글이 아닙니다.', bodyHeadChars: 300,
    axis: 'sourceCandidate', safetyVerdict: 'pass', safetyReasons: [],
    reason: 'ok', runId: 'R1', fetchedAt: CAPTURED,
  })
  check('🔴 게시 시각이 살아남는다', row.sourcePostedAt === POSTED)
  check('🔴 목록에서 본 시각이 살아남는다', row.sourceListedAt === LISTED)
  check('🔴 가져온 시각이 살아남는다', row.sourceCapturedAt === CAPTURED)
  check('🔴 세 시각이 서로 섞이지 않는다',
    new Set([row.sourcePostedAt, row.sourceListedAt, row.sourceCapturedAt]).size === 3)
  check('🔴 얇은 계약 밖의 칸을 만들지 않는다',
    Object.keys(row).every((k) => THIN_COLUMNS.includes(k)))

  // 🔴 모르면 빈 문자열이다 — 수집 시각으로 채우지 않는다
  const noPost = thinRowFromCollected({
    collected: { ...collected, sourcePostedAt: undefined },
    maskedBody: '합성 본문', bodyHeadChars: 300,
    axis: 'sourceCandidate', safetyVerdict: 'pass', safetyReasons: [],
    reason: 'ok', runId: 'R1', fetchedAt: CAPTURED,
  })
  check('🔴 게시 시각을 모르면 빈 문자열이다', noPost.sourcePostedAt === '')
  check('🔴 🔴 모르는 게시 시각을 **가져온 시각으로 채우지 않는다**',
    noPost.sourcePostedAt !== noPost.sourceCapturedAt && noPost.sourceCapturedAt === CAPTURED)
  check('🔴 모르는 게시 시각을 목록 시각으로도 채우지 않는다', noPost.sourcePostedAt !== LISTED)
  const bad = thinRowFromCollected({
    collected: { ...collected, sourcePostedAt: '어제쯤' },
    maskedBody: '합성 본문', bodyHeadChars: 300,
    axis: 'sourceCandidate', safetyVerdict: 'pass', safetyReasons: [],
    reason: 'ok', runId: 'R1', fetchedAt: CAPTURED,
  })
  check('🔴 해석할 수 없는 값은 지어내지 않고 빈 문자열이다', bad.sourcePostedAt === '')
  check('🔴 없을 때의 정본이 빈 문자열 셋이다',
    NO_SOURCE_TIMES.sourcePostedAt === '' && NO_SOURCE_TIMES.sourceListedAt === ''
    && NO_SOURCE_TIMES.sourceCapturedAt === '')
  // 🔴 정본 helper 를 다시 쓰지 않았는지
  check('🔴 조립 함수가 정본 helper 로 시각을 읽는다',
    /times: sourceTimesOf\(c\)/.test(readFileSync('src/lib/micro-seed-navercafe-thin.ts', 'utf-8')))
  check('🔴 sourceTimesOf 를 직접 불러도 같은 결과다',
    sourceTimesOf(collected).sourcePostedAt === POSTED)
}

// ─────────────────────────────────────────────────────────
console.log('\n② 호출부 — 🔴 **운영 수집기**가 그 함수를 쓴다')
// ─────────────────────────────────────────────────────────
{
  const collect = readFileSync('scripts/micro-seed-collect-navercafe.mts', 'utf-8')
  const thin = readFileSync('scripts/micro-seed-navercafe-thin.mts', 'utf-8')
  check('🔴 운영 수집기가 정본 조립 함수를 부른다', /thinRowFromCollected\(\{/.test(collect))
  check('🔴 🔴 운영 수집기가 toThinRow 를 **직접 부르지 않는다** — 여기가 빠뜨렸던 자리다',
    !/(await\s+)?toThinRow\s*\(/.test(collect))
  check('🔴 얇은 변환기도 같은 함수를 쓴다 — 조립을 두 곳에 적지 않는다',
    /thinRowFromCollected\(\{/.test(thin) && !/(await\s+)?toThinRow\s*\(/.test(thin))
  check('🔴 수집기가 시각을 스스로 만들어 넣지 않는다',
    !/sourcePostedAt:\s*(new Date|nowIso|fetchedAt)/.test(collect))
}

// ─────────────────────────────────────────────────────────
console.log('\n③ 수집 → thin → adapt — 🔴 실제 adapt 러너를 돌린다')
// ─────────────────────────────────────────────────────────
const root = mkdtempSync(join(tmpdir(), 'st-'))
const dd = join(root, DATA_DIR_NAME)
mkdirSync(dd, { recursive: true })
// 🔴 유료 생성은 화자 여력 없이 돌지 않는다 — 공급 러너가 적는 그 파일을 잇는다
{
  const row = thinRowFromCollected({
    collected: {
      sourceArticleId: 'T9', sourceSite: 'navercafe:wgang',
      sourceUrl: 'https://cafe.naver.com/x/9', originalTitle: '합성 소재 제목입니다',
      sourceCommentCount: 5,
      sourcePostedAt: POSTED, sourceListedAt: LISTED, sourceCapturedAt: CAPTURED,
    },
    maskedBody: '합성 본문입니다. 사람이 쓴 글이 아니고 시험용으로 지어냈습니다. 충분히 길게 적어 둡니다.',
    bodyHeadChars: 300,
    axis: 'sourceCandidate', safetyVerdict: 'pass', safetyReasons: [],
    reason: 'ok', runId: 'R9', fetchedAt: CAPTURED,
  })
  /**
   * 🔴 (2026-09-30 Lane B) 반응(조회 · 자리)은 얇은 행에 **복사하지 않는다** — 정본은 목록 artifact 하나다.
   *    얇은 행은 그 관측과 잇는 열쇠(`sourceListedAt`)만 싣는다. 복사본이 되살아나면 여기서 걸린다.
   */
  check('🔴 🔴 (Lane B) 얇은 행에 반응 복사본(조회 · 자리)이 없다 · 목록 관측 열쇠(sourceListedAt)는 있다',
    !('sourceViewCount' in row) && !('sourcePage' in row) && !('sourceRankOnPage' in row) && row.sourceListedAt === LISTED)
  writeFileSync(join(dd, 'navercafe-thin-wgang-R9.thin-detail.jsonl'), `${JSON.stringify(row)}\n`, 'utf-8')

  const r = spawnSync(
    join(process.cwd(), 'node_modules/.bin/tsx'),
    [join(process.cwd(), 'scripts/micro-seed-82cook-thin-adapt.mts'), '--apply'],
    { cwd: root, encoding: 'utf-8' },
  )
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  check('🔴 adapt 러너가 돌았다', r.status === 0 || /detail/.test(out))
  const detailFiles = readdirSync(dd).filter((f) => f.endsWith('.detail.jsonl') && !f.endsWith('.raw-detail.jsonl'))
  check('🔴 adapt 가 detail 을 냈다', detailFiles.length > 0)
  const rows = detailFiles.flatMap((f) => readFileSync(join(dd, f), 'utf-8').split('\n')
    .filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as Record<string, unknown>))
  const t9 = rows.find((x) => String(x.sourceArticleId) === 'T9')
  check('🔴 adapt 를 지나도 게시 시각이 남는다', String(t9?.sourcePostedAt ?? '') === POSTED)
  check('🔴 목록 시각·가져온 시각도 남는다',
    String(t9?.sourceListedAt ?? '') === LISTED && String(t9?.sourceCapturedAt ?? '') === CAPTURED)
  check('🔴 🔴 게시 시각이 가져온 시각으로 바뀌지 않았다', String(t9?.sourcePostedAt) !== CAPTURED)
  check('🔴 🔴 (Lane B) adapt 행에도 반응 복사본(조회 · 자리)이 없다 — 목록 관측 열쇠만 간다',
    t9 !== undefined && !('sourceViewCount' in t9) && !('sourcePage' in t9) && !('sourceRankOnPage' in t9))
}

// ─────────────────────────────────────────────────────────
console.log('\n④ → 생성 → 후보 파일 — 🔴 가짜 provider · 임시 HOME · 네트워크 0')
// ─────────────────────────────────────────────────────────
{
  symlinkSync(join(process.cwd(), 'docs'), join(root, 'docs'))
  const fakeHome = join(root, 'home')
  mkdirSync(fakeHome, { recursive: true })
  writeFakePersonaAsset({ home: fakeHome })
  writeFileSync(join(dd, 'x.shadow.jsonl'), `${JSON.stringify({
    // 🔴 (P0-B) 판정기는 원천 사이트를 함께 적는다 — fixture 도 지금 판정 기록 모양이다
    sourceSite: 'navercafe:wgang', sourceArticleId: 'T9', decision: 'AUTO_SEED', semanticRisks: [],
    ruleVersion: 'auto-judge-v3', promptVersion: 'p', model: 'm', inputHash: 'h',
    provenance: 'machine-shadow',
    // 🔴 (2026-09-30) 참여 동력 — 앞판은 loadMeta 가 채우고 아무도 읽지 않았다(죽은 값)
    communityAngle: '합성 참여 동력',
  })}\n`, 'utf-8')
  const runId = 'ST1'
  const snapPath = join(dd, queueSnapshotFileName(runId))
  writeFileSync(snapPath, JSON.stringify(buildQueueSnapshot({ runId, takenAt: new Date(), rows: [] })), 'utf-8')
  // 🔴 생성은 **그 회차의** 여력 기록만 쓴다
  writeFakeSpeakerLoad(dd, 'fresh', null, runId)
  writeFileSync(join(dd, 'auto-draft-cache.json'), '{}', 'utf-8')

  const r = spawnSync(
    join(process.cwd(), 'node_modules/.bin/tsx'),
    [
      join(process.cwd(), 'scripts/micro-seed-auto-draft.mts'), '--call', '--apply',
      `--queue-snapshot=${snapPath}`, `--run-id=${runId}`, '--require-queue-snapshot',
    ],
    {
      cwd: root, encoding: 'utf-8',
      env: {
        ...process.env, HOME: fakeHome, ANTHROPIC_API_KEY: 'fixture-fake-key',
        // 🔴 v2 계획·생성은 Gemini 를 쓴다 — 키가 없으면 러너가 시작 전에 멈춘다
        GEMINI_API_KEY: 'fixture-fake-gemini-key',
        NODE_OPTIONS: `--import=${join(process.cwd(), 'scripts/lib/fake-provider-hook.mjs')}`,
        // 🔴 러너는 마지막 정기 슬롯 회차로 뜬다 — 정기 회차 몫 보호가 이 시험을 시각에 따라 막지 않게(2026-09-29)
        ...LAST_SLOT_SCHEDULED_ENV,
        // 🔴 시험용 임시 값. 운영 예산이 아니다
        SORAN_LLM_DAILY_BUDGET_USD: '1000',
        SORAN_LLM_RESERVE_HEADROOM: '1.5',
        SORAN_LLM_RUN_REQUEST_CAP: '10000',
      },
    },
  )
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const candFiles = readdirSync(dd).filter((f) => /^auto-draft-.*\.candidates\.json$/.test(f))
  check('🔴 후보 파일이 만들어졌다', candFiles.length > 0)
  const cands = candFiles.flatMap((f) => {
    const j = JSON.parse(readFileSync(join(dd, f), 'utf-8')) as { candidates?: Record<string, unknown>[] }
    return j.candidates ?? []
  })
  const c = cands.find((x) => String(x.sourceArticleId) === 'T9')
  check('🔴 T9 후보가 있다', c !== undefined)
  check('🔴 🔴 **후보 파일까지 게시 시각이 살아남는다** — 이것이 결함이었다',
    String(c?.sourcePostedAt ?? '') === POSTED)
  check('🔴 목록 시각·가져온 시각도 후보까지 살아남는다',
    String(c?.sourceListedAt ?? '') === LISTED && String(c?.sourceCapturedAt ?? '') === CAPTURED)
  check('🔴 후보의 게시 시각이 빈 문자열이 아니다 — 실측 결함 그대로 재현되지 않는다',
    String(c?.sourcePostedAt ?? '') !== '')
  check('🔴 🔴 **(Lane B) 후보 파일에 반응 복사본(sourceResponse)이 없다** — 적재가 목록 관측(정본)에서 찾는다',
    c !== undefined && !('sourceResponse' in c), JSON.stringify(c?.sourceResponse ?? null))
  check('🔴 🔴 **참여 동력이 후보 파일까지 온다**(죽은 값이 아니다)', String(c?.participationDriver ?? '') === '합성 참여 동력')
  if (c !== undefined) {
    /**
     * 🔴 (Lane B) 반응은 **수집기가 남긴 목록 줄**에서 온다 — 네이버 카페 회차 파일 모양 그대로 한 줄을 둔다.
     *    열쇠는 후보가 실어 온 `sourceListedAt` 이다. 적재 러너와 같은 두 함수(`readListObservations` → `evidenceMaterialFor`).
     */
    writeFileSync(join(dd, 'navercafe-wgang-20260916-112233.list.jsonl'), `${JSON.stringify({
      sourceSite: 'navercafe:wgang', sourceArticleId: 'T9', sourceListedAt: LISTED, sourceCapturedAt: LISTED,
      sourcePostedAt: POSTED, sourceCommentCount: 5, sourceCommentCountRead: true, sourceViewCount: 321,
      sourcePage: 1, sourceRankOnPage: 4, sourcePinned: false,
    })}\n`, 'utf-8')
    const idx = readListObservations(dd, new Date(CAPTURED))
    const m = evidenceMaterialFor(idx, {
      sourceKey: String(c.sourceSite), articleId: 'T9', postedAt: String(c.sourcePostedAt), listedAt: String(c.sourceListedAt), at: new Date(CAPTURED),
    })
    const ev = sourceEvidenceOf(c as never, m)
    const resp = ev.response as Record<string, unknown> | null
    check('🔴 적재기가 만든 원문 증거 — 세 시각 그대로 · 반응은 목록 관측에서(댓글 · 조회 · 자리 · 관측 시각) · 동력 · URL 없음 · 초안 시각은 draftedAt 에만',
      ev.postedAt === POSTED && ev.listedAt === LISTED && ev.capturedAt === CAPTURED
      && resp !== null && resp.views === 321 && resp.comments === 5 && resp.listRank === 4 && resp.listPage === 1 && resp.observedAt === LISTED
      && ev.participationDriver === '합성 참여 동력'
      && !JSON.stringify(ev).includes('cafe.naver.com') && ev.draftedAt !== POSTED, JSON.stringify(resp))
    const none = sourceEvidenceOf(c as never, null)
    check('🔴 목록 관측이 없으면 반응은 모른다(null) — 상세 · 봉투 복사본으로 메우지 않는다', none.response === null)
  }
  if (!existsSync(join(dd, 'x.shadow.jsonl'))) check('입력이 남아 있다', false)
  if (fail > 0) {
    const af = readdirSync(dd).filter((f) => /\.artifacts\.json$/.test(f))
    for (const f of af) {
      const arts = JSON.parse(readFileSync(join(dd, f), 'utf-8')) as Record<string, unknown>[]
      for (const a of arts) {
        const rv = a.review as Record<string, unknown>
        console.log(`    artifact ${String(a.sourceArticleId)} → ${String(rv.machineOutcome)} · ${String(rv.machineReason)}`)
        console.log(`      plan ${JSON.stringify(a.plan)}`)
        console.log(`      det ${JSON.stringify(rv.deterministic)}`)
      }
    }
    console.log(`\n  (생성 러너 출력 꼬리)\n${out.split('\n').slice(-12).map((l) => `    ${l}`).join('\n')}`)
  }
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤ 표현 — 🔴 게시 시각을 사건 시각이라고 적지 않는다')
// ─────────────────────────────────────────────────────────
{
  const files = [
    'src/lib/micro-seed-82cook-thin.ts',
    'src/lib/micro-seed-navercafe-thin.ts',
    'scripts/micro-seed-collect-navercafe.mts',
  ]
  for (const f of files) {
    const src = readFileSync(f, 'utf-8')
    check(`🔴 ${f} 가 게시 시각을 사건 시각이라 부르지 않는다`,
      !/sourcePostedAt[^\n]{0,60}(사건|발생) 시각(?!이 아니)/.test(src))
  }
  check('🔴 정본이 "사건 시각이 아니다" 를 명시한다',
    /사건이 일어난 시각.*아니|사건 시각이 아니다/.test(readFileSync('src/lib/micro-seed-82cook-thin.ts', 'utf-8')))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑤-b 🔴 (Lane B) 82cook **실제 artifact 형식** replay — 목록 → 얇은 행 → adapt → 묶음 증거 → 정본 판정')
// ─────────────────────────────────────────────────────────
{
  /**
   * 🔴 앞판 결함 두 겹(운영 artifact 재현):
   *    ① 82cook 목록 줄에 게시 · 목록 시각이 없었다 → 82cook 원천 136/136 `POSTED_MISSING`
   *    ② 목록 관측 읽기가 `navercafe-*` 이름만 알았다 → `82cook.list.jsonl` 을 열지 않아 표본 0 → `RESPONSE_UNNORMALIZED`
   *    여기서는 수집기 · 얇은 러너 · adapt · 공급 러너가 **실제로 부르는 함수**만 쓴다(판정을 복제하지 않는다).
   */
  const { parseListHtml, buildListRow } = await import('./lib/micro-seed-82cook.mjs')
  const { fixture82cookListHtml, FIXTURE_82COOK_ROWS } = await import('./lib/fixture-82cook-list.mjs')
  const { toThinRow } = await import('../src/lib/micro-seed-82cook-thin')
  const { toDetailRecord, toRawDetailRecord } = await import('../src/lib/micro-seed-82cook-thin-adapt')
  const { worksetRows } = await import('./supply-process.mjs')
  const { preGenerationRelease } = await import('../src/lib/supply-workset')
  const { LIST_ARTIFACT_FORMATS } = await import('./lib/source-list-observations.mjs')
  const d82 = mkdtempSync(join(tmpdir(), 'st82-'))
  const L1 = '2026-09-30T12:05:00.000Z' // 21:05 KST 회차
  const L2 = '2026-09-30T13:05:00.000Z' // 22:05 KST 회차 — 같은 글을 다시 본다
  // 🔴 수집기와 같은 조립: parseListHtml → 페이지 번호 → buildListRow(목록 시각) · 회차마다 **덧붙인다**
  const run = (at: string, bump: number): Record<string, unknown>[] => parseListHtml(fixture82cookListHtml(
    FIXTURE_82COOK_ROWS.map((r) => ({ ...r, comments: r.comments + (r.comments > 0 ? bump : 0), views: r.views + bump * 10 })),
  )).map((i) => buildListRow({ ...i, sourcePage: 1 }, at) as unknown as Record<string, unknown>)
  const r1 = run(L1, 0)
  const r2 = run(L2, 3)
  writeFileSync(join(d82, '82cook.list.jsonl'), `${[...r1, ...r2].map((r) => JSON.stringify(r)).join('\n')}\n`)
  // 🔴 옛 줄(목록 시각 · 게시 시각 없음 — 2026-09-12 운영 모양) 한 줄 · 모양 표에 없는 옛 파일 둘
  writeFileSync(join(d82, '82cook.list.jsonl'), `${JSON.stringify({ sourceSite: '82cook', sourceArticleId: '4200000', sourceCommentCount: 9, sourceCapturedAt: L1 })}\n`, { flag: 'a' })
  writeFileSync(join(d82, '82cook-verify.list.jsonl'), `${JSON.stringify({ ...r1[0], sourceArticleId: '1' })}\n`)
  writeFileSync(join(d82, 'navercafe-remonterrace.list.jsonl'), `${JSON.stringify({ sourceSite: 'navercafe:remonterrace', sourceArticleId: '9244768', sourceListedAt: L1, sourceCommentCount: 999, sourceViewCount: 99999, sourcePostedAt: L1 })}\n`)
  // 🔴 네이버 카페 회차 파일 — **같은 글 번호**(9244768)가 다른 원천에 있다. 82cook 표본에 섞이면 안 된다
  writeFileSync(join(d82, 'navercafe-wgang-20260930-120500.list.jsonl'), `${[0, 50, 100, 500].map((c, k) => JSON.stringify({
    sourceSite: 'navercafe:wgang', sourceArticleId: k === 0 ? '9244768' : `w${k}`, sourceListedAt: L1, sourceCapturedAt: L1,
    sourcePostedAt: '2026-09-30T11:50:00.000Z', sourceCommentCount: c, sourceCommentCountRead: true, sourceViewCount: c * 100, sourcePinned: false,
  })).join('\n')}\n`)

  const idx = readListObservations(d82, new Date(L2))
  check('🔴 🔴 **모양 표가 82cook 덧붙이기 파일을 연다** — 앞판은 0개',
    idx.byFormat['82cook-append'] === 1 && idx.byFormat['navercafe-run'] === 1, JSON.stringify(idx.byFormat))
  check('🔴 모양 표에 없는 옛 파일(`82cook-verify` · 회차 없는 네이버 파일)은 열지 않고 센다', idx.ignoredFiles === 2, String(idx.ignoredFiles))
  check('🔴 목록 시각 없는 옛 82cook 줄은 관측이 아니다(센다 · 지어내지 않는다)', idx.unobservable === 1, String(idx.unobservable))
  check('🔴 82cook 관측 — 두 회차 × 줄 수 · 같은 글이 회차마다 한 번씩',
    idx.byArticle.get('82cook::9244768')?.length === 2 && idx.sample.filter((o) => o.sourceKey === '82cook').length === FIXTURE_82COOK_ROWS.length * 2)
  // 🔴 덧붙이기 파일에 같은 회차가 두 번 붙었다(재시도) — 한 번 본 것을 두 번 본 것으로 세지 않는다
  const dupDir = mkdtempSync(join(tmpdir(), 'st82dup-'))
  writeFileSync(join(dupDir, '82cook.list.jsonl'), `${[...r1, ...r1, ...r2].map((r) => JSON.stringify(r)).join('\n')}\n`)
  const dupIdx = readListObservations(dupDir, new Date(L2))
  check('🔴 같은 글 · 같은 회차 줄이 두 번 붙어도 관측은 회차당 하나(재시도 덧붙이기)',
    dupIdx.byArticle.get('82cook::9244768')?.length === 2 && dupIdx.sample.length === idx.sample.filter((o) => o.sourceKey === '82cook').length,
    String(dupIdx.byArticle.get('82cook::9244768')?.length))
  check('활성 · 예정 connector 모양이 표에 다 있다(네이버 회차 · 82cook 덧붙이기)',
    LIST_ARTIFACT_FORMATS.map((f) => f.kind).join(',') === 'navercafe-run,82cook-append')

  // 🔴 얇은 러너 조립 — 목록 줄의 세 시각을 `sourceTimesOf` 로 옮긴다(러너와 같은 호출)
  const thinOf = (row: Record<string, unknown>) => toThinRow({
    id: String(row.sourceArticleId), url: String(row.sourceUrl), title: String(row.originalTitle),
    commentCount: Number(row.sourceCommentCount), score: 0,
    maskedBody: '합성 본문입니다. 우리 나이 이야기를 시험용으로 지어냈습니다. 다들 어떠세요? 충분히 길게 적어 둡니다.',
    bodyHeadChars: 300, axis: 'seedOriginality', safetyVerdict: 'pass', safetyReasons: [], reason: 'ok',
    runId: 'R82', fetchedAt: '2026-09-30T13:45:00.000Z', times: sourceTimesOf(row),
  })
  const latest = new Map(r2.map((r) => [String(r.sourceArticleId), r]))
  const thins = FIXTURE_82COOK_ROWS.map((f) => thinOf(latest.get(f.id)!))
  const t68 = thins.find((t) => t.sourceArticleId === '9244768')!
  check('🔴 🔴 **82cook 얇은 행이 게시 · 목록 · 수집 시각을 싣는다** — 게시 = 목록의 KST 속성 · 목록 = 수집 = 회차 시각',
    t68.sourcePostedAt === '2026-09-30T11:41:10.000Z' && t68.sourceListedAt === L2 && t68.sourceCapturedAt === L2, JSON.stringify([t68.sourcePostedAt, t68.sourceListedAt]))
  check('🔴 게시 시각이 수집 · 본문 연 시각으로 메워지지 않았다(속성 없는 줄은 빈 값)',
    thins.find((t) => t.sourceArticleId === '9244767')?.sourcePostedAt === '')
  writeFileSync(join(d82, '82cook-adapt-R82.detail.jsonl'), `${thins.map((t) => JSON.stringify(toDetailRecord(t))).join('\n')}\n`)
  writeFileSync(join(d82, '82cook-adapt-R82.raw-detail.jsonl'), `${thins.map((t) => JSON.stringify(toRawDetailRecord(t))).join('\n')}\n`)

  // 🔴 공급 러너의 묶음 증거 조립(`worksetRows`) → 생성 전 정본 판정
  const at = new Date('2026-09-30T14:00:00.000Z')
  const slot = new Date('2026-10-01T00:30:00.000Z')
  const rows = worksetRows([join(d82, '82cook-adapt-R82.detail.jsonl'), join(d82, '82cook-adapt-R82.raw-detail.jsonl')], readListObservations(d82, at), at)
  const w68 = rows?.find((r) => r.sourceArticleId === '9244768')
  const v68 = w68 === undefined ? null : preGenerationRelease(w68, slot, at)
  check('🔴 🔴 **82cook 후보가 정상 후보다** — 반응은 목록 관측(L2)에서 · 원천 상대 스냅샷 · 생성 전 판정 eligible',
    v68?.verdict === 'eligible' && w68?.evidence?.response?.observedAt === L2 && w68?.evidence?.response?.comments === 20
    && w68?.evidence?.sourceStats?.sourceKey === '82cook' && (v68?.rank.commentsPct ?? 0) > 0.5,
    JSON.stringify({ v: v68?.verdict, r: v68?.reasons, i: v68?.issue, resp: w68?.evidence?.response, st: w68?.evidence?.sourceStats }))
  check('🔴 🔴 **원천별 비교 — 82cook 표본 n 은 82cook 줄만**(같은 번호의 네이버 줄 · 999 댓글이 섞이지 않는다)',
    w68?.evidence?.sourceStats?.n === FIXTURE_82COOK_ROWS.length - 2, String(w68?.evidence?.sourceStats?.n))
  check('🔴 실제 반복 관측 2회 → velocity (댓글 17 → 20 · 1시간)', v68?.rank.velocity === 3, String(v68?.rank.velocity))
  {
    // 🔴 (P0-B) 같은 번호 9244768 이 네이버 카페에도 있다 — 공급 러너 메타(게시 · 목록 · 수집 시각)가 원천마다 따로 산다
    const NCP = '2026-09-29T01:00:00.000Z'
    writeFileSync(join(d82, 'nc-adapt-RNC.detail.jsonl'), `${JSON.stringify({
      sourceArticleId: '9244768', sourceSite: 'navercafe:wgang', title: '카페 쪽 다른 글', bodyHead: '카페 원문 머리',
      axis: 'seedOriginality', access: 'ok', safetyVerdict: 'pass', sourcePostedAt: NCP, sourceListedAt: NCP, sourceCapturedAt: NCP,
    })}\n`)
    const both = worksetRows([join(d82, '82cook-adapt-R82.detail.jsonl'), join(d82, '82cook-adapt-R82.raw-detail.jsonl'),
      join(d82, 'nc-adapt-RNC.detail.jsonl')], readListObservations(d82, at), at) ?? []
    const c = both.find((r) => r.sourceArticleId === '9244768' && r.sourceSite === '82cook')
    const n = both.find((r) => r.sourceArticleId === '9244768' && r.sourceSite === 'navercafe:wgang')
    check('🔴 🔴 **(P0-B) 같은 번호 82cook · 네이버 행이 둘 다 남고 각자 게시 시각 · 증거 출처를 지킨다** (`worksetRows` 메타)',
      c !== undefined && n !== undefined && c.sourcePostedAt === '2026-09-30T11:41:10.000Z' && n.sourcePostedAt === NCP
      && c.evidence?.postedAt === '2026-09-30T11:41:10.000Z' && n.evidence?.postedAt === NCP
      && c.evidence?.provenance.articleIdHash !== n.evidence?.provenance.articleIdHash,
      JSON.stringify([c?.sourcePostedAt, n?.sourcePostedAt]))
  }
  const w67 = rows?.find((r) => r.sourceArticleId === '9244767')
  check('🔴 날짜 속성 없는 82cook 줄 → POSTED_MISSING(추측하지 않는다)', w67 !== undefined && preGenerationRelease(w67, slot, at).reasons[0] === 'POSTED_MISSING')
  check('🔴 반응 원천은 목록 관측 하나 — 증거 기록에 원문 id · URL · 제목이 없다(해시만)',
    w68 !== undefined && !JSON.stringify(w68.evidence).includes('9244768') && !JSON.stringify(w68.evidence).includes('82cook.com')
    && /^[0-9a-f]{64}$/.test(w68.evidence?.provenance.articleIdHash ?? ''))

  // 🔴 열쇠는 정확히 그 목록 시각이다 — 다른 회차(최근) 관측으로 메우지 않는다
  const idxAt = readListObservations(d82, at)
  const m1 = evidenceMaterialFor(idxAt, { sourceKey: '82cook', articleId: '9244768', postedAt: '2026-09-30T11:41:10.000Z', listedAt: L1, at })
  const mX = evidenceMaterialFor(idxAt, { sourceKey: '82cook', articleId: '9244768', postedAt: '2026-09-30T11:41:10.000Z', listedAt: '2026-09-30T12:35:00.000Z', at })
  check('🔴 🔴 **수집이 본 목록(L1)의 수를 쓴다** — 뒤 회차(L2)의 수로 바꾸지 않는다 · 열쇠가 맞는 관측이 없으면 null',
    m1.response?.observedAt === L1 && m1.response?.comments === 17 && mX.response === null && mX.sourceStats === null)

  // 🔴 네이버 "댓글 수 못 읽음" — 상세 행은 0 으로 굳지만(앞판 증거가 그 0 을 읽었다) 목록 관측은 모름이다
  writeFileSync(join(d82, 'navercafe-wgang-20260930-130500.list.jsonl'), `${JSON.stringify({
    sourceSite: 'navercafe:wgang', sourceArticleId: 'wx', sourceListedAt: L2, sourceCapturedAt: L2, sourcePostedAt: '2026-09-30T12:50:00.000Z',
    sourceCommentCount: 0, sourceCommentCountRead: false, sourceViewCount: 40, sourcePinned: false,
  })}\n`)
  writeFileSync(join(d82, 'nc-R.detail.jsonl'), `${JSON.stringify({
    sourceArticleId: 'wx', sourceSite: 'navercafe:wgang', title: '합성 제목', bodyHead: '합성 본문 머리', axis: 'seedOriginality', lane: 'originalRaw',
    access: 'ok', safetyVerdict: 'pass', commentCount: 0, sourcePostedAt: '2026-09-30T12:50:00.000Z', sourceListedAt: L2, sourceCapturedAt: L2,
  })}\n`)
  const wx = worksetRows([join(d82, 'nc-R.detail.jsonl')], readListObservations(d82, at), at)?.find((r) => r.sourceArticleId === 'wx')
  check('🔴 🔴 **댓글 수를 못 읽은 네이버 줄 → 증거 댓글 null(모름)** — 상세 행의 0 을 읽지 않는다 · 조회는 목록 값',
    wx?.evidence?.response?.comments === null && wx?.evidence?.response?.views === 40, JSON.stringify(wx?.evidence?.response))

  // 🔴 러너 배선 — 얇은 러너가 목록 줄의 세 시각을 넘기고, 수집기가 목록 줄을 `buildListRow` 로 만든다
  const thinRunner = readFileSync('scripts/micro-seed-82cook-thin-detail.mts', 'utf-8')
  const collector82 = readFileSync('scripts/micro-seed-collect-82cook.mts', 'utf-8')
  check('🔴 82cook 얇은 러너가 목록 줄 시각을 넘긴다(`times: sourceTimesOf(t)`) · 원천+id 로 목록을 묶는다',
    /times: sourceTimesOf\(t\)/.test(thinRunner) && /byKey\.set\(`\$\{S\(r\.sourceSite\)\}::\$\{id\}`/.test(thinRunner))
  check('🔴 82cook 수집기가 목록 줄을 `buildListRow` 로 · 페이지 번호를 붙여 쓴다',
    /items\.map\(\(i\) => buildListRow\(i, now\.toISOString\(\)\)\)/.test(collector82) && /sourcePage: p \}/.test(collector82))
  // 🔴 주석 줄은 뺀다 — "앞판은 무엇을 읽었다" 는 설명이 코드로 읽히지 않게
  const code = (f: string): string => readFileSync(f, 'utf-8').split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n')
  const sp = code('scripts/supply-process.mts')
  const af = code('scripts/micro-seed-supply-autofill.mts')
  check('🔴 🔴 **반응 복사본 경로가 없다** — 공급 러너 · 적재기가 상세 · 봉투의 수를 증거로 읽지 않는다',
    !/C\(r\.commentCount/.test(sp) && !/sourceViewCount/.test(sp) && !/sourceResponse/.test(af) && /response: material\?\.response \?\? null/.test(sp))
}

// ─────────────────────────────────────────────────────────
console.log('\n⑥ 🔴 원천 기회 → 슬롯 판정(source-slot-v1) 반례 — 순수 검사 파일을 실행한다')
// ─────────────────────────────────────────────────────────
{
  const r = spawnSync(join(process.cwd(), 'node_modules/.bin/tsx'), [join(process.cwd(), 'scripts/source-slot-release-check.mts')], { encoding: 'utf-8' })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  const tail = out.trim().split('\n').filter((l) => /pass ·/.test(l)).pop() ?? '(요약 없음)'
  check(`🔴 🔴 **source-slot-release-check 통과** — ${tail.trim()}`, r.status === 0)
  if (r.status !== 0) console.log(out.split('\n').filter((l) => /FAIL/.test(l)).map((l) => `    ${l}`).join('\n'))
}

console.log(`\n${fail === 0 ? '✅' : '🔴'} ${pass} pass · ${fail} fail`)
if (fail > 0) process.exit(1)

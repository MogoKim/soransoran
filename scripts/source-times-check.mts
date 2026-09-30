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
      // 🔴 (2026-09-30) 목록에서 본 반응 — 얇은 변환이 버리면 안 된다
      sourceViewCount: 321, sourcePage: 1, sourceRankOnPage: 4,
    },
    maskedBody: '합성 본문입니다. 사람이 쓴 글이 아니고 시험용으로 지어냈습니다. 충분히 길게 적어 둡니다.',
    bodyHeadChars: 300,
    axis: 'sourceCandidate', safetyVerdict: 'pass', safetyReasons: [],
    reason: 'ok', runId: 'R9', fetchedAt: CAPTURED,
  })
  check('🔴 (source-evidence-v1) 얇은 행이 조회수 · 목록 자리를 버리지 않는다',
    row.sourceViewCount === 321 && row.sourcePage === 1 && row.sourceRankOnPage === 4 && row.commentCount === 5)
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
  check('🔴 (source-evidence-v1) adapt 를 지나도 반응 수가 남는다',
    t9?.sourceViewCount === 321 && t9?.sourcePage === 1 && t9?.sourceRankOnPage === 4 && t9?.commentCount === 5)
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
    sourceArticleId: 'T9', decision: 'AUTO_SEED', semanticRisks: [],
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
  const resp = (c?.sourceResponse ?? null) as Record<string, unknown> | null
  check('🔴 🔴 **(source-evidence-v1) 후보 파일까지 반응 수가 살아남는다** — 댓글 · 조회 · 자리 · 관측 시각',
    resp !== null && resp.comments === 5 && resp.views === 321 && resp.listRank === 4 && resp.listPage === 1 && resp.observedAt === LISTED,
    JSON.stringify(resp))
  check('🔴 🔴 **참여 동력이 후보 파일까지 온다**(죽은 값이 아니다)', String(c?.participationDriver ?? '') === '합성 참여 동력')
  if (c !== undefined) {
    const ev = sourceEvidenceOf(c as never, null)
    check('🔴 적재기가 만든 원문 증거 — 세 시각 그대로 · 반응 · 동력 · URL 없음 · 초안 시각은 draftedAt 에만',
      ev.postedAt === POSTED && ev.listedAt === LISTED && ev.capturedAt === CAPTURED
      && (ev.response as Record<string, unknown>).views === 321 && ev.participationDriver === '합성 참여 동력'
      && !JSON.stringify(ev).includes('cafe.naver.com') && ev.draftedAt !== POSTED)
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

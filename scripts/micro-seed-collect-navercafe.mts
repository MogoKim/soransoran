#!/usr/bin/env tsx
/**
 * 네이버 카페 Raw 수집 — 🔴 로컬 Mac 전용 · dry-run 기본
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-A · §5 · §5-A~D
 *
 * 🔴 **LOCAL ONLY.** 이 스크립트를 GHA 에서 돌리지 않는다.
 *    네이버 쿠키를 Secrets 에 올리는 순간 계정이 위험해지고, 계정 정지는 되돌릴 수 없다.
 *    82cook 은 로그인이 없어 GHA 후보지만 네이버는 아니다.
 *
 * 🔴 **여기가 종점이다.** Raw Vault 에 적재하지 않는다.
 *    prisma 를 import 하지 않고 Sheet 를 부르지 않는다. 산출물은 로컬 JSONL 뿐이다.
 *    적재는 importer 가 `--raw-only --batch=N` 으로 따로 한다 —
 *    수집과 적재를 파일로 나눈 것이 이 레일의 설계다.
 *
 * 🔴 **네이버는 raw-only 전용이다.** Micro Seed Sheet 레인으로 가는 경로가 없다.
 *    importer 의 judgeSourceSite 가 `navercafe:*` 를 micro-seed 레인에서 거부한다(PR-S2-b-1).
 *
 * 🔴 **댓글 본문을 수집하지 않는다.** 목록의 댓글 **수**만 신호로 쓴다.
 * 🔴 **이미지를 가져오지 않는다.** 텍스트만 남긴다.
 *
 * 🔴 **사람 속도로 읽는다.** randomDelay(base, 0.8, 1.5) — 82cook 의 고정 2초와 다르다.
 *    이것은 자연화이지 우회가 아니다. UA 위장 · IP 로테이션 · robots 무시는 하지 않는다.
 *
 * ⚠️ **브라우저는 `--live` 일 때만 뜬다.**
 *    dry-run · fixture · typecheck 는 브라우저 없이 전부 돈다.
 *    모듈은 `playwright` → `playwright-core` 순으로 동적 import 한다 —
 *    `playwright-core` 는 이미 이 저장소의 devDependency 다(PR-S2-b-3 정정).
 *    🔴 브라우저 바이너리는 받지 않는다. 기본값은 설치된 Google Chrome(`channel: 'chrome'`)이다.
 *
 * 안전장치
 *   dry-run 기본     --live 가 없으면 브라우저를 열지 않는다
 *   kill switch      SORAN_NAVERCAFE_COLLECT_ENABLED=true 가 아니면 --live 가 무시된다
 *   전용 세션        SORAN_NAVERCAFE_SESSION_PATH · 🔴 우나어 세션 재사용은 코드가 막는다
 *   락파일           /tmp/soransoran-navercafe.lock · TTL 30분 > 실행 timeout 15분
 *   quota            슬롯당 10건 (82cook 30 과 다르다 — 계정 정지는 비가역)
 *
 * 사용법
 *   npx tsx scripts/micro-seed-collect-navercafe.mts                      계획만
 *   npx tsx scripts/micro-seed-collect-navercafe.mts --cafe=wgang --pages=1 --max=3
 *   npx tsx scripts/micro-seed-collect-navercafe.mts --live               🔴 첫 live (승인 필요)
 */
import { appendFileSync, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  CAFES, findCafe, sourceSiteOf, slotQuota, buildCollected, assertNaverCandidate,
  judgeSession, judgeLock, randomDelay, parseArticleId,
  LIST_URL, ARTICLE_URL, DELAY_LIST_MS, DELAY_ARTICLE_MS,
  LOCK_PATH, LOCK_MAX_AGE_MS, RUN_TIMEOUT_MS,
  SESSION_PATH_ENV, KILL_SWITCH_ENV, FIRST_LIVE_CAFE_ID, FIRST_LIVE_PAGES, FIRST_LIVE_ARTICLES,
  PLAYWRIGHT_SPECS, BROWSER_CHANNEL_ENV, browserLaunchOptions, normalizeCount,
  safeFrameLabel, diagnoseEmptyList, summarizeProbes, judgeLockRelease, type FrameProbe,
  LIST_SELECTORS, runIdOf, runOutputPath,
  BOARD_TARGETS, findBoard, boardListUrl, pagesOf, maxPagesFor,
  detectRowLabel, judgePoliticsTitle, activeCafes,
  dedupeListRows, THRESHOLD_CANDIDATES, passesThreshold, thresholdBasis,
  type CollectedCandidate, type NaverListItem,
} from './lib/micro-seed-navercafe.mjs'
import { planAutoFetch, judgeAutoHold, AUTO_SKIP_LIST_FLAGS, AUTO_HOLD_DETAIL_FLAGS } from './lib/micro-seed-supply.mjs'
import { selectionScore, type QualityAssessment } from './lib/micro-seed-quality.mjs'
import { loadEnvLocal, kstString } from './lib/micro-seed-time.mjs'

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const LIVE = argv.includes('--live')
/**
 * 🔴 **scout = 목록만 본다. 상세를 열지 않는다** (PR-S2-b-7).
 *
 *    상세에 무조건 들어가지 않는 것이 이 레일의 원칙이다. 먼저 목록에서
 *    제목·댓글수·조회수·시각·라벨을 보고, 조건을 넘은 글만 상세 후보가 된다.
 *    scout 는 요청이 목록뿐이라 detail quota 와 별개로 더 깊이 볼 수 있다.
 */
const SCOUT = argv.includes('--scout')
const BOARD_KEY = arg('board')?.trim() ?? null
const BOARD = BOARD_KEY ? findBoard(BOARD_KEY) : null
if (BOARD_KEY && !BOARD) {
  console.error(`\n🛑 모르는 게시판: ${BOARD_KEY}\n   가능한 값: ${BOARD_TARGETS.map((b) => b.key).join(' · ')}\n`)
  process.exit(1)
}
const CAFE_ID = (BOARD?.cafeId ?? arg('cafe') ?? FIRST_LIVE_CAFE_ID).trim()
// 🔴 page range 는 board 기본값 → 인자 순으로 덮는다. --pages 는 하위호환.
const START_PAGE = Number(arg('start-page') ?? String(BOARD?.startPage ?? 1))
const END_PAGE = Number(
  arg('end-page') ?? String(BOARD ? BOARD.endPage : Number(arg('pages') ?? String(FIRST_LIVE_PAGES))),
)
const MAX = Number(arg('max') ?? String(FIRST_LIVE_ARTICLES))
/**
 * 🔴 **출력 경로는 실행 시각이 정해진 뒤에 만든다** (PR-S2-b-6).
 *
 *    앞 코드는 카페마다 고정 파일명이었고 writeJsonl 이 append 라,
 *    첫 live(22건)와 두 번째 live(22건)가 한 파일에 44행으로 섞였다.
 *    null 비율을 재다가 실제로 한 번 잘못 읽었다 — 분석이 성립하려면 실행이 갈려야 한다.
 *
 *    `--out` 을 주면 그것을 쓴다(수동 실행·재현용). 주지 않으면 실행별 파일이다.
 */
const OUT_OVERRIDE = arg('out') ?? null

const fail = (msg: string): never => {
  console.error(`\n🛑 ${msg}\n`)
  process.exit(1)
}

const cafe = findCafe(CAFE_ID)
if (cafe === null) {
  fail(`모르는 카페: ${CAFE_ID}\n   알려진 카페: ${CAFES.map((c) => c.cafeId).join(' · ')}`)
}
// 🔴 이번 라운드에서 빠진 카페는 여기서 막는다. 선택과 집중이 코드로 강제돼야
//    "설정에만 있고 아무도 안 지키는 결정" 이 되지 않는다 (PR-S2-b-7).
if (cafe!.stage === 'excluded') {
  fail(
    `${CAFE_ID} 는 이번 라운드 수집 대상이 아니다 — ${cafe!.note}\n` +
      `   지금 쓰는 카페: ${activeCafes().map((c) => c.cafeId).join(' · ')}`,
  )
}

const QUOTA = slotQuota(CAFE_ID)
// 🔴 scout(목록만)은 상세를 열지 않으므로 더 깊이 본다. detail 은 얕게 유지한다.
const PAGE_CAP = maxPagesFor(SCOUT ? 'scout' : 'detail')
let PAGE_LIST: number[]
try {
  PAGE_LIST = pagesOf({ startPage: START_PAGE, endPage: END_PAGE })
} catch (e) {
  fail(`page range 가 잘못됐다 — ${e instanceof Error ? e.message : String(e)}`)
}
if (PAGE_LIST!.length > PAGE_CAP) {
  fail(
    `페이지가 ${PAGE_LIST!.length}장이다 — ${SCOUT ? 'scout' : 'detail'} 모드 상한 ${PAGE_CAP}장을 넘는다.\n` +
      '   🔴 상세를 여는 실행은 얕게 유지한다. 깊게 보려면 --scout 로 목록만 본다.',
  )
}
if (!SCOUT && (!Number.isInteger(MAX) || MAX < 1 || MAX > QUOTA)) {
  fail(`--max 는 1~${QUOTA} 이다 — ${CAFE_ID} 의 슬롯 quota (받은 값: ${arg('max') ?? '없음'})`)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/**
 * 🔴 **append 하지 않는다** (PR-S2-b-6).
 *
 *    실행별 파일이라 섞일 일이 없고, 같은 파일에 두 번 쓰는 것은 `--out` 을 준
 *    수동 실행뿐이다. 그때도 "이번 실행의 결과" 가 파일 내용이어야 한다.
 *    append 였을 때 두 실행이 44행으로 섞여 분석을 한 번 망쳤다.
 */
function writeJsonl(path: string, rows: object[]) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, rows.map((r) => `${JSON.stringify(r)}\n`).join(''), 'utf-8')
}

async function main() {
  await loadEnvLocal()
  const now = new Date()
  const enabled = process.env[KILL_SWITCH_ENV] === 'true'
  const sessionPath = process.env[SESSION_PATH_ENV] ?? null

  console.log('\n네이버 카페 Raw 수집 — 🔴 로컬 전용')
  console.log(`  카페   ${cafe!.cafeId} (${cafe!.label}) · stage=${cafe!.stage}`)
  console.log(`  메모   ${cafe!.note}`)
  console.log('         🔴 메모는 경향일 뿐 고정 라벨이 아니다 — 주제 판정은 글 단위로 한다')
  console.log(`  소스   ${sourceSiteOf(cafe!.cafeId)}`)
  console.log(`  게시판 ${BOARD ? `${BOARD.label} (menuId=${BOARD.menuId}) · ${BOARD.purpose}` : '전체글보기 (기본)'}`)
  console.log(
    SCOUT
      ? `  계획   🔍 scout — 목록 ${START_PAGE}~${END_PAGE}p (${PAGE_LIST!.length}장) · 🔴 상세를 열지 않는다`
      : `  계획   목록 ${START_PAGE}~${END_PAGE}p (${PAGE_LIST!.length}장) · 상세 최대 ${MAX}건 (quota ${QUOTA})`,
  )
  console.log(`  간격   목록 ${DELAY_LIST_MS}ms · 상세 ${DELAY_ARTICLE_MS}ms · 🔴 ±jitter (사람 속도)`)
  console.log(`  kill switch ${KILL_SWITCH_ENV}=${enabled ? 'ON' : 'OFF'} · --live ${LIVE ? '있음' : '없음'}`)
  console.log(`  세션   ${SESSION_PATH_ENV} ${sessionPath === null ? '🔴 없음' : '설정됨'}`)
  console.log('')
  console.log('  🔴 DB write 없음 · Sheet 접근 없음 · Candidate 없음 · Post 없음 · Queue 없음')
  console.log('  🔴 댓글 본문 미수집 · 이미지 미수집 · 적재는 importer 가 따로 한다')
  console.log(`  ① 목록 단계 제외 : ${AUTO_SKIP_LIST_FLAGS.join(' · ')}`)
  console.log(`  ② 상세 단계 보류 : ${AUTO_HOLD_DETAIL_FLAGS.join(' · ')} (적재 시점)`)
  console.log('')

  if (cafe!.stage === 'shadow') {
    console.log('  🟡 shadow 소스다 — 수집은 하되 Original Post 재료로 바로 쓰지 않는다\n')
  }

  // ── dry-run 종점 ────────────────────────────────────
  const live = LIVE && enabled
  if (!live) {
    const urls = PAGE_LIST!.map((p) => (BOARD ? boardListUrl(BOARD, p) : LIST_URL(cafe!.cafeId, p)))
    console.log(`  대상 목록 URL (${urls.length}장):`)
    // 🔴 전부 찍지 않는다. 16장을 다 찍으면 정작 봐야 할 경고가 스크롤 밖으로 밀린다
    for (const u of urls.slice(0, 4)) console.log(`     ${u}`)
    if (urls.length > 4) console.log(`     … 외 ${urls.length - 4}장`)
    console.log('\n  🔍 dry-run 종료. 브라우저 0 · 네트워크 0 · 파일 쓰기 0.')
    if (LIVE && !enabled) console.log(`     (--live 를 줬지만 ${KILL_SWITCH_ENV} 가 true 가 아니라 무시했다)`)
    console.log('')
    return
  }

  // ── 여기서부터 live ─────────────────────────────────
  //
  // 🔴 세션 판정을 브라우저보다 **먼저** 한다. 우나어 세션 재사용은 파일이 실제로
  //    존재하므로, 존재 검사만 하면 통과해 버린다.
  const sv = judgeSession({
    sessionPath,
    exists: sessionPath !== null && sessionPath !== '' && existsSync(sessionPath),
    halted: existsSync(`${LOCK_PATH}.halted`),
  })
  if (!sv.ok) fail(`${sv.code} — ${sv.detail}`)

  // 🔴 락. TTL(30분) > 실행 timeout(15분) — 짧으면 아직 도는 작업을 죽은 것으로 본다
  const lockMtime = existsSync(LOCK_PATH) ? statSync(LOCK_PATH).mtimeMs : null
  const lv = judgeLock(lockMtime, now.getTime())
  if (!lv.ok) fail(`락이 잡혀 있다 — ${lv.detail}`)
  appendFileSync(LOCK_PATH, `${now.toISOString()}\n`, 'utf-8')

  const chromium = await loadChromium()

  // 🔴 실행 식별자를 여기서 못 박는다. 이 뒤의 모든 행이 같은 runId 를 갖는다.
  const listedAtIso = new Date().toISOString()
  const RUN_ID = runIdOf(listedAtIso)
  const OUT = OUT_OVERRIDE ?? runOutputPath(CAFE_ID, RUN_ID, 'detail')
  const OUT_LIST = OUT_OVERRIDE
    ? OUT_OVERRIDE.replace(/\.jsonl$/, '.list.jsonl')
    : runOutputPath(CAFE_ID, RUN_ID, 'list')

  console.log(`  🔴 실제 수집 · run ${RUN_ID}`)
  console.log(`     상세 ${OUT}`)
  console.log(`     목록 ${OUT_LIST}\n`)
  const started = Date.now()
  const collected: CollectedCandidate[] = []
  let browser: NaverBrowser | null = null

  try {
    // 🔴 기본은 설치된 Chrome. 번들 chromium(rev 1234)이 로컬에 없어도 뜬다
    const launchOpts = browserLaunchOptions({ channel: process.env[BROWSER_CHANNEL_ENV], headless: true })
    console.log(`  브라우저: ${launchOpts.channel ?? '번들 chromium'}`)
    browser = await chromium.launch(launchOpts)
    const context = await browser.newContext({ storageState: sessionPath!, locale: 'ko-KR' })
    const page = await context.newPage()

    // ── ① 목록 ──
    const items: NaverListItem[] = []
    const allProbes: FrameProbe[] = []
    for (const [idx, p] of PAGE_LIST!.entries()) {
      if (Date.now() - started > RUN_TIMEOUT_MS) throw new Error('실행 timeout')
      // 🔴 board 가 있으면 신형 menuId URL, 없으면 기존 전체글보기 URL (하위호환)
      const url = BOARD ? boardListUrl(BOARD, p) : LIST_URL(cafe!.cafeId, p)
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await sleep(randomDelay(DELAY_LIST_MS))
      const read = await readList(page, cafe!.cafeId, p)
      items.push(...read.items)
      allProbes.push(...read.probes)
      console.log(`  목록 ${p}p → 누적 ${items.length}건`)
      // 🔴 0건일 때는 프레임별로 무슨 일이 있었는지 즉시 보여준다.
      //    한 줄짜리 "0건" 만 보고는 다음에 무엇을 고칠지 정할 수 없다.
      if (read.items.length === 0) for (const line of summarizeProbes(read.probes)) console.log(`     · ${line}`)
      if (idx < PAGE_LIST!.length - 1) await sleep(randomDelay(DELAY_LIST_MS))
    }
    if (items.length === 0) {
      const d = diagnoseEmptyList(allProbes)
      throw new Error(`목록이 비었다 [${d.code}] — ${d.detail}`)
    }

    // ── ② 자동 선별 (목록 단계 제외) ──
    // listedAtIso 는 실행 시작 시점에 못 박았다 (runId 와 같은 시각).
    // 🔴 목록을 **본** 시각과 상세를 여는 시각은 다르다 — time lag 조사가 그 차이를 쓴다.
    const rawRows = items.map((i) => buildCollected(cafe!.cafeId, i, '', listedAtIso, listedAtIso))

    // 🔴 크롤 중 새 글이 올라오면 같은 글이 두 페이지에 걸린다 (실측: 225건 중 1건).
    //    threshold 를 백분율로 재는 순간 분모가 오염되므로 **분석 전에** 지운다.
    const dedup = dedupeListRows(rawRows)
    if (dedup.duplicates > 0) {
      console.log(`  ♻️ 페이지 간 중복 ${dedup.duplicates}건 제거 (${dedup.duplicateIds.slice(0, 5).join(' · ')})`)
      console.log('     🔴 크롤 중 새 글이 올라와 밀린 것이다 — 먼저 본 위치를 남긴다')
    }
    const listRows = dedup.rows
    writeJsonl(OUT_LIST, listRows)

    // 🔴 자동 상세 fetch 에서 빼는 이유는 **하나의 판정**이 정한다 (judgeExcludeReason).
    //    축이 갈라져 있으면 "어느 쪽이 최종 차단인가" 를 코드만 보고 답할 수 없다.
    //    **파일에서 지우는 것이 아니다** — 목록 JSONL 에는 전부 남는다.
    const byReason = { politics: 0, publicFigure: 0, pinned: 0 }
    for (const r of listRows) if (r.sourceExcludeReason) byReason[r.sourceExcludeReason] += 1
    if (byReason.politics) {
      console.log(`  🚫 정치·진영 ${byReason.politics}건 — 상세 대상 제외`)
      console.log('     🔴 public · growth · shadow 어디에도 가지 않는다 (설계 §4-C)')
    }
    if (byReason.publicFigure) {
      console.log(`  🟡 실명·공인 언급 ${byReason.publicFigure}건 — 생활 레인 상세 대상 제외`)
      console.log('     🔴 연예·방송·셀럽이 섞인다. Growth 레인이 열리면 여기서 갈라야 한다')
    }
    if (byReason.pinned) console.log(`  📌 고정 슬롯 ${byReason.pinned}건 — 상세 대상 제외 (공지·필독·추천)`)

    // 🔴 threshold 는 **제외 후 후보**에 건다 (PR-S2-b-9).
    //    전체 목록에 걸면 상세를 열 수도 없는 고정 슬롯이 통과율을 끌어올린다 —
    //    유머·연예 1p 실측에서 전체 35% vs 후보 7% 로 갈렸다.
    const basis = thresholdBasis(listRows)

    if (SCOUT) {
      // ── 🔍 scout 종료 — 상세를 열지 않는다 ──
      console.log(`\n  🔍 scout 종료 — 목록 ${basis.total}건 기록. 상세 요청 0.`)
      console.log(`     제외 ${basis.total - basis.eligible.length - basis.legacy}건 → 상세 후보 ${basis.eligible.length}건`)
      // 🔴 이 실행에서는 0 이어야 한다. 0 이 아니면 buildCollected 를 안 거친 행이 섞인 것이다
      if (basis.legacy > 0) console.log(`     ⚠️ 판정 없는 행 ${basis.legacy}건 — 제외가 아니라 "판정 자체가 없다"`)
      // 🔴 후보값으로 세어만 본다. 코드가 이 값으로 자동 판정하지 않는다
      for (const t of THRESHOLD_CANDIDATES) {
        const n = basis.eligible.filter((r) => passesThreshold(r, t)).length
        const pct = basis.eligible.length === 0 ? 0 : Math.round((n / basis.eligible.length) * 100)
        const whole = listRows.filter((r) => passesThreshold(r, t)).length
        console.log(
          `     후보 ${t.label} (댓글>=${t.minComments} AND 조회>=${t.minViews}) → ` +
            `${n}/${basis.eligible.length}건 (${pct}%)  · 전체 기준이면 ${whole}건 — 🔴 비교 축이 아니다`,
        )
      }
      console.log(`     → ${OUT_LIST}`)
      console.log(`\n  🔴 상세 JSONL 을 만들지 않았다. threshold 를 정하기 전에는 상세를 열지 않는다.`)
      console.log(`     (${kstString(now)} KST · run ${RUN_ID})\n`)
      return
    }

    const eligible = basis.eligible
    const plan = planAutoFetch(
      eligible.map((r) => ({
        sourceArticleId: r.sourceArticleId,
        score: selectionScore({ stage: r.qualitySignals.stage, flags: r.qualityFlags, signals: r.qualitySignals } as QualityAssessment),
        flags: r.qualityFlags,
        alreadyInVault: false,
      })),
      { max: MAX },
    )
    console.log(`\n  자동 선별 ${plan.picked.length}건 · 제외 ${plan.skipped.length}건 (후보 ${eligible.length}/${listRows.length})`)
    console.log('  🔴 제외는 파일에서 지운 것이 아니다 — 목록 JSONL 에 전부 남아 있다\n')

    // ── ③ 상세 ──
    const known = new Map(items.map((i) => [i.sourceArticleId, i]))
    for (const [idx, id] of plan.picked.entries()) {
      if (Date.now() - started > RUN_TIMEOUT_MS) throw new Error('실행 timeout')
      if (idx > 0) await sleep(randomDelay(DELAY_ARTICLE_MS))
      await page.goto(ARTICLE_URL(cafe!.cafeId, id), { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await sleep(randomDelay(DELAY_ARTICLE_MS))
      const read = await readArticleBody(page)
      const body = read.body
      if (!body) {
        console.log(
          read.errors.length
            ? `  ⚠️ ${id} — 본문 셀렉터가 터졌다(건너뛴다): ${read.errors[0]}`
            : `  ⚠️ ${id} — 본문이 비었다. 셀렉터가 안 맞거나 접근이 막혔다(건너뛴다)`,
        )
        continue
      }
      const row = buildCollected(cafe!.cafeId, known.get(id)!, body, new Date().toISOString(), listedAtIso)
      assertNaverCandidate(row)
      collected.push(row)
      console.log(`  ✅ ${id} · ${[...body].length}자 · 댓글 ${row.sourceCommentCount}`)
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
    // 🔴 성공이든 실패든 락을 푼다. 앞 코드는 풀지 않아 실패 후 TTL 30분을
    //    기다려야 했다 — 재시도가 막히면 원인을 좁힐 기회 자체가 사라진다.
    //
    // 🔴 해제 실패가 원래 예외를 가리지 않는다. 수집이 왜 실패했는지가 본론이고
    //    락을 못 지운 것은 곁가지다 — 경고만 내고 예외는 그대로 올라간다.
    const existed = existsSync(LOCK_PATH)
    let unlinkError: unknown = null
    if (existed) { try { unlinkSync(LOCK_PATH) } catch (e) { unlinkError = e } }
    const rel = judgeLockRelease(existed, unlinkError)
    if (rel.warning) console.warn(`  ⚠️ ${rel.warning}`)
  }

  if (collected.length) {
    // 🔴 보류 대상도 파일에 남긴다 (Q-1). 보류는 **적재 단계**가 한다
    writeJsonl(OUT, collected)
    console.log(`\n  → ${OUT} (${collected.length}건 · run ${RUN_ID})`)
    const held = collected.filter((r) => judgeAutoHold({ sourceArticleId: r.sourceArticleId, flags: r.qualityFlags }).hold)
    console.log(held.length ? `  🟡 자동 적재 보류 예정 ${held.length}건 (상세 플래그)` : '  🟢 자동 적재 보류 예정 0건')
  }
  console.log(`\n  🔴 Raw Vault 에 적재하지 않았다. 적재는 importer 가 한다:`)
  console.log(`     npx tsx scripts/micro-seed-import-82cook-live.mts --raw-only --batch=10 --input=${OUT}`)
  console.log(`     (--apply 를 붙여야 실제로 적재된다 · ${kstString(now)} KST)\n`)
}

// ─────────────────────────────────────────────────────────
// DOM 읽기 — 🔴 셀렉터는 실측으로 확정한다
// ─────────────────────────────────────────────────────────

/** 브라우저에서 꺼내오는 원자료 — 🔴 문자열뿐. 해석은 밖에서 한다 */
type ListProbeRow = {
  href: string; title: string
  comments: string; date: string; views: string; board: string
  /** 🔴 공지·필독·추천 라벨 텍스트와 행 class — 둘 다 봐야 놓치지 않는다 */
  labelText: string; rowClass: string
  rowFound: boolean; metaError: string | null
}
type ListProbe = { linkHits: number; rows: ListProbeRow[] }

type NaverPage = {
  goto: (url: string, o: object) => Promise<unknown>
  // 🔴 arg 를 받는 오버로드가 필요하다. 셀렉터를 콜백 **밖에서** 넘겨야
  //    콜백 안에 이름 있는 상수를 만들지 않을 수 있다 (esbuild __name 회피).
  $$eval: {
    <T>(sel: string, fn: (els: Element[]) => T): Promise<T>
    <T, A>(sel: string, fn: (els: Element[], arg: A) => T, arg: A): Promise<T>
  }
  frames: () => { $$eval: NaverPage['$$eval']; url: () => string }[]
}
type NaverBrowser = {
  close: () => Promise<void>
  newContext: (o: object) => Promise<{ newPage: () => Promise<NaverPage> }>
}
type Chromium = { launch: (o: object) => Promise<NaverBrowser> }

/**
 * Playwright 모듈을 live 경로에서만 동적으로 부른다.
 *
 * 🔴 **`playwright` 만 찾지 않는다.** 이 저장소에는 `playwright-core` 가 이미 devDependency 로
 *    들어 있다(package.json). 앞 코드는 `playwright` 만 보고 "설치돼 있지 않다" 고 말했다 —
 *    있는 것을 없다고 한 셈이라 PR-S2-b-3 에서 고쳤다.
 *
 *    문자열 변수로 부르는 이유는 그대로다: 없는 모듈을 정적으로 import 하면 typecheck 가 깨진다.
 *    dry-run · fixture · typecheck 는 브라우저 없이 전부 돈다.
 */
async function loadChromium(): Promise<Chromium> {
  for (const spec of PLAYWRIGHT_SPECS) {
    try {
      const mod = (await import(spec)) as { chromium?: Chromium }
      if (mod.chromium) return mod.chromium
    } catch {
      // 다음 후보로 넘어간다
    }
  }
  return fail(
    `Playwright 를 찾지 못했다 (시도: ${PLAYWRIGHT_SPECS.join(', ')}).\n` +
      '     npm i -D playwright-core\n' +
      '   🔴 브라우저 바이너리는 받지 않아도 된다 — 기본은 설치된 Google Chrome 을 쓴다\n' +
      `      (${BROWSER_CHANNEL_ENV}=chromium 을 주면 번들 브라우저를 쓴다).`,
  )
}

/**
 * 🔴 목록 셀렉터는 **첫 live 에서 실측 후 확정**한다.
 *    네이버 카페는 iframe 구조이고 신형/구형 DOM 이 섞여 있어(우나어 실측),
 *    실제 페이지를 보지 않고 적은 셀렉터는 조용히 0건을 반환한다.
 *    지금은 구조만 두고 첫 live 에서 사람이 확인한다 — 0건이면 위에서 throw 한다.
 */
async function readList(
  page: NaverPage,
  cafeId: string,
  pageNo: number,
): Promise<{ items: NaverListItem[]; probes: FrameProbe[] }> {
  const frames = page.frames().filter((f) => f.url().includes('cafe.naver.com'))
  const probes: FrameProbe[] = []
  const unknownLabels = new Set<string>()

  for (const [idx, f] of [page, ...frames].entries()) {
    const label = idx === 0 ? '(top)' : safeFrameLabel(frames[idx - 1].url())
    try {
      // 🔴 브라우저 안에서는 **문자열을 그대로 꺼내오기만** 한다.
      //    해석(숫자 변환 · 시각 파싱)은 밖의 순수 함수가 한다 —
      //    $$eval 안의 코드는 fixture 로 검증할 수 없기 때문이다.
      //
      // 🔴 **메타 추출이 링크 수집을 죽이지 않는다** (PR-S2-b-5).
      //    메타 셀렉터 하나가 터지면 콜백 전체가 터지고, 그 예외를 바깥
      //    catch 가 삼켜 "목록 0건" 으로 보였다 — 2026-09-03 실측 사고.
      //    그래서 메타는 콜백 **안에서** 각자 try 로 감싼다.
      // 🔴 명시 제네릭을 주지 않는다 — 주면 arg 없는 오버로드가 선택된다. 추론에 맡긴다.
      const probe: ListProbe = await f.$$eval(LIST_SELECTORS.link, (els: Element[], sel: typeof LIST_SELECTORS): ListProbe => {
        const rows = els.map((el) => {
          const a = el as HTMLAnchorElement
          const base = { href: a.href, title: (a.textContent ?? '').trim() }
          try {
            const near = a.closest(sel.row)
            // 🔴 여기서 `const pick = () => ...` 같은 **이름 있는 함수를 만들지 않는다.**
            //    esbuild(tsx) 의 keepNames 가 __name(...) 래퍼를 씌우는데
            //    브라우저에는 그 헬퍼가 없어 ReferenceError 가 난다 — 2026-09-03 실측 원인.
            return {
              ...base,
              comments: near?.querySelector(sel.comment)?.textContent?.trim() ?? '',
              date: near?.querySelector(sel.date)?.textContent?.trim() ?? '',
              views: near?.querySelector(sel.view)?.textContent?.trim() ?? '',
              board: near?.querySelector(sel.board)?.textContent?.trim() ?? '',
              labelText: near?.querySelector(sel.label)?.textContent?.trim() ?? '',
              rowClass: near === null ? '' : String((near as HTMLElement).className || ''),
              // 🔴 행을 찾았는가. 댓글 링크는 **댓글이 0 이면 아예 없다** —
              //    행을 찾았는데 링크가 없으면 "못 읽음" 이 아니라 "진짜 0" 이다.
              rowFound: near !== null,
              metaError: null as string | null,
            }
          } catch (e) {
            return {
              ...base, comments: '', date: '', views: '', board: '', labelText: '', rowClass: '', rowFound: false,
              metaError: e instanceof Error ? e.message : String(e),
            }
          }
        })
        return { linkHits: els.length, rows }
      }, LIST_SELECTORS)

      const items: NaverListItem[] = []
      for (const r of probe.rows) {
        const id = parseArticleId(r.href)
        if (id === null || r.title === '') continue
        if (items.some((i) => i.sourceArticleId === id)) continue
        const comments = normalizeCount(r.comments)
        const label = detectRowLabel(r.labelText, r.rowClass)
        items.push({
          sourceArticleId: id,
          sourceUrl: ARTICLE_URL(cafeId, id),
          originalTitle: r.title,
          // 🔴 댓글 수만 0 으로 떨어뜨린다 — assessCandidate 계약이 number 다.
          //    다만 "진짜 0" 과 구분되도록 read 플래그를 함께 남긴다.
          sourceCommentCount: comments ?? 0,
          // 🔴 행을 찾았으면 읽은 것이다. 네이버는 댓글이 0 이면 `a.cmt` 를 아예 렌더하지 않는다 —
          //    "링크가 없다" 를 "못 읽었다" 로 보면 진짜 0 인 글이 전부 미지값이 된다.
          sourceCommentCountRead: r.rowFound,
          // 나머지 메타는 못 읽으면 null 로 남긴다(추측하지 않는다)
          sourcePostedLabel: r.date || null,
          sourceViewCount: normalizeCount(r.views),
          // 🔴 개별 게시판 페이지에는 a.board_name 셀이 없다. 그때는 타깃의 label 을 쓴다 —
          //    앞 코드는 기본값 '전체글보기' 로 떨어져 쫑알쫑알 225건이 전부 잘못 기록됐다.
          sourceBoardName: r.board || BOARD?.label || null,
          sourcePage: pageNo,
          sourceRankOnPage: items.length + 1,
          // ── PR-S2-b-7 ──
          sourceRowLabel: label.label ?? label.unknown,
          sourcePinned: label.pinned,
          sourceMenuId: BOARD?.menuId ?? null,
          sourceBoardKey: BOARD?.key ?? null,
        })
        // 🔴 모르는 라벨은 조용히 넘기지 않는다. 네이버가 문구를 바꾸면 여기서 드러난다
        if (label.unknown !== null) unknownLabels.add(label.unknown)
      }
      const metaErr = probe.rows.find((r) => r.metaError !== null)?.metaError ?? null
      probes.push({ frame: label, linkHits: probe.linkHits, rows: probe.rows.length, items: items.length, error: metaErr })
      if (unknownLabels.size) {
        console.log(`     ⚠️ 모르는 행 라벨 ${unknownLabels.size}종 — 네이버가 문구를 바꿨을 수 있다: ${[...unknownLabels].slice(0, 5).join(' · ')}`)
      }
      if (items.length) return { items, probes }
    } catch (e) {
      // 🔴 삼키지 않는다. 이 프레임에 목록이 없는 것과 콜백이 터진 것은 다른 사건이다.
      //    HTML 전문은 담지 않는다 — message 만 남긴다.
      probes.push({
        frame: label,
        linkHits: 0,
        rows: 0,
        items: 0,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }
  return { items: [], probes }
}

/**
 * 🔴 이미지·댓글을 읽지 않는다. 본문 텍스트만 가져온다.
 *
 * 🔴 **여기도 실패를 삼키지 않는다** (PR-S2-b-5). readList 와 같은 결함이 한 단계 뒤에 있었다 —
 *    콜백이 터져도 "본문을 읽지 못했다" 한 줄만 나와서, 셀렉터가 안 맞는 것인지
 *    코드가 터진 것인지 구분할 수 없었다.
 */
async function readArticleBody(page: NaverPage): Promise<{ body: string | null; errors: string[] }> {
  const frames = page.frames().filter((f) => f.url().includes('cafe.naver.com'))
  const errors: string[] = []
  for (const f of [page, ...frames]) {
    try {
      const texts = await f.$$eval<string[]>('.se-main-container, #postViewArea, .article_viewer', (els) =>
        els.map((el) => (el as HTMLElement).innerText ?? ''),
      )
      const body = texts.join('\n').replace(/\n{3,}/g, '\n\n').trim()
      if (body) return { body, errors }
    } catch (e) {
      // 🔴 message 만 남긴다 — 본문 HTML 을 로그로 흘리지 않는다
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }
  return { body: null, errors }
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})

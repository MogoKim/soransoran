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
 * ⚠️ **Playwright 는 이 저장소의 의존성이 아니다.**
 *    dry-run · fixture · typecheck 는 Playwright 없이 전부 돈다.
 *    `--live` 를 줬을 때만 동적 import 하고, 없으면 설치 안내를 내고 멈춘다.
 *    의존성 추가(브라우저 바이너리 ~300MB)는 창업자 승인 사항이라 이 PR 이 하지 않는다.
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
import { appendFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  CAFES, findCafe, sourceSiteOf, slotQuota, buildCollected, assertNaverCandidate,
  judgeSession, judgeLock, randomDelay, parseArticleId,
  LIST_URL, ARTICLE_URL, DELAY_LIST_MS, DELAY_ARTICLE_MS,
  LOCK_PATH, LOCK_MAX_AGE_MS, RUN_TIMEOUT_MS,
  SESSION_PATH_ENV, KILL_SWITCH_ENV, FIRST_LIVE_CAFE_ID, FIRST_LIVE_PAGES, FIRST_LIVE_ARTICLES,
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
const CAFE_ID = (arg('cafe') ?? FIRST_LIVE_CAFE_ID).trim()
const PAGES = Number(arg('pages') ?? String(FIRST_LIVE_PAGES))
const MAX = Number(arg('max') ?? String(FIRST_LIVE_ARTICLES))
const OUT = arg('out') ?? `./.microseed-data/navercafe-${CAFE_ID}.jsonl`

const fail = (msg: string): never => {
  console.error(`\n🛑 ${msg}\n`)
  process.exit(1)
}

const cafe = findCafe(CAFE_ID)
if (cafe === null) {
  fail(`모르는 카페: ${CAFE_ID}\n   알려진 카페: ${CAFES.map((c) => c.cafeId).join(' · ')}`)
}
const QUOTA = slotQuota(CAFE_ID)
if (!Number.isInteger(PAGES) || PAGES < 1 || PAGES > 3) fail(`--pages 는 1~3 이다 (받은 값: ${arg('pages') ?? '없음'})`)
if (!Number.isInteger(MAX) || MAX < 1 || MAX > QUOTA) {
  fail(`--max 는 1~${QUOTA} 이다 — ${CAFE_ID} 의 슬롯 quota (받은 값: ${arg('max') ?? '없음'})`)
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function writeJsonl(path: string, rows: object[]) {
  mkdirSync(dirname(path), { recursive: true })
  for (const r of rows) appendFileSync(path, `${JSON.stringify(r)}\n`, 'utf-8')
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
  console.log(`  계획   목록 ${PAGES}p · 상세 최대 ${MAX}건 (quota ${QUOTA})`)
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
    console.log(`  대상 목록 URL:\n${Array.from({ length: PAGES }, (_, i) => `     ${LIST_URL(cafe!.cafeId, i + 1)}`).join('\n')}`)
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

  console.log(`  🔴 실제 수집 · 출력 ${OUT}\n`)
  const started = Date.now()
  const collected: CollectedCandidate[] = []
  let browser: NaverBrowser | null = null

  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ storageState: sessionPath!, locale: 'ko-KR' })
    const page = await context.newPage()

    // ── ① 목록 ──
    const items: NaverListItem[] = []
    for (let p = 1; p <= PAGES; p += 1) {
      if (Date.now() - started > RUN_TIMEOUT_MS) throw new Error('실행 timeout')
      await page.goto(LIST_URL(cafe!.cafeId, p), { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await sleep(randomDelay(DELAY_LIST_MS))
      items.push(...(await readList(page, cafe!.cafeId)))
      console.log(`  목록 ${p}p → 누적 ${items.length}건`)
      if (p < PAGES) await sleep(randomDelay(DELAY_LIST_MS))
    }
    if (items.length === 0) throw new Error('목록이 비었다 — 세션 만료이거나 셀렉터가 바뀌었다')

    // ── ② 자동 선별 (목록 단계 제외) ──
    const listRows = items.map((i) => buildCollected(cafe!.cafeId, i, '', now.toISOString()))
    writeJsonl(OUT.replace(/\.jsonl$/, '.list.jsonl'), listRows)
    const plan = planAutoFetch(
      listRows.map((r) => ({
        sourceArticleId: r.sourceArticleId,
        score: selectionScore({ stage: r.qualitySignals.stage, flags: r.qualityFlags, signals: r.qualitySignals } as QualityAssessment),
        flags: r.qualityFlags,
        alreadyInVault: false,
      })),
      { max: MAX },
    )
    console.log(`\n  자동 선별 ${plan.picked.length}건 · 제외 ${plan.skipped.length}건`)
    console.log('  🔴 제외는 파일에서 지운 것이 아니다 — 목록 JSONL 에 전부 남아 있다\n')

    // ── ③ 상세 ──
    const known = new Map(items.map((i) => [i.sourceArticleId, i]))
    for (const [idx, id] of plan.picked.entries()) {
      if (Date.now() - started > RUN_TIMEOUT_MS) throw new Error('실행 timeout')
      if (idx > 0) await sleep(randomDelay(DELAY_ARTICLE_MS))
      await page.goto(ARTICLE_URL(cafe!.cafeId, id), { waitUntil: 'domcontentloaded', timeout: 20_000 })
      await sleep(randomDelay(DELAY_ARTICLE_MS))
      const body = await readArticleBody(page)
      if (!body) {
        console.log(`  ⚠️ ${id} — 본문을 읽지 못했다. 건너뛴다`)
        continue
      }
      const row = buildCollected(cafe!.cafeId, known.get(id)!, body, now.toISOString())
      assertNaverCandidate(row)
      collected.push(row)
      console.log(`  ✅ ${id} · ${[...body].length}자 · 댓글 ${row.sourceCommentCount}`)
    }
  } finally {
    if (browser) await browser.close().catch(() => {})
  }

  if (collected.length) {
    // 🔴 보류 대상도 파일에 남긴다 (Q-1). 보류는 **적재 단계**가 한다
    writeJsonl(OUT, collected)
    console.log(`\n  → ${OUT} (${collected.length}건)`)
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

type NaverPage = {
  goto: (url: string, o: object) => Promise<unknown>
  $$eval: <T>(sel: string, fn: (els: Element[]) => T) => Promise<T>
  frames: () => { $$eval: NaverPage['$$eval']; url: () => string }[]
}
type NaverBrowser = {
  close: () => Promise<void>
  newContext: (o: object) => Promise<{ newPage: () => Promise<NaverPage> }>
}
type Chromium = { launch: (o: object) => Promise<NaverBrowser> }

/**
 * 🔴 Playwright 는 이 저장소의 의존성이 **아니다.** live 경로에서만 동적으로 부른다.
 *
 *    문자열 변수로 부르는 이유: 없는 모듈을 정적으로 import 하면 typecheck 가 깨진다.
 *    dry-run · fixture · typecheck 는 설치 없이 돌아야 한다 —
 *    브라우저 바이너리(~300MB) 설치는 창업자 승인 사항이고 이 PR 이 하지 않는다.
 */
async function loadChromium(): Promise<Chromium> {
  const spec = 'playwright'
  try {
    const mod = (await import(spec)) as { chromium: Chromium }
    return mod.chromium
  } catch {
    return fail(
      'Playwright 가 설치돼 있지 않다.\n' +
        '   이 저장소의 의존성이 아니라서 live 수집에는 별도 설치가 필요하다:\n' +
        '     npm i -D playwright && npx playwright install chromium\n' +
        '   🔴 브라우저 바이너리가 큰 설치라 창업자 승인 사항이다. dry-run 은 설치 없이 돈다.',
    )
  }
}

/**
 * 🔴 목록 셀렉터는 **첫 live 에서 실측 후 확정**한다.
 *    네이버 카페는 iframe 구조이고 신형/구형 DOM 이 섞여 있어(우나어 실측),
 *    실제 페이지를 보지 않고 적은 셀렉터는 조용히 0건을 반환한다.
 *    지금은 구조만 두고 첫 live 에서 사람이 확인한다 — 0건이면 위에서 throw 한다.
 */
async function readList(page: NaverPage, cafeId: string): Promise<NaverListItem[]> {
  const frames = page.frames().filter((f) => f.url().includes('cafe.naver.com'))
  for (const f of [page, ...frames]) {
    try {
      const rows = await f.$$eval<{ href: string; title: string; comments: number }[]>(
        'a.article, a[href*="articleid"], a[href*="/articles/"]',
        (els) =>
          els.map((el) => {
            const a = el as HTMLAnchorElement
            const near = a.closest('tr, li, div')
            const cm = near?.querySelector('.comment_count, .num, em')?.textContent ?? '0'
            return { href: a.href, title: (a.textContent ?? '').trim(), comments: Number((cm.match(/\d+/) ?? ['0'])[0]) }
          }),
      )
      const items: NaverListItem[] = []
      for (const r of rows) {
        const id = parseArticleId(r.href)
        if (id === null || r.title === '') continue
        if (items.some((i) => i.sourceArticleId === id)) continue
        items.push({
          sourceArticleId: id,
          sourceUrl: ARTICLE_URL(cafeId, id),
          originalTitle: r.title,
          sourceCommentCount: r.comments,
        })
      }
      if (items.length) return items
    } catch {
      // 이 프레임에는 목록이 없다 — 다음 프레임을 본다
    }
  }
  return []
}

/** 🔴 이미지·댓글을 읽지 않는다. 본문 텍스트만 가져온다 */
async function readArticleBody(page: NaverPage): Promise<string | null> {
  const frames = page.frames().filter((f) => f.url().includes('cafe.naver.com'))
  for (const f of [page, ...frames]) {
    try {
      const texts = await f.$$eval<string[]>('.se-main-container, #postViewArea, .article_viewer', (els) =>
        els.map((el) => (el as HTMLElement).innerText ?? ''),
      )
      const body = texts.join('\n').replace(/\n{3,}/g, '\n\n').trim()
      if (body) return body
    } catch {
      // 다음 프레임
    }
  }
  return null
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})

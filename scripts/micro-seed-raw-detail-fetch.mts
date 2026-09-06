#!/usr/bin/env tsx
/**
 * Raw Originality 상세 fetch — 🔴 **읽고 분류만 한다. 발행하지 않는다** (§4-AF T1)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AF
 *
 * 🔴 **detail-fetch 와 왜 따로인가.** body 때문이다.
 *    detail-fetch 는 SRN 축일 때만 body 를 **통째로** 저장한다 — 그 축이 정의상
 *    100자 미만이라 "승인 화면이 그대로 보여줄 분량" 이 전부이기 때문이다(§4-Z ⑥).
 *    이쪽은 400자 이상을 다룬다. 같은 파일에 두 정책을 섞으면
 *    **어느 줄이 어떤 규칙으로 저장됐는지 파일만 보고는 알 수 없다.**
 *
 * 🔴 **전문을 저장하지 않는다.** 마스킹 후 앞 300자(`bodyHead`)만 남긴다.
 *    원문이 남으면 사람이 그 문장을 참고하게 된다 — 이 레인은 *다시 쓰는* 레인이다(§4-AF ⑤).
 *
 * 🔴 **하지 않는 것**
 *    목록 scout · DB write · Prisma · Google Sheet · LLM · 자동 발행 · noindex 배포 ·
 *    Raw Vault 적재 · 82cook adapter. 산출은 `.microseed-data/` 안 두 파일뿐이다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-raw-detail-fetch.mts              # 계획만 · 네트워크 0 · 파일 0
 *   npx tsx scripts/micro-seed-raw-detail-fetch.mts --cap=20
 *   SORAN_NAVERCAFE_RAW_DETAIL_ENABLED=true npx tsx scripts/micro-seed-raw-detail-fetch.mts --live
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadScoutRows, SCOUT_DATA_DIR } from './lib/micro-seed-scout-load.mjs'
import { scoreRows } from './lib/micro-seed-scout-score.mjs'
import {
  classifyAccess, classifyDetail, AXIS_LABEL,
  type AccessSignals, type AccessStatus, type DetailAxis,
} from './lib/micro-seed-detail-classify.mjs'
import { loadEnvLocal, kstString } from './lib/micro-seed-time.mjs'
import {
  SESSION_PATH_ENV, BROWSER_CHANNEL_ENV, PLAYWRIGHT_SPECS, browserLaunchOptions,
} from './lib/micro-seed-navercafe.mjs'
// 🔴 기존 detail-fetch 의 **순수 함수·상수만** 가져온다. 그 파일을 수정하지 않는다 —
//    검증된 live 경로라 건드릴수록 위험하다.
import {
  PACE_MIN_MS, PACE_MAX_MS, runIdOf, seenArticleIds as seenDetailIds,
} from './micro-seed-detail-fetch.mjs'
import {
  RAW_LANE, RAW_AXIS, NOT_PUBLISH_NOTE, BODY_HEAD_CHARS,
  digestBody, selectRawTargets, prescreen, blockedBeforeRead,
  type RawCandidate,
} from './lib/micro-seed-raw-originality.mjs'

/** 🔴 Raw 전용 스위치. detail-fetch 것과 **따로 둔다** — 레인마다 위험이 다르다 */
export const RAW_DETAIL_KILL_SWITCH_ENV = 'SORAN_NAVERCAFE_RAW_DETAIL_ENABLED'

/** 🔴 cap 은 생산 목표가 아니라 요청 리스크 상한이다 (§4-W ③) */
export const DEFAULT_CAP = 10
export const ALLOWED_CAPS: readonly number[] = [10, 20] as const

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const LIVE = argv.includes('--live')
const CAP = Number(arg('cap') ?? DEFAULT_CAP)

const fail = (m: string): never => {
  console.error(`\n🛑 ${m}\n`)
  process.exit(1)
}
const pad = (s: string | number, n: number): string => String(s).padEnd(n)
/** 🔴 제목·본문 전문을 콘솔에 찍지 않는다 — 앞부분과 길이만 */
const head = (s: string, n = 18): string => {
  const c = [...s]
  return c.length <= n ? s : `${c.slice(0, n).join('')}…(${c.length}자)`
}

/** 🔴 gitignore 된 `.microseed-data/` 밖으로 쓰지 않는다 */
export function assertOutputPath(p: string): void {
  const rel = relative(process.cwd(), resolve(p))
  if (!rel.startsWith(`${SCOUT_DATA_DIR}/`)) {
    fail(`🔴 ${rel} 은 ${SCOUT_DATA_DIR}/ 밖이다 — 거부한다.`)
  }
}

/**
 * 이미 이 명령이 읽은 글 — `*.raw-detail.jsonl` 에서 모은다.
 *
 * 🔴 **`.detail.jsonl` 로는 안 잡힌다.** 파일명이 `foo.raw-detail.jsonl` 이라
 *    `endsWith('.detail.jsonl')` 가 거짓이다(`-detail` 과 `.detail` 은 다르다).
 *    그래서 detail 쪽 함수를 그대로 쓰면 **같은 글을 두 번 연다** — 그것이 이 함수가 있는 이유다.
 */
export function seenRawIds(dir: string = SCOUT_DATA_DIR): Set<string> {
  const seen = new Set<string>()
  let files: string[] = []
  try { files = readdirSync(dir).filter((f) => f.endsWith('.raw-detail.jsonl')) } catch { return seen }
  for (const f of files) {
    for (const line of readFileSync(join(dir, f), 'utf-8').split('\n')) {
      if (line.trim() === '') continue
      try {
        const o = JSON.parse(line) as { sourceArticleId?: string }
        if (o.sourceArticleId) seen.add(o.sourceArticleId)
      } catch { /* 깨진 줄은 건너뛴다 */ }
    }
  }
  return seen
}

/** 세 곳을 합쳐 본다 — raw-detail · detail · prior-read (§4-AF ③) */
export function seenAll(dir: string = SCOUT_DATA_DIR): Set<string> {
  return new Set([...seenDetailIds(dir), ...seenRawIds(dir)])
}

/**
 * 저장 컬럼 — 🔴 **`body` 전문 컬럼이 없다.** `bodyHead` 뿐이다(§4-AF ⑤).
 * 🔴 컬럼은 언제나 맨 뒤에만 더한다 — TSV 를 위치로 읽는 쪽이 있다.
 */
export const RAW_DETAIL_COLUMNS: readonly string[] = [
  'sourceArticleId', 'sourceSite', 'url', 'title', 'score', 'lane',
  'accessStatus', 'bodyLength', 'bodyHead', 'axis',
  'safetyVerdict', 'safetyReasons', 'imageCount', 'commentCount',
  'runId', 'fetchedAt',
] as const

export type RawDetailRow = {
  sourceArticleId: string; sourceSite: string; url: string; title: string
  score: number; lane: string
  accessStatus: AccessStatus
  /** 🔴 자르기 **전** 원문 길이. 400자 기준 판정에 쓴다 */
  bodyLength: number
  /** 🔴 마스킹 후 앞 300자. 전문이 아니다 */
  bodyHead: string
  axis: DetailAxis
  safetyVerdict: string; safetyReasons: string
  imageCount: number; commentCount: number
  runId: string; fetchedAt: string
}

const cell = (v: unknown): string => String(v ?? '').replace(/[\t\r\n]+/g, ' ')

export function toTsv(rows: readonly RawDetailRow[]): string {
  return [
    RAW_DETAIL_COLUMNS.join('\t'),
    ...rows.map((r) => RAW_DETAIL_COLUMNS
      .map((c) => cell((r as unknown as Record<string, unknown>)[c])).join('\t')),
  ].join('\n') + '\n'
}

function urlOf(site: string, id: string): string {
  const cafe = site.includes(':') ? site.split(':', 2)[1] : site
  return `https://cafe.naver.com/${cafe}/${id}`
}

async function loadChromium(): Promise<{ launch: (o: object) => Promise<unknown> }> {
  for (const spec of PLAYWRIGHT_SPECS) {
    try {
      const mod = (await import(spec)) as { chromium?: { launch: (o: object) => Promise<unknown> } }
      if (mod.chromium) return mod.chromium
    } catch { /* 다음 후보 */ }
  }
  return fail(`Playwright 를 찾지 못했다 (${PLAYWRIGHT_SPECS.join(', ')})`)
}

async function main(): Promise<void> {
  loadEnvLocal()
  if (!ALLOWED_CAPS.includes(CAP)) fail(`cap 은 ${ALLOWED_CAPS.join(' 또는 ')} 만 허용한다 (받은 값 ${CAP})`)

  const runId = runIdOf(new Date())
  console.log('\nRaw Originality 상세 fetch — 🔴 읽고 분류만 한다')
  console.log('─────────────────────────────────────────────────────────')
  console.log(`  ${kstString(new Date())} · runId ${runId}`)
  console.log(`  🔴 ${NOT_PUBLISH_NOTE}`)
  console.log('  🔴 DB write 0 · Sheet 0 · LLM 0 · 자동 발행 0 · noindex 배포 0 · Raw Vault 적재 0')
  console.log('  🔴 목록 scout 0 — 이미 수집된 재고만 연다')
  console.log(`  🔴 본문 전문을 저장하지 않는다 — 마스킹 후 앞 ${BODY_HEAD_CHARS}자만 남긴다`)
  console.log(`  🔴 cap ${CAP}건 — 생산 목표가 아니라 요청 리스크 상한이다 (§4-W ③)`)

  const { loaded } = (() => {
    try { return loadScoutRows(SCOUT_DATA_DIR, null) } catch { return fail(`${SCOUT_DATA_DIR} 를 읽지 못했다`) }
  })()
  const scored = scoreRows(loaded.flatMap((l) => l.rows)).scored
  const byId = new Map(scored.map((s) => [s.row.sourceArticleId, s]))
  const rows: RawCandidate[] = scored.map((s) => ({
    sourceArticleId: s.row.sourceArticleId,
    sourceSite: s.row.sourceSite,
    lane: s.laneHint.lane,
    score: s.score.total,
    title: s.row.originalTitle ?? '',
  }))

  const seen = seenAll()
  const inLane = rows.filter((r) => r.lane === RAW_LANE)
  const fresh = inLane.filter((r) => !seen.has(r.sourceArticleId))
  // 🔴 읽기 전 안전 선별 — 제목만 봐도 버릴 것은 열지 않는다. hold 는 남긴다(읽어봐야 안다)
  const openable = fresh.filter((r) => !blockedBeforeRead(prescreen(r)))
  const targets = selectRawTargets(openable, CAP, seen)

  console.log(`\n① 대상 — lane=${RAW_LANE} 중 점수순 상위 ${CAP}건`)
  console.log(`   재고 ${inLane.length}건 · 이미 읽음 ${inLane.length - fresh.length}건 제외 · 읽기 전 차단 ${fresh.length - openable.length}건`)
  console.log(`   → 대상 ${targets.length}건`)
  for (const [i, t] of targets.entries()) {
    console.log(`   ${pad(i + 1, 3)} ${pad(t.score.toFixed(1), 6)} ${pad(t.sourceArticleId, 10)} ${head(t.title)}`)
  }

  // ── 🔴 두 스위치가 모두 있어야 연다 ──
  const switchOn = (process.env[RAW_DETAIL_KILL_SWITCH_ENV] ?? '').toLowerCase() === 'true'
  if (!LIVE || !switchOn) {
    console.log('\n② 계획만 — 🔴 네트워크 요청 0건')
    console.log(`   --live                            ${LIVE ? '🟢 있음' : '🔴 없음'}`)
    console.log(`   ${RAW_DETAIL_KILL_SWITCH_ENV}  ${switchOn ? '🟢 true' : '🔴 없음'}`)
    console.log('   🔴 둘 다 있어야 연다. 요청 수가 곧 계정 위험이라 스위치 하나로는 열지 않는다 (§5-C).')
    console.log('   🔴 산출물을 쓰지 않았다.\n')
    return
  }
  if (targets.length === 0) {
    console.log('\n② 열 대상이 없다 — 🔴 네트워크 요청 0건 · 산출물 없음\n')
    return
  }

  const sessionPath = process.env[SESSION_PATH_ENV]
  if (!sessionPath) fail(`${SESSION_PATH_ENV} 가 없다 — 소란소란 전용 세션 경로가 필요하다`)

  const chromium = await loadChromium()
  const launch = browserLaunchOptions({ channel: process.env[BROWSER_CHANNEL_ENV], headless: true })
  const browser = (await chromium.launch(launch)) as {
    close: () => Promise<void>
    newContext: (o: object) => Promise<{ newPage: () => Promise<Record<string, unknown>> }>
  }
  const out: RawDetailRow[] = []
  let requests = 0

  try {
    const ctx = await browser.newContext({
      storageState: JSON.parse(readFileSync(sessionPath as string, 'utf-8')),
      locale: 'ko-KR',
    })
    const page = (await ctx.newPage()) as any
    let dialog = ''
    page.on('dialog', async (d: any) => { dialog = String(d.message()).slice(0, 80); await d.dismiss().catch(() => {}) })

    console.log('\n② 상세 열람 — 🔴 사람형 pacing')
    for (const [i, t] of targets.entries()) {
      const s = byId.get(t.sourceArticleId)
      const url = urlOf(t.sourceSite, t.sourceArticleId)
      dialog = ''
      const sig: AccessSignals = {}
      let body = ''
      let comments: string[] = []
      let imgs = 0
      try {
        requests++
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        sig.httpStatus = resp?.status()
        let frame: any = null
        for (let k = 0; k < 20; k++) {
          frame = page.frames().find((f: any) => /\/ca-fe\/cafes\/\d+\/articles\/\d+/.test(f.url())) ?? null
          if (frame) break
          await new Promise((r) => setTimeout(r, 700))
        }
        sig.articleFrame = !!frame
        if (frame) {
          await frame.waitForLoadState('domcontentloaded').catch(() => {})
          await frame.waitForFunction(() => (document.body?.innerText || '').length > 300, { timeout: 20_000 }).catch(() => {})
          // 🔴 콜백 안에 이름 붙은 함수를 만들지 않는다 — __name 사고 (§4-S)
          const r = await frame.evaluate(() => {
            const be = document.querySelector('.se-main-container') || document.querySelector('.article_viewer') || document.querySelector('#tbody')
            const ce = Array.from(document.querySelectorAll('.comment_text_view'))
            const notice = /권한이 없습니다|접근 권한|등급이 되어야|멤버만/.test(document.body?.innerText || '')
            return {
              body: be ? (be.textContent || '').replace(/\s+/g, ' ').trim() : '',
              imgs: be ? be.querySelectorAll('img').length : 0,
              cs: ce.map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim()).filter((x) => x.length > 0),
              notice,
            }
          }).catch(() => null)
          if (r) { body = r.body; imgs = r.imgs; comments = r.cs; sig.permissionNotice = r.notice }
          sig.bodyFound = body.length > 0
        }
        // 🔴 title 은 프레임·본문을 확인한 뒤에 읽는다 — SPA 라 goto 직후에는 아직 카페 홈 제목이다
        const docTitle: string = await page.title()
        sig.titleFallback = !docTitle.includes(t.title.slice(0, 8))
      } catch (e) { sig.errorMessage = String(e).slice(0, 80) }
      sig.dialogMessage = dialog || null

      const access = classifyAccess(sig)
      const v = classifyDetail({
        title: t.title, body, comments, imageCount: imgs,
        boardName: s?.row.sourceBoardName, qualityFlags: s?.row.qualityFlags ?? [],
        access, lengthBasis: 'body',
      })
      // 🔴 **여기가 이 명령의 핵심이다.** body 는 digest 를 거쳐서만 밖으로 나간다 —
      //    `body` 변수는 이 블록 이후 어디에도 쓰이지 않는다(fixture 가 감시한다).
      const digest = digestBody(body)
      out.push({
        sourceArticleId: t.sourceArticleId, sourceSite: t.sourceSite, url, title: t.title,
        score: Number(t.score.toFixed(1)), lane: t.lane,
        accessStatus: access,
        bodyLength: v.measuredLength,
        bodyHead: digest.head,
        axis: v.axis,
        safetyVerdict: v.safety.verdict,
        safetyReasons: v.safety.reasons.map((x) => x.code).join('/'),
        imageCount: imgs, commentCount: comments.length,
        runId, fetchedAt: new Date().toISOString(),
      })
      console.log(`   ${pad(i + 1, 3)} ${pad(AXIS_LABEL[v.axis], 18)} ${pad(access, 17)} ${t.sourceArticleId}`
        + ` · 본문 ${v.measuredLength}자 → 저장 ${[...digest.head].length}자 · 댓글 ${comments.length}`)
      await new Promise((r) => setTimeout(r, PACE_MIN_MS + Math.random() * (PACE_MAX_MS - PACE_MIN_MS)))
    }
  } finally {
    await browser.close().catch(() => {})
  }

  const jsonlPath = `${SCOUT_DATA_DIR}/raw-detail-${runId}.raw-detail.jsonl`
  const tsvPath = `${SCOUT_DATA_DIR}/raw-detail-${runId}.raw-detail.tsv`
  assertOutputPath(jsonlPath)
  assertOutputPath(tsvPath)
  writeFileSync(jsonlPath, out.map((r) => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''), 'utf-8')
  writeFileSync(tsvPath, toTsv(out), 'utf-8')

  console.log('\n③ 축 분포 — 🔴 lane 이 originalRaw 라고 축이 rawOriginality 가 되지는 않는다')
  const axes: DetailAxis[] = ['rawOriginality', 'shortRawNoindex', 'seedOriginality', 'hold', 'drop', 'access']
  for (const a of axes) console.log(`   ${pad(AXIS_LABEL[a], 20)} ${out.filter((r) => r.axis === a).length}건`)
  console.log(`\n   ${RAW_AXIS} ${out.filter((r) => r.axis === RAW_AXIS).length}건이 검수 화면 대상이다 (§4-AF ⑥ · T3)`)
  console.log(`   요청 ${requests}건 · pacing ${PACE_MIN_MS}~${PACE_MAX_MS}ms`)
  console.log(`   ✅ ${jsonlPath}`)
  console.log(`   ✅ ${tsvPath}`)
  console.log('\n④ 이 실행이 하지 않은 것')
  console.log(`   🔴 본문 전문 저장 · DB write · Sheet · LLM · 자동 발행 · noindex 배포 · Raw Vault 적재`)
  console.log(`   🔴 ${NOT_PUBLISH_NOTE}\n`)
}

/** 🔴 CLI 로 직접 실행할 때만 돈다 — import 만으로 아무 일도 하지 않는다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) void main()

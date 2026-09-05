#!/usr/bin/env tsx
/**
 * 자동 상세 fetch — 🔴 **읽고 분류만 한다. 발행하지 않는다**
 *
 * 정본: §4-W(자동 fetch 기준) · §4-U(6축) · §4-Y(100자) · §5-C(요청 상한)
 *
 * 🔴 **이 스크립트가 하지 않는 것**
 *    DB write · Google Sheet · LLM 호출 · 자동 발행 · noindex 배포 ·
 *    Raw Vault 적재 · 목록 scout · 82cook.
 *    산출물은 `.microseed-data/` 아래 JSONL · TSV 뿐이다.
 *
 * 🔴 **기본은 계획만이다.** `--live` 와 kill switch 가 **둘 다** 있어야 연다.
 *    §5-C 대로 요청 수가 곧 계정 위험이다 — 스위치 하나로는 열지 않는다.
 *
 * 🔴 **HTTP 200 만으로 성공을 판정하지 않는다** (§4-W ⑥).
 *    title 폴백 · dialog 문구 · ca-fe 프레임 도달을 함께 본다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-detail-fetch.mts                 계획만 (네트워크 0)
 *   npx tsx scripts/micro-seed-detail-fetch.mts --cap=20        계획 · cap 변경
 *   npx tsx scripts/micro-seed-detail-fetch.mts --live          🔴 실제로 연다
 *   npx tsx scripts/micro-seed-detail-fetch.mts --length-basis=titleBody
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadScoutRows, SCOUT_DATA_DIR } from './lib/micro-seed-scout-load.mjs'
import { scoreRows, type ScoredRow } from './lib/micro-seed-scout-score.mjs'
import { isSeedInboxLane, verdictOf } from './micro-seed-seed-inbox-dry-run.mjs'
import {
  classifyAccess, classifyDetail, AXIS_LABEL, SHORT_RAW_MAX, RAW_MIN_BODY,
  type AccessSignals, type AccessStatus, type DetailAxis, type LengthBasis,
} from './lib/micro-seed-detail-classify.mjs'
import { loadEnvLocal, kstString } from './lib/micro-seed-time.mjs'
import {
  SESSION_PATH_ENV, BROWSER_CHANNEL_ENV, PLAYWRIGHT_SPECS, browserLaunchOptions,
} from './lib/micro-seed-navercafe.mjs'

/** 🔴 상세 열람 전용 스위치. 수집기(목록) 스위치와 **따로 둔다** — 둘은 위험이 다르다 */
export const DETAIL_KILL_SWITCH_ENV = 'SORAN_NAVERCAFE_DETAIL_ENABLED'

/** 🔴 cap 은 생산 목표가 아니라 요청 리스크 상한이다 (§4-W ③) */
export const DEFAULT_CAP = 10
export const ALLOWED_CAPS: readonly number[] = [10, 20] as const

/** 🔴 사람형 pacing (§5-D 실측 2.5~4.5초) */
export const PACE_MIN_MS = 2500
export const PACE_MAX_MS = 4500

const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const LIVE = argv.includes('--live')
const CAP = Number(arg('cap') ?? DEFAULT_CAP)
const BASIS = (arg('length-basis') ?? 'body') as LengthBasis

const fail = (m: string): never => {
  console.error(`\n🛑 ${m}\n`)
  process.exit(1)
}

export function runIdOf(now: Date): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`
}

/** 🔴 산출물은 `.microseed-data/` 밖으로 나가지 않는다 (gitignore 안) */
export function assertOutputPath(p: string): void {
  const rel = relative(process.cwd(), resolve(p))
  if (!rel.startsWith('.microseed-data/')) {
    fail(`🔴 ${rel} 은 .microseed-data/ 밖이다 — 쓰기를 거부한다. 본문·댓글이 git 에 들어가면 지워지지 않는다.`)
  }
}

/**
 * 🔴 **같은 글을 두 번 열지 않는다** (§4-W ⑦④).
 *    이전 실행 산출물에 있는 articleId 는 건너뛴다 — 요청이 곧 위험이다.
 */
export function seenArticleIds(dir: string = SCOUT_DATA_DIR): Set<string> {
  const seen = new Set<string>()
  let files: string[] = []
  try { files = readdirSync(dir).filter((f) => f.endsWith('.detail.jsonl')) } catch { return seen }
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

/** 상세 대상 선정 — needsDetail 만, 점수순, cap 까지, 중복 제외 */
export function selectTargets(seed: readonly ScoredRow[], cap: number, seen: ReadonlySet<string>): ScoredRow[] {
  return seed
    .filter((s) => verdictOf(s).verdict === 'needsDetail')
    .filter((s) => !seen.has(s.row.sourceArticleId))
    .slice(0, cap)
}

export const TSV_COLUMNS: readonly string[] = [
  'runId', 'axis', 'access', 'sourceSite', 'sourceArticleId', 'url', 'score', 'lane',
  'bodyLength', 'lengthBasis', 'imageCount', 'commentCount', 'safetyVerdict', 'safetyReasons',
  'assetAxes', 'reason', 'title',
] as const

const cell = (v: unknown): string => String(v ?? '').replace(/[\t\r\n]+/g, ' ')
const pad = (s: string | number, n: number): string => String(s).padEnd(n)

type Row = {
  runId: string; axis: DetailAxis; access: AccessStatus
  sourceSite: string; sourceArticleId: string; url: string; score: number; lane: string
  bodyLength: number; lengthBasis: LengthBasis; imageCount: number; commentCount: number
  safetyVerdict: string; safetyReasons: string; assetAxes: string; reason: string; title: string
}

function urlOf(s: ScoredRow): string {
  const site = s.row.sourceSite
  const cafe = site.includes(':') ? site.split(':', 2)[1] : site
  return `https://cafe.naver.com/${cafe}/${s.row.sourceArticleId}`
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
  await loadEnvLocal()
  const now = new Date()
  const runId = runIdOf(now)

  console.log('\n자동 상세 fetch — 🔴 읽고 분류만 한다. 발행하지 않는다')
  console.log('─────────────────────────────────────────────────────────')
  console.log(`  ${kstString(now)} KST · runId ${runId}`)
  console.log('  🔴 DB write 0 · Sheet 0 · LLM 0 · 자동 발행 0 · noindex 배포 0 · Raw Vault 0')
  console.log('  🔴 목록 scout 0 — 이미 수집된 후보만 연다')
  console.log(`  🔴 cap ${CAP}건 — **생산 목표가 아니라 요청 리스크 상한**이다 (§4-W ③)`)
  console.log(`  🟡 길이 기준 ${BASIS} — 🔴 §4-Y ④ 는 아직 미확정이다. 기록만 한다\n`)

  if (!ALLOWED_CAPS.includes(CAP)) fail(`cap 은 ${ALLOWED_CAPS.join(' 또는 ')} 만 허용한다 (받은 값 ${CAP})`)

  const { loaded } = (() => {
    try { return loadScoutRows(SCOUT_DATA_DIR, null) } catch { return fail(`${SCOUT_DATA_DIR} 를 읽지 못했다`) }
  })()
  const rows = loaded.flatMap((l) => l.rows)
  const seed = scoreRows(rows).scored.filter((s) => isSeedInboxLane(s.laneHint.lane))
  const seen = seenArticleIds()
  const targets = selectTargets(seed, CAP, seen)

  console.log(`① 대상 — needsDetail 중 점수순 상위 ${CAP}건`)
  console.log(`   후보 ${seed.length}건 · 이미 읽음 ${seen.size}건 제외 → 대상 ${targets.length}건`)
  targets.forEach((s, i) => console.log(`   ${pad(i + 1, 3)} ${pad(s.score.total.toFixed(1), 6)} ${s.row.sourceArticleId}  ${urlOf(s)}`))

  // ── 🔴 두 스위치가 모두 있어야 연다 ──
  const switchOn = (process.env[DETAIL_KILL_SWITCH_ENV] ?? '').toLowerCase() === 'true'
  if (!LIVE || !switchOn) {
    console.log('\n② 계획만 — 🔴 네트워크 요청 0건')
    console.log(`   --live            ${LIVE ? '🟢 있음' : '🔴 없음'}`)
    console.log(`   ${DETAIL_KILL_SWITCH_ENV}  ${switchOn ? '🟢 true' : '🔴 false/미설정'}`)
    console.log('   🔴 둘 다 있어야 연다. 요청 수가 곧 계정 위험이라 스위치 하나로는 열지 않는다 (§5-C).')
    console.log('   🔴 산출물을 쓰지 않았다.\n')
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
  const out: Row[] = []
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
    for (let i = 0; i < targets.length; i++) {
      const s = targets[i]
      const url = urlOf(s)
      dialog = ''
      const sig: AccessSignals = {}
      let body = ''
      let comments: string[] = []
      let imgs = 0
      try {
        requests++
        const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
        sig.httpStatus = resp?.status()
        const docTitle: string = await page.title()
        // 🔴 게시글 제목이 아니라 카페 홈 title 이면 삭제다 (§4-T ④)
        sig.titleFallback = !docTitle.includes(s.row.originalTitle.slice(0, 8))
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
      } catch (e) { sig.errorMessage = String(e).slice(0, 80) }
      sig.dialogMessage = dialog || null

      const access = classifyAccess(sig)
      const v = classifyDetail({
        title: s.row.originalTitle, body, comments, imageCount: imgs,
        boardName: s.row.sourceBoardName, qualityFlags: s.row.qualityFlags ?? [],
        access, lengthBasis: BASIS,
      })
      out.push({
        runId, axis: v.axis, access, sourceSite: s.row.sourceSite, sourceArticleId: s.row.sourceArticleId,
        url, score: Number(s.score.total.toFixed(1)), lane: s.laneHint.lane,
        bodyLength: v.measuredLength, lengthBasis: v.lengthBasis, imageCount: imgs,
        commentCount: comments.length, safetyVerdict: v.safety.verdict,
        safetyReasons: v.safety.reasons.map((x) => x.code).join('/'),
        assetAxes: v.assetAxes.join('/'), reason: v.reason, title: s.row.originalTitle,
      })
      console.log(`   ${pad(i + 1, 3)} ${pad(AXIS_LABEL[v.axis], 18)} ${pad(access, 17)} ${s.row.sourceArticleId} · 본문 ${v.measuredLength}자 · 댓글 ${comments.length}`)
      await new Promise((r) => setTimeout(r, PACE_MIN_MS + Math.random() * (PACE_MAX_MS - PACE_MIN_MS)))
    }
  } finally {
    await browser.close().catch(() => {})
  }

  // ── 산출물 — 🔴 .microseed-data/ 아래 JSONL · TSV 만 ──
  const jsonlPath = `${SCOUT_DATA_DIR}/detail-${runId}.detail.jsonl`
  const tsvPath = `${SCOUT_DATA_DIR}/detail-${runId}.detail.tsv`
  assertOutputPath(jsonlPath)
  assertOutputPath(tsvPath)
  writeFileSync(jsonlPath, out.map((r) => JSON.stringify(r)).join('\n') + (out.length ? '\n' : ''), 'utf-8')
  writeFileSync(tsvPath, [TSV_COLUMNS.join('\t'), ...out.map((r) => TSV_COLUMNS.map((c) => cell((r as unknown as Record<string, unknown>)[c])).join('\t'))].join('\n') + '\n', 'utf-8')

  console.log('\n③ 6축 분포')
  const axes: DetailAxis[] = ['shortRawNoindex', 'seedOriginality', 'rawOriginality', 'hold', 'drop', 'access']
  for (const a of axes) console.log(`   ${pad(AXIS_LABEL[a], 20)} ${out.filter((r) => r.axis === a).length}건`)
  console.log(`\n   요청 ${requests}건 · pacing ${PACE_MIN_MS}~${PACE_MAX_MS}ms`)
  console.log(`   ✅ ${jsonlPath}`)
  console.log(`   ✅ ${tsvPath}`)
  console.log('\n④ 이 실행이 하지 않은 것')
  console.log('   🔴 DB write · Sheet · LLM · 자동 발행 · noindex 배포 · Raw Vault 적재')
  console.log(`   🔴 Short Raw Noindex 는 **후보**다 — 발행 전 사람이 승인한다 (§4-Y ③)`)
  console.log(`   🔴 100자 기준(${BASIS})은 아직 확정이 아니다 (§4-Y ④)\n`)
}

/** 🔴 CLI 로 직접 실행할 때만 돈다 — import 만으로 브라우저를 열지 않는다 */
const isDirectRun = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) void main()

export { SHORT_RAW_MAX, RAW_MIN_BODY }

#!/usr/bin/env tsx
/**
 * 82cook 얇은 상세 fetch — 🔴 **본문 전문을 남기지 않는다** (§4-AP)
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-AP
 *
 * 🔴 **왜 기존 `collect-82cook --fetch --live` 를 쓰지 않나.**
 *    그 경로는 `rawBody` 전문을 디스크에 저장한다. Micro Seed 레인(원문 그대로 발행)에는
 *    전문이 필요하지만, 우리가 채우려는 것은 **다시 쓰는 레인**이다.
 *    전문이 남으면 사람이 그 문장을 참고하게 되고(§4-AF ⑤), 남의 글이 우리 디스크에 쌓인다.
 *    **그 스크립트를 고치지 않는다** — 검증된 live 경로라 건드릴수록 위험하다.
 *    순수 함수와 상수만 가져다 쓴다.
 *
 * 🔴 **본문은 메모리에서만 산다.** fetch → 마스킹 → 판정 → 앞 300자만 파일에 남긴다.
 *    `rawBody` · `body` · `sourceBody` 컬럼이 이 파일에는 없다.
 *
 * 🔴 **하지 않는 것**
 *    DB write · Prisma · Google Sheet · LLM · 자동 발행 · Raw Vault 적재 ·
 *    네이버 접속 · 목록 수집. 산출은 `.microseed-data/` 안 두 파일뿐이다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-82cook-thin-detail.mts             # 계획만 · 네트워크 0 · 파일 0
 *   npx tsx scripts/micro-seed-82cook-thin-detail.mts --cap=16
 *   npx tsx scripts/micro-seed-82cook-thin-detail.mts --live      # 🔴 승인 후에만
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
// 🔴 기존 82cook 경로의 **순수 함수·상수만** 가져온다. 그 파일을 수정하지 않는다.
import {
  ARTICLE_URL, ROBOTS_URL, SOURCE_SITE, USER_AGENT,
  parseRobotsTxt, isPathAllowed, toRobotsPath,
  extractArticleBodyHtml, htmlToText, type RobotsRules,
} from './lib/micro-seed-82cook.mjs'
import { maskSensitive, BODY_HEAD_CHARS } from './lib/micro-seed-raw-originality.mjs'
import { classifyDetail } from './lib/micro-seed-detail-classify.mjs'
// 🔴 정치·안전 판정의 정본은 기존 lib 이다. 규칙을 여기서 새로 쓰지 않는다
import { judgePoliticsTitle } from './lib/micro-seed-navercafe.mjs'
import { safetyFilter } from './lib/micro-seed-safety-filter.mjs'
import { runIdOf } from './micro-seed-detail-fetch.mjs'
import { loadEnvLocal, kstString } from './lib/micro-seed-time.mjs'
import {
  planThinFetch, toThinRow, violatesStorage, judgeLive, paceMs,
  THIN_COLUMNS, SKIP_LABEL, BATCH_CAP, PACE_MIN_MS, PACE_MAX_MS,
  COMMENT_TIER_HIGH, COMMENT_TIER_LOW,
  type ListRow, type ThinRow,
} from '../src/lib/micro-seed-82cook-thin'

const DATA_DIR = '.microseed-data'
/** 🔴 두 스위치 중 하나 — env 가 없으면 `--live` 만으로는 열리지 않는다 */
export const THIN_KILL_SWITCH_ENV = 'SORAN_82COOK_THIN_DETAIL_ENABLED'

const argv = process.argv.slice(2)
const arg = (n: string): string | null => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit === undefined ? null : hit.slice(n.length + 3)
}
const LIVE = argv.includes('--live')
const CAP = Number(arg('cap') ?? String(BATCH_CAP))
const fail: (m: string) => never = (m) => { console.error(`\n🔴 중단: ${m}\n`); process.exit(1) }

const S = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/** 🔴 산출물은 데이터 디렉터리 안에만 쓴다 */
export function isInsideDataDir(p: string): boolean {
  const rel = relative(resolve(process.cwd()), resolve(p))
  return rel !== '' && !rel.startsWith('..') && rel.startsWith(`${DATA_DIR}/`)
}

function jsonl(path: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  let raw: string
  try { raw = readFileSync(path, 'utf-8') } catch { return out }
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (t === '') continue
    try { out.push(JSON.parse(t) as Record<string, unknown>) } catch { /* 건너뛴다 */ }
  }
  return out
}
function filesEnding(suffix: string): string[] {
  if (!existsSync(DATA_DIR)) return []
  return readdirSync(DATA_DIR).filter((f) => f.endsWith(suffix)).sort().map((f) => join(DATA_DIR, f))
}

/** 목록 재고 — 이미 받아 둔 파일만 읽는다. 목록을 새로 수집하지 않는다 */
function loadList(): ListRow[] {
  const byId = new Map<string, ListRow>()
  for (const f of filesEnding('.list.jsonl')) {
    for (const r of jsonl(f)) {
      const id = S(r.sourceArticleId)
      if (id !== '') byId.set(id, r as ListRow)
    }
  }
  return [...byId.values()]
}

/** 본문을 이미 읽은 글 — 세 곳을 다 본다. 하나만 보면 재탕이 샌다 */
function seenBodyIds(): Set<string> {
  const seen = new Set<string>()
  for (const suffix of ['.detail.jsonl', '.raw-detail.jsonl', '.thin-detail.jsonl']) {
    for (const f of filesEnding(suffix)) {
      for (const r of jsonl(f)) {
        const id = S(r.sourceArticleId)
        if (id !== '') seen.add(id)
      }
    }
  }
  return seen
}

const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms) })

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.text()
}

function toTsv(rows: readonly ThinRow[]): string {
  const head = THIN_COLUMNS.join('\t')
  const body = rows.map((r) => THIN_COLUMNS
    .map((c) => String((r as unknown as Record<string, unknown>)[c] ?? '')
      .replace(/[\t\n\r]/g, ' '))
    .join('\t'))
  return [head, ...body].join('\n')
}

async function main(): Promise<void> {
  await loadEnvLocal()
  const killOpen = process.env[THIN_KILL_SWITCH_ENV] === 'true'

  console.log(LIVE ? '\n══ 🔴 live ══\n' : '\n══ 계획만 (네트워크 0 · 파일 0) ══\n')
  console.log(`  대상   82cook 목록 재고 중 본문 없는 것 (댓글 ${COMMENT_TIER_LOW}+ · ${COMMENT_TIER_HIGH}+ 우선)`)
  console.log(`  상한   ${CAP}건 · 요청 간격 ${PACE_MIN_MS}~${PACE_MAX_MS}ms 랜덤`)
  console.log(`  🔴 본문 전문을 저장하지 않는다 — 마스킹 후 앞 ${BODY_HEAD_CHARS}자만 남긴다`)
  console.log('  🔴 DB 0 · Sheet 0 · LLM 0 · Raw Vault 0 · 발행 0 · 네이버 0\n')

  if (!Number.isInteger(CAP) || CAP < 1 || CAP > BATCH_CAP) {
    fail(`--cap 은 1~${BATCH_CAP} 의 정수다 (받은 값 ${arg('cap') ?? '없음'})`)
  }

  const rows = loadList()
  const hasBody = seenBodyIds()
  const plan = planThinFetch({
    rows, hasBody, cap: CAP,
    judge: {
      isPolitics: (title) => judgePoliticsTitle(title).excluded,
      // 🔴 제목만으로 확실히 버릴 것만 — hold 는 남긴다(읽어봐야 안다)
      isBlocked: (title) => {
        const v = safetyFilter({ title }).verdict
        return v === 'hardExclude' || v === 'drop'
      },
    },
  })

  console.log(`① 목록 ${rows.length}건 → 열 대상 ${plan.targets.length}건`)
  console.log(`   댓글 ${COMMENT_TIER_HIGH}+ ${plan.high}건 · ${COMMENT_TIER_LOW}~${COMMENT_TIER_HIGH - 1} ${plan.low}건`)
  for (const t of plan.targets) {
    // 🔴 제목은 앞 10자만 — 남의 글 제목을 로그에 통째로 남기지 않는다
    console.log(`   · ${S(t.sourceArticleId)}  댓글 ${Number(t.sourceCommentCount ?? 0)}`
      + `  ${S(t.originalTitle).slice(0, 10)}… (${S(t.originalTitle).length}자)`)
  }

  const byCode = new Map<string, number>()
  for (const s of plan.skipped) byCode.set(s.code, (byCode.get(s.code) ?? 0) + 1)
  if (byCode.size > 0) {
    console.log(`\n② 제외 ${plan.skipped.length}건`)
    for (const [code, n] of [...byCode.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   ${String(n).padStart(4)}건  ${SKIP_LABEL[code as keyof typeof SKIP_LABEL]}`)
    }
  }

  if (!LIVE) {
    console.log('\n③ 열지 않는다 — 계획만이다.')
    console.log(`   🟡 네트워크 요청 0 · 파일 0. 실행하려면 --live 와 ${THIN_KILL_SWITCH_ENV}=true 가 둘 다 필요합니다.\n`)
    return
  }
  // 🔴 두 스위치 — --live 하나로는 밖으로 나가지 않는다
  if (!killOpen) fail(`${THIN_KILL_SWITCH_ENV}=true 가 없습니다. --live 하나로는 열지 않습니다`)

  // ── robots — 실행마다 확인한다 ──
  const rules: RobotsRules = parseRobotsTxt(await get(ROBOTS_URL))
  const blocked = plan.targets
    .map((t) => ARTICLE_URL(S(t.sourceArticleId)))
    .filter((u) => !isPathAllowed(toRobotsPath(u), rules))
  console.log(`\n③ robots.txt · Disallow ${rules.disallow.length}건 · 막힌 대상 ${blocked.length}건`)

  const gate = judgeLive({
    live: LIVE, targets: plan.targets.length, cap: CAP, robotsAllowed: blocked.length === 0,
  })
  if (!gate.ok) fail(gate.reason)

  const runId = runIdOf(new Date())
  const out: ThinRow[] = []
  console.log(`\n④ 🔴 읽는다 ${plan.targets.length}건 (runId ${runId})`)
  for (const [i, t] of plan.targets.entries()) {
    if (i > 0) await sleep(paceMs(Math.random()))
    const id = S(t.sourceArticleId)
    const url = ARTICLE_URL(id)
    let body = ''
    let reason = ''
    try {
      const html = await get(url)
      const bodyHtml = extractArticleBodyHtml(html)
      body = bodyHtml === null ? '' : htmlToText(bodyHtml)
      if (body === '') reason = '본문을 찾지 못했다(이미지만 있는 글일 수 있다)'
    } catch (e) {
      reason = `읽기 실패: ${e instanceof Error ? e.message : String(e)}`
    }
    const title = S(t.originalTitle)
    // 🔴 마스킹을 **자르기 전에** 한다. 순서를 바꾸면 경계에 걸친 연락처가 절반만 지워진다
    const masked = maskSensitive(body)
    // 🔴 댓글 본문은 수집하지 않는다 — 목록의 댓글 **수**만 쓴다(§4-AP)
    const v = classifyDetail({
      title, body, comments: [], imageCount: 0,
      boardName: '자유게시판', qualityFlags: [], access: 'ok',
    })
    const row = toThinRow({
      id, url, title,
      commentCount: Number(t.sourceCommentCount ?? 0),
      score: 0,
      maskedBody: masked,
      bodyHeadChars: BODY_HEAD_CHARS,
      axis: String(v.axis),
      safetyVerdict: String(v.safety.verdict),
      safetyReasons: v.safety.reasons.map((x) => String(x)),
      // 🔴 읽기 실패가 있으면 그것을, 없으면 판정 근거를 남긴다
      reason: reason === '' ? v.reason : reason,
      runId,
      fetchedAt: new Date().toISOString(),
    })
    // 🔴 저장 직전 마지막 관문 — 전문이 섞였으면 여기서 멈춘다
    const bad = violatesStorage(row as unknown as Record<string, unknown>, BODY_HEAD_CHARS)
    if (bad.length > 0) fail(`저장 계약 위반\n${bad.map((b) => `     ${b}`).join('\n')}`)
    out.push(row)
    console.log(`   ${reason === '' ? '✅' : '⚠️'} ${id} · ${row.bodyLength}자 → 저장 ${row.bodyHead.length}자`
      + ` · ${row.axis || '-'} · ${row.safetyVerdict || '-'}${reason === '' ? '' : ` · ${reason}`}`)
  }

  const base = join(DATA_DIR, `82cook-thin-${runId}`)
  const jsonPath = `${base}.thin-detail.jsonl`
  const tsvPath = `${base}.thin-detail.tsv`
  for (const p of [jsonPath, tsvPath]) {
    if (!isInsideDataDir(p)) fail(`${p} 은 ${DATA_DIR}/ 밖이다 — 거부한다`)
  }
  writeFileSync(jsonPath, `${out.map((r) => JSON.stringify(r)).join('\n')}\n`, 'utf-8')
  writeFileSync(tsvPath, `${toTsv(out)}\n`, 'utf-8')

  const long = out.filter((r) => r.bodyHead.length > BODY_HEAD_CHARS).length
  console.log(`\n⑤ 저장 ${out.length}건 · ${kstString(new Date())}`)
  console.log(`   ✅ ${jsonPath}`)
  console.log(`   ✅ ${tsvPath}`)
  console.log(`   🔴 bodyHead ${BODY_HEAD_CHARS}자 초과 ${long}건 (0이어야 한다)`)
  console.log('   🔴 전문은 저장하지 않았다. DB · Sheet · Raw Vault 어디에도 쓰지 않았다.\n')
  if (long > 0) process.exit(1)
}

/** 🔴 CLI 로 직접 실행할 때만 돈다 — import 만으로 네트워크를 건드리지 않는다 */
const isDirectRun = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href
if (isDirectRun) await main()
export { SOURCE_SITE }

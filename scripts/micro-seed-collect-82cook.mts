#!/usr/bin/env tsx
/**
 * 82cook Micro Seed 후보 수집 — 목록 + 지정 상세
 *
 * 정본: docs/constitution/MICRO_SEED_LANE_CONSTITUTION.md §5-2-1 · §6-9-F · §6-10 · §12-2
 *
 * 🔴 이 스크립트는 DB 도 Sheet 도 건드리지 않는다
 *    prisma 를 import 하지 않고, Sheet API 를 부르지 않는다. 산출물은 로컬 JSONL 뿐이다.
 *    DB · Sheet 적재는 **다음 PR** 의 일이고, 그 경계를 파일로 나눈 것이 이 설계의 핵심이다.
 *
 * 🔴 목록에서 상세를 전부 긁지 않는다
 *    목록은 URL · 제목 · 댓글수만 본다. 상세는 **사람이 고른 것만** 연다 (--fetch).
 *    "일단 다 받아두고 나중에 고른다" 는 부하도 리스크도 우리가 정하지 않은 것이 된다.
 *
 * 🔴 댓글 본문을 수집하지 않는다
 *    목록의 댓글 **수**만 신호로 쓴다 (정책 3). 상세에서 댓글 영역을 파싱하지 않는다.
 *
 * 🔴 이미지를 가져오지 않는다
 *    htmlToText 가 <img> 를 흔적 없이 지운다. URL 조차 남기지 않는다 —
 *    이미지 포함 원문 재발행은 롤백 사고 이력이 있는 금지 사항이다.
 *
 * 안전장치
 *   dry-run 기본   --live 가 없으면 네트워크를 타지 않는다. 계획만 출력한다
 *   kill switch    SORAN_82COOK_COLLECT_ENABLED=true 가 아니면 --live 가 무시된다
 *   robots         매 실행마다 robots.txt 를 읽어 대상 경로가 허용되는지 확인한다
 *   고정 지연      요청 사이 2초. 랜덤 jitter 없음
 *   cron 없음      §6-9-F — M1 은 수동 실행이다
 *
 * 사용법
 *   npm run micro-seed:collect-82cook -- --list --pages=2              계획만
 *   npm run micro-seed:collect-82cook -- --list --pages=2 --live       실제 수집
 *   npm run micro-seed:collect-82cook -- --fetch=4231986,4231985 --live
 *   npm run micro-seed:collect-82cook -- --list --pages=1 --live --out=./.microseed-data/list.jsonl
 */
import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  ARTICLE_URL, BOARD_NAME, BOARD_NO, DELAY_MS, LIST_URL, ROBOTS_URL, SOURCE_SITE, USER_AGENT,
  buildCollected, extractArticleBodyHtml, htmlToText, isPathAllowed,
  parseArticleTitle, parseListHtml, parseRobotsTxt, toRobotsPath,
  type CollectedCandidate, type ListItem, type RobotsRules,
} from './lib/micro-seed-82cook.mjs'
import { loadEnvLocal, kstString } from './lib/micro-seed-time.mjs'

const KILL_SWITCH = 'SORAN_82COOK_COLLECT_ENABLED'
const LIVE = process.argv.includes('--live')
const WANT_LIST = process.argv.includes('--list')
const arg = (name: string): string | undefined => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : undefined
}
const PAGES = Number(arg('pages') ?? '1')
const FETCH_IDS = (arg('fetch') ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const OUT = arg('out') ?? './.microseed-data/82cook.jsonl'
const FROM = arg('from')

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function get(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' } })
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
  return await res.text()
}

function writeJsonl(path: string, rows: object[]) {
  mkdirSync(dirname(path), { recursive: true })
  for (const r of rows) appendFileSync(path, `${JSON.stringify(r)}\n`, 'utf-8')
}

async function main() {
  await loadEnvLocal()
  const enabled = process.env[KILL_SWITCH] === 'true'
  const live = LIVE && enabled
  const now = new Date()

  console.log('\n82cook Micro Seed 후보 수집')
  console.log(`  sourceSite=${SOURCE_SITE} · 게시판 bn=${BOARD_NO}(${BOARD_NAME}) · ${kstString(now)} KST`)
  console.log(`  User-Agent: ${USER_AGENT}`)
  console.log(`  요청 간격: ${DELAY_MS}ms 고정 (랜덤 jitter 없음)`)
  console.log(`  kill switch ${KILL_SWITCH}=${enabled ? 'ON' : 'OFF'} · --live ${LIVE ? '있음' : '없음'}`)
  console.log(
    live
      ? `  🔴 실제 수집 · 출력 ${OUT}\n`
      : `  🔍 dry-run — 네트워크를 타지 않는다. 실제 수집은 --live 와 ${KILL_SWITCH}=true 둘 다 필요하다\n`,
  )
  console.log('  🔴 DB write 없음 · Sheet write 없음 · Post 생성 없음 · 댓글 본문 미수집 · 이미지 미수집\n')

  // ── 계획 출력 (dry-run 이든 아니든 무엇을 할지 먼저 말한다) ──
  const plannedList = WANT_LIST ? Array.from({ length: PAGES }, (_, i) => LIST_URL(i + 1)) : []
  const plannedArticles = FETCH_IDS.map(ARTICLE_URL)
  if (plannedList.length) console.log(`  목록 ${plannedList.length}페이지:\n${plannedList.map((u) => `     ${u}`).join('\n')}`)
  if (plannedArticles.length) console.log(`  상세 ${plannedArticles.length}건:\n${plannedArticles.map((u) => `     ${u}`).join('\n')}`)
  if (!plannedList.length && !plannedArticles.length) {
    console.log('  할 일이 없다. --list --pages=N 또는 --fetch=<num,num> 을 준다.\n')
    return
  }

  if (!live) {
    console.log(`\n  🔍 dry-run 종료. 네트워크 요청 0건 · 파일 쓰기 0건.`)
    if (LIVE && !enabled) console.log(`     (--live 를 줬지만 ${KILL_SWITCH} 가 true 가 아니라 무시했다)`)
    console.log('')
    return
  }

  // ── robots.txt — 실행마다 확인한다 ────────────────────
  const robotsText = await get(ROBOTS_URL)
  const rules: RobotsRules = parseRobotsTxt(robotsText)
  console.log(`\n  robots.txt · User-agent:* Disallow ${rules.disallow.length}건`)
  for (const d of rules.disallow) console.log(`     ${d}`)

  const blocked = [...plannedList, ...plannedArticles].filter((u) => !isPathAllowed(toRobotsPath(u), rules))
  if (blocked.length) {
    console.error(`\n  🛑 robots 가 막는 URL 이 있다 — 수집하지 않는다:\n${blocked.map((u) => `     ${u}`).join('\n')}\n`)
    process.exit(1)
  }
  console.log('  ✅ 대상 URL 전부 robots 허용\n')

  // ── ① 목록 ────────────────────────────────────────────
  const items: ListItem[] = []
  for (let p = 1; p <= (WANT_LIST ? PAGES : 0); p += 1) {
    const html = await get(LIST_URL(p))
    const parsed = parseListHtml(html)
    items.push(...parsed)
    console.log(`  목록 ${p}p → ${parsed.length}건`)
    if (p < PAGES) await sleep(DELAY_MS)
  }
  if (items.length) {
    const listPath = OUT.replace(/\.jsonl$/, '.list.jsonl')
    // 🔴 목록도 buildCollected 를 거친다 (2026-08-26 실측 결함).
    //    예전에는 여기서 객체를 직접 만들어 sourceBoardName · sourceCapturedAt 이 빠졌다.
    //    상세 산출물은 9필드인데 목록은 6필드라, 목록을 importer 에 넘기면 두 칸이 빈다.
    //    정규화 경로를 하나로 두면 같은 종류의 누락이 다시 생기지 않는다 (C-2).
    //
    //    rawBody 는 **빈 문자열**이다 — 목록은 본문을 읽지 않는다.
    //    importer 는 rawBody 가 빈 행을 거부하므로 목록 파일이 잘못 들어와도 적재되지 않는다.
    writeJsonl(listPath, items.map((i) => buildCollected(i, '', now.toISOString())))
    console.log(`  → ${listPath} (${items.length}건)\n`)
    const top = [...items].sort((a, b) => b.sourceCommentCount - a.sourceCommentCount).slice(0, 10)
    console.log('  댓글 많은 순 상위 10건 (상세는 --fetch 로 골라서 연다):')
    for (const t of top) console.log(`     ${String(t.sourceCommentCount).padStart(3)}  ${t.sourceArticleId}  ${t.originalTitle.slice(0, 40)}`)
    console.log('')
  }

  // ── ② 지정 상세 ──────────────────────────────────────
  if (!FETCH_IDS.length) {
    console.log('  상세 요청 없음 (--fetch 미지정). 목록만 저장했다.\n')
    return
  }
  // 목록 정보가 있으면 그것을, 없으면 파일에서 찾는다 — 댓글수를 상세에서 세지 않기 위해서다.
  const known = new Map(items.map((i) => [i.sourceArticleId, i]))
  if (FROM && existsSync(FROM)) {
    for (const line of readFileSync(FROM, 'utf-8').split('\n').filter(Boolean)) {
      const row = JSON.parse(line) as ListItem
      if (row?.sourceArticleId) known.set(row.sourceArticleId, row)
    }
  }

  const collected: CollectedCandidate[] = []
  for (const [idx, id] of FETCH_IDS.entries()) {
    if (idx > 0) await sleep(DELAY_MS)
    const html = await get(ARTICLE_URL(id))
    const bodyHtml = extractArticleBodyHtml(html)
    if (!bodyHtml) {
      console.error(`  ⚠️ ${id} — 본문(div#articleBody)을 찾지 못했다. 건너뛴다`)
      continue
    }
    const rawBody = htmlToText(bodyHtml)
    if (!rawBody) {
      console.error(`  ⚠️ ${id} — 본문이 비었다(이미지만 있는 글일 수 있다). 건너뛴다`)
      continue
    }
    const detailTitle = parseArticleTitle(html)
    const base = known.get(id) ?? {
      sourceArticleId: id,
      sourceUrl: ARTICLE_URL(id),
      originalTitle: detailTitle ?? '',
      sourceCommentCount: 0,
    }
    if (!base.originalTitle) {
      console.error(`  ⚠️ ${id} — 제목을 얻지 못했다. 건너뛴다`)
      continue
    }
    if (!known.has(id)) {
      console.log(`  ℹ️ ${id} — 목록 정보가 없어 sourceCommentCount=0 으로 둔다 (상세에서 세지 않는다)`)
    }
    collected.push(buildCollected(base, rawBody, now.toISOString()))
    console.log(`  ✅ ${id} · ${rawBody.length}자 · 댓글 ${base.sourceCommentCount} · ${base.originalTitle.slice(0, 30)}`)
  }

  if (collected.length) {
    writeJsonl(OUT, collected)
    console.log(`\n  → ${OUT} (${collected.length}건)`)
  }
  console.log('\n  🔴 DB · Sheet 에 아무것도 쓰지 않았다. 적재는 다음 PR 의 importer 가 한다.\n')
}

main().catch((e) => {
  console.error(`\n❌ ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})

#!/usr/bin/env node
/**
 * 매거진 예약 재고 계산
 *
 * 01:00 KST local producer 가 "오늘 몇 건을 만들지" 정하는 근거다 (운영 전략서 §5).
 * 이 스크립트는 **읽기만 한다** — 파일을 쓰지 않고 네트워크도 쓰지 않는다.
 *
 * 사용법
 *   node scripts/magazine-inventory.mjs
 *   node scripts/magazine-inventory.mjs --json
 *
 * 종료 코드: 항상 0 (상태 보고이지 판정이 아니다)
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { isPublic, resolvePublishAt } from './lib/magazine-gate.mjs'

const ROOT = process.cwd()
const ARTICLES_TS = join(ROOT, 'src/content/magazine/articles.ts')

/** 재고 정책 — 운영 전략서 §5 */
const TARGET_DAYS = 14
const MIN_DAYS = 7
const MAX_DAYS = 21

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// ── TS 리터럴 읽기 ─────────────────────────────────────────

function sliceLiteral(source, fromIndex, open, close) {
  const start = source.indexOf(open, fromIndex)
  if (start === -1) return null
  let depth = 0
  let quote = null
  let i = start
  while (i < source.length) {
    const ch = source[i]
    const next = source[i + 1]
    if (quote) {
      if (ch === '\\') i += 1
      else if (ch === quote) quote = null
    } else if (ch === "'" || ch === '"' || ch === '`') quote = ch
    else if (ch === '/' && next === '/') {
      i = source.indexOf('\n', i)
      if (i === -1) break
    } else if (ch === '/' && next === '*') {
      i = source.indexOf('*/', i + 2) + 1
      if (i === 0) break
    } else if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return source.slice(start, i + 1)
    }
    i += 1
  }
  return null
}

/** 전역이 없는 컨텍스트에서 데이터 리터럴만 평가한다 (fs·network 접근 불가) */
function loadArticles() {
  if (!existsSync(ARTICLES_TS)) return []
  const src = readFileSync(ARTICLES_TS, 'utf8')
  const anchor = src.indexOf('MAGAZINE_ARTICLE_RECORD')
  if (anchor === -1) return []
  const literal = sliceLiteral(src, src.indexOf('=', anchor), '{', '}')
  if (!literal) return []
  const record = runInNewContext(`(${literal})`, Object.create(null), { timeout: 1000 })
  return Object.entries(record).map(([slug, a]) => ({ slug, ...a }))
}

// ── KST 날짜 ───────────────────────────────────────────────

/** ms 를 KST 기준 YYYY-MM-DD 로 */
function toKstDate(ms) {
  return new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10)
}

/** KST 기준 두 날짜의 일수 차 */
function kstDayDiff(fromMs, toMs) {
  const a = Math.floor((fromMs + KST_OFFSET_MS) / DAY_MS)
  const b = Math.floor((toMs + KST_OFFSET_MS) / DAY_MS)
  return b - a
}

/** 재고 일수에 따른 생산량 — 운영 전략서 §5 */
function produceCountFor(inventoryDays) {
  if (inventoryDays >= TARGET_DAYS) return 0
  if (inventoryDays >= MIN_DAYS) return 3
  return 5
}

// ── 계산 ───────────────────────────────────────────────────

export function calculateInventory(now = Date.now()) {
  const articles = loadArticles()

  const live = articles.filter((a) => isPublic(a, now))
  const blocked = articles.filter((a) => a.status === 'BLOCKED')
  const drafts = articles.filter((a) => a.status === 'DRAFT')

  // 예약 = 아직 공개 전이고 차단·초안도 아닌 것
  const scheduled = articles
    .filter((a) => !isPublic(a, now) && a.status !== 'BLOCKED' && a.status !== 'DRAFT')
    .map((a) => ({ slug: a.slug, title: a.title, at: resolvePublishAt(a) }))
    .sort((x, y) => x.at - y.at)

  const upcoming = scheduled.map((s) => ({
    slug: s.slug,
    title: s.title,
    publishAt: new Date(s.at).toISOString(),
    kstDate: toKstDate(s.at),
    inDays: kstDayDiff(now, s.at),
  }))

  // 재고 = 가장 늦은 예약까지 며칠 남았나. 예약이 없으면 0
  const inventoryDays = upcoming.length === 0 ? 0 : Math.max(0, upcoming[upcoming.length - 1].inDays)
  const nextPublishAt = upcoming.length > 0 ? upcoming[0].publishAt : null

  const warnings = []
  if (inventoryDays > MAX_DAYS) {
    warnings.push(
      `재고 ${inventoryDays}일 — 상한 ${MAX_DAYS}일 초과. 계절·공휴일 주제가 시기를 놓친다`,
    )
  }
  if (inventoryDays > 0 && inventoryDays < 3) {
    warnings.push(`재고 ${inventoryDays}일 — 3일 이하는 창업자 예외 알림 대상 (전략서 §10)`)
  }

  return {
    now: new Date(now).toISOString(),
    kstToday: toKstDate(now),
    counts: {
      total: articles.length,
      live: live.length,
      scheduled: scheduled.length,
      blocked: blocked.length,
      draft: drafts.length,
    },
    inventoryDays,
    nextPublishAt,
    produceCount: produceCountFor(inventoryDays),
    policy: { target: TARGET_DAYS, min: MIN_DAYS, max: MAX_DAYS },
    upcoming,
    warnings,
    /** 재고 0 일 때 저품질을 억지로 내보내지 말라는 안내 */
    emptyInventoryNote:
      inventoryDays === 0
        ? '재고 0 — 그날은 신규 공개가 없어도 된다. 공백이 저품질보다 낫다. 억지로 생산하지 않는다.'
        : null,
  }
}

// ── 출력 ───────────────────────────────────────────────────

function printHuman(r) {
  console.log('')
  console.log(`매거진 예약 재고 — KST ${r.kstToday}`)
  console.log('')
  console.log(
    `  공개 ${r.counts.live}건 · 예약 ${r.counts.scheduled}건 · ` +
      `차단 ${r.counts.blocked}건 · 초안 ${r.counts.draft}건 (전체 ${r.counts.total})`,
  )
  console.log('')
  console.log(`  재고        ${r.inventoryDays}일  (목표 ${r.policy.target} · 최소 ${r.policy.min} · 최대 ${r.policy.max})`)
  console.log(`  다음 공개   ${r.nextPublishAt ?? '없음'}`)
  console.log(`  오늘 생산   ${r.produceCount}건`)

  if (r.upcoming.length > 0) {
    console.log('')
    console.log('  공개 예정')
    for (const u of r.upcoming) {
      console.log(`    ${u.kstDate}  (D+${u.inDays})  ${u.slug}`)
    }
  }

  if (r.emptyInventoryNote) {
    console.log('')
    console.log(`  ℹ️  ${r.emptyInventoryNote}`)
  }
  for (const w of r.warnings) {
    console.log('')
    console.log(`  ⚠️  ${w}`)
  }
  console.log('')
}

function main() {
  const asJson = process.argv.includes('--json')
  const result = calculateInventory()
  if (asJson) console.log(JSON.stringify(result, null, 2))
  else printHuman(result)
  process.exit(0)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-inventory.mjs')) main()

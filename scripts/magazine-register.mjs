#!/usr/bin/env node
/**
 * 매거진 예약 등록 — article-draft.ts 를 articles.ts 에 SCHEDULED 로 올리고 큐에서 뺀다.
 *
 * 사람이 articles.ts 와 topic-queue.ts 를 손으로 고치지 않게 하는 것이 목적이다.
 * 지금까지는 세션이 매번 두 파일을 직접 편집했다 — 가장 손이 많이 가고 가장 틀리기 쉬운 자리다.
 *
 * 🔴 기본이 dry-run 이다. --write 를 명시해야만 파일을 고친다.
 *    실수로 articles.ts 가 바뀌는 쪽보다 아무 일도 안 일어나는 쪽이 낫다.
 *
 * 🔴 부분 수정을 하지 않는다.
 *    두 파일(articles.ts · topic-queue.ts)을 메모리에서 모두 만든 뒤 한꺼번에 쓴다.
 *    중간에 실패하면 아무것도 쓰지 않는다 — 한쪽만 바뀐 상태가 가장 고치기 어렵다.
 *
 * 🔴 판정이 애매하면 BLOCKED 로 끝낸다.
 *    삽입 위치를 못 찾거나 큐에서 제거 대상이 1개가 아니면 추측하지 않는다.
 *
 * 사용법
 *   node scripts/magazine-register.mjs --slug <slug> --publish-at 2026-09-02
 *   node scripts/magazine-register.mjs --slug <slug> --publish-at 2026-09-02 --write
 *   node scripts/magazine-register.mjs --slug <slug> --publish-at ... --json
 *
 * 종료 코드: BLOCKED 면 1, 아니면 0
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadArticles, loadQueue, sliceLiteral, evalLiteral, ROOT, ARTICLES_TS, QUEUE_TS, DRAFTS_DIR } from './lib/magazine-load.mjs'
import { isAutoLaneEligible } from './lib/magazine-validation-profile.mjs'

/** 운영 전략서 §4. 공개 시각은 하나로 고정한다 */
const KST_TIME = 'T10:30:00+09:00'
// 🔴 AUTO_RISK 제거 (M3-A · SUPERSEDED) — 등급으로 등록을 막지 않는다

/**
 * 🔴 **사람 승인 손잡이는 M3-A 에서 없앴다.**
 *    등급으로 등록을 막지 않으므로 "창업자가 건별로 여는 문" 이 필요 없다.
 *    `--founder-approved` 인자는 옛 호출부 호환을 위해 받기만 하고 **아무것도 열지 않는다.**
 */
/** 이 앵커 앞에 레코드를 넣는다. 없으면 파일 구조가 바뀐 것이므로 멈춘다 */
const ANCHOR = '} satisfies Record<string, MagazineArticleBody>'

// ── publishAt ──────────────────────────────────────────────

/**
 * 날짜만 오면 10:30 KST 로 보정한다. ISO 가 오면 KST 기준 시각을 검증한다.
 * 하루 1건 원칙이라 "몇 시인가"보다 "무슨 날인가"가 중요하다.
 */
export function normalizePublishAt(input) {
  if (!input) return { ok: false, why: '--publish-at 이 필요하다' }

  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    return { ok: true, date: input, publishAt: `${input}${KST_TIME}` }
  }

  const t = Date.parse(input)
  if (Number.isNaN(t)) return { ok: false, why: `날짜를 해석하지 못했다: ${input}` }

  // KST 로 환산해 날짜와 시각을 본다
  const kst = new Date(t + 9 * 60 * 60 * 1000).toISOString()
  const date = kst.slice(0, 10)
  const hhmm = kst.slice(11, 16)
  if (hhmm !== '10:30') {
    return { ok: false, why: `공개 시각은 10:30 KST 여야 한다 (받은 값: ${hhmm} KST)` }
  }
  return { ok: true, date, publishAt: input }
}

/** 이미 잡힌 날짜를 모은다. publishAt 이 없으면 publishedAt 이 그날 10:30 이다 */
function takenDates(articles) {
  const m = new Map()
  for (const a of articles) {
    const d = a.publishAt ? new Date(a.publishAt) : null
    const date = d && !Number.isNaN(+d)
      ? new Date(+d + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
      : a.publishedAt
    if (date) m.set(date, a.slug)
  }
  return m
}

// ── draft ──────────────────────────────────────────────────

function loadDraftLiteral(dir) {
  const file = join(dir, 'article-draft.ts')
  if (!existsSync(file)) return null
  const src = readFileSync(file, 'utf8')
  const anchor = src.indexOf('export const DRAFT')
  if (anchor === -1) return null
  const literal = sliceLiteral(src, src.indexOf('=', anchor), '{', '}')
  if (!literal) return null
  return { literal, value: evalLiteral(literal, 'article-draft.ts') }
}

/**
 * draft 리터럴을 articles.ts 레코드로 바꾼다.
 * 문장은 손대지 않는다 — publishedAt 확정과 status·publishAt 주입만 한다.
 */
export function buildRecord(slug, literal, date, publishAt) {
  let body = literal.replace(/\n\s*\/\/ 발행일은 창업자가 확정한다\n/, '\n')

  if (!/publishedAt:\s*''/.test(body)) {
    return { ok: false, why: "article-draft.ts 에서 publishedAt: '' 를 찾지 못했다" }
  }
  body = body.replace(
    /publishedAt:\s*'',/,
    `publishedAt: '${date}',\n    status: 'SCHEDULED',\n    publishAt: '${publishAt}',`,
  )
  // 레코드 안으로 한 단계 들여쓴다
  body = body.split('\n').map((l, i) => (i === 0 ? l : l.trim() ? '  ' + l : l)).join('\n')
  return { ok: true, text: `  '${slug}': ${body},\n` }
}

// ── 판정 ───────────────────────────────────────────────────

/**
  * 🔴 **`founderApproved` 우회로를 없앴다** (M3-A).
  *    등급으로 막지 않으므로 "창업자가 건별로 열어 주는 문" 이 필요 없다.
  *    인자는 호환을 위해 받되 **판정에 쓰지 않는다.**
  */
export function plan({ slug, publishAtInput, founderApproved = false }) {
  void founderApproved   // 🔴 읽기만 한다 — 등록 여부를 바꾸지 않는다
  const reasons = []
  const notes = []

  const norm = normalizePublishAt(publishAtInput)
  if (!norm.ok) reasons.push(norm.why)

  const dir = join(DRAFTS_DIR, slug)
  if (!existsSync(join(dir, 'article-draft.ts'))) reasons.push(`article-draft.ts 가 없다: drafts/magazine/${slug}/`)
  if (!existsSync(join(dir, 'review.ts'))) reasons.push(`review.ts 가 없다: drafts/magazine/${slug}/`)

  let articles = []
  let queue = []
  try {
    articles = loadArticles()
    queue = loadQueue()
  } catch (err) {
    reasons.push(`파일 파싱 실패: ${err.message}`)
    return { slug, verdict: 'BLOCKED', reasons, notes, checks: { approvalMode: null } }
  }

  // 중복 — 상태를 가리지 않는다. 예약분도 이미 쓴 slug 다
  if (articles.some((a) => a.slug === slug)) {
    reasons.push('이미 articles.ts 에 있다 (공개·예약·차단 포함)')
  }

  // 큐 — 정확히 1개여야 한다
  const inQueue = queue.filter((i) => i.slug === slug)
  if (inQueue.length === 0) reasons.push('topic-queue.ts 에 없다')
  else if (inQueue.length > 1) reasons.push(`topic-queue.ts 에 ${inQueue.length}개 있다 — 1개여야 제거할 수 있다`)

  const item = inQueue[0]
  if (item) {

    /**
     * 🔴 **등록을 등급으로 막지 않는다** (M3-A).
     *    `founderApproved` 우회로도 함께 없앤다 — 우회로가 필요했던 이유가 사라졌다.
     */
    const lane = isAutoLaneEligible(item)
    if (!lane.ok) reasons.push(`${lane.code} — ${lane.why}`)
    else notes.push(`validationProfile=${lane.profile}`)
    if (item.publishWindow && norm.ok) {
      const { after, before } = item.publishWindow
      if (norm.date < after) reasons.push(`publishWindow 이전 (after ${after})`)
      if (norm.date > before) reasons.push(`publishWindow 경과 (before ${before}) — 철 지난 주제`)
    }
  }

  // 슬롯 충돌 — 하루 1건
  const taken = takenDates(articles)
  if (norm.ok && taken.has(norm.date)) {
    reasons.push(`${norm.date} 슬롯이 이미 차 있다 (${taken.get(norm.date)}) — 하루 1건`)
  }

  // hero
  const draft = existsSync(dir) ? loadDraftLiteral(dir) : null
  if (existsSync(join(dir, 'article-draft.ts')) && !draft) {
    reasons.push('article-draft.ts 에서 DRAFT 를 읽지 못했다')
  }
  if (item?.imageMode === 'REQUIRED') {
    const src = draft?.value?.heroImage?.src
    const ok = Boolean(src) && existsSync(join(ROOT, 'public', src.replace(/^\//, '')))
    if (!ok) reasons.push(`imageMode=REQUIRED 인데 hero 가 없다${src ? ` (public${src})` : ''}`)
  }

  // 삽입 위치
  const articlesSrc = existsSync(ARTICLES_TS) ? readFileSync(ARTICLES_TS, 'utf8') : ''
  if (!articlesSrc.includes(ANCHOR)) reasons.push('articles.ts 에서 삽입 위치를 찾지 못했다 — 구조가 바뀌었다')

  return {
    slug,
    verdict: reasons.length ? 'BLOCKED' : 'READY',
    reasons,
    notes,
    checks: {
      date: norm.ok ? norm.date : null,
      publishAt: norm.ok ? norm.publishAt : null,
      riskLevel: item?.riskLevel ?? null,
      autoEligible: item?.autoEligible ?? null,
      imageMode: item?.imageMode ?? null,
      queueDay: item?.day ?? null,
      slotFree: norm.ok ? !taken.has(norm.date) : null,
      approvalMode: null,
    },
    _internal: { dir, draft, norm, item, articlesSrc },
  }
}

// ── 쓰기 ───────────────────────────────────────────────────

/** 두 파일을 메모리에서 다 만든 뒤 한꺼번에 쓴다. 중간 실패 시 아무것도 안 쓴다 */
function applyWrite(p) {
  const { draft, norm, item, articlesSrc } = p._internal

  const rec = buildRecord(p.slug, draft.literal, norm.date, norm.publishAt)
  if (!rec.ok) return { ok: false, why: rec.why }

  const nextArticles = articlesSrc.replace(ANCHOR, rec.text + ANCHOR)
  if (nextArticles === articlesSrc) return { ok: false, why: 'articles.ts 삽입에 실패했다' }

  const queueSrc = readFileSync(QUEUE_TS, 'utf8')
  const re = new RegExp(`  \\{\\n    day: ${item.day},[\\s\\S]*?\\n  \\},\\n`, 'm')
  const hits = queueSrc.match(re)
  if (!hits) return { ok: false, why: `topic-queue.ts 에서 day ${item.day} 블록을 찾지 못했다` }
  const nextQueue = queueSrc.replace(re, '')
  if (nextQueue === queueSrc) return { ok: false, why: 'topic-queue.ts 제거에 실패했다' }

  // 여기까지 오면 둘 다 성공. 이제 쓴다
  writeFileSync(ARTICLES_TS, nextArticles)
  writeFileSync(QUEUE_TS, nextQueue)
  return { ok: true }
}

// ── CLI ────────────────────────────────────────────────────

function help() {
  console.log(`매거진 예약 등록 — article-draft.ts → articles.ts (SCHEDULED)

  node scripts/magazine-register.mjs --slug <slug> --publish-at 2026-09-02
  node scripts/magazine-register.mjs --slug <slug> --publish-at 2026-09-02 --write
  node scripts/magazine-register.mjs --slug <slug> --publish-at ... --json

🔴 기본은 dry-run. --write 를 명시해야만 파일을 고친다.
🔴 하루 1건. 슬롯이 차 있으면 BLOCKED.
🔴 공개 시각은 10:30 KST 고정. 날짜만 주면 자동 보정한다.
🔴 등급으로 막지 않는다 (M3-A). 막는 것은 프로필 미정 · 슬롯 · 중복 · 큐 부재 ·
   REQUIRED hero 없음 · 삽입 위치 부재다.
🔴 사람 승인 손잡이는 없다. --founder-approved 는 아무것도 열지 않는다.`)
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) return help()

  const arg = (k) => {
    const i = argv.indexOf(k)
    return i === -1 ? undefined : argv[i + 1]
  }
  const slug = arg('--slug')
  const write = argv.includes('--write')
  const asJson = argv.includes('--json')
  // 🔴 `--founder-approved` 는 더 이상 아무것도 열지 않는다
  const founderApproved = false

  if (!slug) {
    console.error('  --slug 가 필요하다')
    process.exit(2)
  }

  const p = plan({ slug, publishAtInput: arg('--publish-at'), founderApproved })
  let applied = null

  if (write && p.verdict === 'READY') {
    const r = applyWrite(p)
    applied = r.ok
    if (!r.ok) {
      p.verdict = 'BLOCKED'
      p.reasons.push(r.why)
    }
  }

  const out = {
    slug: p.slug,
    verdict: p.verdict,
    mode: write ? 'write' : 'dry-run',
    approvalMode: null,
    approvalNote: null,
    applied,
    reasons: p.reasons,
    notes: p.notes,
    checks: p.checks,
  }

  if (asJson) {
    console.log(JSON.stringify(out, null, 2))
  } else {
    console.log('')
    console.log(`  매거진 예약 등록 — ${p.slug}`)
    console.log(`  모드     : ${write ? 'write' : 'dry-run (파일 수정 0건)'}`)
    // 🔴 사람 승인 표기 없음 (M3-A)
    const c = p.checks
    console.log(`  publishAt: ${c.publishAt ?? '-'}`)
    // 🔴 상태 출력도 프로필 기준이다. riskLevel·autoEligible 은 호환 표기로만 남긴다
    console.log(`  큐        : day ${c.queueDay ?? '-'} · image ${c.imageMode ?? '-'}`)
    console.log(`  프로필    : ${(p.notes ?? []).find((n) => n.startsWith('validationProfile=')) ?? '-'}`)
    console.log(`  슬롯      : ${c.slotFree === null ? '-' : c.slotFree ? '비어 있음' : '🔴 차 있음'}`)
    console.log('')
    if (p.verdict === 'READY') {
      if (write && applied) {
        console.log('  ✅ 등록 완료')
        console.log('     articles.ts 에 SCHEDULED 로 추가 · topic-queue.ts 에서 제거')
        // 🔴 사람 승인 경로 없음 (M3-A)
      } else {
        console.log('  ✅ READY — 등록 가능')
        console.log('     변경 예정:')
        console.log(`       src/content/magazine/articles.ts   '${p.slug}' 추가 (status: SCHEDULED)`)
        console.log(`       drafts/magazine/topic-queue.ts     day ${c.queueDay} 제거`)
        console.log('     실제로 쓰려면 --write')
      }
    } else {
      console.log('  ⛔ BLOCKED')
      for (const r of p.reasons) console.log(`     ⛔ ${r}`)
      console.log('')
      console.log('     등록하지 않는다. 파일은 그대로다.')
    }
    console.log('')
  }

  process.exit(p.verdict === 'BLOCKED' ? 1 : 0)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-register.mjs')) main()

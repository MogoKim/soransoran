#!/usr/bin/env node
/**
 * 매거진 일괄 자동 승인 게이트
 *
 * producer 가 선정한 글들을 예약 등록하기 전에, **창업자 검수 없이 나가도 되는지**를
 * 건별로 판정한다. LOW/MEDIUM 자동 승인을 성립시키는 마지막 관문이다.
 *
 * 🔴 이 스크립트가 하지 않는 것
 *    파일을 고치지 않는다 · articles.ts 에 쓰지 않는다 · 예약하지 않는다
 *    LLM 을 호출하지 않는다 · 네트워크를 쓰지 않는다 · 원고를 쓰지 않는다
 *    판정만 하고 끝난다. 등록은 사람(세션)이 한다.
 *
 * 🔴 왜 magazine-qa.mjs 만으로 부족한가
 *    qa 는 **모든 글에 공통인 것**만 잡는다 — 금지 호칭 · 의료 단정 · 형식 · 중복.
 *    "손목터널증후군" 같은 주제별 진단명, "명절은 없어져야" 같은 톤은 잡지 못한다.
 *    그 층을 review.ts 의 forbiddenPatterns 로 받아 여기서 대조한다.
 *
 * 자동 승인 조건 (전부 AND)
 *   ① riskLevel ∈ {LOW, MEDIUM}
 *   ② autoEligible = true
 *   ③ magazine-qa FAIL 0
 *   ④ forbiddenPatterns 위반 0
 *   ⑤ riskSentences 5/5 원고 대조 통과 (MEDIUM/HIGH 필수)
 *   ⑥ imageMode ≠ REQUIRED 또는 hero 존재
 *
 * 사용법
 *   node scripts/magazine-batch-qa.mjs <slug|경로> [...]
 *   node scripts/magazine-batch-qa.mjs --run 2026-08-25   그날 producer 선정분 전체
 *   node scripts/magazine-batch-qa.mjs --all              drafts/magazine 전체
 *   node scripts/magazine-batch-qa.mjs ... --json
 *   node scripts/magazine-batch-qa.mjs --help
 *
 * 종료 코드: BLOCKED 가 하나라도 있으면 1
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, isAbsolute, basename } from 'node:path'
import { runInNewContext } from 'node:vm'
import { loadQueue, sliceLiteral, evalLiteral, DRAFTS_DIR, ROOT } from './lib/magazine-load.mjs'
import { runQa } from './magazine-qa.mjs'

const AUTO_RISK = new Set(['LOW', 'MEDIUM'])
/** 이 등급은 riskSentences 5개가 필수다 (전략 §5.1) */
const RISK_SENTENCES_REQUIRED = new Set(['MEDIUM', 'HIGH'])

// ── 로드 ───────────────────────────────────────────────────

function draftDir(arg) {
  if (isAbsolute(arg)) return arg
  if (arg.includes('/')) return join(ROOT, arg)
  return join(DRAFTS_DIR, arg)
}

function loadDraftBody(dir) {
  const file = join(dir, 'article-draft.ts')
  if (!existsSync(file)) return null
  const src = readFileSync(file, 'utf8')
  const anchor = src.indexOf('export const DRAFT')
  if (anchor === -1) return null
  const literal = sliceLiteral(src, src.indexOf('=', anchor), '{', '}')
  return literal ? evalLiteral(literal, `${basename(dir)}/article-draft.ts`) : null
}

function loadReview(dir) {
  const file = join(dir, 'review.ts')
  if (!existsSync(file)) return null
  const src = readFileSync(file, 'utf8')
  const anchor = src.indexOf('export const REVIEW')
  if (anchor === -1) return null
  const literal = sliceLiteral(src, src.indexOf('=', anchor), '{', '}')
  return literal ? evalLiteral(literal, `${basename(dir)}/review.ts`) : null
}

/** 본문 블록을 한 덩어리 텍스트로. 대조는 여기에 한다. */
function bodyText(article) {
  const out = []
  for (const b of article.body ?? []) {
    if (typeof b.text === 'string') out.push(b.text)
    if (Array.isArray(b.items)) out.push(...b.items)
    if (typeof b.label === 'string') out.push(b.label)
  }
  if (typeof article.title === 'string') out.push(article.title)
  if (typeof article.description === 'string') out.push(article.description)
  return out.join('\n')
}

// ── 판정 ───────────────────────────────────────────────────

export function judge(slug, { dir, queueItem }) {
  const reasons = []
  const notes = []

  const article = loadDraftBody(dir)
  if (!article) {
    return { slug, verdict: 'BLOCKED', reasons: ['article-draft.ts 를 읽지 못했다'], notes, checks: {} }
  }
  const review = loadReview(dir)

  // ① 위험 등급 · ② autoEligible — 큐가 정본이다
  // 등급의 정본은 큐다. 큐에 없으면 review.risk 로 대체하되 출처를 표시한다 —
  // 대체값을 큐 값처럼 보이게 두면 "LOW 인데 NONE 으로 통과했다" 같은 오해가 난다.
  const riskLevel = queueItem?.riskLevel ?? review?.risk?.medical ?? null
  const riskSource = queueItem ? 'queue' : review?.risk ? 'review.risk' : 'none'
  if (!queueItem) {
    notes.push(
      'topic-queue 에 없다 — 이미 등록됐거나 큐 밖에서 만든 글이다. ' +
        '자동 승인 조건 ①riskLevel ②autoEligible 은 검사하지 않았다',
    )
  } else {
    if (!AUTO_RISK.has(queueItem.riskLevel)) reasons.push(`riskLevel=${queueItem.riskLevel} — 창업자 검수 대상`)
    if (queueItem.autoEligible !== true) reasons.push('autoEligible=false — 민감 주제')
  }

  // ③ magazine-qa
  let qaFail = 0
  let qaWarn = 0
  let treatmentWarns = []
  try {
    const qa = runQa({ draftPath: join(dir, 'article-draft.ts') })
    qaFail = qa.fail
    qaWarn = qa.warn
    for (const r of qa.rows) {
      if (r.level === 'FAIL') reasons.push(`QA FAIL: ${r.msg}`)
      // 약·치료 인접어는 WARN 이지만 사람 확인 대상으로 따로 모은다
      if (r.level === 'WARN' && /약·치료 인접어/.test(r.msg)) treatmentWarns.push(r.msg)
    }
  } catch (err) {
    reasons.push(`QA 실행 실패: ${err.message}`)
  }

  // ④ forbiddenPatterns
  const text = bodyText(article)
  const patterns = Array.isArray(review?.forbiddenPatterns) ? review.forbiddenPatterns : null
  const patternHits = []
  if (patterns) {
    for (const p of patterns) {
      if (p && text.includes(p)) patternHits.push(p)
    }
    for (const p of patternHits) reasons.push(`forbiddenPatterns 위반: "${p}"`)
  } else {
    notes.push('forbiddenPatterns 없음 — 주제별 검사를 건너뛴다 (하위 호환)')
  }

  // ⑤ riskSentences
  const needRisk = riskLevel ? RISK_SENTENCES_REQUIRED.has(riskLevel) : false
  const sentences = Array.isArray(review?.riskSentences) ? review.riskSentences : null
  let riskMatched = null
  if (needRisk && !sentences) {
    reasons.push(`${riskLevel} 인데 riskSentences 가 없다 (5개 필수)`)
  } else if (sentences) {
    if (sentences.length !== 5) reasons.push(`riskSentences ${sentences.length}개 — 5개여야 한다`)
    riskMatched = 0
    sentences.forEach((s, i) => {
      if (text.includes(s)) riskMatched += 1
      else reasons.push(`riskSentences ${i + 1} 이 원고에 없다: "${String(s).slice(0, 34)}…"`)
    })
  }

  // ⑥ hero
  const imageMode = queueItem?.imageMode ?? null
  let heroOk = null
  if (imageMode === 'REQUIRED') {
    const src = article.heroImage?.src
    heroOk = Boolean(src) && existsSync(join(ROOT, 'public', src.replace(/^\//, '')))
    if (!heroOk) reasons.push(`imageMode=REQUIRED 인데 hero 가 없다${src ? ` (public${src})` : ''}`)
  }

  return {
    slug,
    verdict: reasons.length ? 'BLOCKED' : 'READY_TO_SCHEDULE',
    reasons,
    notes,
    treatmentWarns,
    checks: {
      riskLevel,
      riskSource,
      autoEligible: queueItem?.autoEligible ?? null,
      qaFail,
      qaWarn,
      forbiddenPatterns: patterns ? patterns.length : null,
      patternHits,
      riskSentences: sentences ? `${riskMatched}/${sentences.length}` : null,
      imageMode,
      heroOk,
    },
  }
}

// ── 입력 수집 ──────────────────────────────────────────────

function fromRun(date) {
  const dir = join(DRAFTS_DIR, '_runs', date, 'selected')
  if (!existsSync(dir)) throw new Error(`_runs/${date}/selected 가 없다`)
  return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory())
}

function allDrafts() {
  return readdirSync(DRAFTS_DIR).filter((n) => {
    if (n.startsWith('_')) return false
    const d = join(DRAFTS_DIR, n)
    return statSync(d).isDirectory() && existsSync(join(d, 'article-draft.ts'))
  })
}

// ── 출력 ───────────────────────────────────────────────────

function help() {
  console.log(`매거진 일괄 자동 승인 게이트

  node scripts/magazine-batch-qa.mjs <slug|경로> [...]
  node scripts/magazine-batch-qa.mjs --run <YYYY-MM-DD>   그날 producer 선정분
  node scripts/magazine-batch-qa.mjs --all                drafts/magazine 전체
  node scripts/magazine-batch-qa.mjs ... --json

자동 승인 조건 (전부 AND)
  ① riskLevel LOW/MEDIUM  ② autoEligible=true  ③ QA FAIL 0
  ④ forbiddenPatterns 위반 0  ⑤ riskSentences 5/5  ⑥ REQUIRED 면 hero 존재

이 스크립트는 파일을 고치지 않는다. 예약도 하지 않는다. 판정만 한다.`)
}

function printHuman(results) {
  console.log('')
  console.log(`매거진 자동 승인 게이트 — ${results.length}건`)
  console.log('')
  for (const r of results) {
    const mark = r.verdict === 'READY_TO_SCHEDULE' ? '✅ READY' : '⛔ BLOCKED'
    console.log(`  ${mark}  ${r.slug}`)
    const c = r.checks
    if (c.riskLevel) {
      console.log(
        `           ${c.riskLevel}${c.riskSource === 'queue' ? '' : `(${c.riskSource})`}` +
          ` · auto=${c.autoEligible ?? '미검사'} · QA F${c.qaFail}/W${c.qaWarn}` +
          ` · 금지패턴 ${c.forbiddenPatterns ?? '없음'}` +
          ` · 위험문장 ${c.riskSentences ?? '-'}` +
          ` · image ${c.imageMode ?? '-'}${c.heroOk === null ? '' : c.heroOk ? '(hero ✅)' : '(hero 없음)'}`,
      )
    }
    for (const reason of r.reasons) console.log(`           ⛔ ${reason}`)
    for (const w of r.treatmentWarns ?? []) console.log(`           ⚠️  ${w}`)
    for (const n of r.notes) console.log(`           ℹ️  ${n}`)
  }
  const ready = results.filter((r) => r.verdict === 'READY_TO_SCHEDULE').length
  const blocked = results.length - ready
  console.log('')
  console.log(`  READY ${ready} · BLOCKED ${blocked}`)
  if (blocked) {
    console.log('')
    console.log('  BLOCKED 는 예약하지 않는다. status: \'BLOCKED\' 로 두거나 원고를 다시 받는다.')
  }
  console.log('')
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) return help()

  const asJson = argv.includes('--json')
  let slugs = []
  if (argv.includes('--run')) {
    slugs = fromRun(argv[argv.indexOf('--run') + 1])
  } else if (argv.includes('--all')) {
    slugs = allDrafts()
  } else {
    slugs = argv.filter((a) => !a.startsWith('--'))
  }
  if (!slugs.length) {
    console.error('  검사할 대상이 없다')
    process.exit(1)
  }

  const queue = loadQueue()
  const bySlug = new Map(queue.map((i) => [i.slug, i]))

  const results = slugs.map((arg) => {
    const dir = draftDir(arg)
    const slug = basename(dir)
    return judge(slug, { dir, queueItem: bySlug.get(slug) })
  })

  if (asJson) console.log(JSON.stringify({ results }, null, 2))
  else printHuman(results)

  process.exit(results.some((r) => r.verdict === 'BLOCKED') ? 1 : 0)
}

main()

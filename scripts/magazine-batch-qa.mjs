#!/usr/bin/env node
/**
 * 매거진 일괄 자동 승인 게이트
 *
 * producer 가 선정한 글들을 예약 등록하기 전에, **사람 없이 나가도 되는지**를
 * 건별로 판정한다. 사람 없이 나가도 되는지를 정하는 마지막 관문이다.
 * 🔴 등급이 아니라 `validationProfile` 별 결정론적 규칙으로 본다 (M3-A).
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
 *   ① validationProfile 이 정해진다 (큐 정본 또는 고정표)
 *   ② 그 프로필의 결정론적 규칙 위반 0 (magazine-profile-qa.mjs)
 *   ③ magazine-qa FAIL 0
 *   ④ forbiddenPatterns 위반 0
 *   ⑤ riskSentences 5/5 원고 대조 통과 (STANDARD 아닌 프로필 필수)
 *   ⑥ imageMode ≠ REQUIRED 또는 hero 존재
 *
 * 자동화 모드(--strict-auto · --run)에서만 더 보는 것
 *   ⑦ 본문 길이 하한/상한 — 목차만 오거나 잘린 응답을 잡는다
 *   ⑧ 거절문 — "죄송하지만" "as an AI" 같은 응답이 그대로 원고가 된 경우
 *   ⑨ 한국어 비율 — 영어로 답했거나 깨진 응답
 *   ⑩ forbiddenPatterns 필수 — 없으면 주제별 위험 검사가 통째로 빠진다
 *
 * 🔴 ⑦~⑩ 은 왜 자동화 모드에만 붙는가
 *    사람이 원고를 훑어보던 단계가 사라질 때 생기는 구멍이다.
 *    세션이 손으로 만든 기존 글은 그 단계를 이미 거쳤으므로 회귀 검사에서는 켜지 않는다.
 *
 * 사용법
 *   node scripts/magazine-batch-qa.mjs <slug|경로> [...]
 *   node scripts/magazine-batch-qa.mjs --run 2026-08-25   그날 producer 선정분 전체
 *   node scripts/magazine-batch-qa.mjs --all              drafts/magazine 전체
 *   node scripts/magazine-batch-qa.mjs ... --json
  node scripts/magazine-batch-qa.mjs ... --strict-auto   자동화 검사(⑦~⑩) 강제
  node scripts/magazine-batch-qa.mjs ... --require-hero  🔴 imageMode 와 무관하게 대표 이미지 필수
 *   node scripts/magazine-batch-qa.mjs --help
 *
 * 종료 코드: BLOCKED 가 하나라도 있으면 1
 */
import { judgeForbidden } from './lib/magazine-forbidden.mjs'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join, isAbsolute, basename } from 'node:path'
import { runInNewContext } from 'node:vm'
import { loadQueue, sliceLiteral, evalLiteral, DRAFTS_DIR, ROOT } from './lib/magazine-load.mjs'
import { runQa } from './magazine-qa.mjs'
import { isAutoLaneEligible } from './lib/magazine-validation-profile.mjs'
import { runProfileQA } from './lib/magazine-profile-qa.mjs'

// 🔴 AUTO_RISK 제거 (M3-A · SUPERSEDED) — 등급으로 승인을 가르지 않는다

/**
 * 본문 길이 — 기존 공개·예약 13건 실측이 1294~2028자다.
 * 하한을 실측 최소에 붙이면 정상 글이 걸린다. 800 은 "명백히 잘렸다"만 잡는 자리다.
 * (magazine-qa 의 1200~2500 은 WARN 이고 그대로 둔다. 여기 것은 BLOCKED 다)
 */
const AUTO_BODY_MIN = 800
const AUTO_BODY_MAX = 3000

/** 한국어 비율 — 실측 89.2~95.0%. 60% 면 29%p 여유이고 영어 답변(5~10%)과는 확실히 갈린다 */
const AUTO_KO_RATIO_MIN = 0.6

/** 응답이 그대로 원고가 된 경우. 사람이 봤다면 즉시 알아챘을 것들이다 */
const REFUSAL_PATTERNS = [
  '죄송하지만',
  '도와드릴 수 없',
  '답변드릴 수 없',
  '제공할 수 없습니다',
  '의료 전문가와 상담',
  'as an AI',
  "I can't",
  'I cannot',
  "I'm unable",
  'I apologize',
  'language model',
]
// 🔴 RISK_SENTENCES_REQUIRED 제거 (M3-A · SUPERSEDED)
//    옛 판은 riskLevel 로 위험 문장 필수 여부를 정했다. 지금은 validationProfile 이 정한다.

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

export function judge(slug, { dir, queueItem, strictAuto = false, requireHero = false }) {
  const reasons = []
  const notes = []
  /** BLOCKED 사유를 코드로도 남긴다 — 사람은 message 를, 자동화는 code 를 본다 */
  const blockedBy = []
  const block = (code, message) => {
    blockedBy.push({ code, message })
    reasons.push(message)
  }

  const article = loadDraftBody(dir)
  if (!article) {
    return {
      slug, verdict: 'BLOCKED',
      reasons: ['article-draft.ts 를 읽지 못했다'],
      blockedBy: [{ code: 'DRAFT_UNREADABLE', message: 'article-draft.ts 를 읽지 못했다' }],
      notes, checks: {},
    }
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
        'validationProfile 을 정할 정본이 없어 프로필 검사를 하지 않았다',
    )
  } else {
    /**
     * 🔴 **riskLevel·autoEligible 로 막지 않는다** (M3-A).
     *    프로필을 정해 그 프로필의 결정론적 규칙으로 검사한다.
     */
    const lane = isAutoLaneEligible(queueItem)
    if (!lane.ok) block(lane.code, lane.why)
    else {
      const pq = runProfileQA({ profile: lane.profile, title: article?.title ?? '',
        bodyText: bodyText(article), sources: article?.sources ?? review?.sources ?? [] })
      for (const f of pq.failures) block(f.code, `${f.label}: "${f.sentence}"`)
    }
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
      if (r.level === 'FAIL') block('QA_FAIL', `QA FAIL: ${r.msg}`)
      // 약·치료 인접어는 WARN 이지만 사람 확인 대상으로 따로 모은다
      if (r.level === 'WARN' && /약·치료 인접어/.test(r.msg)) treatmentWarns.push(r.msg)
    }
  } catch (err) {
    block('QA_ERROR', `QA 실행 실패: ${err.message}`)
  }

  // ④ forbiddenPatterns
  const text = bodyText(article)
  const patterns = Array.isArray(review?.forbiddenPatterns) ? review.forbiddenPatterns : null
  const patternHits = []
  if (patterns) {
    // 🔴 **글자가 아니라 뜻으로 본다** (2026-09-17).
    //    `낫습니다` 는 "(병이) 낫습니다"(완치 주장)를 막으려는 것인데,
    //    "~하는 편이 낫습니다" 라는 일상 비교 표현과 글자가 같다.
    //    목록에서 빼지 않는다 — 빼면 "갱년기가 낫습니다" 가 통과한다.
    //    비교 구문 표지가 바로 앞에 있을 때만, 미리 적어 둔 동형이의에 한해 면제한다.
    const fv = judgeForbidden(text, patterns)
    for (const v of fv.violations) {
      patternHits.push(v.pattern)
      const where = v.samples.length > 0 ? ` — "…${v.samples[0]}…"` : ''
      block('FORBIDDEN_PATTERN', `forbiddenPatterns 위반: "${v.pattern}"${where}`)
    }
    // 🔴 면제도 기록에 남긴다. 조용히 넘어가면 관문이 열린 줄도 모른다.
    for (const e of fv.exempted) notes.push(`forbiddenPatterns "${e.pattern}" ${e.count}회는 비교 표현으로 면제 (완치 주장 아님)`)
  } else {
    notes.push('forbiddenPatterns 없음 — 주제별 검사를 건너뛴다 (하위 호환)')
  }

  // ⑤ riskSentences
  /**
   * 🔴 **위험 문장 요구도 등급이 아니라 프로필이 정한다** (M3-A).
   *    riskLevel 은 호환 필드로만 남는다.
   */
  const laneForRisk = isAutoLaneEligible(queueItem ?? {})
  const needRisk = laneForRisk.ok && laneForRisk.profile !== 'STANDARD'
  const sentences = Array.isArray(review?.riskSentences) ? review.riskSentences : null
  let riskMatched = null
  if (needRisk && !sentences) {
    block('RISK_SENTENCES_MISSING', `${laneForRisk.profile} 인데 riskSentences 가 없다 (5개 필수)`)
  } else if (sentences) {
    if (sentences.length !== 5) block('RISK_SENTENCES_COUNT', `riskSentences ${sentences.length}개 — 5개여야 한다`)
    riskMatched = 0
    sentences.forEach((s, i) => {
      if (text.includes(s)) riskMatched += 1
      else block('RISK_SENTENCE_ABSENT', `riskSentences ${i + 1} 이 원고에 없다: "${String(s).slice(0, 34)}…"`)
    })
  }

  // ⑥ hero
  /**
   * 🔴 **`requireHero` 면 imageMode 를 보지 않는다** (2026-09-21 사고).
   *
   *    옛 판은 `imageMode === 'REQUIRED'` 일 때만 hero 를 봤다. 그래서
   *    `OPTIONAL` 인 글은 이 검사를 **통째로 건너뛰었고**, 9/19~9/26 등록 8건이
   *    전부 대표 이미지 없이 나갔다.
   *
   *    자동 등록 경로에는 "이미지를 뺄지" 판단할 사람이 없다.
   *    그 자리에서 OPTIONAL 은 언제나 "없음" 으로 굳는다.
   */
  const imageMode = queueItem?.imageMode ?? null
  let heroOk = null
  if (requireHero || imageMode === 'REQUIRED') {
    const src = article.heroImage?.src
    heroOk = Boolean(src) && existsSync(join(ROOT, 'public', src.replace(/^\//, '')))
    if (!heroOk) {
      block('HERO_MISSING', src
        ? `대표 이미지 파일이 없다 (public${src})`
        : `대표 이미지가 없다 — ${requireHero ? '자동 등록 경로는 imageMode 와 무관하게 필수다' : `imageMode=${imageMode}`}`)
    }
  }

  // ⑦~⑩ 자동화 모드 전용 — 사람이 원고를 훑어보던 단계가 사라질 때 생기는 구멍
  const koCount = (text.match(/[가-힣]/g) ?? []).length
  const latinCount = (text.match(/[A-Za-z]/g) ?? []).length
  const koRatio = koCount + latinCount === 0 ? 0 : koCount / (koCount + latinCount)
  const refusalHits = REFUSAL_PATTERNS.filter((r) => text.includes(r))

  if (strictAuto) {
    // ⑦ 길이 — 목차만 왔거나 중간에 잘린 응답
    if (text.length < AUTO_BODY_MIN) {
      block('BODY_TOO_SHORT', `본문 ${text.length}자 — ${AUTO_BODY_MIN}자 미만이면 잘린 응답으로 본다`)
    } else if (text.length > AUTO_BODY_MAX) {
      block('BODY_TOO_LONG', `본문 ${text.length}자 — ${AUTO_BODY_MAX}자를 넘었다`)
    }

    // ⑧ 거절문이 그대로 원고가 된 경우
    for (const r of refusalHits) block('REFUSAL_TEXT', `거절문/정형구가 원고에 있다: "${r}"`)

    // ⑨ 영어로 답했거나 깨진 응답
    if (koRatio < AUTO_KO_RATIO_MIN) {
      block('NOT_KOREAN', `한국어 비율 ${(koRatio * 100).toFixed(1)}% — ${AUTO_KO_RATIO_MIN * 100}% 미만`)
    }

    // ⑩ forbiddenPatterns 필수 — 없으면 주제별 위험 검사가 통째로 빠진다
    if (!patterns || patterns.length === 0) {
      block('FORBIDDEN_PATTERNS_ABSENT', 'review.ts 에 forbiddenPatterns 가 없다 — 자동화에서는 필수다')
    }
  } else if (!patterns || patterns.length === 0) {
    notes.push('forbiddenPatterns 없음 — 자동화 모드(--strict-auto)에서는 BLOCKED 다')
  }

  return {
    slug,
    verdict: reasons.length ? 'BLOCKED' : 'READY_TO_SCHEDULE',
    strictAuto,
    reasons,
    blockedBy,
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
      bodyLength: text.length,
      koRatio: Number(koRatio.toFixed(3)),
      refusalHits,
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
  ① validationProfile 확정  ② 프로필 규칙 위반 0  ③ QA FAIL 0
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
  // --run 은 producer 산출물이다 = 자동화 경로다. 자동으로 엄격해진다
  const strictAuto = argv.includes('--strict-auto') || argv.includes('--run')
  // 🔴 자동 등록 경로는 imageMode 와 무관하게 대표 이미지를 요구한다 (2026-09-21 사고)
  const requireHero = argv.includes('--require-hero')
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
    return judge(slug, { dir, queueItem: bySlug.get(slug), strictAuto, requireHero })
  })

  if (asJson) console.log(JSON.stringify({ results }, null, 2))
  else printHuman(results)

  process.exit(results.some((r) => r.verdict === 'BLOCKED') ? 1 : 0)
}

main()

#!/usr/bin/env node
/**
 * auto-brief — brief.todo.md 의 TODO 6개를 채워 brief 후보를 만든다
 *
 * 🔴 기본이 dry-run 이다. 이 스크립트는 **아무 파일도 쓰지 않는다.**
 *    stdout 으로 생성 결과와 게이트 판정만 보여준다.
 *    정본 승격(drafts/magazine/{slug}/)은 이 PR 범위가 아니다.
 *
 * 🔴 왜 ChatGPT 가 아니라 claude 인가 (§13.1)
 *    "원고를 쓰지 않는 Claude" → 지시서 · ChatGPT → 원고. 이 분리가 §13.1 이다.
 *    brief 를 ChatGPT 에 맡기면 "위험하다고 판단한 문장은 애초에 안 썼을" 것이므로
 *    검수 자료가 자기 검열의 결과물이 된다(runbook §3).
 *    그래서 지시서는 Claude 계열이 만들고, 원고만 ChatGPT 가 받는다.
 *
 * 🔴 도구를 주지 않는다
 *    --disallowed-tools 로 파일 접근을 막고, 필요한 사실은 전부 프롬프트에 넣는다.
 *    생성기가 repo 를 건드릴 수 있으면 dry-run 이라는 말이 성립하지 않는다.
 *
 * 사용법
 *   node scripts/magazine-brief-auto.mjs --run 2026-08-26          그날 선정분 전부
 *   node scripts/magazine-brief-auto.mjs --run 2026-08-26 --slug fewer-friends-50s
 *   node scripts/magazine-brief-auto.mjs --run 2026-08-26 --json
 *   node scripts/magazine-brief-auto.mjs --run 2026-08-26 --prompt-only   호출 없이 프롬프트만
 *
 * 종료 코드: 게이트를 통과하지 못한 건이 있으면 1
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DRAFTS_DIR, loadArticles, loadQueue } from './lib/magazine-load.mjs'
import {
  BANNED_WORDS,
  BLOCKED_RISK_LEVELS,
  MEDICAL_ASSERTIONS,
  MEDICAL_REFERRAL_HINTS,
  MONEY_ASSERTION_SEEDS,
  MONEY_REFERRAL_HINTS,
  REQUIRED_SECTIONS,
  RISK_SENTENCE_COUNT,
  assertQaWordsInSync,
  verifyBrief,
} from './lib/magazine-brief-policy.mjs'

const RUNS_DIR = join(DRAFTS_DIR, '_runs')
const BRIEF_MARK = '===BRIEF==='
const REVIEW_MARK = '===REVIEW==='

/**
 * 한 건이 오래 걸려도 다음 건을 막지 않는다.
 * 5분으로 뒀더니 첫 dry-run 에서 한 건이 ETIMEDOUT 으로 떨어졌다 — 넉넉히 둔다.
 */
const TIMEOUT_MS = 12 * 60 * 1000

// ─────────────────────────────────────────────────────────
// 프롬프트
// ─────────────────────────────────────────────────────────

/** 같은 cluster 의 기존 글 — 중복 회피 재료 */
function siblingArticles(cluster, articles) {
  return articles
    .filter((a) => a.cluster === cluster)
    .map((a) => `- \`${a.slug}\` — ${a.title}`)
}

function buildPrompt({ slug, todoText, queueItem, articles }) {
  const cluster = queueItem?.cluster ?? '-'
  const siblings = siblingArticles(cluster, articles)

  return `당신은 소란소란 매거진의 **원고 지시서(brief)** 를 쓴다. 원고를 쓰지 않는다.

# 무엇을 만드는가

아래 "작업 패키지" 의 TODO 6개를 채운 완성 brief.md 와, 그 짝인 review.ts 를 만든다.

# 지켜야 할 것

1. brief.md 에는 아래 h2 가 **정확히 이 이름으로** 있어야 한다.
${REQUIRED_SECTIONS.map((s) => `   - \`## ${s}\``).join('\n')}
   "반드시 그대로 넣을 문장" 섹션은 자동 회수기가 문자열로 찾는 자리다. 이름을 바꾸지 않는다.

2. "반드시 그대로 넣을 문장" 은 정확히 ${RISK_SENTENCE_COUNT}개다.
   코드블록 안에 \`1. \` ~ \`${RISK_SENTENCE_COUNT}. \` 번호를 붙여 한 줄씩 쓴다.
   이 ${RISK_SENTENCE_COUNT}개를 review.ts 의 riskSentences 에 **토씨 하나 다르지 않게** 그대로 옮긴다.

3. 🔴 그 ${RISK_SENTENCE_COUNT}개 문장에 아래 단어가 **하나도 들어가면 안 된다.**
   - 공통 금지: ${[...BANNED_WORDS, ...MEDICAL_ASSERTIONS].map((w) => `"${w}"`).join(' ')}
   - 그리고 당신이 review.ts 의 forbiddenPatterns 에 적을 단어들
   (실제로 "절대 쓰지 말 것"에 넣은 단어를 "반드시 넣을 문장"에도 써서 원고가 통째로 막힌 적이 있다)

4. review.ts 의 forbiddenPatterns 는 **비울 수 없다.**
   이 주제에서만 위험한 진단명·제품군·단정 표현을 구체적인 단어로 적는다.

5. 안전 문장
   - 의료 위험이 MEDIUM 이상이면 ${RISK_SENTENCE_COUNT}개 중 하나는 진료 확인 권고여야 한다.
     (${MEDICAL_REFERRAL_HINTS.map((h) => `"${h}"`).join(' ')} 중 한 단어가 들어가게)
   - 재무 위험이 MEDIUM 이상이면 하나는 공식 기관 확인 권고여야 한다.
     (${MONEY_REFERRAL_HINTS.map((h) => `"${h}"`).join(' ')} 중 한 단어가 들어가게)
     그리고 ${MONEY_ASSERTION_SEEDS.map((w) => `"${w}"`).join(' ')} 같은 단정 표현을 forbiddenPatterns 에 넣는다.

6. 🔴 review.ts 의 risk 를 스스로 낮추지 않는다.
   큐가 정한 이 글의 riskLevel 은 **${queueItem?.riskLevel ?? '미상'}** 이다.
   MEDIUM 이상이면 risk 의 medical·money·legal 중 최소 하나를 MEDIUM 이상으로 적고,
   그 축에 맞는 확인 권고 문장을 ${RISK_SENTENCE_COUNT}개 안에 넣는다.

7. 진단·치료·효과를 단정하지 않는다. "이야기됩니다" "사람마다 다릅니다" 수준으로 쓴다.

8. TODO 주석을 남기지 않는다. \`<!-- TODO\` 가 하나라도 남으면 실패다.

# 이미 나온 글 (같은 cluster: ${cluster})

${siblings.length ? siblings.join('\n') : '- 없음 (이 cluster 첫 글)'}

위 글과 **다루는 범위가 겹치지 않게** 한다.
brief 의 "글 구조" 에 무엇을 이 글에서 다루지 않는지 명시한다.

# 작업 패키지 (producer 가 만든 초안)

${todoText}

# 출력 형식

설명 없이 아래 두 블록만 낸다.

${BRIEF_MARK}
(brief.md 전문. 위 작업 패키지의 "공통 규칙" 을 그대로 포함하고 TODO 를 채운 것)
${REVIEW_MARK}
(review.ts 전문. \`import type { ReviewData } from '../_template/review'\` 로 시작하고
 \`export const REVIEW: ReviewData = { ... }\` 를 내보낸다.
 slug 는 '${slug}' 다. preparedBy 는 'Claude Code' 다.)
`
}

// ─────────────────────────────────────────────────────────
// 생성
// ─────────────────────────────────────────────────────────

function callClaude(prompt, { model }) {
  const args = ['-p', '--output-format', 'text']
  if (model) args.push('--model', model)
  // 파일을 만지지 못하게 한다. 필요한 사실은 프롬프트에 다 있다.
  args.push('--disallowed-tools', 'Bash Edit Write Read Glob Grep NotebookEdit WebFetch WebSearch')

  const r = spawnSync('claude', args, {
    input: prompt,
    encoding: 'utf8',
    timeout: TIMEOUT_MS,
    maxBuffer: 20 * 1024 * 1024,
  })

  if (r.error) return { ok: false, reason: `claude 실행 실패: ${r.error.code ?? r.error.message}` }
  if (r.status !== 0) return { ok: false, reason: `claude 종료 코드 ${r.status}: ${String(r.stderr).slice(0, 200)}` }
  const out = String(r.stdout ?? '')
  if (!out.trim()) return { ok: false, reason: '빈 응답' }
  return { ok: true, text: out }
}

function splitOutput(text) {
  const bi = text.indexOf(BRIEF_MARK)
  const ri = text.indexOf(REVIEW_MARK)
  if (bi === -1 || ri === -1 || ri < bi) {
    return { ok: false, reason: `출력 형식이 다르다 — ${BRIEF_MARK}/${REVIEW_MARK} 를 찾지 못했다` }
  }
  const strip = (s) =>
    s
      .replace(/^\s*```(?:markdown|md|ts|typescript)?\s*$/gm, '')
      .trim()
  return {
    ok: true,
    briefText: strip(text.slice(bi + BRIEF_MARK.length, ri)),
    reviewText: strip(text.slice(ri + REVIEW_MARK.length)),
  }
}

/** 생성된 review.ts 문자열에서 REVIEW 객체를 꺼낸다 (파일로 쓰지 않는다) */
function parseReview(reviewText) {
  const anchor = reviewText.indexOf('export const REVIEW')
  if (anchor === -1) return null
  const start = reviewText.indexOf('{', anchor)
  if (start === -1) return null
  let depth = 0
  for (let i = start; i < reviewText.length; i++) {
    if (reviewText[i] === '{') depth++
    else if (reviewText[i] === '}') {
      depth--
      if (depth === 0) {
        try {
          // eslint-disable-next-line no-new-func
          return Function(`"use strict"; return (${reviewText.slice(start, i + 1)})`)()
        } catch {
          return null
        }
      }
    }
  }
  return null
}

// ─────────────────────────────────────────────────────────

function help() {
  console.log(`auto-brief (dry-run 전용 — 파일을 쓰지 않는다)

  node scripts/magazine-brief-auto.mjs --run YYYY-MM-DD        (--date 도 같다)
  node scripts/magazine-brief-auto.mjs --run YYYY-MM-DD --slug <slug>
  node scripts/magazine-brief-auto.mjs --run YYYY-MM-DD --prompt-only
  ... --json  --model <alias>

🔴 이 스크립트는 정본(drafts/magazine/{slug}/)을 만들지 않는다.
   생성 결과와 게이트 판정을 stdout 으로만 보여준다.`)
}

async function main() {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv.includes('--help')) return help()

  const arg = (name) => {
    const i = argv.indexOf(name)
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : null
  }
  // --date 는 --run 의 별칭이다. notify 는 --date, batch-qa 는 --run 을 쓴다 —
  // 둘 다 받아 준다. 운영자가 어느 쪽을 적든 돌아야 한다.
  const date = arg('--run') ?? arg('--date')
  if (!date) {
    console.error('  --run YYYY-MM-DD (또는 --date) 가 필요하다.')
    process.exit(2)
  }
  const onlySlug = arg('--slug')
  const promptOnly = argv.includes('--prompt-only')
  // --dry-run 은 이 스크립트의 유일한 모드다. 적어도 동작하고, 적지 않아도 같다.
  // 쓰기 모드가 생기기 전까지 이 플래그는 의미를 바꾸지 않는다.
  const asJson = argv.includes('--json')
  const model = arg('--model')

  assertQaWordsInSync()

  const selDir = join(RUNS_DIR, date, 'selected')
  if (!existsSync(selDir)) {
    console.error(`  ${selDir} 이 없다.`)
    process.exit(2)
  }

  const queueBySlug = new Map(loadQueue().map((x) => [x.slug, x]))
  const articles = loadArticles()
  const slugs = readdirSync(selDir).filter((s) => !onlySlug || s === onlySlug)

  const reports = []

  for (const slug of slugs) {
    const todoPath = join(selDir, slug, 'brief.todo.md')
    const queueItem = queueBySlug.get(slug) ?? null

    if (!existsSync(todoPath)) {
      reports.push({ slug, status: 'NO_TODO', detail: 'brief.todo.md 가 없다' })
      continue
    }
    if (queueItem && BLOCKED_RISK_LEVELS.includes(queueItem.riskLevel)) {
      reports.push({ slug, status: 'HOLD', detail: `riskLevel=${queueItem.riskLevel} — 창업자 검수 대상` })
      continue
    }

    const prompt = buildPrompt({
      slug,
      todoText: readFileSync(todoPath, 'utf8'),
      queueItem,
      articles,
    })

    if (promptOnly) {
      reports.push({ slug, status: 'PROMPT_ONLY', promptLength: prompt.length, prompt })
      continue
    }

    const called = callClaude(prompt, { model })
    if (!called.ok) {
      reports.push({ slug, status: 'GEN_FAILED', detail: called.reason })
      continue
    }

    const split = splitOutput(called.text)
    if (!split.ok) {
      reports.push({ slug, status: 'GEN_FAILED', detail: split.reason })
      continue
    }

    const review = parseReview(split.reviewText)
    if (!review) {
      reports.push({ slug, status: 'GEN_FAILED', detail: 'review.ts 에서 REVIEW 객체를 읽지 못했다' })
      continue
    }

    const { ok, results } = verifyBrief({ briefText: split.briefText, review, queueItem })
    reports.push({
      slug,
      status: ok ? 'PASS' : 'GATE_FAILED',
      results,
      briefText: split.briefText,
      reviewText: split.reviewText,
    })
  }

  if (asJson) {
    console.log(JSON.stringify({ date, total: reports.length, reports }, null, 2))
  } else {
    console.log('')
    console.log(`  auto-brief dry-run — ${date}  (파일을 쓰지 않는다)`)
    console.log('')
    for (const r of reports) {
      const mark = r.status === 'PASS' ? '✅' : r.status === 'HOLD' ? '⏸' : '🔴'
      console.log(`  ${mark} ${r.slug}  ${r.status}${r.detail ? ` — ${r.detail}` : ''}`)
      for (const g of r.results ?? []) {
        console.log(`       ${g.ok ? '·' : '🔴'} ${g.gate}  ${g.detail}`)
      }
      if (r.promptLength) console.log(`       프롬프트 ${r.promptLength}자`)
      if (r.briefText) {
        console.log(`       brief ${r.briefText.length}자 · review ${r.reviewText.length}자`)
      }
      console.log('')
    }
    const pass = reports.filter((r) => r.status === 'PASS').length
    console.log(`  PASS ${pass} / ${reports.length}`)
    console.log('')
  }

  process.exit(reports.some((r) => r.status === 'GATE_FAILED' || r.status === 'GEN_FAILED') ? 1 : 0)
}

main()

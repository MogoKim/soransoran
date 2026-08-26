#!/usr/bin/env node
/**
 * auto-brief — brief.todo.md 의 TODO 6개를 채워 brief 후보를 만든다
 *
 * 🔴 기본이 dry-run 이다. --write 를 명시하지 않으면 아무 파일도 쓰지 않는다.
 *
 * 🔴 --write 의 안전장치 (전부 코드다. 순서를 지킨다)
 *    ① verifyBrief() 가 G1~G6 를 전부 통과해야 쓴다. 판정 전에는 한 글자도 안 쓴다
 *    ② HIGH 는 생성 자체를 하지 않는다 (큐가 창업자 검수 대상으로 표시한 등급)
 *    ③ brief.md 나 review.ts 가 이미 있으면 **덮어쓰지 않고 건너뛴다**
 *       사람이 쓴 지시서를 기계가 지우는 일은 없어야 한다
 *    ④ 쓴 뒤 디스크에서 다시 읽어 검증한다. 통과 못 하면 실패로 보고한다
 *    ⑤ 한 건이 실패해도 나머지는 계속한다. 재고 확보가 목적이다
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
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
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

# 출력 형식 — 🔴 이것만은 반드시 지킨다

응답 전체는 아래 두 마커로만 나뉜다. 마커는 **줄 맨 앞에 단독으로** 놓는다.

${BRIEF_MARK}
(brief.md 전문. 위 작업 패키지의 "공통 규칙" 을 그대로 포함하고 TODO 를 채운 것)
${REVIEW_MARK}
(review.ts 전문. \`import type { ReviewData } from '../_template/review'\` 로 시작하고
 \`export const REVIEW: ReviewData = { ... }\` 를 내보낸다.
 slug 는 '${slug}' 다. preparedBy 는 'Claude Code' 다.)

🔴 마커 규칙 — 어기면 결과가 통째로 버려진다

- 첫 줄이 \`${BRIEF_MARK}\` 다. 그 앞에 인사·설명·요약·"알겠습니다" 를 쓰지 않는다.
- \`${REVIEW_MARK}\` 는 정확히 한 번, 줄 단독으로 놓는다.
- 마커를 코드펜스(\`\`\`) 로 감싸지 않는다. 응답 전체를 코드펜스로 감싸지도 않는다.
- 마커 뒤에 맺음말을 붙이지 않는다. review.ts 의 마지막 \`}\` 로 응답이 끝난다.

🔴 길어질 것 같으면 **내용을 줄인다. 마커를 생략하지 않는다.**
  h2 설명을 짧게 쓰고 예시를 덜 들어도 된다.
  두 마커가 다 있는 짧은 brief 는 쓸 수 있지만,
  마커가 빠진 긴 brief 는 파싱 단계에서 버려져 아무 값도 남지 않는다.
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
// 쓰기 — 게이트를 통과한 뒤에만 부른다
// ─────────────────────────────────────────────────────────

/**
 * 이미 있는 산출물을 찾는다. 하나라도 있으면 쓰지 않는다.
 *
 * 🔴 덮어쓰기를 하지 않는 이유
 *    brief.md 는 사람이 손으로 쓴 것일 수 있다. review.ts 도 마찬가지다.
 *    기계가 그것을 지우면 되돌릴 방법이 없다. 있으면 비켜간다.
 */
function existingArtifacts(dir) {
  return ['brief.md', 'review.ts'].filter((n) => existsSync(join(dir, n)))
}

/**
 * brief.md · review.ts 를 쓴다. **verifyBrief 가 통과한 뒤에만 불린다.**
 * 쓴 뒤 디스크에서 다시 읽어 한 번 더 검증한다 — 쓰는 도중 깨졌을 수 있다.
 */
function writeArtifacts({ dir, briefText, reviewText, queueItem }) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'brief.md'), briefText.endsWith('\n') ? briefText : briefText + '\n', 'utf8')
  writeFileSync(join(dir, 'review.ts'), reviewText.endsWith('\n') ? reviewText : reviewText + '\n', 'utf8')

  // 되읽어 검증. 여기서 실패하면 파일은 남지만 결과는 실패로 보고한다 —
  // 조용히 성공으로 넘기면 fetch 가 깨진 brief 를 ChatGPT 에 보낸다.
  const backBrief = readFileSync(join(dir, 'brief.md'), 'utf8')
  const backReview = parseReview(readFileSync(join(dir, 'review.ts'), 'utf8'))
  return verifyBrief({ briefText: backBrief, review: backReview, queueItem })
}

// ─────────────────────────────────────────────────────────

function help() {
  console.log(`auto-brief (dry-run 전용 — 파일을 쓰지 않는다)

  node scripts/magazine-brief-auto.mjs --run YYYY-MM-DD        (--date 도 같다)
  node scripts/magazine-brief-auto.mjs --run YYYY-MM-DD --slug <slug>
  node scripts/magazine-brief-auto.mjs --run YYYY-MM-DD --prompt-only
  ... --json  --model <alias>

🔴 --write 가 없으면 아무 파일도 쓰지 않는다.
🔴 --write 여도 G1~G6 를 통과한 건만 쓴다.
🔴 brief.md 나 review.ts 가 이미 있으면 덮어쓰지 않고 건너뛴다.`)
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
  const write = argv.includes('--write')
  // 격리 디렉터리로 돌릴 수 있어야 --write 를 실제 정본 밖에서 검증할 수 있다
  const outDir = arg('--out-dir') ?? DRAFTS_DIR

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

    // 🔴 이미 있으면 손대지 않는다. 생성도 하지 않는다 — 어차피 쓸 수 없으니 호출도 낭비다.
    const targetDir = join(outDir, slug)
    const existing = existingArtifacts(targetDir)
    if (write && existing.length) {
      reports.push({ slug, status: 'SKIP_EXISTS', detail: `이미 있다: ${existing.join(', ')} — 덮어쓰지 않는다` })
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

    // 🔴 한 번 더 시도한다.
    //    실측 성공률이 회차마다 1/3 ~ 3/3 으로 흔들린다. 형식 이탈·섹션 누락이
    //    대부분이고 같은 프롬프트로 다시 받으면 붙는다. 무인 실행에서 한 번 흔들렸다고
    //    그날 그 slug 의 brief 가 통째로 없어지면 안 된다.
    //    2회로 묶는다 — 더 늘리면 실패를 성공할 때까지 갈아 넣는 구조가 된다.
    const MAX_ATTEMPTS = 2
    let attempt = 0
    let split = null
    let review = null
    let verdict = null
    let lastReason = ''

    while (attempt < MAX_ATTEMPTS) {
      attempt++
      const called = callClaude(prompt, { model })
      if (!called.ok) {
        lastReason = called.reason
        continue
      }
      const parts = splitOutput(called.text)
      if (!parts.ok) {
        lastReason = parts.reason
        continue
      }
      const rv = parseReview(parts.reviewText)
      if (!rv) {
        lastReason = 'review.ts 에서 REVIEW 객체를 읽지 못했다'
        continue
      }
      const v = verifyBrief({ briefText: parts.briefText, review: rv, queueItem })
      split = parts
      review = rv
      verdict = v
      if (v.ok) break
      lastReason = v.results.filter((r) => !r.ok).map((r) => `${r.gate} ${r.detail}`).join(' · ')
    }

    if (!split || !review || !verdict) {
      reports.push({ slug, status: 'GEN_FAILED', detail: `${MAX_ATTEMPTS}회 시도 실패 — ${lastReason}`, attempts: attempt })
      continue
    }

    const { ok, results } = verdict

    // 🔴 게이트가 먼저다. 통과하지 못하면 --write 여도 쓰지 않는다.
    if (!ok) {
      reports.push({ slug, status: 'GATE_FAILED', results, attempts: attempt, briefText: split.briefText, reviewText: split.reviewText })
      continue
    }

    if (!write) {
      reports.push({ slug, status: 'PASS', results, briefText: split.briefText, reviewText: split.reviewText })
      continue
    }

    const back = writeArtifacts({
      dir: targetDir,
      briefText: split.briefText,
      reviewText: split.reviewText,
      queueItem,
    })
    reports.push({
      slug,
      status: back.ok ? 'WRITTEN' : 'WRITE_VERIFY_FAILED',
      results: back.results,
      writtenTo: targetDir,
      briefText: split.briefText,
      reviewText: split.reviewText,
    })
  }

  if (asJson) {
    console.log(JSON.stringify({ date, total: reports.length, reports }, null, 2))
  } else {
    console.log('')
    console.log(
      `  auto-brief — ${date}  ` +
        (write ? `(--write · 게이트 통과분만 ${outDir} 에 쓴다)` : '(dry-run · 파일을 쓰지 않는다)'),
    )
    console.log('')
    for (const r of reports) {
      const mark =
        r.status === 'PASS' || r.status === 'WRITTEN'
          ? '✅'
          : r.status === 'HOLD' || r.status === 'SKIP_EXISTS'
            ? '⏸'
            : '🔴'
      console.log(`  ${mark} ${r.slug}  ${r.status}${r.detail ? ` — ${r.detail}` : ''}`)
      for (const g of r.results ?? []) {
        console.log(`       ${g.ok ? '·' : '🔴'} ${g.gate}  ${g.detail}`)
      }
      if (r.promptLength) console.log(`       프롬프트 ${r.promptLength}자`)
      if (r.briefText) {
        console.log(`       brief ${r.briefText.length}자 · review ${r.reviewText.length}자`)
      }
      if (r.attempts > 1) console.log(`       시도 ${r.attempts}회`)
      if (r.writtenTo) console.log(`       썼다: ${r.writtenTo}`)
      console.log('')
    }
    const pass = reports.filter((r) => r.status === 'PASS' || r.status === 'WRITTEN').length
    const written = reports.filter((r) => r.status === 'WRITTEN').length
    const skipped = reports.filter((r) => r.status === 'SKIP_EXISTS' || r.status === 'HOLD').length
    console.log(`  통과 ${pass} / ${reports.length}` + (write ? ` · 쓴 것 ${written} · 건너뜀 ${skipped}` : ''))
    console.log('')
  }

  // 실패가 하나라도 있으면 1. SKIP_EXISTS · HOLD 는 실패가 아니다 — 의도된 비켜감이다.
  const failed = reports.some((r) =>
    ['GATE_FAILED', 'GEN_FAILED', 'WRITE_VERIFY_FAILED', 'NO_TODO'].includes(r.status),
  )
  process.exit(failed ? 1 : 0)
}

main()

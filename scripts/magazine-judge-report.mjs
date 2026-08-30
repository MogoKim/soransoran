#!/usr/bin/env node
/**
 * 검수 리포트 — PASS / FAIL / UNKNOWN (M-AUTO-3)
 *
 * 창업자가 **원고 전문을 읽는 사람**에서 **UNKNOWN 두세 개를 확인하는 사람**으로
 * 옮겨가기 위한 자리다.
 *
 *   PASS      기계가 "기준을 만족한다" 고 말할 수 있다
 *   FAIL      기계가 "기준을 어겼다" 고 말할 수 있다
 *   UNKNOWN   기계가 말할 수 없다 — 사람이 본다
 *
 * 🔴 **이 스크립트는 등록을 열지도 막지도 않는다.**
 *    register·batch-qa 에 연결되어 있지 않다. 판정을 보여줄 뿐이다.
 *    M-AUTO-3 까지는 판정만 만들고 등록 동작을 건드리지 않는다 (§13.7).
 *
 * 🔴 **파일을 쓰지 않는다.** read-only 다. `--write` 같은 옵션이 없다.
 *
 * 🔴 HIGH 부터 본다. LOW/MEDIUM 에 강제하지 않는다 —
 *    그쪽은 이미 자동 등록이 돌고 있고, 이 리포트가 그 흐름을 바꾸지 않는다.
 *
 * 사용법
 *   node scripts/magazine-judge-report.mjs --slug <slug>
 *   node scripts/magazine-judge-report.mjs --slug <slug> --json
 *   node scripts/magazine-judge-report.mjs --all-high      큐의 HIGH 중 패킷이 있는 것
 *
 * 종료 코드: FAIL 이면 1, 아니면 0 (UNKNOWN 은 0 — 실패가 아니라 대기다)
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { loadArticles, loadQueue, DRAFTS_DIR } from './lib/magazine-load.mjs'
import { runQa } from './magazine-qa.mjs'
import { collectUnknowns, decide, autoRegisterable, VERDICT } from './lib/magazine-judge.mjs'
import {
  checkFirstPerson, checkTitleForm, checkCareAdvice,
  checkDepartmentDirective, checkTreatmentDirective, checkCostClaim,
} from './lib/magazine-editorial.mjs'

/** article-draft.ts 또는 등록 레코드에서 본문을 뽑는다 */
function bodyTextOf(article) {
  const out = []
  for (const b of article.body ?? []) {
    if (b.text) out.push(b.text)
    if (b.items) out.push(...b.items)
  }
  return out.join('\n')
}

/** 등록분이면 articles.ts, 아니면 draft 를 본다. 정본이 우선이다 */
function loadTarget(slug) {
  const published = loadArticles()
  const found = published.find((a) => a.slug === slug)
  if (found) return { article: found, source: 'articles.ts', draftPath: null }

  const draftPath = join(DRAFTS_DIR, slug, 'article-draft.ts')
  if (!existsSync(draftPath)) return null
  const qa = runQa({ draftPath })
  const article = qa.targets?.[0] ?? null
  return article ? { article, source: 'article-draft.ts', draftPath } : null
}

function judge(slug) {
  const published = loadArticles()
  const queue = loadQueue()
  const queueItem = queue.find((i) => i.slug === slug) ?? null

  const target = loadTarget(slug)
  if (!target) return { slug, error: `article-draft.ts 도 articles.ts 도 없다: ${slug}` }

  const { article, source, draftPath } = target
  const bodyText = bodyTextOf(article)

  const qa = draftPath ? runQa({ draftPath }) : runQa()
  const rows = qa.rows.filter((r) => String(r.id).startsWith(slug))
  const qaFail = rows.filter((r) => r.level === 'FAIL').length
  const qaWarn = rows.filter((r) => r.level === 'WARN').length

  // deterministic — 여기서 PASS 라고 말할 수 있는 것들
  const det = [
    ['D1 1인칭 화자', checkFirstPerson(bodyText).level],
    ['D2 제목 형태', checkTitleForm(article.title).level],
    ['D4-A 진료 권고', checkCareAdvice(bodyText, article.medical).level],
    ['D5 진료과 단정', checkDepartmentDirective(bodyText).level],
    ['D7 치료 권유·만류', checkTreatmentDirective(bodyText).level],
    ['D8 비용 단정', checkCostClaim(bodyText, article).level],
  ].map(([id, level]) => ({ id, verdict: level === 'FAIL' ? VERDICT.FAIL : level === 'WARN' ? 'WARN' : VERDICT.PASS }))

  const unknowns = collectUnknowns({ article, bodyText, published, queueItem })
  const detFail = det.filter((d) => d.verdict === VERDICT.FAIL).length
  const verdict = decide({ qaFail: qaFail + detFail, unknowns })

  return {
    slug,
    source,
    verdict,
    autoRegisterable: autoRegisterable(verdict),
    riskLevel: queueItem?.riskLevel ?? null,
    cluster: article.cluster ?? null,
    qa: { fail: qaFail, warn: qaWarn, rows: rows.map((r) => ({ level: r.level, msg: r.msg })) },
    deterministic: det,
    unknowns,
  }
}

function printHuman(r) {
  if (r.error) {
    console.log(`\n  ⛔ ${r.slug} — ${r.error}\n`)
    return
  }
  const mark = { PASS: '✅', FAIL: '⛔', UNKNOWN: '🟡' }[r.verdict]
  console.log('')
  console.log(`  검수 리포트 — ${r.slug}`)
  console.log(`  출처     : ${r.source}${r.riskLevel ? ` · riskLevel ${r.riskLevel}` : ''}${r.cluster ? ` · ${r.cluster}` : ''}`)
  console.log('')
  console.log(`  ${mark} ${r.verdict}`)
  console.log(`     자동 등록 ${r.autoRegisterable ? '가능' : '불가'} — ${
    r.verdict === VERDICT.PASS
      ? '기계가 판정할 수 있는 항목을 전부 만족한다'
      : r.verdict === VERDICT.FAIL
        ? '기준을 어겼다'
        : '기계가 말할 수 없는 항목이 남았다. 창업자가 본다'
  }`)
  console.log('')

  console.log(`  기계 판정 (deterministic)  QA FAIL ${r.qa.fail} · WARN ${r.qa.warn}`)
  for (const d of r.deterministic) {
    const m = { PASS: '✅', FAIL: '⛔', WARN: '⚠️ ' }[d.verdict]
    console.log(`     ${m} ${d.id}`)
  }
  for (const row of r.qa.rows) console.log(`     ${row.level === 'FAIL' ? '⛔' : '⚠️ '} ${row.msg}`)
  console.log('')

  if (r.unknowns.length === 0) {
    console.log('  🟡 UNKNOWN 0건 — 사람이 볼 것이 없다')
  } else {
    console.log(`  🟡 UNKNOWN ${r.unknowns.length}건 — 창업자가 확인한다`)
    for (const u of r.unknowns) {
      console.log('')
      console.log(`     [${u.id}] ${u.question}`)
      console.log(`        근거: ${String(u.where).slice(0, 100)}`)
      console.log(`        왜  : ${u.why}`)
    }
  }
  console.log('')
}

function help() {
  console.log(`검수 리포트 — PASS / FAIL / UNKNOWN (M-AUTO-3)

  node scripts/magazine-judge-report.mjs --slug <slug>
  node scripts/magazine-judge-report.mjs --slug <slug> --json
  node scripts/magazine-judge-report.mjs --all-high

  PASS      기계가 "기준을 만족한다" 고 말할 수 있다   → 자동 등록 후보
  FAIL      기계가 "기준을 어겼다" 고 말할 수 있다     → 자동 보류
  UNKNOWN   기계가 말할 수 없다                        → 창업자가 본다

🔴 UNKNOWN 은 통과가 아니다. 하나라도 있으면 자동 등록 대상이 아니다.
🔴 이 스크립트는 등록을 열지도 막지도 않는다. 판정만 보여준다.
🔴 파일을 쓰지 않는다.`)
}

function main() {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.length === 0) return help()
  const asJson = argv.includes('--json')

  let slugs = []
  if (argv.includes('--all-high')) {
    slugs = loadQueue()
      .filter((i) => i.riskLevel === 'HIGH')
      .map((i) => i.slug)
      .filter((s) => existsSync(join(DRAFTS_DIR, s, 'article-draft.ts')))
    if (slugs.length === 0) console.log('\n  큐의 HIGH 중 article-draft.ts 가 있는 글이 없다\n')
  } else {
    const i = argv.indexOf('--slug')
    if (i === -1 || !argv[i + 1]) {
      console.error('  --slug 가 필요하다')
      process.exit(2)
    }
    slugs = [argv[i + 1]]
  }

  const results = slugs.map(judge)
  if (asJson) console.log(JSON.stringify(results.length === 1 ? results[0] : results, null, 2))
  else results.forEach(printHuman)

  process.exit(results.some((r) => r.verdict === VERDICT.FAIL || r.error) ? 1 : 0)
}

if (process.argv[1] && process.argv[1].endsWith('magazine-judge-report.mjs')) main()

#!/usr/bin/env tsx
/**
 * scout 목록 점수 dry-run — 🔴 **기존 JSONL read-only. 추가 크롤 비용 0**
 *
 * 정본: docs/operations/2026-09-03-raw-supply-chain-design.md §4-F
 *
 * 🔴 **이 스크립트가 하지 않는 것**
 *    live 크롤 · 브라우저 실행 · 상세 fetch · DB write · raw-only import ·
 *    Sheet 접근 · Candidate/Post/Queue 변경 · scheduler 등록.
 *    `.microseed-data` 의 scout list JSONL 을 **읽기만** 한다.
 *
 * 🔴 **post-score-first**: 판단 단위는 게시글 1개다. 소스 사이에 서열이 없다.
 *    이 도구는 "어느 소스가 좋은가" 를 답하지 않는다 — 답할 수 없게 만들었다.
 *
 * 🔴 **cheap-signal-first**: 목록에서 판단 가능한 것은 목록에서 끝낸다.
 *    상세 fetch 는 점수 높은 후보에만 쓴다. 이 dry-run 은 **얼마나 아낄 수 있는지**를 센다.
 *
 * 🔴 **제목 원문을 기본으로 출력하지 않는다.** 매칭 라벨과 백분위만 찍는다.
 *    `--show-title` 을 줄 때만 **상위 후보**의 제목을 한 줄로 보여준다 —
 *    사람이 눈으로 보지 못하면 가중치가 맞는지 판단할 수 없기 때문이다.
 *    🔴 제외·보류된 글의 제목은 옵션을 켜도 나오지 않는다. 본문은 어떤 경우에도 안 나온다.
 *
 * 사용법
 *   npx tsx scripts/micro-seed-score-scout-dry-run.mts
 *   npx tsx scripts/micro-seed-score-scout-dry-run.mts --run=20260903-204007
 *   npx tsx scripts/micro-seed-score-scout-dry-run.mts --top=20
 *   npx tsx scripts/micro-seed-score-scout-dry-run.mts --show-title   🟡 로컬 검토용
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  scoreRows, rankShift, groupKeyOf, toArticles, articleKeyOf, LANE_LABEL,
  type ScoutRow, type ScoredRow, type Lane,
} from './lib/micro-seed-scout-score.mjs'

const DATA_DIR = './.microseed-data'
const argv = process.argv.slice(2)
const arg = (n: string): string | undefined => {
  const hit = argv.find((a) => a.startsWith(`--${n}=`))
  return hit ? hit.slice(n.length + 3) : undefined
}
const TOP = Number(arg('top') ?? '20')
const ONLY_RUN = arg('run') ?? null
/**
 * 🔴 **기본값 false.** 제목은 소스 원문이라 기본으로 찍지 않는다.
 *    로컬에서 사람이 상위 후보를 눈으로 볼 때만 켠다 — 그래야 가중치를 판단할 수 있다.
 *    🔴 제외·보류된 글의 제목은 이 옵션을 켜도 출력하지 않는다.
 *    🔴 본문(rawBody)은 어떤 경우에도 출력하지 않는다.
 */
const SHOW_TITLE = argv.includes('--show-title')
const TITLE_MAX = 80

const fail = (m: string): never => {
  console.error(`\n🛑 ${m}\n`)
  process.exit(1)
}

type Loaded = { file: string; rows: ScoutRow[]; skippedLegacy: number }

/**
 * 🔴 `sourceRunId` 없는 구 데이터는 **분석에서 뺀다.**
 *    PR-S2-b-8 이전 산출물에는 제외 판정도 메타도 없다 —
 *    섞으면 백분위와 비율이 통째로 거짓이 된다. 다만 **몇 건을 뺐는지 보고한다**.
 */
function load(): { loaded: Loaded[]; legacyRows: number; legacyFiles: string[] } {
  let files: string[]
  try {
    files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.list.jsonl')).sort()
  } catch {
    return fail(`${DATA_DIR} 를 읽지 못했다 — scout 산출물이 없다`)
  }
  if (files.length === 0) fail(`${DATA_DIR} 에 scout list JSONL 이 없다`)

  const loaded: Loaded[] = []
  const legacyFiles: string[] = []
  let legacyRows = 0

  for (const f of files) {
    const all: ScoutRow[] = readFileSync(join(DATA_DIR, f), 'utf-8')
      .trim()
      .split('\n')
      .filter((l) => l.trim() !== '')
      .map((l) => JSON.parse(l) as ScoutRow)
    const withRun = all.filter((r) => typeof r.sourceRunId === 'string' && r.sourceRunId !== '')
    const skipped = all.length - withRun.length
    legacyRows += skipped
    if (withRun.length === 0) {
      legacyFiles.push(f)
      continue
    }
    const rows = ONLY_RUN === null ? withRun : withRun.filter((r) => r.sourceRunId === ONLY_RUN)
    if (rows.length) loaded.push({ file: f, rows, skippedLegacy: skipped })
  }
  return { loaded, legacyRows, legacyFiles }
}

const pad = (s: string | number, n: number): string => String(s).padStart(n)
const padr = (s: string | number, n: number): string => String(s).padEnd(n)

function main(): void {
  console.log('\nscout 목록 점수 dry-run — 🔴 기존 JSONL read-only')
  console.log('─────────────────────────────────────────────────────────')
  console.log('  🔴 추가 크롤 0 · 브라우저 0 · 상세 fetch 0 · DB write 0 · Sheet 0')
  console.log('  🔴 점수·가중치는 **초안**이다. 자동 상세 fetch 기준이 아니다.')
  console.log(
    SHOW_TITLE
      ? '  🟡 --show-title: 상위 **후보** 제목만 출력한다. 제외·보류 글 제목과 본문은 출력하지 않는다.\n'
      : '  🔴 제목 원문을 출력하지 않는다 — 매칭 라벨과 백분위만 찍는다 (--show-title 로 켠다).\n',
  )

  const { loaded, legacyRows, legacyFiles } = load()
  if (loaded.length === 0) fail(ONLY_RUN ? `run ${ONLY_RUN} 을 가진 행이 없다` : '분석할 행이 없다')

  const rows = loaded.flatMap((l) => l.rows)
  const articles = toArticles(rows)
  const repeats = articles.filter((a) => a.seenCount > 1)
  console.log(`  입력 파일 ${loaded.length}개 · 관측 행 ${rows.length}건 → 🔴 고유 글 ${articles.length}건`)
  console.log(`     반복 관측 ${repeats.length}건 (최대 ${articles.reduce((m, a) => Math.max(m, a.seenCount), 0)}회)`)
  console.log('     🔴 판단 단위는 게시글 1개다 — row 를 세면 top 에 같은 글이 중복으로 올라온다')
  for (const l of loaded) console.log(`     ${l.file} · ${l.rows.length}행`)
  if (legacyRows > 0 || legacyFiles.length > 0) {
    console.log(`\n  ⏭️  구 데이터 제외: ${legacyRows}행 · 파일 ${legacyFiles.length}개 (${legacyFiles.join(' · ')})`)
    console.log('     🔴 sourceRunId 가 없다 — 제외 판정도 메타도 없어 섞으면 백분위가 거짓이 된다')
  }

  const { scored, excluded, held } = scoreRows(rows)

  // ── hard exclude / hold / watch ──
  const byReason: Record<string, number> = {}
  for (const e of excluded) byReason[e.gate.reason ?? '?'] = (byReason[e.gate.reason ?? '?'] ?? 0) + 1
  const byHold: Record<string, number> = {}
  for (const h of held) byHold[h.gate.reason ?? '?'] = (byHold[h.gate.reason ?? '?'] ?? 0) + 1
  const watch = scored.filter((s) => s.watch)

  console.log('\n① 게이트 — 🔴 점수를 매기기 전에 가른다')
  console.log(`   hard exclude ${excluded.length}건  ${JSON.stringify(byReason)}`)
  console.log(`   hold(위험 보류) ${held.length}건  ${JSON.stringify(byHold)}`)
  console.log(`   후보 ${scored.length}건 · 그중 watch ${watch.length}건 (전부 고유 글 기준)`)
  console.log('   🔴 exclude · hold 는 0점이 아니라 **후보 집합에 들어오지 않는다**')

  // ── watch trend — 🔴 "미달 → 다음 실행에서 충족" 을 실제로 추적한다 (§4-E) ──
  const repeated = scored.filter((s) => s.obs.seenCount > 1)
  const grew = repeated.filter((s) => s.obs.commentDelta > 0)
  console.log(`\n   반복 관측된 후보 ${repeated.length}건 · 그중 댓글이 늘어난 글 ${grew.length}건`)
  for (const s of [...grew].sort((a, b) => b.obs.commentDelta - a.obs.commentDelta).slice(0, 5)) {
    console.log(
      `     ${s.row.sourceArticleId} · ${s.obs.seenCount}회 · 댓글 +${s.obs.commentDelta}` +
        `${s.obs.viewDelta === null ? '' : ` · 조회 +${s.obs.viewDelta}`} · ${s.obs.firstRunId}→${s.obs.lastRunId}`,
    )
  }
  console.log('   🔴 이것이 §4-E 의 "이번에 미달이어도 다음 실행에서 후보가 된다" 가 작동하는 모습이다')

  // ── top N ──
  const top = scored.slice(0, TOP)
  console.log(`\n② 상위 ${top.length}건 — 🔴 자동 fetch 대상이 아니라 눈으로 볼 목록이다`)
  console.log('   🔴 laneHint 는 자동 라우팅이 아니다 — 사람이 보는 힌트다. Sheet · DB · 자동 fetch 없음')
  console.log(
    `   ${padr('#', 3)} ${padr('총점', 6)} ${padr('레인', 10)} ${padr('화제', 5)} ${padr('핏', 4)} ${padr('대화', 4)} ${padr('신선', 4)} ${padr('감점', 5)} ` +
      `${padr('게시판', 16)} ${padr('articleId', 10)} ${padr('p/r', 7)} ${padr('댓/조', 10)} ${padr('lag', 6)}`,
  )
  top.forEach((s, i) => {
    const r = s.row
    console.log(
      `   ${padr(i + 1, 3)} ${padr(s.score.total.toFixed(1), 6)} ${padr(LANE_LABEL[s.laneHint.lane], 10)} ${padr(s.score.engagement.toFixed(1), 5)} ` +
        `${padr(s.score.targetFit.toFixed(0), 4)} ${padr(s.score.conversation.toFixed(0), 4)} ${padr(s.score.freshness.toFixed(0), 4)} ${padr(s.score.penalty === 0 ? '-' : s.score.penalty.toFixed(0), 5)} ` +
        `${padr((r.sourceBoardName ?? '').slice(0, 14), 16)} ${padr(r.sourceArticleId, 10)} ` +
        `${padr(`${r.sourcePage ?? '-'}/${r.sourceRankOnPage ?? '-'}`, 7)} ` +
        `${padr(`${r.sourceCommentCount}/${r.sourceViewCount ?? '-'}`, 10)} ${padr(s.lagMinutes === null ? '-' : s.lagMinutes.toFixed(0), 6)}`,
    )
    console.log(`       run ${s.obs.firstRunId}${s.obs.seenCount > 1 ? `→${s.obs.lastRunId}` : ''} · ${s.why}`)
    console.log(`       레인: ${s.laneHint.reason}`)
    // 🔴 후보(candidate)만 제목을 찍는다. 제외·보류 글의 제목은 옵션을 켜도 나오지 않는다 —
    //    top 배열 자체가 scored(=candidate)에서만 나오므로 구조적으로 보장된다.
    if (SHOW_TITLE) {
      const t = [...r.originalTitle]
      console.log(`       제목: ${t.length > TITLE_MAX ? `${t.slice(0, TITLE_MAX).join('')}…` : t.join('')}`)
    }
  })

  // ── laneHint 요약 ──
  console.log('\n③ laneHint — 🔴 "좋은 글인가" 가 아니라 "어느 레인에 좋은가"')
  console.log('   🔴 자동 라우팅이 아니다. Sheet write · DB write · 자동 fetch · import 경로가 없다.')
  console.log('   🔴 네이버 → Google Sheet 자동 전송은 미구현이며 별도 계약·승인 전까지 금지다.')
  const laneAll = new Map<Lane, number>()
  const laneTop = new Map<Lane, number>()
  for (const s of [...scored, ...excluded, ...held]) laneAll.set(s.laneHint.lane, (laneAll.get(s.laneHint.lane) ?? 0) + 1)
  for (const s of top) laneTop.set(s.laneHint.lane, (laneTop.get(s.laneHint.lane) ?? 0) + 1)
  const LANES: Lane[] = ['originalRaw', 'microSeedQuestion', 'infoSeed', 'participationSeed', 'growthIssue', 'hold', 'exclude']
  console.log(`   ${padr('lane', 20)} ${padr('전체', 6)} ${padr(`상위 ${top.length}`, 8)}`)
  for (const l of LANES) {
    console.log(`   ${padr(`${LANE_LABEL[l]} (${l})`, 20)} ${padr(laneAll.get(l) ?? 0, 6)} ${padr(laneTop.get(l) ?? 0, 8)}`)
  }
  console.log('   🔴 짧은 질문·잡담글은 버리는 글이 아니다 — Question · 참여 seed 후보다')

  // ── 그룹 요약 ──
  console.log('\n④ 그룹 요약 — 🔴 소스 우열이 아니라 **표본 상태**다')
  const groups = new Map<string, ScoredRow[]>()
  for (const s of scored) {
    const k = groupKeyOf(s.row)
    groups.set(k, [...(groups.get(k) ?? []), s])
  }
  const inTop = new Map<string, number>()
  for (const s of top) inTop.set(groupKeyOf(s.row), (inTop.get(groupKeyOf(s.row)) ?? 0) + 1)
  const exByGroup = new Map<string, number>()
  for (const e of [...excluded, ...held]) exByGroup.set(groupKeyOf(e.row), (exByGroup.get(groupKeyOf(e.row)) ?? 0) + 1)

  console.log(`   ${padr('group (run|board)', 40)} ${padr('후보', 5)} ${padr('상위', 5)} ${padr('제외+보류', 10)} ${padr('watch', 6)} 정규화 순위이동`)
  for (const [k, list] of groups) {
    const rs = rankShift(list)
    console.log(
      `   ${padr(k, 40)} ${padr(list.length, 5)} ${padr(inTop.get(k) ?? 0, 5)} ${padr(exByGroup.get(k) ?? 0, 10)} ` +
        `${padr(list.filter((s) => s.watch).length, 6)} 이동 ${rs.moved}건 · 평균 ${rs.meanShift.toFixed(1)} · 최대 ${rs.maxShift}`,
    )
  }
  console.log('   🔴 "이 소스가 낫다" 로 읽지 않는다. run 마다 시간대가 다르고 표본이 1회씩이다 (§4-F)')

  const all = rankShift(scored)
  console.log(`\n   전체 정규화 효과: 순위 이동 ${all.moved}/${scored.length}건 · 평균 ${all.meanShift.toFixed(1)} · 최대 ${all.maxShift}`)
  console.log('   🔴 이동이 0 이면 정규화가 아무 일도 안 한 것이고, 그건 곧 단순 댓글수 정렬이다')

  // ── 비용 ──
  console.log('\n⑤ 비용 — 🔴 cheap-signal-first')
  const uniq = articles.length
  const saved = excluded.length + held.length
  console.log(`   observation rows      ${rows.length}건  (관측 횟수 — 🔴 절감률의 분모가 아니다)`)
  console.log(`   unique articles       ${uniq}건  ← 상세 fetch 는 글 단위로 일어난다`)
  console.log(`   게이트로 아낀 상세     ${saved}건 (exclude ${excluded.length} · hold ${held.length})`)
  console.log(`   점수 상위 후보         ${top.length}건`)
  console.log(
    `   무조건 열었다면 ${uniq}건 → 지금 ${top.length}건 · **${uniq - top.length}건 절약 ` +
      `(${Math.round(((uniq - top.length) / uniq) * 100)}%)**`,
  )
  console.log(`   🔴 row 기준으로 세면 ${Math.round(((rows.length - top.length) / rows.length) * 100)}% 로 보인다 — 같은 글을 여러 번 센 값이라 과장이다`)
  console.log('   🔴 이 dry-run 자체는 기존 JSONL read-only라 **추가 크롤 비용 0**이다')

  console.log('\n⑥ 이 dry-run 이 정하지 않은 것')
  console.log('   🔴 가중치 · 최종 임계값 · 자동 상세 fetch 기준 · threshold 운영값 · slot 시간표')
  console.log('   🔴 laneHint 는 힌트일 뿐 — 레인별 자동 라우팅 · Sheet 전송 · Growth 레인 구현은 없다')
  console.log('   표본이 하루치 몇 회뿐이다. 순위가 납득되는지 눈으로 보는 단계다.\n')
}

main()
